/**
 * 일정 CSV 묶음을 읽고 쓴다.
 *
 * 파일 구성과 열 이름의 정본은 `docs/adr/0007-schedule-csv-exchange.md`다. 이 모듈은
 * 표 모양만 검사하고 의미 검증은 `parseSchedule`에 넘긴다. 해석 지점을 하나로 두려는
 * 것이다 (ADR-0005 결과절).
 *
 * 순수 함수만 담는다. 파일 입출력은 Adapter의 몫이다.
 */

import type { Schedule } from '@bim4d/contracts';

import type { Parsed } from './productKey.js';
import { parseSchedule, toScheduleRecord } from './schedule.js';

/**
 * CSV 묶음 하나. 값은 파일 내용이며 파일 이름이 아니다.
 *
 * `dependencies`와 `models`는 없어도 된다. 선후행이 없는 일정도, 아는 fingerprint가 없는
 * 일정도 정상이기 때문이다 (ADR-0007, ADR-0008).
 */
export interface ScheduleCsvBundle {
  readonly schedule: string;
  readonly tasks: string;
  readonly assignments: string;
  readonly dependencies?: string;
  readonly models?: string;
}

/** 내보내기 결과 한 파일. 이름까지 정해서 돌려준다. */
export interface ScheduleCsvFile {
  readonly fileName: string;
  readonly content: string;
}

const SCHEDULE_COLUMNS = ['scheduleId', 'name', 'schemaVersion'] as const;
const TASK_COLUMNS = ['taskId', 'name', 'parentTaskId', 'start', 'finish'] as const;
const DEPENDENCY_COLUMNS = ['predecessorId', 'successorId', 'type', 'lagDays'] as const;
const ASSIGNMENT_COLUMNS = ['taskId', 'modelRef', 'productGlobalId', 'operation'] as const;
const MODEL_COLUMNS = ['modelRef', 'fingerprint'] as const;

/**
 * UTF-8 선행 BOM.
 *
 * 읽을 때는 값의 일부가 아니므로 버린다. 쓸 때는 붙인다. Windows Excel은 BOM이 없는
 * UTF-8 CSV를 현재 코드 페이지로 읽어 한글을 깨뜨린다 (ADR-0007). 읽는 쪽이 버리므로
 * 왕복 결과는 붙이든 안 붙이든 같다.
 */
const BOM = '﻿';

/** 내보낼 때 쓰는 개행. Excel이 기본으로 기대하는 쪽이다 (ADR-0007). */
const NEWLINE = '\r\n';

const INTEGER = /^-?\d+$/u;

const fail = (
  code: string,
  message: string,
): { ok: false; error: { kind: 'invalid-input'; code: string; message: string } } => ({
  ok: false,
  error: { kind: 'invalid-input', code, message },
});

/**
 * RFC 4180 CSV를 칸의 표로 나눈다.
 *
 * 큰따옴표 안에서는 쉼표와 개행이 값의 일부이고, 안의 큰따옴표는 두 번 써서 표현한다.
 * 개행은 LF와 CRLF를 모두 받는다. 손으로 고친 파일과 Excel이 쓴 파일이 섞여 들어온다.
 */
const splitCsv = (raw: string, file: string): Parsed<readonly (readonly string[])[]> => {
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;

  const endRow = (): void => {
    row.push(cell);
    cell = '';
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }

    if (char === '"' && cell.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\r' && text[index + 1] === '\n') {
      endRow();
      index += 2;
      continue;
    }
    if (char === '\n' || char === '\r') {
      endRow();
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }

  if (quoted) {
    return fail('schedule.csv.unterminated-quote', `${file}의 큰따옴표가 닫히지 않았다.`);
  }
  // 마지막 줄에 개행이 없을 수 있다. 남은 칸이 있으면 한 줄로 마감한다.
  if (cell.length > 0 || row.length > 0) endRow();

  // 파일 끝의 빈 줄은 줄이 아니다. 개행으로 끝나는 파일이 흔하다.
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last?.length === 1 && last[0] === '') rows.pop();
    else break;
  }
  return { ok: true, value: rows };
};

/**
 * 표 하나를 열 이름으로 찾을 수 있는 행 목록으로 바꾼다.
 *
 * 열 순서는 상관없다. 정의되지 않은 열과 칸 수가 어긋난 행은 거부한다. 무시하면 사용자가
 * 적어 넣은 값이 조용히 사라지고, 오타 난 열 이름이 "값 없음"으로 둔갑한다 (ADR-0007).
 */
