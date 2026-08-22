# ADR-0005: Phase 3 잔여 항목을 소비자 시점으로 재배치한다

- 상태: 채택
- 날짜: 2026-08-22
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 4.2절, 6.2절, 9절(Phase 3·4·5·6) · `AGENTS.md` 4절

## 맥락

마스터 계획 9절은 Phase 3(Viewer 업무 기능)에 일곱 항목을 나열하고 다음 Phase로 넘어간다. 2026-08-22 기준 두 항목이 끝났다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| 다중 선택 | 완료 | `apps/viewer-web/src/viewer/selection/` |
| 숨김·표시·격리 | 완료 | `apps/viewer-web/src/viewer/visibility/` |
| IFC 공간 구조와 분류 | 미착수 | — |
| 속성 패널 | 미착수 | — |
| 단면 | 미착수 | — |
| 카메라 및 Viewpoint | 부분 | Adapter의 초기 시점과 `fitToLoadedModels`만 있다 |
| 복수 모델 연합 | 엔진만 | Adapter는 다중 모델을 다루나 화면이 단일 모델을 전제한다 |

Phase 3을 통째로 끝낸 뒤 Phase 4로 가는 순서에는 두 가지 문제가 있다.

첫째, **잔여 다섯 항목 중 Phase 4가 필요로 하는 것은 하나도 없다.** ADR-0002 경계 규칙 1이 "미연결 Element는 모든 `t`에서 `PRESENT`"로 정해져 있어, 시뮬레이션은 Assignment에 적힌 부재만 건드리면 된다. 모델 전체를 열거할 필요가 없으므로 이미 있는 Visibility와 Highlight Port로 충분하다.

둘째, **잔여 항목마다 첫 소비자가 다른 Phase에 있다.** 소비자 없이 먼저 만들면 계약을 추측으로 정하게 된다.

- 복수 모델 연합 — Phase 4의 일정 fixture가 Assignment를 어떤 모델에 붙일지 정해야 하고, Phase 6의 "모델 교체 및 GlobalId 재매칭"이 이를 전제한다.
- IFC 공간 구조와 분류 — 첫 소비자는 Phase 6의 "미연결 객체와 미연결 Task 필터"다. 현재 Adapter는 `pickAt`, `highlight`, `guidsToModelIdMap` 뿐이라 GlobalId를 이미 아는 부재만 다룰 수 있고, 모델에 무엇이 들어 있는지 열거하지 못한다. 이 열거·조회 Port가 분류의 실체다.
- 속성 패널 — 분류와 같은 Port 위에 서지만 Phase 6이 요구하지는 않는다.
- 카메라 및 Viewpoint — Viewpoint 저장·복원의 소비자는 마스터 계획 6.2절 Project 데이터의 `ViewerState`다. 저장 경로가 생기기 전에 만들면 절반만 검증된다.
- 단면 — 어느 Phase와도 의존이 없다.

또한 Phase 1·2·4에는 "완료 기준" 절이 있으나 **Phase 3에는 없다.** 항목을 시간축에 분산하면 무엇으로 Phase 3을 닫는지가 더 불분명해진다.

## 결정

Phase 3 잔여 항목을 각 항목의 첫 소비자 직전으로 옮긴다. 항목을 삭제하거나 범위를 줄이지 않는다. Phase 3은 마지막 항목이 끝날 때 닫힌다.

작업 순서:

| 순서 | 작업 | 소속 |
| --- | --- | --- |
| 1 | 복수 모델 연합 | Phase 3 |
| 2 | Mock 4D Simulation | Phase 4 |
| 3 | 단면, 카메라 조작(표준 시점·전체 맞춤) | Phase 3 |
| 4 | Scheduler, Viewpoint 저장·복원 | Phase 5 + Phase 3 |
| 5 | IFC 공간 구조와 분류, 속성 패널 | Phase 3 |
| 6 | IFC–Task Matching | Phase 6 |

카메라 항목은 둘로 나눈다. **조작**(표준 시점, 전체 맞춤)은 저장과 무관하므로 3순위에서 단면과 함께 한다. **Viewpoint 저장·복원**은 `ViewerState`를 저장할 곳이 생기는 4순위로 미룬다.

### Phase 3 완료 기준

마스터 계획이 비워 둔 자리를 다음으로 채운다.

- 두 개 이상의 모델을 동시에 열고, 모델별로 해제할 수 있다. 한 모델을 해제해도 나머지 모델의 선택·가시성이 유지된다.
- 부재의 영구 키(`modelId + GlobalId`)가 모델 경계를 지킨다. 같은 GlobalId가 두 모델에 있어도 한쪽만 대상이 된다.
- 단면이 켜진 상태에서 선택과 숨김이 정상 동작한다.
- 저장한 Viewpoint를 복원하면 카메라 위치·시선이 저장 시점과 같다.
- 공간 계층 트리가 Project–Site–Building–Storey–부재로 나오고, 트리에서 고른 노드가 Viewer 선택과 연동된다.
- 속성 패널이 선택 부재의 원본 Pset과 Qto를 빠짐없이 보여 준다 (`AGENTS.md` 2.4절).

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| Phase 3을 전부 끝내고 Phase 4로 | 계획 순서 그대로. 판단이 필요 없다 | 소비자 없는 계약을 다섯 개 먼저 확정하게 된다. 4D 동작 확인이 가장 늦어진다 | 분류 Port를 Phase 6 요구사항 없이 설계하면 재작업 위험이 크다 |
| Phase 4를 먼저 하고 Phase 3 잔여를 뒤로 | 4D를 가장 빨리 본다 | 일정 fixture를 단일 모델 전제로 굳히게 되고, 복수 모델 지원 시 Assignment 바인딩을 다시 설계해야 한다 | 재작업 비용이 복수 모델 연합 작업량보다 크다 |
| 본 결정(소비자 시점 재배치) | 각 계약을 첫 소비자와 함께 정한다. 복수 모델만 선행해 Phase 4의 스키마 결정을 정확하게 만든다 | 마스터 계획 9절과 실제 순서가 달라지므로 문서 동기화가 필요하다 | — |

## 결과

- Phase 4의 일정 fixture는 복수 모델을 전제로 Assignment를 정의한다. 단일 모델 가정을 코드에 넣지 않는다.
- Phase 3은 Phase 6 착수 직전까지 열린 상태로 남는다. 위 완료 기준이 판정 근거다.
- 마스터 계획 9절 Phase 3에 재배치와 완료 기준을 반영한다. 계획 자체를 바꾸는 변경이므로 `AGENTS.md` 4절에 따라 확인을 받았다 (2026-08-22).
- 분류 작업 착수 전에 test-fixture 보강이 필요하다. 현재 `three-elements-ifc4.ifc`는 층이 하나라 공간 계층 트리를 시험할 깊이가 없다.

## 후속 작업

- [x] 마스터 계획 9절 Phase 3 갱신
- [ ] 분류 착수 전 다층 IFC fixture 추가 (IFC 기준서 20절 체크리스트 수행)
- [ ] Phase 4 착수 시 일정 / Task–Element Mapping 필드 스키마를 별도 ADR로 확정 (`AGENTS.md` 1.4절 미결정 항목)
