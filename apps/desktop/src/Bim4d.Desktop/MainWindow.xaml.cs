using System.Diagnostics;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using Bim4d.Desktop.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Bim4d.Desktop;

/// <summary>
/// 창 하나가 곧 앱이다.
/// </summary>
/// <remarks>
/// 여는 일은 언제나 셸이 시작한다. 웹은 셸이 열어 준 주소에서만 파일을 읽는다 (ADR-0010).
/// 판단은 되도록 <c>Bim4d.Desktop.Core</c>에 두고 여기는 붙이는 일만 한다. 창을 띄우지 않고는
/// 시험할 수 없는 코드를 늘리지 않기 위해서다.
/// </remarks>
public partial class MainWindow : Window
{
    private readonly AppPaths _paths = AppPaths.Default();
    private readonly InstallLayout _layout = InstallLayout.Default();
    private readonly ModelBridge _bridge = new();
    private readonly ShellSettings _settings;
    private readonly RecentProjects _recent;
    private readonly IShellLog _log;
    private readonly IIfcWorker _worker;

    private readonly StartupOptions _startup;

    private bool _webReady;

    public MainWindow()
        : this(new StartupOptions()) { }

    public MainWindow(StartupOptions startup)
    {
        _startup = startup;
        InitializeComponent();

        _paths.EnsureCreated();
        _settings = JsonStore.Read(_paths.SettingsFile, new ShellSettings());
        _recent = new RecentProjects(_paths.RecentProjectsFile, _settings.RecentProjectLimit);
        _log = new FileShellLog(_paths.LogDirectory);
        _worker = new StdioIfcWorker(
            new StdioIfcWorkerOptions
            {
                Command = _layout.PythonCommandOrDefault(_settings.PythonCommand),
                Arguments = ["-m", "ifc_worker"],
                WorkingDirectory = _layout.WorkerDirectory,
                Timeout = TimeSpan.FromSeconds(_settings.WorkerTimeoutSeconds),
            }
        );

        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        try
        {
            await Viewer.EnsureCoreWebView2Async();
            var core = Viewer.CoreWebView2;

            // 빌드한 자산 폴더를 통째로 매핑한다. 서버도 포트도 없다.
            core.SetVirtualHostNameToFolderMapping(
                "app.local",
                _layout.WebRoot,
                CoreWebView2HostResourceAccessKind.Allow
            );

            // 모델은 고른 것 하나만 열어 준다. 폴더를 노출하지 않는다.
            core.AddWebResourceRequestedFilter(
                $"https://{ModelBridge.Host}/*",
                CoreWebView2WebResourceContext.All
            );
            core.WebResourceRequested += OnModelRequested;
            core.WebMessageReceived += OnWebMessage;

            RefreshRecentMenu();
            _log.Write(
                "info",
                "셸을 시작했다",
                new Dictionary<string, object?>
                {
                    ["layout"] = _layout.Kind,
                    ["assets"] = _layout.WebRoot,
                    ["worker"] = _layout.WorkerDirectory,
                    ["python"] = _layout.PythonCommandOrDefault(_settings.PythonCommand),
                    ["openPath"] = _startup.OpenPath,
                }
            );

            // 배치를 고르는 것과 다 갖춰졌는지는 다른 질문이다. 없는 것이 있어도 뜨되 남긴다.
            foreach (var missing in _layout.MissingPaths)
            {
                _log.Write(
                    "warn",
                    "있어야 할 자리가 없다",
                    new Dictionary<string, object?> { ["path"] = missing }
                );
            }

            core.Navigate("https://app.local/index.html");

            if (_startup.SelfCheck)
            {
                await SelfCheckAsync();
            }

            // 자동 시험이 쓰는 길. 사람이 쓰는 창은 이 값을 주지 않는다.
            if (_startup.ExitAfter is { } delay)
            {
                _ = Task.Delay(delay).ContinueWith(_ => Dispatcher.Invoke(Close));
            }
        }
        catch (Exception cause)
        {
            Report(cause);
        }
    }

    /// <summary>
    /// 설치가 온전한지 사람 손 없이 본다.
    /// </summary>
    /// <remarks>
    /// 자산은 창이 뜬 것으로 이미 확인됐다. 남은 것은 워커이며, 설치본에서 가장 먼저
    /// 깨지는 자리가 동봉한 Python이다. 실패해도 창은 닫지 않는다. 사람이 기록을 보고
    /// 고칠 수 있어야 한다 (ADR-0011).
    /// </remarks>
    private async Task SelfCheckAsync()
    {
        try
        {
            await _worker.PingAsync();
            _log.Write(
                "info",
                "자체 점검을 통과했다",
                new Dictionary<string, object?>
                {
                    ["layout"] = _layout.Kind,
                    ["python"] = _layout.PythonCommandOrDefault(_settings.PythonCommand),
                }
            );
            SetStatus("자체 점검을 통과했다");
        }
        catch (Exception cause)
        {
            Report(cause);
        }
    }

    private void OnClosed(object? sender, EventArgs args)
    {
        _bridge.Clear();
        // 워커의 stdin을 닫으면 스스로 끝낸다. 고아 프로세스를 남기지 않는다 (ADR-0009).
        _ = _worker.DisposeAsync().AsTask();
        _log.Write("info", "셸을 끝냈다");
    }

    /// <summary>
    /// 자산과 모델이 다른 호스트에 있으므로 브라우저가 교차 출처로 본다.
    /// </summary>
    /// <remarks>
    /// 이 머리글이 없으면 웹의 <c>fetch</c>가 "Failed to fetch"로 막힌다. 여는 쪽을
    /// 자산 호스트 하나로 좁힌다.
    /// </remarks>
    private const string AllowOrigin = "Access-Control-Allow-Origin: https://app.local";

