import { beforeEach, describe, expect, it } from 'vitest';

import type { Schedule, ScheduleRepositoryPort } from '@bim4d/contracts';

import { createInMemoryScheduleRepository } from '../adapters/inMemoryScheduleRepository.js';
import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';

import { createSchedulerComponent } from './schedulerComponent.js';
import type { ScheduleTaskRow, ScheduleWarningRow } from './schedulerEvents.js';

const WALL = '0BnKdW4tq7SfUcM3vHxZgR';
const SLAB = '2YsHnV6bk3PgZdL9uCxWtM';

const source = {
  scheduleId: 'mock',
  name: '시험 일정',
  schemaVersion: 2,
  tasks: [
    { taskId: 'W1', name: '1층 골조' },
    {
      taskId: 'T001',
      name: '슬래브',
      parentTaskId: 'W1',
      start: '2026-03-02',
      finish: '2026-03-06',
    },
    { taskId: 'T002', name: '벽', parentTaskId: 'W1', start: '2026-03-09', finish: '2026-03-13' },
  ],
  dependencies: [{ predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 }],
  assignments: [
    { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
    { taskId: 'T002', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
  ],
};

let repository: ScheduleRepositoryPort;

const startComponent = async (context: TestContext) => {
  const component = createSchedulerComponent({ repository });
  await component.initialize(context);
  await component.start();
  return component;
};

interface Change {
  readonly tasks: readonly ScheduleTaskRow[];
  readonly warnings: readonly ScheduleWarningRow[];
  readonly start?: number;
  readonly finish?: number;
}

const listenChanges = (context: TestContext): Change[] => {
  const seen: Change[] = [];
  context.events.subscribe('scheduler/schedule-changed', ({ payload }) => {
    seen.push(payload);
  });
  return seen;
};

beforeEach(() => {
  repository = createInMemoryScheduleRepository();
});

describe('createSchedulerComponent — 적재', () => {
  it('보관소에 일정을 넣는다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('scheduler/load-schedule', { source });

    expect(result.ok && result.value.taskCount).toBe(3);
    const stored: Schedule | null = await repository.get();
    expect(stored?.scheduleId).toBe('mock');
  });

  it('계층 순서로 편 Task 줄을 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.commands.dispatch('scheduler/load-schedule', { source });

    expect(changes[0]?.tasks.map((row) => [row.taskId, row.depth, row.isSummary])).toEqual([
      ['W1', 0, true],
      ['T001', 1, false],
      ['T002', 1, false],
    ]);
  });

  it('요약 Task의 시간은 자손에서 계산해 싣는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.commands.dispatch('scheduler/load-schedule', { source });

    const summary = changes[0]?.tasks.find((row) => row.taskId === 'W1');
    expect(summary?.start).toBe(Date.UTC(2026, 2, 2));
    expect(summary?.finish).toBe(Date.UTC(2026, 2, 13));
  });

  it('Task마다 연결된 부재 수를 함께 싣는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.commands.dispatch('scheduler/load-schedule', { source });

    expect(changes[0]?.tasks.map((row) => row.assignedCount)).toEqual([0, 1, 1]);
  });

  it('타임라인 구간을 함께 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.commands.dispatch('scheduler/load-schedule', { source });

    expect(changes[0]?.start).toBe(Date.UTC(2026, 2, 2));
    expect(changes[0]?.finish).toBe(Date.UTC(2026, 2, 13));
  });

  it('경고를 함께 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.commands.dispatch('scheduler/load-schedule', {
      source: { ...source, assignments: [] },
    });

    expect(changes[0]?.warnings.map((warning) => warning.code)).toEqual([
      'schedule.warn.task-without-assignment',
      'schedule.warn.task-without-assignment',
    ]);
  });
});

describe('createSchedulerComponent — 실패', () => {
  it('읽을 수 없는 일정은 이유를 Event로 알리고 보관소를 건드리지 않는다', async () => {
    const context = createTestContext();
    const failures: { code: string }[] = [];
    await startComponent(context);
    context.events.subscribe('scheduler/load-failed', ({ payload }) => {
      failures.push({ code: payload.code });
    });

    const result = await context.commands.dispatch('scheduler/load-schedule', {
      source: { schemaVersion: 99 },
    });

    expect(result.ok).toBe(false);
    expect(failures[0]?.code).toBe('schedule.parse.unsupported-version');
    expect(await repository.get()).toBeNull();
  });

  it('앞서 실린 일정은 실패해도 그대로 남는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });

    await context.commands.dispatch('scheduler/load-schedule', { source: { schemaVersion: 99 } });

    expect((await repository.get())?.scheduleId).toBe('mock');
  });
});

describe('createSchedulerComponent — 정리', () => {
  it('dispose하면 보관소를 비운다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });

    await component.stop();
    await component.dispose();

    expect(await repository.get()).toBeNull();
  });
});
