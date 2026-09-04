using System.Windows;
using Bim4d.Desktop.Core;

namespace Bim4d.Desktop;

/// <summary>
/// 앱의 시작점.
/// </summary>
/// <remarks>
/// 명령줄을 읽어 창에 넘긴다. 창을 직접 띄우는 것은 <c>StartupUri</c>가 인자를 넘길 자리를
/// 주지 않기 때문이다.
/// </remarks>
public partial class App : Application
{
    private void OnStartup(object sender, StartupEventArgs args)
    {
        var options = StartupOptions.Parse(args.Args);
        try
        {
            MainWindow = new MainWindow(options);
            MainWindow.Show();
        }
        catch (Exception cause)
        {
            FailToStart(cause);
        }
    }

    /// <summary>
    /// 창을 만들지 못했다.
    /// </summary>
    /// <remarks>
    /// 창 안에서 보고할 수 없으므로 여기서 보고한다. 설치가 온전하지 않으면 자산을 찾는
    /// 단계에서 여기로 온다 (ADR-0011). 코드와 기록 자리를 함께 보인다.
    /// </remarks>
    private void FailToStart(Exception cause)
    {
        var paths = AppPaths.Default();
        paths.EnsureCreated();

        var report = ErrorReport.From(cause, paths.LogDirectory);
        new FileShellLog(paths.LogDirectory).Write(
            "error",
            report.Detail,
            new Dictionary<string, object?> { ["code"] = report.Code, ["title"] = report.Title }
        );

        MessageBox.Show(
            report.ToDisplayText(),
            report.Title,
            MessageBoxButton.OK,
            MessageBoxImage.Error
        );
        Shutdown(1);
    }
}
