/**
 * 일정의 계층에서 나오는 값들.
 *
 * 요약 Task의 시간과 화면에 그릴 줄 순서는 둘 다 `parentTaskId`가 만드는 트리에서
 * 계산된다. 저장하지 않고 필요할 때마다 계산한다 (ADR-0006).
 *
 * 순수 함수만 담는다.
 */

import type { Schedule, ScheduleTask, TaskId } from '@bim4d/contracts';

export interface TaskTimes {
  readonly start: number;
  readonly finish: number;
}

/** 화면에 한 줄로 그릴 Task. 깊이는 들여쓰기에 쓴다. */
export interface FlatTask {
  readonly task: ScheduleTask;
  readonly depth: number;
  /** 자식이 있으면 요약 Task다. 자기 시간도 할당도 갖지 않는다. */
  readonly isSummary: boolean;
}

/** 자식이 있는 Task는 요약 Task다. 자기 시간도 할당도 갖지 않는다. */
export const childrenOf = (tasks: readonly ScheduleTask[]): ReadonlyMap<TaskId, TaskId[]> => {
  const children = new Map<TaskId, TaskId[]>();
  for (const task of tasks) {
    const parentTaskId = task.parentTaskId;
    if (parentTaskId === undefined) continue;

    const bucket = children.get(parentTaskId);
    if (bucket === undefined) children.set(parentTaskId, [task.taskId]);
    else bucket.push(task.taskId);
  }
  return children;
};

/**
 * Task마다 실제로 쓰이는 시간.
 *
 * 말단 Task는 자기 시간, 요약 Task는 자손 중 시간이 확정된 것들의 `min(start)`와
 * `max(finish)`다. 시간을 알 수 없는 Task는 결과에 담지 않는다. 0으로 대체하면
 * 1970년에 놓인 막대가 생긴다.
 */
export const effectiveTaskTimes = (schedule: Schedule): ReadonlyMap<TaskId, TaskTimes> => {
  const children = childrenOf(schedule.tasks);
  const byId = new Map(schedule.tasks.map((task) => [task.taskId, task]));
  const times = new Map<TaskId, TaskTimes>();

  const resolve = (taskId: TaskId): TaskTimes | undefined => {
    const cached = times.get(taskId);
    if (cached !== undefined) return cached;

    const task = byId.get(taskId);
    if (task === undefined) return undefined;

    const childIds = children.get(taskId) ?? [];
    if (childIds.length === 0) {
      if (task.start === undefined || task.finish === undefined) return undefined;
      const own = { start: task.start, finish: task.finish };
      times.set(taskId, own);
      return own;
    }

    let start: number | undefined;
    let finish: number | undefined;
    for (const childId of childIds) {
      const child = resolve(childId);
      if (child === undefined) continue;
      if (start === undefined || child.start < start) start = child.start;
      if (finish === undefined || child.finish > finish) finish = child.finish;
    }

    if (start === undefined || finish === undefined) return undefined;
    const rolled = { start, finish };
    times.set(taskId, rolled);
    return rolled;
  };

  // 계층에 순환이 없음은 parseSchedule이 보장한다.
  for (const task of schedule.tasks) resolve(task.taskId);
  return times;
};

/**
 * 계층 순서로 평탄화한다.
 *
 * 형제 사이의 순서는 `tasks` 배열의 순서를 그대로 쓴다. 순서 필드를 따로 두면 진실이
 * 둘이 된다 (ADR-0006).
 */
export const flattenTasks = (schedule: Schedule): readonly FlatTask[] => {
  const children = childrenOf(schedule.tasks);
  const byId = new Map(schedule.tasks.map((task) => [task.taskId, task]));

  const rows: FlatTask[] = [];
  const walk = (taskId: TaskId, depth: number): void => {
    const task = byId.get(taskId);
    if (task === undefined) return;

    const childIds = children.get(taskId) ?? [];
    rows.push({ task, depth, isSummary: childIds.length > 0 });
    for (const childId of childIds) walk(childId, depth + 1);
  };

  // 계층에 순환이 없음은 parseSchedule이 보장한다.
  for (const task of schedule.tasks) {
    if (task.parentTaskId === undefined) walk(task.taskId, 0);
  }
  return rows;
};
