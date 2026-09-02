import type { ModelId, ModelRefBindingPort } from '@bim4d/contracts';

/**
 * 쓰기까지 할 수 있는 `ModelRefBindingPort`.
 *
 * 읽는 쪽은 Port만 본다. 채우는 일은 모델 적재 Event를 듣는 Component 하나가 맡는다.
 */
export interface ModelRefBindingRegistry extends ModelRefBindingPort {
  bind(modelId: ModelId, modelRef: string): void;
  unbind(modelId: ModelId): void;
  clear(): void;
}

/**
 * 메모리에 두는 modelRef 바인딩.
 *
 * 지금 규칙은 "일정에 적힌 이름 = 모델 파일명"이며 ADR-0005가 잠정으로 표시했다.
 * fingerprint 기반으로 바꿀 때 고칠 자리는 여기 하나다.
 *
 * 한 이름에는 모델 하나만 묶는다. 같은 파일을 다시 열면 새 `ModelId`가 붙는데, 두 모델이
 * 한 이름을 함께 쓰면 일정이 어느 쪽을 가리키는지 알 수 없다. 나중에 연 것이 이긴다.
 */
export const createInMemoryModelRefBinding = (): ModelRefBindingRegistry => {
  const idByRef = new Map<string, ModelId>();
  const refById = new Map<ModelId, string>();

  return {
    idOf: (modelRef) => idByRef.get(modelRef) ?? null,

    refOf: (modelId) => refById.get(modelId) ?? null,

    entries: () => new Map(idByRef),

    bind: (modelId, modelRef) => {
      const displaced = idByRef.get(modelRef);
      if (displaced !== undefined) refById.delete(displaced);

      // 한 모델이 두 이름을 갖지도 않는다. 옮겨 묶으면 옛 이름을 놓는다.
      const previous = refById.get(modelId);
      if (previous !== undefined) idByRef.delete(previous);

      idByRef.set(modelRef, modelId);
      refById.set(modelId, modelRef);
    },

    unbind: (modelId) => {
      const modelRef = refById.get(modelId);
      if (modelRef === undefined) return;
      refById.delete(modelId);
      idByRef.delete(modelRef);
    },

    clear: () => {
      idByRef.clear();
      refById.clear();
    },
  };
};
