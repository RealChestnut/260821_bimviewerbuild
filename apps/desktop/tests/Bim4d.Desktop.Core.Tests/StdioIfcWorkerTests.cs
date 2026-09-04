namespace Bim4d.Desktop.Core.Tests;

/// <summary>
/// 실제 Python 워커를 띄워 규약을 지키는지 본다.
/// </summary>
/// <remarks>
/// Python과 ifcopenshell이 있어야 한다. CI는 전용 job에서 함께 세운다.
/// </remarks>
public sealed class StdioIfcWorkerTests
{
    private static string Python => Environment.GetEnvironmentVariable("PYTHON") ?? "python";

    private static StdioIfcWorker RealWorker() =>
        new(
            new StdioIfcWorkerOptions
            {
                Command = Python,
                Arguments = ["-m", "ifc_worker"],
                WorkingDirectory = RepoPaths.WorkerDirectory,
                Timeout = TimeSpan.FromMinutes(2),
            }
        );

    /// <summary>규약을 흉내 내는 가짜 워커. 수명과 실패를 시험할 때 쓴다.</summary>
    private static StdioIfcWorker FakeWorker(string script, int timeoutMs = 1500) =>
        new(
            new StdioIfcWorkerOptions
            {
                Command = Python,
                Arguments = ["-c", script],
                Timeout = TimeSpan.FromMilliseconds(timeoutMs),
                MaxConsecutiveFailures = 2,
            }
        );

    private const string Ready =
        "import sys; print('{\"event\":\"ready\",\"protocol\":1}', flush=True); ";

    private static async Task<string> CodeOf(Func<Task> run)
    {
        var raised = await Assert.ThrowsAsync<WorkerException>(run);
        return raised.Code;
    }

    [Fact]
    public async Task 띄우고_ping에_답한다()
    {
        await using var worker = RealWorker();

        await worker.PingAsync();
    }

    [Fact]
    public async Task IFC를_점검한다()
    {
        await using var worker = RealWorker();

        var metadata = await worker.InspectAsync(RepoPaths.ThreeElementsFixture);

        Assert.Equal("IFC4", metadata.Schema);
        Assert.Equal(3, metadata.ProductCount);
        Assert.False(metadata.HasWorkSchedule);
        Assert.Empty(metadata.DuplicateGlobalIds);
    }

    [Fact]
    public async Task 워커가_낸_오류_코드를_그대로_옮긴다()
    {
        await using var worker = RealWorker();

        var code = await CodeOf(() => worker.InspectAsync(Path.Combine(RepoPaths.Root, "없다.ifc")));

        Assert.Equal("worker.file.not-found", code);
    }

    [Fact]
    public async Task 일정을_IFC로_쓰고_다시_읽는다()
    {
        await using var worker = RealWorker();
        var output = Path.Combine(
            Directory.CreateTempSubdirectory("bim4d-export-").FullName,
            "out.ifc"
        );
        const string schedule = """
            {
              "scheduleId": "mock",
              "name": "왕복",
              "schemaVersion": 3,
              "models": [{ "modelRef": "three-elements-ifc4.ifc" }],
              "tasks": [
                { "taskId": "T001", "name": "슬래브", "start": "2026-03-02", "finish": "2026-03-06" }
              ],
              "dependencies": [],
              "assignments": [
                {
                  "taskId": "T001",
                  "modelRef": "three-elements-ifc4.ifc",
                  "productGlobalId": "2YsHnV6bk3PgZdL9uCxWtM",
                  "operation": "CONSTRUCT"
                }
              ]
            }
            """;

        var written = await worker.ExportScheduleAsync(
            RepoPaths.ThreeElementsFixture,
            output,
            schedule
        );
        var read = await worker.ImportScheduleAsync(output);

        Assert.Equal(1, written.TaskCount);
        Assert.Equal(0, written.SkippedAssignments);
        // 셸은 일정을 해석하지 않는다. 옮기기만 하고 검증은 웹의 parseSchedule이 한다.
        Assert.Contains("\"T001\"", read, StringComparison.Ordinal);
        Assert.Contains("2026-03-02", read, StringComparison.Ordinal);
    }

    [Fact]
    public async Task 한글이_든_응답도_깨지지_않는다()
    {
        // Windows 기본 코드 페이지로 두면 여기서 깨진다. 규약은 UTF-8이다 (ADR-0009).
        await using var worker = RealWorker();

        var code = await CodeOf(
            () => worker.InspectAsync(Path.Combine(RepoPaths.Root, "한글이름.ifc"))
        );

        Assert.Equal("worker.file.not-found", code);
    }

    [Fact]
    public async Task 마감을_넘기면_프로세스를_죽이고_알린다()
    {
        await using var worker = FakeWorker(Ready + "sys.stdin.read()");

        Assert.Equal("worker.timeout", await CodeOf(() => worker.PingAsync()));
    }

    [Fact]
    public async Task 워커가_죽으면_크래시로_알린다()
    {
        await using var worker = FakeWorker(Ready + "sys.stdin.readline(); sys.exit(9)");

        Assert.Equal("worker.crashed", await CodeOf(() => worker.PingAsync()));
    }

    [Fact]
    public async Task 이어서_죽으면_더_띄우지_않는다()
    {
        await using var worker = FakeWorker(Ready + "sys.stdin.readline(); sys.exit(9)");

        await CodeOf(() => worker.PingAsync());
        await CodeOf(() => worker.PingAsync());

        // 부팅 루프를 만들지 않는다. 사람이 볼 수 있게 멈춘다.
        Assert.Equal("worker.unavailable", await CodeOf(() => worker.PingAsync()));
    }

    [Fact]
    public async Task 규약_버전이_다르면_말하지_않는다()
    {
        await using var worker = FakeWorker(
            "import sys; print('{\"event\":\"ready\",\"protocol\":999}', flush=True); sys.stdin.read()"
        );

        Assert.Equal("worker.protocol.mismatch", await CodeOf(() => worker.PingAsync()));
    }

    [Fact]
    public async Task stdout에_JSON이_아닌_줄이_섞이면_놓는다()
    {
        // 가짜 워커는 stdout 인코딩을 맞추지 않는다. 한글을 쓰면 인코딩에서 먼저 죽어
        // 크래시로 보인다. 여기서 보려는 것은 "JSON이 아닌 줄"이므로 ASCII로 적는다.
        await using var worker = FakeWorker(
            "import sys; print('not json', flush=True); sys.stdin.read()"
        );

        Assert.Equal("worker.protocol.broken", await CodeOf(() => worker.PingAsync()));
    }

    [Fact]
    public async Task 실행_파일이_없으면_알린다()
    {
        await using var worker = new StdioIfcWorker(
            new StdioIfcWorkerOptions
            {
                Command = "this-command-does-not-exist",
                Arguments = [],
                Timeout = TimeSpan.FromSeconds(2),
            }
        );

        Assert.Equal("worker.spawn-failed", await CodeOf(() => worker.PingAsync()));
    }

    [Fact]
    public async Task 끝낸_뒤에는_부르지_않는다()
    {
        var worker = RealWorker();
        await worker.PingAsync();

        await worker.DisposeAsync();

        await Assert.ThrowsAsync<ObjectDisposedException>(() => worker.PingAsync());
    }
}
