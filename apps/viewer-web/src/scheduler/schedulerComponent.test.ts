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

  it('줄마다 상위 Task를 함께 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.commands.dispatch('scheduler/load-schedule', { source });

    // 화면이 WBS를 옮기려면 깊이만으로 부족하다. 형제와 조부모를 알아야 한다.
    expect(changes[0]?.tasks.map((row) => row.parentTaskId)).toEqual([undefined, 'W1', 'W1']);
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

const csvBundle = {
  schedule: 'scheduleId,name,schemaVersion\r\nmock,시험 일정,2\r\n',
  tasks: [
    'taskId,name,parentTaskId,start,finish',
    'W1,1층 골조,,,',
    'T001,슬래브,W1,2026-03-02,2026-03-06',
    'T002,벽,W1,2026-03-09,2026-03-13',
    '',
  ].join('\r\n'),
  dependencies: 'predecessorId,successorId,type,lagDays\r\nT001,T002,FINISH_START,0\r\n',
  assignments: [
    'taskId,modelRef,productGlobalId,operation',
    `T001,a.ifc,${SLAB},CONSTRUCT`,
    `T002,a.ifc,${WALL},CONSTRUCT`,
    '',
  ].join('\r\n'),
};

describe('createSchedulerComponent — CSV 적재', () => {
  it('CSV 묶음도 같은 일정으로 싣는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    const result = await context.commands.dispatch('scheduler/load-schedule-csv', {
      bundle: csvBundle,
    });

    expect(result.ok && result.value.taskCount).toBe(3);
    expect(changes[0]?.tasks.map((row) => row.taskId)).toEqual(['W1', 'T001', 'T002']);
  });

  it('JSON으로 넣든 CSV로 넣든 보관소의 일정이 같다', async () => {
    const context = createTestContext();
    await startComponent(context);

    await context.commands.dispatch('scheduler/load-schedule', { source });
    const fromJson = await repository.get();
    await context.commands.dispatch('scheduler/load-schedule-csv', { bundle: csvBundle });
    const fromCsv = await repository.get();

    expect(fromCsv).toEqual(fromJson);
  });

  it('표 모양이 잘못되면 schedule.csv 코드로 알리고 보관소를 건드리지 않는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const failures: { code: string }[] = [];
    context.events.subscribe('scheduler/load-failed', ({ payload }) => {
      failures.push(payload);
    });

    const result = await context.commands.dispatch('scheduler/load-schedule-csv', {
      bundle: { ...csvBundle, tasks: 'taskID,name,parentTaskId,start,finish\r\nW1,a,,,\r\n' },
    });

    expect(result.ok).toBe(false);
    expect(failures[0]?.code).toBe('schedule.csv.unknown-column');
    expect(await repository.get()).toBeNull();
  });

  it('의미가 잘못되면 schedule.parse 코드로 알린다', async () => {
    // CSV로 들어왔어도 의미 검증은 parseSchedule이 한다 (ADR-0007).
    const context = createTestContext();
    await startComponent(context);
    const failures: { code: string }[] = [];
    context.events.subscribe('scheduler/load-failed', ({ payload }) => {
      failures.push(payload);
    });

    await context.commands.dispatch('scheduler/load-schedule-csv', {
      bundle: {
        ...csvBundle,
        tasks: 'taskId,name,parentTaskId,start,finish\r\nT001,벽,,2026-02-30,2026-03-06\r\n',
      },
    });

    expect(failures[0]?.code).toBe('schedule.parse.invalid-date');
  });
});

