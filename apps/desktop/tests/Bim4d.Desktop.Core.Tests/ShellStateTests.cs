using System.Text.Json;

namespace Bim4d.Desktop.Core.Tests;

public sealed class RecentProjectsTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-recent-").FullName;

    private RecentProjects Store(int limit = 3) =>
        new(Path.Combine(_root, "recent.json"), limit);

    private string TouchFile(string name)
    {
        var path = Path.Combine(_root, name);
        File.WriteAllText(path, "x");
        return path;
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void 처음에는_비어_있다()
    {
        Assert.Empty(Store().Read());
    }

    [Fact]
    public void 연_파일이_맨_앞에_온다()
    {
        var store = Store();
        store.Add(TouchFile("a.ifc"), DateTimeOffset.UnixEpoch);
        store.Add(TouchFile("b.ifc"), DateTimeOffset.UnixEpoch);

        Assert.EndsWith("b.ifc", store.Read()[0].Path, StringComparison.Ordinal);
    }

    [Fact]
    public void 같은_파일을_다시_열면_줄이_늘지_않는다()
    {
        var store = Store();
        var path = TouchFile("a.ifc");
        store.Add(path, DateTimeOffset.UnixEpoch);

        var kept = store.Add(path, DateTimeOffset.UnixEpoch.AddDays(1));

        Assert.Single(kept);
    }

    [Fact]
    public void 대소문자가_달라도_같은_파일로_본다()
    {
        // Windows의 경로는 대소문자를 가리지 않는다. 두 줄로 남으면 목록이 지저분해진다.
        var store = Store();
        var path = TouchFile("a.ifc");
        store.Add(path.ToUpperInvariant(), DateTimeOffset.UnixEpoch);

        var kept = store.Add(path.ToLowerInvariant(), DateTimeOffset.UnixEpoch);

        Assert.Single(kept);
    }

    [Fact]
    public void 한도를_넘으면_오래된_것부터_버린다()
    {
        var store = Store(limit: 2);
        store.Add(TouchFile("a.ifc"), DateTimeOffset.UnixEpoch);
        store.Add(TouchFile("b.ifc"), DateTimeOffset.UnixEpoch);

        var kept = store.Add(TouchFile("c.ifc"), DateTimeOffset.UnixEpoch);

        Assert.Equal(2, kept.Count);
        Assert.DoesNotContain(kept, entry => entry.Path.EndsWith("a.ifc", StringComparison.Ordinal));
    }

    [Fact]
    public void 사라진_파일은_걷는다()
    {
        var store = Store();
        var path = TouchFile("a.ifc");
        store.Add(path, DateTimeOffset.UnixEpoch);
        File.Delete(path);

        // 열 수 없는 줄을 목록에 두면 눌렀을 때 실패한다.
        Assert.Empty(store.Prune());
    }
}

public sealed class JsonStoreTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-json-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void 없는_파일은_기본값이다()
    {
        var settings = JsonStore.Read(Path.Combine(_root, "none.json"), new ShellSettings());

        // 비어 있는 것이 기본이며 "배치가 고른다"는 뜻이다 (ADR-0011).
        Assert.Equal("", settings.PythonCommand);
        Assert.Equal(120, settings.WorkerTimeoutSeconds);
    }

    [Fact]
    public void 깨진_파일도_앱을_멈추지_않는다()
    {
        var path = Path.Combine(_root, "settings.json");
        File.WriteAllText(path, "{ 깨졌다");

        // 설정 파일이 깨졌다고 프로그램이 뜨지 않으면 사용자가 고칠 길이 없다.
        Assert.Equal(120, JsonStore.Read(path, new ShellSettings()).WorkerTimeoutSeconds);
    }

    [Fact]
    public void 쓰고_다시_읽으면_같다()
    {
        var path = Path.Combine(_root, "nested", "settings.json");
        var written = new ShellSettings { PythonCommand = "py", WorkerTimeoutSeconds = 5 };

        JsonStore.Write(path, written);

        Assert.Equal(written, JsonStore.Read(path, new ShellSettings()));
    }
}

public sealed class ShellLogTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-log-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void 줄마다_JSON_하나를_쓴다()
    {
        var moment = new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero);
        var log = new FileShellLog(_root, () => moment);

        log.Write("info", "모델을 열었다", new Dictionary<string, object?> { ["traceId"] = "t1" });
        log.Write("error", "워커가 죽었다", new Dictionary<string, object?> { ["traceId"] = "t2" });

        var lines = File.ReadAllLines(log.FileFor(moment));
        Assert.Equal(2, lines.Length);
        using var first = JsonDocument.Parse(lines[0]);
        Assert.Equal("info", first.RootElement.GetProperty("level").GetString());
        // 프로세스 셋을 오가므로 줄마다 traceId를 싣는다.
        Assert.Equal("t1", first.RootElement.GetProperty("traceId").GetString());
    }

    [Fact]
    public void 날짜별로_파일을_가른다()
    {
        var first = new DateTimeOffset(2026, 9, 4, 23, 59, 0, TimeSpan.Zero);
        var second = first.AddMinutes(2);
        var log = new FileShellLog(_root, () => first);
        log.Write("info", "어제");

        var later = new FileShellLog(_root, () => second);
        later.Write("info", "오늘");

        Assert.NotEqual(log.FileFor(first), later.FileFor(second));
        Assert.Single(File.ReadAllLines(later.FileFor(second)));
    }
}

public sealed class ErrorReportTests
{
    [Fact]
    public void 워커_실패는_코드를_함께_보인다()
    {
        var report = ErrorReport.From(
            new WorkerException("worker.timeout", "끝나지 않았다."),
            "C:/logs/shell.log"
        );

        Assert.Equal("worker.timeout", report.Code);
        Assert.Contains("worker.timeout", report.ToDisplayText(), StringComparison.Ordinal);
        Assert.Contains("C:/logs/shell.log", report.ToDisplayText(), StringComparison.Ordinal);
    }

    [Fact]
    public void 코드가_없는_실패도_어디를_볼지_알려_준다()
    {
        var report = ErrorReport.From(new InvalidOperationException("깨졌다"), "C:/logs/shell.log");

        Assert.Null(report.Code);
        // "알 수 없는 오류"만 띄우면 사용자가 할 수 있는 일이 없다.
        Assert.Contains("C:/logs/shell.log", report.ToDisplayText(), StringComparison.Ordinal);
    }
}
