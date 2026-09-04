# ADR-0010: 셸과 웹은 가상 호스트와 요청 가로채기로 잇는다

- 상태: 채택
- 날짜: 2026-09-04
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 3.1절, 3.2절, 9절(Phase 8·9) · ADR-0004 · ADR-0009 · `AGENTS.md` 2.1, 3절
- 해소 대상: 마스터 계획 9절 Phase 8의 "WebView2 통합"에서 셸과 웹이 파일을 주고받는 방법

## 맥락

Phase 8의 셸은 WPF 창 안에서 WebView2로 TypeScript Viewer를 띄운다. 두 가지를 정해야 한다.

1. **빌드한 웹 자산을 어떻게 올리나.** `file://`로 열면 브라우저 보안 규칙(모듈 스크립트, WASM, fetch)이 막는다. 이 앱은 `web-ifc` WASM과 ES 모듈을 쓴다.
2. **사용자가 고른 IFC를 어떻게 넘기나.** 웹은 브라우저라 파일 시스템을 직접 읽지 못한다. 파일은 수백 MB가 된다.

제약이 둘 있다.

- **원본 IFC는 읽기 전용이다** (`AGENTS.md` 2.1절). 넘기는 길이 원본을 고칠 수 있으면 안 된다.
- **필요 이상으로 노출하지 않는다.** 사용자가 고른 파일 하나를 넘기려고 그 폴더 전체를 웹에 열어 줄 이유가 없다.

## 결정

### 자산은 폴더 매핑, 모델은 요청 가로채기

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| 빌드한 웹 자산 (`apps/viewer-web/dist`) | `SetVirtualHostNameToFolder("app.local", dist, DenyCors)` | 폴더 전체가 그대로 자산이다. 서버도 포트도 없다 |
| 사용자가 고른 IFC | `AddWebResourceRequestedFilter("https://model.local/*")` + 스트리밍 | 고른 파일 하나만 열어 준다. 수백 MB도 메모리에 올리지 않는다 |

시작 주소는 `https://app.local/index.html`이다.

### 모델을 넘기는 순서

```text
1. 사용자가 [IFC 열기]를 누른다
2. 셸: 파일 대화상자 → 경로
3. 셸: 그 경로에 id를 발급하고 허용 목록에 넣는다  (id는 GUID)
4. 셸: postMessage({ kind: "shell/model-opened", id, name, url })
5. 웹: fetch(url) → ArrayBuffer → 기존 viewer/load-model 명령
6. 셸: 요청이 오면 허용 목록에서 id를 찾아 파일 스트림으로 답한다
```

**허용 목록에 없는 id는 404다.** 웹이 임의의 경로를 물어 읽는 길을 만들지 않는다. 목록은 사용자가 그 세션에서 실제로 고른 파일만 담는다.

**파일은 읽기 전용으로 연다** (`FileShare.Read`). 넘기는 길이 원본을 건드리지 않는다.

### 셸과 웹이 주고받는 말

`window.chrome.webview`의 `postMessage`를 쓴다. 한 방향으로 JSON 하나다.

| 방향 | kind | 내용 |
| --- | --- | --- |
| 셸 → 웹 | `shell/model-opened` | `{ id, name, url }` |
| 셸 → 웹 | `shell/schedule-opened` | `{ name, schedule }` — Worker가 IFC에서 읽은 일정 v3 JSON |
| 웹 → 셸 | `web/ready` | 웹이 떴다. 셸은 이때까지 기다렸다가 첫 모델을 보낸다 |
| 웹 → 셸 | `web/log` | `{ level, message }` — 웹의 기록을 셸 로그에 함께 남긴다 |
| 웹 → 셸 | `web/error` | `{ message, code? }` — 오류 리포트로 올린다 |

**웹은 셸이 붙어 있지 않아도 돈다.** `window.chrome.webview`가 없으면 다리 Component는 아무것도 하지 않는다. 브라우저에서 개발하고 시험하는 길(`pnpm dev`, Playwright)을 막지 않기 위해서다.

### 셸이 두는 자리

| 무엇 | 어디 |
| --- | --- |
| 설정 | `%APPDATA%\Bim4dViewer\settings.json` |
| 최근 프로젝트 | `%APPDATA%\Bim4dViewer\recent.json` |
| 로그 | `%APPDATA%\Bim4dViewer\logs\shell-YYYYMMDD.log` (줄 하나가 JSON 하나) |

**SQLite 프로젝트 저장소는 이 결정의 범위가 아니다.** 마스터 계획 3.1절이 Local Project Store를 두었고 16절이 "프로젝트 저장 형식과 SQLite 스키마는 별도 ADR"이라고 적었다. Phase 8이 요구하는 것은 "최근 프로젝트"뿐이며 그것은 목록 하나다. 목록 하나를 위해 스키마를 서둘러 정하지 않는다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| 모델도 폴더 매핑 | 구현이 가장 적다 | 고른 파일이 있는 폴더 전체가 웹에 열린다 | 필요 이상으로 노출한다. 사용자는 아무 데나 파일을 둔다 |
| `postMessage`로 바이트 전달 | 파일 시스템 노출이 0 | 수백 MB를 셸과 웹이 둘 다 들고 있게 된다 | 대형 모델이 이 제품의 주 대상이다 (마스터 계획 15절 위험) |
| 로컬 HTTP 서버 | 브라우저와 완전히 같은 환경 | 포트·방화벽·토큰. ADR-0009가 워커에서 이미 물리친 비용 | 같은 이유가 여기서도 그대로 성립한다 |
| `file://`로 열기 | 아무것도 안 해도 된다 | 모듈 스크립트·WASM·fetch가 막힌다 | 이 앱이 쓰는 것들이 정확히 그 셋이다 |
| 웹이 셸의 host object를 직접 호출 | 왕복이 짧다 | 웹이 셸 타입에 묶인다. 브라우저에서 못 돈다 | 개발과 e2e를 브라우저에서 하는 길을 지켜야 한다 |

## 결과

**가능해지는 것**

- 포트도 서버도 없이 데스크톱 안에서 Viewer가 그대로 돈다
- 고른 파일만 웹에 열린다. 세션이 끝나면 목록도 사라진다
- 웹은 셸이 있든 없든 같은 코드로 돈다. `pnpm dev`와 Playwright가 계속 유효하다

**포기하는 것**

- 웹이 스스로 파일을 찾아 여는 길. 여는 일은 언제나 셸이 시작한다
- 브라우저 개발 모드와 셸의 자산 경로가 다르다. 셸은 `dist`를 보고 개발 서버는 Vite가 낸다

**영향 받는 경로와 계약**

- `apps/desktop/src/Bim4d.Desktop` — WebView2 호스팅, 대화상자, 메뉴
- `apps/desktop/src/Bim4d.Desktop.Core` — 허용 목록, 메시지 만들기, 저장 자리
- `apps/viewer-web/src/shell/shellBridgeComponent.ts` — 셸이 붙어 있을 때만 사는 다리

## 후속 작업

- [x] `AGENTS.md` 1.4절 해소 표에 더한다
- [ ] Phase 9에서 `dist`를 설치 프로그램이 어디에 두는지 정하고 셸의 자산 경로 규칙을 맞춘다
- [ ] 프로젝트 저장 형식과 SQLite 스키마는 별도 ADR로 정한다 (마스터 계획 16절 Follow-up)
