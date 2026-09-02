import { describe, expect, it } from 'vitest';

import type { Schedule } from '@bim4d/contracts';

import { parseSchedule } from './schedule.js';
import { validateSchedule } from './scheduleValidation.js';

const WALL = '0BnKdW4tq7SfUcM3vHxZgR';
const SLAB = '2YsHnV6bk3PgZdL9uCxWtM';

const day = (value: number): number => Date.UTC(2026, 2, value);
const iso = (value: number): string => new Date(day(value)).toISOString().slice(0, 10);

/** JSON을 거쳐 만들어야 계층·선후행 구조 검증까지 지난 값이 된다. */
const build = (source: Record<string, unknown>): Schedule => {
  const parsed = parseSchedule({
    scheduleId: 's1',
    name: '시험',
    schemaVersion: 2,
    tasks: [],
    dependencies: [],
    assignments: [],
    ...source,
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

const codesOf = (schedule: Schedule): string[] =>
  validateSchedule(schedule).map((warning) => warning.code);

describe('validateSchedule — 경고', () => {
  it('시간이 정해지지 않은 Task를 알린다', () => {
    const schedule = build({ tasks: [{ taskId: 'T001', name: '미정' }] });

    expect(codesOf(schedule)).toContain('schedule.warn.task-without-time');
  });

  it('요약 Task는 시간 없음으로 알리지 않는다', () => {
    // 요약 Task는 원래 자기 시간을 갖지 않는다. 자손에서 계산되면 정상이다.
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '요약' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
      ],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
      ],
    });

    expect(codesOf(schedule)).toEqual([]);
  });

  it('할당이 하나도 없는 Task를 알린다', () => {
    const schedule = build({
      tasks: [{ taskId: 'T001', name: '작업', start: iso(2), finish: iso(6) }],
    });

    expect(codesOf(schedule)).toContain('schedule.warn.task-without-assignment');
  });
});

describe('validateSchedule — 선후행 위반', () => {
  const twoTasks = (
    first: { start: number; finish: number },
    second: { start: number; finish: number },
  ): Record<string, unknown> => ({
    tasks: [
      { taskId: 'A', name: 'A', start: iso(first.start), finish: iso(first.finish) },
      { taskId: 'B', name: 'B', start: iso(second.start), finish: iso(second.finish) },
    ],
    assignments: [
      { taskId: 'A', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
      { taskId: 'B', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
    ],
  });

  const withDependency = (tasks: Record<string, unknown>, type: string, lagDays = 0): Schedule =>
    build({
      ...tasks,
      dependencies: [{ predecessorId: 'A', successorId: 'B', type, lagDays }],
    });

  it('FINISH_START는 선행이 끝난 다음 날부터 시작해야 한다', () => {
    // 구간은 종료일을 포함하므로 선행의 finish 당일은 아직 작업 중이다 (ADR-0002).
    const overlapping = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 6, finish: 10 }),
      'FINISH_START',
    );
    const ok = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 7, finish: 10 }),
      'FINISH_START',
    );

    expect(codesOf(overlapping)).toContain('schedule.warn.dependency-violated');
    expect(codesOf(ok)).not.toContain('schedule.warn.dependency-violated');
  });

  it('FINISH_START의 지연을 셈에 넣는다', () => {
    const tasks = twoTasks({ start: 2, finish: 6 }, { start: 8, finish: 12 });

    expect(codesOf(withDependency(tasks, 'FINISH_START', 2))).toContain(
      'schedule.warn.dependency-violated',
    );
    expect(codesOf(withDependency(tasks, 'FINISH_START', 1))).not.toContain(
      'schedule.warn.dependency-violated',
    );
  });

  it('음수 지연(lead)이면 선행이 끝나기 전에 시작해도 된다', () => {
    const tasks = twoTasks({ start: 2, finish: 6 }, { start: 5, finish: 10 });

    expect(codesOf(withDependency(tasks, 'FINISH_START', -2))).not.toContain(
      'schedule.warn.dependency-violated',
    );
  });

  it('START_START는 같은 날 시작해도 된다', () => {
    const sameDay = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 2, finish: 10 }),
      'START_START',
    );
    const tooEarly = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 1, finish: 10 }),
      'START_START',
    );

    expect(codesOf(sameDay)).not.toContain('schedule.warn.dependency-violated');
    expect(codesOf(tooEarly)).toContain('schedule.warn.dependency-violated');
  });

  it('FINISH_FINISH는 같은 날 끝나도 된다', () => {
    const sameDay = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 3, finish: 6 }),
      'FINISH_FINISH',
    );
    const tooEarly = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 3, finish: 5 }),
      'FINISH_FINISH',
    );

    expect(codesOf(sameDay)).not.toContain('schedule.warn.dependency-violated');
    expect(codesOf(tooEarly)).toContain('schedule.warn.dependency-violated');
  });

  it('START_FINISH는 선행이 시작한 뒤에 끝나면 된다', () => {
    const ok = withDependency(
      twoTasks({ start: 5, finish: 9 }, { start: 2, finish: 5 }),
      'START_FINISH',
    );
    const tooEarly = withDependency(
      twoTasks({ start: 5, finish: 9 }, { start: 2, finish: 4 }),
      'START_FINISH',
    );

    expect(codesOf(ok)).not.toContain('schedule.warn.dependency-violated');
    expect(codesOf(tooEarly)).toContain('schedule.warn.dependency-violated');
  });

  it('시간이 없는 Task가 걸린 선후행은 위반으로 보지 않는다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'A', name: 'A' },
        { taskId: 'B', name: 'B', start: iso(2), finish: iso(6) },
      ],
      dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'FINISH_START', lagDays: 0 }],
    });

    // 시간 미정은 그 자체로 이미 경고다. 판정할 수 없는 것을 위반으로 부르지 않는다.
    expect(codesOf(schedule)).not.toContain('schedule.warn.dependency-violated');
  });

  it('요약 Task가 걸린 선후행은 계산된 시간으로 판정한다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '요약' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
        { taskId: 'B', name: 'B', start: iso(6), finish: iso(10) },
      ],
      dependencies: [{ predecessorId: 'W1', successorId: 'B', type: 'FINISH_START', lagDays: 0 }],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
        { taskId: 'B', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
      ],
    });

    expect(codesOf(schedule)).toContain('schedule.warn.dependency-violated');
  });

  it('경고에 어느 Task인지 담는다', () => {
    const schedule = withDependency(
      twoTasks({ start: 2, finish: 6 }, { start: 6, finish: 10 }),
      'FINISH_START',
    );

    const violated = validateSchedule(schedule).find(
      (warning) => warning.code === 'schedule.warn.dependency-violated',
    );
    expect(violated?.taskId).toBe('B');
  });
});

