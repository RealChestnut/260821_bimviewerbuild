/**
 * 일정의 `modelRef`를 열려 있는 모델에 묶는다.
 *
 * 규칙의 정본은 `docs/adr/0008-model-ref-fingerprint-binding.md`다. 묶는 순서는
 * fingerprint 일치 → 이름 일치 → 미바인딩이다. 이름으로 묶였는데 fingerprint가 다르면
 * 모델이 교체된 것이며, 이 모듈은 그 사실만 알리고 아무것도 고치지 않는다.
 *
 * 순수 함수만 담는다.
 */

import type { ModelFingerprint, ModelId, Schedule } from '@bim4d/contracts';

/** 지금 열려 있는 모델 하나. */
export interface OpenModel {
  readonly modelId: ModelId;
  readonly displayName: string;
  readonly fingerprint: ModelFingerprint;
}

/** 이름으로 묶였지만 파일 내용이 달라진 모델. */
export interface ReplacedModel {
  readonly modelRef: string;
  readonly modelId: ModelId;
  /** 일정이 알고 있던 fingerprint. */
  readonly expected: ModelFingerprint;
  /** 지금 열려 있는 파일의 fingerprint. */
  readonly actual: ModelFingerprint;
}

export interface ModelBindingResult {
  /** `modelRef`에서 열린 모델로. 묶이지 않은 이름은 없다. */
  readonly bindings: ReadonlyMap<string, ModelId>;
  readonly replaced: readonly ReplacedModel[];
}

/**
 * 일정이 쓰는 `modelRef` 전부.
 *
 * `models` 표에 적힌 것과 `assignments`가 가리키는 것의 합집합이다. 표에 없는 이름으로도
 * 부재를 걸 수 있고(손으로 만든 일정), 부재가 하나도 없는 모델도 표에 적힐 수 있다.
 */
export const scheduleModelRefs = (schedule: Schedule): readonly string[] => {
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const model of schedule.models) {
    if (seen.has(model.modelRef)) continue;
    seen.add(model.modelRef);
    refs.push(model.modelRef);
  }
  for (const assignment of schedule.assignments) {
    if (seen.has(assignment.modelRef)) continue;
    seen.add(assignment.modelRef);
    refs.push(assignment.modelRef);
  }
  return refs;
};

/**
 * 열린 모델과 일정의 이름을 묶는다.
 *
 * 한 이름에는 모델 하나, 한 모델은 이름 하나에만 묶는다. 둘이 겹치면 어느 쪽 부재인지
 * 알 수 없다. fingerprint로 묶은 짝을 먼저 확정한 뒤 남은 것을 이름으로 묶는다.
 */
export const resolveModelBindings = (
  schedule: Schedule,
  open: readonly OpenModel[],
): ModelBindingResult => {
  const refs = scheduleModelRefs(schedule);
  const knownFingerprints = new Map<string, ModelFingerprint>();
  for (const model of schedule.models) {
    if (model.fingerprint === undefined) continue;
    knownFingerprints.set(model.modelRef, model.fingerprint);
  }

  const bindings = new Map<string, ModelId>();
  const replaced: ReplacedModel[] = [];
  const takenModels = new Set<ModelId>();

  // 1. fingerprint 일치. 파일 이름이 달라졌어도 같은 파일이면 묶는다.
  for (const modelRef of refs) {
    const fingerprint = knownFingerprints.get(modelRef);
    if (fingerprint === undefined) continue;

    const matched = open.find(
      (model) => !takenModels.has(model.modelId) && model.fingerprint === fingerprint,
    );
    if (matched === undefined) continue;

    bindings.set(modelRef, matched.modelId);
    takenModels.add(matched.modelId);
  }

  // 2. 이름 일치. fingerprint를 모르거나 그 파일이 열려 있지 않은 경우다.
  for (const modelRef of refs) {
    if (bindings.has(modelRef)) continue;

    const matched = open.find(
      (model) => !takenModels.has(model.modelId) && model.displayName === modelRef,
    );
    if (matched === undefined) continue;

    bindings.set(modelRef, matched.modelId);
    takenModels.add(matched.modelId);

    const fingerprint = knownFingerprints.get(modelRef);
    // 이름은 같은데 내용이 다르다. 모델이 교체된 것이며 사용자가 알아야 한다.
    if (fingerprint !== undefined && fingerprint !== matched.fingerprint) {
      replaced.push({
        modelRef,
        modelId: matched.modelId,
        expected: fingerprint,
        actual: matched.fingerprint,
      });
    }
  }

  return { bindings, replaced };
};
