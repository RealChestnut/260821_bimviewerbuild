# 작업 기록 — 일정 표 인라인 편집 (Phase 5 마감)

- 날짜: 2026-09-02
- 브랜치: `claude/local-server-typescript-65r59l`
- 대상 Phase: Phase 5 — Scheduler (마스터 계획 9절)

---

## 1. 배경 — 왜 이 작업이 남아 있었나

Phase 5의 항목은 Task CRUD, WBS, 기본 선후행, Gantt, 일정 검증, JSON/CSV 가져오기·내보내기다. 이 중 도메인 계층과 명령 계층은 이미 서 있었다.

| 항목 | 도메인 | 명령 | 화면 |
| --- | --- | --- | --- |
| Task CRUD | `applyScheduleEdit` | `scheduler/edit-schedule` | 없음 |
| WBS | `parentTaskId`, `flattenTasks` | 같음 | 없음 |
| 선후행 | `DependencyType` 4종 + `lagDays` | 같음 | 없음 |
| Gantt | — | — | 있음 |
| 검증 | `validateSchedule` | — | 있음 |
| CSV·JSON | `parseScheduleCsv`, `serializeScheduleCsv` | `scheduler/load-*`, `export-schedule` | 있음 |

화면에서 일정을 고치는 길만 비어 있었다. 원래는 `scheduleEditorPanel`이 있었으나 `79da5ac`가 걷어냈다. 그 커밋의 이유는 "좁은 폼으로 Task를 고치는 것이 CSV 왕복보다 불편했다"였고, 도메인 편집 연산과 `scheduler/edit-schedule` 명령은 남겨 두었다.

## 2. 결정 — 세 갈래 중 무엇을 골랐나

| 갈래 | 내용 | 판단 |
| --- | --- | --- |
| A. 표 안 인라인 편집 | 열 칸을 그 자리에서 입력칸으로 연다 | **채택** |
| B. 별도 편집 화면 복원 | `79da5ac`가 지운 패널을 전폭에 맞춰 되살린다 | 기각 |
| C. 편집 UI 없이 종료 | CSV 왕복을 유일한 편집 경로로 ADR에 못 박는다 | 기각 |

A를 고른 근거는 `79da5ac`가 문제 삼은 것이 **폼이라는 형식**이 아니라 **보는 자리와 고치는 자리가 갈라진 구조**였다는 점이다. 당시에는 목록이 18rem 사이드바에 있어 폼을 나란히 놓을 수도 없었다. `79da5ac`와 `1bd32da`를 거치며 일정 독이 뷰어 아래 전폭으로 나오고 `ID · 이름 · 시작 · 종료 · 부재 수` 열이 섰으므로, 값마다 자기 칸이 이미 있다. 그 칸을 여는 편이 폼을 다시 만드는 것보다 곧다.

범위는 "전부 한 번에"로 정했다. 셀 편집·CRUD·WBS·선후행이 모두 `scheduler/edit-schedule` 하나를 쓰는 같은 기능이라, 쪼개면 반쪽 화면이 중간 커밋에 남는다.

## 3. 진행 순서

TDD를 따랐다 (AGENTS.md 4절, 마스터 계획 10절). 각 단계는 테스트를 먼저 쓰고 통과시키는 순서다.

### 3.1 계약 확장 — 줄에 상위 Task를 싣는다

들여쓰기는 "바로 위 형제를 부모로", 내어쓰기는 "부모의 부모로"인데, 둘 다 부모가 누구인지 알아야 정해진다. 깊이만으로는 부족하다.

1. `schedulerComponent.test.ts`에 `줄마다 상위 Task를 함께 알린다` 추가 (실패)
2. `schedulerEvents.ts`의 `ScheduleTaskRow`에 `parentTaskId?: TaskId` 추가
3. `schedulerComponent.ts`의 `toRows`가 `row.task.parentTaskId`를 실어 보내도록 수정 (통과)

값이 없을 때 키를 만들지 않는 기존 방식(`...(x === undefined ? {} : { x })`)을 그대로 따랐다. `exactOptionalPropertyTypes` 아래에서 `undefined`를 명시적으로 넣으면 타입이 어긋난다.

### 3.2 순수 함수 — WBS 이동 규칙

1. `scheduleRowEditing.test.ts`를 먼저 작성 (실패)
2. `scheduleRowEditing.ts`에 `indentEdit`, `outdentEdit` 구현 (통과)

