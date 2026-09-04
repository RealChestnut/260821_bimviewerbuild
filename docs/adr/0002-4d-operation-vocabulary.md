# ADR-0002. 4D 연산 어휘와 표시 상태를 분리해 확정한다

- 상태: 채택
- 일자: 2026-08-21
- 관련: `docs/DEVELOPMENT_MASTER_PLAN.md` 2.1, 6.2, 6.3, 9절(Phase 4·6) · `docs/IFC_통합_정리_2026-08-20.md` 13, 17, 19.2절 · `AGENTS.md` 1.4, 2.6절
- 해소 대상: IFC 기준서 17절(`appear` / `temporary`)과 19.2절(`SHOW` / `HIDE` / `REMOVE`)의 어휘 불일치

## Decision

4D 어휘를 **두 개의 분리된 Enum**으로 정의한다. 하나로 합치지 않는다.

### TaskOperation — 저장되는 데이터

Task가 Element에 무엇을 하는지. `Assignments.operation` 필드의 값이다. 사용자가 지정하며 프로젝트에 저장된다.

| 값 | 의미 | Task 전 존재 | Task 후 존재 | 예 |
|---|---|---|---|---|
| `CONSTRUCT` | 신설 | 없음 | 있음 | 기둥 타설, 부재 설치 |
| `DEMOLISH` | 철거 | 있음 | 없음 | 기존 구조물 해체 |
| `TEMPORARY` | 가설 | 없음 | 없음 | 동바리, 비계, 크레인 |
| `MODIFY` | 변경 | 있음 | 있음 | 마감, 보수, 검사 |

이 네 값은 (Task 전 존재 여부 × Task 후 존재 여부)의 네 조합을 남김없이 덮는다. 다섯 번째 값이 필요하다는 주장은 조합이 아니라 **표현 방식**을 요구하는 것이므로, Enum 확장이 아니라 표시 규칙 변경으로 다룬다.

### ElementDisplayState — 파생되는 상태

특정 시각 `t`에 Viewer가 Element를 어떻게 그리는지. 저장하지 않는다. 항상 계산한다.

| 값 | 의미 |
|---|---|
| `HIDDEN` | 렌더링하지 않는다 |
| `IN_PROGRESS` | 작업 진행 중 표현으로 렌더링한다 |
| `PRESENT` | 통상 표현으로 렌더링한다 |

### 파생 규칙

Task의 계획 시작을 `start`, 계획 완료를 `finish`라 할 때, Assignment 하나에 대한 상태는 다음 전역 함수다.

| operation | `t < start` | `start ≤ t ≤ finish` | `t > finish` |
|---|---|---|---|
| `CONSTRUCT` | `HIDDEN` | `IN_PROGRESS` | `PRESENT` |
| `DEMOLISH` | `PRESENT` | `IN_PROGRESS` | `HIDDEN` |
| `TEMPORARY` | `HIDDEN` | `IN_PROGRESS` | `HIDDEN` |
| `MODIFY` | `PRESENT` | `IN_PROGRESS` | `PRESENT` |

### 경계 규칙

1. **미연결 Element** — 어떤 Task에도 할당되지 않은 Element는 모든 `t`에서 `PRESENT`다. 숨기지 않는다. 미연결 객체 필터(Phase 6)는 이 규칙과 별개인 별도 표시 모드다.
2. **다중 할당 충돌** — 한 Element가 여러 Task에 할당된 경우 다음 순서로 해소한다.
   1. `t`에서 `IN_PROGRESS`를 산출하는 Assignment가 하나라도 있으면 `IN_PROGRESS`.
   2. 아니면 `finish ≤ t`인 Assignment 중 `finish`가 가장 늦은 것의 결과를 쓴다.
   3. 아니면(모든 Task가 미래) `start`가 가장 이른 Assignment의 `t < start` 결과를 쓴다.
   이 규칙에 따라 `CONSTRUCT` 후 `DEMOLISH` 같은 정상 연쇄가 올바르게 동작한다.
3. **경계 시각** — 구간은 시작·종료 모두 포함(`start ≤ t ≤ finish`)이다. `start == finish`인 Milestone Task는 그 시각에 `IN_PROGRESS`가 된다.
4. **시간 미정 Task** — `start` 또는 `finish`가 없는 Task의 Assignment는 시뮬레이션에서 제외하고, Element는 다른 Assignment 또는 미연결 규칙을 따른다. 조용히 0으로 대체하지 않는다.

## Drivers

1. 기준서가 두 곳에서 서로 다른 어휘를 쓴다. 구현 전에 하나로 정해야 한다.
2. 마스터 계획 6.2절 `Assignments.operation` 필드는 값 목록 없이 정의되어 있다. Phase 4(Mock 4D Simulation)와 Phase 6(Matching)이 모두 이 값에 의존한다.
3. 마스터 계획 2.1절이 1차 범위를 "Construct 및 Demolish 4D 상태 표현"으로 잡고 있다. 어휘는 그보다 넓되 확장이 예측 가능해야 한다.
4. 마스터 계획 6.3절이 IFC Export 대상에 `IfcTask` 계열을 포함한다. 내부 어휘는 IFC로 왕복 가능해야 한다.

## Alternatives considered

