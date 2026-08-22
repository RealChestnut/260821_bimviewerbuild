/**
 * 4D 시뮬레이션 상태 계산.
 *
 * 정본은 `docs/adr/0002-4d-operation-vocabulary.md`다. 상태는 저장하지 않고 시각 `t`에 대한
 * 전역 함수로 항상 계산한다. 그래야 타임라인을 임의 지점으로 건너뛰어도 처음부터 이벤트를
 * 재생할 필요가 없고, 앞뒤로 오가도 상태가 누적되지 않는다.
 *
 * 이 파일은 순수 함수만 담는다. Viewer도 That Open도 참조하지 않는다.
 */

import type {
  ElementDisplayState,
  ModelId,
  ProductKey,
  Schedule,
  TaskOperation,
} from '@bim4d/contracts';

import { formatProductKey } from './productKey.js';

/** 시각과 모델이 확정된 할당 하나. 시뮬레이션이 실제로 다루는 단위다. */
export interface SimulationAssignment {
  readonly product: ProductKey;
  readonly operation: TaskOperation;
  /** 계획 시작. epoch milliseconds. */
  readonly start: number;
  /** 계획 완료. epoch milliseconds. */
  readonly finish: number;
}

export interface ProductDisplayState {
  readonly product: ProductKey;
  readonly state: ElementDisplayState;
}

export interface ScheduleBounds {
  readonly start: number;
  readonly finish: number;
}

/** Task 전 존재 여부. `t < start`일 때의 상태다. */
const BEFORE: Readonly<Record<TaskOperation, ElementDisplayState>> = {
  CONSTRUCT: 'HIDDEN',
  DEMOLISH: 'PRESENT',
  TEMPORARY: 'HIDDEN',
  MODIFY: 'PRESENT',
};

/** Task 후 존재 여부. `t > finish`일 때의 상태다. */
const AFTER: Readonly<Record<TaskOperation, ElementDisplayState>> = {
  CONSTRUCT: 'PRESENT',
  DEMOLISH: 'HIDDEN',
  TEMPORARY: 'HIDDEN',
  MODIFY: 'PRESENT',
};

/**
 * 할당 하나에 대한 상태.
 *
 * 구간은 시작과 종료를 모두 포함한다. `start === finish`인 Milestone Task는 그 시각에
 * `IN_PROGRESS`가 된다 (ADR-0002 경계 규칙 3).
 */
const deriveOne = (assignment: SimulationAssignment, time: number): ElementDisplayState => {
  if (time < assignment.start) return BEFORE[assignment.operation];
  if (time <= assignment.finish) return 'IN_PROGRESS';
  return AFTER[assignment.operation];
};

/**
 * 한 부재에 걸린 여러 할당을 하나의 상태로 해소한다 (ADR-0002 경계 규칙 2).
 *
 * 이 순서 덕분에 `CONSTRUCT` 후 `DEMOLISH` 같은 정상 연쇄가 올바르게 동작한다.
 */
const resolveConflict = (
  assignments: readonly SimulationAssignment[],
  time: number,
): ElementDisplayState => {
  let latestPast: SimulationAssignment | undefined;
  let earliestFuture: SimulationAssignment | undefined;

  for (const assignment of assignments) {
    // 1. 진행 중인 것이 하나라도 있으면 그것이 이긴다.
    if (time >= assignment.start && time <= assignment.finish) return 'IN_PROGRESS';

    if (assignment.finish <= time) {
      if (latestPast === undefined || assignment.finish > latestPast.finish) {
        latestPast = assignment;
      }
      continue;
    }
    if (earliestFuture === undefined || assignment.start < earliestFuture.start) {
      earliestFuture = assignment;
    }
  }

  // 2. 지나간 것 중 가장 늦게 끝난 것.
  if (latestPast !== undefined) return AFTER[latestPast.operation];
  // 3. 모두 미래면 가장 이른 것의 시작 전 상태.
  if (earliestFuture !== undefined) return BEFORE[earliestFuture.operation];

  return 'PRESENT';
};

/**
 * 시각 `t`에 각 부재를 어떻게 그릴지 계산한다.
 *
 * 결과에는 할당이 있는 부재만 담긴다. 어떤 Task에도 연결되지 않은 부재는 모든 `t`에서
 * `PRESENT`이므로(ADR-0002 경계 규칙 1) 호출자가 건드리지 않으면 그대로 남는다.
 * 모델 전체를 열거할 필요가 없다는 뜻이기도 하다.
 *
 * 키는 `formatProductKey`가 만든 영구 키 문자열이다.
 */
export const computeDisplayStates = (
  assignments: readonly SimulationAssignment[],
  time: number,
): ReadonlyMap<string, ProductDisplayState> => {
  const byProduct = new Map<string, SimulationAssignment[]>();
  for (const assignment of assignments) {
    const key = formatProductKey(assignment.product);
    const bucket = byProduct.get(key);
    if (bucket === undefined) byProduct.set(key, [assignment]);
    else bucket.push(assignment);
  }

  const states = new Map<string, ProductDisplayState>();
  for (const [key, forProduct] of byProduct) {
    const first = forProduct[0];
    if (first === undefined) continue;

    const state =
      forProduct.length === 1 ? deriveOne(first, time) : resolveConflict(forProduct, time);
    states.set(key, { product: first.product, state });
  }
  return states;
};

/** 시작과 완료가 확정된 구간 하나. Task든 할당이든 이 모양이면 된다. */
export interface TimeInterval {
  readonly start: number;
  readonly finish: number;
}

/**
 * 구간 전체를 덮는 바깥 구간. 타임라인의 양 끝이 된다.
 *
 * 타임라인은 Task를 기준으로 잡는다. 열려 있는 모델에 따라 길이가 달라지면 같은 일정이
 * 볼 때마다 다른 길이로 보인다.
 */
export const scheduleBounds = (intervals: readonly TimeInterval[]): ScheduleBounds | null => {
  let start: number | undefined;
  let finish: number | undefined;

  for (const interval of intervals) {
    if (start === undefined || interval.start < start) start = interval.start;
    if (finish === undefined || interval.finish > finish) finish = interval.finish;
  }

  if (start === undefined || finish === undefined) return null;
  return { start, finish };
};

/**
 * 일정의 할당을 시뮬레이션이 다룰 수 있는 형태로 바꾼다.
 *
 * 두 가지를 걸러 낸다.
 *
 * - 열려 있지 않은 모델의 할당. 일정은 모델보다 오래 살고 모델은 나중에 열릴 수 있다.
 * - 시작이나 완료가 없는 Task의 할당. 조용히 0으로 대체하지 않는다 (ADR-0002 경계 규칙 4).
 */
export const bindSchedule = (
  schedule: Schedule,
  modelIdByRef: ReadonlyMap<string, ModelId>,
): readonly SimulationAssignment[] => {
  const taskById = new Map(schedule.tasks.map((task) => [task.taskId, task]));
  const bound: SimulationAssignment[] = [];

  for (const assignment of schedule.assignments) {
    const modelId = modelIdByRef.get(assignment.modelRef);
    if (modelId === undefined) continue;

    const task = taskById.get(assignment.taskId);
    if (task?.start === undefined || task.finish === undefined) continue;

    bound.push({
      product: { modelId, globalId: assignment.productGlobalId },
      operation: assignment.operation,
      start: task.start,
      finish: task.finish,
    });
  }
  return bound;
};
