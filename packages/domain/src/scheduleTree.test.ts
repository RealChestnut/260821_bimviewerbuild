import { describe, expect, it } from 'vitest';

import type { Schedule, TaskId } from '@bim4d/contracts';

import { parseSchedule } from './schedule.js';
import { flattenTasks } from './scheduleTree.js';
import { effectiveTaskTimes } from './scheduleTree.js';

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

describe('effectiveTaskTimes', () => {
  it('말단 Task는 자기 시간을 쓴다', () => {
    const schedule = build({
      tasks: [{ taskId: 'T001', name: '작업', start: iso(2), finish: iso(6) }],
    });

    expect(effectiveTaskTimes(schedule).get('T001' as TaskId)).toEqual({
      start: day(2),
      finish: day(6),
    });
  });

  it('요약 Task는 자손의 최소 시작과 최대 완료를 쓴다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '요약' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(9), finish: iso(13) },
        { taskId: 'T002', name: 'b', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
      ],
    });

    expect(effectiveTaskTimes(schedule).get('W1' as TaskId)).toEqual({
      start: day(2),
      finish: day(13),
    });
  });

  it('여러 단계로 중첩돼도 맨 위까지 올라간다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'P', name: '프로젝트' },
        { taskId: 'W1', name: '층', parentTaskId: 'P' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
        { taskId: 'T002', name: 'b', parentTaskId: 'W1', start: iso(9), finish: iso(13) },
      ],
    });

    expect(effectiveTaskTimes(schedule).get('P' as TaskId)).toEqual({
      start: day(2),
      finish: day(13),
    });
  });

  it('시간이 정해지지 않은 자손은 계산에서 빼고 나머지로 잡는다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '요약' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
        { taskId: 'T002', name: '미정', parentTaskId: 'W1' },
      ],
    });

    expect(effectiveTaskTimes(schedule).get('W1' as TaskId)).toEqual({
      start: day(2),
      finish: day(6),
    });
  });

  it('시간이 하나도 없으면 그 Task는 목록에 없다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '요약' },
        { taskId: 'T001', name: '미정', parentTaskId: 'W1' },
      ],
    });

    const times = effectiveTaskTimes(schedule);
    expect(times.has('W1' as TaskId)).toBe(false);
    expect(times.has('T001' as TaskId)).toBe(false);
  });
});

describe('flattenTasks', () => {
  it('계층 순서로 펴고 깊이를 함께 준다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '층' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
        { taskId: 'T002', name: 'b', parentTaskId: 'W1', start: iso(9), finish: iso(13) },
        { taskId: 'T003', name: '최상위', start: iso(2), finish: iso(6) },
      ],
    });

    expect(flattenTasks(schedule).map((row) => [row.task.taskId, row.depth])).toEqual([
      ['W1', 0],
      ['T001', 1],
      ['T002', 1],
      ['T003', 0],
    ]);
  });

  it('형제 순서는 tasks 배열 순서를 따른다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '층' },
        { taskId: 'B', name: 'b', parentTaskId: 'W1', start: iso(9), finish: iso(13) },
        { taskId: 'A', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
      ],
    });

    expect(flattenTasks(schedule).map((row) => row.task.taskId)).toEqual(['W1', 'B', 'A']);
  });

  it('자식이 있으면 요약 Task로 표시한다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'W1', name: '층' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
      ],
    });

    expect(flattenTasks(schedule).map((row) => row.isSummary)).toEqual([true, false]);
  });

  it('여러 단계로 중첩돼도 순서를 지킨다', () => {
    const schedule = build({
      tasks: [
        { taskId: 'P', name: '프로젝트' },
        { taskId: 'W1', name: '층', parentTaskId: 'P' },
        { taskId: 'T001', name: 'a', parentTaskId: 'W1', start: iso(2), finish: iso(6) },
      ],
    });

    expect(flattenTasks(schedule).map((row) => [row.task.taskId, row.depth])).toEqual([
      ['P', 0],
      ['W1', 1],
      ['T001', 2],
    ]);
  });
});
