using System.Diagnostics;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
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
    private readonly ProjectSession _session = new();

    private bool _webReady;
    /// <summary>저장 대화상자에서 받은 자리. 웹의 답이 오면 여기에 쓴다.</summary>
    private string? _pendingSavePath;



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
        Closing += OnClosing;
        Closed += OnClosed;
        UpdateTitle();
    }

    private async void OnLoaded(object sender, RoutedEventArgs args)
    {
        try
        {
            await Viewer.EnsureCoreWebView2Async();
            var core = Viewer.CoreWebView2;

            // 브라우저 단축키를 끈다. 켜 두면 WebView2가 Ctrl+S를 "페이지 저장"으로 먼저
            // 먹어 셸의 프로젝트 저장이 오지 않는다. 여기는 브라우저가 아니라 앱이다.
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;

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
    ///
    /// 실패해도 대화상자를 띄우지 않는다. 이 길은 사람이 아니라 게시 절차가 부르며,
    /// 대화상자는 아무도 누르지 않아 그대로 멈춘다. 결과는 <c>selfCheck</c> 필드로 남긴다.
    /// </remarks>
    private async Task SelfCheckAsync()
    {
        try
        {
            await _worker.PingAsync();
            CheckProjectStore();
            _log.Write(
                "info",
                "자체 점검을 통과했다",
                new Dictionary<string, object?>
                {
                    ["selfCheck"] = "ok",
                    ["layout"] = _layout.Kind,
                    ["python"] = _layout.PythonCommandOrDefault(_settings.PythonCommand),
                }
            );
            SetStatus("자체 점검을 통과했다");
        }
        catch (Exception cause)
        {
            var report = ErrorReport.From(cause, _paths.LogDirectory);
            _log.Write(
                "error",
                "자체 점검이 실패했다",
                new Dictionary<string, object?>
                {
                    ["selfCheck"] = "failed",
                    ["code"] = report.Code,
                    ["detail"] = report.Detail,
                }
            );
            SetStatus(report.Detail);
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
                if (_startup.OpenProjectPath is { } startupProject)
                {
                    OpenProjectAt(startupProject);
                }
                if (_startup.OpenPath is { } startupPath)
                {
                    _ = OpenModelAsync(startupPath);
                }
                break;

            case "web/state":
                // 기다리던 답만 받는다. 저장이 겹치면 오래된 답으로 새 파일을 쓰지 않는다.
                if (_session.IsAwaited(payload["requestId"]?.GetValue<string>()))
                {
                    WriteProject(payload);
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

            // 최근 목록이 가리키는 것은 프로젝트다. 모델은 프로젝트가 안다 (ADR-0013).
            _session.AddModel(path, ModelPaths.Fingerprint(path));
            UpdateTitle();

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
            item.Click += (_, _) => OpenProjectAt(entry.Path);
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

    /// <summary>
    /// 프로젝트를 쓰고 다시 읽을 수 있는지 본다.
    /// </summary>
    /// <remarks>
    /// 설치본에서 SQLite 네이티브가 실제로 올라오는지는 이렇게만 알 수 있다. 파일이 있는
    /// 것과 로드되는 것은 다른 일이다.
    ///
    /// 사용자 파일을 건드리지 않는다. 임시 폴더에 쓰고 읽은 뒤 지운다.
    /// </remarks>
    private static void CheckProjectStore()
    {
        var probe = Path.Combine(
            Path.GetTempPath(),
            $"bim4d-selfcheck-{Guid.NewGuid():n}{ProjectStore.Extension}"
        );

        try
        {
            ProjectStore.Write(
                probe,
                new ProjectDocument
                {
                    Name = "자체 점검",
                    ScheduleJson = string.Empty,
                    ViewerStateJson = string.Empty,
                    Models = [],
                }
            );

            if (ProjectStore.Read(probe).Name != "자체 점검")
            {
                throw new ProjectStoreException(
                    "project.roundtrip",
                    "프로젝트를 쓰고 다시 읽었으나 내용이 달랐다."
                );
            }
        }
        finally
        {
            File.Delete(probe);
        }
    }

    // ── 프로젝트 (ADR-0013) ─────────────────────────────────────────────────────

    // 단축키(Ctrl+N/O/S)가 부르는 자리. 메뉴와 같은 일을 한다.
    private void OnNewProjectCommand(object sender, ExecutedRoutedEventArgs args) => NewProject();

    private void OnOpenProjectCommand(object sender, ExecutedRoutedEventArgs args) => OpenProject();

    private void OnSaveProjectCommand(object sender, ExecutedRoutedEventArgs args) =>
        SaveProject(saveAs: false);

    private void OnNewProject(object sender, RoutedEventArgs args) => NewProject();

    private void OnOpenProject(object sender, RoutedEventArgs args) => OpenProject();

    private void OnSaveProject(object sender, RoutedEventArgs args) => SaveProject(saveAs: false);

    private void OnSaveProjectAs(object sender, RoutedEventArgs args) => SaveProject(saveAs: true);

    /// <summary>새 프로젝트. 열린 모델과 일정을 비운다.</summary>
    private void NewProject()
    {
        if (!ConfirmDiscard())
        {
            return;
        }

        _session.Reset();
        _bridge.Clear();
        if (_webReady)
        {
            Viewer.CoreWebView2.PostWebMessageAsString(ShellMessages.ProjectClosed());
        }

        UpdateTitle();
        SetStatus("새 프로젝트");
    }

    private void OpenProject()
    {
        if (!ConfirmDiscard())
        {
            return;
        }

        var dialog = new OpenFileDialog
        {
            Title = "프로젝트 열기",
            Filter = $"BIM 4D 프로젝트 (*{ProjectStore.Extension})|*{ProjectStore.Extension}",
            CheckFileExists = true,
        };

        if (dialog.ShowDialog(this) == true)
        {
            OpenProjectAt(dialog.FileName);
        }
    }

    /// <summary>
    /// 프로젝트를 연다.
    /// </summary>
    /// <remarks>
    /// 모델을 먼저 보내고 프로젝트를 나중에 보낸다. 웹은 기다릴 모델 목록을 받아 두었다가
    /// 다 올라온 뒤에 화면 상태를 되살린다 (ADR-0013).
    /// </remarks>
    private void OpenProjectAt(string path)
    {
        try
        {
            if (!_webReady)
            {
                SetStatus("뷰어가 아직 준비되지 않았다");
                return;
            }

            var document = ProjectStore.Read(path);

            var found = new List<ProjectModel>();
            var unbound = new List<string>();
            foreach (var model in document.Models)
            {
                var located = ModelPaths.Resolve(model, path).Path ?? AskWhereModelWent(model);

                if (located is null)
                {
                    // 찾지 못해도 연결은 지우지 않는다 (ADR-0008).
                    unbound.Add(model.ModelRef);
                    continue;
                }

                found.Add(model with { AbsolutePath = located });
            }

            _bridge.Clear();
            foreach (var model in found)
            {
                var (id, _) = _bridge.Publish(model.AbsolutePath);
                Viewer.CoreWebView2.PostWebMessageAsString(
                    ShellMessages.ModelOpened(id, model.ModelRef)
                );
            }

            Viewer.CoreWebView2.PostWebMessageAsString(
                ShellMessages.ProjectOpened(
                    document.ScheduleJson,
                    document.ViewerStateJson,
                    unbound,
                    [.. found.Select(model => model.ModelRef)]
                )
            );

            _session.Opened(path, found, unbound);
            _recent.Add(path, DateTimeOffset.Now);
            RefreshRecentMenu();
            UpdateTitle();

            SetStatus(
                unbound.Count == 0
                    ? $"열었다: {Path.GetFileName(path)}"
                    : $"열었다: {Path.GetFileName(path)} — 모델 {unbound.Count}개를 찾지 못했다"
            );
            _log.Write(
                "info",
                "프로젝트를 열었다",
                new Dictionary<string, object?>
                {
                    ["path"] = path,
                    ["models"] = found.Count,
                    ["unbound"] = unbound.Count,
                }
            );
        }
        catch (Exception cause)
        {
            Report(cause);
        }
    }

    /// <summary>
    /// 찾지 못한 모델을 사용자가 다시 지목한다.
    /// </summary>
    /// <remarks>
    /// 건너뛸 수 있다. 지목한 파일의 fingerprint가 프로젝트에 적힌 것과 다르면 알리고,
    /// 그래도 쓸지는 사용자가 정한다 — 모델을 갱신했으면 당연히 다르다 (ADR-0013).
    /// </remarks>
    private string? AskWhereModelWent(ProjectModel model)
    {
        // 절차가 띄운 창에는 대화상자를 내지 않는다. 아무도 누르지 않아 그대로 멈춘다.
        if (_startup.Automated)
        {
            return null;
        }

        var dialog = new OpenFileDialog
        {
            Title = $"'{model.ModelRef}'을(를) 찾지 못했다",
            Filter = "IFC (*.ifc)|*.ifc|모든 파일 (*.*)|*.*",
            FileName = model.ModelRef,
            CheckFileExists = true,
        };

        if (dialog.ShowDialog(this) != true)
        {
            return null;
        }

        if (model.Fingerprint is { } expected)
        {
            var actual = ModelPaths.Fingerprint(dialog.FileName);
            if (
                !string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)
                && MessageBox.Show(
                    this,
                    $"고른 파일은 프로젝트에 적힌 '{model.ModelRef}'과 내용이 다르다. 그래도 쓸까?",
                    "다른 파일이다",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question
                ) != MessageBoxResult.Yes
            )
            {
                return null;
            }
        }

        return dialog.FileName;
    }

    /// <summary>
    /// 저장을 시작한다.
    /// </summary>
    /// <remarks>
    /// 일정과 화면 상태는 웹에 있다. 물어 두고 답이 오면 그때 파일을 쓴다 (ADR-0013).
    /// </remarks>
    private void SaveProject(bool saveAs)
    {
        if (!_webReady)
        {
            SetStatus("뷰어가 아직 준비되지 않았다");
            return;
        }

        var path = saveAs || _session.Path is null ? AskWhereToSave() : _session.Path;
        if (path is null)
        {
            return;
        }

        _pendingSavePath = path;
        Viewer.CoreWebView2.PostWebMessageAsString(
            ShellMessages.StateRequested(_session.BeginSave())
        );
        SetStatus("저장하는 중…");
    }

    private string? AskWhereToSave()
    {
        var dialog = new SaveFileDialog
        {
            Title = "프로젝트 저장",
            Filter = $"BIM 4D 프로젝트 (*{ProjectStore.Extension})|*{ProjectStore.Extension}",
            DefaultExt = ProjectStore.Extension,
            AddExtension = true,
            FileName = _session.Path is null
                ? "프로젝트" + ProjectStore.Extension
                : Path.GetFileName(_session.Path),
        };

        return dialog.ShowDialog(this) == true ? dialog.FileName : null;
    }

    /// <summary>웹이 보내온 상태로 파일을 쓴다.</summary>
    private void WriteProject(JsonObject payload)
    {
        try
        {
            if (_pendingSavePath is not { } path)
            {
                return;
            }

            var document = new ProjectDocument
            {
                Name = Path.GetFileNameWithoutExtension(path),
                ScheduleJson = ShellMessages.RawJson(payload["schedule"]),
                ViewerStateJson = ShellMessages.RawJson(payload["viewerState"]),
                Models = _session.Models,
                TaskCount = payload["taskCount"]?.GetValue<int>() ?? 0,
            };

            ProjectStore.Write(path, document);

            _pendingSavePath = null;
            _session.Saved(path);
            _recent.Add(path, DateTimeOffset.Now);
            RefreshRecentMenu();
            UpdateTitle();

            SetStatus($"저장했다: {Path.GetFileName(path)}");
            _log.Write(
                "info",
                "프로젝트를 저장했다",
                new Dictionary<string, object?>
                {
                    ["path"] = path,
                    ["models"] = _session.Models.Count,
                }
            );
        }
        catch (Exception cause)
        {
            Report(cause);
        }
    }

    /// <summary>저장하지 않은 변경이 있으면 묻는다. 계속해도 되면 <c>true</c>다.</summary>
    private bool ConfirmDiscard()
    {
        if (!_session.IsDirty || _startup.Automated)
        {
            return true;
        }

        return MessageBox.Show(
                this,
                "저장하지 않은 변경이 있다. 버리고 계속할까?",
                "저장하지 않은 변경",
                MessageBoxButton.OKCancel,
                MessageBoxImage.Warning
            ) == MessageBoxResult.OK;
    }

    private void UpdateTitle() => Title = _session.WindowTitle;

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs args) =>
        args.Cancel = !ConfirmDiscard();

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

        // 절차가 띄운 창에는 대화상자를 내지 않는다. 아무도 누르지 않아 그대로 멈춘다.
        if (_startup.Automated)
        {
            return;
        }

        MessageBox.Show(
            this,
            report.ToDisplayText(),
            report.Title,
            MessageBoxButton.OK,
            MessageBoxImage.Warning
        );
    }
}
