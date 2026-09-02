import { beforeEach, describe, expect, it } from 'vitest';

import type { GlobalId, ModelFingerprint, ModelId, ScheduleRepositoryPort } from '@bim4d/contracts';

import { createInMemoryModelRefBinding } from '../adapters/inMemoryModelRefBinding.js';
import type { ModelRefBindingRegistry } from '../adapters/inMemoryModelRefBinding.js';
import { createInMemoryScheduleRepository } from '../adapters/inMemoryScheduleRepository.js';
import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/model/modelEvents.js';

import { createModelBindingComponent } from './modelBindingComponent.js';
import { createSchedulerComponent } from './schedulerComponent.js';
import './schedulerEvents.js';

const MODEL = 'm1' as ModelId;
const OTHER = 'm2' as ModelId;

const SLAB = '2YsHnV6bk3PgZdL9uCxWtM' as GlobalId;
const WALL = '0BnKdW4tq7SfUcM3vHxZgR' as GlobalId;

const FP_A: ModelFingerprint = 'a'.repeat(64);
const FP_B: ModelFingerprint = 'b'.repeat(64);

const source = (models: unknown[]): unknown => ({
  scheduleId: 'mock',
  name: '시험 일정',
  schemaVersion: 3,
  models,
  tasks: [{ taskId: 'T001', name: '슬래브', start: '2026-03-02', finish: '2026-03-06' }],
  dependencies: [],
  assignments: [
    { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: SLAB, operation: 'CONSTRUCT' },
    { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
  ],
});

let registry: ModelRefBindingRegistry;
let repository: ScheduleRepositoryPort;
/** 모델 안에 있다고 볼 부재. 교체 때 사라진 것을 세는 데 쓴다. */
let products: readonly GlobalId[];

const startComponents = async (context: TestContext) => {
  const scheduler = createSchedulerComponent({ repository });
  await scheduler.initialize(context);
  await scheduler.start();

  const component = createModelBindingComponent({
    registry,
    repository,
    productsOf: () => Promise.resolve(products),
  });
  await component.initialize(context);
  await component.start();
  return component;
};

const listenChanges = (
  context: TestContext,
): { boundCount: number; replacedRefs: readonly string[] }[] => {
  const seen: { boundCount: number; replacedRefs: readonly string[] }[] = [];
  context.events.subscribe('scheduler/model-binding-changed', ({ payload }) => {
    seen.push(payload);
  });
  return seen;
};

const load = async (
  context: TestContext,
  modelId: ModelId,
  displayName: string,
  fingerprint: ModelFingerprint,
): Promise<void> => {
  await context.events.publish('model/loaded', {
    modelId,
    displayName,
    schema: 'IFC4',
    fingerprint,
  });
};

const openSchedule = async (context: TestContext, models: unknown[] = []): Promise<void> => {
  await context.commands.dispatch('scheduler/load-schedule', { source: source(models) });
};

beforeEach(() => {
  registry = createInMemoryModelRefBinding();
  repository = createInMemoryScheduleRepository();
  products = [SLAB, WALL];
});

describe('createModelBindingComponent — 묶기', () => {
  it('일정이 없으면 모델이 열려도 묶지 않는다', async () => {
    const context = createTestContext();
    await startComponents(context);

    await load(context, MODEL, 'a.ifc', FP_A);

    expect(registry.entries().size).toBe(0);
  });

  it('이름이 같으면 묶는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context);

    await load(context, MODEL, 'a.ifc', FP_A);

    expect(registry.idOf('a.ifc')).toBe(MODEL);
  });

  it('fingerprint가 같으면 이름이 달라도 묶는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);

    await load(context, MODEL, '이름이_바뀐.ifc', FP_A);

    // 파일 이름을 바꿔도 연결이 유지된다 (ADR-0008).
    expect(registry.idOf('a.ifc')).toBe(MODEL);
  });

  it('묶은 뒤에 바뀐 사실을 알린다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context);
    const changes = listenChanges(context);

    await load(context, MODEL, 'a.ifc', FP_A);

    // 처음 묶으면서 fingerprint를 적어 두므로 일정이 바뀌고 한 번 더 묶는다.
    expect(changes.map((change) => change.boundCount)).toEqual([1, 1]);
    expect(changes.every((change) => change.replacedRefs.length === 0)).toBe(true);
  });

  it('처음 묶은 이름의 fingerprint를 적어 둔다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context);

    await load(context, MODEL, 'a.ifc', FP_A);

    // 적어 두지 않으면 어떤 파일이 정본이었는지 끝내 알 수 없고 교체도 감지할 수 없다.
    expect((await repository.get())?.models).toEqual([{ modelRef: 'a.ifc', fingerprint: FP_A }]);
  });

  it('이미 아는 fingerprint는 덮어쓰지 않는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);

    await load(context, MODEL, 'a.ifc', FP_B);

    // 알던 값을 바꾸는 것은 사용자의 결정이다 (ADR-0008).
    expect((await repository.get())?.models).toEqual([{ modelRef: 'a.ifc', fingerprint: FP_A }]);
  });

  it('이름은 같은데 내용이 다르면 교체로 알린다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);
    const changes = listenChanges(context);

    await load(context, MODEL, 'a.ifc', FP_B);

    // 묶기는 한다. 연결을 지키는 것이 목적이고 바뀐 사실은 따로 알린다.
    expect(registry.idOf('a.ifc')).toBe(MODEL);
    expect(changes[0]?.replacedRefs).toEqual(['a.ifc']);
  });

  it('모델이 닫히면 푼다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context);
    await load(context, MODEL, 'a.ifc', FP_A);

    await context.events.publish('model/unloaded', { modelId: MODEL });

    expect(registry.idOf('a.ifc')).toBeNull();
  });

  it('묶이지 않았던 모델이 닫히면 아무 말도 하지 않는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    const changes = listenChanges(context);

    await context.events.publish('model/unloaded', { modelId: OTHER });

    expect(changes).toEqual([]);
  });

  it('모델이 먼저 열리고 일정이 나중에 와도 묶는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await load(context, MODEL, 'a.ifc', FP_A);

    await openSchedule(context);

    expect(registry.idOf('a.ifc')).toBe(MODEL);
  });
});