describe('validateSchedule — 부재 연결 충돌', () => {
  const twoTasks = (
    first: Record<string, unknown>,
    second: Record<string, unknown>,
  ): Record<string, unknown> => ({
    tasks: [
      { taskId: 'T001', name: '먼저', start: iso(2), finish: iso(6) },
      { taskId: 'T002', name: '나중', start: iso(9), finish: iso(13) },
    ],
    assignments: [
      { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, ...first },
      { taskId: 'T002', modelRef: 'a.ifc', productGlobalId: SLAB, ...second },
    ],
  });

  it('같은 부재를 두 Task가 시공하면 알린다', () => {
    const schedule = build(twoTasks({ operation: 'CONSTRUCT' }, { operation: 'CONSTRUCT' }));

    expect(codesOf(schedule)).toContain('schedule.warn.product-constructed-twice');
  });

  it('시공한 뒤 철거하는 것은 정상이다', () => {
    const schedule = build(twoTasks({ operation: 'CONSTRUCT' }, { operation: 'DEMOLISH' }));

    expect(codesOf(schedule)).not.toContain('schedule.warn.product-constructed-twice');
    expect(codesOf(schedule)).not.toContain('schedule.warn.demolish-before-construct');
  });

  it('시공보다 먼저 철거하면 알린다', () => {
    const schedule = build(twoTasks({ operation: 'DEMOLISH' }, { operation: 'CONSTRUCT' }));

    expect(codesOf(schedule)).toContain('schedule.warn.demolish-before-construct');
  });

  it('시공 없이 철거만 있는 부재는 알리지 않는다', () => {
    // 모델에 이미 서 있는 기존 구조물을 철거하는 것은 정상 입력이다.
    const schedule = build({
      tasks: [{ taskId: 'T001', name: '철거', start: iso(2), finish: iso(6) }],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'DEMOLISH' },
      ],
    });

    expect(codesOf(schedule)).not.toContain('schedule.warn.demolish-before-construct');
  });

  it('다른 모델의 같은 GlobalId는 충돌이 아니다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'T001', name: 'a', start: iso(2), finish: iso(6) },
        { taskId: 'T002', name: 'b', start: iso(9), finish: iso(13) },
      ],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
        { taskId: 'T002', modelRef: 'b.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
      ],
    });

    expect(codesOf(schedule)).not.toContain('schedule.warn.product-constructed-twice');
  });

  it('시간이 없으면 시공과 철거의 앞뒤를 판정하지 않는다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'T001', name: '철거' },
        { taskId: 'T002', name: '시공', start: iso(9), finish: iso(13) },
      ],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'DEMOLISH' },
        { taskId: 'T002', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
      ],
    });

    // 판정할 수 없는 것을 위반이라 부르지 않는다. 시간 미정은 그 자체로 이미 경고다.
    expect(codesOf(schedule)).not.toContain('schedule.warn.demolish-before-construct');
  });
});
