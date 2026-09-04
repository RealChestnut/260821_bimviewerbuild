# 작업 기록 — C# Desktop Shell (Phase 8)

- 날짜: 2026-09-04
- 브랜치: `feature/desktop-shell`
- 대상 Phase: Phase 8 — C# Desktop Shell (마스터 계획 9절)

---

## 1. 무엇을 만들었나

| 마스터 계획 항목 | 어디에 |
| --- | --- |
| WPF Shell | `apps/desktop/src/Bim4d.Desktop` — 창 하나, 메뉴, 상태 표시줄 |
| WebView2 통합 | 자산은 `app.local` 폴더 매핑, 모델은 `model.local` 요청 가로채기 (ADR-0010) |
| 파일 대화상자 | `OpenFileDialog` + 명령줄 `--open` |
| 최근 프로젝트 | `%APPDATA%\Bim4dViewer\recent.json`, 메뉴에 목록 |
| Python Worker 관리 | `StdioIfcWorker` — ADR-0009 규약의 C# 구현 |
| 로그와 오류 리포트 | 줄 하나가 JSON 하나인 기록 + `ErrorReport` |
| 설정 | `%APPDATA%\Bim4dViewer\settings.json` |

## 2. 먼저 환경을 확인했다

이 PC에 .NET SDK가 없어 Phase 8은 "빌드 검증 불가"로 남아 있었다. 그래서 순서를 셋으로 나눠 사용자에게 물었고 **③ PR 머지 → ① SDK 설치 후 진행**을 골랐다.

- PR #13(Phase 5), #15(Phase 6·7)를 스쿼시 머지해 `main`을 Phase 0~7로 맞췄다
- `winget install Microsoft.DotNet.SDK.10` → 10.0.400
- WebView2 Evergreen Runtime 152.0.4191.53 확인

PR #14는 base 브랜치가 삭제되며 닫혔다. 같은 내용으로 #15를 `main`에 다시 열었고, 스쿼시된 Phase 5의 트리가 갈라진 지점과 같음을 확인한 뒤 `-s ours`로 받아들였다.

## 3. 셸과 웹을 잇는 길을 정했다 (ADR-0010)

문제는 하나였다. **웹은 브라우저라 파일 시스템을 못 읽는다.** 사용자가 고른 IFC를 어떻게 넘기나.

| 후보 | 문제 |
| --- | --- |
| 폴더 매핑만 쓴다 | 고른 파일이 있는 폴더 전체가 웹에 열린다 |
| `postMessage`로 바이트 전달 | 수백 MB를 셸과 웹이 둘 다 든다 |
| 로컬 HTTP 서버 | 포트·방화벽·토큰. ADR-0009가 워커에서 이미 물리친 비용 |
| `file://` | 모듈 스크립트·WASM·fetch가 막힌다. 이 앱이 쓰는 것이 정확히 그 셋이다 |

**역할을 갈랐다.** 빌드한 자산은 폴더째 `app.local`로 매핑하고, 사용자가 고른 IFC는 `model.local` 요청을 가로채 그 파일 하나만 스트리밍한다. 허용 목록에 없는 id는 404이며, 원본은 `FileShare.Read`로 연다.

## 4. 판단은 창 밖에 두었다

WPF 창은 띄우지 않고는 시험할 수 없다. 그래서 판단은 전부 `Bim4d.Desktop.Core`에 두고 창은 붙이는 일만 하게 했다.

```text
Bim4d.Desktop.Core        (창 없이 시험한다 — xunit 43개)
 ├─ StdioIfcWorker        Worker를 띄우고 마감을 재고 다시 띄운다
 ├─ ModelBridge           웹에 열어 줄 파일의 허용 목록
 ├─ ShellState            설정 · 최근 프로젝트 · 저장 자리
 ├─ ShellLog              줄 하나가 JSON 하나, 오류 리포트
 └─ StartupOptions        명령줄

Bim4d.Desktop             (창 — 붙이는 일만)
```

`StdioIfcWorker`는 TypeScript 쪽 `packages/ifc-worker-client`와 같은 규약을 C#으로 다시 구현한 것이다. ADR-0009가 규약을 문서에 두었기 때문에 언어가 달라도 같은 워커를 쓴다. 실패 횟수를 응답 하나를 받았을 때 되돌리는 규칙까지 그대로 옮겼다.