    /// <summary>허용 목록에 있는 파일만 스트림으로 내준다.</summary>
    private void OnModelRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        var path = _bridge.Resolve(args.Request.Uri);
        var core = Viewer.CoreWebView2;

        if (path is null)
        {
            // 목록에 없는 id는 없는 것이다. 왜 없는지 알려 주지 않는다.
            args.Response = core.Environment.CreateWebResourceResponse(
                null,
                404,
                "Not Found",
                AllowOrigin
            );
            return;
        }

        // 원본은 읽기만 한다 (AGENTS.md 2.1절).
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        args.Response = core.Environment.CreateWebResourceResponse(
            stream,
            200,
            "OK",
            $"Content-Type: application/octet-stream\r\n{AllowOrigin}"
        );
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        var read = ShellMessages.Parse(args.TryGetWebMessageAsString());
        if (read is null)
        {
            return;
        }

        var (kind, payload) = read.Value;
        switch (kind)
        {
            case "web/ready":
                _webReady = true;
                SetStatus("뷰어 준비됨");
                // 뜨기를 기다렸다가 명령줄로 받은 파일을 연다.
                if (_startup.OpenPath is { } startupPath)
                {
                    _ = OpenModelAsync(startupPath);
                }
                break;

            case "web/log":
                _log.Write(
                    payload["level"]?.GetValue<string>() ?? "info",
                    payload["message"]?.GetValue<string>() ?? string.Empty,
                    new Dictionary<string, object?> { ["source"] = "web" }
                );
                break;

            case "web/error":
                var message = payload["message"]?.GetValue<string>() ?? "알 수 없는 실패";
                _log.Write(
                    "error",
                    message,
                    new Dictionary<string, object?>
                    {
                        ["source"] = "web",
                        ["code"] = payload["code"]?.GetValue<string>(),
                    }
                );
                SetStatus(message);
                break;
        }
    }

    private async void OnOpenModel(object sender, RoutedEventArgs args)
    {
        var path = AskForIfc("IFC 열기");
        if (path is null)
        {
            return;
        }

        await OpenModelAsync(path);
    }

    private async Task OpenModelAsync(string path)
    {
        try
        {
            if (!_webReady)
            {
                // 뜨기 전에 보내면 웹이 놓친다.
                SetStatus("뷰어가 아직 준비되지 않았다");
                return;
            }

            var (id, _) = _bridge.Publish(path);
            Viewer.CoreWebView2.PostWebMessageAsString(
                ShellMessages.ModelOpened(id, Path.GetFileName(path))
            );

            _recent.Add(path, DateTimeOffset.Now);
            RefreshRecentMenu();
            SetStatus($"열었다: {Path.GetFileName(path)}");
            _log.Write("info", "모델을 넘겼다", new Dictionary<string, object?> { ["path"] = path });
        }
        catch (Exception cause)
        {
            Report(cause);
        }
    }

    /// <summary>IFC에 든 일정을 Worker로 읽어 웹에 넘긴다.</summary>
    private async void OnImportSchedule(object sender, RoutedEventArgs args)
    {
        var path = AskForIfc("IFC에서 일정 가져오기");
        if (path is null)
        {
            return;
        }

        try
        {
            SetStatus("일정을 읽는 중…");
            var schedule = await _worker.ImportScheduleAsync(path);
            Viewer.CoreWebView2.PostWebMessageAsString(
                ShellMessages.ScheduleOpened(Path.GetFileName(path), schedule)
            );
            SetStatus($"일정을 읽었다: {Path.GetFileName(path)}");
        }
        catch (Exception cause)
        {
            Report(cause);
        }
    }

    private string? AskForIfc(string title)
    {
        var dialog = new OpenFileDialog
        {
            Title = title,
            Filter = "IFC 파일 (*.ifc)|*.ifc|모든 파일 (*.*)|*.*",
            CheckFileExists = true,
        };

        return dialog.ShowDialog(this) == true ? dialog.FileName : null;
    }

    private void RefreshRecentMenu()
    {
        RecentMenuItem.Items.Clear();
        var entries = _recent.Prune();

        if (entries.Count == 0)
        {
            RecentMenuItem.Items.Add(new MenuItem { Header = "(없음)", IsEnabled = false });
            return;
        }

        foreach (var entry in entries)
        {
            var item = new MenuItem { Header = entry.Path };
            item.Click += async (_, _) => await OpenModelAsync(entry.Path);
            RecentMenuItem.Items.Add(item);
        }
    }

    private void OnOpenLogFolder(object sender, RoutedEventArgs args) => Reveal(_paths.LogDirectory);

    private void OnOpenSettings(object sender, RoutedEventArgs args)
    {
        if (!File.Exists(_paths.SettingsFile))
        {
            // 없으면 만들어 준다. 무엇을 고칠 수 있는지 보이지 않으면 고칠 수 없다.
            JsonStore.Write(_paths.SettingsFile, _settings);
        }

        Reveal(_paths.SettingsFile);
    }

    private static void Reveal(string path) =>
        Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });

    private void OnExit(object sender, RoutedEventArgs args) => Close();

    private void SetStatus(string text) => StatusText.Text = text;

    /// <summary>실패를 사람이 할 수 있는 말로 바꿔 보여 주고 기록한다.</summary>
    private void Report(Exception cause)
    {
        var report = ErrorReport.From(cause, _paths.LogDirectory);
        _log.Write(
            "error",
            report.Detail,
            new Dictionary<string, object?> { ["code"] = report.Code, ["title"] = report.Title }
        );
        SetStatus(report.Detail);
        MessageBox.Show(this, report.ToDisplayText(), report.Title, MessageBoxButton.OK, MessageBoxImage.Warning);
    }
}
