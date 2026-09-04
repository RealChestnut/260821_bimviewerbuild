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

## 구조

```text
src/
 ├─ Bim4d.Desktop.Core/   창 없이 시험할 수 있는 것 전부
 │   ├─ StdioIfcWorker    Worker를 띄우고 수명을 관리한다 (ADR-0009의 C# 구현)
 │   ├─ ModelBridge       웹에 열어 줄 파일의 허용 목록
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
