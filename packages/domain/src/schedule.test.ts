import { describe, expect, it } from 'vitest';

import { parseSchedule } from './schedule.js';

const WALL = '0BnKdW4tq7SfUcM3vHxZgR';

const valid = {
  scheduleId: 'mock',
  name: '시험 일정',
  schemaVersion: 1,
  tasks: [{ taskId: 'T001', name: '벽 시공', start: '2026-03-02', finish: '2026-03-06' }],
  assignments: [
    { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
  ],
};

/** 정상 일정에서 한 군데만 바꾼 것. */
const withTask = (task: Record<string, unknown>): unknown => ({
  ...valid,
  tasks: [{ ...valid.tasks[0], ...task }],
});

const errorCode = (raw: unknown): string | undefined => {
  const parsed = parseSchedule(raw);
  return parsed.ok ? undefined : parsed.error.code;
};

describe('parseSchedule', () => {
  it('날짜를 UTC 자정의 epoch milliseconds로 바꾼다', () => {
    const parsed = parseSchedule(valid);
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.tasks[0]?.start).toBe(Date.UTC(2026, 2, 2));
    expect(parsed.value.tasks[0]?.finish).toBe(Date.UTC(2026, 2, 6));
  });

  it('할당을 그대로 담는다', () => {
    const parsed = parseSchedule(valid);
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.assignments).toEqual([
      { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
    ]);
  });

  it('시간이 없는 Task도 오류가 아니다', () => {
    // IfcTask가 없는 파일이 정상 경로이듯, 시간 미정 Task도 정상 입력이다.
    const parsed = parseSchedule(withTask({ start: undefined, finish: undefined }));
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.tasks[0]?.start).toBeUndefined();
    expect(parsed.value.tasks[0]?.finish).toBeUndefined();
  });

  it('모르는 schemaVersion은 거부한다', () => {
    expect(errorCode({ ...valid, schemaVersion: 2 })).toBe('schedule.parse.unsupported-version');
  });

  it('JSON 객체가 아니면 거부한다', () => {
    expect(errorCode('일정')).toBe('schedule.parse.not-an-object');
    expect(errorCode(null)).toBe('schedule.parse.not-an-object');
  });

  it('날짜 형식이 YYYY-MM-DD가 아니면 거부한다', () => {
    expect(errorCode(withTask({ start: '2026/03/02' }))).toBe('schedule.parse.invalid-date');
    expect(errorCode(withTask({ start: '2026-13-02' }))).toBe('schedule.parse.invalid-date');
  });

  it('완료가 시작보다 이르면 거부한다', () => {
    expect(errorCode(withTask({ start: '2026-03-06', finish: '2026-03-02' }))).toBe(
      'schedule.parse.finish-before-start',
    );
  });

  it('taskId가 중복이면 거부한다', () => {
    const duplicated = {
      ...valid,
      tasks: [valid.tasks[0], { ...valid.tasks[0], name: '다른 이름' }],
    };

    expect(errorCode(duplicated)).toBe('schedule.parse.duplicate-task-id');
  });

  it('할당이 없는 Task를 가리키면 거부한다', () => {
    const dangling = {
      ...valid,
      assignments: [{ ...valid.assignments[0], taskId: 'T999' }],
    };

    expect(errorCode(dangling)).toBe('schedule.parse.unknown-task-id');
  });

  it('4D 어휘에 없는 operation은 거부한다', () => {
    // 기준서 19.2절의 SHOW/HIDE/REMOVE는 폐기된 표기다 (ADR-0002).
    const wrong = { ...valid, assignments: [{ ...valid.assignments[0], operation: 'SHOW' }] };

    expect(errorCode(wrong)).toBe('schedule.parse.invalid-operation');
  });

  it('GlobalId 형식이 아니면 거부한다', () => {
    const wrong = {
      ...valid,
      assignments: [{ ...valid.assignments[0], productGlobalId: '너무-짧다' }],
    };

    expect(errorCode(wrong)).toBe('identity.global-id.invalid-length');
  });

  it('tasks가 배열이 아니면 거부한다', () => {
    expect(errorCode({ ...valid, tasks: {} })).toBe('schedule.parse.invalid-tasks');
  });
});
