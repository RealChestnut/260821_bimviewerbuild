# ADR-0006: 일정 스키마 v2에 WBS와 선후행을 넣는다

- 상태: 채택
- 날짜: 2026-08-23
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 4.3절, 9절(Phase 5) · `docs/IFC_통합_정리_2026-08-20.md` 12, 13절 · ADR-0002 · ADR-0005 · `AGENTS.md` 1.4, 2.6절
- 해소 대상: `AGENTS.md` 1.4절 미결정 항목 "일정 스키마의 WBS·선후행·캘린더 필드"

## 맥락

ADR-0005이 Phase 4에 필요한 최소 스키마(`schemaVersion: 1`)만 확정하고 WBS·선후행·캘린더를 Phase 5로 미뤘다. Phase 5의 항목은 마스터 계획 9절에 **Task CRUD · WBS · 기본 선후행 · Gantt · 일정 검증 · JSON/CSV 가져오기·내보내기** 여섯으로 적혀 있다.

기준서 12절은 `IfcRelSequence`가 "predecessor와 successor의 순서를 표현하고 START_START, FINISH_START 등과 같은 SequenceType을 지원한다"고 적는다. `AGENTS.md` 2.6절은 Export 대상 Entity에 `IfcRelSequence`를 포함한다.

## 결정

`schemaVersion: 2`를 정의한다. v1과의 차이는 `tasks[].parentTaskId`와 최상위 `dependencies` 배열 둘뿐이다.

```json
{
  "scheduleId": "...",
  "name": "...",
  "schemaVersion": 2,
  "tasks": [
    { "taskId": "W1", "name": "1층 골조" },
    {
      "taskId": "T001",
      "name": "슬래브 타설",
      "parentTaskId": "W1",
      "start": "2026-03-02",
      "finish": "2026-03-06"
    }
  ],
  "dependencies": [
    { "predecessorId": "T001", "successorId": "T002", "type": "FINISH_START", "lagDays": 0 }
  ],
  "assignments": ["…v1과 동일…"]
}
```

### WBS

계층은 `parentTaskId` 하나로 표현한다. 별도 트리 노드 타입도, `"1.2.3"` 같은 경로 코드도 두지 않는다. 표시 순서는 `tasks` 배열의 순서를 그대로 쓴다.

**자식이 있는 Task(요약 Task)는 자기 시간과 할당을 갖지 않는다.** 요약 Task의 시간은 자손 중 시간이 확정된 Task들의 `min(start)`와 `max(finish)`로 계산한다. 파일에 시간이나 할당이 적혀 있으면 거부한다. 무시하고 계산값을 쓰면 파일에 적힌 값과 화면에 보이는 값이 달라지는데, 이는 `AGENTS.md`가 금지하는 조용한 처리다.

### 선후행

`IfcRelSequence`의 SequenceType에 1:1로 대응하는 네 값을 쓴다.

| 값 | 뜻 | `IfcSequenceEnum` |
| --- | --- | --- |
| `FINISH_START` | 선행이 끝나야 후행이 시작한다 | `FINISH_START` |
| `START_START` | 선행이 시작해야 후행이 시작한다 | `START_START` |
| `FINISH_FINISH` | 선행이 끝나야 후행이 끝난다 | `FINISH_FINISH` |
| `START_FINISH` | 선행이 시작해야 후행이 끝난다 | `START_FINISH` |

`lagDays`는 정수이고 음수는 선행(lead)이다. IFC의 `USERDEFINED` / `NOTDEFINED`는 받지 않는다.

이름이 IFC와 같지만 이것은 우리 타입이다. ADR-0002가 `IfcTaskTypeEnum` 직접 사용을 기각한 것과 달리, 여기서는 개념이 1:1로 대응하고 값이 네 개뿐이며 축약할 여지가 없다. Adapter는 이 표대로 옮기기만 한다.

**날짜를 자동으로 계산하지 않는다.** 선후행은 저장하고 위반 여부를 검사할 뿐이며, 선행을 옮겨도 후행 날짜는 따라 움직이지 않는다. 마스터 계획의 "기본 선후행"을 이렇게 읽는다. 자동 재계산(CPM)은 별도 결정으로 남긴다.

### 검증: 거부와 경고

구조가 깨진 것은 파일을 읽지 못하게 하고(`parseSchedule`), 날짜 정합성은 읽되 알린다(`validateSchedule`). 자동 계산을 하지 않기로 했으므로 작성 중인 일정이 잠시 어긋나 있는 것은 정상 상태다.

