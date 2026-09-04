using System.Text.Json;
using System.Text.Json.Nodes;

namespace Bim4d.Desktop.Core;

/// <summary>
/// 셸이 남기는 기록.
/// </summary>
/// <remarks>
/// 줄 하나가 JSON 하나다. 프로세스 셋(C#·TypeScript·Python)을 오가는 일이라 사람이 눈으로
/// 잇기 어렵다. 그래서 모든 줄에 <c>traceId</c>를 싣는다 (마스터 계획 16절 위험 항목).
/// </remarks>
public interface IShellLog
{
    void Write(string level, string message, IReadOnlyDictionary<string, object?>? fields = null);
}

/// <summary>날짜별 파일에 JSON 줄을 붙여 쓰는 기록기.</summary>
public sealed class FileShellLog : IShellLog
{
    private readonly string _directory;
    private readonly Func<DateTimeOffset> _now;
    private readonly Lock _gate = new();

    public FileShellLog(string directory, Func<DateTimeOffset>? now = null)
    {
        _directory = directory;
        _now = now ?? (() => DateTimeOffset.Now);
    }

    public string FileFor(DateTimeOffset moment) =>
        Path.Combine(_directory, $"shell-{moment:yyyyMMdd}.log");

    public void Write(
        string level,
        string message,
        IReadOnlyDictionary<string, object?>? fields = null
    )
    {
        var moment = _now();
        var line = new JsonObject
        {
            ["at"] = moment.ToString("O"),
            ["level"] = level,
            ["message"] = message,
        };

        foreach (var (key, value) in fields ?? new Dictionary<string, object?>())
        {
            line[key] = value is null ? null : JsonValue.Create(value.ToString());
        }

        Directory.CreateDirectory(_directory);
        lock (_gate)
        {
            File.AppendAllText(FileFor(moment), line.ToJsonString() + Environment.NewLine);
        }
    }
}

/// <summary>
/// 사용자에게 보일 오류 리포트.
/// </summary>
/// <remarks>
/// 무엇이 실패했는지, 어떤 코드였는지, 어디를 보면 되는지를 함께 담는다. "알 수 없는
/// 오류"만 띄우면 사용자가 할 수 있는 일이 없다.
/// </remarks>
public sealed record ErrorReport(string Title, string Detail, string? Code, string LogFile)
{
    public static ErrorReport From(Exception cause, string logFile) =>
        cause switch
        {
            WorkerException worker => new ErrorReport(
                "IFC Worker가 실패했다",
                worker.Message,
                worker.Code,
                logFile
            ),
            InstallLayoutException layout => new ErrorReport(
                "설치가 온전하지 않다",
                layout.Message,
                layout.Code,
                logFile
            ),
            ICodedError coded => new ErrorReport(
                cause.GetType().Name,
                cause.Message,
                coded.Code,
                logFile
            ),
            _ => new ErrorReport(cause.GetType().Name, cause.Message, null, logFile),
        };

    public string ToDisplayText() =>
        string.Join(
            Environment.NewLine,
            [
                Detail,
                Code is null ? string.Empty : $"코드: {Code}",
                $"기록: {LogFile}",
            ]
        );

    /// <summary>사용자가 붙여 넣을 수 있는 한 덩어리. 로그 파일을 열지 못하는 자리에서 쓴다.</summary>
    public string ToClipboardText() =>
        JsonSerializer.Serialize(
            new
            {
                title = Title,
                detail = Detail,
                code = Code,
                logFile = LogFile,
            }
        );
}
