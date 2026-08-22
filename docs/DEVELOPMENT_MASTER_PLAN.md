# BIM 4D Viewer 개발 마스터 계획

> 상태: **승인됨 (Approved)** — 2026-08-21 승인, Phase 0 실행 중  
> 작성일: 2026-08-21  
> 대상 저장소: `RealChestnut/260821_bimviewerbuild`

## 1. 제품 목표

특정 BIM 모델링 제품에 종속되지 않고, 다양한 도구에서 내보낸 IFC 모델을 불러와 다음 작업을 수행하는 Windows용 독립 실행형 4D BIM 애플리케이션을 개발한다.

1. IFC 모델을 빠르고 안정적으로 표시한다.
2. IFC 객체를 선택·검색·분류·숨김·격리·단면 처리한다.
3. 독립적인 공정표를 작성하거나 외부 공정표를 가져온다.
4. IFC 객체와 공정 작업을 연결한다.
5. 날짜 또는 시간에 따른 시공·철거 상태를 3D로 시뮬레이션한다.
6. 프로젝트 결과를 저장하고 다시 열 수 있다.
7. 필요할 때 4D 정보를 IFC로 내보낸다.

본 제품은 IFC 모델러나 편집기를 직접 구현하지 않는다. Bonsai, Revit, Archicad, Tekla 등은 외부 모델 작성 도구이며 제품의 필수 런타임 의존성이 아니다.

## 2. 범위

### 2.1 1차 제품 범위

- Windows x64 데스크톱 애플리케이션
- IFC2x3, IFC4 우선 지원
- 단일 IFC 모델 로딩 후 복수 모델 연합으로 확장
- Viewer 기본 기능
- 내부 Scheduler 기본 기능
- 객체와 Task 수동 연결
- Construct 및 Demolish 4D 상태 표현
- 프로젝트 저장·불러오기
- 설치 프로그램 배포

### 2.2 초기 범위에서 제외

- BIM 형상 모델링 및 IFC 저작 도구
- Primavera 수준의 전체 CPM/자원 평준화 기능
- 5D 원가 기능
- 다중 사용자 실시간 협업
- 클라우드 서비스 필수화
- 모바일 및 macOS 배포
- 원본 IFC 자동 덮어쓰기

## 3. 핵심 아키텍처 결정

아키텍처는 **Typed Event-Driven Modular Monolith + Ports/Adapters + Vertical Slice**를 사용한다.

### 3.1 실행 구조

```text
C# WPF Desktop Shell
 ├─ WebView2
 │   └─ TypeScript Viewer Application
 │       ├─ That Open Components
 │       ├─ Viewer Features
 │       ├─ Scheduler UI
 │       └─ 4D Simulation UI
 │
 ├─ Python Worker Process
 │   ├─ IfcOpenShell
 │   ├─ Ifc4D / Sequence
 │   └─ IFC Validation / Export
 │
 └─ Local Project Store
     ├─ SQLite
     ├─ Model metadata
     ├─ Schedule
     └─ Task–Product assignments
```

### 3.2 각 기술의 책임

| 영역 | 기술 | 책임 |
|---|---|---|
| Desktop Host | C#/.NET/WPF | 창, 메뉴, 파일 대화상자, 프로세스 관리, 설치·업데이트 |
| Web Container | WebView2 | TypeScript UI와 3D Viewer 실행 |
| Viewer | That Open Components, Three.js | IFC/Fragments 표시, 선택, 강조, 단면, 가시성 |
| UI | TypeScript, Vite, React | Viewer UI, Scheduler, Gantt, 설정 화면 |
| IFC Backend | Python, IfcOpenShell, Ifc4D | IFC 의미 해석, 일정 관계, 검증, IFC 내보내기 |
| Project Data | SQLite + JSON DTO | 일정, 연결, 설정, 이력 저장 |
| Testing | Vitest, Playwright, xUnit, pytest | 단위·계약·통합·E2E 테스트 |
| Packaging | .NET self-contained + MSI/Setup EXE | 사용자 배포 |

### 3.3 의존성 방향

