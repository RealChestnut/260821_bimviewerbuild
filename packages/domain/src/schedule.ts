/**
 * 일정 JSON을 읽어 계약 타입으로 바꾼다.
 *
 * 파일은 사람이 손으로 고칠 수 있고 나중에는 외부에서 들어온다. 형태를 믿지 않고 전부 검사한다.
 * 실패는 예외가 아니라 값으로 돌려준다.
 */

import type {
  DependencyType,
  Schedule,
  ScheduleAssignment,
  ScheduleTask,
  TaskDependency,
  TaskId,
  TaskOperation,
} from '@bim4d/contracts';

import { parseGlobalId } from './productKey.js';
import type { Parsed } from './productKey.js';

/**
 * 읽을 수 있는 파일의 스키마 버전.
 *
 * 어느 쪽을 읽든 내부 표현은 항상 최신(`INTERNAL_VERSION`)이다. 읽는 쪽이 버전을
 * 분기하지 않게 하려는 것이다 (ADR-0006).
 */
const SUPPORTED_VERSIONS: readonly number[] = [1, 2];
const INTERNAL_VERSION = 2;

/** ADR-0002가 확정한 네 값. 다섯 번째 값을 임의로 늘리지 않는다. */
const OPERATIONS: readonly TaskOperation[] = ['CONSTRUCT', 'DEMOLISH', 'TEMPORARY', 'MODIFY'];

