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
