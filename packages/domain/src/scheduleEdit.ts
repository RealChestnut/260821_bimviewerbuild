/**
 * 일정을 고친다.
 *
 * 편집은 일정을 v2 JSON 모양으로 되돌려 그 값을 고친 뒤 `parseSchedule`에 다시 넘긴다.
 * 그래서 손으로 만든 파일이든 화면에서 고친 결과든 같은 규칙으로 거부되고 같은 오류
 * 코드를 낸다. 해석 지점을 하나로 두려는 것이다 (ADR-0005 결과절).
 *
 * 편집 자신이 보는 것은 "고칠 대상이 있는가"뿐이다. 중복 taskId, 없는 참조, WBS 순환,
 * 요약 Task 규칙, 날짜 형식, `finish < start`는 모두 `parseSchedule`이 본다.
 *
 * 순수 함수만 담는다. 보관은 Adapter의 몫이다.
 */

import type { DependencyType, Schedule } from '@bim4d/contracts';

import type { Parsed } from './productKey.js';
import { parseSchedule, toScheduleRecord } from './schedule.js';
import type { ScheduleRecord } from './schedule.js';

/**
 * 편집 하나.
 *
 * 날짜는 파일과 같은 `YYYY-MM-DD` 문자열이다. `update-task`에서 `null`은 "값을 지운다",
 * 생략은 "그대로 둔다"이다. 둘을 하나로 합치면 시간을 지울 방법이 사라진다.
 */
export type ScheduleEdit =
  | {
      readonly kind: 'add-task';
      readonly taskId: string;
      readonly name: string;
      readonly parentTaskId?: string;
      readonly start?: string;
      readonly finish?: string;
    }
  | {
      readonly kind: 'update-task';
      readonly taskId: string;
      readonly name?: string;
      readonly parentTaskId?: string | null;
      readonly start?: string | null;
      readonly finish?: string | null;
    }
  | { readonly kind: 'remove-task'; readonly taskId: string }
  | {
      readonly kind: 'add-dependency';
      readonly predecessorId: string;
      readonly successorId: string;
      readonly type: DependencyType;
      readonly lagDays?: number;
    }
  | {
      readonly kind: 'remove-dependency';
      readonly predecessorId: string;
      readonly successorId: string;
      readonly type: DependencyType;
    }
  | { readonly kind: 'rename-schedule'; readonly name: string };

const fail = (
  code: string,
  message: string,
): { ok: false; error: { kind: 'invalid-input'; code: string; message: string } } => ({
  ok: false,
  error: { kind: 'invalid-input', code, message },
});

type TaskRecord = ScheduleRecord['tasks'][number];
type DependencyRecord = ScheduleRecord['dependencies'][number];

/**
 * 생략과 `null`을 갈라 필드 하나를 정한다.
 *
 * 생략은 그대로 두고, `null`은 지우고, 값은 넣는다.
 */
const patched = (
  current: string | undefined,
  next: string | null | undefined,
): string | undefined => (next === undefined ? current : (next ?? undefined));

