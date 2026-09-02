import { beforeEach, describe, expect, it } from 'vitest';

import { parseSchedule } from '@bim4d/domain';
import type { ModelId, ProductKey, ScheduleRepositoryPort } from '@bim4d/contracts';

import { createInMemoryModelRefBinding } from '../adapters/inMemoryModelRefBinding.js';
import { createInMemoryScheduleRepository } from '../adapters/inMemoryScheduleRepository.js';
import { createModelBindingComponent } from '../scheduler/modelBindingComponent.js';
import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import '../viewer/model/modelEvents.js';

import { createSimulationComponent } from './simulationComponent.js';
import type { DisplayStateChange, SimulationViewPort } from './simulationPort.js';

const MODEL = 'm1' as ModelId;
const SLAB = '2YsHnV6bk3PgZdL9uCxWtM';
const WALL_A = '0BnKdW4tq7SfUcM3vHxZgR';
const WALL_B = '1MjTgR8dp5NkXbC2wFyQsA';

const ONE_DAY = 86_400_000;
const day = (value: number): number => Date.UTC(2026, 2, value);

/** 슬래브 시공 → 벽 A 시공 → 벽 B 시공 → 벽 B 철거. */
const scheduleSource = {
  scheduleId: 'mock',
  name: '시험 일정',
  schemaVersion: 1,
  tasks: [
    { taskId: 'T001', name: '슬래브', start: '2026-03-02', finish: '2026-03-06' },
    { taskId: 'T002', name: '벽 A', start: '2026-03-09', finish: '2026-03-13' },
    { taskId: 'T003', name: '벽 B', start: '2026-03-16', finish: '2026-03-20' },
    { taskId: 'T004', name: '벽 B 철거', start: '2026-03-30', finish: '2026-04-01' },
    { taskId: 'T005', name: '준공 검사 (할당 없음)', start: '2026-04-06', finish: '2026-04-08' },
  ],
  assignments: [
    { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
    { taskId: 'T002', modelRef: 'a.ifc', productGlobalId: WALL_A, operation: 'CONSTRUCT' },
    { taskId: 'T003', modelRef: 'a.ifc', productGlobalId: WALL_B, operation: 'CONSTRUCT' },
    { taskId: 'T004', modelRef: 'a.ifc', productGlobalId: WALL_B, operation: 'DEMOLISH' },
  ],
};

interface FakePort extends SimulationViewPort {
  readonly applied: DisplayStateChange[][];
  readonly resets: (readonly ProductKey[])[];
  /** 마지막으로 적용된 부재별 상태. */
  current(): Map<string, string>;
  clear(): void;
}

const createFakePort = (): FakePort => {
  const applied: DisplayStateChange[][] = [];
  const resets: (readonly ProductKey[])[] = [];
  const latest = new Map<string, string>();

  return {
    applied,
    resets,
    apply: (changes) => {
      applied.push([...changes]);
      for (const change of changes) {
        latest.set(`${change.product.modelId}::${change.product.globalId}`, change.state);
      }
      return Promise.resolve();
    },
    reset: (products) => {
      resets.push([...products]);
      return Promise.resolve();
    },
    current: () => new Map(latest),
    clear: () => {
      applied.length = 0;
      resets.length = 0;
    },
  };
};

/** 직접 돌릴 수 있는 재생 틱. */
const createManualTicker = () => {
  let handler: (() => void) | null = null;
  return {
    scheduleTick: (onTick: () => void) => {
      handler = onTick;
      return (): void => {
        handler = null;
      };
    },
    running: (): boolean => handler !== null,
    tick: (): void => handler?.(),
  };
};

let port: FakePort;
let ticker: ReturnType<typeof createManualTicker>;
let repository: ScheduleRepositoryPort;

/**
 * 시뮬레이션은 묶음을 직접 만들지 않는다. 실제 앱과 같게 묶는 Component를 함께 세운다.
 */
const startComponent = async (context: TestContext) => {
  const binding = createInMemoryModelRefBinding();
  const bindingComponent = createModelBindingComponent({ registry: binding });
  await bindingComponent.initialize(context);
  await bindingComponent.start();

  const component = createSimulationComponent({
    port,
    repository,
    binding,
    scheduleTick: ticker.scheduleTick,
  });
  await component.initialize(context);
  await component.start();
  return component;
};

const openModel = async (context: TestContext, displayName = 'a.ifc'): Promise<void> => {
  await context.events.publish('model/loaded', {
    modelId: MODEL,
    displayName,
    schema: 'IFC4',
  });
};

/**
 * 일정을 싣는 것은 Scheduler의 몫이다. 여기서는 보관소에 넣고 바뀌었다고 알리는 것까지가
 * 시뮬레이션이 보는 세상이다.
 */
const loadSchedule = async (
  context: TestContext,
  source: unknown = scheduleSource,
): Promise<void> => {
  const parsed = parseSchedule(source);
  if (!parsed.ok) throw new Error(parsed.error.message);

  await repository.save(parsed.value);
  await context.events.publish('scheduler/schedule-changed', {
    scheduleId: parsed.value.scheduleId,
    name: parsed.value.name,
    tasks: [],
    dependencies: [],
    assignments: [],
    warnings: [],
  });
};

beforeEach(() => {
  port = createFakePort();
  ticker = createManualTicker();
  repository = createInMemoryScheduleRepository();
});

describe('createSimulationComponent — 일정 받아들이기', () => {
  it('타임라인 구간과 시작 시각을 알린다', async () => {
    const context = createTestContext();
    const seen: { start: number; finish: number }[] = [];
    context.events.subscribe('simulation/timeline-changed', ({ payload }) => {
      seen.push({ start: payload.start, finish: payload.finish });
    });
    await startComponent(context);
    await openModel(context);

    await loadSchedule(context);

    expect(seen).toEqual([{ start: day(2), finish: Date.UTC(2026, 3, 8) }]);
  });

  it('시간이 확정된 Task가 하나도 없으면 타임라인을 만들지 않는다', async () => {
    const context = createTestContext();
    const seen: number[] = [];
    context.events.subscribe('simulation/timeline-changed', ({ payload }) => {
      seen.push(payload.start);
    });
    await startComponent(context);
    await openModel(context);

    await loadSchedule(context, {
      ...scheduleSource,
      tasks: [{ taskId: 'T001', name: '미정' }],
      dependencies: [],
      assignments: [
        { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
      ],
    });

    expect(seen).toEqual([]);
    expect(port.applied.flat()).toEqual([]);
  });

  it('모델이 열려 있지 않으면 어떤 부재도 건드리지 않는다', async () => {
    const context = createTestContext();
    await startComponent(context);

    await loadSchedule(context);

    expect(port.applied.flat()).toEqual([]);
  });

  it('모델이 나중에 열려도 그 시점 상태를 적용한다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await loadSchedule(context);
    port.clear();

    await openModel(context);

    // 시작 시각에는 슬래브가 진행 중이고 두 벽은 아직 없다.
    expect(port.current().get(`${MODEL}::${SLAB}`)).toBe('IN_PROGRESS');
    expect(port.current().get(`${MODEL}::${WALL_A}`)).toBe('HIDDEN');
    expect(port.current().get(`${MODEL}::${WALL_B}`)).toBe('HIDDEN');
  });

  it('일정에 없는 모델이 열리면 아무것도 적용하지 않는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await loadSchedule(context);
    port.clear();

    await openModel(context, '다른모델.ifc');

    expect(port.applied.flat()).toEqual([]);
  });
});