- Domain은 That Open, WPF, IfcOpenShell을 직접 참조하지 않는다.
- Feature는 Port 인터페이스에만 의존한다.
- That Open, WebView2, SQLite, IfcOpenShell은 Adapter로 구현한다.
- 모듈 간 대형 객체나 Three.js 객체를 전달하지 않는다.
- 모듈 간 영구 객체 식별자는 `modelId + IfcRoot.GlobalId`를 사용한다.

## 4. 모듈 구성

### 4.1 Kernel

- Component Registry
- Typed Event Bus
- Command Dispatcher
- 공통 오류 모델
- 로깅 및 추적 ID
- 생명주기 관리: initialize, start, stop, dispose

### 4.2 Viewer

- World/Scene
- Model Loader
- Selection
- Visibility
- Isolation
- Classification
- Property Panel
- Clipping
- Camera/Viewpoint
- Viewer State
- Model Unload/Dispose

### 4.3 Scheduler

- Task CRUD
- WBS 계층
- 시작일·종료일·기간
- 선후행 관계
- 캘린더
- Gantt UI
- 기준일 및 시뮬레이션 시간
- 실제 진도 확장 지점

### 4.4 Matching

- 선택 객체를 Task에 연결
- Task별 GlobalId 목록 관리
- 연결 해제 및 재연결
- IFC 교체 시 동일 GlobalId 자동 유지
- 삭제·신규·변경 객체 탐지
- 향후 속성/형상 기반 후보 추천

### 4.5 Simulation

- NOT_STARTED
- IN_PROGRESS
- COMPLETED
- DEMOLITION_PENDING
- DEMOLISHING
- REMOVED
- TEMPORARY
- 상태별 색상·투명도·가시성 정책

### 4.6 Project

- 프로젝트 생성·저장·열기
- 모델 파일 참조와 SHA-256 fingerprint
- Schedule 저장
- Task–Product 연결 저장
- 애플리케이션 설정
- 스키마 버전과 마이그레이션

## 5. 통신 규칙

### 5.1 Command

특정 기능 하나에 수행을 요청한다. Command Handler는 원칙적으로 하나다.

```text
LoadModel
UnloadModel
SelectProducts
AssignProductsToTask
SetSimulationTime
```

### 5.2 Event

이미 발생한 사실을 알린다. 구독자는 0개 이상일 수 있다.

```text
ModelLoaded
ModelLoadFailed
SelectionChanged
ProductsAssignedToTask
SimulationTimeChanged
SimulationStateChanged
```

### 5.3 Query

명확한 Port나 Repository에서 값을 조회한다.

```text
GetProductProperties
GetCurrentSelection
GetTasks
GetTaskAssignments
```

### 5.4 금지 규칙

- Event Bus로 IFC 전체 바이트, Mesh, Fragment 전체 데이터를 전달하지 않는다.
- 이벤트 이름을 코드 곳곳에 문자열로 직접 작성하지 않는다.
- Event Handler에서 다시 같은 Event를 무조건 발행하지 않는다.
- 조회 응답을 Pub/Sub로 구현하지 않는다.
- 모듈이 다른 모듈의 내부 상태를 직접 수정하지 않는다.

## 6. 데이터 전략

### 6.1 원본 IFC

- 기본적으로 읽기 전용으로 취급한다.
- 즉시 수정하거나 덮어쓰지 않는다.
- 모델 버전 식별을 위해 파일 fingerprint를 저장한다.
- STEP ID는 영구 연결 키로 사용하지 않는다.

### 6.2 내부 프로젝트 데이터

```text
Project
 ├─ Models
 │   ├─ modelId
 │   ├─ sourcePath
 │   ├─ fingerprint
 │   └─ schema
 ├─ Tasks
 ├─ Calendars
 ├─ Dependencies
 ├─ Assignments
 │   ├─ taskId
 │   ├─ modelId
 │   ├─ productGlobalId
 │   └─ operation
 └─ ViewerState
```

### 6.3 IFC 내보내기

내부 4D 데이터가 안정화된 이후 IfcOpenShell을 통해 선택적으로 다음을 생성한다.

- IfcWorkSchedule
- IfcTask
- IfcTaskTime
- IfcRelSequence
- IfcRelAssignsToProduct
- IfcRelAssignsToProcess

## 7. 저장소 구조