describe('createSchedulerComponent — 내보내기', () => {
  it('CSV로 내보내면 파일 다섯을 준다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });

    const result = await context.commands.dispatch('scheduler/export-schedule', { format: 'csv' });

    expect(result.ok && result.value.files.map((file) => file.fileName)).toEqual([
      'schedule.csv',
      'tasks.csv',
      'models.csv',
      'dependencies.csv',
      'assignments.csv',
    ]);
  });

  it('JSON으로 내보내면 파일 하나를 준다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });

    const result = await context.commands.dispatch('scheduler/export-schedule', { format: 'json' });

    expect(result.ok && result.value.files.map((file) => file.fileName)).toEqual(['schedule.json']);
  });

  it('내보낸 CSV를 다시 읽으면 같은 일정이다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });
    const original = await repository.get();

    const exported = await context.commands.dispatch('scheduler/export-schedule', {
      format: 'csv',
    });
    if (!exported.ok) throw new Error(exported.error.message);
    const contentOf = (name: string): string =>
      exported.value.files.find((file) => file.fileName === name)?.content ?? '';

    await context.commands.dispatch('scheduler/load-schedule-csv', {
      bundle: {
        schedule: contentOf('schedule.csv'),
        tasks: contentOf('tasks.csv'),
        dependencies: contentOf('dependencies.csv'),
        assignments: contentOf('assignments.csv'),
      },
    });

    expect(await repository.get()).toEqual(original);
  });

  it('v1로 읽어 들였어도 v3로 내보낸다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', {
      // v1에는 계층도 선후행도 없다. 최상위 Task 하나만 담는다.
      source: {
        scheduleId: 'mock',
        name: '옛 일정',
        schemaVersion: 1,
        tasks: [{ taskId: 'T001', name: '슬래브', start: '2026-03-02', finish: '2026-03-06' }],
        assignments: [
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
        ],
      },
    });

    const result = await context.commands.dispatch('scheduler/export-schedule', { format: 'json' });
    if (!result.ok) throw new Error(result.error.message);

    expect(JSON.parse(result.value.files[0]?.content ?? '{}')).toMatchObject({ schemaVersion: 3 });
  });

  it('열려 있는 일정이 없으면 실패로 돌려준다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('scheduler/export-schedule', { format: 'csv' });

    expect(result.ok).toBe(false);
  });
});

describe('createSchedulerComponent — 편집', () => {
  it('Task를 더하고 새 목록을 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });
    const changes = listenChanges(context);

    const result = await context.commands.dispatch('scheduler/edit-schedule', {
      edits: [{ kind: 'add-task', taskId: 'T003', name: '마감', parentTaskId: 'W1' }],
    });

    expect(result.ok && result.value.taskCount).toBe(4);
    expect(changes[0]?.tasks.map((row) => row.taskId)).toEqual(['W1', 'T001', 'T002', 'T003']);
  });

  it('고친 일정을 보관소에 넣는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });

    await context.commands.dispatch('scheduler/edit-schedule', {
      edits: [{ kind: 'update-task', taskId: 'T001', name: '슬래브 타설' }],
    });

    const stored = await repository.get();
    expect(stored?.tasks.find((task) => task.taskId === 'T001')?.name).toBe('슬래브 타설');
  });

  it('편집이 규칙을 깨면 알리고 보관소를 그대로 둔다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });
    const failures: { code: string }[] = [];
    context.events.subscribe('scheduler/edit-failed', ({ payload }) => {
      failures.push(payload);
    });

    const result = await context.commands.dispatch('scheduler/edit-schedule', {
      edits: [{ kind: 'update-task', taskId: 'W1', start: '2026-03-02' }],
    });

    expect(result.ok).toBe(false);
    expect(failures[0]?.code).toBe('schedule.parse.summary-task-has-time');
    expect((await repository.get())?.tasks).toHaveLength(3);
  });

  it('여럿 중 하나가 실패하면 아무것도 반영하지 않는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });

    await context.commands.dispatch('scheduler/edit-schedule', {
      edits: [
        { kind: 'add-task', taskId: 'T003', name: '마감' },
        { kind: 'add-task', taskId: 'T001', name: '겹침' },
      ],
    });

    expect((await repository.get())?.tasks).toHaveLength(3);
  });

  it('열려 있는 일정이 없으면 실패로 돌려준다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('scheduler/edit-schedule', {
      edits: [{ kind: 'add-task', taskId: 'T003', name: '마감' }],
    });

    expect(result.ok).toBe(false);
  });

  it('고친 일정을 CSV로 내보내면 고친 내용이 나온다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('scheduler/load-schedule', { source });
    await context.commands.dispatch('scheduler/edit-schedule', {
      edits: [{ kind: 'update-task', taskId: 'T001', name: '슬래브 타설' }],
    });

    const exported = await context.commands.dispatch('scheduler/export-schedule', {
      format: 'csv',
    });
    if (!exported.ok) throw new Error(exported.error.message);

    expect(exported.value.files.find((file) => file.fileName === 'tasks.csv')?.content).toContain(
      '슬래브 타설',
    );
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
