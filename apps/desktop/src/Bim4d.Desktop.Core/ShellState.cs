using System.Text.Json;
using System.Text.Json.Serialization;

namespace Bim4d.Desktop.Core;

/// <summary>
/// 셸이 쓰는 자리들.
/// </summary>
/// <remarks>
/// 저장 위치를 코드 곳곳에서 만들지 않는다. 시험할 때 뿌리를 갈아 끼울 수 있어야 하므로
/// 뿌리를 받아 둔다.
/// </remarks>
public sealed class AppPaths
{
    public AppPaths(string root)
    {
        Root = root;
    }

    /// <summary>기본 자리는 <c>%APPDATA%\Bim4dViewer</c>다.</summary>
    public static AppPaths Default() =>
        new(
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Bim4dViewer"
            )
        );

    public string Root { get; }

    public string SettingsFile => Path.Combine(Root, "settings.json");

    public string RecentProjectsFile => Path.Combine(Root, "recent.json");

    public string LogDirectory => Path.Combine(Root, "logs");

    public void EnsureCreated()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(LogDirectory);
    }
}

/// <summary>셸 설정. 사람이 손으로 고칠 수 있는 값만 담는다.</summary>
public sealed record ShellSettings
{
    /// <summary>Worker를 띄울 때 쓰는 실행 파일.</summary>
    [JsonPropertyName("pythonCommand")]
    public string PythonCommand { get; init; } = "python";

    /// <summary>Worker 요청 하나의 마감(초).</summary>
    [JsonPropertyName("workerTimeoutSeconds")]
    public int WorkerTimeoutSeconds { get; init; } = 120;

    /// <summary>최근 프로젝트를 몇 개까지 들고 있을지.</summary>
    [JsonPropertyName("recentProjectLimit")]
    public int RecentProjectLimit { get; init; } = 10;
}

/// <summary>최근에 연 파일 하나.</summary>
public sealed record RecentProject(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("openedAt")] DateTimeOffset OpenedAt
);

/// <summary>
/// JSON 파일 하나를 읽고 쓰는 자리.
/// </summary>
/// <remarks>
/// 읽기는 실패해도 앱을 멈추지 않는다. 설정 파일이 깨졌다고 프로그램이 뜨지 않으면
/// 사용자가 고칠 길이 없다. 대신 기본값으로 시작하고 그 사실을 로그에 남긴다.
/// </remarks>
public static class JsonStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static T Read<T>(string path, T fallback)
    {
        if (!File.Exists(path))
        {
            return fallback;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options) ?? fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    public static void Write<T>(string path, T value)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, JsonSerializer.Serialize(value, Options));
    }
}

/// <summary>
/// 최근에 연 파일 목록.
/// </summary>
/// <remarks>
/// 같은 파일을 다시 열면 줄이 늘지 않고 맨 앞으로 온다. 목록은 최근 것이 앞이다.
/// </remarks>
public sealed class RecentProjects
{
    private readonly string _file;
    private readonly int _limit;

    public RecentProjects(string file, int limit)
    {
        _file = file;
        _limit = Math.Max(1, limit);
    }

    public IReadOnlyList<RecentProject> Read() =>
        JsonStore.Read<List<RecentProject>>(_file, []);

    /// <summary>연 파일을 맨 앞에 놓는다. 넘치면 오래된 것부터 버린다.</summary>
    public IReadOnlyList<RecentProject> Add(string path, DateTimeOffset openedAt)
    {
        var full = Path.GetFullPath(path);

        var kept = Read()
            // 경로 비교는 Windows에서 대소문자를 가리지 않는다.
            .Where(entry => !string.Equals(entry.Path, full, StringComparison.OrdinalIgnoreCase))
            .ToList();

        kept.Insert(0, new RecentProject(full, openedAt));

        var trimmed = kept.Take(_limit).ToList();
        JsonStore.Write(_file, trimmed);
        return trimmed;
    }

    /// <summary>사라진 파일을 목록에서 걷는다. 열 수 없는 줄을 보여 주지 않는다.</summary>
    public IReadOnlyList<RecentProject> Prune()
    {
        var kept = Read().Where(entry => File.Exists(entry.Path)).ToList();
        JsonStore.Write(_file, kept);
        return kept;
    }
}
