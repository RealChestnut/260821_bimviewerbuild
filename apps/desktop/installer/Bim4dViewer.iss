; BIM 4D Viewer 설치 프로그램 (ADR-0012).
;
; 값은 만들 때 넘어온다. 손으로 고쳐 쓰는 파일이 아니라
; `apps/desktop/tools/make_installer.py`가 부르는 정의다.
;
;   ISCC.exe /DAppVersion=0.1.0 /DSourceDir=... /DOutputDir=... /DBootstrapper=... Bim4dViewer.iss

#ifndef AppVersion
  #error AppVersion을 넘겨야 한다
#endif
#ifndef SourceDir
  #error SourceDir을 넘겨야 한다. `pnpm shell:publish`가 만든 폴더다
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

#define AppName "BIM 4D Viewer"
#define ShellExe "Bim4d.Desktop.exe"

[Setup]
; 덮어쓰기 설치가 같은 앱임을 아는 근거다. 한 번 정하면 바꾸지 않는다 (ADR-0012).
AppId={{4C534A54-394D-4675-A0BD-70EEB872D40B}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
VersionInfoVersion={#AppVersion}

DefaultDirName={autopf}\BIM 4D Viewer
DefaultGroupName={#AppName}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#ShellExe}

; 여러 사람이 쓰는 PC가 흔하므로 기본은 관리자다. 권한이 막힌 자리에서는
; /CURRENTUSER로 낮춰 자기 계정에만 깐다 (ADR-0012).
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline dialog

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; 318 MB를 한 파일로 건넨다.
Compression=lzma2/max
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=Bim4dViewer-Setup-{#AppVersion}

; WebView2와 Python 워커가 파일을 잡고 있으면 덮어쓰기가 실패한다.
CloseApplications=yes
RestartApplications=no

WizardStyle=modern
DisableProgramGroupPage=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕 화면에 아이콘 만들기"; GroupDescription: "추가 작업:"; Flags: unchecked

[Files]
; `pnpm shell:publish`가 만든 폴더를 통째로 담는다. 배치의 정본은 ADR-0011이다.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

#ifdef Bootstrapper
; WebView2 Evergreen이 없을 때만 쓴다. 설치가 끝나면 지운다.
Source: "{#Bootstrapper}"; DestDir: "{tmp}"; Flags: deleteafterinstall
#endif

[UninstallDelete]
; WebView2가 실행 중에 만드는 캐시다. 설치 프로그램이 담은 것이 아니라 Inno가 모른다.
; 브라우저 캐시는 사용자 데이터가 아니므로 지운다 — 남겨도 되찾을 것이 없다 (ADR-0012).
Type: filesandordirs; Name: "{app}\Bim4d.Desktop.exe.WebView2"
Type: dirifempty; Name: "{app}"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ShellExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ShellExe}"; Tasks: desktopicon

[Run]
#ifdef Bootstrapper
Filename: "{tmp}\MicrosoftEdgeWebView2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "WebView2 런타임을 설치하는 중…"; Check: NeedsWebView2; Flags: waituntilterminated runascurrentuser
#endif
Filename: "{app}\{#ShellExe}"; Description: "{#AppName} 실행"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2ClientKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

{ Evergreen Runtime이 깔려 있는지 본다.

  기계마다 자리가 다르다. 시스템 설치는 HKLM의 32비트 가지에, 사용자 설치는 HKCU에
  있다. pv가 있고 0.0.0.0이 아니면 깔린 것이다 (ADR-0012). }
function HasWebView2: Boolean;
var
  Version: String;
begin
  Result := False;

  if RegQueryStringValue(HKLM32, WebView2ClientKey, 'pv', Version) then
    Result := (Version <> '') and (Version <> '0.0.0.0');

  if not Result then
    if RegQueryStringValue(HKCU, WebView2ClientKey, 'pv', Version) then
      Result := (Version <> '') and (Version <> '0.0.0.0');
end;

function NeedsWebView2: Boolean;
begin
  Result := not HasWebView2;
end;