/** ADR-0006이 확정한 네 값. IFC의 USERDEFINED / NOTDEFINED는 받지 않는다. */
const DEPENDENCY_TYPES: readonly DependencyType[] = [
  'FINISH_START',
  'START_START',
  'FINISH_FINISH',
  'START_FINISH',
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

const fail = (
  code: string,
  message: string,
): { ok: false; error: { kind: 'invalid-input'; code: string; message: string } } => ({
  ok: false,
  error: { kind: 'invalid-input', code, message },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `YYYY-MM-DD`를 UTC 자정의 epoch milliseconds로 바꾼다.
 *
 * 지역 시간대를 쓰면 같은 파일이 실행 장소에 따라 다른 날로 읽힌다. 일정은 달력상의 날짜이므로
 * 시간대에 흔들리지 않아야 한다.
 */
const parseIsoDate = (raw: unknown, field: string): Parsed<number> => {
  if (typeof raw !== 'string') {
    return fail('schedule.parse.invalid-date', `${field}는 YYYY-MM-DD 문자열이어야 한다.`);
  }

  const match = ISO_DATE.exec(raw);
  if (match === null) {
    return fail('schedule.parse.invalid-date', `${field}가 YYYY-MM-DD 형식이 아니다: ${raw}`);
  }

  const [, year, month, dayOfMonth] = match;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(dayOfMonth));

  // Date.UTC는 2026-13-02 같은 값을 다음 해로 넘겨 버린다. 되돌려 보고 같은지 확인한다.
  const roundTrip = new Date(time).toISOString().slice(0, 10);
  if (roundTrip !== raw) {
    return fail('schedule.parse.invalid-date', `${field}가 달력에 없는 날짜다: ${raw}`);
  }
  return { ok: true, value: time };
};

const parseTask = (raw: unknown, index: number): Parsed<ScheduleTask> => {
  const where = `tasks[${String(index)}]`;
  if (!isRecord(raw)) {
    return fail('schedule.parse.invalid-tasks', `${where}가 객체가 아니다.`);
  }

  const taskId = raw['taskId'];
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    return fail('schedule.parse.invalid-task-id', `${where}.taskId가 비어 있다.`);
  }

  const name = raw['name'];
  if (typeof name !== 'string') {
    return fail('schedule.parse.invalid-task-name', `${where}.name이 문자열이 아니다.`);
  }

  let parentTaskId: string | undefined;
  if (raw['parentTaskId'] !== undefined && raw['parentTaskId'] !== null) {
    if (typeof raw['parentTaskId'] !== 'string' || raw['parentTaskId'].trim().length === 0) {
      return fail('schedule.parse.invalid-parent-task-id', `${where}.parentTaskId가 비어 있다.`);
    }
    parentTaskId = raw['parentTaskId'];
  }

  // 시간이 정해지지 않은 Task는 정상 입력이다. 0으로 대체하지 않고 없는 채로 둔다.
  let start: number | undefined;
  if (raw['start'] !== undefined && raw['start'] !== null) {
    const parsed = parseIsoDate(raw['start'], `${where}.start`);
    if (!parsed.ok) return parsed;
    start = parsed.value;
  }

  let finish: number | undefined;
  if (raw['finish'] !== undefined && raw['finish'] !== null) {
    const parsed = parseIsoDate(raw['finish'], `${where}.finish`);
    if (!parsed.ok) return parsed;
    finish = parsed.value;
  }

  if (start !== undefined && finish !== undefined && finish < start) {
    return fail('schedule.parse.finish-before-start', `${where}의 완료가 시작보다 이르다.`);
  }

  return {
    ok: true,
    value: {
      taskId: taskId as TaskId,
      name,
      ...(parentTaskId === undefined ? {} : { parentTaskId: parentTaskId as TaskId }),
      ...(start === undefined ? {} : { start }),
      ...(finish === undefined ? {} : { finish }),
    },
  };
};

const parseAssignment = (
  raw: unknown,
  index: number,
  taskIds: ReadonlySet<string>,
): Parsed<ScheduleAssignment> => {
  const where = `assignments[${String(index)}]`;
  if (!isRecord(raw)) {
    return fail('schedule.parse.invalid-assignments', `${where}가 객체가 아니다.`);
  }

  const taskId = raw['taskId'];
  if (typeof taskId !== 'string' || !taskIds.has(taskId)) {
    return fail(
      'schedule.parse.unknown-task-id',
      `${where}.taskId가 tasks에 없다: ${String(taskId)}`,
    );
  }

  const modelRef = raw['modelRef'];
  if (typeof modelRef !== 'string' || modelRef.trim().length === 0) {
    return fail('schedule.parse.invalid-model-ref', `${where}.modelRef가 비어 있다.`);
  }

  const operation = raw['operation'];
  if (typeof operation !== 'string' || !OPERATIONS.includes(operation as TaskOperation)) {
    return fail(
      'schedule.parse.invalid-operation',
      `${where}.operation은 ${OPERATIONS.join(' | ')} 중 하나여야 한다: ${String(operation)}`,
    );
  }

  const globalId = parseGlobalId(String(raw['productGlobalId']));
  if (!globalId.ok) return globalId;

  return {
    ok: true,
    value: {
      taskId: taskId as TaskId,
      modelRef,
      productGlobalId: globalId.value,
      operation: operation as TaskOperation,
    },
  };
};

const parseDependency = (
  raw: unknown,
  index: number,
  taskIds: ReadonlySet<string>,
): Parsed<TaskDependency> => {
  const where = `dependencies[${String(index)}]`;
  if (!isRecord(raw)) {
    return fail('schedule.parse.invalid-dependencies', `${where}가 객체가 아니다.`);
  }

  const predecessorId = raw['predecessorId'];
  const successorId = raw['successorId'];
  for (const [field, value] of [
    ['predecessorId', predecessorId],
    ['successorId', successorId],
  ] as const) {
    if (typeof value !== 'string' || !taskIds.has(value)) {
      return fail(
        'schedule.parse.unknown-dependency-task-id',
        `${where}.${field}가 tasks에 없다: ${String(value)}`,
      );
    }
  }

  const type = raw['type'];
  if (typeof type !== 'string' || !DEPENDENCY_TYPES.includes(type as DependencyType)) {
    return fail(
      'schedule.parse.invalid-dependency-type',
      `${where}.type은 ${DEPENDENCY_TYPES.join(' | ')} 중 하나여야 한다: ${String(type)}`,
    );
  }

  // 생략하면 지연 없음이다. 음수는 선행(lead)이므로 허용한다.
  let lagDays = 0;
  if (raw['lagDays'] !== undefined && raw['lagDays'] !== null) {
    if (typeof raw['lagDays'] !== 'number' || !Number.isInteger(raw['lagDays'])) {
      return fail('schedule.parse.invalid-lag', `${where}.lagDays는 정수여야 한다.`);
    }
    lagDays = raw['lagDays'];
  }

  return {
    ok: true,
    value: {
      predecessorId: predecessorId as TaskId,
      successorId: successorId as TaskId,
      type: type as DependencyType,
      lagDays,
    },
  };
};

/**
 * 방향 그래프에 순환이 있는지 본다.
 *
 * WBS(자식 → 부모)와 선후행(선행 → 후행) 모두 같은 검사를 쓴다. 자기 자신을 가리키는
 * 간선도 길이 1짜리 순환이므로 함께 걸린다.
 */
const hasCycle = (edges: ReadonlyMap<string, readonly string[]>): boolean => {
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;

    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (walk(next)) return true;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  };

  for (const node of edges.keys()) {
    if (walk(node)) return true;
  }
  return false;
};

