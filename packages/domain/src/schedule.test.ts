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

const SLAB = '2YsHnV6bk3PgZdL9uCxWtM';

/** 요약 Task 하나와 그 밑의 작업 둘. */
const validV2 = {
  scheduleId: 'mock-v2',
  name: '계층 있는 일정',
  schemaVersion: 2,
  tasks: [
    { taskId: 'W1', name: '1층 골조' },
    {
      taskId: 'T001',
      name: '슬래브',
      parentTaskId: 'W1',
      start: '2026-03-02',
      finish: '2026-03-06',
    },
    { taskId: 'T002', name: '벽', parentTaskId: 'W1', start: '2026-03-09', finish: '2026-03-13' },
  ],
  dependencies: [{ predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 }],
  assignments: [
    { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
  ],
};

/** 정상 v2 일정에서 한 군데만 바꾼 것. */
const changeV2 = (patch: Record<string, unknown>): unknown => ({ ...validV2, ...patch });

describe('parseSchedule — v1 승격', () => {
  it('v1을 읽으면 내부 표현은 v2가 된다', () => {
    const parsed = parseSchedule(valid);
    if (!parsed.ok) throw new Error(parsed.error.message);

    // 읽는 쪽이 버전을 분기하지 않도록 하나로 맞춘다 (ADR-0006).
    expect(parsed.value.schemaVersion).toBe(2);
    expect(parsed.value.dependencies).toEqual([]);
    expect(parsed.value.tasks[0]?.parentTaskId).toBeUndefined();
  });

  it('v1도 v2도 아닌 버전은 거부한다', () => {
    expect(errorCode({ ...valid, schemaVersion: 3 })).toBe('schedule.parse.unsupported-version');
  });
});

describe('parseSchedule — WBS', () => {
  it('parentTaskId를 읽는다', () => {
    const parsed = parseSchedule(validV2);
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.tasks[1]?.parentTaskId).toBe('W1');
  });

  it('없는 상위 Task를 가리키면 거부한다', () => {
    const orphan = changeV2({
      tasks: [{ taskId: 'T001', name: '외톨이', parentTaskId: '없음' }],
      dependencies: [],
      assignments: [],
    });

    expect(errorCode(orphan)).toBe('schedule.parse.unknown-parent-task-id');
  });

  it('계층이 순환하면 거부한다', () => {
    const cyclic = changeV2({
      tasks: [
        { taskId: 'A', name: 'A', parentTaskId: 'B' },
        { taskId: 'B', name: 'B', parentTaskId: 'A' },
      ],
      dependencies: [],
      assignments: [],
    });

    expect(errorCode(cyclic)).toBe('schedule.parse.wbs-cycle');
  });

  it('자기 자신을 상위로 두면 거부한다', () => {
    const selfParent = changeV2({
      tasks: [{ taskId: 'A', name: 'A', parentTaskId: 'A' }],
      dependencies: [],
      assignments: [],
    });

    expect(errorCode(selfParent)).toBe('schedule.parse.wbs-cycle');
  });

  it('요약 Task에 시간이 적혀 있으면 거부한다', () => {
    // 무시하고 계산값을 쓰면 파일 값과 화면 값이 달라진다 (ADR-0006).
    const summaryWithTime = changeV2({
      tasks: [
        { taskId: 'W1', name: '요약', start: '2026-03-02', finish: '2026-03-13' },
        {
          taskId: 'T001',
          name: '작업',
          parentTaskId: 'W1',
          start: '2026-03-02',
          finish: '2026-03-06',
        },
      ],
      dependencies: [],
      assignments: [],
    });

    expect(errorCode(summaryWithTime)).toBe('schedule.parse.summary-task-has-time');
  });

  it('요약 Task에 할당이 걸려 있으면 거부한다', () => {
    const summaryWithAssignment = changeV2({
      dependencies: [],
      assignments: [
        { taskId: 'W1', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
      ],
    });

    expect(errorCode(summaryWithAssignment)).toBe('schedule.parse.summary-task-has-assignment');
  });
});

describe('parseSchedule — 선후행', () => {
  it('유형과 지연을 읽는다', () => {
    const parsed = parseSchedule(validV2);
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.dependencies).toEqual([
      { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 },
    ]);
  });

  it('lagDays를 생략하면 0으로 본다', () => {
    const parsed = parseSchedule(
      changeV2({
        dependencies: [{ predecessorId: 'T001', successorId: 'T002', type: 'START_START' }],
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.dependencies[0]?.lagDays).toBe(0);
  });

  it('음수 지연(lead)을 허용한다', () => {
    const parsed = parseSchedule(
      changeV2({
        dependencies: [
          { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: -2 },
        ],
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.dependencies[0]?.lagDays).toBe(-2);
  });

  it('dependencies를 생략하면 빈 배열로 본다', () => {
    const parsed = parseSchedule(changeV2({ dependencies: undefined }));
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.dependencies).toEqual([]);
  });

  it('네 유형이 아니면 거부한다', () => {
    // IFC의 USERDEFINED / NOTDEFINED는 받지 않는다 (ADR-0006).
    const wrong = changeV2({
      dependencies: [
        { predecessorId: 'T001', successorId: 'T002', type: 'USERDEFINED', lagDays: 0 },
      ],
    });

    expect(errorCode(wrong)).toBe('schedule.parse.invalid-dependency-type');
  });

  it('lagDays가 정수가 아니면 거부한다', () => {
    const wrong = changeV2({
      dependencies: [
        { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 1.5 },
      ],
    });

    expect(errorCode(wrong)).toBe('schedule.parse.invalid-lag');
  });

  it('없는 Task를 가리키면 거부한다', () => {
    const dangling = changeV2({
      dependencies: [
        { predecessorId: 'T001', successorId: '없음', type: 'FINISH_START', lagDays: 0 },
      ],
    });

    expect(errorCode(dangling)).toBe('schedule.parse.unknown-dependency-task-id');
  });

  it('자기 자신을 선행으로 두면 거부한다', () => {
    const loop = changeV2({
      dependencies: [
        { predecessorId: 'T001', successorId: 'T001', type: 'FINISH_START', lagDays: 0 },
      ],
    });

    expect(errorCode(loop)).toBe('schedule.parse.dependency-cycle');
  });

  it('선후행이 순환하면 거부한다', () => {
    const cyclic = changeV2({
      dependencies: [
        { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 },
        { predecessorId: 'T002', successorId: 'T001', type: 'FINISH_START', lagDays: 0 },
      ],
    });

    expect(errorCode(cyclic)).toBe('schedule.parse.dependency-cycle');
  });

  it('같은 쌍에 같은 유형을 두 번 두면 거부한다', () => {
    const duplicated = changeV2({
      dependencies: [
        { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 },
        { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 3 },
      ],
    });

    expect(errorCode(duplicated)).toBe('schedule.parse.duplicate-dependency');
  });

  it('같은 쌍이라도 유형이 다르면 허용한다', () => {
    const parsed = parseSchedule(
      changeV2({
        dependencies: [
          { predecessorId: 'T001', successorId: 'T002', type: 'FINISH_START', lagDays: 0 },
          { predecessorId: 'T001', successorId: 'T002', type: 'START_START', lagDays: 0 },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
  });
});

describe('parseSchedule — 할당 중복', () => {
  const SLAB = '2YsHnV6bk3PgZdL9uCxWtM';

  it('같은 Task에 같은 부재를 두 번 걸면 거부한다', () => {
    // 같은 줄이 둘이면 부재 수가 부풀고 시뮬레이션이 같은 상태를 두 번 센다.
    expect(
      errorCode({
        ...valid,
        assignments: [
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'DEMOLISH' },
        ],
      }),
    ).toBe('schedule.parse.duplicate-assignment');
  });

  it('같은 부재를 다른 Task에 거는 것은 받는다', () => {
    // 시공한 뒤 철거하는 것은 정상이다. 충돌 여부는 경고로 알린다.
    expect(
      errorCode({
        ...valid,
        tasks: [
          { taskId: 'T001', name: '시공', start: '2026-03-02', finish: '2026-03-06' },
          { taskId: 'T002', name: '철거', start: '2026-03-09', finish: '2026-03-13' },
        ],
        assignments: [
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
          { taskId: 'T002', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'DEMOLISH' },
        ],
      }),
    ).toBeUndefined();
  });

  it('다른 모델의 같은 GlobalId는 중복이 아니다', () => {
    expect(
      errorCode({
        ...valid,
        assignments: [
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
          { taskId: 'T001', modelRef: 'b.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
        ],
      }),
    ).toBeUndefined();
  });

  it('같은 Task의 다른 부재는 중복이 아니다', () => {
    expect(
      errorCode({
        ...valid,
        assignments: [
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
          { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
        ],
      }),
    ).toBeUndefined();
  });
});
