using System.Collections.Concurrent;
using System.Text.Json.Nodes;

namespace Bim4d.Desktop.Core;

/// <summary>
/// 웹이 읽을 수 있는 파일의 목록.
/// </summary>
/// <remarks>
/// 사용자가 그 세션에서 실제로 고른 파일만 담는다. 목록에 없는 id는 열어 주지 않는다.
/// 웹이 임의의 경로를 물어 읽는 길을 만들지 않기 위해서다 (ADR-0010).
///
/// 폴더를 통째로 노출하지 않는 것도 같은 이유다. 사용자는 파일을 아무 데나 둔다.
/// </remarks>
public sealed class ModelBridge
{
    /// <summary>모델을 내주는 가상 호스트. 자산(app.local)과 가른다.</summary>
    public const string Host = "model.local";

    private readonly ConcurrentDictionary<string, string> _allowed = new();
    private readonly Func<string> _newId;

    public ModelBridge(Func<string>? newId = null)
    {
        _newId = newId ?? (() => Guid.NewGuid().ToString("n"));
    }

    /// <summary>파일 하나를 웹에 열어 주고 그 주소를 돌려준다.</summary>
    public (string Id, string Url) Publish(string path)
    {
        var full = Path.GetFullPath(path);
        var id = _newId();
        _allowed[id] = full;
        return (id, UrlFor(id));
    }

    public static string UrlFor(string id) => $"https://{Host}/{id}";

    /// <summary>주소에서 열어 줄 파일을 찾는다. 허용 목록에 없으면 <c>null</c>이다.</summary>
    public string? Resolve(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed))
        {
            return null;
        }

        if (!string.Equals(parsed.Host, Host, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var id = parsed.AbsolutePath.Trim('/');
        if (id.Length == 0 || !_allowed.TryGetValue(id, out var path))
        {
            return null;
        }

        // 목록에 넣은 뒤 파일이 사라졌을 수 있다. 없는 파일을 연 것처럼 답하지 않는다.
        return File.Exists(path) ? path : null;
    }

    /// <summary>세션이 끝나면 목록도 사라진다.</summary>
    public void Clear() => _allowed.Clear();

    public int Count => _allowed.Count;
}

/// <summary>
/// 셸과 웹이 주고받는 말.
/// </summary>
/// <remarks>
/// 한 방향으로 JSON 하나다. 모양의 정본은 ADR-0010이며 웹 쪽
/// <c>shellBridgeComponent.ts</c>가 같은 이름을 읽는다.
/// </remarks>
public static class ShellMessages
{
    public static string ModelOpened(string id, string name) =>
        new JsonObject
        {
            ["kind"] = "shell/model-opened",
            ["id"] = id,
            ["name"] = name,
            ["url"] = ModelBridge.UrlFor(id),
        }.ToJsonString();

    public static string ScheduleOpened(string name, string scheduleJson) =>
        new JsonObject
        {
            ["kind"] = "shell/schedule-opened",
            ["name"] = name,
            ["schedule"] = JsonNode.Parse(scheduleJson),
        }.ToJsonString();

    /// <summary>웹이 보낸 줄을 읽는다. 모르는 모양이면 <c>null</c>이다.</summary>
    public static (string Kind, JsonObject Payload)? Parse(string json)
    {
        JsonObject? message;
        try
        {
            message = JsonNode.Parse(json) as JsonObject;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }

        var kind = message?["kind"]?.GetValue<string>();
        return kind is null ? null : (kind, message!);
    }
}
