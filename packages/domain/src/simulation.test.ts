import { describe, expect, it } from 'vitest';

import type { GlobalId, ModelId, ProductKey, Schedule, TaskId } from '@bim4d/contracts';

import { bindSchedule, computeDisplayStates, scheduleBounds } from './simulation.js';
import type { SimulationAssignment } from './simulation.js';
import { formatProductKey } from './productKey.js';

const MODEL = 'm1' as ModelId;
const WALL = '0BnKdW4tq7SfUcM3vHxZgR' as GlobalId;
const SLAB = '2YsHnV6bk3PgZdL9uCxWtM' as GlobalId;

const product = (globalId: GlobalId): ProductKey => ({ modelId: MODEL, globalId });

/** 2026-03-<day> 00:00 UTC. */
const day = (value: number): number => Date.UTC(2026, 2, value);

const assignment = (overrides: Partial<SimulationAssignment> = {}): SimulationAssignment => ({
  product: product(WALL),
  operation: 'CONSTRUCT',
  start: day(10),
  finish: day(20),
  ...overrides,
});

const stateOf = (
  assignments: readonly SimulationAssignment[],
  time: number,
  key: ProductKey = product(WALL),
): string | undefined => computeDisplayStates(assignments, time).get(formatProductKey(key))?.state;

describe('computeDisplayStates — ADR-0002 파생 규칙', () => {
  // ADR-0002의 표 12칸이 그대로 시험 목록이다.
  const table = [
    { operation: 'CONSTRUCT', before: 'HIDDEN', during: 'IN_PROGRESS', after: 'PRESENT' },
    { operation: 'DEMOLISH', before: 'PRESENT', during: 'IN_PROGRESS', after: 'HIDDEN' },
    { operation: 'TEMPORARY', before: 'HIDDEN', during: 'IN_PROGRESS', after: 'HIDDEN' },
    { operation: 'MODIFY', before: 'PRESENT', during: 'IN_PROGRESS', after: 'PRESENT' },
  ] as const;

  for (const row of table) {
    it(`${row.operation}는 전 ${row.before} / 중 ${row.during} / 후 ${row.after}`, () => {
      const one = [assignment({ operation: row.operation })];

      expect(stateOf(one, day(5))).toBe(row.before);
      expect(stateOf(one, day(15))).toBe(row.during);
      expect(stateOf(one, day(25))).toBe(row.after);
    });
  }

  it('구간은 시작과 종료를 모두 포함한다', () => {
    const one = [assignment()];

    expect(stateOf(one, day(10))).toBe('IN_PROGRESS');
    expect(stateOf(one, day(20))).toBe('IN_PROGRESS');
  });

  it('start와 finish가 같은 Milestone은 그 시각에 IN_PROGRESS다', () => {
    const one = [assignment({ start: day(10), finish: day(10) })];

    expect(stateOf(one, day(9))).toBe('HIDDEN');
    expect(stateOf(one, day(10))).toBe('IN_PROGRESS');
    expect(stateOf(one, day(11))).toBe('PRESENT');
  });

  it('할당이 없는 부재는 결과에 들어가지 않는다', () => {
    const states = computeDisplayStates([assignment()], day(15));

    expect(states.has(formatProductKey(product(SLAB)))).toBe(false);
  });

  it('영구 키가 다르면 서로 다른 부재로 다룬다', () => {
    const other = { modelId: 'm2' as ModelId, globalId: WALL };
    const states = computeDisplayStates(
      [assignment(), assignment({ product: other, operation: 'DEMOLISH' })],
      day(25),
    );

    expect(states.get(formatProductKey(product(WALL)))?.state).toBe('PRESENT');
    expect(states.get(formatProductKey(other))?.state).toBe('HIDDEN');
  });
});

