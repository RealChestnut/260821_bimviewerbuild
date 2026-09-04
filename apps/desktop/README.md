# desktop

C# WPF Desktop Shell. WebView2 호스팅, 창·메뉴·파일 대화상자, Python Worker 프로세스 관리, 로그와
설정을 담당한다.

셸과 웹이 파일을 주고받는 방법의 정본은
[`docs/adr/0010-shell-web-bridge.md`](../../docs/adr/0010-shell-web-bridge.md)이고, Worker와 말하는
방법은 [`docs/adr/0009-ifc-worker-ipc.md`](../../docs/adr/0009-ifc-worker-ipc.md)다.

## 실행

뷰어 자산을 먼저 빌드한다. 셸은 `apps/viewer-web/dist`를 `app.local`로 매핑한다.

```bash
pnpm build          # 저장소 뿌리에서
pnpm shell          # 창을 띄운다
```

파일 하나를 바로 열려면 명령줄로 준다. 파일 연결과 끌어다 놓기가 붙을 자리이기도 하다.

```bash
dotnet run --project apps/desktop/src/Bim4d.Desktop -- --open C:/models/a.ifc
```

`--exit-after <초>`는 창을 스스로 닫는다. 사람이 누르지 않고 셸과 웹을 잇는 길 전체를 시험할 때 쓴다.

`--self-check`는 뜨자마자 Worker까지 닿는지 보고 결과를 기록에 남긴다. 설치본이 온전한지 사람이
메뉴를 눌러 확인하지 않아도 된다.

```bash
Bim4d.Desktop.exe --self-check --exit-after 30
```

## 설치본 만들기

```bash
pnpm build            # 뷰어 자산을 먼저 만든다
pnpm shell:publish    # 설치본 폴더 하나를 만든다
```

`apps/desktop/artifacts/publish`에 폴더 하나가 생긴다. 셋을 모은 것이다.

| 무엇 | 어디서                                                    | 크기   |
| ---- | --------------------------------------------------------- | ------ |
| 셸   | `dotnet publish -r win-x64 --self-contained`              | 134 MB |
| 웹   | `apps/viewer-web/dist` → `web/`                           | 33 MB  |
| 워커 | 임베더블 Python과 `ifc_worker` → `python/`, `ifc-worker/` | 151 MB |

.NET도 Python도 깔지 않은 Windows에서 뜬다. 만든 뒤 `--self-check`로 실제로 띄워 워커까지
닿는지 보며, 통과하지 못하면 게시가 실패한다.

폐쇄망에서는 `--embed-zip`과 `--wheel-dir`을 그대로 넘긴다. 창을 띄울 수 없는 자리에서는
`--skip-self-check`를 준다.

## 설치 프로그램 만들기

```bash
pnpm shell:installer   # 설치본 폴더를 Inno Setup으로 싼다
```

`apps/desktop/artifacts/installer/Bim4dViewer-Setup-<버전>.exe`가 나온다. 318 MB 폴더가 81 MB
파일 하나가 된다. 정본은 [`docs/adr/0012-installer.md`](../../docs/adr/0012-installer.md)다.

Inno Setup이 필요하다. `winget install JRSoftware.InnoSetup`으로 깔거나 `--iscc`로 자리를 준다.

| 하는 일          | 어떻게                                                            |
| ---------------- | ----------------------------------------------------------------- |
| 무인 설치        | `Bim4dViewer-Setup-0.1.0.exe /VERYSILENT /NORESTART`              |
| 관리자 없이 설치 | `/CURRENTUSER`를 더한다                                           |
| 덮어쓰기         | 같은 AppId라 제자리에서 된다. 실행 중인 셸은 닫게 한다            |
| 제거             | 설치 폴더와 시작 메뉴는 사라지고 `%APPDATA%\Bim4dViewer`는 남는다 |
| WebView2         | 없을 때만 동봉한 bootstrapper를 조용히 실행한다                   |

버전은 `apps/desktop/Directory.Build.props`의 `<Version>` 한 곳에서 온다.

## 코드 서명

인증서는 아직 없다. 절차만 뚫려 있다.

**순서가 중요하다.** 싸고 나면 안을 못 고친다.

```bash
pnpm shell:publish -- --sign-tool "signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f cert.pfx {file}"
pnpm shell:installer -- --sign-tool "signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f cert.pfx {file}"
```

