import { describe, expect, it } from 'vitest';

import type { TaskId } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

import { indentEdit, outdentEdit } from './scheduleRowEditing.js';

const row = (
  taskId: string,
  depth: number,
  parentTaskId?: string,
  isSummary = false,
): ScheduleTaskRow => ({
  taskId: taskId as TaskId,
  name: taskId,
  depth,
  isSummary,
  assignedCount: 0,
  ...(parentTaskId === undefined ? {} : { parentTaskId: parentTaskId as TaskId }),
});

/**
 * W1
 *  ├ T001
 *  └ T002
 * W2
 *  └ T003
 */
const rows: readonly ScheduleTaskRow[] = [
  row('W1', 0, undefined, true),
  row('T001', 1, 'W1'),
  row('T002', 1, 'W1'),
  row('W2', 0, undefined, true),
  row('T003', 1, 'W2'),
];

const at = (taskId: string): ScheduleTaskRow => {
  const found = rows.find((candidate) => candidate.taskId === taskId);
  if (found === undefined) throw new Error(`줄 없음: ${taskId}`);
  return found;
};

describe('indentEdit', () => {
  it('바로 위 형제를 부모로 삼는다', () => {
    expect(indentEdit(rows, at('T002'))).toEqual({
      kind: 'update-task',
      taskId: 'T002',
      parentTaskId: 'T001',
    });
  });

  it('최상위 줄도 앞의 최상위 줄 밑으로 들어간다', () => {
    expect(indentEdit(rows, at('W2'))).toEqual({
      kind: 'update-task',
      taskId: 'W2',
      parentTaskId: 'W1',
    });
  });

  it('형제 중 첫 줄은 들여쓸 수 없다', () => {
    // 부모로 삼을 앞 형제가 없다. 깊이만 늘리면 계층이 아니라 여백이 된다.
    expect(indentEdit(rows, at('T001'))).toBeNull();
    expect(indentEdit(rows, at('W1'))).toBeNull();
  });
});

describe('outdentEdit', () => {
  it('부모의 부모로 올린다', () => {
    const deep: readonly ScheduleTaskRow[] = [
      row('W1', 0, undefined, true),
      row('T001', 1, 'W1', true),
      row('T002', 2, 'T001'),
    ];

    expect(outdentEdit(deep, deep[2]!)).toEqual({
      kind: 'update-task',
      taskId: 'T002',
      parentTaskId: 'W1',
    });
  });

  it('부모가 최상위면 자기도 최상위가 된다', () => {
    // 생략이 아니라 null이어야 지운다는 뜻이 된다 (applyScheduleEdit의 규칙).
    expect(outdentEdit(rows, at('T001'))).toEqual({
      kind: 'update-task',
      taskId: 'T001',
      parentTaskId: null,
    });
  });

  it('이미 최상위인 줄은 내어쓸 수 없다', () => {
    expect(outdentEdit(rows, at('W1'))).toBeNull();
  });
});
