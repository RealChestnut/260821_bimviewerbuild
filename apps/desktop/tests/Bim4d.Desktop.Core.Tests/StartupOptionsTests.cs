namespace Bim4d.Desktop.Core.Tests;

public sealed class StartupOptionsTests
{
    [Fact]
    public void 아무것도_없으면_빈_창이다()
    {
        var options = StartupOptions.Parse([]);

        Assert.Null(options.OpenPath);
        Assert.Null(options.ExitAfter);
    }

    [Fact]
    public void 열_파일을_받는다()
    {
        Assert.Equal("C:/a.ifc", StartupOptions.Parse(["--open", "C:/a.ifc"]).OpenPath);
    }

    [Fact]
    public void 옵션이_아닌_인자도_열_파일로_본다()
    {
        // 파일 연결과 끌어다 놓기가 그렇게 준다.
        Assert.Equal("C:/a.ifc", StartupOptions.Parse(["C:/a.ifc"]).OpenPath);
    }

    [Fact]
    public void 스스로_끝낼_시간을_받는다()
    {
        var options = StartupOptions.Parse(["--exit-after", "1.5"]);

        Assert.Equal(TimeSpan.FromSeconds(1.5), options.ExitAfter);
    }

    [Fact]
    public void 값이_없는_옵션은_넘긴다()
    {
        var options = StartupOptions.Parse(["--open"]);

        Assert.Null(options.OpenPath);
    }

    [Fact]
    public void 숫자가_아닌_시간은_넘긴다()
    {
        Assert.Null(StartupOptions.Parse(["--exit-after", "곧"]).ExitAfter);
    }

    [Fact]
    public void 파일은_먼저_온_것을_쓴다()
    {
        var options = StartupOptions.Parse(["--open", "C:/a.ifc", "C:/b.ifc"]);

        Assert.Equal("C:/a.ifc", options.OpenPath);
    }
}
