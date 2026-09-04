namespace Bim4d.Desktop.Core;

/// <summary>셸이 무엇을 어디서 찾는지 (ADR-0011).</summary>
public enum LayoutKind
{
    /// <summary>설치본. 실행 파일 옆에 <c>web</c> · <c>ifc-worker</c> · <c>python</c>이 있다.</summary>
    Installed,

    /// <summary>개발. 저장소 안에서 돈다.</summary>
    Repository,
}

/// <summary>배치를 고르지 못했다. 무엇을 어디서 찾았는지 말한다.</summary>
public sealed class InstallLayoutException : Exception, ICodedError
{
    public InstallLayoutException(string message)
        : base(message) { }

    public string Code => "shell.layout.unknown";
}

/// <summary>
/// 웹 자산과 워커와 Python이 어디 있는지 (ADR-0011).
/// </summary>
/// <remarks>
/// 판단이라 창 밖에 둔다. 창을 띄우지 않고 시험할 수 있어야 한다.
///
/// 고르는 기준은 <c>web</c> 폴더 하나다. 세 폴더를 따로 보면 반쯤 설치된 상태에서 배치가
/// 섞이고, 어떤 조합으로 돌고 있는지 알 수 없게 된다.
/// </remarks>
public sealed class InstallLayout
{
    /// <summary>저장소 뿌리를 알아보는 표식.</summary>
    private const string RepositoryMarker = "pnpm-workspace.yaml";

    private InstallLayout(
        LayoutKind kind,
        string webRoot,
        string workerDirectory,
        string pythonCommand
    )
    {
        Kind = kind;
        WebRoot = webRoot;
        WorkerDirectory = workerDirectory;
        PythonCommand = pythonCommand;
    }

    public LayoutKind Kind { get; }

    /// <summary>빌드한 뷰어 자산 폴더. WebView2가 <c>app.local</c>로 매핑한다 (ADR-0010).</summary>
    public string WebRoot { get; }

    /// <summary><c>ifc_worker</c> 패키지의 부모.</summary>
    public string WorkerDirectory { get; }

    /// <summary>워커를 띄울 실행 파일. 설치본은 동봉한 Python, 개발은 PATH의 것이다.</summary>
    public string PythonCommand { get; }

    /// <summary>
    /// 고른 배치에서 아직 없는 자리들.
    /// </summary>
    /// <remarks>
    /// 배치를 고르는 것과 다 갖춰졌는지는 다른 질문이다. 설치가 덜 됐거나 개발 중에
    /// <c>pnpm build</c>를 아직 하지 않았을 수 있다. 그것 때문에 앱이 뜨지 않으면 사용자가
    /// 고칠 길이 없으므로, 뜨되 무엇이 없는지 기록에 남긴다.
    /// </remarks>
    public IReadOnlyList<string> MissingPaths
    {
        get
        {
            var missing = new List<string>();
            if (!Directory.Exists(WebRoot))
            {
                missing.Add(WebRoot);
            }
            if (!Directory.Exists(Path.Combine(WorkerDirectory, "ifc_worker")))
            {
                missing.Add(Path.Combine(WorkerDirectory, "ifc_worker"));
            }
            // 개발 배치의 python은 PATH에서 찾으므로 경로로 확인할 수 없다.
            if (Kind == LayoutKind.Installed && !File.Exists(PythonCommand))
            {
                missing.Add(PythonCommand);
            }
            return missing;
        }
    }

    /// <summary>
    /// 실행 파일이 있는 자리에서 배치를 고른다.
    /// </summary>
    /// <exception cref="InstallLayoutException">
    /// 설치본도 저장소도 아니다. 조용히 없는 경로를 돌려주지 않는다. 그러면 WebView2가 빈
    /// 화면을 띄우고 사용자는 무엇이 잘못됐는지 알 수 없다.
    /// </exception>
    public static InstallLayout Resolve(string baseDirectory)
    {
        var beside = Path.Combine(baseDirectory, "web");
        if (Directory.Exists(beside))
        {
            return new InstallLayout(
                LayoutKind.Installed,
                beside,
                Path.Combine(baseDirectory, "ifc-worker"),
                Path.Combine(baseDirectory, "python", "python.exe")
            );
        }

        var repository = FindRepositoryRoot(baseDirectory);
        if (repository is not null)
        {
            return new InstallLayout(
                LayoutKind.Repository,
                Path.Combine(repository, "apps", "viewer-web", "dist"),
                Path.Combine(repository, "services", "ifc-worker"),
                "python"
            );
        }

        throw new InstallLayoutException(
            $"자산을 찾지 못했다. 설치본이면 '{beside}'가 있어야 하고, "
                + $"저장소 안이면 위쪽 어딘가에 '{RepositoryMarker}'가 있어야 한다."
        );
    }

    /// <summary>기본은 실행 파일이 있는 자리다.</summary>
    public static InstallLayout Default() => Resolve(AppContext.BaseDirectory);

    /// <summary>
    /// 설정이 적은 Python이 배치가 고른 것을 이긴다.
    /// </summary>
    /// <remarks>
    /// 기본값은 비어 있고 그것은 "배치에서 고른다"는 뜻이다 (ADR-0011). 사람이 다른 Python을
    /// 가리키고 싶으면 설정 파일에 적으면 된다.
    /// </remarks>
    public string PythonCommandOrDefault(string? configured) =>
        string.IsNullOrWhiteSpace(configured) ? PythonCommand : configured;

    private static string? FindRepositoryRoot(string from)
    {
        var current = new DirectoryInfo(from);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, RepositoryMarker)))
            {
                return current.FullName;
            }
            current = current.Parent;
        }

        return null;
    }
}
