using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Bim4d.Desktop.Core;

/// <summary>워커를 어떻게 띄우고 얼마나 기다릴지.</summary>
public sealed record StdioIfcWorkerOptions
{
    /// <summary>실행 파일. 보통 <c>python</c>이다.</summary>
    public required string Command { get; init; }

    public required IReadOnlyList<string> Arguments { get; init; }

    public string? WorkingDirectory { get; init; }

    /// <summary>요청 하나의 마감. 넘기면 프로세스를 죽인다.</summary>
    public TimeSpan Timeout { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>
    /// 이어서 이만큼 죽으면 더 띄우지 않는다.
    /// </summary>
    /// <remarks>크래시 직후 다시 죽는 워커를 계속 살리면 부팅 루프가 된다.</remarks>
    public int MaxConsecutiveFailures { get; init; } = 3;
}

/// <summary>
/// 자식 프로세스와 줄 단위 JSON으로 말하는 IFC Worker 클라이언트.
/// </summary>
/// <remarks>
/// 규약의 정본은 <c>docs/adr/0009-ifc-worker-ipc.md</c>다. 이 파일이 전송을 아는 유일한
/// 자리이며, TypeScript 쪽 <c>packages/ifc-worker-client</c>와 같은 규약을 C#으로 구현한 것이다.
///
/// 한 번에 하나만 보낸다. 워커 안에서 IfcOpenShell을 동시에 굴리면 메모리가 배로 든다.
/// </remarks>
public sealed class StdioIfcWorker : IIfcWorker
{
    /// <summary>부모가 아는 규약 버전. 워커가 다른 값을 말하면 계속 말하지 않는다.</summary>
    public const int ProtocolVersion = 1;

    private const int StderrKeep = 4000;

    private readonly StdioIfcWorkerOptions _options;
    private readonly SemaphoreSlim _turn = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> _pending = new();
    private readonly StringBuilder _stderrTail = new();

    private Process? _child;
    private Task<Process>? _starting;
    private TaskCompletionSource<bool>? _ready;
    private int _consecutiveFailures;
    private int _nextId;
    private bool _disposed;

    public StdioIfcWorker(StdioIfcWorkerOptions options)
    {
        _options = options;
    }

    public async Task PingAsync(CancellationToken cancellationToken = default)
    {
        await RequestAsync("ping", new JsonObject(), cancellationToken).ConfigureAwait(false);
    }

    public async Task<IfcMetadata> InspectAsync(
        string path,
        CancellationToken cancellationToken = default
    )
    {
        var result = await RequestAsync(
                "inspect",
                new JsonObject { ["path"] = path },
                cancellationToken
            )
            .ConfigureAwait(false);

        return result.Deserialize<IfcMetadata>()
            ?? throw new WorkerException("worker.protocol.broken", "inspect 결과를 읽지 못했다.");
    }

    public async Task<string> ImportScheduleAsync(
        string path,
        CancellationToken cancellationToken = default
    )
    {
        var result = await RequestAsync(
                "import-schedule",
                new JsonObject { ["path"] = path },
                cancellationToken
            )
            .ConfigureAwait(false);

        var schedule = result["schedule"];
        return schedule?.ToJsonString()
            ?? throw new WorkerException("worker.protocol.broken", "일정이 응답에 없다.");
    }