describe('createModelBindingComponent — 모델 교체 승인', () => {
  const adopt = async (context: TestContext) =>
    context.commands.dispatch('scheduler/adopt-model', { modelRef: 'a.ifc' });

  it('열린 모델의 fingerprint를 일정에 적는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);
    await load(context, MODEL, 'a.ifc', FP_B);

    const result = await adopt(context);

    expect(result.ok).toBe(true);
    expect((await repository.get())?.models).toEqual([{ modelRef: 'a.ifc', fingerprint: FP_B }]);
  });

  it('새 모델에 없는 부재를 돌려준다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);
    await load(context, MODEL, 'a.ifc', FP_B);
    // 새 모델에서 벽이 사라졌다.
    products = [SLAB];

    const result = await adopt(context);

    expect(result.ok && result.value.missing).toEqual([WALL]);
  });

  it('사라진 부재의 연결을 지우지는 않는다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);
    await load(context, MODEL, 'a.ifc', FP_B);
    products = [SLAB];

    await adopt(context);

    // 지우는 것은 사용자의 결정이다. 되돌릴 수 없는 일을 대신 하지 않는다.
    expect((await repository.get())?.assignments).toHaveLength(2);
  });

  it('승인한 뒤에는 교체 경고가 사라진다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);
    await load(context, MODEL, 'a.ifc', FP_B);
    const changes = listenChanges(context);

    await adopt(context);

    expect(changes.at(-1)?.replacedRefs).toEqual([]);
    expect(registry.idOf('a.ifc')).toBe(MODEL);
  });

  it('그 이름에 묶인 모델이 없으면 실패로 돌려준다', async () => {
    const context = createTestContext();
    await startComponents(context);
    await openSchedule(context, [{ modelRef: 'a.ifc', fingerprint: FP_A }]);

    const result = await adopt(context);

    expect(result.ok).toBe(false);
  });
});

describe('createModelBindingComponent — 정리', () => {
  it('stop 뒤에는 Event를 받아도 묶지 않는다', async () => {
    const context = createTestContext();
    const component = await startComponents(context);
    await openSchedule(context);

    await component.stop();
    await load(context, MODEL, 'a.ifc', FP_A);

    expect(registry.entries().size).toBe(0);
  });

  it('dispose하면 묶음을 비운다', async () => {
    const context = createTestContext();
    const component = await startComponents(context);
    await openSchedule(context);
    await load(context, MODEL, 'a.ifc', FP_A);

    await component.stop();
    await component.dispose();

    expect(registry.entries().size).toBe(0);
  });
});
