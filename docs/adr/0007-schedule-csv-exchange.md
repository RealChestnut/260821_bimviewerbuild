# ADR-0007: 일정 CSV 교환 형식을 파일 네 개로 정한다

- 상태: 채택
- 날짜: 2026-08-24
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 9절(Phase 5) · ADR-0005 · ADR-0006 · `AGENTS.md` 1.4, 4절
- 해소 대상: 마스터 계획 9절 Phase 5의 "JSON/CSV 가져오기·내보내기"에서 CSV의 내부 구조

## 맥락

Phase 5는 일정의 JSON/CSV 가져오기·내보내기를 요구한다. JSON은 ADR-0005와 ADR-0006이 스키마를 확정했고 `parseSchedule`이 이미 읽는다. CSV는 구조가 정해진 적이 없다.

불일치가 하나 있다. 일정은 배열 셋(`tasks`, `dependencies`, `assignments`)과 머리말 셋(`scheduleId`, `name`, `schemaVersion`)으로 이루어진 중첩 구조인데, CSV는 평평한 표 하나다. 이 간극을 어떻게 메우는지가 이 결정의 전부다.

또 하나. `AGENTS.md` 4절은 결정 없이 임의로 채우는 것을 금지하고, ADR-0005의 결과절은 "`parseSchedule`이 이 스키마의 유일한 해석 지점"이라고 적었다. CSV가 두 번째 해석 지점이 되면 두 경로의 검증이 갈라진다.

## 결정

### 파일 네 개의 묶음

| 파일 | 열 | 필수 |
| --- | --- | --- |
| `schedule.csv` | `scheduleId,name,schemaVersion` | 필수. 데이터 행 정확히 1개 |
| `tasks.csv` | `taskId,name,parentTaskId,start,finish` | 필수 |
| `assignments.csv` | `taskId,modelRef,productGlobalId,operation` | 필수 |
| `dependencies.csv` | `predecessorId,successorId,type,lagDays` | 선택. 없으면 선후행 없음 |

내보내기는 항상 넷을 모두 쓴다. 선후행이 없으면 `dependencies.csv`는 헤더만 남는다.

**셋이 아니라 넷이다.** 배열이 셋이므로 파일도 셋이면 충분해 보이지만, 그러면 `scheduleId`와 `name`을 적을 자리가 사라진다. 이를 파일명에서 추론하면 `name`이 왕복에서 사라지고, `tasks.csv`의 열로 접으면 같은 값이 행마다 반복되어 진실이 여럿이 된다. 머리말은 머리말의 자리를 갖는다.

### 값 표기

- 인코딩은 UTF-8. 선행 BOM은 받아서 버리고, **내보낼 때는 붙인다.** Windows Excel은 BOM이 없는 UTF-8 CSV를 현재 코드 페이지로 읽어 한글을 깨뜨린다. 읽는 쪽이 버리므로 왕복 결과는 붙이든 안 붙이든 같다. JSON에는 붙이지 않는다. `JSON.parse`가 선행 BOM에서 실패한다.
- 개행은 LF와 CRLF를 모두 받는다. 내보낼 때는 CRLF를 쓴다. Excel이 기본으로 기대하는 개행이다.
- 구분자는 쉼표. 값에 쉼표·큰따옴표·개행이 있으면 RFC 4180대로 큰따옴표로 감싸고 안의 큰따옴표는 두 번 쓴다. 내보낼 때는 필요한 값만 감싼다.
- 날짜는 `YYYY-MM-DD`. 빈 칸은 "값 없음"이며 `0`이나 오늘로 대체하지 않는다 (ADR-0002 경계 규칙 4).
- `lagDays`의 빈 칸은 `0`이다. 음수는 선행(lead)이다.
- 첫 줄은 헤더 행이다. **열 순서는 상관없다.** 이름으로 찾는다.

### 모르는 열은 거부한다

헤더에 정의되지 않은 열이 있으면 파일을 읽지 않는다. 무시하고 넘어가면 사용자가 적어 넣은 정보가 조용히 사라지고, 오타 난 열 이름(`taskID`)이 "값 없음"으로 둔갑한다. `AGENTS.md`가 금지하는 조용한 처리다.