/** 일정 JSON 하나를 검증해 계약 타입으로 바꾼다. */
export const parseSchedule = (raw: unknown): Parsed<Schedule> => {
  if (!isRecord(raw)) {
    return fail('schedule.parse.not-an-object', '일정은 JSON 객체여야 한다.');
  }

  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.includes(version)) {
    return fail(
      'schedule.parse.unsupported-version',
      `읽을 수 있는 schemaVersion은 ${SUPPORTED_VERSIONS.join(', ')}뿐이다: ${String(version)}`,
    );
  }

  const scheduleId = raw['scheduleId'];
  if (typeof scheduleId !== 'string' || scheduleId.trim().length === 0) {
    return fail('schedule.parse.invalid-schedule-id', 'scheduleId가 비어 있다.');
  }

  const name = raw['name'];
  if (typeof name !== 'string') {
    return fail('schedule.parse.invalid-name', 'name이 문자열이 아니다.');
  }

  const rawTasks = raw['tasks'];
  if (!Array.isArray(rawTasks)) {
    return fail('schedule.parse.invalid-tasks', 'tasks가 배열이 아니다.');
  }

  const tasks: ScheduleTask[] = [];
  const taskIds = new Set<string>();
  for (const [index, rawTask] of rawTasks.entries()) {
    const parsed = parseTask(rawTask, index);
    if (!parsed.ok) return parsed;

    if (taskIds.has(parsed.value.taskId)) {
      return fail('schedule.parse.duplicate-task-id', `taskId가 중복이다: ${parsed.value.taskId}`);
    }
    taskIds.add(parsed.value.taskId);
    tasks.push(parsed.value);
  }

  // 계층 검증. 없는 부모를 가리키거나 순환하면 트리를 만들 수 없다.
  const parentEdges = new Map<string, readonly string[]>();
  const childCount = new Map<string, number>();
  for (const task of tasks) {
    const parentTaskId = task.parentTaskId;
    if (parentTaskId === undefined) {
      parentEdges.set(task.taskId, []);
      continue;
    }
    if (!taskIds.has(parentTaskId)) {
      return fail(
        'schedule.parse.unknown-parent-task-id',
        `${task.taskId}의 parentTaskId가 tasks에 없다: ${parentTaskId}`,
      );
    }
    parentEdges.set(task.taskId, [parentTaskId]);
    childCount.set(parentTaskId, (childCount.get(parentTaskId) ?? 0) + 1);
  }
  if (hasCycle(parentEdges)) {
    return fail('schedule.parse.wbs-cycle', 'WBS 계층이 순환한다.');
  }

  // 요약 Task는 자기 시간을 갖지 않는다. 시간은 자손에서 계산한다 (ADR-0006).
  for (const task of tasks) {
    if ((childCount.get(task.taskId) ?? 0) === 0) continue;
    if (task.start !== undefined || task.finish !== undefined) {
      return fail(
        'schedule.parse.summary-task-has-time',
        `요약 Task는 시간을 가질 수 없다. 자손에서 계산한다: ${task.taskId}`,
      );
    }
  }

  const rawDependencies = raw['dependencies'];
  const dependencies: TaskDependency[] = [];
  if (rawDependencies !== undefined && rawDependencies !== null) {
    if (!Array.isArray(rawDependencies)) {
      return fail('schedule.parse.invalid-dependencies', 'dependencies가 배열이 아니다.');
    }

    const seen = new Set<string>();
    const sequenceEdges = new Map<string, string[]>();

    for (const [index, rawDependency] of rawDependencies.entries()) {
      const parsed = parseDependency(rawDependency, index, taskIds);
      if (!parsed.ok) return parsed;

      const { predecessorId, successorId, type } = parsed.value;
      const key = `${predecessorId}->${successorId}:${type}`;
      if (seen.has(key)) {
        return fail('schedule.parse.duplicate-dependency', `선후행이 중복이다: ${key}`);
      }
      seen.add(key);

      const bucket = sequenceEdges.get(predecessorId);
      if (bucket === undefined) sequenceEdges.set(predecessorId, [successorId]);
      else bucket.push(successorId);
      sequenceEdges.set(successorId, sequenceEdges.get(successorId) ?? []);

      dependencies.push(parsed.value);
    }

    if (hasCycle(sequenceEdges)) {
      return fail('schedule.parse.dependency-cycle', '선후행이 순환한다.');
    }
  }

  const rawAssignments = raw['assignments'];
  if (!Array.isArray(rawAssignments)) {
    return fail('schedule.parse.invalid-assignments', 'assignments가 배열이 아니다.');
  }

  const assignments: ScheduleAssignment[] = [];
  for (const [index, rawAssignment] of rawAssignments.entries()) {
    const parsed = parseAssignment(rawAssignment, index, taskIds);
    if (!parsed.ok) return parsed;

    if ((childCount.get(parsed.value.taskId) ?? 0) > 0) {
      return fail(
        'schedule.parse.summary-task-has-assignment',
        `요약 Task에는 부재를 걸 수 없다: ${parsed.value.taskId}`,
      );
    }
    assignments.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      scheduleId,
      name,
      schemaVersion: INTERNAL_VERSION,
      tasks,
      dependencies,
      assignments,
    },
  };
};