1. 게시 → 우리가 만든 이진 파일 서명 (`Bim4d.Desktop.exe`, `Bim4d.Desktop.dll`, `Bim4d.Desktop.Core.dll`)
2. 싸기 → 설치 프로그램 서명

**우리가 만든 것만 서명한다.** .NET 런타임, CPython, ifcopenshell, WebView2는 각자 만든 곳이
이미 서명했다. 그 위에 덧씌우면 원래 서명을 지우고 출처를 흐린다.

서명한 뒤 `signtool verify /pa`로 실제로 붙었는지 확인한다. 서명 명령이 조용히 실패하는 일이
있다.

시각 도장(`/tr`)을 빠뜨리지 않는다. 없으면 인증서가 만료될 때 이미 배포한 설치본의 서명도
함께 죽는다.

인증서 암호를 명령줄에 적으면 프로세스 목록에 보인다. 인증서 저장소나 HSM을 쓰는 편이 낫다.

## 무엇을 어디서 찾나

배치의 정본은 [`docs/adr/0011-install-layout.md`](../../docs/adr/0011-install-layout.md)다. 고르는
기준은 실행 파일 옆 `web` 폴더 하나이며, 판단은 `Bim4d.Desktop.Core`의 `InstallLayout`에 있다.

| 배치   | 언제                                       | web                           | ifc-worker                   | python                     |
| ------ | ------------------------------------------ | ----------------------------- | ---------------------------- | -------------------------- |
| 설치본 | 실행 파일 옆에 `web/`이 있다               | `<base>/web`                  | `<base>/ifc-worker`          | `<base>/python/python.exe` |
| 개발   | 위로 올라가 `pnpm-workspace.yaml`을 찾았다 | `<repo>/apps/viewer-web/dist` | `<repo>/services/ifc-worker` | PATH의 `python`            |

어느 쪽도 아니면 뜨지 않고, 무엇을 어디서 찾았는지 말한다. 배치를 골랐지만 그 안에 빠진 자리가
있으면 뜨되 기록에 남긴다 — 뜨지 않으면 사용자가 고칠 길이 없다.

설정 파일의 `pythonCommand`가 비어 있으면 배치가 고른다. 사람이 적은 값은 그대로 이긴다.

## 구조

```text
src/
 ├─ Bim4d.Desktop.Core/   창 없이 시험할 수 있는 것 전부
 │   ├─ StdioIfcWorker    Worker를 띄우고 수명을 관리한다 (ADR-0009의 C# 구현)
 │   ├─ ModelBridge       웹에 열어 줄 파일의 허용 목록
 │   ├─ InstallLayout     web · ifc-worker · python이 어디 있는지 (ADR-0011)
 │   ├─ ShellState        설정 · 최근 프로젝트 · 저장 자리
 │   └─ ShellLog          줄 하나가 JSON 하나인 기록, 오류 리포트
 └─ Bim4d.Desktop/        WPF 창. 붙이는 일만 한다
tests/
 └─ Bim4d.Desktop.Core.Tests/
```

판단은 `Core`에 둔다. 창을 띄우지 않고는 시험할 수 없는 코드를 늘리지 않기 위해서다.

## 시험

```bash
pnpm shell:test     # 저장소 뿌리에서
```

Worker 테스트는 실제 Python 워커를 자식 프로세스로 띄운다. Python과 ifcopenshell이 필요하다
(`pip install -r services/ifc-worker/requirements-dev.txt`).

## 셸이 두는 자리

| 무엇          | 어디                                            |
| ------------- | ----------------------------------------------- |
| 설정          | `%APPDATA%\Bim4dViewer\settings.json`           |
| 최근 프로젝트 | `%APPDATA%\Bim4dViewer\recent.json`             |
| 로그          | `%APPDATA%\Bim4dViewer\logs\shell-YYYYMMDD.log` |

설정 파일이 깨져도 앱은 기본값으로 뜬다. 뜨지 않으면 사용자가 고칠 길이 없다.

## 개발 환경 (.vsconfig)

이 디렉터리의 `.vsconfig`는 Desktop Shell 개발에 필요한 Visual Studio 2026 구성이다. Visual Studio
설치 관리자에서 "구성 가져오기"로 불러온다. 명령줄로만 작업한다면 .NET 10 SDK와 WebView2
Runtime만 있으면 된다.

기준: Visual Studio 2026 (Dev18), .NET 10, WebView2 Evergreen Runtime.
