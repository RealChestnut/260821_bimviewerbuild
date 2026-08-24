# ADR-0005: 일정과 Task–Element 연결의 필드 스키마를 확정한다

- 상태: 채택
- 날짜: 2026-08-22
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 6.2절, 9절(Phase 4·5·6) · `docs/IFC_통합_정리_2026-08-20.md` 13, 19.2절 · ADR-0002 · `AGENTS.md` 1.4절
- 해소 대상: `AGENTS.md` 1.4절 미결정 항목 "Schedule / Task–Element Mapping의 필드 수준 스키마"

## 맥락

기준서 19.2절은 Schedule의 핵심 ID가 `task_id`, Task-Element Mapping의 핵심 ID가 `task_id + element_id`라고만 적고 필드를 정의하지 않는다. 마스터 계획 6.2절의 `Assignments`도 네 필드 이름만 나열한다. ADR-0002가 `operation`의 값 집합을 닫았지만 나머지는 비어 있었고, `AGENTS.md` 1.4절이 이를 미결정으로 표시하며 임의로 채우지 말라고 못박고 있었다.

Phase 4(Mock 4D Simulation)는 "고정 JSON 일정 fixture"로 시작하므로 이 스키마 없이는 착수할 수 없다.

두 가지 제약이 설계를 좁힌다.

1. **`ModelId`를 파일에 적을 수 없다.** 영구 연결 키는 `modelId + GlobalId`인데(`AGENTS.md` 2.2절), `ModelId`는 모델을 적재할 때 만들어지는 런타임 값이다. 일정 파일은 모델보다 오래 살고 다른 PC에서도 열린다.
2. **시간이 없는 Task가 있다.** ADR-0002 경계 규칙 4가 이를 정상 입력으로 규정한다. 스키마가 시간을 필수로 만들면 규칙과 충돌한다.

## 결정

### 일정 파일 스키마 (`schemaVersion: 1`)

```json
{
  "scheduleId": "mock-three-elements",
  "name": "three-elements-ifc4 Mock 4D 일정",
  "schemaVersion": 1,
  "tasks": [
    { "taskId": "T001", "name": "슬래브 타설", "start": "2026-03-02", "finish": "2026-03-06" },
    { "taskId": "T006", "name": "검사 (일정 미정)" }
  ],
  "assignments": [
    {
      "taskId": "T001",
      "modelRef": "three-elements-ifc4.ifc",
      "productGlobalId": "2YsHnV6bk3PgZdL9uCxWtM",
      "operation": "CONSTRUCT"
    }
  ]
}
```

| 필드 | 규칙 |
| --- | --- |
| `schemaVersion` | `1`만 읽는다. 모르는 버전은 거부한다 |
| `tasks[].taskId` | 파일 안에서 유일하다. 중복은 거부한다 |
| `tasks[].start` / `finish` | `YYYY-MM-DD`. **생략 가능**하며, 있으면 UTC 자정의 epoch milliseconds로 읽는다. `finish < start`는 거부한다 |
| `assignments[].taskId` | `tasks`에 있어야 한다. 없으면 거부한다 |
| `assignments[].modelRef` | 모델 파일명. 적재된 모델의 `displayName`과 맞춰 `ModelId`로 바인딩한다 |
| `assignments[].productGlobalId` | `IfcRoot.GlobalId`. 22자 IFC base64 형식을 검사한다 |
| `assignments[].operation` | ADR-0002의 `TaskOperation` 네 값 |

**날짜는 UTC로 고정한다.** 지역 시간대로 읽으면 같은 파일이 여는 장소에 따라 하루 어긋난다. 일정의 날짜는 달력상의 날짜이지 특정 순간이 아니다.

**Phase 4가 쓰지 않는 필드는 넣지 않는다.** WBS(`parentTaskId`), 선후행(`dependencies`), 캘린더는 Phase 5에서 소비자와 함께 추가하고 `schemaVersion`을 올린다.

### modelRef 바인딩

