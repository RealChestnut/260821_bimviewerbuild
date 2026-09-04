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
        MainWindow = new MainWindow(options);
        MainWindow.Show();
    }
}
