using System.Text.Json;

namespace Bim4d.Desktop.Core.Tests;

public sealed class ModelBridgeTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("bim4d-bridge-").FullName;

    private string TouchFile(string name = "a.ifc")
    {
        var path = Path.Combine(_root, name);
        File.WriteAllText(path, "ISO-10303-21;");
        return path;
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void 연_파일만_열어_준다()
    {
        var bridge = new ModelBridge();
        var path = TouchFile();

        var (_, url) = bridge.Publish(path);

        Assert.Equal(path, bridge.Resolve(url));
    }

    [Fact]
    public void 목록에_없는_id는_열어_주지_않는다()
    {
        var bridge = new ModelBridge();
        TouchFile();

        // 웹이 임의의 경로를 물어 읽는 길을 만들지 않는다 (ADR-0010).
        Assert.Null(bridge.Resolve("https://model.local/없는id"));
    }

    [Fact]
    public void 다른_호스트는_보지_않는다()
    {
        var bridge = new ModelBridge(() => "fixed");
        bridge.Publish(TouchFile());

        Assert.Null(bridge.Resolve("https://app.local/fixed"));
    }

    [Fact]
    public void 주소가_아니면_null이다()
    {
        Assert.Null(new ModelBridge().Resolve("한 줄 글"));
    }

    [Fact]
    public void 사라진_파일은_열어_주지_않는다()
    {
        var bridge = new ModelBridge();
        var path = TouchFile();
        var (_, url) = bridge.Publish(path);
        File.Delete(path);

        // 없는 파일을 연 것처럼 답하지 않는다.
        Assert.Null(bridge.Resolve(url));
    }

    [Fact]
    public void 파일마다_다른_id를_준다()
    {
        var bridge = new ModelBridge();

        var first = bridge.Publish(TouchFile("a.ifc"));
        var second = bridge.Publish(TouchFile("b.ifc"));

        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(2, bridge.Count);
    }

    [Fact]
    public void 비우면_아무것도_열어_주지_않는다()
    {
        var bridge = new ModelBridge();
        var (_, url) = bridge.Publish(TouchFile());

        bridge.Clear();

        // 세션이 끝나면 목록도 사라진다.
        Assert.Null(bridge.Resolve(url));
    }
}

public sealed class ShellMessagesTests
{
    [Fact]
    public void 모델을_열었다는_말에_주소를_함께_싣는다()
    {
        using var parsed = JsonDocument.Parse(ShellMessages.ModelOpened("abc", "벽체.ifc"));

        var root = parsed.RootElement;
        Assert.Equal("shell/model-opened", root.GetProperty("kind").GetString());
        Assert.Equal("벽체.ifc", root.GetProperty("name").GetString());
        Assert.Equal("https://model.local/abc", root.GetProperty("url").GetString());
    }

    [Fact]
    public void 일정은_JSON_그대로_싣는다()
    {
        // 셸은 일정을 해석하지 않는다. 검증은 웹의 parseSchedule이 한다.
        var message = ShellMessages.ScheduleOpened("a.ifc", """{"scheduleId":"s1","tasks":[]}""");

        using var parsed = JsonDocument.Parse(message);
        Assert.Equal(
            "s1",
            parsed.RootElement.GetProperty("schedule").GetProperty("scheduleId").GetString()
        );
    }

    [Fact]
    public void 웹이_보낸_줄을_읽는다()
    {
        var read = ShellMessages.Parse("""{"kind":"web/ready"}""");

        Assert.Equal("web/ready", read?.Kind);
    }

    [Fact]
    public void 모르는_모양은_null이다()
    {
        Assert.Null(ShellMessages.Parse("{ 깨졌다"));
        Assert.Null(ShellMessages.Parse("""{"noKind":1}"""));
    }

    [Fact]
    public void 지금_상태를_물을_때_requestId를_싣는다()
    {
        // 저장이 겹치면 어느 답이 어느 물음의 것인지 알아야 한다 (ADR-0013).
        using var parsed = JsonDocument.Parse(ShellMessages.StateRequested("a1"));

        Assert.Equal("shell/state-requested", parsed.RootElement.GetProperty("kind").GetString());
        Assert.Equal("a1", parsed.RootElement.GetProperty("requestId").GetString());
    }

    [Fact]
    public void 연_프로젝트를_값으로_싣는다()
    {
        var message = ShellMessages.ProjectOpened(
            """{"scheduleId":"s1","tasks":[]}""",
            """{"camera":{"position":[1,2,3]}}""",
            ["설비.ifc"]
        );

        using var parsed = JsonDocument.Parse(message);
        var root = parsed.RootElement;

        Assert.Equal("shell/project-opened", root.GetProperty("kind").GetString());
        // 문자열이 아니라 값으로 실어야 웹이 다시 파싱하지 않는다.
        Assert.Equal("s1", root.GetProperty("schedule").GetProperty("scheduleId").GetString());
        Assert.Equal(JsonValueKind.Object, root.GetProperty("viewerState").ValueKind);
        Assert.Equal("설비.ifc", root.GetProperty("unbound")[0].GetString());
    }

    [Fact]
    public void 일정이_없는_프로젝트도_보낸다()
    {
        using var parsed = JsonDocument.Parse(ShellMessages.ProjectOpened(null, null, []));
        var root = parsed.RootElement;

        Assert.Equal(JsonValueKind.Null, root.GetProperty("schedule").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("viewerState").ValueKind);
        Assert.Equal(0, root.GetProperty("unbound").GetArrayLength());
    }

    [Fact]
    public void 깨진_일정은_없는_것으로_보낸다()
    {
        // 셸은 일정을 열어 보지 않는다. 판정할 자리가 아니다 (ADR-0013).
        using var parsed = JsonDocument.Parse(ShellMessages.ProjectOpened("{ 깨졌다", null, []));

        Assert.Equal(JsonValueKind.Null, parsed.RootElement.GetProperty("schedule").ValueKind);
    }

    [Fact]
    public void 프로젝트를_닫았다고_알린다()
    {
        using var parsed = JsonDocument.Parse(ShellMessages.ProjectClosed());

        Assert.Equal("shell/project-closed", parsed.RootElement.GetProperty("kind").GetString());
    }
}