describe('createSimulationComponent — 시간 이동', () => {
  const prepared = async () => {
    const context = createTestContext();
    await startComponent(context);
    await openModel(context);
    await loadSchedule(context);
    port.clear();
    return context;
  };

  it('바뀐 부재만 Port에 전달한다', async () => {
    const context = await prepared();

    // 벽 A 시공 중으로 이동한다. 슬래브는 PRESENT로, 벽 A는 IN_PROGRESS로 바뀐다.
    await context.commands.dispatch('simulation/set-time', { time: day(10) });

    const changed = port.applied.flat().map((change) => change.product.globalId);
    expect(new Set(changed)).toEqual(new Set([SLAB, WALL_A]));
  });

  it('바뀐 부재 수를 Event로 알린다', async () => {
    const context = await prepared();
    const counts: number[] = [];
    context.events.subscribe('simulation/states-changed', ({ payload }) => {
      counts.push(payload.changedCount);
    });

    await context.commands.dispatch('simulation/set-time', { time: day(10) });

    expect(counts).toEqual([2]);
  });

  it('같은 시각으로 다시 옮기면 Port를 부르지 않는다', async () => {
    const context = await prepared();
    await context.commands.dispatch('simulation/set-time', { time: day(10) });
    port.clear();

    await context.commands.dispatch('simulation/set-time', { time: day(10) });

    expect(port.applied).toEqual([]);
  });

  it('앞뒤로 오간 뒤 같은 시각이면 상태가 같다', async () => {
    const context = await prepared();
    await context.commands.dispatch('simulation/set-time', { time: day(10) });
    const atDay10 = port.current();

    await context.commands.dispatch('simulation/set-time', { time: Date.UTC(2026, 3, 5) });
    await context.commands.dispatch('simulation/set-time', { time: day(3) });
    await context.commands.dispatch('simulation/set-time', { time: day(10) });

    expect(port.current()).toEqual(atDay10);
  });

  it('시공 후 철거된 부재는 마지막에 사라진다', async () => {
    const context = await prepared();

    await context.commands.dispatch('simulation/set-time', { time: day(25) });
    expect(port.current().get(`${MODEL}::${WALL_B}`)).toBe('PRESENT');

    await context.commands.dispatch('simulation/set-time', { time: Date.UTC(2026, 3, 5) });
    expect(port.current().get(`${MODEL}::${WALL_B}`)).toBe('HIDDEN');
  });

  it('구간 밖 시간은 양 끝으로 자른다', async () => {
    const context = await prepared();
    const times: number[] = [];
    context.events.subscribe('simulation/time-changed', ({ payload }) => {
      times.push(payload.time);
    });

    await context.commands.dispatch('simulation/set-time', { time: day(-100) });
    await context.commands.dispatch('simulation/set-time', { time: Date.UTC(2027, 0, 1) });

    expect(times).toEqual([day(2), Date.UTC(2026, 3, 8)]);
  });

  it('일정이 없으면 시간 이동을 거부한다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('simulation/set-time', { time: day(10) });

    expect(result.ok).toBe(false);
  });
});

