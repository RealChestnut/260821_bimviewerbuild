# BIM 4D Viewer 개발 마스터 플랜

작성일: 2026-08-21  
상태: 개발 기준선  
저장소: `https://github.com/RealChestnut/260821_bimviewerbuild.git`

## 1. 제품 목표와 범위

특정 BIM 모델링 제품에 종속되지 않는 Windows용 4D BIM 애플리케이션을 만든다. Revit, Archicad, Tekla, Bonsai 등 어떤 저작 도구에서 생성했든 IFC 파일을 가져와 다음을 수행한다.

1. IFC 모델 조회, 선택, 검색, 분류, 숨김, 격리, 단면 및 속성 확인
2. 공정표 작성 또는 외부 공정 데이터 가져오기
3. IFC 객체와 공정 작업 연결
4. 날짜에 따른 시공·철거 상태의 3D 시뮬레이션
5. 프로젝트 저장·복원 및 선택적인 4D IFC 내보내기

이 제품은 IFC 모델러가 아니다. BIM 저작 도구는 입력 파일을 만드는 외부 도구이며 필수 런타임 의존성이 아니다.

### 1차 범위

- Windows x64 독립 실행형 애플리케이션
- IFC2x3 및 IFC4 우선 지원
- 단일 모델에서 복수 모델 연합으로 확장
- Viewer, 기본 Scheduler, 객체–Task 연결, Construct/Demolish 시뮬레이션
- 프로젝트 저장·불러오기와 설치 프로그램

### 초기 제외 범위

- BIM 형상 모델링, Primavera 수준 전체 CPM, 5D 원가
- 다중 사용자 실시간 협업, 클라우드 필수화
- 모바일/macOS 배포, 원본 IFC 자동 덮어쓰기

## 2. 시스템 아키텍처

**Typed Event-Driven Modular Monolith + Ports and Adapters + Vertical Slice**를 적용한다.

```text
C# WPF Desktop Shell
 ├─ WebView2
 │   └─ TypeScript Web Application
 │       ├─ That Open Components / Three.js
 │       ├─ Viewer Features
 │       ├─ Scheduler UI
 │       └─ 4D Simulation UI
 ├─ Python Worker Process
 │   ├─ IfcOpenShell
 │   ├─ Ifc4D / Sequence API
 │   └─ IFC Validation / Export
 └─ Project Store
     ├─ SQLite
     ├─ Model metadata
     ├─ Schedule
     └─ Task–Product assignments
```

| 영역 | 선택 기술 | 책임 |
|---|---|---|
| Desktop Shell | C#, .NET, WPF | 창, 메뉴, 파일 선택, Worker 관리, 설정, 배포 |
| Web Container | WebView2 | TypeScript UI와 3D Viewer 호스팅 |
| Viewer | That Open Components, Fragments, Three.js | 표시, 선택, 강조, 가시성, 단면 |
| Web UI | TypeScript, Vite, React | Viewer UI, Scheduler, Gantt, 타임라인 |
| IFC Worker | Python, IfcOpenShell, Ifc4D | IFC 검증, 일정 관계, IFC 입출력 |
| Project Data | SQLite, JSON DTO | 일정, 연결, 설정, 버전 정보 저장 |
| Testing | Vitest, Playwright, xUnit, pytest | 단위·계약·통합·E2E 테스트 |
| Packaging | .NET self-contained, MSI/Setup EXE | Windows 배포 |

### 의존성 원칙

- Domain은 WPF, That Open, SQLite, IfcOpenShell을 직접 참조하지 않는다.
- 기능 코드는 Port에 의존하고 외부 라이브러리는 Adapter에서만 사용한다.
- Viewer는 일반 브라우저와 WebView2 양쪽에서 실행 가능하게 유지한다.
- Python Worker 장애는 Desktop 프로세스와 격리한다.
- 특정 IFC 저작 프로그램을 전제로 하는 코드를 만들지 않는다.

## 3. 모듈

### Kernel

- Component Registry, Typed Event Bus, Command Dispatcher
- 공통 오류, 구조화 로그, correlation ID
- `initialize`, `start`, `stop`, `dispose` 생명주기

### Viewer

