# 작업 기록 — IFC–Task 매칭 (Phase 6)

- 날짜: 2026-09-02
- 브랜치: `feature/task-element-assignment`
- 대상 Phase: Phase 6 — IFC–Task 매칭 (마스터 계획 9절)

---

## 1. 무엇을 만들었나

마스터 계획 9절 Phase 6의 항목 다섯을 모두 이었다.

| 항목 | 어디에 |
| --- | --- |
| Viewer 선택 객체를 Task에 할당 | 일정 표의 부재 수 칸 → 연결 줄 → `고른 부재 걸기` |
| Task 선택 시 연결 객체 강조 | 연결 줄의 `3D에서 보기` |
| 미연결 객체와 미연결 Task 필터 | 일정 독 머리의 `미연결 Task만`, `미연결 부재 고르기` |
| 모델 교체 및 GlobalId 재매칭 | fingerprint 바인딩(ADR-0008) + `이 모델로 교체` |
| 연결 충돌 검증 | `validateSchedule`의 경고 두 종 |

## 2. 진행 순서와 그 이유

착수 전에 순서를 두고 저울질했다. 후보는 "바인딩 규칙(ADR)을 먼저 닫는다"와 "할당 편집부터 만든다" 둘이었고, 뒤쪽을 골랐다.

근거는 셋이다. 바인딩 규칙은 "지금 이 파일이 그 모델이 맞나"를 판정하는 규칙인데 판정이 필요한 자리(할당을 만들고 다시 여는 화면)가 아직 없었다. 없는 소비자를 상상해 정하면 ADR-0006이 피한 실수를 반복한다. 할당 편집과 화면은 바인딩 방식과 무관하게 모양이 같다. 그리고 재매칭은 규칙이 정해진 뒤에야 뜻이 생긴다.

대신 조건을 하나 걸었다. **`ModelId` ↔ `modelRef` 변환을 한 곳에 가두는 것**이다. 그 조건을 지키면 규칙이 바뀌어도 고칠 자리가 한 곳이고, 안 지키면 화면 여러 곳을 훑어야 한다. 실제로 ADR-0008을 적용할 때 화면 코드는 한 줄도 고치지 않았다.

### 2.1 도메인 — 할당 편집 (`898676d`)

1. `scheduleEdit.test.ts`에 `assign-products` / `unassign-products` 테스트를 먼저 쓰고 구현
2. `parseSchedule`에 중복 연결 거부(`schedule.parse.duplicate-assignment`) 추가
3. `validateSchedule`에 충돌 경고 둘 추가

정한 규칙과 이유:

- `assign-products`는 부재 여럿을 한 번에 받는다. 뷰어에서 여러 부재를 골라 한 Task에 붙이는 것이 이 편집의 쓰임이다.
- 이미 걸린 부재는 행을 늘리지 않고 `operation`만 갱신한다. 하나가 이미 걸려 있다고 전부 실패시키면 고른 것을 다시 골라야 한다.
- `unassign-products`는 하나라도 없으면 아무것도 지우지 않는다. 절반만 끊긴 결과를 남기지 않는다.
- 한 Task와 한 부재의 연결은 하나다. 키에 `modelRef`를 넣는 것은 부재의 영구 키가 모델까지 포함하기 때문이다 (AGENTS.md 2.2절).
- 충돌은 경고다. `product-constructed-twice`(같은 부재를 두 Task가 시공), `demolish-before-construct`(시공이 끝나기 전에 철거가 시작). 시공 없이 철거만 있는 부재는 알리지 않는다. 기존 구조물 철거는 정상 입력이다.

### 2.2 변환을 한 자리로 (`3e50415`)

`modelRef ↔ ModelId` 변환이 `simulationComponent` 안의 `Map`에 갇혀 있었다. 이를 `ModelRefBindingPort`(contracts)와 어댑터로 뽑고, 채우는 일은 `modelBindingComponent` 하나가 맡게 했다.

시뮬레이션은 `model/loaded`를 더 이상 듣지 않고 `scheduler/model-binding-changed`를 듣는다. 저마다 `model/loaded`를 들으면 누가 먼저 처리되는지가 Component 등록 순서에 달리고, 묶기 전에 다시 묶으면 방금 열린 모델을 놓친다.

### 2.3 화면 — 부재 걸기 (`88bddb7`)