const readTable = (
  raw: string,
  file: string,
  columns: readonly string[],
): Parsed<readonly ReadonlyMap<string, string>[]> => {
  const split = splitCsv(raw, file);
  if (!split.ok) return split;

  const rows = split.value;
  const header = rows[0];
  if (header === undefined) {
    return fail('schedule.csv.empty', `${file}에 헤더 행이 없다.`);
  }

  const names = header.map((name) => name.trim());
  const seen = new Set<string>();
  for (const name of names) {
    if (!columns.includes(name)) {
      return fail(
        'schedule.csv.unknown-column',
        `${file}에 정의되지 않은 열이 있다: ${name}. 쓸 수 있는 열은 ${columns.join(', ')}뿐이다.`,
      );
    }
    if (seen.has(name)) {
      return fail('schedule.csv.duplicate-column', `${file}에 같은 열이 두 번 있다: ${name}`);
    }
    seen.add(name);
  }
  for (const column of columns) {
    if (!seen.has(column)) {
      return fail('schedule.csv.missing-column', `${file}에 ${column} 열이 없다.`);
    }
  }

  const records: ReadonlyMap<string, string>[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== names.length) {
      return fail(
        'schedule.csv.ragged-row',
        `${file} ${String(index + 2)}번째 줄의 칸 수가 헤더와 다르다. 헤더 ${String(names.length)}칸, 이 줄 ${String(row.length)}칸.`,
      );
    }

    const record = new Map<string, string>();
    for (const [position, name] of names.entries()) {
      record.set(name, (row[position] ?? '').trim());
    }
    records.push(record);
  }
  return { ok: true, value: records };
};

const cellOf = (record: ReadonlyMap<string, string>, column: string): string =>
  record.get(column) ?? '';

/**
 * CSV 묶음을 읽어 일정으로 바꾼다.
 *
 * 표 모양을 확인한 뒤 v2 JSON과 같은 모양의 객체로 옮겨 `parseSchedule`에 넘긴다. 그래서
 * CSV로 들어온 일정과 JSON으로 들어온 일정은 같은 규칙으로 거부되고 같은 코드를 낸다.
 */
export const parseScheduleCsv = (bundle: ScheduleCsvBundle): Parsed<Schedule> => {
  const scheduleRows = readTable(bundle.schedule, 'schedule.csv', SCHEDULE_COLUMNS);
  if (!scheduleRows.ok) return scheduleRows;

  const head = scheduleRows.value[0];
  if (scheduleRows.value.length !== 1 || head === undefined) {
    return fail(
      'schedule.csv.schedule-row-count',
      `schedule.csv의 데이터 행은 정확히 1개여야 한다. 받은 개수: ${String(scheduleRows.value.length)}`,
    );
  }

  const rawVersion = cellOf(head, 'schemaVersion');
  if (!INTEGER.test(rawVersion)) {
    return fail(
      'schedule.csv.invalid-schema-version',
      `schedule.csv의 schemaVersion이 정수가 아니다: ${rawVersion}`,
    );
  }

  const taskRows = readTable(bundle.tasks, 'tasks.csv', TASK_COLUMNS);
  if (!taskRows.ok) return taskRows;

  // 빈 칸은 "값 없음"이다. 0이나 오늘로 대체하지 않고 필드를 만들지 않는다.
  const tasks = taskRows.value.map((record) => {
    const parentTaskId = cellOf(record, 'parentTaskId');
    const start = cellOf(record, 'start');
    const finish = cellOf(record, 'finish');
    return {
      taskId: cellOf(record, 'taskId'),
      name: cellOf(record, 'name'),
      ...(parentTaskId.length === 0 ? {} : { parentTaskId }),
      ...(start.length === 0 ? {} : { start }),
      ...(finish.length === 0 ? {} : { finish }),
    };
  });

  const assignmentRows = readTable(bundle.assignments, 'assignments.csv', ASSIGNMENT_COLUMNS);
  if (!assignmentRows.ok) return assignmentRows;

  const assignments = assignmentRows.value.map((record) => ({
    taskId: cellOf(record, 'taskId'),
    modelRef: cellOf(record, 'modelRef'),
    productGlobalId: cellOf(record, 'productGlobalId'),
    operation: cellOf(record, 'operation'),
  }));

  const dependencies: Record<string, unknown>[] = [];
  if (bundle.dependencies !== undefined) {
    const dependencyRows = readTable(bundle.dependencies, 'dependencies.csv', DEPENDENCY_COLUMNS);
    if (!dependencyRows.ok) return dependencyRows;

    for (const [index, record] of dependencyRows.value.entries()) {
      // 빈 칸은 지연 없음이다. 음수는 선행(lead)이므로 부호를 받는다.
      const rawLag = cellOf(record, 'lagDays');
      if (rawLag.length > 0 && !INTEGER.test(rawLag)) {
        return fail(
          'schedule.csv.invalid-lag',
          `dependencies.csv ${String(index + 2)}번째 줄의 lagDays가 정수가 아니다: ${rawLag}`,
        );
      }

      dependencies.push({
        predecessorId: cellOf(record, 'predecessorId'),
        successorId: cellOf(record, 'successorId'),
        type: cellOf(record, 'type'),
        lagDays: rawLag.length === 0 ? 0 : Number(rawLag),
      });
    }
  }

  const models: Record<string, unknown>[] = [];
  if (bundle.models !== undefined) {
    const modelRows = readTable(bundle.models, 'models.csv', MODEL_COLUMNS);
    if (!modelRows.ok) return modelRows;

    for (const record of modelRows.value) {
      // 빈 칸은 "모르는 fingerprint"다. 형식 검사는 parseSchedule이 한다.
      const fingerprint = cellOf(record, 'fingerprint');
      models.push({
        modelRef: cellOf(record, 'modelRef'),
        ...(fingerprint.length === 0 ? {} : { fingerprint }),
      });
    }
  }

  return parseSchedule({
    scheduleId: cellOf(head, 'scheduleId'),
    name: cellOf(head, 'name'),
    schemaVersion: Number(rawVersion),
    models,
    tasks,
    dependencies,
    assignments,
  });
};