웹 쪽에는 `shellBridgeComponent`를 더했다. **셸이 없으면 아무것도 하지 않는다.** `window.chrome.webview`가 없으면 다리를 놓지 않으므로 `pnpm dev`와 Playwright가 그대로 유효하다.

## 5. 첫 실행이 버그를 잡았다

`--open <경로>`와 `--exit-after <초>`를 더해 사람이 누르지 않고도 창을 띄워 봤다. 첫 실행의 로그는 이랬다.

```text
info  | 셸을 시작했다
info  | 모델을 넘겼다
error | Failed to fetch          (source: web)
info  | 셸을 끝냈다
```

자산과 모델이 다른 호스트라 브라우저가 교차 출처로 본 것이다. 응답에 `Access-Control-Allow-Origin: https://app.local`을 붙이자 통과했다.

```text
info | 셸을 시작했다
info | 모델을 넘겼다
info | 모델을 열었다: three-elements-ifc4.ifc   (source: web)
info | 셸을 끝냈다
```

셸이 연 파일을 웹이 실제로 읽어 뷰어에 올렸고, 그 사실이 다시 셸 로그로 돌아왔다. 세 프로세스를 잇는 길이 한 번에 확인됐다.

**단위 테스트로는 잡히지 않는 종류였다.** 양쪽 모두 자기 몫을 정확히 하고 있었고, 문제는 그 사이의 브라우저 규칙이었다.

## 6. 정한 규칙과 이유

- **허용 목록에 없는 id는 404다.** 왜 없는지 알려 주지 않는다. 웹이 임의의 경로를 물어 읽는 길을 만들지 않는다
- **`web/ready`를 기다렸다가 첫 모델을 보낸다.** 뜨기 전에 보내면 웹이 놓친다
- **설정 파일이 깨져도 앱은 뜬다.** 뜨지 않으면 사용자가 고칠 길이 없다
- **최근 목록에서 사라진 파일은 걷는다.** 열 수 없는 줄을 보여 주지 않는다
- **경로 비교는 대소문자를 가리지 않는다.** Windows가 그렇기 때문이다
- **오류는 코드와 로그 자리를 함께 보인다.** "알 수 없는 오류"만 띄우면 사용자가 할 수 있는 일이 없다

## 7. 넣지 않은 것

**SQLite 프로젝트 저장소.** 마스터 계획 3.1절이 Local Project Store를 두었고 16절이 "프로젝트 저장 형식과 SQLite 스키마는 별도 ADR"이라고 적었다. Phase 8이 요구하는 것은 "최근 프로젝트"뿐이며 그것은 목록 하나다. 목록 하나를 위해 스키마를 서둘러 정하지 않는다.

**설치와 배포.** Phase 9의 일이다. 지금 셸은 저장소의 `apps/viewer-web/dist`와 `services/ifc-worker`를 개발 배치로 찾고, 실행 파일 옆에 `web/`·`ifc-worker/`가 있으면 그쪽을 먼저 본다. 설치본의 배치는 Phase 9에서 정한다.

## 8. 검증 결과

| 게이트 | 결과 |
| --- | --- |
| `pnpm verify` | 통과 |
| vitest | 641개 통과 (셸 다리 12개 추가) |
| `pnpm shell:test` (xunit) | 43개 통과 — 실제 Python 워커 포함 |
| `pnpm test:python` | 49개 통과 |
| 실제 실행 | `--open`으로 창을 띄워 모델을 열고 로그로 확인 |

CI에 `desktop shell (dotnet)` job을 더했다. Core 테스트가 워커를 띄우므로 Python도 함께 세운다.

## 9. 겪은 것

**`SetVirtualHostNameToFolder`는 없다.** 지금 이름은 `SetVirtualHostNameToFolderMapping`이다. 빌드가 바로 잡아 주었다.

**`git add -- docs`가 사용자 파일을 함께 담았다.** `docs/brainstorming/`과 `docs/diagrams/`가 커밋에 섞였다. 되돌리고 경로를 좁혀 다시 담았다. Phase 6에서 `git add -A`로 같은 실수를 했는데 디렉터리 단위 추가도 같은 함정이었다.
