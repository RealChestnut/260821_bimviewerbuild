using System.Diagnostics;
using System.Runtime.InteropServices;
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
    private SingleInstance? _instance;

    /// <summary>
    /// 앱을 띄운다.
    /// </summary>
    /// <remarks>
    /// 이미 떠 있으면 그 창을 앞으로 가져오고 조용히 끝낸다. WebView2가 사용자 데이터
    /// 폴더를 잠그므로 두 번째 인스턴스는 <c>0x800700AA</c>로 죽는다. 아이콘을 두 번 누르는
    /// 일은 흔하며 그것을 오류로 만들지 않는다.
    /// </remarks>
    private void OnStartup(object sender, StartupEventArgs args)
    {
        _instance = SingleInstance.Acquire();
        if (!_instance.IsOwner)
        {
            ActivateRunningWindow();
            Shutdown();
            return;
        }

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

    private void OnExit(object sender, ExitEventArgs args)
    {
        _instance?.Dispose();
        _instance = null;
    }

    /// <summary>
    /// 이미 떠 있는 창을 앞으로 가져온다.
    /// </summary>
    /// <remarks>
    /// 창을 못 찾아도 그냥 끝낸다. 두 번째 창을 띄우지 않는 것이 목적이고, 앞으로
    /// 가져오는 것은 그다음이다.
    /// </remarks>
    private static void ActivateRunningWindow()
    {
        var current = Process.GetCurrentProcess();

        foreach (var other in Process.GetProcessesByName(current.ProcessName))
        {
            using (other)
            {
                if (other.Id == current.Id || other.MainWindowHandle == IntPtr.Zero)
                {
                    continue;
                }

                NativeMethods.ShowWindow(other.MainWindowHandle, NativeMethods.RestoreWindow);
                NativeMethods.SetForegroundWindow(other.MainWindowHandle);
                return;
            }
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

/// <summary>이미 떠 있는 창을 앞으로 가져올 때만 쓰는 Win32 호출.</summary>
internal static class NativeMethods
{
    /// <summary>최소화돼 있으면 되살린다.</summary>
    public const int RestoreWindow = 9;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr window, int command);
}