`scheduleAssignmentEditing.ts`를 새로 두고 표 패널이 조립한다. 부재 수 칸을 누르면 그 Task의 연결 줄이 열린다. 누르는 자리를 따로 만들지 않은 이유는 부재 수가 이미 그 줄에 적혀 있고, 자세히 보려는 사람이 누르는 곳도 거기이기 때문이다.

- 열려 있지 않은 모델의 부재도 그린다. 무엇에 걸려 있는지는 모델과 무관한 일정의 사실이고, 잘못 걸린 것을 지울 수도 있어야 한다. `3D에서 보기`만 잠근다.
- 여러 모델의 부재를 한 번에 골랐으면 모델별로 편집을 나눠 한 명령으로 보낸다. 하나라도 실패하면 전부 반영되지 않는다.
- 선택이 바뀌면 연결 줄만 다시 그린다. 펼쳐 두지 않았을 때까지 다시 그리면 고치던 칸이 헛되이 닫힌다.

### 2.4 ADR-0008 — 바인딩 규칙 (`d8b3fc3`)

ADR-0005가 잠정으로 둔 파일명 대조를 닫았다. 구멍이 셋이었다. 이름이 바뀌면 연결이 끊기고, 같은 이름의 다른 모델이 조용히 붙고, 모델 교체를 감지할 수 없다.

`modelRef`를 fingerprint로 **바꾸지 않았다.** 사람은 fingerprint를 적을 수 없고, 모델을 고치면 값이 바뀌어 모든 연결이 끊긴다. 그래서 이름은 키로 남기고 fingerprint는 증거로 적는다.

- `schemaVersion: 3` — `models` 표(`modelRef`, 선택 `fingerprint`)를 더한다
- 묶는 순서: fingerprint 일치 → 이름 일치 → 미바인딩
- 이름으로 묶였는데 fingerprint가 다르면 교체다. 묶기는 하고 사실만 알린다
- CSV에 선택 파일 `models.csv`

### 2.5 재매칭 (`3fb6343`)

- `model/loaded`에 `fingerprint`를 실었다
- 처음 묶은 이름의 fingerprint는 적어 둔다. 모르던 값을 적는 것과 알던 값을 바꾸는 것은 다르고, ADR-0008이 금지한 것은 뒤쪽이다. 처음 한 번 적어 두지 않으면 교체를 감지할 근거가 생기지 않는다
- 교체를 승인하면 fingerprint를 갈아 끼우고 새 모델에 없는 부재 수를 알린다. **연결은 지우지 않는다.** 지우는 것도 사용자의 결정이며 되돌릴 수 없는 일을 대신 하지 않는다
- 같은 부재가 여러 Task에 걸려 있어도 사라진 부재는 하나로 센다

### 2.6 필터 (`3e193a2`)

미연결 Task는 표에서 거르고, 미연결 부재는 3D에서 고른다. 목록으로 세어 보여 주는 것보다 눈으로 보이는 편이 빠르다. 하나도 없으면 선택을 비운다. 앞서 고른 것이 남아 있으면 결과를 잘못 읽는다.

## 3. 구조 — 데이터가 흐르는 길

```text
뷰어에서 부재를 고른다
 └ selection/changed
    └ scheduleTablePanel(선택을 들고 있다)
       └ scheduleAssignmentEditing: refOf(modelId) → modelRef
          └ scheduler/edit-schedule { assign-products }
             └ schedulerComponent → applyScheduleEdits → parseSchedule
                └ scheduler/schedule-changed
                   ├ 표가 칩을 다시 그린다
                   └ modelBindingComponent가 다시 묶는다
                      └ scheduler/model-binding-changed
                         ├ 시뮬레이션이 할당을 다시 묶는다
                         └ 일정 독이 교체 알림을 그린다

모델을 연다
 └ model/loaded { modelId, displayName, fingerprint }
    └ modelBindingComponent
       ├ resolveModelBindings(일정, 열린 모델들)   ← ADR-0008의 규칙은 여기 하나
       ├ ModelRefBindingPort에 결과를 넣는다
       └ 처음 묶인 이름이면 fingerprint를 적어 둔다
```

경계 셋을 지켰다.

- 화면은 규칙을 판단하지 않는다. 편집을 만들어 보내고 도메인이 낸 이유를 옮겨 적는다
- 일정을 고치는 곳은 `schedulerComponent` 하나다 (마스터 계획 5.4절)
- `modelRef ↔ ModelId` 변환은 `ModelRefBindingPort` 하나를 지난다

## 4. 만들고 고친 파일

