# BIM 4D Viewer — 실행하며 따라 만드는 가이드

**첫 목표는 빈 웹 화면을 여는 것입니다.** 상태 문구 → 3D 화면 → IFC 열기 순서로 기능을 붙입니다. 각 단계의 완료 체크리스트를 확인한 뒤 다음 단계로 넘어가세요.

이 문서는 현재 저장소를 별도 폴더에 다시 구현하는 학습용 안내입니다. 제품 로드맵을 변경하지 않습니다.

> 안내 갱신: 2026-09-10. 원본 코드의 파일·import 관계를 확인했습니다. 원본 전체의 테스트·빌드는 2026-09-08에 통과했지만, 아래 중간 단계별 복사본을 모두 만들어 실행한 것은 아닙니다.

## 시작 전에 준비하세요

- **원본 폴더:** 지금 보고 있는 완성된 프로젝트입니다. 읽고 참고하는 데 사용합니다.
- **연습 폴더:** 직접 타이핑할 새 프로젝트입니다. 원본 바깥에 별도로 만드세요. 예: `Documents/bim-viewer-practice`.
- **루트:** 연습 폴더의 최상위 `package.json`이 있는 위치입니다. 아래 명령은 모두 여기에서 실행합니다.

| 표현 | 할 일 |
| ---- | ----- |
| 복사 | 원본 파일을 같은 상대 경로에 그대로 옮깁니다. 설정·시험 데이터에 사용합니다. |
| 타이핑 | 원본 코드를 보며 연습 폴더에 직접 작성합니다. |
| 등록 | 기능을 `main.ts`에서 import하고 `kernel.register(...)`로 연결합니다. |
| Port | 기능이 외부 도구에 요청할 동작을 정한 인터페이스입니다. |
| Panel | 버튼·텍스트·표 등 화면을 담당하는 코드입니다. |
| 단위 테스트 / E2E | 함수·컴포넌트 검사 / 실제 브라우저 동작 검사입니다. |

처음에는 **Node.js 22 이상, pnpm 10.34.5, 편집기, 브라우저**를 준비합니다. Python은 STEP 9, .NET SDK는 STEP 10에서 준비해도 됩니다. 도구 설치는 원본 [README](../README.md)를 참고하세요.

연습 폴더를 편집기로 열고 PowerShell 터미널에서 확인합니다.

```powershell
Get-Location
node --version
pnpm.cmd --version
```

`pnpm.cmd`는 Windows PowerShell의 스크립트 실행 정책에 막히지 않도록 사용하는 명령입니다. `pnpm`과 같은 패키지 관리자를 실행합니다.

## 전체 진행표