두 함수는 DOM을 모른다. 줄 목록과 한 줄을 받아 `ScheduleEdit`이나 `null`을 돌려준다. `null`은 "할 수 없다"이며 화면은 그때 버튼을 잠근다.

- 들여쓰기: 같은 부모를 둔 바로 앞 줄을 찾아 그 `taskId`를 새 부모로 삼는다. 앞 형제가 없으면 `null`이다. 부모 없이 깊이만 늘리면 계층이 아니라 여백이 된다.
- 내어쓰기: 부모의 `parentTaskId`를 새 부모로 삼는다. 부모가 최상위였으면 `null`을 실어 보낸다. 생략은 "그대로 둔다"이고 `null`이라야 "지운다"가 된다 (`applyScheduleEdit`의 규칙).

### 3.3 화면 조각 — 편집 UI 부품

`scheduleRowEditing.ts`에 DOM 조각 넷을 더했다. 표를 그리는 일과 그 줄에 편집을 붙이는 일을 갈라 두기 위해서다.

| 함수 | 만드는 것 | 규칙 |
| --- | --- | --- |
| `createEditableCell` | 눌러서 고치는 칸 | Enter·blur 확정, Esc 취소, 값이 그대로면 보내지 않음 |
| `createRowActions` | 줄 끝 버튼 `⇥ ⇤ ↔ ×` | 삭제 시 사라진 부재 연결 수를 알림 |
| `createDependencyEditor` | 선후행 줄 | 들어오는 선행만 칩으로, 자기 자신은 선행 목록에서 제외 |
| `createDraftRow` | 새 Task 줄 | `taskId`를 앱이 지어내지 않음 |

`taskId`를 자동 생성하지 않는 이유는 ID가 외부 공정표와 대조할 때 사람이 읽는 값이기 때문이다. 앱이 `task-7` 같은 값을 만들면 CSV 왕복에서 맞춰 볼 수 없다.

### 3.4 조립 — 표 패널

1. `scheduleTablePanel.test.ts`에 편집 관련 describe 넷(칸 편집 / WBS와 삭제 / Task 추가 / 선후행)과 초점 describe 하나를 추가 (실패)
2. `scheduleTablePanel.ts`를 편집까지 맡도록 고쳐 통과

패널이 새로 갖게 된 상태는 넷이다.

- `rows`, `dependencies` — 마지막으로 받은 일정. 다시 그릴 때 쓴다
- `linksTaskId` — 선후행 줄을 펼쳐 둔 Task. 다시 그려도 유지한다
- `drafting` — 새 Task 줄을 열어 두었는가
- `openCell` — 방금 연 칸. 편집 뒤 표를 다시 그려도 같은 자리로 초점을 되돌린다

`openCell`이 필요한 이유는 편집이 성공하면 `scheduler/schedule-changed`가 와서 표가 통째로 다시 그려지고, 그때 열려 있던 입력칸이 사라지기 때문이다. 그래서 명령은 확정 시점에만 보내고, 다시 그린 뒤 같은 줄·같은 칸으로 초점을 돌려 놓는다.

실패 메시지는 두 겹이다. `scheduler/edit-failed`를 받으면 도메인이 낸 이유를 그대로 적고 `failureCount`를 올린다. 명령 결과가 실패인데 `failureCount`가 그대로면 명령 앞에서 막힌 경우이므로 그때만 일반 문구를 적는다. 도메인의 구체적인 이유를 일반 문구로 덮지 않기 위한 장치이며, 지운 `scheduleEditorPanel`에 있던 방식을 그대로 가져왔다.

### 3.5 배치 — 열 하나를 더한다

`index.html`에서 열 정의를 고쳤다.

```
--schedule-columns: 6rem 16rem 6.5rem 6.5rem 3rem 6rem;
--schedule-columns-width: calc(6rem + 16rem + 6.5rem + 6.5rem + 3rem + 6rem + 6 * 0.5rem);
```

머리글에는 같은 자리에 `+ Task` 버튼을 놓았다. `--schedule-columns-width`는 시뮬레이션 커서가 막대 칸에만 겹치도록 밀어 낼 폭이므로, 열이 늘면 이 값도 함께 늘려야 한다. 열 폭을 코드가 알면 CSS와 두 곳에서 같은 값을 지켜야 하므로 변수 하나로 둔다는 `1bd32da`의 원칙을 유지했다.

선후행 줄과 새 Task 줄은 같은 `<ol>` 안의 `<li>`지만 열 격자를 쓰지 않는다. 속성 선택자로 `display: flex`를 덮어써서 한 줄로 편다.

### 3.6 브라우저 계약 — e2e

