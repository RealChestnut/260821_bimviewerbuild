# AGENTS.md

이 저장소에서 작업하는 모든 AI 에이전트의 규칙이다. 작업 시작 전에 이 문서를 읽는다.

기준 문서:

- `docs/DEVELOPMENT_MASTER_PLAN.md` — 제품 목표, 아키텍처, 모듈 구성, 로드맵
- `docs/IFC_통합_정리_2026-08-20.md` — IFC Schema·Entity·Property·Geometry·관계·4D·Exporter 기술 기준 (이하 **IFC 기준서**)

---

## 1. IFC 기준서 참조 의무

IFC를 다루는 구간에서는 코드를 쓰기 전에 `docs/IFC_통합_정리_2026-08-20.md`를 먼저 읽는다.

### 1.1 참조가 필요한 작업

다음 중 하나에 해당하면 IFC 기준서 참조 대상이다.

- `.ifc` / `.ifcXML` / `.ifcZIP` 파일을 읽거나 쓰는 코드
- IFC Schema 버전(IFC2x3 / IFC4 / IFC4.3)을 판별하거나 분기하는 코드
- `Ifc*` Entity 이름, Entity Attribute, PredefinedType을 문자열로 다루는 코드
- PropertySet / Quantity Set을 읽거나 이름을 만드는 코드
- ObjectPlacement, Representation, 좌표 변환, 단위 처리 코드
- `IfcRel*` 관계를 해석하거나 생성하는 코드
- IfcTask / IfcTaskTime / IfcWorkSchedule 등 4D 공정 데이터 처리 코드
- 내부 Element Registry, Geometry Asset, Task–Element Mapping 스키마 변경
- IFC 검증(validation), 수령 파일 점검, 변환기(converter) 구성 설계

### 1.2 참조 대상 경로

다음 경로의 파일을 만들거나 고칠 때는 위 규칙이 적용된다고 본다.

```text
services/ifc-worker/**          Python IfcOpenShell Worker
apps/desktop/**                 C# WPF Shell (Worker 관리, 셸-웹 다리)
packages/contracts/**           IFC 관련 Command / Event / DTO
packages/domain/**              IFC 의미를 다루는 도메인 규칙
packages/test-fixtures/**       IFC fixture
apps/viewer-web/**              모델 로딩, Selection, Property Panel, 4D Simulation
```

### 1.3 기준서 사용 방법

기준서 전체를 컨텍스트에 올리지 않는다. 작업에 해당하는 절만 읽는다.

| 작업 | 읽을 절 |
|---|---|
| Schema 판별, 버전 분기 | 2, 3, 4 |
| Entity 매핑, 상속 처리 | 5, 6 |
| Attribute 추출 | 7 |
| 좌표·형상 처리 | 8 |
| 공간 계층, Assembly | 9 |
| Property / Pset | 10 |
| Quantity / Qto | 11 |
| 관계 해석 | 12 |
| 4D 공정 데이터 | 13 |
| 호환성 가정 검토 | 14, 15 |
| Navisworks 유래 파일 | 16 |
| 내부 표준화 설계 | 18, 19 |
| 수령 파일 검증 | 20 |
| 용어 확인 | 21 |
| 1차 출처 확인 | 22 |

### 1.4 기준서의 한계

기준서는 완결된 스펙이 아니다. 미결정 영역을 임의로 채우지 않는다.

**ADR로 해소된 항목** — 기준서보다 ADR이 우선한다.

