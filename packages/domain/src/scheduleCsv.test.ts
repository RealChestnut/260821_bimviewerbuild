import { describe, expect, it } from 'vitest';

import { parseSchedule } from './schedule.js';
import {
  parseScheduleCsv,
  serializeScheduleCsv,
  serializeScheduleJson,
  type ScheduleCsvBundle,
} from './scheduleCsv.js';

const WALL_A = '0BnKdW4tq7SfUcM3vHxZgR';
const WALL_B = '1MjTgR8dp5NkXbC2wFyQsA';

const bundle: ScheduleCsvBundle = {
  schedule: 'scheduleId,name,schemaVersion\r\nmock,시험 일정,2\r\n',
  tasks: [
    'taskId,name,parentTaskId,start,finish',
    'W1,1층 골조,,,',
    'T001,벽 A 시공,W1,2026-03-02,2026-03-06',
    'T002,벽 B 시공,W1,2026-03-09,2026-03-13',
    'T003,검사 (일정 미정),,,',
    '',
  ].join('\r\n'),
  dependencies: ['predecessorId,successorId,type,lagDays', 'T001,T002,FINISH_START,2', ''].join(
    '\r\n',
  ),
  assignments: [
    'taskId,modelRef,productGlobalId,operation',
    `T001,a.ifc,${WALL_A},CONSTRUCT`,
    `T002,a.ifc,${WALL_B},DEMOLISH`,
    `T003,a.ifc,${WALL_A},MODIFY`,
    '',
  ].join('\r\n'),
};

/** 정상 묶음에서 파일 하나만 바꾼 것. */
const withFile = (patch: Partial<ScheduleCsvBundle>): ScheduleCsvBundle => ({
  ...bundle,
  ...patch,
});

const errorCode = (input: ScheduleCsvBundle): string | undefined => {
  const parsed = parseScheduleCsv(input);
  return parsed.ok ? undefined : parsed.error.code;
};

const contentOf = (files: readonly { fileName: string; content: string }[], name: string): string =>
  files.find((file) => file.fileName === name)?.content ?? '';

