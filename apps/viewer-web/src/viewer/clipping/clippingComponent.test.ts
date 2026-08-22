import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';
import '../model/modelEvents.js';

import { createClippingComponent } from './clippingComponent.js';
import type { ClipAxis, ClippingPort } from './clippingPort.js';

interface FakePort extends ClippingPort {
  readonly added: ClipAxis[];
  removeAllCalls: number;
  /** 다음 addAxisPlane이 실패하게 만든다. */
  refuse: boolean;
}

const createFakePort = (): FakePort => {
  const port: FakePort = {
    added: [],
    removeAllCalls: 0,
    refuse: false,
    addAxisPlane: (axis) => {
      if (port.refuse) return Promise.resolve(null);
      port.added.push(axis);
      return Promise.resolve(`plane-${String(port.added.length)}`);
    },
    removeAll: () => {
      port.removeAllCalls += 1;
      return Promise.resolve();
    },
  };
  return port;
};

let port: FakePort;

const startComponent = async (context: TestContext) => {
  const component = createClippingComponent({ port });
  await component.initialize(context);
  await component.start();
  return component;
};

const openModel = (context: TestContext, modelId: string): Promise<void> =>
  context.events.publish('model/loaded', {
    modelId: modelId as ModelId,
    displayName: `${modelId}.ifc`,
    schema: 'IFC4',
  });

const planeCounts = (context: TestContext): number[] => {
  const seen: number[] = [];
  context.events.subscribe('clipping/changed', ({ payload }) => {
    seen.push(payload.planeCount);
  });
  return seen;
};

beforeEach(() => {
  port = createFakePort();
});

describe('createClippingComponent', () => {
  it('평면을 추가하면 개수를 Event로 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const counts = planeCounts(context);

    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });
    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'X' });

    expect(counts).toEqual([1, 2]);
  });

  it('축을 그대로 Port에 넘긴다', async () => {
    const context = createTestContext();
    await startComponent(context);

    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Y' });

    expect(port.added).toEqual(['Y']);
  });

  it('Port가 평면을 만들지 못하면 개수가 늘지 않는다', async () => {
    // 모델이 없으면 자를 대상이 없다. 개수만 늘려 두면 화면과 어긋난다.
    const context = createTestContext();
    await startComponent(context);
    const counts = planeCounts(context);
    port.refuse = true;

    const result = await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });

    expect(result.ok && result.value.planeCount).toBe(0);
    expect(counts).toEqual([]);
  });

  it('전체 해제하면 개수가 0으로 돌아간다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });
    const counts = planeCounts(context);

    const result = await context.commands.dispatch('viewer/clear-clip-planes', {});

    expect(result.ok && result.value.removed).toBe(true);
    expect(counts).toEqual([0]);
    expect(port.removeAllCalls).toBe(1);
  });

  it('평면이 없을 때 전체 해제는 Port를 부르지 않는다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('viewer/clear-clip-planes', {});

    expect(result.ok && result.value.removed).toBe(false);
    expect(port.removeAllCalls).toBe(0);
  });

  it('마지막 모델을 해제하면 평면도 함께 정리한다', async () => {
    // 평면은 모델 크기를 기준으로 놓았다. 자를 것이 없어지면 남겨 둘 이유가 없다.
    const context = createTestContext();
    await startComponent(context);
    await openModel(context, 'm1');
    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });
    const counts = planeCounts(context);

    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(counts).toEqual([0]);
    expect(port.removeAllCalls).toBe(1);
  });

  it('다른 모델이 남아 있으면 평면을 유지한다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await openModel(context, 'm1');
    await openModel(context, 'm2');
    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });

    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(port.removeAllCalls).toBe(0);
  });

  it('dispose하면 평면을 정리한다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);
    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });

    await component.stop();
    await component.dispose();

    expect(port.removeAllCalls).toBe(1);
  });

  it('stop한 뒤에는 모델 해제 Event를 받지 않는다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);
    await openModel(context, 'm1');
    await context.commands.dispatch('viewer/add-clip-plane', { axis: 'Z' });

    await component.stop();
    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(port.removeAllCalls).toBe(0);
  });
});

describe('createClippingComponent — 생명주기', () => {
  it('initialize 전에는 Command를 처리하지 않는다', () => {
    const component = createClippingComponent({ port });
    expect(() => component.start()).toThrow(/initialize/u);
  });

  it('두 번 start해도 Command 등록은 한 번이다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);

    // 같은 Command를 두 번 등록하면 Dispatcher가 즉시 실패한다. 다시 start해도 조용해야 한다.
    await component.stop();
    await expect(component.start()).resolves.toBeUndefined();

    const result = await context.commands.dispatch('viewer/add-clip-plane', { axis: 'X' });
    expect(result.ok && result.value.planeCount).toBe(1);
  });
});