```text
apps/
 ├─ viewer-web/          TypeScript Viewer와 Scheduler UI
 └─ desktop/             C# WPF Shell
services/
 └─ ifc-worker/          Python IfcOpenShell Worker
packages/
 ├─ contracts/           Command, Event, DTO
 ├─ domain/              순수 도메인 규칙
 └─ test-fixtures/       IFC와 일정 fixture
tests/
 ├─ integration/
 ├─ e2e/
 └─ performance/
docs/
 ├─ DEVELOPMENT_MASTER_PLAN.md
 ├─ architecture/
 └─ adr/
```

## 8. 개발 전략

### 8.1 Viewer-first

첫 번째 제품 수직 기능은 다음 한 줄로 정의한다.

> IFC 파일 열기 → 3D 표시 → 객체 클릭 → 강조 → GlobalId 표시 → 모델 해제

이 기능으로 렌더링, WASM, Worker, 객체 식별, Event Bus, 오류 처리, 메모리 해제를 함께 검증한다.

### 8.2 기능 단위 Vertical Slice

각 기능은 독립된 폴더 안에 다음을 함께 둔다.

```text
features/selection/
 ├─ SelectionComponent.ts
 ├─ SelectionState.ts
 ├─ SelectionEvents.ts
 ├─ SelectionComponent.test.ts
 ├─ Selection.e2e.spec.ts
 └─ index.ts
```

기능은 한 번에 하나만 구현하고 검증 후 병합한다.

### 8.3 컴포넌트 생명주기

모든 장기 실행 기능은 다음 계약을 구현한다.