const parsed = (input: ScheduleCsvBundle = bundle) => {
  const result = parseScheduleCsv(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('parseScheduleCsv', () => {
  it('네 파일을 하나의 일정으로 읽는다', () => {
    const schedule = parsed();

    expect(schedule.scheduleId).toBe('mock');
    expect(schedule.name).toBe('시험 일정');
    expect(schedule.schemaVersion).toBe(2);
    expect(schedule.tasks).toHaveLength(4);
    expect(schedule.dependencies).toHaveLength(1);
    expect(schedule.assignments).toHaveLength(3);
  });

  it('날짜를 UTC 자정의 epoch milliseconds로 바꾼다', () => {
    // 변환은 parseSchedule이 한다. CSV가 따로 날짜를 해석하지 않는다는 확인이다.
    const task = parsed().tasks.find((candidate) => candidate.taskId === 'T001');

    expect(task?.start).toBe(Date.UTC(2026, 2, 2));
    expect(task?.finish).toBe(Date.UTC(2026, 2, 6));
  });

  it('빈 칸은 값 없음이며 0이나 오늘로 대체하지 않는다', () => {
    const task = parsed().tasks.find((candidate) => candidate.taskId === 'T003');

    expect(task?.start).toBeUndefined();
    expect(task?.finish).toBeUndefined();
    expect(task?.parentTaskId).toBeUndefined();
  });

  it('열 순서가 달라도 같은 결과를 낸다', () => {
    const shuffled = withFile({
      tasks: [
        'finish,name,taskId,start,parentTaskId',
        ',1층 골조,W1,,',
        '2026-03-06,벽 A 시공,T001,2026-03-02,W1',
        '2026-03-13,벽 B 시공,T002,2026-03-09,W1',
        ',검사 (일정 미정),T003,,',
        '',
      ].join('\r\n'),
    });

    expect(parsed(shuffled)).toEqual(parsed());
  });

  it('LF 개행도 받는다', () => {
    const lf = withFile({ schedule: 'scheduleId,name,schemaVersion\nmock,시험 일정,2\n' });

    expect(parsed(lf).name).toBe('시험 일정');
  });

  it('Excel이 붙인 선행 BOM을 값으로 읽지 않는다', () => {
    const withBom = withFile({ schedule: `\uFEFF${bundle.schedule}` });

    expect(parsed(withBom).scheduleId).toBe('mock');
  });

  it('쉼표와 큰따옴표가 든 값을 RFC 4180대로 읽는다', () => {
    const quoted = withFile({
      schedule: 'scheduleId,name,schemaVersion\r\nmock,"A, B와 ""인용""",2\r\n',
    });

    expect(parsed(quoted).name).toBe('A, B와 "인용"');
  });

  it('dependencies.csv가 없으면 선후행이 없는 일정이다', () => {
    const { dependencies: _omitted, ...withoutDependencies } = bundle;

    const schedule = parsed(withoutDependencies);
    expect(schedule.dependencies).toEqual([]);
    expect(schedule.tasks).toHaveLength(4);
  });

  it('lagDays의 빈 칸은 0이고 음수는 그대로 받는다', () => {
    const lags = withFile({
      dependencies: ['predecessorId,successorId,type,lagDays', 'T001,T002,FINISH_START,', ''].join(
        '\r\n',
      ),
    });
    const lead = withFile({
      dependencies: [
        'predecessorId,successorId,type,lagDays',
        'T001,T002,FINISH_START,-3',
        '',
      ].join('\r\n'),
    });

    expect(parsed(lags).dependencies[0]?.lagDays).toBe(0);
    expect(parsed(lead).dependencies[0]?.lagDays).toBe(-3);
  });
});

describe('parseScheduleCsv가 거부하는 표 모양', () => {
  it('정의되지 않은 열은 무시하지 않고 거부한다', () => {
    // 무시하면 오타 난 열 이름이 "값 없음"으로 둔갑한다 (ADR-0007).
    const typo = withFile({
      tasks: ['taskID,name,parentTaskId,start,finish', 'W1,1층 골조,,,', ''].join('\r\n'),
    });

    expect(errorCode(typo)).toBe('schedule.csv.unknown-column');
  });

  it('열이 빠지면 거부한다', () => {
    const missing = withFile({
      tasks: ['taskId,name,parentTaskId,start', 'W1,1층 골조,,', ''].join('\r\n'),
    });

    expect(errorCode(missing)).toBe('schedule.csv.missing-column');
  });

  it('같은 열이 두 번 있으면 거부한다', () => {
    const duplicated = withFile({
      tasks: ['taskId,name,name,parentTaskId,start,finish', 'W1,a,b,,,', ''].join('\r\n'),
    });

    expect(errorCode(duplicated)).toBe('schedule.csv.duplicate-column');
  });

  it('행의 칸 수가 헤더와 다르면 거부한다', () => {
    const ragged = withFile({
      tasks: ['taskId,name,parentTaskId,start,finish', 'W1,1층 골조,,', ''].join('\r\n'),
    });

    expect(errorCode(ragged)).toBe('schedule.csv.ragged-row');
  });

  it('닫히지 않은 큰따옴표를 거부한다', () => {
    const unterminated = withFile({
      schedule: 'scheduleId,name,schemaVersion\r\nmock,"열린 채,2\r\n',
    });

    expect(errorCode(unterminated)).toBe('schedule.csv.unterminated-quote');
  });

  it('빈 파일을 거부한다', () => {
    expect(errorCode(withFile({ tasks: '' }))).toBe('schedule.csv.empty');
  });

  it('schedule.csv의 데이터 행이 1개가 아니면 거부한다', () => {
    const two = withFile({
      schedule: 'scheduleId,name,schemaVersion\r\nmock,A,2\r\nmock2,B,2\r\n',
    });
    const none = withFile({ schedule: 'scheduleId,name,schemaVersion\r\n' });

    expect(errorCode(two)).toBe('schedule.csv.schedule-row-count');
    expect(errorCode(none)).toBe('schedule.csv.schedule-row-count');
  });

  it('schemaVersion이 정수가 아니면 거부한다', () => {
    const text = withFile({ schedule: 'scheduleId,name,schemaVersion\r\nmock,A,v2\r\n' });

    expect(errorCode(text)).toBe('schedule.csv.invalid-schema-version');
  });

  it('lagDays가 정수가 아니면 거부한다', () => {
    const fractional = withFile({
      dependencies: [
        'predecessorId,successorId,type,lagDays',
        'T001,T002,FINISH_START,1.5',
        '',
      ].join('\r\n'),
    });

    expect(errorCode(fractional)).toBe('schedule.csv.invalid-lag');
  });
});

describe('의미 검증은 parseSchedule이 맡는다', () => {
  it('CSV의 잘못된 날짜는 schedule.parse 오류로 나온다', () => {
    const badDate = withFile({
      tasks: ['taskId,name,parentTaskId,start,finish', 'T001,벽,,2026-02-30,2026-03-06', ''].join(
        '\r\n',
      ),
    });

    expect(errorCode(badDate)).toBe('schedule.parse.invalid-date');
  });

  it('CSV의 없는 operation은 schedule.parse 오류로 나온다', () => {
    const badOperation = withFile({
      assignments: [
        'taskId,modelRef,productGlobalId,operation',
        `T001,a.ifc,${WALL_A},BUILD`,
        '',
      ].join('\r\n'),
    });

    expect(errorCode(badOperation)).toBe('schedule.parse.invalid-operation');
  });

  it('CSV의 중복 taskId는 schedule.parse 오류로 나온다', () => {
    const duplicated = withFile({
      tasks: ['taskId,name,parentTaskId,start,finish', 'T001,벽,,,', 'T001,벽 또,,,', ''].join(
        '\r\n',
      ),
    });

    expect(errorCode(duplicated)).toBe('schedule.parse.duplicate-task-id');
  });

  it('schemaVersion 1을 적으면 v1로 읽고 v2로 승격한다', () => {
    // CSV에는 v1 개념이 없지만 값 자체는 막지 않는다. 실질적 차이가 없다 (ADR-0007 결과절).
    const v1 = withFile({
      schedule: 'scheduleId,name,schemaVersion\r\nmock,시험 일정,1\r\n',
      tasks: [
        'taskId,name,parentTaskId,start,finish',
        'T001,벽 A 시공,,2026-03-02,2026-03-06',
        '',
      ].join('\r\n'),
      assignments: [
        'taskId,modelRef,productGlobalId,operation',
        `T001,a.ifc,${WALL_A},CONSTRUCT`,
        '',
      ].join('\r\n'),
      dependencies: 'predecessorId,successorId,type,lagDays\r\n',
    });

    expect(parsed(v1).schemaVersion).toBe(2);
  });
});

describe('serializeScheduleCsv', () => {
  it('선후행이 없어도 파일 넷을 모두 쓴다', () => {
    const { dependencies: _omitted, ...withoutDependencies } = bundle;
    const files = serializeScheduleCsv(parsed(withoutDependencies));

    expect(files.map((file) => file.fileName)).toEqual([
      'schedule.csv',
      'tasks.csv',
      'dependencies.csv',
      'assignments.csv',
    ]);
    // 선후행이 없으면 헤더만 남는다.
    expect(contentOf(files, 'dependencies.csv')).toBe('predecessorId,successorId,type,lagDays\r\n');
  });

  it('CRLF로 쓰고 마지막 줄도 개행으로 닫는다', () => {
    const content = contentOf(serializeScheduleCsv(parsed()), 'schedule.csv');

    expect(content).toBe('scheduleId,name,schemaVersion\r\nmock,시험 일정,2\r\n');
  });

  it('날짜를 다시 YYYY-MM-DD로 쓰고 시간 미정 Task는 빈 칸으로 남긴다', () => {
    const lines = contentOf(serializeScheduleCsv(parsed()), 'tasks.csv').split('\r\n');

    expect(lines[0]).toBe('taskId,name,parentTaskId,start,finish');
    expect(lines).toContain('T001,벽 A 시공,W1,2026-03-02,2026-03-06');
    expect(lines).toContain('T003,검사 (일정 미정),,,');
  });

  it('쉼표·큰따옴표가 든 값만 감싼다', () => {
    const quoted = withFile({
      schedule: 'scheduleId,name,schemaVersion\r\nmock,"A, B와 ""인용""",2\r\n',
    });
    const content = contentOf(serializeScheduleCsv(parsed(quoted)), 'schedule.csv');

    expect(content).toBe('scheduleId,name,schemaVersion\r\nmock,"A, B와 ""인용""",2\r\n');
  });
});

describe('왕복', () => {
  const roundTrip = (schedule: ReturnType<typeof parsed>): ReturnType<typeof parsed> => {
    const files = serializeScheduleCsv(schedule);
    const result = parseScheduleCsv({
      schedule: contentOf(files, 'schedule.csv'),
      tasks: contentOf(files, 'tasks.csv'),
      dependencies: contentOf(files, 'dependencies.csv'),
      assignments: contentOf(files, 'assignments.csv'),
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };

  it('CSV로 내보낸 것을 다시 읽으면 같은 일정이다', () => {
    const original = parsed();

    expect(roundTrip(original)).toEqual(original);
  });

  it('두 번 왕복해도 달라지지 않는다', () => {
    const original = parsed();

    expect(roundTrip(roundTrip(original))).toEqual(original);
  });

  it('쉼표·큰따옴표·개행이 든 값도 무손실로 돌아온다', () => {
    const awkward = withFile({
      schedule:
        'scheduleId,name,schemaVersion\r\nmock,"쉼표, 큰따옴표 ""와"" 줄바꿈\n둘째 줄",2\r\n',
      assignments: [
        'taskId,modelRef,productGlobalId,operation',
        `T001,"모델, 1호.ifc",${WALL_A},CONSTRUCT`,
        `T002,a.ifc,${WALL_B},DEMOLISH`,
        `T003,a.ifc,${WALL_A},MODIFY`,
        '',
      ].join('\r\n'),
    });
    const original = parsed(awkward);

    expect(original.name).toContain('\n');
    expect(roundTrip(original)).toEqual(original);
  });

  it('JSON으로 내보낸 것을 다시 읽어도 같은 일정이다', () => {
    const original = parsed();
    const reread = parseSchedule(JSON.parse(serializeScheduleJson(original)));
    if (!reread.ok) throw new Error(reread.error.message);

    expect(reread.value).toEqual(original);
  });

  it('CSV와 JSON 어느 쪽으로 내보내도 같은 일정으로 돌아온다', () => {
    const original = parsed();
    const viaJson = parseSchedule(JSON.parse(serializeScheduleJson(original)));
    if (!viaJson.ok) throw new Error(viaJson.error.message);

    expect(roundTrip(original)).toEqual(viaJson.value);
  });
});

describe('serializeScheduleJson', () => {
  it('v1으로 읽어 들였어도 v2로 나간다', () => {
    const v1 = parseSchedule({
      scheduleId: 'mock',
      name: '옛 일정',
      schemaVersion: 1,
      tasks: [{ taskId: 'T001', name: '벽 시공', start: '2026-03-02', finish: '2026-03-06' }],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL_A, operation: 'CONSTRUCT' },
      ],
    });
    if (!v1.ok) throw new Error(v1.error.message);

    const written: unknown = JSON.parse(serializeScheduleJson(v1.value));
    expect((written as { schemaVersion: number }).schemaVersion).toBe(2);
  });

  it('날짜를 epoch가 아니라 YYYY-MM-DD로 쓴다', () => {
    const written: unknown = JSON.parse(serializeScheduleJson(parsed()));
    const tasks = (written as { tasks: { taskId: string; start?: string }[] }).tasks;

    expect(tasks.find((task) => task.taskId === 'T001')?.start).toBe('2026-03-02');
  });

  it('시간 미정 Task는 필드를 만들지 않는다', () => {
    const written: unknown = JSON.parse(serializeScheduleJson(parsed()));
    const tasks = (written as { tasks: Record<string, unknown>[] }).tasks;
    const idle = tasks.find((task) => task['taskId'] === 'T003');

    expect(idle).not.toHaveProperty('start');
    expect(idle).not.toHaveProperty('finish');
  });

  it('개행 하나로 파일을 닫는다', () => {
    expect(serializeScheduleJson(parsed()).endsWith('}\n')).toBe(true);
  });
});