| 항목 | 결정 | 근거 |
|---|---|---|
| Web Rendering 출력 포맷 (기준서 19절 `.frag / GLB / XKT 등`) | Fragments(`.frag`), `@thatopen/fragments` 3.x | `docs/adr/0001-web-rendering-asset-format.md` |
| 패키지 관리자와 라이브러리 버전 (마스터 계획 13절 `npm 또는 pnpm`) | pnpm 10.34.5 workspace, That Open 3.4.x 조합 고정, TypeScript 5.9.3 | `docs/adr/0003-toolchain-baseline.md` |
| 4D 액션 어휘 (기준서 17절 `appear/temporary` vs 19.2절 `SHOW/HIDE/REMOVE`) | `TaskOperation` 4값 + `ElementDisplayState` 3값으로 분리 | `docs/adr/0002-4d-operation-vocabulary.md` |
| Schedule / Task–Element Mapping 필드 스키마 (기준서 19.2절에 ID만 있음) | `schemaVersion` 1 스키마 확정. 날짜는 UTC `YYYY-MM-DD`, 연결은 `modelRef + productGlobalId + operation` | `docs/adr/0005-schedule-schema.md` |
| `ElementDisplayState`의 화면 표현 (ADR-0002가 Phase 4로 미룸) | `HIDDEN` 미렌더링, `IN_PROGRESS` 반투명 주황, `PRESENT` 원래 표현 | `docs/adr/0005-schedule-schema.md` |
| 일정 스키마의 WBS와 선후행 (기준서 12·13절, 마스터 계획 4.3절) | `schemaVersion` 2. WBS는 `parentTaskId`, 선후행은 `IfcRelSequence` 대응 4종 + `lagDays`. 저장·검증만 하고 날짜를 자동 계산하지 않는다 | `docs/adr/0006-schedule-schema-v2.md` |
| 일정 CSV 교환 형식 (마스터 계획 9절 Phase 5 `JSON/CSV 가져오기·내보내기`) | `schedule.csv` + `tasks.csv` + `assignments.csv` + 선택 `dependencies.csv`·`models.csv`. 열 순서는 무관하고 모르는 열은 거부한다. 의미 검증은 `parseSchedule`이 맡아 해석 지점을 하나로 둔다 | `docs/adr/0007-schedule-csv-exchange.md` · `docs/adr/0008-model-ref-fingerprint-binding.md` |
| 셸과 웹 사이의 파일 전달 (마스터 계획 9절 Phase 8 `WebView2 통합`) | 자산은 `app.local` 폴더 매핑, 사용자가 고른 IFC는 `model.local` 요청을 가로채 그 파일만 스트리밍. 허용 목록에 없는 id는 404이며 원본은 읽기 전용으로 연다 | `docs/adr/0010-shell-web-bridge.md` |
| Worker IPC 방식 (마스터 계획 16절 Follow-up `초기 HTTP/WebSocket`) | 자식 프로세스 stdio에 줄 단위 JSON. 포트·토큰 없음. 큰 파일은 경로로 오간다. timeout은 부모가 재고, 죽으면 다음 요청에서 다시 띄우며, 이어서 세 번 죽으면 멈춘다 | `docs/adr/0009-ifc-worker-ipc.md` |
| IFC Export 매핑 (ADR-0002가 잠정으로 둠) | 왕복 테스트로 확정. `CONSTRUCT`→`CONSTRUCTION`, `DEMOLISH`→`DEMOLITION`+`IfcRelAssignsToProcess`, `MODIFY`→`RENOVATION`, `TEMPORARY`→`USERDEFINED`+`ObjectType`. 우리가 쓴 파일은 네 값이 모두 복원된다 | `docs/adr/0002-4d-operation-vocabulary.md` · `docs/adr/0009-ifc-worker-ipc.md` |
| `modelRef` 바인딩 (ADR-0005가 파일명 대조를 잠정으로 둠) | `schemaVersion` 3. 일정에 `models` 표를 두어 `modelRef`별 fingerprint를 적는다. 묶는 순서는 fingerprint 일치 → 이름 일치 → 미바인딩. 교체는 경고로 알리고 자동으로 갱신하거나 지우지 않는다 | `docs/adr/0008-model-ref-fingerprint-binding.md` |

**아직 미결정** — 해당 영역을 구현할 때 임의로 정하지 말고 결정을 먼저 요청한다.

- 일정의 캘린더(근무일)는 아직 없다. 마스터 계획 9절 Phase 5 항목에도 없으며, 근무일 기반 기간 산정을 도입할 때 정한다
- 자동 일정 계산(CPM) 도입 여부. ADR-0006은 선후행을 저장·검증만 하고 날짜를 자동으로 밀지 않는다
- 성능 목표 수치 — 삼각형 수, 파일 크기 상한, 목표 FPS, 최대 Element 수 (20절에 정량 기준이 없다)
- Split / Group 전처리의 책임 주체와 규칙
- 검증 체크리스트 20절 각 항목의 자동/수동 구분과 실패 시 reject / warn 게이트