`tests/e2e/scheduler.spec.ts`에 `Scheduler — 화면 편집` describe(테스트 11개), `tests/e2e/scheduleLayout.spec.ts`에 `일정 독 배치 — 편집` describe(테스트 3개)를 더했다.

배치 계약을 따로 둔 이유는 AGENTS.md 4절이 적어 둔 그대로다. 나머지 e2e는 testid의 존재와 개수와 글자만 보므로, 버튼이 줄 높이를 키워 왼쪽 열과 오른쪽 막대가 어긋나도 전부 통과한다. 그래서 다음 셋을 재는 테스트를 뒀다.

- 줄 끝 버튼 넷이 줄 높이를 넘지 않는다
- 입력칸을 열어도 막대 칸의 x와 폭이 그대로다
- 펼친 선후행 줄이 표 밖으로 넘치지 않는다

screenshot 기준선은 의도한 변경이므로 `--update-snapshots`로 갱신했다. 열 하나와 편집 컨트롤이 늘어난 것이 이유다.

## 4. e2e가 드러낸 도메인 규칙 둘

처음 쓴 e2e 두 개가 실패했고, 원인이 화면이 아니라 도메인 규칙이었다. 테스트를 고치고 규칙을 확인하는 테스트를 각각 하나씩 더했다.

1. **시간을 가진 Task 밑으로 들여쓸 수 없다.** T003을 앞 형제 T002 밑으로 넣으면 T002가 요약 Task가 되는데 T002는 제 시간을 갖고 있다. ADR-0006이 금지한 상태라 `schedule.parse.summary-task-has-time`으로 거부된다. 화면은 막지 않고 이유를 옮겨 적는다.
2. **선후행은 순환할 수 없다.** T001 → T002 → T003이 이미 있으므로 T003을 T001의 선행으로 걸면 고리가 된다. `applyScheduleEdit`이 거부하고 화면은 "선후행이 순환한다"를 적는다.

두 경우 모두 화면이 미리 판단하지 않는다는 설계가 그대로 드러났다. 화면이 규칙을 흉내 내기 시작하면 도메인과 두 곳에서 같은 규칙을 지켜야 한다.

## 5. 만들고 고친 파일

| 파일 | 성격 |
| --- | --- |
| `apps/viewer-web/src/shell/scheduleRowEditing.ts` | 신규 — 편집 규칙과 DOM 조각 |
| `apps/viewer-web/src/shell/scheduleRowEditing.test.ts` | 신규 — 순수 함수 단위 테스트 6개 |
| `apps/viewer-web/src/shell/scheduleTablePanel.ts` | 수정 — 편집 조립, 상태 넷, 초점 복원 |
| `apps/viewer-web/src/shell/scheduleTablePanel.test.ts` | 수정 — 편집 테스트 28개 추가 |
| `apps/viewer-web/src/scheduler/schedulerEvents.ts` | 수정 — `ScheduleTaskRow.parentTaskId` |
| `apps/viewer-web/src/scheduler/schedulerComponent.ts` | 수정 — `toRows`가 상위 Task를 실음 |
| `apps/viewer-web/src/scheduler/schedulerComponent.test.ts` | 수정 — 계약 테스트 1개 추가 |
| `apps/viewer-web/index.html` | 수정 — 열 하나, `+ Task` 버튼, 편집 CSS |
| `apps/viewer-web/src/main.ts` | 수정 — `addButtonSelector` 배선 |
| `tests/e2e/scheduler.spec.ts` | 수정 — 편집 시나리오 11개 |
| `tests/e2e/scheduleLayout.spec.ts` | 수정 — 배치 계약 3개 |
| `tests/e2e/scheduleLayout.spec.ts-snapshots/schedule-dock-chromium-win32.png` | 갱신 — 의도한 화면 변경 |

## 6. 구조 — 데이터가 흐르는 길

```text
사용자가 칸을 누른다
  └ createEditableCell        입력칸을 연다 (확정 전에는 아무것도 보내지 않는다)
      └ scheduleTablePanel.submit
          └ commands.dispatch('scheduler/edit-schedule', { edits })
              └ schedulerComponent.editSchedule
                  ├ repository.get()
                  ├ applyScheduleEdits(schedule, edits)   도메인이 판단한다
                  │   ├ 실패 → events.publish('scheduler/edit-failed')  →  화면이 이유를 적는다
                  │   └ 성공 ↓
                  ├ repository.save()
                  └ events.publish('scheduler/schedule-changed')
                      └ scheduleTablePanel이 표를 다시 그리고 초점을 되돌린다
```

