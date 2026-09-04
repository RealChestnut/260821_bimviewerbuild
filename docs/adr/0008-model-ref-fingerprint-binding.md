# ADR-0008: 일정의 modelRef를 fingerprint로 묶고 이름은 되돌아갈 자리로 남긴다

- 상태: 채택
- 날짜: 2026-09-02
- 관련 문서: `docs/DEVELOPMENT_MASTER_PLAN.md` 6.2절, 9절(Phase 6) · `docs/IFC_통합_정리_2026-08-20.md` 18, 19절 · ADR-0005 · ADR-0006 · ADR-0007 · `AGENTS.md` 1.4, 2.1, 2.2절
- 해소 대상: `AGENTS.md` 1.4절 미결정 항목 "ADR-0005의 `modelRef` 바인딩(파일명 대조)은 잠정이다. Phase 6에서 fingerprint 기반으로 교체한다"

## 맥락

ADR-0005는 `assignments[].modelRef`를 "모델 파일명. 적재된 모델의 `displayName`과 맞춰 `ModelId`로 바인딩한다"로 정하면서 이를 잠정이라고 적었다. 파일명 대조에는 세 가지 구멍이 있다.

1. **이름이 바뀌면 연결이 끊긴다.** `벽체.ifc`를 `벽체_rev2.ifc`로 저장하면 일정의 연결이 전부 미바인딩이 된다. 부재는 그대로인데 이름만 달라진 경우다.
2. **같은 이름의 다른 모델이 붙는다.** 두 프로젝트가 모두 `model.ifc`를 쓰면 엉뚱한 모델의 부재에 공정이 붙고, 화면은 정상으로 보인다. `AGENTS.md`가 금지하는 조용한 처리다.
3. **모델이 바뀐 것을 알 방법이 없다.** 설계 변경으로 부재가 지워진 새 모델을 열어도 이름이 같으면 아무 일도 없었던 것처럼 붙는다. Phase 6의 완료 조건인 "모델 교체 및 GlobalId 재매칭"은 바로 이 변화를 감지하는 일이다.

재료는 이미 있다. `modelLoadingComponent`가 적재할 때 파일 바이트의 SHA-256을 계산해 `ModelDescriptor.fingerprint`에 담는다 (`AGENTS.md` 2.1절 "모델 버전 식별에는 파일 fingerprint를 저장한다").

두 가지 제약이 설계를 좁힌다.

1. **사람은 fingerprint를 적을 수 없다.** 외부 공정표에서 오는 CSV에는 파일명이나 논리 이름이 적힌다. fingerprint를 필수로 만들면 손으로 만든 일정을 받을 수 없다.
2. **모델을 고치면 fingerprint가 바뀐다.** fingerprint만으로 묶으면 설계 변경 한 번에 모든 연결이 끊긴다. 연결을 지키는 것이 이 제품의 목적이므로 이는 허용할 수 없다.

## 결정

### 이름은 키, fingerprint는 증거

`assignments[].modelRef`는 그대로 둔다. 사람이 읽고 쓰는 논리 이름이며 연결의 키다. 여기에 일정이 아는 모델을 적는 표를 더한다.

```json
{
  "scheduleId": "...",
  "name": "...",
  "schemaVersion": 3,
  "models": [
    { "modelRef": "three-elements-ifc4.ifc", "fingerprint": "9f2b…(64자 hex)" },
    { "modelRef": "설비.ifc" }
  ],
  "tasks": ["…v2와 동일…"],
  "dependencies": ["…v2와 동일…"],
  "assignments": ["…v2와 동일…"]
}
```

| 필드 | 규칙 |
| --- | --- |
| `models[].modelRef` | 일정 안에서 유일하다. 중복은 거부한다 |
| `models[].fingerprint` | 소문자 hex 64자(SHA-256). **생략 가능**하다. 손으로 만든 일정에는 없다 |
| `assignments[].modelRef` | `models`에 없어도 된다. 있으면 그 모델의 fingerprint가 적용된다 |

`models`는 `assignments`에서 자동으로 유도할 수 있는 이름 목록이 아니다. 담는 것은 **fingerprint라는 추가 사실**이다. 부재가 하나도 걸리지 않은 모델도 적힐 수 있다.

### 바인딩 규칙

열려 있는 모델과 일정의 `modelRef`를 묶는 순서는 셋이다.

1. **fingerprint 일치.** 일정이 그 `modelRef`의 fingerprint를 알고, 같은 fingerprint의 모델이 열려 있으면 묶는다. 파일 이름이 달라졌어도 묶인다.
2. **이름 일치.** fingerprint를 모르거나 일치하는 모델이 없으면 `displayName`이 같은 모델과 묶는다.
3. **묶지 않는다.** 둘 다 없으면 미바인딩이다. 조용히 아무 모델에나 붙이지 않는다.

한 `modelRef`에는 모델 하나만 묶는다. 한 모델도 `modelRef` 하나에만 묶인다. 둘이 겹치면 어느 쪽 부재인지 알 수 없다.

