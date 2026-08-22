/**
 * 일정 JSON을 읽어 계약 타입으로 바꾼다.
 *
 * 파일은 사람이 손으로 고칠 수 있고 나중에는 외부에서 들어온다. 형태를 믿지 않고 전부 검사한다.
 * 실패는 예외가 아니라 값으로 돌려준다.
 */

import type {
  Schedule,
  ScheduleAssignment,
  ScheduleTask,
  TaskId,
  TaskOperation,
} from '@bim4d/contracts';

import { parseGlobalId } from './productKey.js';
import type { Parsed } from './productKey.js';

/** 이 코드가 읽을 수 있는 스키마 버전. */
const SUPPORTED_VERSION = 1;

/** ADR-0002가 확정한 네 값. 다섯 번째 값을 임의로 늘리지 않는다. */
const OPERATIONS: readonly TaskOperation[] = ['CONSTRUCT', 'DEMOLISH', 'TEMPORARY', 'MODIFY'];

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

/** 일정 JSON 하나를 검증해 계약 타입으로 바꾼다. */
export const parseSchedule = (raw: unknown): Parsed<Schedule> => {
  if (!isRecord(raw)) {
    return fail('schedule.parse.not-an-object', '일정은 JSON 객체여야 한다.');
  }

  if (raw['schemaVersion'] !== SUPPORTED_VERSION) {
    return fail(
      'schedule.parse.unsupported-version',
      `읽을 수 있는 schemaVersion은 ${String(SUPPORTED_VERSION)}뿐이다: ${String(raw['schemaVersion'])}`,
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

  const rawAssignments = raw['assignments'];
  if (!Array.isArray(rawAssignments)) {
    return fail('schedule.parse.invalid-assignments', 'assignments가 배열이 아니다.');
  }

  const assignments: ScheduleAssignment[] = [];
  for (const [index, rawAssignment] of rawAssignments.entries()) {
    const parsed = parseAssignment(rawAssignment, index, taskIds);
    if (!parsed.ok) return parsed;
    assignments.push(parsed.value);
  }

  return {
    ok: true,
    value: { scheduleId, name, schemaVersion: SUPPORTED_VERSION, tasks, assignments },
  };
};