또한 기준서 16.4절의 Codemill fallback Entity(`IfcEquipmentElement`)와 16.3절 iConstruct 문서 불일치는 기준서 자체가 미해결로 표시한 항목이다. 이 값들을 코드 상수로 굳히지 않는다.

---

## 2. IFC 처리 불변 규칙

기준서와 마스터 계획에서 도출된 규칙이다. 위반하는 코드는 작성하지 않는다.

### 2.1 원본 보호

- 원본 IFC는 읽기 전용으로 취급한다. 자동으로 수정하거나 덮어쓰지 않는다.
- IFC 쓰기는 명시적인 Export 경로에서만 수행한다.
- 모델 버전 식별에는 파일 fingerprint를 저장한다.

### 2.2 식별자

- 영구 연결 키는 `modelId + IfcRoot.GlobalId`를 사용한다.
- STEP ID(`#123`)는 파일 재저장 시 바뀔 수 있으므로 영구 키로 쓰지 않는다.
- GlobalId가 없거나 중복인 경우 내부 ID를 생성하고 원본 문제를 기록한다. 조용히 넘어가지 않는다.

### 2.3 Schema와 Entity

- Schema 버전은 Header의 `FILE_SCHEMA`에서 판별한다. 파일명이나 확장자로 추정하지 않는다.
- Schema 버전별 차이는 Adapter 계층에서 흡수한다. 도메인 코드에 버전 분기를 퍼뜨리지 않는다.
- Entity는 상속 구조를 가지므로 정확한 Class 이름 일치가 아니라 상위 Entity 기준으로 판정한다.
- "Schema가 정의한다"와 "파일에 실제로 있다"는 다르다. 필수 존재를 가정하지 않는다.

### 2.4 Property

- 특정 Custom Property 이름을 전제로 기능을 설계하지 않는다. Exporter마다 다르다.
- 표준 Pset은 있으면 활용하고, 없다고 해서 로딩을 실패로 처리하지 않는다.
- 내부에서 PropertySet을 생성할 때 `Pset_` 접두어를 쓰지 않는다. 표준 예약 접두어다. 자체 접두어를 사용한다.
- 원본 Pset / Qto는 해석 여부와 무관하게 전량 보존한다.

### 2.5 좌표와 형상

- 위치는 `ObjectPlacement`, 형상은 `Representation`이며 분리해서 처리한다.
- Relative Placement는 상위 계층을 누적해 최종 World Transform을 계산한다.
- 단순 XYZ만 저장하지 않는다. 4×4 Transform Matrix, 단위, 원점 오프셋, 원본 Placement 추적 정보를 함께 보존한다.
- 대좌표(측량 좌표계) 모델은 WebGL float32 정밀도 손실이 발생한다. 원점 오프셋을 적용한 뒤 렌더링한다.

### 2.6 관계와 4D

- 관계는 `IfcRel*` Entity로 해석한다. Property 문자열의 ParentId / TaskId에 의존하지 않는다.
- IfcTask가 파일에 없을 수 있다. 없으면 외부 Schedule을 사용하며, 이는 오류가 아니라 정상 경로다.
- 공정 Granularity와 모델 부재 Granularity가 다를 수 있다. 이는 Schema 문제가 아니라 전처리 문제다.
- Export 시 사용하는 Entity: IfcWorkSchedule, IfcTask, IfcTaskTime, IfcRelSequence, IfcRelAssignsToProduct, IfcRelAssignsToProcess.
- 4D 어휘는 ADR-0002가, 일정 파일의 필드 스키마는 ADR-0005와 ADR-0006이 정본이다. 저장값은 `TaskOperation` = `CONSTRUCT | DEMOLISH | TEMPORARY | MODIFY`, 렌더 상태는 `ElementDisplayState` = `HIDDEN | IN_PROGRESS | PRESENT`이며 저장하지 않고 항상 계산한다.
- 기준서 17절의 `appear` / `temporary`와 19.2절의 `SHOW` / `HIDE` / `REMOVE`는 폐기된 표기다. 코드에 쓰지 않는다.
- `IfcTaskTypeEnum` 값을 도메인 코드에 직접 노출하지 않는다. Adapter에서 `TaskOperation`으로 변환한다.

### 2.7 변환기 구성

변환 흐름은 기준서 19절 순서를 따른다.