- World/Scene, Model Loader/Unloader, Selection
- Visibility/Isolation, Classification, Properties
- Clipping, Camera/Viewpoint, Viewer State, Resource Disposal

### Scheduler

- Task CRUD, WBS, 시작·종료·기간
- 기본 선후행 관계, 캘린더, Gantt, 시뮬레이션 시간

### Matching

- 선택 객체를 Task에 연결·해제
- 모델 교체 시 GlobalId 기반 연결 유지
- 신규·삭제·변경 객체 감지
- 향후 속성·공간·형상 기반 재매칭 후보 추천

### Simulation

```text
NOT_STARTED
IN_PROGRESS
COMPLETED
DEMOLITION_PENDING
DEMOLISHING
REMOVED
TEMPORARY
```

상태별 색상·투명도·가시성은 정책으로 분리한다. 시간 이동 시 상태는 순수 함수로 다시 계산하며 이전 프레임 상태에 누적 의존하지 않는다.

### Project

- 모델 경로와 SHA-256 fingerprint
- Schedule, Assignment, Viewer State
- 데이터 스키마 버전과 마이그레이션

## 4. Command/Event/Query 규칙

ROS와 유사한 느슨한 결합은 유지하되 모든 호출을 Pub/Sub로 만들지 않는다.

- **Command:** 한 Handler에 실행 요청 — `LoadModel`, `AssignProductsToTask`
- **Event:** 발생한 사실을 통지 — `ModelLoaded`, `SelectionChanged`
- **Query:** Port/Repository에서 조회 — `GetProductProperties`, `GetTasks`

규칙:

- 이벤트에는 ID와 작은 DTO만 전달한다.
- IFC 바이트, Three.js Mesh, 전체 Fragments 데이터는 Event Bus로 보내지 않는다.
- 이벤트 이름은 타입으로 중앙 관리한다.
- 조회 응답을 이벤트로 구현하지 않는다.
- 모듈은 다른 모듈의 내부 상태를 직접 변경하지 않는다.

## 5. 데이터 및 식별 전략

영구 객체 키는 `modelId + IfcRoot.GlobalId`다. STEP ID와 Viewer 내부 ID는 영구 연결에 사용하지 않는다.

- 원본 IFC는 기본적으로 읽기 전용이다.
- 파일 fingerprint를 프로젝트에 저장한다.
- 일정과 객체 연결은 별도 프로젝트 데이터에 저장한다.
- IFC 내보내기는 사용자가 명시적으로 실행한다.

```text
Project
 ├─ Models: modelId, sourcePath, fingerprint, schema
 ├─ Tasks
 ├─ Calendars
 ├─ Dependencies
 ├─ Assignments: taskId, modelId, productGlobalId, operation
 └─ ViewerState
```

내부 데이터가 안정화되면 IfcOpenShell로 `IfcWorkSchedule`, `IfcTask`, `IfcTaskTime`, `IfcRelSequence`, `IfcRelAssignsToProduct`, `IfcRelAssignsToProcess`를 선택적으로 내보낸다.

## 6. 저장소 구조

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

기능은 기술이 아니라 기능별로 묶는다.

```text
features/selection/
 ├─ SelectionComponent.ts
 ├─ SelectionState.ts
 ├─ SelectionEvents.ts
 ├─ SelectionComponent.test.ts
 ├─ Selection.e2e.spec.ts
 └─ index.ts
```

## 7. 개발 전략과 단계

### Viewer-first 첫 기능

> IFC 열기 → 3D 표시 → 객체 클릭 → 강조 → GlobalId 표시 → 모델 해제

이 수직 기능에서 렌더링, WASM, Worker, 식별, Event Bus, 오류 처리와 메모리 해제를 함께 검증한다.

### Phase 0 — 개발 기반

- 저장소 구조, TypeScript/Vite, strict mode
- lint/formatter, Vitest, Playwright
- 소형 IFC fixture, GitHub Actions
- ADR 및 AI 기능 작업 템플릿

완료: 빈 앱 build, 단위·브라우저 테스트의 로컬/CI 통과, 실패 테스트의 병합 차단.

### Phase 1 — Viewer Kernel

