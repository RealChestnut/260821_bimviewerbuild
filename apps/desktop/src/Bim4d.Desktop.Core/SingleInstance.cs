namespace Bim4d.Desktop.Core;

/// <summary>
/// 이 앱이 한 번만 뜨게 한다.
/// </summary>
/// <remarks>
/// WebView2는 사용자 데이터 폴더를 잠근다. 두 번째 인스턴스가 같은 폴더를 열려 들면
/// <c>0x800700AA</c>(리소스 사용 중)로 죽는다. 사용자가 아이콘을 두 번 누르는 일은 흔하므로
/// 그것을 오류로 만들지 않는다.
///
/// 이름은 사용자마다 다르다. 한 PC를 여러 사람이 쓸 때 서로를 막지 않기 위해서다 —
/// 각자의 WebView2 폴더도 서로 다르다.
/// </remarks>
public sealed class SingleInstance : IDisposable
{
    private readonly Mutex? _mutex;

    private SingleInstance(Mutex? mutex, bool isOwner)
    {
        _mutex = mutex;
        IsOwner = isOwner;
    }

    /// <summary>이 프로세스가 첫 번째다.</summary>
    public bool IsOwner { get; }

    /// <summary>이름을 만든다. 사용자마다 다르다.</summary>
    public static string NameFor(string user) => $@"Local\Bim4dViewer.{user}";

    /// <summary>
    /// 자리를 잡아 본다. 이미 누가 있으면 <see cref="IsOwner"/>가 <c>false</c>다.
    /// </summary>
    /// <remarks>
    /// 잠금을 기다리지 않고 <c>createdNew</c>로 판정한다. 기다리는 방식은 같은 스레드가
    /// 다시 들어올 때 통과해 버려 한 프로세스 안에서 시험할 수 없다.
    ///
    /// 앞선 인스턴스가 정리 없이 죽었으면 그 이름의 커널 객체도 함께 사라진다. 그때는
    /// 우리가 새로 만든 것이 되어 주인이 된다 — 죽은 앱이 자리를 영영 잡고 있지 않는다.
    /// </remarks>
    public static SingleInstance Acquire(string? name = null)
    {
        var mutex = new Mutex(
            initiallyOwned: true,
            name ?? NameFor(Environment.UserName),
            out var createdNew
        );

        return new SingleInstance(mutex, createdNew);
    }

    public void Dispose()
    {
        if (_mutex is null)
        {
            return;
        }

        if (IsOwner)
        {
            try
            {
                _mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                // 다른 스레드가 잡고 있었다. 놓지 못해도 프로세스가 끝나면 풀린다.
            }
        }

        _mutex.Dispose();
    }
}