```ts
interface AppComponent {
  readonly id: string;
  initialize(context: AppContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

`dispose()` 검증은 Viewer 기능의 필수 완료 조건이다.

## 9. 단계별 로드맵

### Phase 0 — 저장소와 품질 기반

- Monorepo 또는 단일 Workspace 초기화
- TypeScript strict mode
- ESLint/Prettier
- Vitest
- Playwright
- 테스트용 소형 IFC fixture
- GitHub Actions
- Architecture Decision Record 템플릿
- Feature 작업 템플릿

완료 기준:

- 빈 애플리케이션 build 성공
- 단위 테스트와 브라우저 테스트가 로컬 및 CI에서 성공
- 실패하는 테스트가 CI를 차단

### Phase 1 — Viewer Kernel

- Component Registry
- Typed Event Bus
- Command Dispatcher
- ModelRepository Port
- That Open Adapter 초기화
- 공통 오류와 로깅

완료 기준:

- 컴포넌트 등록·중복·시작·종료·해제 테스트 통과
- Event subscribe/unsubscribe/error-isolation 테스트 통과

### Phase 2 — 첫 Viewer Vertical Slice

- 로컬 IFC 선택
- 모델 로딩 진행률
- 렌더링
- 객체 단일 선택
- 선택 강조
- GlobalId 표시
- 모델 해제

완료 기준:

- 고정 IFC fixture가 브라우저와 WebView2에서 열린다.
- 객체 선택 시 `SelectionChanged`가 정확히 한 번 발생한다.
- 모델 해제 후 Scene과 Repository에 잔여 모델이 없다.
- 연속 10회 load/unload에 치명적 오류가 없다.

### Phase 3 — Viewer 업무 기능

- 다중 선택
- 숨김·표시·격리
- IFC 공간 구조와 분류
- 속성 패널
- 단면
- 카메라 및 Viewpoint
- 복수 모델 연합

항목별 착수 시점은 각 항목의 첫 소비자에 맞춰 재배치했다 (`docs/adr/0005-phase3-item-sequencing.md`). 항목을 줄이지 않으며, Phase 3은 마지막 항목이 끝날 때 닫힌다.

| 순서 | 작업 | 소속 |
|---|---|---|
| 1 | 복수 모델 연합 | Phase 3 |
| 2 | Mock 4D Simulation | Phase 4 |
| 3 | 단면, 카메라 조작 | Phase 3 |
| 4 | Scheduler, Viewpoint 저장·복원 | Phase 5 + Phase 3 |
| 5 | IFC 공간 구조와 분류, 속성 패널 | Phase 3 |
| 6 | IFC–Task Matching | Phase 6 |

완료 기준:

- 두 개 이상의 모델을 동시에 열고 모델별로 해제할 수 있다. 한 모델을 해제해도 나머지 모델의 선택·가시성이 유지된다.
- 부재의 영구 키(`modelId + GlobalId`)가 모델 경계를 지킨다. 같은 GlobalId가 두 모델에 있어도 한쪽만 대상이 된다.
- 단면이 켜진 상태에서 선택과 숨김이 정상 동작한다.
- 저장한 Viewpoint를 복원하면 카메라 위치·시선이 저장 시점과 같다.
- 공간 계층 트리가 Project–Site–Building–Storey–부재로 나오고, 트리에서 고른 노드가 Viewer 선택과 연동된다.
- 속성 패널이 선택 부재의 원본 Pset과 Qto를 빠짐없이 보여 준다.

### Phase 4 — Mock 4D Simulation

- 고정 JSON 일정 fixture
- 시간 슬라이더
- 재생·정지·배속
- 상태 계산 엔진
- 상태별 Viewer 표현
- Construct/Demolish 처리

완료 기준:

- 동일 입력과 시간에는 항상 동일 상태가 계산된다.
- 타임라인 이동 시 연결된 객체만 변경된다.
- 앞뒤로 시간을 이동해도 상태가 누적되지 않는다.

### Phase 5 — Scheduler

- Task CRUD
- WBS
- 기본 선후행
- Gantt
- 일정 검증
- JSON/CSV 가져오기·내보내기

### Phase 6 — IFC–Task Matching

- Viewer 선택 객체를 Task에 할당
- Task 선택 시 연결 객체 강조
- 미연결 객체와 미연결 Task 필터
- 모델 교체 및 GlobalId 재매칭
- 연결 충돌 검증

### Phase 7 — IfcOpenShell Worker

- Python 런타임 패키징
- Worker 프로세스 관리
- IPC 계약
- IFC metadata 검증
- Ifc4D 일정 가져오기·내보내기
- Worker timeout/crash/restart 처리

### Phase 8 — C# Desktop Shell

- WPF Shell
- WebView2 통합
- 파일 대화상자
- 최근 프로젝트
- Python Worker 관리
- 로그와 오류 리포트
- 설정

### Phase 9 — 배포

- .NET self-contained Windows x64
- Web assets 포함
- Python/IfcOpenShell runtime 포함
- WebView2 Evergreen 우선, 폐쇄망용 Fixed Version 선택 제공
- Setup EXE 또는 MSI
- 설치·업데이트·제거 테스트
- 코드 서명 준비

## 10. TDD와 검증 전략

### 10.1 Red–Green–Refactor

1. 수용 조건을 Given–When–Then으로 작성한다.
2. 실패하는 테스트를 먼저 추가한다.
3. 최소 구현으로 테스트를 통과시킨다.
4. 공개 계약을 유지하며 리팩터링한다.
5. 전체 회귀 테스트를 수행한다.

### 10.2 테스트 계층

| 계층 | 대상 | 도구 |
|---|---|---|
| Unit | 상태 계산, Event Bus, 식별·매칭 알고리즘 | Vitest/xUnit/pytest |
| Contract | Port/Adapter 및 IPC DTO 계약 | Vitest/pytest |
| Integration | That Open+fixture IFC, SQLite, Python Worker | Vitest/Playwright/pytest |
| E2E | 파일 열기부터 시뮬레이션까지 | Playwright + Desktop smoke test |
| Visual | 핵심 Viewer 장면의 의도치 않은 변화 | 제한적 screenshot regression |
| Performance | 모델 로딩, 시간 이동, 메모리 해제 | 고정 benchmark fixture |

### 10.3 초기 품질 게이트

- TypeScript typecheck 오류 0개
- lint 오류 0개
- 관련 단위 테스트 100% 통과
- 전체 회귀 테스트 100% 통과
- 새 공개 계약은 계약 테스트 필수
- Viewer 변경은 최소 1개 브라우저 통합 테스트 필수
- 빌드 성공
- 수동 수용 시나리오 확인

성능 기준은 실제 표준 모델 fixture가 선정된 후 수치화한다. 임의의 성능 수치를 먼저 고정하지 않는다.

## 11. AI 기능 위임 프로세스

AI 작업은 반드시 하나의 기능 단위로 제한한다.

### 11.1 작업 패킷

```text
Feature:
목적:
사용자 시나리오:
입력:
출력:
발행 Command/Event:
구독 Command/Event:
변경 허용 경로:
변경 금지 경로:
선행 테스트:
수용 조건:
성능·메모리 조건:
완료 검증 명령:
```

### 11.2 AI 작업 규칙

- 코드를 작성하기 전에 관련 기존 코드와 테스트를 읽는다.
- 테스트를 먼저 작성하고 실패 이유를 확인한다.
- 허용된 파일 범위를 벗어나면 작업을 중단하고 승인을 요청한다.
- 공개 Event/Command/Port 변경은 별도 아키텍처 승인을 받는다.
- 테스트를 삭제하거나 약화해 통과시키지 않는다.
- 관련 없는 리팩터링을 섞지 않는다.
- 구현 완료 주장을 하기 전에 테스트 결과를 제시한다.

### 11.3 Definition of Done

- 수용 조건 충족
- 테스트 추가 및 통과
- build/typecheck/lint 통과
- 오류 및 dispose 경로 구현
- 공용 계약 문서화
- 관련 없는 변경 없음
- 사용자 기능 확인 완료

## 12. Git 및 GitHub 프로세스

원격 저장소:

```text
origin = https://github.com/RealChestnut/260821_bimviewerbuild.git
```

### 12.1 브랜치

```text
main                 안정 기준선
feature/<name>       기능
fix/<name>           버그 수정
chore/<name>         도구·설정
```

### 12.2 커밋 원칙

- 기능 하나당 작고 검증 가능한 커밋
- 관련 파일만 명시적으로 stage
- 빌드 산출물, runtime, 자격 증명은 커밋 금지
- 커밋 메시지는 Conventional Commits 사용

```text
feat(viewer): add single object selection
test(viewer): cover selection disposal
fix(loader): release model resources on failure
docs(architecture): define event contract rules
```

### 12.3 병합 게이트

- CI 통과
- 수용 조건 확인
- 변경 범위 검토
- 공개 계약 호환성 확인
- 필요 시 사용자 화면 확인

초기 저장소가 안정화되기 전에는 자동으로 `main`에 대규모 변경을 누적하지 않는다. 기능 브랜치와 작은 PR을 기본으로 한다.

## 13. 개발 도구

### 필수

- Visual Studio: WPF/C# 개발과 Windows 디버깅
- Visual Studio Code 또는 동등 IDE: TypeScript/Python
- Git/GitHub
- Node.js 패키지 관리자: 프로젝트 초기화 시 npm 또는 pnpm 중 하나로 고정
- Python 가상환경 및 고정 버전
- Chrome/Edge DevTools
- Blender+Bonsai: 참조·검증용 선택 도구

### 라이브러리

- `@thatopen/components`
- `@thatopen/components-front`
- `@thatopen/fragments`
- `three`
- `web-ifc`
- `ifcopenshell`

정확한 버전은 Phase 0에서 공식 호환성을 확인한 뒤 lockfile로 고정한다. 무조건 `latest`에 의존하지 않는다.

## 14. 주요 위험과 대응

| 위험 | 대응 |
|---|---|
| 모델링 제품별 IFC 품질 차이 | Import validation, fixture corpus, Adapter 격리 |
| STEP ID 변경 | GlobalId 기반 연결 |
| 모델 교체 시 GlobalId 변경 | fingerprint, 변경 탐지, 후보 재매칭 |
| 대형 모델 브라우저 메모리 | Fragments, Worker, 지연 로딩, dispose 테스트 |
| Event Bus 남용 | Command/Event/Query 규칙과 계약 테스트 |
| C#·TS·Python 디버깅 복잡성 | 프로세스 경계, correlation ID, 구조화 로그 |
| Python 배포 크기와 DLL 충돌 | 격리 runtime, x64 고정, 설치 smoke test |
| AI의 광범위한 변경 | 변경 허용 경로와 작은 작업 패킷 |
| 초기 Scheduler 과설계 | Mock JSON → 기본 Scheduler → 외부 Adapter 순서 |
| 원본 IFC 손상 | 읽기 전용 기본, 명시적 Export만 허용 |

## 15. 수용 기준

첫 번째 제품 마일스톤은 다음 시나리오를 만족해야 한다.

```gherkin
Given 사용자가 유효한 IFC 파일을 가지고 있고
When 파일을 열면
Then 모델이 3D 화면에 표시된다.