지킨 경계는 셋이다.

- 화면은 규칙을 판단하지 않는다. 편집을 만들어 보내고 이유를 옮겨 적는다
- 일정을 고치는 곳은 `schedulerComponent` 하나다 (마스터 계획 5.4절)
- 편집 결과도 `parseSchedule`을 다시 거치므로 파일로 들어온 일정과 같은 규칙을 받는다

## 7. 쓴 언어와 도구

| 갈래 | 쓴 것 |
| --- | --- |
| 언어 | TypeScript 5.9.3 (strict, `exactOptionalPropertyTypes`), HTML, CSS |
| DOM | 라이브러리 없이 `document.createElement`. 프레임워크를 들이지 않았다 |
| 단위 테스트 | Vitest 4 + jsdom (`// @vitest-environment jsdom`) |
| 브라우저 테스트 | Playwright (chromium) |
| 형식 | Prettier, ESLint (type-aware) |
| 패키지 | pnpm 10 workspace |

프레임워크를 쓰지 않은 것은 기존 shell 패널들과 같은 방식을 지킨 것이다. 이 저장소의 화면 조각은 모두 `AppComponent` 생명주기(`initialize` → `start` → `stop` → `dispose`)를 구현하는 팩토리 함수이며, 새 패널도 같은 모양을 따랐다.

## 8. 따른 방법론

- **TDD** — 단계마다 테스트를 먼저 쓰고 구현했다 (AGENTS.md 4절)
- **Ports/Adapters + Vertical Slice** — 화면은 명령과 Event로만 Scheduler와 이야기한다
- **Typed Event-Driven** — Event와 Command 이름은 선언 병합으로 계약에 등록되어 있고 문자열로 흩어 쓰지 않는다
- **배치 계약 테스트** — 마스터 계획 10.2절 Visual 계층. 그려진 결과의 크기와 자리를 잰다
- **결정은 ADR이 정본** — 화면은 ADR을 흉내 내지 않고 도메인이 낸 결과를 옮긴다

## 9. 참조

| 참조 | 무엇을 가져왔나 |
| --- | --- |
| `docs/DEVELOPMENT_MASTER_PLAN.md` 5.4절, 9절, 10.2절 | 일정의 주인, Phase 5 항목, Visual 계층 |
| `docs/adr/0002-4d-operation-vocabulary.md` 경계 규칙 4 | 빈 칸은 "값 없음"이며 0이나 오늘로 대체하지 않는다 |
| `docs/adr/0005-schedule-schema.md` | 날짜는 UTC `YYYY-MM-DD` |
| `docs/adr/0006-schedule-schema-v2.md` | 요약 Task는 제 시간을 갖지 않는다, 선후행은 저장·검증만 한다 |
| `docs/adr/0007-schedule-csv-exchange.md` | CSV 네 파일 왕복 |
| `AGENTS.md` 1.4절, 4절 | 미결정 항목을 임의로 채우지 않는다, TDD, 배치 계약, 스냅샷 갱신 규칙 |
| 커밋 `79da5ac` | 편집 화면을 걷어낸 이유. 이번 설계의 출발점 |
| 커밋 `1bd32da` | 표와 막대를 한 줄로 합친 이유, 열 폭을 CSS 변수 하나로 두는 원칙 |
| 커밋 `421f29b` | ID 잠금, 요약 Task 시간 잠금, 삭제 시 연결 수 알림 규칙 |

## 10. 검증 결과

| 게이트 | 결과 |
| --- | --- |
| `pnpm test` | 39개 파일 533개 통과 (편집 관련 35개 추가) |
| `pnpm typecheck` | 통과 |
| `pnpm lint` | 통과 |
| `pnpm test:e2e tests/e2e/scheduler.spec.ts` | 25개 통과 |
| `pnpm test:e2e tests/e2e/scheduleLayout.spec.ts` | 11개 통과 (스냅샷 갱신 후) |

## 11. 손대지 않은 것

AGENTS.md 1.4절의 미결정 항목이라 임의로 정하지 않았다.

- 근무일 캘린더, CPM 자동 계산 — 선후행을 더해도 날짜가 밀리지 않는 것은 이 때문이다
- Duration, Total Float 열 — 위 두 가지가 정해져야 값이 생긴다
- 부재 연결 편집 — Phase 6의 일이다. 부재 수 칸은 읽기 전용으로 두었다
- `modelRef` fingerprint 바인딩 — Phase 6에서 교체한다
