import { describe, expect, it } from 'vitest';

import type { ModelId, ModelRecord } from '@bim4d/contracts';

import { createInMemoryModelRepository } from './inMemoryModelRepository.js';

const modelId = (raw: string): ModelId => raw as ModelId;

const record = (id: string, overrides: Partial<ModelRecord> = {}): ModelRecord => ({
  modelId: modelId(id),
  displayName: `${id}.ifc`,
  fingerprint: `sha256-${id}`,
  schema: 'IFC4',
  loadedAt: 1_000,
  ...overrides,
});

describe('createInMemoryModelRepository', () => {
  it('추가한 모델을 modelId로 조회한다', async () => {
    const repository = createInMemoryModelRepository();
    await repository.add(record('a'));

    expect(await repository.get(modelId('a'))).toEqual(record('a'));
  });

  it('없는 modelId는 undefined를 돌려준다', async () => {
    const repository = createInMemoryModelRepository();

    expect(await repository.get(modelId('missing'))).toBeUndefined();
  });

  it('같은 modelId를 다시 추가하면 거부한다', async () => {
    const repository = createInMemoryModelRepository();
    await repository.add(record('a'));

    await expect(repository.add(record('a'))).rejects.toThrow(/a/);
  });

  it('추가한 순서대로 목록을 돌려준다', async () => {
    const repository = createInMemoryModelRepository();
    await repository.add(record('a'));
    await repository.add(record('b'));

    expect((await repository.list()).map((item) => item.modelId)).toEqual(['a', 'b']);
  });

  it('목록을 바꿔도 보관소 내용은 변하지 않는다', async () => {
    const repository = createInMemoryModelRepository();
    await repository.add(record('a'));

    const list = await repository.list();
    (list as ModelRecord[]).pop();

    expect(await repository.list()).toHaveLength(1);
  });

  it('삭제하면 true, 없는 모델을 삭제하면 false를 돌려준다', async () => {
    const repository = createInMemoryModelRepository();
    await repository.add(record('a'));

    expect(await repository.remove(modelId('a'))).toBe(true);
    expect(await repository.remove(modelId('a'))).toBe(false);
    expect(await repository.get(modelId('a'))).toBeUndefined();
  });

  it('clear는 모든 모델을 비운다', async () => {
    const repository = createInMemoryModelRepository();
    await repository.add(record('a'));
    await repository.add(record('b'));

    await repository.clear();

    expect(await repository.list()).toEqual([]);
  });

  it('Schema를 판별하지 못한 모델도 보관한다', async () => {
    const repository = createInMemoryModelRepository();
    const unknownSchema: ModelRecord = {
      modelId: modelId('c'),
      displayName: 'c.ifc',
      fingerprint: 'sha256-c',
      loadedAt: 2_000,
    };
    await repository.add(unknownSchema);

    expect(await repository.get(modelId('c'))).toEqual(unknownSchema);
  });
});