describe('computeDisplayStates — 다중 할당 충돌 해소', () => {
  it('진행 중인 할당이 하나라도 있으면 IN_PROGRESS다', () => {
    const many = [
      assignment({ start: day(1), finish: day(5) }),
      assignment({ operation: 'DEMOLISH', start: day(10), finish: day(20) }),
    ];

    expect(stateOf(many, day(15))).toBe('IN_PROGRESS');
  });

  it('지나간 할당 중 finish가 가장 늦은 것을 쓴다', () => {
    // 시공 후 철거. 25일에는 철거가 끝났으므로 보이지 않아야 한다.
    const many = [
      assignment({ operation: 'CONSTRUCT', start: day(1), finish: day(5) }),
      assignment({ operation: 'DEMOLISH', start: day(10), finish: day(20) }),
    ];

    expect(stateOf(many, day(7))).toBe('PRESENT');
    expect(stateOf(many, day(25))).toBe('HIDDEN');
  });

  it('모든 할당이 미래면 start가 가장 이른 것의 결과를 쓴다', () => {
    const many = [
      assignment({ operation: 'DEMOLISH', start: day(20), finish: day(25) }),
      assignment({ operation: 'CONSTRUCT', start: day(10), finish: day(15) }),
    ];

    // 가장 이른 것이 CONSTRUCT이므로 아직 없는 부재다.
    expect(stateOf(many, day(5))).toBe('HIDDEN');
  });
});

describe('computeDisplayStates — 시뮬레이션 불변식', () => {
  const assignments = [
    assignment({ operation: 'CONSTRUCT', start: day(1), finish: day(5) }),
    assignment({ product: product(SLAB), operation: 'DEMOLISH', start: day(10), finish: day(20) }),
  ];

  it('같은 입력과 시간이면 항상 같은 결과다', () => {
    const first = computeDisplayStates(assignments, day(12));
    const second = computeDisplayStates(assignments, day(12));

    expect([...second]).toEqual([...first]);
  });

  it('시간을 앞뒤로 옮겨도 상태가 누적되지 않는다', () => {
    const direct = computeDisplayStates(assignments, day(3));

    computeDisplayStates(assignments, day(30));
    computeDisplayStates(assignments, day(15));
    const afterWandering = computeDisplayStates(assignments, day(3));

    expect([...afterWandering]).toEqual([...direct]);
  });
});

describe('scheduleBounds', () => {
  it('할당 전체를 덮는 구간을 돌려준다', () => {
    const bounds = scheduleBounds([
      assignment({ start: day(10), finish: day(20) }),
      assignment({ product: product(SLAB), start: day(5), finish: day(15) }),
    ]);

    expect(bounds).toEqual({ start: day(5), finish: day(20) });
  });

  it('할당이 없으면 구간이 없다', () => {
    expect(scheduleBounds([])).toBeNull();
  });
});

describe('bindSchedule', () => {
  const schedule: Schedule = {
    scheduleId: 's1',
    name: '시험 일정',
    schemaVersion: 1,
    tasks: [
      { taskId: 'T001' as TaskId, name: '벽 시공', start: day(10), finish: day(20) },
      { taskId: 'T002' as TaskId, name: '시간 미정' },
    ],
    assignments: [
      {
        taskId: 'T001' as TaskId,
        modelRef: 'a.ifc',
        productGlobalId: WALL,
        operation: 'CONSTRUCT',
      },
      {
        taskId: 'T002' as TaskId,
        modelRef: 'a.ifc',
        productGlobalId: SLAB,
        operation: 'CONSTRUCT',
      },
    ],
  };

  it('modelRef를 적재된 ModelId로 바꾼다', () => {
    const bound = bindSchedule(schedule, new Map([['a.ifc', MODEL]]));

    expect(bound).toEqual([
      { product: product(WALL), operation: 'CONSTRUCT', start: day(10), finish: day(20) },
    ]);
  });

  it('시간이 없는 Task의 할당은 시뮬레이션에서 제외한다', () => {
    const bound = bindSchedule(schedule, new Map([['a.ifc', MODEL]]));

    expect(bound.some((item) => item.product.globalId === SLAB)).toBe(false);
  });

  it('열려 있지 않은 모델의 할당은 제외한다', () => {
    expect(bindSchedule(schedule, new Map())).toEqual([]);
  });
});
