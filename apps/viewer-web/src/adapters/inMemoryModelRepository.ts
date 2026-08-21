import type { ModelId, ModelRecord, ModelRepositoryPort } from '@bim4d/contracts';

/**
 * 메모리 기반 ModelRepository.
 *
 * Project 저장이 붙는 단계에서 SQLite Adapter로 교체한다. 그때 Port 계약은 그대로 둔다.
 * 삽입 순서를 유지해 UI가 적재 순서대로 모델을 보여 줄 수 있게 한다(Map의 순서 보장).
 */
export const createInMemoryModelRepository = (): ModelRepositoryPort => {
  const records = new Map<ModelId, ModelRecord>();

  return {
    add: (record) => {
      if (records.has(record.modelId)) {
        // 같은 파일을 다시 열면 호출부가 먼저 remove하거나 새 modelId를 만든다.
        return Promise.reject(new Error(`이미 등록된 modelId다: ${record.modelId}`));
      }
      records.set(record.modelId, record);
      return Promise.resolve();
    },

    get: (modelId) => Promise.resolve(records.get(modelId)),

    // 호출부가 목록을 바꿔도 보관소가 영향받지 않도록 복사본을 준다.
    list: () => Promise.resolve([...records.values()]),

    remove: (modelId) => Promise.resolve(records.delete(modelId)),

    clear: () => {
      records.clear();
      return Promise.resolve();
    },
  };
};