`modelRef`는 파일명이고, 적재된 모델의 `displayName`과 일치할 때 `ModelId`로 묶인다. 열려 있지 않은 모델의 할당은 시뮬레이션에서 조용히 제외되며, 그 모델이 나중에 열리면 그 시점에 묶여 현재 시각의 상태가 적용된다.

이는 **잠정 수단이다.** 같은 파일명을 가진 서로 다른 모델을 구분하지 못하고, 파일명이 바뀌면 연결이 끊어진다. Phase 6(모델 교체 및 GlobalId 재매칭)에서 fingerprint 기반으로 강화한다.

### ElementDisplayState의 화면 표현

ADR-0002가 Phase 4로 미뤄 둔 항목이다.

| 상태 | 표현 |
| --- | --- |
| `HIDDEN` | 렌더링하지 않는다 (`setVisible(false)`) |
| `IN_PROGRESS` | 반투명 주황(`#f59e0b`, opacity 0.6)으로 덧칠한다 |
| `PRESENT` | 원래 표현으로 되돌린다 |

철거가 끝난 부재는 고스트로 남기지 않는다. ADR-0002가 `HIDDEN`을 "렌더링하지 않는다"로 정의했고, 이를 지키면 `HIDDEN`의 원인(미시공/철거완료/가설철거)과 무관하게 화면 규칙이 하나로 유지된다.

**알려진 한계.** 선택 강조와 시뮬레이션 덧칠이 That Open의 같은 강조 통로를 쓴다. 한 부재가 선택된 채로 시뮬레이션 상태가 바뀌면 선택 강조가 지워진다. 다시 누르면 복원되며, 표현 계층을 분리하는 것은 Phase 4의 범위가 아니다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| Phase 5까지 선반영한 스키마 | 나중에 마이그레이션이 없다 | 소비자 없는 필드를 테스트 없이 정의하게 된다 | `AGENTS.md` 4절(테스트 없이 기능 코드를 추가하지 않는다)과 충돌한다 |
| IfcTask 구조를 그대로 반영 | Phase 7 IFC 왕복이 쉬워진다 | 도메인이 Schema 어휘에 묶인다. `IfcTaskTime`은 14개 시간 필드를 갖는데 Phase 4가 쓰는 것은 둘뿐이다 | ADR-0002가 `IfcTaskTypeEnum` 직접 사용을 기각한 것과 같은 이유다 |
| `modelRef` 대신 `modelId`를 파일에 기록 | 바인딩 단계가 없다 | `ModelId`는 적재 시 생성되는 런타임 값이라 파일에 적을 수 없다 | 성립하지 않는다 |
| 본 결정 | Phase 4가 쓰는 것만 정의하고 전부 검증한다 | Phase 5에서 `schemaVersion`을 올려야 한다 | — |

## 결과

- Phase 4가 착수 가능해진다. `packages/domain/src/schedule.ts`가 이 스키마의 유일한 해석 지점이다.
- 검증 실패는 예외가 아니라 `Parsed<T>` 값으로 나오고, 코드는 `schedule.parse.*`로 안정된다. 화면은 `simulation/schedule-load-failed` Event로 이유를 받는다.
- `modelRef` 바인딩이 잠정이므로 Phase 6에서 다시 열린다.
- Phase 5에서 WBS·선후행·캘린더를 추가할 때 `schemaVersion`을 2로 올리고 마이그레이션 경로를 정의해야 한다.

## 후속 작업

- [x] `AGENTS.md` 1.4절 갱신 (미결정 목록에서 해소 표로 이동)
- [x] `packages/contracts/src/schedule.ts`에 타입 정의
- [ ] Phase 5에서 WBS·선후행·캘린더 추가와 `schemaVersion` 2 마이그레이션
- [ ] Phase 6에서 `modelRef` 바인딩을 fingerprint 기반으로 교체
- [ ] Phase 7에서 IFC Export 왕복 검증 후 ADR-0002의 잠정 매핑 확정