```text
Schema 판별 → Entity/Attribute 추출 → Geometry/Placement 추출
→ Relationship 추출 → Pset/Qto 전량 수집 → Exporter별 Property Mapping
→ 내부 Element Registry + Geometry Asset + Hierarchy
→ Schedule / Task-Element Mapping → Web Rendering Asset
```

- 안정 영역(Schema, Entity, Attribute, Placement, Geometry)과 불안정 영역(Custom Property, Granularity, Task)을 분리해 처리한다.
- 불안정 영역은 Mapping 계층에 격리하고, 도메인이 직접 의존하지 않게 한다.
- 새 Exporter 유래 파일을 지원할 때는 Mapping 규칙을 추가하고, 도메인 코드를 고치지 않는다.
- 마지막 단계 Web Rendering Asset은 Fragments(`.frag`)다 (ADR-0001). `.frag`은 파생물이며 진실의 원천은 원본 IFC와 fingerprint다.
- `.frag` 캐시에는 생성에 사용한 fragments 버전과 원본 fingerprint를 기록하고, 불일치 시 재변환한다.
- `@thatopen/components`와 `@thatopen/fragments`는 peer 범위가 `~`로 묶여 있다. 개별 업그레이드하지 않는다.
- 형상 변환은 TypeScript 측 책임이다. Python IfcOpenShell Worker는 형상 변환 경로에 넣지 않는다.

### 2.8 신규 IFC 파일 수령

새 IFC fixture나 실모델을 파이프라인에 넣기 전에 기준서 20절 체크리스트를 수행하고 결과를 기록한다.

---

## 3. 아키텍처 규칙

`docs/DEVELOPMENT_MASTER_PLAN.md` 3절, 5절이 정본이다. 요약:

- 구조는 Typed Event-Driven Modular Monolith + Ports/Adapters + Vertical Slice다.
- Domain은 That Open Components, WPF, IfcOpenShell을 직접 참조하지 않는다.
- Feature는 Port 인터페이스에만 의존한다.
- That Open, WebView2, SQLite, IfcOpenShell은 Adapter로 구현한다.
- 모듈 간에 대형 객체나 Three.js 객체를 전달하지 않는다.
- Command / Event / Query의 구분을 지킨다. 금지 규칙은 마스터 계획 5.4절에 있다.

## 4. 작업 규칙

- 저장소 구조는 마스터 계획 7절을 따른다. 새 최상위 디렉터리를 임의로 만들지 않는다.
- 개발은 TDD를 따른다 (마스터 계획 10절). 테스트 없이 기능 코드를 추가하지 않는다.
- `docs/_source/`는 병합 대상 원본이며 `.gitignore` 대상이다. 참조는 하되 수정하지 않는다.
- 결정 사항은 `docs/adr/`에 ADR로 남긴다.
- 마스터 계획은 2026-08-21에 승인됐다. 계획 자체를 바꾸는 변경은 먼저 확인을 받는다.
- 검증 게이트는 `pnpm verify`(typecheck → lint → test → build)와 `pnpm test:e2e`다. 완료를 주장하기 전에 실행 결과를 제시한다.
- 화면 배치를 바꾸면 `tests/e2e/scheduleLayout.spec.ts`류의 배치 계약 테스트로 덮는다. 나머지 테스트는 testid의 존재와 개수와 글자만 보므로 칸이 눌려 읽을 수 없는 화면이 되어도 전부 통과한다 (마스터 계획 10.2절 Visual 계층).
- screenshot 기준선은 의도한 변경일 때만 `pnpm exec playwright test <파일> --update-snapshots`로 갱신하고, 갱신한 이유를 커밋 메시지에 적는다. 3D 캔버스는 GPU에 따라 픽셀이 달라지므로 찍지 않는다.

## 5. 문서 갱신

- IFC 기준서를 갱신하면 이 문서 1.4절의 미결정 목록도 함께 갱신한다.
- 기준서에 새 절을 추가하면 1.3절 표에 매핑을 추가한다.
- 기준서와 ADR이 충돌하면 ADR이 우선한다. 기준서는 기술 레퍼런스이고, ADR이 이 제품의 결정이다.
- 미결정 항목을 ADR로 닫으면 1.4절의 해소 표로 옮기고, 미결정 목록에서 지운다.
