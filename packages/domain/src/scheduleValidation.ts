/**
 * 일정의 정합성 검사와 계층 시간 계산.
 *
 * 구조가 깨진 것(순환, 없는 참조, 요약 Task의 시간)은 `parseSchedule`이 이미 거부했다.
 * 여기서 보는 것은 날짜 정합성이며 결과는 경고다. 날짜를 자동으로 계산하지 않기로 했으므로
 * (ADR-0007), 작성 중인 일정이 잠시 어긋나 있는 것은 정상 상태다.
 *
 * 순수 함수만 담는다.
 */

import type { Schedule, ScheduleTask, TaskDependency, TaskId } from '@bim4d/contracts';

export interface TaskTimes {
  readonly start: number;
  readonly finish: number;
}

export interface ScheduleWarning {
  /** 기계가 분기할 수 있는 안정된 코드. */
  readonly code: string;
  readonly message: string;
  /** 경고의 대상. 일정 전체에 대한 경고면 없다. */
  readonly taskId?: TaskId;
}

const ONE_DAY = 86_400_000;

/** 자식이 있는 Task는 요약 Task다. 자기 시간도 할당도 갖지 않는다. */
const childrenOf = (tasks: readonly ScheduleTask[]): ReadonlyMap<TaskId, TaskId[]> => {
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
 * 선후행 하나가 지켜졌는지 본다.
 *
 * 구간은 시작과 종료를 모두 포함하므로(ADR-0002 경계 규칙 3) 선행의 `finish` 당일은
 * 아직 작업 중이다. 그래서 `finish`를 소비하는 `FINISH_START`만 엄격 부등호이고,
 * 나머지는 같은 날이 정상이다(동시 착수, 동시 완료).
 */
const isSatisfied = (
  dependency: TaskDependency,
  predecessor: TaskTimes,
  successor: TaskTimes,
): boolean => {
  const lag = dependency.lagDays * ONE_DAY;

  switch (dependency.type) {
    case 'FINISH_START':
      return successor.start > predecessor.finish + lag;
    case 'START_START':
      return successor.start >= predecessor.start + lag;
    case 'FINISH_FINISH':
      return successor.finish >= predecessor.finish + lag;
    case 'START_FINISH':
      return successor.finish >= predecessor.start + lag;
  }
};

/** 일정의 날짜 정합성을 본다. 결과는 경고이며 읽기를 막지 않는다. */
export const validateSchedule = (schedule: Schedule): readonly ScheduleWarning[] => {
  const warnings: ScheduleWarning[] = [];
  const children = childrenOf(schedule.tasks);
  const times = effectiveTaskTimes(schedule);

  const assignedTaskIds = new Set(schedule.assignments.map((assignment) => assignment.taskId));

  for (const task of schedule.tasks) {
    const isSummary = (children.get(task.taskId) ?? []).length > 0;

    if (!times.has(task.taskId)) {
      warnings.push({
        code: 'schedule.warn.task-without-time',
        message: `시간이 정해지지 않았다: ${task.name}`,
        taskId: task.taskId,
      });
    }

    // 요약 Task는 부재를 걸 수 없으므로(ADR-0007) 없다고 알릴 일이 아니다.
    if (!isSummary && !assignedTaskIds.has(task.taskId)) {
      warnings.push({
        code: 'schedule.warn.task-without-assignment',
        message: `연결된 부재가 없다: ${task.name}`,
        taskId: task.taskId,
      });
    }
  }

  for (const dependency of schedule.dependencies) {
    const predecessor = times.get(dependency.predecessorId);
    const successor = times.get(dependency.successorId);
    // 판정할 수 없는 것을 위반이라 부르지 않는다. 시간 미정은 그 자체로 이미 경고다.
    if (predecessor === undefined || successor === undefined) continue;

    if (!isSatisfied(dependency, predecessor, successor)) {
      warnings.push({
        code: 'schedule.warn.dependency-violated',
        message: `${dependency.type} 선후행을 지키지 않는다: ${dependency.predecessorId} → ${dependency.successorId}`,
        taskId: dependency.successorId,
      });
    }
  }

  return warnings;
};
