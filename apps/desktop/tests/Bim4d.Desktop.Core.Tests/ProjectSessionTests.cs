namespace Bim4d.Desktop.Core.Tests;

/// <summary>
/// 지금 열려 있는 프로젝트 (ADR-0013).
/// </summary>
/// <remarks>
/// 저장할 자리를 아는가, 고친 것이 있는가, 어느 답을 기다리는가. 창을 띄우지 않고 시험한다.
/// </remarks>
public sealed class ProjectSessionTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-session-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string Path(string name) => System.IO.Path.Combine(_root, name);

    [Fact]
    public void 처음에는_저장할_자리가_없다()
    {
        var session = new ProjectSession();

        Assert.Null(session.Path);
        Assert.False(session.IsDirty);
        Assert.Equal("제목 없음 — BIM 4D Viewer", session.WindowTitle);
    }

    [Fact]
    public void 저장하지_않은_변경을_제목이_알린다()
    {
        var session = new ProjectSession();
        session.Saved(Path("A동.bim4d"));

        Assert.Equal("A동 — BIM 4D Viewer", session.WindowTitle);

        session.MarkDirty();

        Assert.Equal("*A동 — BIM 4D Viewer", session.WindowTitle);
    }

    [Fact]
    public void 모델을_열면_고친_것이_된다()
    {
        // 모델을 연 것도 프로젝트의 변경이다. 닫을 때 물어야 한다.
        var session = new ProjectSession();

        session.AddModel(Path("구조.ifc"), fingerprint: "9f2b", schema: "IFC4");

        Assert.True(session.IsDirty);
        Assert.Single(session.Models);
        Assert.Equal("구조.ifc", session.Models[0].ModelRef);
        Assert.Equal("9f2b", session.Models[0].Fingerprint);
    }

    [Fact]
    public void modelRef는_파일_이름이다()
    {
        // 웹이 그 이름으로 일정과 모델을 묶는다 (ADR-0008).
        var session = new ProjectSession();

        session.AddModel(System.IO.Path.Combine(_root, "깊은", "폴더", "구조.ifc"));

        Assert.Equal("구조.ifc", session.Models[0].ModelRef);
    }

    [Fact]
    public void 같은_이름을_다시_열면_새_것이_이긴다()
    {
        // 사용자가 방금 고른 파일이 정본이다.
        var session = new ProjectSession();
        session.AddModel(Path("구조.ifc"), fingerprint: "옛것");
        session.AddModel(System.IO.Path.Combine(_root, "새폴더", "구조.ifc"), fingerprint: "새것");

        Assert.Single(session.Models);
        Assert.Equal("새것", session.Models[0].Fingerprint);
    }

    [Fact]
    public void 저장하면_고친_것이_사라진다()
    {
        var session = new ProjectSession();
        session.MarkDirty();

        session.Saved(Path("A동.bim4d"));

        Assert.False(session.IsDirty);
        Assert.EndsWith("A동.bim4d", session.Path);
    }

    [Fact]
    public void 기다리던_답만_받는다()
    {
        // 저장이 겹치면 오래된 답으로 새 파일을 쓰지 않는다.
        var session = new ProjectSession();

        var first = session.BeginSave();
        var second = session.BeginSave();

        Assert.False(session.IsAwaited(first));
        Assert.True(session.IsAwaited(second));
    }

    [Fact]
    public void 묻지_않았으면_어떤_답도_받지_않는다()
    {
        var session = new ProjectSession();

        Assert.False(session.IsAwaited("아무거나"));
        Assert.False(session.IsAwaited(null));
    }

    [Fact]
    public void 저장을_마치면_같은_답을_두_번_받지_않는다()
    {
        var session = new ProjectSession();
        var requestId = session.BeginSave();
        session.Saved(Path("A동.bim4d"));

        Assert.False(session.IsAwaited(requestId));
    }

    [Fact]
    public void 연_프로젝트가_세션이_된다()
    {
        var session = new ProjectSession();
        session.MarkDirty();

        session.Opened(
            Path("A동.bim4d"),
            [new ProjectModel("구조.ifc", Path("구조.ifc"))],
            ["설비.ifc"]
        );

        Assert.False(session.IsDirty);
        Assert.Single(session.Models);
        Assert.Equal(["설비.ifc"], session.Unbound);
    }

    [Fact]
    public void 못_찾은_모델은_두_번_적지_않는다()
    {
        var session = new ProjectSession();

        session.AddUnbound("설비.ifc");
        session.AddUnbound("설비.ifc");

        Assert.Single(session.Unbound);
    }

    [Fact]
    public void 못_찾았던_모델을_지목하면_목록에서_빠진다()
    {
        var session = new ProjectSession();
        session.AddUnbound("설비.ifc");

        session.AddModel(Path("설비.ifc"));

        Assert.Empty(session.Unbound);
        Assert.Single(session.Models);
    }

    [Fact]
    public void 새_프로젝트는_열린_것을_전부_잊는다()
    {
        var session = new ProjectSession();
        session.AddModel(Path("구조.ifc"));
        session.AddUnbound("설비.ifc");
        session.Saved(Path("A동.bim4d"));

        session.Reset();

        Assert.Empty(session.Models);
        Assert.Empty(session.Unbound);
        Assert.Null(session.Path);
        Assert.False(session.IsDirty);
    }
}
