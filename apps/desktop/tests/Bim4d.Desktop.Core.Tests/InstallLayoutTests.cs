namespace Bim4d.Desktop.Core.Tests;

/// <summary>
/// 배치 해석 (ADR-0011).
/// </summary>
/// <remarks>
/// 창을 띄우지 않고 시험할 수 있어야 해서 창 밖으로 옮긴 판단이다. 여기서 보는 것은 세
/// 경우다 — 설치본, 개발(저장소), 어느 쪽도 아님.
/// </remarks>
public sealed class InstallLayoutTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-layout-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string Installed()
    {
        var app = Path.Combine(_root, "app");
        Directory.CreateDirectory(Path.Combine(app, "web"));
        Directory.CreateDirectory(Path.Combine(app, "ifc-worker", "ifc_worker"));
        Directory.CreateDirectory(Path.Combine(app, "python"));
        File.WriteAllBytes(Path.Combine(app, "python", "python.exe"), []);
        return app;
    }

    /// <summary>저장소 안 깊은 곳에서 시작해도 표식을 만날 때까지 올라간다.</summary>
    private string InRepository()
    {
        var repository = Path.Combine(_root, "repo");
        Directory.CreateDirectory(repository);
        File.WriteAllText(Path.Combine(repository, "pnpm-workspace.yaml"), "packages:\n");

        var binary = Path.Combine(repository, "apps", "desktop", "src", "bin", "Debug", "net10");
        Directory.CreateDirectory(binary);
        return binary;
    }

    [Fact]
    public void 실행_파일_옆에_web이_있으면_설치본이다()
    {
        var app = Installed();

        var layout = InstallLayout.Resolve(app);

        Assert.Equal(LayoutKind.Installed, layout.Kind);
        Assert.Equal(Path.Combine(app, "web"), layout.WebRoot);
        Assert.Equal(Path.Combine(app, "ifc-worker"), layout.WorkerDirectory);
        Assert.Equal(Path.Combine(app, "python", "python.exe"), layout.PythonCommand);
    }

    [Fact]
    public void 설치본은_동봉한_Python을_쓴다()
    {
        // PATH에 기대면 Python이 깔리지 않은 PC에서 워커 없이 뜬다.
        var layout = InstallLayout.Resolve(Installed());

        Assert.True(Path.IsPathFullyQualified(layout.PythonCommand));
        Assert.True(File.Exists(layout.PythonCommand));
    }

    [Fact]
    public void web이_없으면_저장소를_찾아_올라간다()
    {
        var binary = InRepository();
        var repository = Path.Combine(_root, "repo");

        var layout = InstallLayout.Resolve(binary);

        Assert.Equal(LayoutKind.Repository, layout.Kind);
        Assert.Equal(Path.Combine(repository, "apps", "viewer-web", "dist"), layout.WebRoot);
        Assert.Equal(Path.Combine(repository, "services", "ifc-worker"), layout.WorkerDirectory);
        Assert.Equal("python", layout.PythonCommand);
    }

    [Fact]
    public void 설치본이_저장소보다_먼저다()
    {
        // 저장소 안에 게시한 설치본이 있을 수 있다. 그때는 옆에 있는 것을 쓴다.
        var repository = Path.Combine(_root, "repo");
        Directory.CreateDirectory(repository);
        File.WriteAllText(Path.Combine(repository, "pnpm-workspace.yaml"), "packages:\n");
        var published = Path.Combine(repository, "artifacts", "publish");
        Directory.CreateDirectory(Path.Combine(published, "web"));

        Assert.Equal(LayoutKind.Installed, InstallLayout.Resolve(published).Kind);
    }

    [Fact]
    public void 어느_배치도_아니면_조용히_넘어가지_않는다()
    {
        // 없는 경로를 그대로 돌려주면 WebView2가 빈 화면을 띄우고 아무것도 남지 않는다.
        var nowhere = Path.Combine(_root, "nowhere");
        Directory.CreateDirectory(nowhere);

        var failure = Assert.Throws<InstallLayoutException>(() => InstallLayout.Resolve(nowhere));

        Assert.Contains("web", failure.Message);
        Assert.Contains("pnpm-workspace.yaml", failure.Message);
        Assert.Equal("shell.layout.unknown", failure.Code);
    }

    [Fact]
    public void 실패는_코드와_기록_자리를_함께_보인다()
    {
        var nowhere = Path.Combine(_root, "nowhere2");
        Directory.CreateDirectory(nowhere);
        var failure = Record.Exception(() => InstallLayout.Resolve(nowhere))!;

        var report = ErrorReport.From(failure, "C:\\logs");

        Assert.Equal("shell.layout.unknown", report.Code);
        Assert.Contains("C:\\logs", report.ToDisplayText());
    }

    [Fact]
    public void 다_갖춰졌으면_빠진_것이_없다()
    {
        Assert.Empty(InstallLayout.Resolve(Installed()).MissingPaths);
    }

    [Fact]
    public void 자산이_없으면_그_자리를_말한다()
    {
        var app = Installed();
        var assets = Path.Combine(app, "web");
        // web은 배치를 고르는 기준이므로 고른 뒤에 지운다.
        var layout = InstallLayout.Resolve(app);
        Directory.Delete(assets);

        Assert.Contains(assets, layout.MissingPaths);
    }

    [Fact]
    public void 워커가_없으면_그_자리를_말한다()
    {
        var app = Installed();
        Directory.Delete(Path.Combine(app, "ifc-worker", "ifc_worker"));

        Assert.Contains(
            Path.Combine(app, "ifc-worker", "ifc_worker"),
            InstallLayout.Resolve(app).MissingPaths
        );
    }

    [Fact]
    public void 동봉한_Python이_없으면_그_자리를_말한다()
    {
        var app = Installed();
        File.Delete(Path.Combine(app, "python", "python.exe"));

        Assert.Contains(Path.Combine(app, "python", "python.exe"), InstallLayout.Resolve(app).MissingPaths);
    }

    [Fact]
    public void 개발_배치의_Python은_PATH에_있어_경로로_확인하지_않는다()
    {
        var layout = InstallLayout.Resolve(InRepository());

        Assert.DoesNotContain("python", layout.MissingPaths);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void 설정이_비어_있으면_배치가_고른_Python을_쓴다(string? configured)
    {
        var layout = InstallLayout.Resolve(Installed());

        Assert.Equal(layout.PythonCommand, layout.PythonCommandOrDefault(configured));
    }

    [Fact]
    public void 사람이_적은_Python이_이긴다()
    {
        var layout = InstallLayout.Resolve(Installed());

        Assert.Equal(
            "C:\\Python313\\python.exe",
            layout.PythonCommandOrDefault("C:\\Python313\\python.exe")
        );
    }
}
