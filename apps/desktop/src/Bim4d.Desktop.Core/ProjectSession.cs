namespace Bim4d.Desktop.Core;

/// <summary>
/// 지금 열려 있는 프로젝트 하나 (ADR-0013).
/// </summary>
/// <remarks>
/// 창이 아니라 여기에 둔다. 저장할 자리를 아는가, 고친 것이 있는가, 어느 답을 기다리는가는
/// 전부 창을 띄우지 않고 시험할 수 있어야 하는 판단이다.
///
/// 열린 모델도 여기서 센다. 저장할 때 무엇을 적어야 하는지는 셸만 안다 — 웹은 파일 경로를
/// 모르고 fingerprint도 우리가 잰다.
/// </remarks>
public sealed class ProjectSession
{
    private readonly Dictionary<string, ProjectModel> _models = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<string> _unbound = [];
    private readonly Func<string> _newRequestId;

    private string? _awaitedRequestId;

    public ProjectSession(Func<string>? newRequestId = null)
    {
        _newRequestId = newRequestId ?? (() => Guid.NewGuid().ToString("n"));
    }

    /// <summary>저장할 자리. 한 번도 저장하지 않았으면 없다.</summary>
    public string? Path { get; private set; }

    /// <summary>저장하지 않은 변경이 있다.</summary>
    public bool IsDirty { get; private set; }

    /// <summary>프로젝트에 적을 모델들. 이름 순서는 신경 쓰지 않는다.</summary>
    public IReadOnlyList<ProjectModel> Models => [.. _models.Values];

    /// <summary>열 때 찾지 못한 모델의 <c>modelRef</c>. 웹이 표시에 쓴다.</summary>
    public IReadOnlyList<string> Unbound => _unbound;

    /// <summary>창 제목. 저장하지 않은 변경은 별표로 알린다.</summary>
    public string WindowTitle
    {
        get
        {
            var name = Path is null ? "제목 없음" : System.IO.Path.GetFileNameWithoutExtension(Path);
            return $"{(IsDirty ? "*" : string.Empty)}{name} — BIM 4D Viewer";
        }
    }

    /// <summary>
    /// 연 모델을 센다.
    /// </summary>
    /// <remarks>
    /// <c>modelRef</c>는 파일 이름이다. 웹이 그 이름으로 일정과 모델을 묶는다 (ADR-0008).
    /// 같은 이름을 다시 열면 새 것이 이긴다 — 사용자가 방금 고른 파일이 정본이다.
    /// </remarks>
    public void AddModel(string path, string? fingerprint = null, string? schema = null)
    {
        var full = System.IO.Path.GetFullPath(path);
        var modelRef = System.IO.Path.GetFileName(full);

        _models[modelRef] = new ProjectModel(modelRef, full, null, fingerprint, schema);
        _unbound.Remove(modelRef);
        IsDirty = true;
    }

    /// <summary>찾지 못한 모델을 적어 둔다. 연결은 지우지 않는다 (ADR-0008).</summary>
    public void AddUnbound(string modelRef)
    {
        if (!_unbound.Contains(modelRef, StringComparer.OrdinalIgnoreCase))
        {
            _unbound.Add(modelRef);
        }
    }

    /// <summary>사용자가 무엇을 고쳤다. 창 제목이 그것을 알린다.</summary>
    public void MarkDirty() => IsDirty = true;

    /// <summary>
    /// 저장을 시작한다. 웹에 물을 <c>requestId</c>를 돌려준다.
    /// </summary>
    /// <remarks>
    /// 저장이 겹치면 마지막 물음의 답만 받는다. 오래된 답으로 새 파일을 쓰지 않기 위해서다.
    /// </remarks>
    public string BeginSave()
    {
        _awaitedRequestId = _newRequestId();
        return _awaitedRequestId;
    }

    /// <summary>이 답을 기다리고 있었나.</summary>
    public bool IsAwaited(string? requestId) =>
        requestId is not null && requestId == _awaitedRequestId;

    /// <summary>저장을 마쳤다.</summary>
    public void Saved(string path)
    {
        Path = System.IO.Path.GetFullPath(path);
        IsDirty = false;
        _awaitedRequestId = null;
    }

    /// <summary>
    /// 연 프로젝트를 이 세션으로 삼는다.
    /// </summary>
    /// <param name="path">프로젝트 파일.</param>
    /// <param name="found">찾은 모델들. 지목해서 찾은 것이면 새 경로가 담긴다.</param>
    /// <param name="unbound">찾지 못한 모델의 <c>modelRef</c>.</param>
    public void Opened(
        string path,
        IEnumerable<ProjectModel> found,
        IEnumerable<string> unbound
    )
    {
        _models.Clear();
        _unbound.Clear();

        foreach (var model in found)
        {
            _models[model.ModelRef] = model;
        }
        foreach (var modelRef in unbound)
        {
            AddUnbound(modelRef);
        }

        Path = System.IO.Path.GetFullPath(path);
        IsDirty = false;
        _awaitedRequestId = null;
    }

    /// <summary>새 프로젝트. 열린 것을 전부 잊는다.</summary>
    public void Reset()
    {
        _models.Clear();
        _unbound.Clear();
        Path = null;
        IsDirty = false;
        _awaitedRequestId = null;
    }
}