/** epoch milliseconds를 UTC 달력 날짜로 되돌린다. 읽을 때 UTC로 고정했으므로 쓸 때도 UTC다. */
const formatUtcDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** 쉼표·큰따옴표·개행이 든 값만 감싼다. 나머지는 그대로 두어 사람이 읽기 쉽게 한다. */
const escapeCell = (value: string): string =>
  /["\r\n,]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const toCsv = (columns: readonly string[], rows: readonly (readonly string[])[]): string =>
  `${BOM}${[columns, ...rows].map((row) => row.map(escapeCell).join(',')).join(NEWLINE)}${NEWLINE}`;

/**
 * 일정을 CSV 묶음으로 쓴다.
 *
 * 선후행이 없어도 `dependencies.csv`를, 아는 fingerprint가 없어도 `models.csv`를 헤더만
 * 남겨 함께 쓴다. 파일 구성이 일정마다 달라지면 받는 쪽이 무엇이 빠진 것인지 알 수 없다.
 */
export const serializeScheduleCsv = (schedule: Schedule): readonly ScheduleCsvFile[] => [
  {
    fileName: 'schedule.csv',
    content: toCsv(SCHEDULE_COLUMNS, [
      [schedule.scheduleId, schedule.name, String(schedule.schemaVersion)],
    ]),
  },
  {
    fileName: 'tasks.csv',
    content: toCsv(
      TASK_COLUMNS,
      schedule.tasks.map((task) => [
        task.taskId,
        task.name,
        task.parentTaskId ?? '',
        task.start === undefined ? '' : formatUtcDate(task.start),
        task.finish === undefined ? '' : formatUtcDate(task.finish),
      ]),
    ),
  },
  {
    fileName: 'models.csv',
    content: toCsv(
      MODEL_COLUMNS,
      schedule.models.map((model) => [model.modelRef, model.fingerprint ?? '']),
    ),
  },
  {
    fileName: 'dependencies.csv',
    content: toCsv(
      DEPENDENCY_COLUMNS,
      schedule.dependencies.map((dependency) => [
        dependency.predecessorId,
        dependency.successorId,
        dependency.type,
        String(dependency.lagDays),
      ]),
    ),
  },
  {
    fileName: 'assignments.csv',
    content: toCsv(
      ASSIGNMENT_COLUMNS,
      schedule.assignments.map((assignment) => [
        assignment.taskId,
        assignment.modelRef,
        assignment.productGlobalId,
        assignment.operation,
      ]),
    ),
  },
];

/**
 * 일정을 v2 JSON 한 파일로 쓴다.
 *
 * v1으로 읽어 들였어도 v2로 나간다. 내부 표현이 v2 하나이기 때문이다 (ADR-0006).
 */
export const serializeScheduleJson = (schedule: Schedule): string =>
  `${JSON.stringify(toScheduleRecord(schedule), null, 2)}\n`;
