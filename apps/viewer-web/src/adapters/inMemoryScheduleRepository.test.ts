import { describe, expect, it } from 'vitest';

import type { Schedule } from '@bim4d/contracts';

import { createInMemoryScheduleRepository } from './inMemoryScheduleRepository.js';

const schedule = (scheduleId: string): Schedule => ({
  scheduleId,
  name: '시험',
  schemaVersion: 3,
  models: [],
  tasks: [],
  dependencies: [],
  assignments: [],
});

describe('createInMemoryScheduleRepository', () => {
  it('비어 있으면 null을 준다', async () => {
    const repository = createInMemoryScheduleRepository();

    expect(await repository.get()).toBeNull();
  });

  it('저장한 일정을 그대로 돌려준다', async () => {
    const repository = createInMemoryScheduleRepository();
    await repository.save(schedule('s1'));

    expect((await repository.get())?.scheduleId).toBe('s1');
  });

  it('다시 저장하면 앞의 것을 대체한다', async () => {
    // 한 번에 한 일정만 열린다.
    const repository = createInMemoryScheduleRepository();
    await repository.save(schedule('s1'));
    await repository.save(schedule('s2'));

    expect((await repository.get())?.scheduleId).toBe('s2');
  });

  it('지우면 다시 비어 있다', async () => {
    const repository = createInMemoryScheduleRepository();
    await repository.save(schedule('s1'));

    await repository.clear();

    expect(await repository.get()).toBeNull();
  });
});