describe('createSimulationComponent — 재생', () => {
  const prepared = async () => {
    const context = createTestContext();
    await startComponent(context);
    await openModel(context);
    await loadSchedule(context);
    port.clear();
    return context;
  };

  it('재생하면 틱마다 하루씩 앞으로 간다', async () => {
    const context = await prepared();
    const times: number[] = [];
    context.events.subscribe('simulation/time-changed', ({ payload }) => {
      times.push(payload.time);
    });

    await context.commands.dispatch('simulation/play', {});
    ticker.tick();
    await Promise.resolve();

    expect(times.at(-1)).toBe(day(2) + ONE_DAY);
  });

  it('배속을 올리면 틱당 이동량이 늘어난다', async () => {
    const context = await prepared();
    const times: number[] = [];
    context.events.subscribe('simulation/time-changed', ({ payload }) => {
      times.push(payload.time);
    });

    await context.commands.dispatch('simulation/set-speed', { speed: 4 });
    await context.commands.dispatch('simulation/play', {});
    ticker.tick();
    await Promise.resolve();

    expect(times.at(-1)).toBe(day(2) + 4 * ONE_DAY);
  });

  it('끝에 닿으면 스스로 멈춘다', async () => {
    const context = await prepared();
    const playback: boolean[] = [];
    context.events.subscribe('simulation/playback-changed', ({ payload }) => {
      playback.push(payload.playing);
    });

    await context.commands.dispatch('simulation/set-time', { time: Date.UTC(2026, 3, 7) });
    await context.commands.dispatch('simulation/play', {});
    ticker.tick();
    await Promise.resolve();
    ticker.tick();
    await Promise.resolve();

    expect(playback.at(-1)).toBe(false);
    expect(ticker.running()).toBe(false);
  });

  it('정지하면 틱이 멈춘다', async () => {
    const context = await prepared();

    await context.commands.dispatch('simulation/play', {});
    await context.commands.dispatch('simulation/pause', {});

    expect(ticker.running()).toBe(false);
  });

  it('배속은 0보다 커야 한다', async () => {
    const context = await prepared();

    const result = await context.commands.dispatch('simulation/set-speed', { speed: 0 });

    expect(result.ok).toBe(false);
  });
});

describe('createSimulationComponent — 정리', () => {
  it('모델을 해제하면 그 모델의 부재를 적용 목록에서 지운다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await openModel(context);
    await loadSchedule(context);
    port.clear();

    await context.events.publish('model/unloaded', { modelId: MODEL });
    // 모델이 사라졌으므로 되돌릴 대상도 없다. 다시 열면 처음처럼 적용돼야 한다.
    await openModel(context);

    expect(port.current().get(`${MODEL}::${SLAB}`)).toBe('IN_PROGRESS');
  });

  it('dispose하면 시뮬레이션이 건 표현을 되돌린다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);
    await openModel(context);
    await loadSchedule(context);

    await component.stop();
    await component.dispose();

    expect(
      port.resets
        .flat()
        .map((key) => key.globalId)
        .sort(),
    ).toEqual([SLAB, WALL_A, WALL_B].sort());
  });
});
