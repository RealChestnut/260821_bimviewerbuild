/**
 * 일정의 날짜 정합성 검사.
 *
 * 구조가 깨진 것(순환, 없는 참조, 요약 Task의 시간)은 `parseSchedule`이 이미 거부했다.
 * 여기서 보는 것은 날짜 정합성이며 결과는 경고다. 날짜를 자동으로 계산하지 않기로 했으므로
 * (ADR-0007), 작성 중인 일정이 잠시 어긋나 있는 것은 정상 상태다.
 *
 * 순수 함수만 담는다.
 */

import type { Schedule, TaskDependency, TaskId } from '@bim4d/contracts';

import { childrenOf, effectiveTaskTimes } from './scheduleTree.js';
import type { TaskTimes } from './scheduleTree.js';

export interface ScheduleWarning {
  /** 기계가 분기할 수 있는 안정된 코드. */
  readonly code: string;
  readonly message: string;
  /** 경고의 대상. 일정 전체에 대한 경고면 없다. */
  readonly taskId?: TaskId;
}

const ONE_DAY = 86_400_000;

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