const applyEdit = (record: ScheduleRecord, edit: ScheduleEdit): Parsed<ScheduleRecord> => {
  switch (edit.kind) {
    case 'rename-schedule': {
      return { ok: true, value: { ...record, name: edit.name } };
    }

    case 'add-task': {
      if (record.tasks.some((task) => task.taskId === edit.taskId)) {
        return fail('schedule.edit.duplicate-task-id', `이미 있는 taskId다: ${edit.taskId}`);
      }

      const task: TaskRecord = {
        taskId: edit.taskId,
        name: edit.name,
        // 빈 값은 필드를 만들지 않는다. "값 없음"을 0이나 오늘로 대체하지 않는다.
        ...(edit.parentTaskId === undefined ? {} : { parentTaskId: edit.parentTaskId }),
        ...(edit.start === undefined ? {} : { start: edit.start }),
        ...(edit.finish === undefined ? {} : { finish: edit.finish }),
      };
      return { ok: true, value: { ...record, tasks: [...record.tasks, task] } };
    }

    case 'update-task': {
      const target = record.tasks.find((task) => task.taskId === edit.taskId);
      if (target === undefined) {
        return fail('schedule.edit.unknown-task-id', `없는 taskId다: ${edit.taskId}`);
      }

      const parentTaskId = patched(target.parentTaskId, edit.parentTaskId);
      const start = patched(target.start, edit.start);
      const finish = patched(target.finish, edit.finish);
      const updated: TaskRecord = {
        taskId: target.taskId,
        name: edit.name ?? target.name,
        ...(parentTaskId === undefined ? {} : { parentTaskId }),
        ...(start === undefined ? {} : { start }),
        ...(finish === undefined ? {} : { finish }),
      };

      return {
        ok: true,
        value: {
          ...record,
          tasks: record.tasks.map((task) => (task.taskId === edit.taskId ? updated : task)),
        },
      };
    }

    case 'remove-task': {
      if (!record.tasks.some((task) => task.taskId === edit.taskId)) {
        return fail('schedule.edit.unknown-task-id', `없는 taskId다: ${edit.taskId}`);
      }
      if (record.tasks.some((task) => task.parentTaskId === edit.taskId)) {
        // 자식까지 함께 지우면 사용자가 보지 못한 것이 사라진다. 자식을 먼저 옮기게 한다.
        return fail(
          'schedule.edit.task-has-children',
          `자식이 있는 Task는 지울 수 없다. 자식을 먼저 옮기거나 지운다: ${edit.taskId}`,
        );
      }

      // 이 Task에만 매달린 것은 함께 지운다. 남기면 없는 Task를 가리켜 일정이 깨진다.
      return {
        ok: true,
        value: {
          ...record,
          tasks: record.tasks.filter((task) => task.taskId !== edit.taskId),
          dependencies: record.dependencies.filter(
            (dependency) =>
              dependency.predecessorId !== edit.taskId && dependency.successorId !== edit.taskId,
          ),
          assignments: record.assignments.filter((assignment) => assignment.taskId !== edit.taskId),
        },
      };
    }

    case 'add-dependency': {
      const dependency: DependencyRecord = {
        predecessorId: edit.predecessorId,
        successorId: edit.successorId,
        type: edit.type,
        // 빈 지연은 0이다. 음수는 선행(lead)이므로 부호를 받는다 (ADR-0006).
        lagDays: edit.lagDays ?? 0,
      };
      return { ok: true, value: { ...record, dependencies: [...record.dependencies, dependency] } };
    }

    case 'remove-dependency': {
      const matches = (dependency: DependencyRecord): boolean =>
        dependency.predecessorId === edit.predecessorId &&
        dependency.successorId === edit.successorId &&
        dependency.type === edit.type;

      if (!record.dependencies.some(matches)) {
        return fail(
          'schedule.edit.unknown-dependency',
          `없는 선후행이다: ${edit.predecessorId}->${edit.successorId}:${edit.type}`,
        );
      }
      return {
        ok: true,
        value: {
          ...record,
          dependencies: record.dependencies.filter((dependency) => !matches(dependency)),
        },
      };
    }
  }
};

/**
 * 일정에 편집을 차례로 적용한다.
 *
 * 하나라도 실패하면 아무것도 바꾸지 않고 실패를 돌려준다. 절반만 적용된 일정을 남기면
 * 사용자가 무엇이 반영됐는지 알 수 없다.
 */
export const applyScheduleEdits = (
  schedule: Schedule,
  edits: readonly ScheduleEdit[],
): Parsed<Schedule> => {
  let record = toScheduleRecord(schedule);

  for (const edit of edits) {
    const applied = applyEdit(record, edit);
    if (!applied.ok) return applied;
    record = applied.value;
  }

  return parseSchedule(record);
};

/** 편집 하나만 적용하는 짧은 길. */
export const applyScheduleEdit = (schedule: Schedule, edit: ScheduleEdit): Parsed<Schedule> =>
  applyScheduleEdits(schedule, [edit]);
