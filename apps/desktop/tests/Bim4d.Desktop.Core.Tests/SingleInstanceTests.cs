namespace Bim4d.Desktop.Core.Tests;

/// <summary>
/// 앱이 한 번만 뜨게 한다.
/// </summary>
/// <remarks>
/// WebView2가 사용자 데이터 폴더를 잠그므로 두 번째 인스턴스는 <c>0x800700AA</c>로 죽는다.
/// 실제로 그 오류를 받고 나서 넣은 잠금이다.
/// </remarks>
public sealed class SingleInstanceTests
{
    /// <summary>시험끼리 부딪히지 않게 이름을 매번 새로 만든다.</summary>
    private static string NewName() => $@"Local\Bim4dViewer.test.{Guid.NewGuid():n}";

    [Fact]
    public void 첫_번째가_주인이다()
    {
        var name = NewName();

        using var first = SingleInstance.Acquire(name);

        Assert.True(first.IsOwner);
    }

    [Fact]
    public void 두_번째는_주인이_아니다()
    {
        var name = NewName();
        using var first = SingleInstance.Acquire(name);

        using var second = SingleInstance.Acquire(name);

        Assert.False(second.IsOwner);
    }

    [Fact]
    public void 첫_번째가_끝나면_자리가_빈다()
    {
        var name = NewName();
        var first = SingleInstance.Acquire(name);
        Assert.True(first.IsOwner);
        first.Dispose();

        using var next = SingleInstance.Acquire(name);

        Assert.True(next.IsOwner);
    }

    [Fact]
    public void 이름이_다르면_서로_막지_않는다()
    {
        using var one = SingleInstance.Acquire(NewName());

        using var other = SingleInstance.Acquire(NewName());

        Assert.True(one.IsOwner);
        Assert.True(other.IsOwner);
    }

    [Fact]
    public void 이름은_사용자마다_다르다()
    {
        // 한 PC를 여럿이 쓸 때 서로를 막지 않는다. 각자의 WebView2 폴더도 서로 다르다.
        Assert.NotEqual(SingleInstance.NameFor("갑"), SingleInstance.NameFor("을"));
        Assert.Contains("갑", SingleInstance.NameFor("갑"));
    }

    [Fact]
    public void 주인이_아니어도_정리는_안전하다()
    {
        var name = NewName();
        using var first = SingleInstance.Acquire(name);
        var second = SingleInstance.Acquire(name);

        var failure = Record.Exception(second.Dispose);

        Assert.Null(failure);
    }
}

/// <summary>WebView2가 자기 데이터를 두는 자리 (0x800700AA를 겪고 옮겼다).</summary>
public sealed class WebViewDirectoryTests
{
    [Fact]
    public void 설치_폴더가_아니라_사용자_자리에_둔다()
    {
        // Program Files에 깐 설치본을 일반 계정으로 쓰면 실행 파일 옆에는 쓰지 못한다.
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        Assert.StartsWith(local, AppPaths.WebViewDirectory, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(AppContext.BaseDirectory, AppPaths.WebViewDirectory);
    }

    [Fact]
    public void 로밍이_아니라_로컬이다()
    {
        // 캐시라 사람을 따라 다른 PC로 옮겨 다닐 값이 아니다. 설정과 로그는 로밍에 둔다.
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        Assert.DoesNotContain(roaming, AppPaths.WebViewDirectory);
        Assert.StartsWith(roaming, AppPaths.Default().Root, StringComparison.OrdinalIgnoreCase);
    }
}
