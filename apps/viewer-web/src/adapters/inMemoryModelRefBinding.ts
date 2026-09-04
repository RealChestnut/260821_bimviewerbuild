import type { ModelId, ModelRefBindingPort } from '@bim4d/contracts';

/**
 * 쓰기까지 할 수 있는 `ModelRefBindingPort`.
 *
 * 읽는 쪽은 Port만 본다. 무엇과 무엇을 묶을지 정하는 일은 도메인(`resolveModelBindings`)이
 * 하고, 그 결과를 여기에 넣는 일은 Component 하나가 맡는다. 이 어댑터는 결과를 들고만 있다.
 */
export interface ModelRefBindingRegistry extends ModelRefBindingPort {
  /** 묶음 전체를 갈아 끼운다. 부분 갱신을 두지 않는다. 규칙이 전체를 보고 정해지기 때문이다. */
  replaceAll(bindings: ReadonlyMap<string, ModelId>): void;
  clear(): void;
}

/**
 * 메모리에 두는 modelRef 바인딩.
 *
 * 묶는 규칙의 정본은 ADR-0008이며 도메인에 있다. 여기서는 한 이름에 모델 하나, 한 모델에
 * 이름 하나라는 결과만 유지한다.
 */
export const createInMemoryModelRefBinding = (): ModelRefBindingRegistry => {
  let idByRef = new Map<string, ModelId>();
  let refById = new Map<ModelId, string>();

  return {
    idOf: (modelRef) => idByRef.get(modelRef) ?? null,

    refOf: (modelId) => refById.get(modelId) ?? null,

    entries: () => new Map(idByRef),

    replaceAll: (bindings) => {
      idByRef = new Map(bindings);
      refById = new Map([...bindings].map(([modelRef, modelId]) => [modelId, modelRef]));
    },

    clear: () => {
      idByRef = new Map();
      refById = new Map();
    },
  };
};