When 사용자가 객체를 클릭하면
Then 객체가 강조되고 GlobalId가 표시된다.

When 사용자가 Task를 생성하고 선택 객체를 할당하면
Then 해당 연결이 프로젝트에 저장된다.

When 사용자가 시뮬레이션 시간을 이동하면
Then 연결된 객체가 Task 시간과 operation에 따라 표시 상태를 변경한다.

When 프로젝트를 닫고 다시 열면
Then 모델 참조, Task, 연결 및 Viewer 상태가 복원된다.
```

## 16. 아키텍처 결정 기록(ADR)

### Decision

Windows용 C# WPF Shell 내부에서 WebView2 기반 That Open Viewer를 실행하고, IfcOpenShell/Ifc4D는 별도 Python Worker로 격리한다. 제품 구조는 Typed Event-Driven Modular Monolith와 Ports/Adapters를 사용한다.

### Drivers

1. Viewer와 4D 기능을 IFC 작성 도구와 독립적으로 개발해야 한다.
2. That Open의 브라우저 생태계와 IfcOpenShell의 Python 생태계를 재사용해야 한다.
3. 기능 단위 TDD와 AI 위임이 가능한 명확한 변경 경계가 필요하다.

### Alternatives considered

1. 순수 C#으로 Viewer와 IFC 처리를 모두 구현
2. Electron/Tauri 기반 단일 TypeScript 데스크톱 앱
3. Blender+Bonsai 애드온으로만 구현
4. WPF+WebView2+Python Worker 하이브리드

### Why chosen

순수 C# 재구현은 기존 OpenBIM 생태계의 장점을 잃고 네이티브 IFC 바인딩 유지비가 높다. Electron/Tauri는 Viewer에는 적합하지만 Windows 업무용 Shell과 향후 네이티브 통합에서 C#보다 불리할 수 있다. Bonsai 애드온은 특정 호스트에 종속된다. 하이브리드 구조는 각 기술을 가장 적합한 역할에 배치하면서 프로세스 경계로 장애를 격리한다.

### Consequences

- 세 언어와 두 런타임을 관리해야 한다.
- IPC 계약과 통합 테스트가 중요해진다.
- Viewer를 브라우저에서 독립 개발할 수 있다.
- Python Worker 장애가 Desktop 전체 크래시로 이어지지 않는다.
- 특정 IFC 작성 제품에 종속되지 않는다.

### Follow-ups

- Phase 0에서 Node 패키지 관리자와 UI 프레임워크 버전을 확정한다.
- 표준 IFC fixture corpus를 선정한다.
- IPC 방식은 초기 HTTP/WebSocket으로 시작하고 보안 요구가 확정되면 Named Pipe를 검토한다.
- 프로젝트 저장 형식과 SQLite 스키마는 Matching 구현 전에 별도 ADR로 확정한다.

## 17. 첫 실행 승인 단위

계획 승인 후에도 전체 시스템을 한 번에 구현하지 않는다. 첫 실행 작업은 Phase 0만 대상으로 한다.

Phase 0 산출물:

1. 저장소 기본 디렉터리
2. TypeScript/Vite 애플리케이션
3. strict typecheck, lint, unit test, Playwright 구성
4. Component 및 Event Bus 최소 계약
5. GitHub Actions
6. README와 작업 패킷 템플릿

Phase 0이 검증되고 사용자 확인을 받은 후 Phase 1로 이동한다.

## 18. 공식 참고자료

- That Open Components: https://github.com/ThatOpen/engine_components
- IfcOpenShell: https://docs.ifcopenshell.org/
- Sequence API: https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/sequence/index.html
- Ifc4D: https://docs.ifcopenshell.org/ifc4d.html
- WebView2 배포: https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
- .NET single-file: https://learn.microsoft.com/dotnet/core/deploying/single-file/overview
- Playwright: https://playwright.dev/docs/intro