| 완료 | 단계 | 끝나면 확인할 수 있는 것 |
| --- | --- | --- |
| ☐ | [STEP 0 — 빈 화면](#step-0) | 브라우저에서 앱 화면 열기 |
| ☐ | [STEP 1 — Kernel](#step-1) | `kernel: started` 문구 |
| ☐ | [STEP 2 — 기본 도메인](#step-2) | 식별자·IFC Header 등의 테스트 통과 |
| ☐ | [STEP 3 — 3D World](#step-3) | 빈 3D 캔버스 생성·해제 |
| ☐ | [STEP 4 — IFC 열기](#step-4) | 벽 모델 표시·해제 |
| ☐ | [STEP 5 — 선택](#step-5) | 클릭한 부재 강조·GlobalId 표시 |
| ☐ | [STEP 6 — 조회와 가시성](#step-6) | 숨김·격리·속성·공간 트리 |
| ☐ | [STEP 7 — 단면과 시점](#step-7) | 단면 생성·시점 저장과 복원 |
| ☐ | [STEP 8 — 일정과 4D](#step-8) | 공정 편집·부재 연결·시간 이동 |
| ☐ | [STEP 9 — Python Worker](#step-9) | IFC 검사·일정 왕복·프로세스 통신 |
| ☐ | [STEP 10 — Windows 앱](#step-10) | 실제 창에서 프로젝트 저장·재열기 |
| ☐ | [STEP 11 — 최종 검증](#step-11) | 전체 검사 후 배포 준비 |

## 매 단계에서 반복할 순서

1. **파일 준비:** 해당 단계의 Port·Events·보조 파일부터 만듭니다.
2. **테스트 먼저:** 해당 `.test.ts`를 옮겨 실행합니다. 구현 파일이 없어서 실패하는 것은 이때만 예상한 결과입니다.
3. **구현:** 원본을 타이핑한 뒤 같은 테스트를 다시 실행합니다. 실패 메시지를 확인하고 고칩니다.
4. **화면 연결:** `main.ts`에 완성한 기능을 등록합니다.
5. **실행 확인:** 빌드·브라우저 검사·완료 체크리스트를 확인합니다.

**main에는 완성한 기능만, index에는 이미 만든 파일만 추가하세요.** 완성본을 처음부터 통째로 옮기면 아직 없는 파일까지 요구합니다.

import에 `./something.js`가 적혀 있어도 원본 파일은 `something.ts`로 만듭니다. 이 저장소의 TypeScript 작성 방식이므로 확장자를 임의로 바꾸지 않습니다.

### 터미널은 두 개로 시작하세요

- **실행용:** `pnpm.cmd dev`를 켜 둡니다. 명령이 끝나지 않고 기다리는 것은 정상입니다. 종료하려면 `Ctrl+C`를 누릅니다.
- **검사용:** 새 터미널에서 빌드·테스트 명령을 실행합니다. 이 터미널도 연습 폴더 루트인지 확인하세요.
- **브라우저:** 개발 화면은 `http://localhost:5173`입니다. E2E는 별도 포트 `4173`을 사용합니다.

처음에는 패키지를 수정할 때마다 `pnpm.cmd build`를 실행합니다. 익숙해지면 마지막의 [자동 빌드 방법](#watch)을 사용하세요.

<a id="step-0"></a>

## STEP 0. 빈 웹 화면 열기

**목표:** 기능 코드 없이 HTML 화면을 엽니다.

### 0-1. 설정 파일을 복사하세요

원본과 같은 경로로 다음 파일을 복사합니다. 버전 숫자와 lockfile은 수정하지 않습니다.

| 위치 | 복사할 파일 |
| --- | --- |
| 루트 | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
| 루트 | `tsconfig.json`, `tsconfig.base.json`, `tsconfig.tests.json` |
| 루트 | `eslint.config.js`, `vitest.config.ts`, `vitest.worker.config.ts`, `playwright.config.ts` |
| 루트 | `.gitignore`, `.gitattributes`, `.prettierrc.json`, `.prettierignore` |
| `apps/viewer-web/` | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` |
| `types/` | `host.d.ts` |
| `packages/contracts/` | `package.json`, `tsconfig.json` |
| `packages/domain/` | `package.json`, `tsconfig.json` |
| `packages/ifc-worker-client/` | `package.json`, `tsconfig.json` |
| `packages/test-fixtures/` | `package.json`, `tsconfig.json` |

`AGENTS.md`와 기준 문서·ADR도 참고할 수 있도록 복사해 두세요. `index.html`은 CSS와 화면 요소를 포함하므로 처음에는 전체를 복사합니다. 버튼은 보이지만 아직 기능이 연결되지 않습니다.

### 0-2. 빈 패키지 파일 네 개를 만드세요

아래 네 파일을 만들고 **각 파일에** `export {};`를 입력합니다.

```text
packages/contracts/src/index.ts
packages/domain/src/index.ts
packages/ifc-worker-client/src/index.ts
packages/test-fixtures/src/index.ts
```

```ts
export {};
```

빌드 설정이 네 패키지를 참조하기 때문에 아직 구현이 없어도 파일은 필요합니다. 나중에 실제 export를 작성할 때 이 한 줄을 교체합니다.

### 0-3. 첫 진입 파일을 만드세요

`apps/viewer-web/src/main.ts`에 입력합니다.

```ts
console.info('BIM viewer scaffold ready');
```

### 0-4. 한 줄씩 실행하세요

앞 명령이 성공한 다음 다음 명령을 실행합니다.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd build
pnpm.cmd dev
```

브라우저에서 `http://localhost:5173`을 열고 `F12` → Console을 확인합니다.

### 0-5. 완료 체크

- [ ] 빌드가 오류 없이 끝났습니다.
- [ ] 앱 제목과 화면 요소가 보입니다.
- [ ] Console에 `BIM viewer scaffold ready`가 나옵니다.

**정상인 상태:** `kernel: booting` 문구, 동작하지 않는 버튼, 빈 뷰어입니다. 이 단계에는 테스트가 없으므로 `pnpm verify` 대신 위 명령만 확인합니다.

**막혔다면:** 패키지를 찾지 못하는 오류는 0-1의 설정과 0-2의 네 파일을 확인하세요. vendor 오류는 `vite.config.ts` 전체가 복사됐는지 확인합니다. `node_modules`, `dist`, `dist-types`, `public/vendor`, `bin`, `obj`는 설치·빌드가 만들므로 복사하지 않습니다.

<a id="step-1"></a>

## STEP 1. Kernel을 켜고 상태 문구 확인하기

**시작 조건:** STEP 0에서 화면이 열립니다. **목표:** `kernel: started`를 표시합니다.

### 1-1. 계약 파일을 타이핑하세요

`packages/contracts/src/`의 파일을 아래 순서로 준비하고, 마지막에 원본의 `index.ts`를 옮깁니다.

```text
errors.ts → identity.ts → events.ts → commands.ts → component.ts
model.ts → modelBinding.ts → schedule.ts → ifcWorker.ts → index.ts
```

계약은 기능 사이에서 주고받을 타입과 인터페이스를 정의합니다. 묶음의 파일을 다 작성한 뒤 import 오류가 남아 있는지 확인합니다.

### 1-2. Kernel과 상태 표시를 만드세요

아래 경로는 `apps/viewer-web/src/` 기준입니다. 행 순서대로 진행합니다.

| 순서 | 준비할 파일 |
| --- | --- |
| 1 | `kernel/testing/testLogger.ts`, `kernel/logger.ts`, `kernel/traceId.ts` |
| 2 | `kernel/eventBus.test.ts` → `kernel/eventBus.ts` |
| 3 | `kernel/commandDispatcher.test.ts` → `kernel/commandDispatcher.ts` |
| 4 | `kernel/testing/testContext.ts` |
| 5 | `kernel/componentRegistry.test.ts` → `kernel/componentRegistry.ts` |
| 6 | `kernel/createKernel.ts`, 마지막에 `kernel/index.ts` |
| 7 | `shell/statusComponent.test.ts` → `shell/statusComponent.ts` |

Event Bus를 만드는 동안에는 이것만 검사할 수 있습니다.

```powershell
pnpm.cmd exec vitest run apps/viewer-web/src/kernel/eventBus.test.ts
```

### 1-3. main.ts를 다음 내용으로 교체하세요

이 단계용 최소 조립 예제입니다. 이후에는 **기능 등록 자리**에 완성한 기능을 추가합니다.

```ts
import type { AppEventName } from '@bim4d/contracts';

import { createKernel } from './kernel/index.js';
import { createStatusComponent } from './shell/statusComponent.js';

const bootstrap = async (): Promise<void> => {
  const kernel = createKernel();

  kernel.register(createStatusComponent({ selector: '[data-testid="kernel-status"]' }));

  // 기능 등록 자리: 이후 단계의 등록 코드는 start보다 위에 둡니다.

  await kernel.start();

  let shuttingDown: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shuttingDown ??= kernel.shutdown();
    return shuttingDown;
  };

  window.bim4d = {
    shutdown,
    subscribe: (eventName, handler) =>
      kernel.context.events.subscribe(eventName as AppEventName, (event) => {
        handler(event.payload);
      }),
  };

  window.addEventListener(
    'pagehide',
    () => { void shutdown(); },
    { once: true },
  );
};

void bootstrap();
```

이 예제는 원본의 기동·종료 연결 방식을 따릅니다. 원본에서 확인된 시작 실패 시 자동 정리 누락은 별도 보완 과제이며, 이 학습 단계에서 해결됐다는 뜻은 아닙니다.

### 1-4. 테스트와 화면을 확인하세요

원본의 `tests/e2e/appBoot.spec.ts`를 같은 경로에 복사합니다. 브라우저 설치는 이 연습 환경에서 처음 한 번 필요합니다.

```powershell
pnpm.cmd exec vitest run apps/viewer-web/src/kernel apps/viewer-web/src/shell/statusComponent.test.ts
pnpm.cmd build
pnpm.cmd exec playwright install chromium
pnpm.cmd exec playwright test tests/e2e/appBoot.spec.ts
```

### 1-5. 완료 체크

- [ ] Kernel과 Status 단위 테스트가 통과합니다.
- [ ] 브라우저를 새로고침하면 `kernel: started`가 보입니다.
- [ ] `appBoot.spec.ts`가 통과합니다.

**막혔다면:** `window.bim4d` 타입 오류는 `types/host.d.ts`, 요소를 찾지 못하는 오류는 원본 `index.html`과 selector를 확인하세요. `booting`에 머물면 Console과 빌드 오류부터 확인합니다.

<a id="step-2"></a>

## STEP 2. 3D에 필요한 기본 도메인 만들기

**시작 조건:** Kernel이 켜집니다. **목표:** 화면 기능에 필요한 순수 함수 네 묶음을 검사합니다.

### 2-1. 테스트와 구현을 순서대로 작성하세요

`packages/domain/src/`에서 각 행의 테스트를 먼저 준비하고, 구현을 작성합니다.

| 순서 | 테스트 → 구현 | 다루는 내용 |
| --- | --- | --- |
| 1 | `productKey.test.ts` → `productKey.ts` | 모델·부재 식별자 |
| 2 | `ifcHeader.test.ts` → `ifcHeader.ts` | IFC Header 판별 |
| 3 | `ifcValue.test.ts` → `ifcValue.ts` | 속성 값 표시 |
| 4 | `spatialTree.test.ts` → `spatialTree.ts` | 공간 트리 구성 |

IFC 코드를 작성하기 전에는 [AGENTS.md](../AGENTS.md)의 절 매핑에 따라 기준서를 읽습니다. Header는 2~4절, 속성은 10~11절, 공간 트리·관계는 9·12절을 참고합니다.

### 2-2. domain의 index.ts를 갱신하세요

원본 `packages/domain/src/index.ts`에서 **위 네 모듈의 export만** 옮깁니다. `RawSpatialNode` 등 `export type`도 포함합니다. 일정 관련 export는 STEP 8에서 추가합니다.

### 2-3. 실행하세요

```powershell
pnpm.cmd exec vitest run packages/domain/src
pnpm.cmd build
```

### 2-4. 완료 체크

- [ ] 네 모듈의 테스트가 통과합니다.
- [ ] 빌드가 성공합니다.
- [ ] 기존 화면이 여전히 열립니다. 이 단계에서 화면이 바뀌지 않는 것은 정상입니다.

**막혔다면:** `schedule` 등 아직 만들지 않은 모듈을 찾는 오류는 domain의 `index.ts`에 나중 단계의 export가 들어갔는지 확인하세요.

<a id="step-3"></a>

## STEP 3. 빈 3D 화면 띄우기

**시작 조건:** STEP 2의 도메인이 빌드됩니다. **목표:** WebGL 캔버스를 만들고 해제합니다.

### 3-1. Port 파일을 먼저 준비하세요

아래 경로는 `apps/viewer-web/src/` 기준입니다.

```text
viewer/viewerWorldPort.ts
viewer/model/modelLoaderPort.ts
viewer/selection/selectionPort.ts
viewer/visibility/visibilityPort.ts
viewer/spatial/spatialTreePort.ts
viewer/property/propertyPort.ts
viewer/section/sectionPort.ts
viewer/camera/cameraPort.ts
simulation/simulationPort.ts
```

**왜 나중 기능의 Port도 필요한가요?** 현재 That Open Adapter 한 파일이 이 인터페이스들을 모두 참조합니다. 이 단계에서는 인터페이스만 준비하며, 나중 기능의 Component를 등록하지 않습니다.

### 3-2. World와 Adapter를 작성하세요

1. `viewer/viewerEvents.ts`를 작성합니다.
2. `viewer/viewerWorldComponent.test.ts` → `viewer/viewerWorldComponent.ts`를 작성합니다.
3. `adapters/thatopen/thatOpenViewerAdapter.ts` 전체를 작성합니다.
4. `tests/e2e/viewerWorld.spec.ts`를 복사합니다.

Adapter는 약 950줄로 이 가이드에서 큰 타이핑 묶음입니다. 원본 파일을 그대로 옮기는 방식에서는 전체 파일이 준비된 뒤 3D 실행을 확인합니다. 중간 저장은 해도 되지만, 절반만 작성한 Adapter의 빌드 통과를 기대하지 않습니다.

### 3-3. main.ts에 두 종류의 코드를 추가하세요

**파일 위쪽의 import 자리에 추가:**

```ts
import { createThatOpenViewerAdapter } from './adapters/thatopen/thatOpenViewerAdapter.js';
import { createViewerWorldComponent } from './viewer/viewerWorldComponent.js';
```

**bootstrap 안에서 `const kernel = createKernel();` 다음에 추가:**

```ts
const viewer = createThatOpenViewerAdapter();
```

**Status 등록 다음, `await kernel.start()` 전에 추가:**

```ts
kernel.register(
  createViewerWorldComponent({
    selector: '[data-testid="viewer-container"]',
    factory: viewer.worldFactory,
  }),
);
```

`viewer`는 이후 단계에서도 같은 인스턴스를 사용합니다. 기능마다 Adapter를 새로 만들지 않습니다.

### 3-4. 실행하고 확인하세요

```powershell
pnpm.cmd exec vitest run apps/viewer-web/src/viewer/viewerWorldComponent.test.ts
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/appBoot.spec.ts tests/e2e/viewerWorld.spec.ts
```

- [ ] 크기가 있는 3D 캔버스가 생깁니다.
- [ ] 브라우저에서 카메라를 조작할 수 있습니다. 아직 모델은 없습니다.
- [ ] E2E의 shutdown 검사에서 캔버스와 WebGL context가 해제됩니다.

**막혔다면:** Adapter의 import 경로, STEP 2의 타입 export, `vite.config.ts`의 vendor 복사를 확인하세요.

## STEP 4부터 적용할 파일·등록 규칙

아래 파일 목록은 **`apps/viewer-web/src/` 기준**입니다. `.ts` 구현 파일에는 원본에 있는 같은 이름의 `.test.ts`도 함께 준비합니다. Port·Events 등 테스트 파일이 없는 항목에는 임의로 만들지 않습니다.

등록은 다음 순서로 합니다.

1. 원본 [main.ts](../apps/viewer-web/src/main.ts)에서 이번 단계의 `create...` import를 찾습니다.
2. 해당 import만 연습 폴더의 main.ts 위쪽에 추가합니다.
3. 필요한 Repository 등의 생성 코드를 bootstrap 안에 추가합니다.
4. 원본의 해당 `kernel.register(...)` 블록을 괄호 끝까지 옮깁니다. selector와 인수도 함께 가져옵니다.
5. 모든 등록은 `await kernel.start()` 위에 둡니다. **원본 main.ts에서의 상대적 등록 순서**를 유지합니다.

`main.ts` 전체를 다시 덮어쓰거나, 이미 등록한 기능을 한 번 더 등록하지 마세요.

<a id="step-4"></a>

## STEP 4. IFC 파일 열고 닫기

**시작 조건:** 3D 캔버스가 보입니다. **목표:** 실제 벽 모델 하나를 엽니다.

### 4-1. 시험 데이터를 복사하세요

`packages/test-fixtures/`에서 `src/`, `ifc/`, `schedule/`, `README.md`를 복사합니다. STEP 0의 빈 src/index.ts는 실제 파일로 교체합니다. 시험 파일은 타이핑하지 않고 그대로 복사해 입력 차이를 없앱니다. 기존 수령 검증 기록도 README에 들어 있습니다.

이번에 열 파일은 `packages/test-fixtures/ifc/minimal-wall-ifc4.ifc`입니다.

### 4-2. 순서대로 작성하세요

1. `shared/sha256.ts`와 테스트.
2. `adapters/inMemoryModelRepository.ts`와 테스트.
3. `viewer/model/modelEvents.ts`.
4. `viewer/model/modelLoadingComponent.ts`와 테스트.
5. `shell/modelPanel.ts`와 테스트.

모델 목록용 `modelListPanel`은 가시성 이벤트에 의존하므로 STEP 6에서 붙입니다. 지금은 파일 열기와 전체 해제만 확인합니다.

### 4-3. main.ts에 연결하세요

- `createInMemoryModelRepository`를 import하고 `const repository = createInMemoryModelRepository();`를 bootstrap의 생성 코드에 추가합니다.
- 원본과 같이 contracts의 type import에 `ModelId`를 추가합니다. 모델 ID 생성 함수의 타입에 필요합니다.
- World 다음에 `createModelLoadingComponent` 등록 블록을 추가합니다. `viewer.modelLoader`, `repository`, `newModelId`를 함께 넘깁니다.
- `createModelPanel` 등록 블록을 추가합니다.
- `tests/e2e/modelLoading.spec.ts`를 복사합니다.

### 4-4. 실행하고 직접 열어보세요

```powershell
pnpm.cmd exec vitest run apps/viewer-web/src/shared apps/viewer-web/src/adapters/inMemoryModelRepository.test.ts apps/viewer-web/src/viewer/model apps/viewer-web/src/shell/modelPanel.test.ts
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/modelLoading.spec.ts
```

- [ ] 파일 선택에서 `minimal-wall-ifc4.ifc`를 열면 벽이 보입니다.
- [ ] 파일명과 IFC4 표시를 확인합니다.
- [ ] 모델을 해제하면 벽이 사라집니다.
- [ ] 적재·해제 E2E가 통과합니다.

**막혔다면:** 로딩 상태가 멈추면 Console의 첫 오류와 vendor 경로를 확인하세요. 클릭해도 부재가 선택되지 않는 것은 정상입니다. 다음 단계에서 연결합니다.

<a id="step-5"></a>

## STEP 5. 클릭한 부재 선택하기

**시작 조건:** IFC를 열 수 있습니다. **목표:** 부재를 클릭하면 강조되고 GlobalId가 보입니다.

### 5-1. 파일을 작성하고 등록하세요

1. `viewer/selection/selectionEvents.ts`를 작성합니다.
2. `viewer/selection/selectionComponent.ts`와 테스트를 작성합니다.
3. `shell/selectionPanel.ts`와 테스트를 작성합니다.
4. main.ts에 `createSelectionComponent`와 `createSelectionPanel`을 등록합니다. 선택 Component에는 `viewer.selection`을 넘깁니다.
5. `tests/e2e/selection.spec.ts`와 `tests/e2e/support/picking.ts`를 복사합니다.

### 5-2. 실행하세요

```powershell
pnpm.cmd exec vitest run apps/viewer-web/src/viewer/selection apps/viewer-web/src/shell/selectionPanel.test.ts
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/selection.spec.ts
```

### 5-3. 완료 체크

- [ ] `three-elements-ifc4.ifc`를 열고 부재를 클릭하면 강조됩니다.
- [ ] 선택한 부재의 GlobalId가 표시됩니다.
- [ ] Ctrl을 누른 채 다른 부재를 클릭하면 다중 선택됩니다.
- [ ] 빈 곳을 클릭하면 선택이 풀립니다.

**막혔다면:** 모델은 보이는데 클릭에 반응하지 않으면 Selection Component 등록과 컨테이너 selector를 확인하세요. GlobalId만 보이지 않으면 Selection Panel 등록을 확인합니다.

<a id="step-6"></a>

## STEP 6. 숨김·격리·속성·공간 트리 붙이기

**시작 조건:** 부재를 선택할 수 있습니다. **목표:** 선택한 부재를 조사하고 표시 상태를 바꿉니다.

### 6-1. 세 묶음으로 나누어 작성하세요

각 묶음의 단위 테스트를 통과시킨 뒤 다음 묶음으로 진행해도 됩니다.

| 순서 | 파일과 해당 테스트 | main.ts에 등록할 함수 |
| --- | --- | --- |
| 1 | `viewer/visibility/visibilityEvents.ts`, `viewer/visibility/visibilityComponent.ts`, `shell/visibilityPanel.ts` | `createVisibilityComponent`, `createVisibilityPanel` |
| 2 | `shell/modelListPanel.ts` | `createModelListPanel` |
| 3 | `shell/propertyPanel.ts`, `shell/spatialPanel.ts` | `createPropertyPanel`, `createSpatialPanel` |

Property Panel에는 `viewer.properties`, Spatial Panel에는 `viewer.spatialTree`를 넘깁니다. 모델 목록은 가시성 이벤트를 사용하므로 1번이 먼저 필요합니다.

### 6-2. 브라우저 테스트 파일을 복사하세요

`tests/e2e/`의 `visibility.spec.ts`, `property.spec.ts`, `spatialTree.spec.ts`, `federation.spec.ts`를 옮깁니다. 이때까지 작성한 테스트를 다음 명령으로 검사합니다.

```powershell
pnpm.cmd test
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/visibility.spec.ts tests/e2e/property.spec.ts tests/e2e/spatialTree.spec.ts tests/e2e/federation.spec.ts
```

### 6-3. 완료 체크

- [ ] 부재를 선택해 숨기고, 전체 표시로 되돌립니다.
- [ ] 격리하면 선택한 부재만 보입니다.
- [ ] 속성 패널에 선택한 부재의 정보가 나옵니다.
- [ ] 공간 트리에서 고른 부재가 화면에서도 선택됩니다.
- [ ] 모델 두 개를 열고 하나를 해제해도 나머지가 유지됩니다.

**막혔다면:** 버튼이 보이는데 동작하지 않으면 Panel뿐 아니라 명령을 처리하는 Visibility Component도 등록됐는지 확인하세요.

<a id="step-7"></a>

## STEP 7. 단면과 시점 저장 붙이기

**시작 조건:** 선택·가시성 기능이 동작합니다. **목표:** 모델을 자르고, 저장한 시점으로 돌아옵니다.

### 7-1. 아래 순서대로 작성하세요

1. `viewer/section/sectionEvents.ts`, `sectionComponent.ts`와 테스트, `shell/sectionPanel.ts`와 테스트.
2. `viewer/camera/cameraEvents.ts`, `cameraComponent.ts`와 테스트.
3. `viewer/viewpoint/viewpointEvents.ts`, `viewpointComponent.ts`와 테스트, `shell/viewpointPanel.ts`와 테스트.

`viewpointEvents.ts`가 `viewpointComponent.ts`의 타입을 참조합니다. 두 파일을 한 묶음으로 준비한 뒤 검사하세요.

### 7-2. 등록하고 실행하세요

main.ts에 `createSectionComponent`, `createCameraComponent`, `createViewpointComponent`, `createSectionPanel`, `createViewpointPanel`의 원본 등록 블록을 추가합니다.

`tests/e2e/section.spec.ts`, `viewpoint.spec.ts`를 복사합니다.

```powershell
pnpm.cmd test
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/section.spec.ts tests/e2e/viewpoint.spec.ts
```

### 7-3. 완료 체크

- [ ] 단면을 만들고 켜기·끄기·해제를 해봅니다.
- [ ] 화면 맞춤으로 모델을 다시 화면에 담습니다.
- [ ] 시점을 저장하고 카메라·가시성·단면을 바꾼 뒤 복원합니다.
- [ ] 관련 E2E가 통과합니다.

**막혔다면:** 시점 복원이 가시성·단면 명령을 사용하므로 STEP 6과 이번 단계의 Component 등록을 함께 확인하세요.

<a id="step-8"></a>

## STEP 8. 일정 편집과 4D 시뮬레이션 연결하기

**시작 조건:** 기본 뷰어 기능이 동작합니다. **목표:** 공정표의 부재 연결과 날짜가 3D 표현에 반영됩니다.

이번 단계는 큽니다. **8-1~8-4에서는 단위 테스트로 확인하고, 8-5에서 화면을 연결합니다.** 작업 중인 기능은 main.ts에 아직 등록하지 않으면 기존 뷰어를 계속 사용할 수 있습니다.

### 8-1. 일정 도메인을 완성하세요

`packages/domain/src/`에서 다음 순서로 각 테스트와 구현을 준비합니다. 한 모듈을 완성할 때마다 필요한 export를 index.ts에 추가합니다.

```text
schedule.ts → scheduleTree.ts → scheduleValidation.ts → scheduleEdit.ts
→ scheduleCsv.ts → modelBinding.ts → simulation.ts
```

마지막에는 원본 domain의 index.ts와 같은 export 구성이 됩니다. 일정 규칙은 ADR-0002·0005·0006·0007·0008을 함께 참고합니다.

```powershell
pnpm.cmd exec vitest run packages/domain/src
```

**중간 확인:** 일정 파싱·편집·CSV·바인딩·시뮬레이션 계산 테스트가 통과합니다. 아직 화면은 바뀌지 않습니다.

### 8-2. 저장소와 이벤트를 준비하세요

아래는 `apps/viewer-web/src/` 기준입니다.

1. `adapters/inMemoryScheduleRepository.ts`와 테스트.
2. `adapters/inMemoryModelRefBinding.ts`와 테스트.
3. `adapters/spatialTreeProducts.ts`.
4. `scheduler/schedulerEvents.ts`, `simulation/simulationEvents.ts`.

현재 `ModelRefBindingRegistry` 인터페이스는 `inMemoryModelRefBinding.ts`에 있습니다. 이름이 비슷한 contracts의 읽기용 Port만 준비하면 쓰기용 인터페이스가 없어 다음 단계가 막힙니다.

### 8-3. 동작을 처리하는 Component를 만드세요

1. `scheduler/schedulerComponent.ts`와 테스트.
2. `scheduler/modelBindingComponent.ts`와 테스트.
3. `simulation/simulationComponent.ts`와 테스트.

ModelBinding의 테스트가 Scheduler Component도 사용하므로 **타이핑은 Scheduler부터** 합니다. main.ts의 **등록 순서는 아래 8-5를 따릅니다.**

```powershell
pnpm.cmd exec vitest run apps/viewer-web/src/scheduler apps/viewer-web/src/simulation
```

**중간 확인:** 일정을 바꾸고 부재를 연결했을 때 상태가 올바르게 계산됩니다.

### 8-4. 일정 화면을 만드세요

`apps/viewer-web/src/shell/`에서 다음 순서로 준비합니다. 원본에 있는 해당 테스트도 함께 가져옵니다.

```text
scheduleRowEditing.ts → scheduleAssignmentEditing.ts → scheduleTablePanel.ts
schedulerPanel.ts → simulationPanel.ts
```

`scheduleTablePanel.ts`는 앞의 두 편집 보조 파일을 사용합니다. 표 패널만 먼저 옮기지 마세요.

```powershell
pnpm.cmd test
```

**중간 확인:** 이때까지 옮긴 기본 단위 테스트가 모두 통과합니다. 실제 Python Worker 테스트는 STEP 9에서 따로 실행합니다.

### 8-5. main.ts에 조립하세요

원본 main.ts에서 다음 생성 코드와 관련 import를 옮깁니다.

```ts
const scheduleRepository = createInMemoryScheduleRepository();
const modelRefBinding = createInMemoryModelRefBinding();
```

기존 기능을 유지하면서 아래 등록 블록을 원본과 같은 위치에 추가합니다.

| 순서 | 등록할 함수 | 필요한 연결 |
| --- | --- | --- |
| 1 | `createModelBindingComponent` | `modelRefBinding`, `scheduleRepository`, `createSpatialTreeProducts(viewer.spatialTree)` |
| 2 | `createSchedulerComponent` | `scheduleRepository` |
| 3 | `createSimulationComponent` | `viewer.simulation`, `scheduleRepository`, `modelRefBinding` |
| 4 | `createSchedulerPanel` | 파일 입력·일정·경고·내보내기 selector |
| 5 | `createScheduleTablePanel` | 표·축·행 selector, `modelRefBinding` |
| 6 | `createSimulationPanel` | 시간·재생·배속 selector |

길이가 긴 Panel 설정은 원본 등록 블록 전체를 옮기세요. HTML을 처음에 복사했다면 selector를 새로 만들 필요가 없습니다.

### 8-6. 브라우저 테스트를 준비하고 실행하세요

`tests/e2e/`에서 다음 파일을 복사합니다.

- `scheduler.spec.ts`, `assignment.spec.ts`, `modelReplacement.spec.ts`
- `simulation.spec.ts`, `scheduleLayout.spec.ts`
- `scheduleLayout.spec.ts-snapshots/` 안의 원본 기준 이미지

```powershell
pnpm.cmd build
pnpm.cmd exec playwright test tests/e2e/scheduler.spec.ts tests/e2e/assignment.spec.ts tests/e2e/modelReplacement.spec.ts tests/e2e/simulation.spec.ts tests/e2e/scheduleLayout.spec.ts
```

`scheduler.spec.ts` 안에도 시뮬레이션 검사가 있습니다. Scheduler만 만든 8-3 중간 상태에서 이 파일 전체가 통과할 것으로 기대하지 마세요.

### 8-7. 직접 확인하세요

1. `three-elements-ifc4.ifc`를 엽니다.
2. `packages/test-fixtures/schedule/mock-three-elements.json`을 엽니다.
3. Task 이름과 날짜를 편집하고 표·막대가 바뀌는지 봅니다.
4. 부재를 선택해 Task에 연결합니다.
5. 시간 슬라이더를 앞뒤로 움직이고 부재 상태를 확인합니다.
6. JSON 또는 CSV로 내보내고 다시 읽어봅니다.

- [ ] 일정·연결·시뮬레이션이 함께 동작합니다.
- [ ] 편집 중에도 표의 칸과 막대가 어긋나지 않습니다.
- [ ] 단위 테스트와 해당 E2E가 통과합니다.

**막혔다면:** 시간이 움직여도 부재가 바뀌지 않으면 fixture의 모델 이름과 바인딩, 세 Component의 등록 순서를 확인하세요. 스크린샷 검사가 실패하면 기준 이미지 복사 여부와 실제 배치를 먼저 비교합니다. 통과시키기 위해 기준선을 무조건 갱신하지 않습니다.

<a id="step-9"></a>

## STEP 9. Python Worker 실행하기

**시작 조건:** 웹의 일정·4D가 동작합니다. **목표:** IFC 검사·일정 입출력과 실제 프로세스 통신을 검사합니다.

### 9-1. Python 환경을 준비하세요

CI·동봉 런타임과 맞추기 위해 Python 3.13 환경을 준비합니다. `python --version`으로 현재 터미널이 사용하는 버전을 확인하세요.

`services/ifc-worker/`의 requirements 파일, `pytest.ini`, 패키지 초기화 파일, `tests/`, `tools/`와 README를 준비합니다. 원본과 같은 경로를 유지합니다.

### 9-2. Worker를 작성하고 검사하세요

`services/ifc-worker/ifc_worker/`는 다음 순서로 읽고 작성하면 흐름을 따라가기 쉽습니다.

```text
protocol.py → inspection.py / schedule_io.py → handlers.py → loop.py → __main__.py
```

```powershell
python --version
python -m pip install -r services/ifc-worker/requirements-dev.txt
python -m pytest services/ifc-worker
```

### 9-3. TypeScript 클라이언트를 준비하세요

`packages/ifc-worker-client/src/stdioIfcWorker.test.ts`와 `stdioIfcWorker.ts`, 마지막에 실제 `index.ts`를 준비합니다. STEP 0의 빈 index를 교체합니다.

```powershell
pnpm.cmd build
pnpm.cmd test:worker
```

### 9-4. 완료 체크

- [ ] Python의 IFC 검사·일정 왕복 테스트가 통과합니다.
- [ ] 실제 Worker를 띄우는 IPC·timeout·재시작 테스트가 통과합니다.
- [ ] 웹 화면이 이전처럼 동작합니다. 이 단계에서 웹에 새 메뉴가 생기지는 않습니다.

**막혔다면:** `No module named ...`는 패키지를 설치한 Python과 테스트를 실행한 Python이 같은 환경인지 확인하세요. 아직 Desktop 도구가 없으므로 그 테스트까지 실행하는 `pnpm test:python`은 STEP 10에서 사용합니다.

<a id="step-10"></a>

## STEP 10. Windows 창에서 프로젝트 저장하기

**시작 조건:** 웹과 Worker가 각각 동작합니다. **목표:** 실제 앱 창에서 저장·재열기를 확인합니다.

### 10-1. 데스크톱 실행 환경과 설정을 준비하세요

.NET 10 SDK와 WebView2 런타임을 준비합니다. 다음 명령으로 SDK를 확인합니다.

```powershell
dotnet --version
```

`apps/desktop/`의 `Bim4d.Desktop.slnx`, `Directory.Build.props`, 프로젝트별 `.csproj`, XAML, 테스트·도구 설정을 원본 경로에 맞게 준비합니다. 세부 실행 환경은 [Desktop README](../apps/desktop/README.md)를 참고합니다.

### 10-2. Core → WPF 순서로 작성하세요

1. `apps/desktop/src/Bim4d.Desktop.Core/`와 해당 테스트를 준비합니다. Worker·ModelBridge·ProjectStore·ProjectSession의 역할부터 읽습니다.
2. `apps/desktop/src/Bim4d.Desktop/`의 App·MainWindow 등 WPF 코드를 작성합니다.
3. `apps/desktop/tools/`와 그 테스트를 준비합니다.

현재 MainWindow는 여러 Core 서비스를 함께 사용합니다. 창 실행은 이 묶음이 완성된 뒤 확인합니다.

### 10-3. 웹에 셸 연결을 추가하세요

`apps/viewer-web/src/shell/shellBridgeComponent.ts`와 테스트를 작성하고, main.ts에 `createShellBridgeComponent()`를 원본 위치에 등록합니다.

이제 원본 main.ts와 연습 폴더의 main.ts를 비교해 누락된 생성·등록 블록이 있는지 확인합니다.

### 10-4. 검사한 뒤 앱을 켜세요

```powershell
dotnet build apps/desktop --nologo
pnpm.cmd shell:test
pnpm.cmd test:python
pnpm.cmd build
pnpm.cmd shell
```

셸은 웹의 빌드 결과인 `apps/viewer-web/dist`를 읽습니다. 웹 개발 서버를 켜 둔 것만으로 셸의 화면이 갱신되지는 않습니다.

### 10-5. 직접 저장·재열기를 확인하세요

1. Windows 창에서 IFC와 일정을 엽니다.
2. Task를 편집하고 부재를 연결합니다.
3. 프로젝트를 `.bim4d` 파일로 저장합니다.
4. 앱을 완전히 닫고 다시 실행합니다.
5. 저장한 프로젝트를 다시 엽니다.

- [ ] 모델 참조·일정·부재 연결이 복원됩니다.
- [ ] C#과 Python 도구 테스트가 통과합니다.
- [ ] 실제 창에서 수동 시나리오를 끝냈습니다. 테스트 통과와 별도로 확인합니다.

**막혔다면:** 웹은 되는데 Windows 창만 안 되면 WebView2 런타임, `pnpm.cmd build` 실행 여부, 앱 로그를 확인하세요.

<a id="step-11"></a>

## STEP 11. 전체 검증 후 배포 준비하기

**시작 조건:** 모든 기능을 옮겼습니다. **목표:** 부분 검사에서 빠진 누락을 최종 확인합니다.

### 11-1. 원본과 누락 파일을 비교하세요

지금까지 뒤로 미뤘던 각 폴더의 `index.ts`, 나머지 테스트와 설정을 확인합니다. 전체 기능이 준비됐다면 원본의 export 구성을 완성합니다. CI까지 구성하려면 원본 `.github/workflows/`도 준비합니다.

### 11-2. 전체 검사를 실행하세요

```powershell
pnpm.cmd verify
pnpm.cmd format:check
pnpm.cmd test:e2e
pnpm.cmd test:worker
pnpm.cmd test:python
pnpm.cmd shell:test
dotnet build apps/desktop --nologo
```

`verify`는 타입·lint·기본 단위 테스트·웹 빌드입니다. Python, Worker, C#, E2E, format 검사는 별도로 실행해야 전체 범위를 확인할 수 있습니다.

### 11-3. 완료 체크

- [ ] 전체 명령이 통과합니다.
- [ ] STEP 10의 저장·재열기를 실제 창에서 다시 확인했습니다.
- [ ] 아직 확인하지 못한 환경이나 경고는 따로 기록했습니다.

배포 파일이 필요할 때는 [Desktop README](../apps/desktop/README.md)의 `shell:publish` → `shell:installer` 또는 `shell:zip` 순서로 진행합니다. 설치 프로그램에는 Inno Setup 등 추가 도구가 필요합니다. 개발 실행을 위해 설치 프로그램까지 만들 필요는 없습니다.

<a id="watch"></a>

## 익숙해지면: 패키지를 자동으로 빌드하기

첫 빌드가 성공한 뒤부터 사용할 수 있습니다.

```powershell
# 패키지 감시용 터미널
pnpm.cmd dev:packages
```

```powershell
# 웹 실행용 터미널
pnpm.cmd dev
```

브라우저는 workspace 패키지의 `dist`를 읽고 Vitest는 `src`를 읽습니다. domain을 고쳤는데 화면은 그대로라면 패키지 빌드가 갱신됐는지 확인하세요.

별도의 빌드·검증 명령을 실행할 때는 같은 산출물을 동시에 쓰지 않도록 감시용 터미널을 `Ctrl+C`로 잠시 중지합니다. 검사 후 감시 명령을 다시 켭니다.

## 막혔을 때 먼저 확인할 것

| 증상 | 먼저 할 일 |
| --- | --- |
| `pnpm.ps1` 실행 정책 오류 | 이 문서처럼 `pnpm.cmd`로 실행합니다. |
| `package.json`을 찾지 못함 | `Get-Location`으로 연습 폴더 루트인지 확인합니다. |
| 존재하지 않는 모듈을 요구함 | 해당 파일과 선행 단계, 너무 일찍 복사한 `index.ts` export를 확인합니다. |
| 타입·테스트는 새 코드인데 화면은 예전 모습 | `pnpm.cmd build` 후 새로고침합니다. 셸은 재실행합니다. |
| `already registered` | main.ts에서 같은 Component를 두 번 등록했는지 확인합니다. |
| `요소를 찾지 못했다` | 원본 HTML의 `data-testid`와 Panel의 selector를 비교합니다. |
| `No tests found` | 해당 테스트 파일을 옮겼는지, 파일명·실행 경로가 맞는지 확인합니다. |
| Playwright 실행 파일을 찾지 못함 | `pnpm.cmd exec playwright install chromium`을 실행합니다. |
| 포트가 사용 중 / 다른 프로젝트 화면이 열림 | 5173·4173을 쓰는 본인의 이전 dev/preview 터미널을 종료하고 다시 실행합니다. |
| 스크린샷 기준 이미지가 없음 | 원본의 `scheduleLayout.spec.ts-snapshots/`를 복사했는지 확인합니다. |

실패하면 **마지막 단계에서 추가한 파일과 첫 오류부터** 확인하세요. 아직 구현하지 않은 기능의 테스트를 삭제하거나 약화해 전체 통과를 만들지 않습니다. 의도한 화면 변경이 아닌데 screenshot 기준선을 갱신하지 않습니다.

## 오늘 작업을 끝낼 때 남길 메모

다음 양식을 복사해 연습 기록에 적어 두면 다음 날 바로 이어갈 수 있습니다.

```text
마지막 완료 단계: STEP __ / 세부 단계 __-__
오늘 작성한 파일:
통과한 명령:
화면에서 직접 확인한 동작:
남아 있는 첫 오류:
다음에 시작할 파일:
```

도움을 요청할 때는 단계 번호, 실행한 명령, 첫 오류 메시지, 마지막으로 수정한 파일을 함께 알려주세요. 전체 코드를 다시 설명하지 않아도 이어서 확인하기 쉽습니다.

