# test-fixtures

테스트에 쓰는 IFC와 일정 fixture를 담는다. 경로는 `src/index.ts`가 노출한다.

실프로젝트 모델은 저장소에 넣지 않는다. GitHub 파일 상한을 넘고, 원본은 로컬 보관이다. 저장소에 두는 것은 `minimal-*`, `three-*`처럼 직접 작성한 소형 파일뿐이다.

## 수령 검증 기록

새 fixture를 파이프라인에 넣기 전에 IFC 기준서 20절 체크리스트를 수행하고 결과를 여기에 남긴다 (`AGENTS.md` 2.8절).

### minimal-wall-ifc4.ifc

직접 작성. Project–Site–Building–Storey 각 1개와 IfcWall 1개.

| 검사 항목          | 결과                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Schema             | `FILE_SCHEMA(('IFC4'))`. 파일명이 아니라 Header로 확인                                                 |
| STEP Syntax        | web-ifc가 오류 없이 파싱하고 형상을 생성한다 (브라우저 테스트)                                         |
| Entity             | IfcWall 1개. Proxy 없음                                                                                |
| GlobalId           | 8개, 모두 22자 IFC base64, 중복 없음 (`fixtures.test.ts`)                                              |
| Geometry           | 압출 솔리드 1개. 4.0 × 0.2 × 3.0 m                                                                     |
| Placement          | 모든 Placement가 원점 기준. 회전 없음                                                                  |
| Coordinate System  | 로컬 좌표. 단위는 METRE / SQUARE_METRE / CUBIC_METRE                                                   |
| Spatial Hierarchy  | Project → Site → Building → Storey → Wall. IfcRelAggregates와 IfcRelContainedInSpatialStructure로 연결 |
| Assembly           | 없음                                                                                                   |
| Pset / Qto         | `Pset_WallCommon` (IsExternal, LoadBearing). Qto 없음                                                  |
| Custom Property    | 없음                                                                                                   |
| IfcTask / Schedule | 없음. 외부 Schedule을 쓰는 정상 경로다                                                                 |
| Task-Element 관계  | 없음                                                                                                   |
| Granularity        | 부재 1개. 공정 연결 시험에는 부족하다                                                                  |
| 웹 성능            | 삼각형 수십 개. 성능 시험용이 아니다                                                                   |

### three-elements-ifc4.ifc

직접 작성. 다중 선택·분류·속성 패널 시험용.

| 검사 항목          | 결과                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| Schema             | `FILE_SCHEMA(('IFC4'))`                                                              |
| STEP Syntax        | web-ifc가 오류 없이 파싱하고 세 부재를 모두 그린다                                   |
| Entity             | IfcWall 2개, IfcSlab 1개. PredefinedType은 STANDARD와 FLOOR                          |
| GlobalId           | 15개, 모두 22자 IFC base64, 중복 없음                                                |
| Geometry           | 압출 솔리드 3개. 벽 6.0 × 0.2 × 3.0 m, 슬래브 6.0 × 4.0 × 0.2 m                      |
| Placement          | Wall B는 (0, 4, 0)에 Y축 방향, 슬래브는 (0, 2, −0.2). 화면에서 서로 겹치지 않는다    |
| Coordinate System  | 로컬 좌표. 단위는 미터 계열                                                          |
| Spatial Hierarchy  | Project → Site → Building → Storey → 부재 3개                                        |
| Assembly           | 없음                                                                                 |
| Pset / Qto         | `Pset_WallCommon` (벽 2개), `Qto_WallBaseQuantities` (Wall A)                        |
| Custom Property    | `BIM4D_Custom` Pset의 `BIM4D_Zone`. 예약 접두어 `Pset_`을 쓰지 않는 자체 Pset 예시다 |
| IfcTask / Schedule | 없음                                                                                 |
| Task-Element 관계  | 없음                                                                                 |
| Granularity        | 부재 3개. 공정 단위 시험에는 여전히 부족하다                                         |
| 웹 성능            | 삼각형 수십 개                                                                       |

## 일정 fixture

일정 파일의 필드 스키마는 `docs/adr/0006-schedule-schema.md`가 정본이다.

### mock-three-elements.json

직접 작성. `three-elements-ifc4.ifc`의 부재 3개에 Task 6개를 건다.

| 항목           | 내용                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| 대상 모델      | `three-elements-ifc4.ifc` (`modelRef`가 이 파일명과 일치해야 바인딩된다)        |
| 타임라인       | 2026-03-02 ~ 2026-04-01                                                         |
| operation      | `CONSTRUCT` 3, `MODIFY` 2, `DEMOLISH` 1                                         |
| 연쇄           | 벽 B는 시공(T003) 후 철거(T005)된다. ADR-0002 다중 할당 규칙을 실제로 밟는다    |
| 시간 미정 Task | T006. 시뮬레이션에서 제외되는지 확인한다 (ADR-0002 경계 규칙 4)                 |
| GlobalId 대조  | `fixtures.test.ts`가 모든 `productGlobalId`가 대상 IFC에 실제로 있는지 검사한다 |

`TEMPORARY`는 담지 않았다. 부재가 셋뿐이라 가설 부재를 따로 둘 수 없고, 이미 다른 operation이 걸린 부재에 겹쳐 넣으면 fixture가 무엇을 시험하는지 흐려진다. `TEMPORARY`의 파생 규칙은 `packages/domain/src/simulation.test.ts`가 단위 테스트로 덮는다.

## 아직 확인하지 못한 것

두 fixture 모두 직접 작성한 파일이라, 실제 Exporter(Revit, Navisworks, Tekla 등)가 만드는 구조적 특징은 담고 있지 않다. 다음은 실모델을 파이프라인에 넣을 때 별도로 확인한다.

- Exporter별 Custom Property 이름 차이 (기준서 16절)
- 측량 좌표계 모델의 원점 오프셋 처리 (`AGENTS.md` 2.5절)
- 대형 모델의 Geometry 크기와 LOD 필요성
- buildingSMART Validation Service를 통한 공식 유효성 검사
