# BIM 4D Viewer

다양한 도구에서 내보낸 IFC 모델을 불러와 공정과 연결하고 4D 시뮬레이션을 수행하는 Windows용 독립 실행형 애플리케이션이다.

- 제품 목표와 로드맵: [docs/DEVELOPMENT_MASTER_PLAN.md](docs/DEVELOPMENT_MASTER_PLAN.md)
- 에이전트 작업 규칙: [AGENTS.md](AGENTS.md)
- IFC 기술 기준서: [docs/IFC_통합_정리_2026-08-20.md](docs/IFC_통합_정리_2026-08-20.md)
- 결정 기록: [docs/adr/](docs/adr/)

현재 단계는 **Phase 7 — IfcOpenShell Worker**다. Phase 0~6이 `main`에 들어가 있다.

## 요구 환경

- Node.js 22 이상
- pnpm 10.34.5 (`npm i -g pnpm@10`)
- Playwright 브라우저 (`pnpm exec playwright install chromium`)

## 시작하기

```bash
pnpm install
pnpm verify        # typecheck + lint + unit test + build
pnpm --filter @bim4d/viewer-web dev
```

### 개발 서버 전에 패키지를 빌드해야 한다

`verify`를 건너뛸 때는 최소한 이것만이라도 먼저 실행한다.

```bash
pnpm --filter "./packages/**" -r build
```

`apps/viewer-web`은 `@bim4d/domain` 같은 workspace 패키지를 `package.json`의 `main`이 가리키는 `dist/`에서 읽는다. Vite에 src 별칭이 없고 `dist/`는 `.gitignore` 대상이라 `git clone`이나 `git pull`로 따라오지 않는다.

빌드하지 않고 개발 서버를 띄우면 페이지 자체는 열리지만 모듈이 500으로 깨지고 화면이 `kernel: booting`에서 멈춘다. `packages/**`를 고친 뒤에도 다시 빌드해야 개발 서버가 알아본다. `apps/viewer-web/**`와 `index.html`은 빌드 없이 즉시 반영된다.

패키지를 자주 고치는 동안에는 터미널 하나를 감시에 내준다.

```bash
pnpm dev:packages   # tsc --build --watch, packages/**의 dist를 계속 갱신한다
pnpm dev            # 다른 터미널에서 Vite 개발 서버
```

**단위 테스트는 이 함정을 알려 주지 않는다.** `vitest.config.ts`는 `@bim4d/domain`을 `packages/domain/src`로 별칭하지만 브라우저는 `dist`를 읽는다. 빌드하지 않은 채로는 단위 테스트가 새 코드로 초록인데 화면은 옛 코드로 돈다. `packages/**`를 고쳤으면 브라우저로 확인하기 전에 빌드하거나 `pnpm dev:packages`를 띄워 둔다.

## 명령

| 명령                | 설명                                                   |
| ------------------- | ------------------------------------------------------ |
| `pnpm typecheck`    | 빌드 대상과 테스트 코드의 strict 타입 검사             |
| `pnpm lint`         | ESLint (type-aware)                                    |
| `pnpm format:check` | Prettier 형식 검사                                     |
| `pnpm test`         | Vitest 단위·계약 테스트                                |
| `pnpm test:e2e`     | Playwright 브라우저 테스트 (빌드 후 preview 서버 기동) |
| `pnpm build`        | 패키지와 Viewer 웹 앱 빌드                             |
| `pnpm dev`          | Viewer 웹 앱 개발 서버                                 |
| `pnpm dev:packages` | `packages/**`를 감시하며 `dist` 갱신                   |
| `pnpm verify`       | 위 게이트를 순서대로 실행                              |

## 저장소 구조

```text
apps/
 ├─ viewer-web/          TypeScript Viewer와 Scheduler UI (Kernel 포함)
 └─ desktop/             C# WPF Shell (Phase 8)
services/
 └─ ifc-worker/          Python IfcOpenShell Worker (Phase 7)
packages/
 ├─ contracts/           Command, Event, DTO 타입 계약
 ├─ domain/              순수 도메인 규칙
 └─ test-fixtures/       IFC와 일정 fixture
tests/
 ├─ e2e/                 Playwright 시나리오
 ├─ integration/         모듈 간 통합 테스트
 └─ performance/         성능 측정
docs/
 ├─ DEVELOPMENT_MASTER_PLAN.md
 └─ adr/                 아키텍처 결정 기록
```

## 아키텍처 요약

- Typed Event-Driven Modular Monolith + Ports/Adapters + Vertical Slice
- Domain은 That Open Components, WPF, IfcOpenShell을 직접 참조하지 않는다
- 모듈 간 영구 식별자는 `modelId + IfcRoot.GlobalId`다
- 모든 장기 실행 기능은 `AppComponent` 생명주기(`initialize` → `start` → `stop` → `dispose`)를 구현한다

Kernel 사용 예:

```ts
import { createKernel } from './kernel/index.js';

const kernel = createKernel();
kernel.register(myComponent);
await kernel.start();
// ...
await kernel.shutdown();
```

Viewer는 Port 뒤에 둔다. `@thatopen/components`를 직접 참조하는 곳은 `src/adapters/thatopen/`뿐이고, Feature는 `ViewerWorldPort`만 본다.

```text
src/
 ├─ kernel/       Event Bus, Command Dispatcher, Component Registry, 로깅
 ├─ viewer/       Viewer 슬라이스 (Port, Event 선언, World Component)
 ├─ adapters/     That Open World Factory, 메모리 ModelRepository
 └─ shell/        상태 표시 등 앱 셸
```

Event와 Command 이름은 문자열로 흩어 쓰지 않는다. Feature 슬라이스가 `AppEventMap`, `AppCommandMap`에 선언 병합으로 등록한다.

```ts
declare module '@bim4d/contracts' {
  interface AppEventMap {
    'viewer/model-loaded': { readonly modelId: ModelId };
  }
}
```

## 라이브러리 버전 고정

That Open 계열은 peer 범위가 `~`로 묶여 있어 개별 업그레이드하지 않는다. Phase 0에서 확인한 조합:

| 패키지                       | 버전    | 비고                              |
| ---------------------------- | ------- | --------------------------------- |
| `@thatopen/components`       | 3.4.8   | peer `@thatopen/fragments ~3.4.7` |
| `@thatopen/components-front` | 3.4.4   | peer `@thatopen/fragments ~3.4.0` |
| `@thatopen/fragments`        | 3.4.7   | 위 두 peer 범위를 동시에 만족     |
| `three`                      | 0.185.1 | peer `>=0.182.0`                  |
| `web-ifc`                    | 0.0.77  | peer `>=0.0.77`                   |
| `camera-controls`            | 3.1.2   | peer `>=3.1.2`                    |

TypeScript는 5.9.3으로 고정한다. typescript-eslint 8.67의 peer 범위(`>=4.8.4 <6.1.0`)를 벗어나지 않기 위해서다.

## 기여 규칙

- 테스트 없이 기능 코드를 추가하지 않는다 (TDD).
- 기능 하나를 하나의 브랜치와 작은 PR로 다룬다. 브랜치 이름은 `feature/`, `fix/`, `chore/`를 쓴다.
- 커밋 메시지는 Conventional Commits를 따른다.
- 결정은 `docs/adr/`에 ADR로 남긴다. ADR이 기준서보다 우선한다.
- 작업 시작 전 [AGENTS.md](AGENTS.md)를 읽는다. IFC 관련 작업은 1절과 2절을 먼저 확인한다.