/** epoch milliseconds를 UTC 달력 날짜로 되돌린다. 읽을 때 UTC로 고정했으므로 쓸 때도 UTC다. */
export const formatScheduleDate = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

/** v2 JSON과 같은 모양의 평범한 값. 파일로 쓰기 전과 편집 중의 중간 표현이다. */
export interface ScheduleRecord {
  readonly scheduleId: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly tasks: readonly {
    readonly taskId: string;
    readonly name: string;
    readonly parentTaskId?: string;
    readonly start?: string;
    readonly finish?: string;
  }[];
  readonly dependencies: readonly {
    readonly predecessorId: string;
    readonly successorId: string;
    readonly type: string;
    readonly lagDays: number;
  }[];
  readonly assignments: readonly {
    readonly taskId: string;
    readonly modelRef: string;
    readonly productGlobalId: string;
    readonly operation: string;
  }[];
}

/**
 * 일정을 v2 JSON과 같은 모양의 평범한 값으로 되돌린다.
 *
 * 내보내기와 편집이 함께 쓴다. 편집은 이 값을 고쳐 `parseSchedule`에 다시 넘기므로,
 * 되돌리기가 무손실이어야 편집이 값을 잃지 않는다.
 */
export const toScheduleRecord = (schedule: Schedule): ScheduleRecord => ({
  scheduleId: schedule.scheduleId,
  name: schedule.name,
  schemaVersion: schedule.schemaVersion,
  tasks: schedule.tasks.map((task) => ({
    taskId: task.taskId,
    name: task.name,
    ...(task.parentTaskId === undefined ? {} : { parentTaskId: task.parentTaskId }),
    ...(task.start === undefined ? {} : { start: formatScheduleDate(task.start) }),
    ...(task.finish === undefined ? {} : { finish: formatScheduleDate(task.finish) }),
  })),
  dependencies: schedule.dependencies,
  assignments: schedule.assignments,
});