### 교체 감지

2번(이름 일치)으로 묶였는데 일정이 아는 fingerprint와 열린 모델의 fingerprint가 **다르면** 모델이 교체된 것이다. 이때 두 가지를 한다.

- 경고 `schedule.warn.model-replaced`를 낸다. 사용자가 바뀐 사실을 알아야 한다.
- 그 모델에 걸린 부재 중 새 모델에 **없는 GlobalId**를 경고 `schedule.warn.product-missing`으로 알린다. 연결을 자동으로 지우지 않는다. 지우는 것은 사용자의 결정이며, 되돌릴 수 없는 일을 조용히 하지 않는다.

fingerprint 갱신도 자동으로 하지 않는다. 사용자가 "이 모델로 교체한다"를 고르면 그때 `models[].fingerprint`를 새 값으로 쓴다. 자동 갱신은 잘못 연 모델을 정본으로 굳혀 버린다.

### CSV

ADR-0007의 네 파일에 선택 파일 하나를 더한다.

| 파일 | 열 | 필수 |
| --- | --- | --- |
| `models.csv` | `modelRef,fingerprint` | 선택. 없으면 아는 fingerprint가 없다 |

`dependencies.csv`와 같은 자리다. 내보내기는 항상 쓰고, 없어도 읽는다. 모르는 열은 거부한다.

### 스키마 버전

`schemaVersion: 3`이다. v1과 v2는 읽어서 v3로 승격하며 `models`는 빈 배열이 된다. 내보내기는 항상 v3다. 소비자는 버전을 분기하지 않는다 (ADR-0006과 같은 방식).

## 대안

| 대안 | 장점 | 단점 | 채택하지 않은 이유 |
| ---- | ---- | ---- | ------------------ |
| 파일명 대조 유지 | 바꿀 것이 없다 | 이름이 바뀌면 끊기고, 같은 이름의 다른 모델이 붙고, 교체를 감지할 수 없다 | Phase 6의 완료 조건 "모델 교체 및 GlobalId 재매칭"을 만족할 수 없다 |
| `modelRef`를 fingerprint로 교체 | 키가 하나다. 잘못 붙을 수 없다 | 손으로 만든 일정을 받을 수 없고, 모델을 한 번 고치면 모든 연결이 끊긴다 | 두 제약 모두 위반한다. 연결을 지키는 것이 목적인데 그 반대가 된다 |
| `assignments`마다 fingerprint를 적는다 | 표를 따로 두지 않는다 | 같은 값이 행마다 반복되어 진실이 여럿이 된다. 교체 시 모든 행을 고쳐야 한다 | ADR-0007이 머리말을 `schedule.csv`로 가른 것과 같은 이유다 |
| 자동으로 fingerprint를 갱신한다 | 사용자가 할 일이 없다 | 잘못 연 모델이 조용히 정본이 된다 | `AGENTS.md` 2.1절의 원본 보호 정신에 어긋난다. 되돌릴 수 없는 일을 자동으로 하지 않는다 |
| 연결이 끊긴 부재를 자동으로 지운다 | 일정이 깨끗해진다 | 사용자가 무엇을 잃었는지 모른다 | 조용한 처리 금지. 경고로 알리고 결정은 사용자에게 남긴다 |

## 결과

**가능해지는 것**

- 파일 이름을 바꿔도 연결이 유지된다
- 같은 이름의 다른 모델을 열면 교체로 감지된다
- 설계 변경으로 사라진 부재를 GlobalId 단위로 짚어 알릴 수 있다

**포기하는 것**

- 일정 파일이 조금 커진다. 모델 수만큼 행이 는다
- fingerprint를 모르는 일정(v1·v2에서 승격했거나 손으로 만든 것)은 여전히 이름 대조로만 묶인다. 첫 연결 때 fingerprint를 적어 넣기 전까지는 이전과 같다

**영향 받는 경로와 계약**

- `packages/domain` — `parseSchedule`(v3, `models` 배열), `serializeScheduleCsv`/`parseScheduleCsv`(`models.csv`), `bindSchedule`, `validateSchedule`(경고 둘)
- `packages/contracts` — `Schedule.models`, `ModelRefBindingPort`(구현이 fingerprint를 본다)
- `apps/viewer-web` — `modelBindingComponent`가 일정의 `models`와 열린 모델의 fingerprint를 함께 보고 묶는다
- 화면 — 교체 경고와 사라진 부재 경고를 일정 독의 경고 줄에 그린다

`ModelRefBindingPort`의 인터페이스(`idOf` / `refOf` / `entries`)는 바뀌지 않는다. 부재를 걸고 3D에서 찾는 화면은 이 결정으로 고치지 않는다.

## 후속 작업

- [x] `AGENTS.md` 1.4절 갱신 (미결정 목록에서 해소 표로 이동)
- [x] ADR-0005의 `modelRef` 바인딩 절에 이 ADR로 대체됐음을 적는다
- [x] ADR-0007의 파일 목록에 `models.csv`를 더한다