    public async Task<ScheduleExportResult> ExportScheduleAsync(
        string sourcePath,
        string outputPath,
        string scheduleJson,
        CancellationToken cancellationToken = default
    )
    {
        var parameters = new JsonObject
        {
            ["sourcePath"] = sourcePath,
            ["outputPath"] = outputPath,
            ["schedule"] = JsonNode.Parse(scheduleJson),
        };

        var result = await RequestAsync("export-schedule", parameters, cancellationToken)
            .ConfigureAwait(false);

        return result.Deserialize<ScheduleExportResult>()
            ?? throw new WorkerException("worker.protocol.broken", "내보내기 결과를 읽지 못했다.");
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        var dying = _child;
        _child = null;
        _starting = null;
        FailAllPending(new WorkerException("worker.disposed", "Worker를 끝냈다."));

        if (dying is null)
        {
            return;
        }

        try
        {
            // stdin을 닫으면 워커가 EOF를 보고 스스로 끝낸다. 그래도 남으면 죽인다.
            dying.StandardInput.Close();
            if (!dying.WaitForExit(2000))
            {
                dying.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
            // 이미 끝난 프로세스다.
        }
        finally
        {
            dying.Dispose();
        }

        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <summary>요청을 줄 세운다. 앞의 것이 실패해도 뒤의 것은 제 차례에 나간다.</summary>
    private async Task<JsonObject> RequestAsync(
        string method,
        JsonObject parameters,
        CancellationToken cancellationToken
    )
    {
        await _turn.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await SendAsync(method, parameters, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _turn.Release();
        }
    }

    private async Task<JsonObject> SendAsync(
        string method,
        JsonObject parameters,
        CancellationToken cancellationToken
    )
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var child = await StartAsync().ConfigureAwait(false);

        var id = Interlocked.Increment(ref _nextId).ToString();
        var pending = new TaskCompletionSource<JsonObject>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        _pending[id] = pending;

        var request = new JsonObject
        {
            ["id"] = id,
            ["method"] = method,
            ["params"] = parameters,
        };

        await child.StandardInput.WriteLineAsync(request.ToJsonString()).ConfigureAwait(false);
        await child.StandardInput.FlushAsync(cancellationToken).ConfigureAwait(false);

        using var deadline = new CancellationTokenSource(_options.Timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            deadline.Token,
            cancellationToken
        );

        try
        {
            return await pending.Task.WaitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested)
        {
            _pending.TryRemove(id, out _);
            // 마감을 넘긴 워커는 자기 시계를 못 본다. 부모가 죽인다 (ADR-0009).
            var timedOut = new WorkerException(
                "worker.timeout",
                $"{method}이 {_options.Timeout.TotalMilliseconds}ms 안에 끝나지 않았다."
            );
            DropChild(timedOut);
            throw timedOut;
        }
    }

    /// <summary>워커를 띄우고 준비 줄을 기다린다.</summary>
    private Task<Process> StartAsync()
    {
        if (_starting is not null)
        {
            return _starting;
        }

        if (_consecutiveFailures >= _options.MaxConsecutiveFailures)
        {
            throw new WorkerException(
                "worker.unavailable",
                $"Worker가 이어서 {_consecutiveFailures}번 죽었다. 마지막 기록: {_stderrTail}"
            );
        }

        var info = new ProcessStartInfo
        {
            FileName = _options.Command,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            // 규약은 UTF-8이다. Windows 기본 코드 페이지로 두면 한글이 깨져 오간다.
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            StandardInputEncoding = new UTF8Encoding(false),
        };
        foreach (var argument in _options.Arguments)
        {
            info.ArgumentList.Add(argument);
        }
        if (_options.WorkingDirectory is not null)
        {
            info.WorkingDirectory = _options.WorkingDirectory;
        }

        var ready = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        _ready = ready;

        Process child;
        try
        {
            child = Process.Start(info)
                ?? throw new WorkerException("worker.spawn-failed", "프로세스를 띄우지 못했다.");
        }
        catch (Exception cause) when (cause is not WorkerException)
        {
            _consecutiveFailures += 1;
            throw new WorkerException("worker.spawn-failed", cause.Message);
        }

        _child = child;
        child.EnableRaisingEvents = true;
        child.OutputDataReceived += (_, args) => OnStdout(child, args.Data);
        child.ErrorDataReceived += (_, args) => OnStderr(args.Data);
        child.Exited += (_, _) => OnExited(child);
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();

        _starting = WaitForReadyAsync(child, ready);
        return _starting;
    }

    private static async Task<Process> WaitForReadyAsync(
        Process child,
        TaskCompletionSource<bool> ready
    )
    {
        await ready.Task.ConfigureAwait(false);
        return child;
    }

    private void OnStdout(Process source, string? line)
    {
        // 놓은 프로세스의 줄은 무시한다. 죽인 워커의 뒤늦은 출력이 새 워커를 건드리지 않게 한다.
        if (line is null || !ReferenceEquals(_child, source))
        {
            return;
        }

        var trimmed = line.Trim();
        if (trimmed.Length == 0)
        {
            return;
        }

        JsonObject? message;
        try
        {
            message = JsonNode.Parse(trimmed) as JsonObject;
        }
        catch (JsonException)
        {
            // stdout은 프로토콜 전용이다. 섞인 줄은 규약 위반이므로 프로세스를 놓는다.
            var broken = new WorkerException(
                "worker.protocol.broken",
                $"stdout에 JSON이 아닌 줄이 섞였다: {Truncate(trimmed)}"
            );
            _ready?.TrySetException(broken);
            DropChild(broken);
            return;
        }

        if (message is null)
        {
            return;
        }

        if (message["event"]?.GetValue<string>() == "ready")
        {
            var protocol = message["protocol"]?.GetValue<int>();
            if (protocol != ProtocolVersion)
            {
                var mismatch = new WorkerException(
                    "worker.protocol.mismatch",
                    $"규약 버전이 다르다: {protocol}"
                );
                _ready?.TrySetException(mismatch);
                DropChild(mismatch);
                return;
            }

            _ready?.TrySetResult(true);
            return;
        }

        var id = message["id"]?.GetValue<string>();
        if (id is null || !_pending.TryRemove(id, out var pending))
        {
            return;
        }

        // 답을 하나 받았다는 것이 성한 워커라는 증거다. 뜨는 데 성공한 것만으로 세지 않는다.
        _consecutiveFailures = 0;

        if (message["ok"]?.GetValue<bool>() == true)
        {
            pending.TrySetResult(message["result"] as JsonObject ?? new JsonObject());
            return;
        }

        var error = message["error"] as JsonObject;
        pending.TrySetException(
            new WorkerException(
                error?["code"]?.GetValue<string>() ?? "worker.internal",
                error?["message"]?.GetValue<string>() ?? "알 수 없는 실패"
            )
        );
    }

    private void OnStderr(string? line)
    {
        if (line is null)
        {
            return;
        }

        lock (_stderrTail)
        {
            _stderrTail.AppendLine(line);
            if (_stderrTail.Length > StderrKeep)
            {
                _stderrTail.Remove(0, _stderrTail.Length - StderrKeep);
            }
        }
    }

    private void OnExited(Process source)
    {
        if (_disposed || !ReferenceEquals(_child, source))
        {
            return;
        }

        _consecutiveFailures += 1;
        var crashed = new WorkerException(
            "worker.crashed",
            $"Worker가 종료됐다 (code {source.ExitCode}). 마지막 기록: {_stderrTail}"
        );
        _ready?.TrySetException(crashed);
        DropChild(crashed);
    }

    /// <summary>프로세스를 놓는다. 다음 요청에서 다시 띄운다.</summary>
    private void DropChild(WorkerException reason)
    {
        var dying = _child;
        _child = null;
        _starting = null;
        _ready = null;
        FailAllPending(reason);

        try
        {
            dying?.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
            // 이미 끝났다.
        }
    }

    private void FailAllPending(WorkerException reason)
    {
        foreach (var key in _pending.Keys)
        {
            if (_pending.TryRemove(key, out var pending))
            {
                pending.TrySetException(reason);
            }
        }
    }

    private static string Truncate(string value) =>
        value.Length <= 200 ? value : value[..200];
}