| 거부 | 경고 |
| --- | --- |
| `taskId` 중복 | 선후행 위반 |
| 없는 `parentTaskId` 참조 | 시간이 정해지지 않은 Task |
| WBS 순환 참조 | 할당이 하나도 없는 Task |
| 없는 선후행 `taskId` 참조 | |
| 선후행 순환 참조 (자기 자신 포함) | |
| 선후행 중복 (같은 쌍 + 같은 유형) | |
| 요약 Task에 시간 또는 할당 | |

선후행 위반의 판정은 유형마다 경계가 다르다. 구간은 시작과 종료를 모두 포함하므로(ADR-0002 경계 규칙 3), 선행의 `finish` 당일은 아직 작업 중이다.

| 유형 | 위반이 아닌 조건 |
| --- | --- |
| `FINISH_START` | `successor.start > predecessor.finish + lagDays` |
| `START_START` | `successor.start >= predecessor.start + lagDays` |
| `FINISH_FINISH` | `successor.finish >= predecessor.finish + lagDays` |
| `START_FINISH` | `successor.finish >= predecessor.start + lagDays` |

`finish`를 소비하는 `FINISH_START`만 엄격 부등호다. 선행이 끝나는 날 후행이 시작하면 하루가 겹친다. 나머지는 같은 날이 정상이다(동시 착수, 동시 완료).

### 넣지 않는 것

**캘린더.** ADR-0005은 캘린더를 Phase 5로 미뤘다고 적었으나, 마스터 계획 9절의 Phase 5 항목에 캘린더는 없다. 4.3절 모듈 설명에만 있다. 근무일 기반 기간 산정이라는 소비자가 생길 때(자동 계산을 도입할 때) 붙인다.

**`durationDays`와 `isMilestone`.** 각각 `finish - start`와 `start === finish`로 나온다. 저장하면 진실이 둘이 된다.

**`IfcTask.Identification`에 대응하는 표시 코드.** 지금 쓸 화면이 없다.

### 마이그레이션

`parseSchedule`이 v1과 v2를 모두 받고 내부 표현은 v2 하나로 통일한다. v1 파일은 `parentTaskId` 없음, `dependencies` 빈 배열로 승격된다. 읽는 쪽은 버전을 분기하지 않는다.

`packages/test-fixtures/schedule/`에 v1 fixture를 하나 남겨 승격 경로를 테스트로 고정한다. v3가 필요해질 때의 선례가 된다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| WBS를 경로 코드(`"1.2.3"`)로 | 사람이 읽기 쉽다 | 항목을 옮길 때마다 하위 전체를 다시 매겨야 한다 | 편집이 있는 제품에서 감당할 수 없다 |
| WBS를 별도 트리 노드로 | 그룹과 작업의 역할이 분명하다 | Task와 그룹 두 타입이 되어 CRUD·검증·표시를 두 벌 만들게 된다 | Phase 5 분량을 두 배로 늘린다 |
| 선후행 `FINISH_START`만 | 실무의 8~9할을 덮는다. 구현이 가장 작다 | `IfcRelSequence`나 외부 일정에서 들어온 다른 유형을 읽는 순간 잃는다. 늘리려면 `schemaVersion`을 또 올려야 한다 | 저장만 하는 값이라 네 값을 받는 비용이 검증 규칙 네 줄 차이다 |
| 요약 Task의 시간을 무시하고 계산값 사용 | 외부 파일을 관대하게 받는다 | 파일에 적힌 값과 화면 값이 달라진다 | `AGENTS.md`가 조용한 처리를 금지한다 |
| 본 결정 | v1에서 필드 둘만 늘고, 읽는 쪽은 버전을 모른다 | 자동 일정 계산이 없어 날짜는 사용자 몫이다 | — |

## 결과

- Phase 5의 Task CRUD·WBS·선후행·검증이 착수 가능해진다. Gantt는 이 표현 위에 그린다.
- `parseSchedule`이 v1·v2의 유일한 해석 지점으로 남는다. 소비자는 버전을 분기하지 않는다.
- 선후행을 저장만 하므로, 일정을 고치면 위반 경고가 뜨고 사용자가 직접 날짜를 맞춘다. 자동 재계산을 도입할 때 이 결정을 다시 연다.
- `IfcRelSequence` Export는 위 표대로 옮기면 된다. 왕복 검증은 Phase 7이다.

## 후속 작업

- [x] `AGENTS.md` 1.4절 갱신 (WBS·선후행 해소, 캘린더는 미결정으로 남김)
- [x] `packages/contracts/src/schedule.ts`에 v2 타입 정의
- [ ] 자동 일정 계산(CPM) 도입 여부는 별도 결정
- [ ] 캘린더는 근무일 기반 기간 산정을 도입할 때 별도 결정
- [ ] Phase 7에서 `IfcRelSequence` 왕복 검증
