import { describe, expect, it } from 'vitest';

import type { AppEvent, GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';
import '../model/modelEvents.js';

import { createVisibilityComponent } from './visibilityComponent.js';
import type { VisibilityPort } from './visibilityPort.js';

const product = (globalId: string, modelId = 'model-1'): ProductKey => ({
  modelId: modelId as ModelId,
  globalId: globalId as GlobalId,
});

const wallA = product('0BnKdW4tq7SfUcM3vHxZgR');
const wallB = product('1MjTgR8dp5NkXbC2wFyQsA');

interface FakePort extends VisibilityPort {
  readonly calls: { readonly kind: string; readonly products: readonly ProductKey[] }[];
}

const createFakePort = (): FakePort => {
  const calls: { kind: string; products: readonly ProductKey[] }[] = [];
  return {
    calls,
    hide: (products) => {
      calls.push({ kind: 'hide', products });
      return Promise.resolve();
    },
    show: (products) => {
      calls.push({ kind: 'show', products });
      return Promise.resolve();
    },
    isolate: (products) => {
      calls.push({ kind: 'isolate', products });
      return Promise.resolve();
    },
    showAll: () => {
      calls.push({ kind: 'showAll', products: [] });
      return Promise.resolve();
    },
  };
};

const setup = async (): Promise<{
  context: TestContext;
  port: FakePort;
  events: AppEvent<'visibility/changed'>[];
  dispose: () => Promise<void>;
}> => {
  const context = createTestContext();
  const port = createFakePort();
  const events: AppEvent<'visibility/changed'>[] = [];
  context.events.subscribe('visibility/changed', (event) => {
    events.push(event);
  });

  const component = createVisibilityComponent({ port });
  await component.initialize(context);
  await component.start();

  return { context, port, events, dispose: () => component.dispose() };
};

describe('createVisibilityComponent', () => {
  it('hide Command가 부재를 감추고 개수를 알린다', async () => {
    const { context, port, events } = await setup();

    const result = await context.commands.dispatch('viewer/hide-products', {
      products: [wallA],
    });

    expect(result).toEqual({ ok: true, value: { hiddenCount: 1 } });
    expect(port.calls).toEqual([{ kind: 'hide', products: [wallA] }]);
    expect(events.at(-1)?.payload).toEqual({ hiddenCount: 1, isolated: false });
  });

  it('이미 감춘 부재를 다시 감춰도 개수가 늘지 않는다', async () => {
    const { context, events } = await setup();

    await context.commands.dispatch('viewer/hide-products', { products: [wallA] });
    await context.commands.dispatch('viewer/hide-products', { products: [wallA] });

    expect(events.at(-1)?.payload.hiddenCount).toBe(1);
  });

  it('빈 목록으로 감추면 Adapter를 부르지 않고 Event도 발행하지 않는다', async () => {
    const { context, port, events } = await setup();

    await context.commands.dispatch('viewer/hide-products', { products: [] });

    expect(port.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it('show Command가 감춘 부재를 되돌린다', async () => {
    const { context, port, events } = await setup();
    await context.commands.dispatch('viewer/hide-products', { products: [wallA, wallB] });

    const result = await context.commands.dispatch('viewer/show-products', { products: [wallA] });

    expect(result).toEqual({ ok: true, value: { hiddenCount: 1 } });
    expect(port.calls.at(-1)).toEqual({ kind: 'show', products: [wallA] });
    expect(events.at(-1)?.payload.hiddenCount).toBe(1);
  });

  it('감추지 않은 부재를 보이라고 해도 Adapter를 부르지 않는다', async () => {
    const { context, port } = await setup();

    await context.commands.dispatch('viewer/show-products', { products: [wallA] });

    expect(port.calls).toEqual([]);
  });

  it('isolate Command가 나머지를 감추고 격리 상태를 알린다', async () => {
    const { context, port, events } = await setup();

    const result = await context.commands.dispatch('viewer/isolate-products', {
      products: [wallA],
    });

    expect(result).toEqual({ ok: true, value: { isolated: true } });
    expect(port.calls).toEqual([{ kind: 'isolate', products: [wallA] }]);
    expect(events.at(-1)?.payload).toEqual({ hiddenCount: 0, isolated: true });
  });

  it('빈 목록으로 격리하면 아무것도 하지 않는다', async () => {
    const { context, port, events } = await setup();

    const result = await context.commands.dispatch('viewer/isolate-products', { products: [] });

    expect(result).toEqual({ ok: true, value: { isolated: false } });
    expect(port.calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it('격리는 직접 감춘 목록을 대신한다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/hide-products', { products: [wallA] });

    await context.commands.dispatch('viewer/isolate-products', { products: [wallB] });

    expect(events.at(-1)?.payload).toEqual({ hiddenCount: 0, isolated: true });
  });

  it('show-all이 감춘 것과 격리를 모두 되돌린다', async () => {
    const { context, port, events } = await setup();
    await context.commands.dispatch('viewer/isolate-products', { products: [wallA] });

    const result = await context.commands.dispatch('viewer/show-all', {});

    expect(result).toEqual({ ok: true, value: { restored: true } });
    expect(port.calls.at(-1)?.kind).toBe('showAll');
    expect(events.at(-1)?.payload).toEqual({ hiddenCount: 0, isolated: false });
  });

  it('되돌릴 것이 없으면 show-all은 Adapter를 부르지 않는다', async () => {
    const { context, port } = await setup();

    const result = await context.commands.dispatch('viewer/show-all', {});

    expect(result).toEqual({ ok: true, value: { restored: false } });
    expect(port.calls).toEqual([]);
  });

  it('모델을 해제하면 그 모델의 감춘 목록을 지운다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/hide-products', {
      products: [wallA, product('2YsHnV6bk3PgZdL9uCxWtM', 'model-2')],
    });

    await context.events.publish('model/unloaded', { modelId: 'model-1' as ModelId });

    expect(events.at(-1)?.payload.hiddenCount).toBe(1);
  });

  it('격리 대상 모델이 해제되면 격리를 푼다', async () => {
    const { context, port, events } = await setup();
    await context.commands.dispatch('viewer/isolate-products', { products: [wallA] });

    await context.events.publish('model/unloaded', { modelId: 'model-1' as ModelId });

    expect(port.calls.at(-1)?.kind).toBe('showAll');
    expect(events.at(-1)?.payload).toEqual({ hiddenCount: 0, isolated: false });
  });

  it('관계없는 모델이 해제되면 상태를 그대로 둔다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/hide-products', { products: [wallA] });

    await context.events.publish('model/unloaded', { modelId: 'other' as ModelId });

    expect(events).toHaveLength(1);
  });

  it('dispose는 감춘 것을 되돌린다', async () => {
    const { context, port, dispose } = await setup();
    await context.commands.dispatch('viewer/hide-products', { products: [wallA] });

    await dispose();

    expect(port.calls.at(-1)?.kind).toBe('showAll');
  });
});