| 파일 | 성격 |
| --- | --- |
| `packages/domain/src/modelBinding.ts` | 신규 — 바인딩 규칙(ADR-0008) |
| `packages/domain/src/scheduleEdit.ts` | 수정 — 할당 편집 셋 |
| `packages/domain/src/schedule.ts` | 수정 — v3, `models`, 중복 연결 거부 |
| `packages/domain/src/scheduleCsv.ts` | 수정 — `models.csv` |
| `packages/domain/src/scheduleValidation.ts` | 수정 — 충돌 경고 둘 |
| `packages/contracts/src/modelBinding.ts` | 신규 — `ModelRefBindingPort` |
| `packages/contracts/src/schedule.ts` | 수정 — `ScheduleModel`, `schemaVersion: 3` |
| `apps/viewer-web/src/adapters/inMemoryModelRefBinding.ts` | 신규 — 묶음 보관 |
| `apps/viewer-web/src/adapters/spatialTreeProducts.ts` | 신규 — 모델의 부재 목록 |
| `apps/viewer-web/src/scheduler/modelBindingComponent.ts` | 신규 — 묶기·교체 승인·미연결 부재 |
| `apps/viewer-web/src/shell/scheduleAssignmentEditing.ts` | 신규 — 연결 줄 |
| `apps/viewer-web/src/shell/scheduleTablePanel.ts` | 수정 — 연결 줄 조립, 미연결 필터 |
| `apps/viewer-web/src/shell/schedulerPanel.ts` | 수정 — 교체 알림, 미연결 부재 |
| `apps/viewer-web/src/simulation/simulationComponent.ts` | 수정 — Port로 묶음을 읽는다 |
| `docs/adr/0008-model-ref-fingerprint-binding.md` | 신규 |
| `tests/e2e/assignment.spec.ts`, `tests/e2e/modelReplacement.spec.ts` | 신규 |

## 5. 쓴 언어와 도구

Phase 5와 같다. TypeScript 5.9.3(strict, `exactOptionalPropertyTypes`), 프레임워크 없는 DOM, Vitest 4 + jsdom, Playwright(chromium), Prettier, type-aware ESLint, pnpm 10 workspace.

## 6. 따른 방법론

- **TDD** — 도메인·컴포넌트·화면 모두 테스트를 먼저 썼다
- **Ports/Adapters** — 새 Port 하나(`ModelRefBindingPort`)와 어댑터 둘
- **Typed Event-Driven** — 새 Event 하나, 새 Command 둘을 계약에 선언 병합으로 등록
- **결정은 ADR** — 바인딩 규칙은 코드가 아니라 ADR-0008이 정본이다
- **조용한 처리 금지** — 중복 연결은 거부, 교체는 알림, 사라진 부재는 세어서 보고하되 지우지 않음

## 7. 겪은 것

**e2e가 도메인 규칙을 두 번 가르쳐 줬다.** Phase 5에서 요약 Task 들여쓰기와 선후행 순환이 그랬고, 이번에는 fixture의 슬래브가 두 Task(T001, T006)에 걸려 있어 한쪽만 끊으면 미연결이 되지 않았다. 테스트가 fixture를 잘못 읽고 있었다.

**병렬 e2e에서 시간이 모자랐다.** 미연결 부재를 세려면 공간 구조를 읽어야 하는데, 워커 일곱이 동시에 모델을 여는 동안 기본 5초 안에 끝나지 않았다. 판정 자체는 옳았으므로 그 단언에만 넉넉한 시간을 줬다.

**`git add -A`로 사용자 파일을 함께 담을 뻔했다.** 커밋을 되돌리고 대상 경로만 다시 담았다. 이후로는 경로를 지정해 담는다.

## 8. 검증 결과

| 게이트 | 결과 |
| --- | --- |
| `pnpm verify` (typecheck → lint → test → build) | 통과 |
| 단위·계약 테스트 | 629개 통과 |
| `pnpm test:e2e` | 99개 통과 |

일정 독의 screenshot 기준선은 갱신했다. 머리에 버튼 둘이 늘어난 의도한 변경이다 (AGENTS.md 4절).

## 9. 남긴 것

- 근무일 캘린더와 CPM — 여전히 미결정 (AGENTS.md 1.4절)
- 성능 목표 수치, Split/Group 전처리 책임, 검증 게이트 — 미결정
- 사라진 부재의 연결을 한 번에 정리하는 길은 두지 않았다. 지우는 것은 사용자의 결정이고, 지금은 칩의 `×`로 하나씩 끊는다