같은 이유로 행의 칸 수가 헤더와 다르면 거부한다.

### 검증은 JSON과 같은 경로를 쓴다

CSV는 **읽어서 v2 JSON과 같은 모양의 객체로 바꾼 뒤 `parseSchedule`에 넘긴다.** CSV 자신은 표 모양만 검사한다.

| CSV가 보는 것 | `parseSchedule`이 보는 것 |
| --- | --- |
| 헤더 누락·오타·중복 | `taskId` 중복, 없는 참조, 순환 |
| 행의 칸 수 불일치 | 날짜 형식, `finish < start` |
| `schemaVersion`이 정수가 아님 | `operation`·`type` 값 집합 |
| `lagDays`가 정수가 아님 | GlobalId 형식, 요약 Task 규칙 |

이렇게 하면 해석 지점이 둘로 갈라지지 않는다. CSV로 들어온 일정과 JSON으로 들어온 일정은 같은 규칙으로 거부되고 같은 오류 코드를 낸다.

오류 코드는 표 모양 문제일 때 `schedule.csv.*`, 그 뒤는 기존 `schedule.parse.*`다.

### 내보내기

- JSON 내보내기는 `schemaVersion` 2의 v2 형식 한 파일이다. 읽어 들인 파일이 v1이었어도 v2로 나간다. 내부 표현이 v2 하나이기 때문이다 (ADR-0006).
- CSV 내보내기는 위 네 파일이다.
- 어느 쪽이든 **왕복이 무손실이어야 한다.** 내보낸 것을 다시 읽으면 같은 `Schedule`이 나온다. 이것을 테스트로 고정한다.

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| 파일 하나 + `recordType` 열 | 파일이 하나다 | 열 이름이 행 종류마다 다른 뜻이 된다. Excel에서 읽기 나쁘고 열이 희소하다 | 사람이 편집하는 형식인데 사람이 못 읽는다 |
| 파일 하나 + 다중값 열 접기 | Excel 편집이 가장 쉽다 | 값 안의 구분자와 충돌한다. `modelRef`는 파일명이라 무엇이든 들어올 수 있다 | 구분자 이스케이프 규칙을 또 정의하게 된다 |
| 파일 셋 (머리말 없음) | 배열과 1:1 | `name`이 왕복에서 사라진다 | 무손실 왕복을 포기하게 된다 |
| CSV 전용 검증기를 따로 작성 | CSV 고유 오류를 세밀하게 낸다 | 검증 규칙이 두 벌이 되어 갈라진다 | ADR-0005의 "유일한 해석 지점"을 깬다 |
| 본 결정 | 무손실이고 검증이 한 곳이다 | 파일이 넷이라 사용자가 넷을 다룬다 | — |

## 결과

- Phase 5의 CSV 왕복이 착수 가능해진다. `packages/domain/src/scheduleCsv.ts`가 표 모양만 다루고, 의미 검증은 `parseSchedule`에 남는다.
- CSV에는 `schemaVersion`이 적히지만 v1 개념이 없다. CSV는 v2부터 존재하므로 `1`을 적으면 `parseSchedule`이 v1로 읽고 승격한다. 실질적 차이는 없다.
- 파일이 넷이라 브라우저 내보내기는 다운로드를 넷 발생시킨다. 묶음 파일(zip)은 의존성을 늘리므로 넣지 않는다. 필요해지면 그때 연다.
- Phase 6에서 `modelRef` 바인딩이 fingerprint로 바뀌면 `assignments.csv`의 열이 함께 바뀐다. 그때 이 ADR을 다시 연다.

## 후속 작업

- [x] `AGENTS.md` 1.4절 해소 표에 추가
- [x] `packages/domain/src/scheduleCsv.ts`와 왕복 테스트
- [x] `packages/test-fixtures/schedule/csv/`에 묶음 fixture
- [ ] Phase 6에서 `modelRef` 열 재검토