- Component Registry, Typed Event Bus, Command Dispatcher
- ModelRepository Port, That Open Adapter, 오류와 로그

완료: 컴포넌트 생명주기와 Event subscribe/unsubscribe/error-isolation 테스트 통과.

### Phase 2 — 첫 Viewer Vertical Slice

- IFC 선택·로딩·렌더링
- 단일 선택·강조·GlobalId 표시
- 모델 해제

완료:

- 고정 IFC fixture가 브라우저에서 열린다.
- 선택 시 `SelectionChanged`가 정확히 한 번 발생한다.
- 해제 후 Scene과 Repository에 잔여 모델이 없다.
- 10회 연속 load/unload에 치명적 오류가 없다.

### Phase 3 — Viewer 업무 기능

다중 선택, 숨김·격리, 공간 구조·분류, 속성, 단면, Viewpoint, 복수 모델 연합.

### Phase 4 — Mock 4D

JSON 일정 fixture, 시간 슬라이더, 재생·정지·배속, 상태 엔진, Construct/Demolish 표현.

완료: 동일 입력은 동일 상태, 연결 객체만 변경, 시간 역이동 시 상태 비누적.

### Phase 5 — Scheduler

Task CRUD, WBS, 기본 선후행, Gantt, 검증, JSON/CSV 입출력.

### Phase 6 — Matching

객체–Task 할당, 연결 강조, 미연결 필터, 모델 교체와 재매칭, 충돌 검증.

### Phase 7 — IfcOpenShell Worker

Python runtime, IPC 계약, IFC 검증, Ifc4D 입출력, timeout/crash/restart.

### Phase 8 — Desktop Shell

WPF, WebView2, 파일 대화상자, 최근 프로젝트, Worker 관리, 로그와 설정.

### Phase 9 — 배포

.NET self-contained Windows x64, Web/Python runtime 포함, WebView2 Evergreen 우선, Setup EXE/MSI, 설치·제거 smoke test와 코드 서명.

## 8. TDD와 품질 게이트

### Red–Green–Refactor

1. Given–When–Then 수용 조건 작성
2. 실패하는 테스트 추가 및 실패 원인 확인
3. 최소 구현으로 통과
4. 계약을 유지하며 리팩터링
5. 관련 및 전체 회귀 테스트 수행

| 계층 | 대상 | 도구 |
|---|---|---|
| Unit | Event Bus, 상태 계산, 매칭 | Vitest, xUnit, pytest |
| Contract | Port/Adapter, IPC DTO | Vitest, pytest |
| Integration | That Open+IFC, SQLite, Worker | Vitest, Playwright, pytest |
| E2E | 파일 열기부터 시뮬레이션 | Playwright, Desktop smoke test |
| Visual | 핵심 Viewer 장면 | 제한적 screenshot regression |
| Performance | 로딩, 시간 이동, 메모리 | 고정 benchmark fixture |

병합 전 필수 조건:

- typecheck/lint 오류 0개
- 관련 테스트와 전체 회귀 테스트 통과
- 새 Port/Event/Command의 계약 테스트
- Viewer 변경의 브라우저 통합 테스트
- build 성공, 오류 처리와 `dispose()` 확인
- 사용자 수용 시나리오 확인

성능 수치는 표준 benchmark IFC와 기준 장비를 선정한 뒤 확정한다.

## 9. AI 기능 위임

AI에는 전체 제품이 아니라 기능 하나를 다음 작업 패킷으로 위임한다.

```text
Feature:
목적과 사용자 시나리오:
입력/출력:
Command/Event 계약:
변경 허용/금지 경로:
선행 테스트:
수용 조건:
성능·메모리 조건:
검증 명령:
```

규칙:

- 수정 전 관련 코드와 테스트를 읽는다.
- 테스트를 먼저 작성하고 실패를 확인한다.
- 허용 경로를 벗어나거나 공개 계약을 바꾸기 전 보고한다.
- 테스트를 삭제·약화해 통과시키지 않는다.
- 관련 없는 리팩터링을 섞지 않는다.
- typecheck, lint, test, build 결과로 완료를 증명한다.

Definition of Done: 수용 조건, 테스트, build, 오류/dispose, 계약 문서화, 변경 범위, 사용자 확인을 모두 충족한다.

