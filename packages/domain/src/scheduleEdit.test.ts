import { describe, expect, it } from 'vitest';

import type { Schedule } from '@bim4d/contracts';

import { parseSchedule } from './schedule.js';
import { applyScheduleEdit, applyScheduleEdits } from './scheduleEdit.js';
import type { ScheduleEdit } from './scheduleEdit.js';

const WALL = '0BnKdW4tq7SfUcM3vHxZgR';
const SLAB = '2YsHnV6bk3PgZdL9uCxWtM';

const base = (): Schedule => {
  const parsed = parseSchedule({
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
      { taskId: 'T003', name: '검사' },
    ],
    dependencies: [
      { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 },
    ],
    assignments: [
      { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
      { taskId: 'T002', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

const edited = (edit: ScheduleEdit, schedule: Schedule = base()): Schedule => {
  const result = applyScheduleEdit(schedule, edit);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const errorCode = (edit: ScheduleEdit, schedule: Schedule = base()): string | undefined => {
  const result = applyScheduleEdit(schedule, edit);
  return result.ok ? undefined : result.error.code;
};

const taskOf = (schedule: Schedule, taskId: string) =>
  schedule.tasks.find((task) => task.taskId === taskId);

describe('applyScheduleEdit — Task 추가', () => {
  it('최상위 Task를 더한다', () => {
    const schedule = edited({ kind: 'add-task', taskId: 'T004', name: '마감' });

    expect(taskOf(schedule, 'T004')?.name).toBe('마감');
    expect(taskOf(schedule, 'T004')?.parentTaskId).toBeUndefined();
  });

  it('시간을 함께 넣으면 epoch로 바꿔 담는다', () => {
    const schedule = edited({
      kind: 'add-task',
      taskId: 'T004',
      name: '마감',
      start: '2026-03-16',
      finish: '2026-03-20',
    });

    expect(taskOf(schedule, 'T004')?.start).toBe(Date.UTC(2026, 2, 16));
  });

  it('시간을 넣지 않으면 필드를 만들지 않는다', () => {
    const schedule = edited({ kind: 'add-task', taskId: 'T004', name: '마감' });

    expect(taskOf(schedule, 'T004')?.start).toBeUndefined();
    expect(taskOf(schedule, 'T004')?.finish).toBeUndefined();
  });

  it('이미 있는 taskId는 거부한다', () => {
    expect(errorCode({ kind: 'add-task', taskId: 'T001', name: '겹침' })).toBe(
      'schedule.edit.duplicate-task-id',
    );
  });

  it('없는 부모를 가리키면 parseSchedule이 거부한다', () => {
    expect(errorCode({ kind: 'add-task', taskId: 'T004', name: '마감', parentTaskId: 'W9' })).toBe(
      'schedule.parse.unknown-parent-task-id',
    );
  });

  it('날짜 형식이 틀리면 parseSchedule이 거부한다', () => {
    expect(errorCode({ kind: 'add-task', taskId: 'T004', name: '마감', start: '2026-02-30' })).toBe(
      'schedule.parse.invalid-date',
    );
  });

  it('시간을 가진 Task 아래에 자식을 넣으면 거부한다', () => {
    // T001은 시간이 있다. 자식이 생기면 요약 Task가 되어 시간을 가질 수 없다 (ADR-0006).
    expect(
      errorCode({ kind: 'add-task', taskId: 'T004', name: '마감', parentTaskId: 'T001' }),
    ).toBe('schedule.parse.summary-task-has-time');
  });
});

describe('applyScheduleEdit — Task 수정', () => {
  it('이름을 바꾼다', () => {
    const schedule = edited({ kind: 'update-task', taskId: 'T001', name: '슬래브 타설' });

    expect(taskOf(schedule, 'T001')?.name).toBe('슬래브 타설');
    expect(taskOf(schedule, 'T001')?.start).toBe(Date.UTC(2026, 2, 2));
  });

  it('생략한 필드는 그대로 둔다', () => {
    const schedule = edited({ kind: 'update-task', taskId: 'T001', start: '2026-03-03' });

    expect(taskOf(schedule, 'T001')?.name).toBe('슬래브');
    expect(taskOf(schedule, 'T001')?.finish).toBe(Date.UTC(2026, 2, 6));
  });

  it('null을 주면 값을 지운다', () => {
    const schedule = edited({
      kind: 'update-task',
      taskId: 'T001',
      start: null,
      finish: null,
    });

    expect(taskOf(schedule, 'T001')?.start).toBeUndefined();
    expect(taskOf(schedule, 'T001')?.finish).toBeUndefined();
  });

  it('parentTaskId를 바꿔 WBS에서 옮긴다', () => {
    const schedule = edited({ kind: 'update-task', taskId: 'T003', parentTaskId: 'W1' });

    expect(taskOf(schedule, 'T003')?.parentTaskId).toBe('W1');
  });

  it('parentTaskId를 null로 지워 최상위로 올린다', () => {
    const schedule = edited({ kind: 'update-task', taskId: 'T001', parentTaskId: null });

    expect(taskOf(schedule, 'T001')?.parentTaskId).toBeUndefined();
  });

  it('없는 Task는 거부한다', () => {
    expect(errorCode({ kind: 'update-task', taskId: 'T009', name: '없음' })).toBe(
      'schedule.edit.unknown-task-id',
    );
  });

  it('자기를 부모로 삼으면 parseSchedule이 순환으로 거부한다', () => {
    expect(errorCode({ kind: 'update-task', taskId: 'T003', parentTaskId: 'T003' })).toBe(
      'schedule.parse.wbs-cycle',
    );
  });

  it('완료가 시작보다 이르면 parseSchedule이 거부한다', () => {
    expect(errorCode({ kind: 'update-task', taskId: 'T001', finish: '2026-03-01' })).toBe(
      'schedule.parse.finish-before-start',
    );
  });

  it('요약 Task에 시간을 넣으면 거부한다', () => {
    expect(errorCode({ kind: 'update-task', taskId: 'W1', start: '2026-03-02' })).toBe(
      'schedule.parse.summary-task-has-time',
    );
  });
});

describe('applyScheduleEdit — Task 삭제', () => {
  it('Task와 그에 걸린 부재·선후행을 함께 지운다', () => {
    const schedule = edited({ kind: 'remove-task', taskId: 'T002' });

    expect(taskOf(schedule, 'T002')).toBeUndefined();
    expect(schedule.assignments.map((assignment) => assignment.taskId)).toEqual(['T001']);
    // T001->T002 선후행은 가리킬 곳이 없어지므로 함께 사라진다.
    expect(schedule.dependencies).toEqual([]);
  });

  it('자식이 있는 Task는 거부한다', () => {
    // 자식까지 함께 지우면 사용자가 보지 못한 것이 사라진다.
    expect(errorCode({ kind: 'remove-task', taskId: 'W1' })).toBe(
      'schedule.edit.task-has-children',
    );
  });

  it('마지막 자식을 지우면 부모가 평범한 Task가 된다', () => {
    const once = edited({ kind: 'remove-task', taskId: 'T001' });
    const twice = edited({ kind: 'remove-task', taskId: 'T002' }, once);

    expect(taskOf(twice, 'W1')?.start).toBeUndefined();
    expect(twice.tasks.map((task) => task.taskId)).toEqual(['W1', 'T003']);
  });

  it('없는 Task는 거부한다', () => {
    expect(errorCode({ kind: 'remove-task', taskId: 'T009' })).toBe(
      'schedule.edit.unknown-task-id',
    );
  });
});

describe('applyScheduleEdit — 선후행', () => {
  it('선후행을 더한다', () => {
    const schedule = edited({
      kind: 'add-dependency',
      predecessorId: 'T002',
      successorId: 'T003',
      type: 'FINISH_START',
      lagDays: 2,
    });

    expect(schedule.dependencies).toHaveLength(2);
    expect(schedule.dependencies[1]?.lagDays).toBe(2);
  });

  it('lagDays를 생략하면 0이다', () => {
    const schedule = edited({
      kind: 'add-dependency',
      predecessorId: 'T002',
      successorId: 'T003',
      type: 'START_START',
    });

    expect(schedule.dependencies[1]?.lagDays).toBe(0);
  });

  it('같은 선후행을 두 번 넣으면 parseSchedule이 거부한다', () => {
    expect(
      errorCode({
        kind: 'add-dependency',
        predecessorId: 'T001',
        successorId: 'T002',
        type: 'FINISH_START',
      }),
    ).toBe('schedule.parse.duplicate-dependency');
  });

  it('없는 Task를 가리키면 parseSchedule이 거부한다', () => {
    expect(
      errorCode({
        kind: 'add-dependency',
        predecessorId: 'T001',
        successorId: 'T009',
        type: 'FINISH_START',
      }),
    ).toBe('schedule.parse.unknown-dependency-task-id');
  });

  it('순환하는 선후행은 parseSchedule이 거부한다', () => {
    expect(
      errorCode({
        kind: 'add-dependency',
        predecessorId: 'T002',
        successorId: 'T001',
        type: 'FINISH_START',
      }),
    ).toBe('schedule.parse.dependency-cycle');
  });

  it('선후행을 지운다', () => {
    const schedule = edited({
      kind: 'remove-dependency',
      predecessorId: 'T001',
      successorId: 'T002',
      type: 'FINISH_START',
    });

    expect(schedule.dependencies).toEqual([]);
  });

  it('없는 선후행을 지우면 거부한다', () => {
    expect(
      errorCode({
        kind: 'remove-dependency',
        predecessorId: 'T002',
        successorId: 'T003',
        type: 'FINISH_START',
      }),
    ).toBe('schedule.edit.unknown-dependency');
  });
});

describe('applyScheduleEdits — 여럿을 한 번에', () => {
  it('차례로 적용한다', () => {
    const result = applyScheduleEdits(base(), [
      { kind: 'add-task', taskId: 'T004', name: '마감' },
      { kind: 'update-task', taskId: 'T004', parentTaskId: 'W1' },
      { kind: 'add-dependency', predecessorId: 'T002', successorId: 'T004', type: 'FINISH_START' },
    ]);
    if (!result.ok) throw new Error(result.error.message);

    expect(taskOf(result.value, 'T004')?.parentTaskId).toBe('W1');
    expect(result.value.dependencies).toHaveLength(2);
  });

  it('하나라도 실패하면 아무것도 바꾸지 않는다', () => {
    const original = base();

    const result = applyScheduleEdits(original, [
      { kind: 'add-task', taskId: 'T004', name: '마감' },
      { kind: 'add-task', taskId: 'T001', name: '겹침' },
    ]);

    expect(result.ok).toBe(false);
    expect(original.tasks).toHaveLength(4);
  });

  it('편집이 없으면 같은 일정을 돌려준다', () => {
    const original = base();

    const result = applyScheduleEdits(original, []);
    if (!result.ok) throw new Error(result.error.message);

    // 되돌리기가 무손실이어야 편집이 값을 잃지 않는다.
    expect(result.value).toEqual(original);
  });

  it('일정 이름을 바꾼다', () => {
    const schedule = edited({ kind: 'rename-schedule', name: '새 이름' });

    expect(schedule.name).toBe('새 이름');
    expect(schedule.tasks).toHaveLength(4);
  });
});