1. **기준서 19.2절의 `SHOW` / `HIDE` / `REMOVE`를 그대로 채택** — 액션 어휘 하나만 둔다.
2. **IFC `IfcTaskTypeEnum`을 내부 어휘로 직접 사용** — `CONSTRUCTION`, `DEMOLITION`, `REMOVAL`, `RENOVATION`, `MAINTENANCE`, `LOGISTIC` 등 14개 값.
3. **두 Enum 분리(본 결정)**

## Why chosen

**단일 액션 어휘 기각.** `SHOW` / `HIDE` / `REMOVE`는 저장 데이터와 렌더 상태를 섞는다. `HIDE`와 `REMOVE`는 화면상 구분되지 않으면서 저장값으로는 서로 다르고, 사용자가 무엇을 골라야 하는지 알 수 없다. 또 시각 `t`에 대한 함수가 아니라 이벤트 서술이므로, 임의 시점으로 점프하는 타임라인 스크러빙에서 상태를 재구성하려면 처음부터 이벤트를 재생해야 한다. 시뮬레이션 성능과 구현 복잡도 모두 불리하다.

**IfcTaskTypeEnum 직접 사용 기각.** 14개 값 대부분이 표시 규칙 관점에서 동일하게 동작한다(`MAINTENANCE`, `RENOVATION`, `ATTENDANCE`는 전부 `MODIFY`다). 도메인이 Schema Enum에 직접 의존하면 `AGENTS.md` 2.3절(버전 분기를 Adapter에 격리)과 마스터 계획 3.3절(Domain은 IfcOpenShell을 직접 참조하지 않는다)을 위반한다. 또한 IFC에는 `TEMPORARY`에 해당하는 값이 없어서 어차피 완전 대응이 불가능하다.

**분리 채택 근거.** `TaskOperation`은 사용자 의도이자 저장 데이터이고, `ElementDisplayState`는 그로부터 계산되는 렌더 결과다. 분리하면 표시 방식을 바꿔도(예: 철거된 객체를 반투명 고스트로 표시) 저장 데이터를 마이그레이션할 필요가 없다. 파생 규칙이 `t`에 대한 전역 함수이므로 임의 시점 점프가 O(할당 수)로 계산되고, 순수 함수여서 단위 테스트가 쉽다. 마스터 계획 10절 TDD 전략과 맞는다.

## IFC Export 매핑 (확정, 2026-09-03)

마스터 계획 6.3절 Export 시 사용하는 매핑이다. Phase 7에서 `three-elements-ifc4.ifc`를 원본으로 네 operation을 모두 내보내고 다시 읽는 왕복 테스트를 통과했다 (`services/ifc-worker/tests/test_schedule_io.py`).

| TaskOperation | `IfcTask.PredefinedType` | 관계 |
|---|---|---|
| `CONSTRUCT` | `CONSTRUCTION` | `IfcRelAssignsToProduct` (Task의 산출물) |
| `DEMOLISH` | `DEMOLITION` | `IfcRelAssignsToProcess` (Task의 투입물) |
| `MODIFY` | `RENOVATION` | `IfcRelAssignsToProduct` |
| `TEMPORARY` | `USERDEFINED` + `ObjectType` | `IfcRelAssignsToProduct` + 자체 Pset |

`TEMPORARY`는 IFC에 대응 개념이 없다. `USERDEFINED`와 `IfcTask.ObjectType = 'TEMPORARY'`로 내보낸다.

**자체 PropertySet은 쓰지 않는다.** `ObjectType`만으로 왕복이 되며, 같은 사실을 두 곳에 적으면 둘이 어긋날 때 어느 쪽이 정본인지 알 수 없다. 접두어 규칙(`AGENTS.md` 2.4절)을 신경 쓸 일도 없어진다.

우리가 쓴 파일은 네 값이 모두 복원된다. `ObjectType`이 없는 외부 IFC에서는 `TEMPORARY`를 복원할 수 없고 해당 Task는 `CONSTRUCT`로 읽힌다. 이는 알려진 손실이며 Import 코드에 그대로 적혀 있다.

## Consequences

- `Assignments.operation`의 값 집합이 확정되어 Phase 4와 Phase 6이 착수 가능해진다.
- 파생 규칙이 순수 함수이므로 Simulation 모듈은 Viewer 없이 단위 테스트할 수 있다. 표 자체가 테스트 케이스 목록이다.
- 기준서 17절의 `Behavior = appear/temporary` 예제 Property는 외부 파일의 관찰 사례일 뿐 내부 어휘가 아니다. 내부 코드에 그 문자열을 쓰지 않는다.
- `TEMPORARY`의 IFC 왕복은 손실이 있다. Export 후 재Import로 원본을 복원할 수 없다는 점을 제품 문서에 명시해야 한다.
- 표시 방식(색상, 투명도, 외곽선)은 본 ADR의 범위가 아니다. `IN_PROGRESS`를 어떻게 그릴지는 별도 결정이다.

## Follow-ups

- `packages/contracts/`에 `TaskOperation`, `ElementDisplayState` 타입과 파생 함수의 계약을 정의한다.
- 파생 규칙 표 12칸 + 경계 규칙 4개를 Phase 4 착수 시 단위 테스트로 먼저 작성한다.
- ~~IFC Export 매핑은 Phase 7에서 fixture 왕복 테스트로 검증한다.~~ 2026-09-03에 검증하고 위 절을 확정으로 갱신했다. 자체 Pset은 쓰지 않기로 했다.
- `IN_PROGRESS` / `HIDDEN`의 시각 표현(색상, 투명도, 철거 객체 고스트 표시 여부)은 Phase 4에서 별도로 정한다.