## 10. Git/GitHub 프로세스

```text
origin = https://github.com/RealChestnut/260821_bimviewerbuild.git
main = 안정 기준선
branches = feature/*, fix/*, chore/*, docs/*
```

- 기능 하나당 작고 검증 가능한 커밋
- 관련 경로만 명시적으로 stage하며 전체 자동 stage 금지
- 빌드 산출물, runtime, 비밀정보 커밋 금지
- Conventional Commits 사용

```text
feat(viewer): add single object selection
test(viewer): cover selection disposal
fix(loader): release model resources on failure
docs(architecture): define event contract rules
```

CI, 수용 조건, 변경 범위, 공개 계약을 검토한 후 병합한다. 기능 브랜치와 작은 PR을 기본으로 하며, 사용자가 명시적으로 요청하지 않으면 AI가 임의로 커밋·푸시하지 않는다.

## 11. 개발 도구

- Visual Studio: C#/WPF 및 Windows 디버깅
- VS Code 또는 동등 IDE: TypeScript/Python
- Git/GitHub, Node.js와 단일 패키지 관리자, Python 격리 환경
- Edge/Chrome DevTools
- Blender+Bonsai: 참조 및 검증용 선택 도구

주요 라이브러리: `@thatopen/components`, `@thatopen/components-front`, `@thatopen/fragments`, `three`, `web-ifc`, `ifcopenshell`, `ifc4d`.

정확한 버전은 Phase 0에서 공식 호환성을 확인하고 lockfile 및 requirements로 고정한다. 애플리케이션 코드에서 무조건 `latest`를 사용하지 않는다.

## 12. 위험 관리

| 위험 | 대응 |
|---|---|
| 저작 도구별 IFC 품질 차이 | Import validation, fixture corpus, Adapter 격리 |
| STEP ID 변경 | GlobalId 기반 연결 |
| 모델 교체 시 GlobalId 변경 | fingerprint, diff, 후보 재매칭 |
| 대형 모델 메모리 | Fragments, Worker, dispose·성능 테스트 |
| Event Bus 남용 | Command/Event/Query 규칙과 계약 테스트 |
| C#·TS·Python 복잡성 | 프로세스 경계, correlation ID, 구조화 로그 |
| Python 배포 충돌 | 격리 runtime, x64 고정, 설치 smoke test |
| AI의 광범위한 변경 | 작은 작업 패킷과 허용 경로 |
| Scheduler 과설계 | Mock JSON → 기본 Scheduler → 외부 Adapter |
| 원본 IFC 손상 | 읽기 전용 기본, 명시적 Export |

## 13. 첫 제품 마일스톤

```gherkin
Given 유효한 IFC 파일이 있고
When 파일을 열면
Then 모델이 3D 화면에 표시된다.

When 객체를 클릭하면
Then 객체가 강조되고 GlobalId가 표시된다.

When Task를 만들고 선택 객체를 연결하면
Then 연결 정보가 프로젝트에 저장된다.

When 시뮬레이션 시간을 이동하면
Then 연결된 객체가 Task 시간과 operation에 맞게 상태를 변경한다.

When 프로젝트를 닫고 다시 열면
Then 모델 참조, Task, 연결 및 Viewer 상태가 복원된다.
```

## 14. 첫 구현 단위

첫 구현은 Phase 0만 수행한다.

1. 저장소 구조
2. TypeScript/Vite Viewer 앱
3. strict typecheck, lint, Vitest, Playwright
4. Component Registry와 Typed Event Bus 최소 계약
5. GitHub Actions
6. README, ADR, AI 작업 패킷 템플릿

Phase 0을 검증하고 사용자 확인을 받은 다음 Phase 1로 이동한다.

## 15. 공식 참고자료

- That Open Components: https://github.com/ThatOpen/engine_components
- IfcOpenShell: https://docs.ifcopenshell.org/
- Sequence API: https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/sequence/index.html
- Ifc4D: https://docs.ifcopenshell.org/ifc4d.html
- WebView2 배포: https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
- .NET single-file: https://learn.microsoft.com/dotnet/core/deploying/single-file/overview
- Playwright: https://playwright.dev/docs/intro

