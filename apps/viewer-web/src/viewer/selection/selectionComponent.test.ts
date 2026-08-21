// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppEvent, GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';
import '../model/modelEvents.js';

import { createSelectionComponent } from './selectionComponent.js';
import type { SelectionHit, SelectionPort } from './selectionPort.js';

const selector = '[data-testid="viewer-container"]';

const hit = (globalId: string, localId = 1, modelId = 'model-1'): SelectionHit => ({
  modelId: modelId as ModelId,
  globalId: globalId as GlobalId,
  localId,
});

interface FakePort extends SelectionPort {
  next: SelectionHit | null;
  /** `resolve`가 돌려줄 객체. 영구 키로 찾을 수 있는 것만 넣는다. */
  readonly known: SelectionHit[];
  /** 강조 호출 기록. 빈 배열은 강조 해제다. */
  readonly highlighted: (readonly SelectionHit[])[];
  failWith?: Error;
}

const createFakePort = (): FakePort => {
  const port: FakePort = {
    next: null,
    known: [],
    highlighted: [],
    resolve: (products) =>
      Promise.resolve(
        products.flatMap((product) =>
          port.known.filter(
            (item) => item.modelId === product.modelId && item.globalId === product.globalId,
          ),
        ),
      ),
    pickAt: () => {
      if (port.failWith !== undefined) return Promise.reject(port.failWith);
      return Promise.resolve(port.next);
    },
    highlight: (targets) => {
      port.highlighted.push(targets);
      return Promise.resolve();
    },
    clearHighlight: () => {
      port.highlighted.push([]);
      return Promise.resolve();
    },
  };
  return port;
};

const changes = (context: TestContext): AppEvent<'selection/changed'>[] => {
  const received: AppEvent<'selection/changed'>[] = [];
  context.events.subscribe('selection/changed', (event) => {
    received.push(event);
  });
  return received;
};

const clickViewer = async (
  context: TestContext,
  modifiers: { readonly ctrlKey?: boolean } = {},
): Promise<void> => {
  const container = document.querySelector(selector);
  container?.dispatchEvent(
    new MouseEvent('click', {
      clientX: 10,
      clientY: 20,
      bubbles: true,
      ctrlKey: modifiers.ctrlKey ?? false,
    }),
  );
  // DOM 이벤트 처리는 비동기 Command로 이어진다. 마이크로태스크 큐를 비운다.
  await new Promise((resolve) => setTimeout(resolve, 0));
  void context;
};

const setup = async (): Promise<{
  context: TestContext;
  port: FakePort;
  events: AppEvent<'selection/changed'>[];
  component: ReturnType<typeof createSelectionComponent>;
}> => {
  const context = createTestContext();
  const port = createFakePort();
  const events = changes(context);
  const component = createSelectionComponent({ selector, port });
  await component.initialize(context);
  await component.start();
  return { context, port, events, component };
};

describe('createSelectionComponent', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div data-testid="viewer-container"></div>`;
  });

  it('객체를 누르면 selection/changed를 정확히 한 번 발행한다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');

    await clickViewer(context);

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.selected).toEqual([
      { modelId: 'model-1', globalId: '3vB2_1Ks9E1QF$aVJ0Zt_h' },
    ]);
  });

  it('선택한 객체를 강조한다', async () => {
    const { context, port } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');

    await clickViewer(context);

    expect(port.highlighted).toEqual([[hit('3vB2_1Ks9E1QF$aVJ0Zt_h')]]);
  });

  it('같은 객체를 다시 눌러도 Event를 다시 발행하지 않는다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');

    await clickViewer(context);
    await clickViewer(context);

    expect(events).toHaveLength(1);
  });

  it('다른 객체를 누르면 선택을 바꾸고 다시 발행한다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    port.next = hit('0ZQeYb8Yr9UfXcM1kTPvJd', 2);
    await clickViewer(context);

    expect(events.map((event) => event.payload.selected.map((item) => item.globalId))).toEqual([
      ['3vB2_1Ks9E1QF$aVJ0Zt_h'],
      ['0ZQeYb8Yr9UfXcM1kTPvJd'],
    ]);
  });

  it('빈 곳을 누르면 선택을 풀고 null을 발행한다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    port.next = null;
    await clickViewer(context);

    expect(events).toHaveLength(2);
    expect(events[1]?.payload.selected).toEqual([]);
    expect(port.highlighted.at(-1)).toEqual([]);
  });

  it('선택이 없을 때 빈 곳을 눌러도 Event를 발행하지 않는다', async () => {
    const { context, port, events } = await setup();
    port.next = null;

    await clickViewer(context);

    expect(events).toEqual([]);
  });

  it('clear-selection Command는 선택을 풀고 cleared=true를 돌려준다', async () => {
    const { context, port } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    const result = await context.commands.dispatch('viewer/clear-selection', {});

    expect(result).toEqual({ ok: true, value: { cleared: true } });
    expect(port.highlighted.at(-1)).toEqual([]);
  });

  it('선택이 없을 때 clear-selection은 cleared=false를 돌려준다', async () => {
    const { context } = await setup();

    const result = await context.commands.dispatch('viewer/clear-selection', {});

    expect(result).toEqual({ ok: true, value: { cleared: false } });
  });

  it('선택한 모델이 해제되면 선택도 함께 푼다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    await context.events.publish('model/unloaded', { modelId: 'model-1' as ModelId });

    expect(events.at(-1)?.payload.selected).toEqual([]);
  });

  it('다른 모델이 해제되면 선택을 유지한다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    await context.events.publish('model/unloaded', { modelId: 'other' as ModelId });

    expect(events).toHaveLength(1);
  });

  it('집기가 실패하면 Command가 실패를 돌려주고 선택은 그대로 둔다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);
    port.failWith = new Error('raycast 실패');

    const result = await context.commands.dispatch('viewer/select-at', {
      clientX: 5,
      clientY: 5,
    });

    expect(result).toMatchObject({ ok: false });
    expect(events).toHaveLength(1);
  });

  it('dispose하면 강조를 지우고 클릭에 반응하지 않는다', async () => {
    const { context, port, events, component } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    await component.stop();
    await component.dispose();
    await clickViewer(context);

    expect(port.highlighted.at(-1)).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it('Ctrl을 누른 채 다른 객체를 누르면 선택에 더한다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    port.next = hit('0ZQeYb8Yr9UfXcM1kTPvJd', 2);
    await clickViewer(context, { ctrlKey: true });

    expect(events.at(-1)?.payload.selected.map((item) => item.globalId)).toEqual([
      '3vB2_1Ks9E1QF$aVJ0Zt_h',
      '0ZQeYb8Yr9UfXcM1kTPvJd',
    ]);
    expect(port.highlighted.at(-1)).toHaveLength(2);
  });

  it('Ctrl을 누른 채 이미 선택된 객체를 누르면 선택에서 뺀다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);
    port.next = hit('0ZQeYb8Yr9UfXcM1kTPvJd', 2);
    await clickViewer(context, { ctrlKey: true });

    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context, { ctrlKey: true });

    expect(events.at(-1)?.payload.selected.map((item) => item.globalId)).toEqual([
      '0ZQeYb8Yr9UfXcM1kTPvJd',
    ]);
  });

  it('Ctrl을 누른 채 빈 곳을 누르면 선택을 유지한다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    port.next = null;
    await clickViewer(context, { ctrlKey: true });

    expect(events).toHaveLength(1);
  });

  it('여러 개를 고른 뒤 그냥 누르면 하나만 남는다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);
    port.next = hit('0ZQeYb8Yr9UfXcM1kTPvJd', 2);
    await clickViewer(context, { ctrlKey: true });

    await clickViewer(context);

    expect(events.at(-1)?.payload.selected.map((item) => item.globalId)).toEqual([
      '0ZQeYb8Yr9UfXcM1kTPvJd',
    ]);
  });

  it('선택한 모델만 해제되면 다른 모델의 선택은 남는다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h', 1, 'model-1');
    await clickViewer(context);
    port.next = hit('0ZQeYb8Yr9UfXcM1kTPvJd', 2, 'model-2');
    await clickViewer(context, { ctrlKey: true });

    await context.events.publish('model/unloaded', { modelId: 'model-1' as ModelId });

    expect(events.at(-1)?.payload.selected).toEqual([
      { modelId: 'model-2', globalId: '0ZQeYb8Yr9UfXcM1kTPvJd' },
    ]);
  });
  it('영구 키로 고른 객체를 선택하고 강조한다', async () => {
    const { context, port, events } = await setup();
    const wall = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    const slab = hit('0ZQeYb8Yr9UfXcM1kTPvJd', 2);
    port.known.push(wall, slab);

    const products: ProductKey[] = [
      { modelId: wall.modelId, globalId: wall.globalId },
      { modelId: slab.modelId, globalId: slab.globalId },
    ];
    const result = await context.commands.dispatch('viewer/select-products', { products });

    expect(result).toEqual({ ok: true, value: { selected: products } });
    expect(port.highlighted.at(-1)).toEqual([wall, slab]);
    expect(events.at(-1)?.payload.selected).toEqual(products);
  });

  it('화면에 없는 영구 키만 주면 선택을 비운다', async () => {
    const { context, port, events } = await setup();
    port.next = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    await clickViewer(context);

    await context.commands.dispatch('viewer/select-products', {
      products: [{ modelId: 'model-1' as ModelId, globalId: '0ZQeYb8Yr9UfXcM1kTPvJd' as GlobalId }],
    });

    expect(events.at(-1)?.payload.selected).toEqual([]);
    expect(port.highlighted.at(-1)).toEqual([]);
  });

  it('같은 객체를 영구 키로 다시 골라도 Event를 다시 발행하지 않는다', async () => {
    const { context, port, events } = await setup();
    const wall = hit('3vB2_1Ks9E1QF$aVJ0Zt_h');
    port.known.push(wall);
    const products: ProductKey[] = [{ modelId: wall.modelId, globalId: wall.globalId }];

    await context.commands.dispatch('viewer/select-products', { products });
    await context.commands.dispatch('viewer/select-products', { products });

    expect(events).toHaveLength(1);
  });
});
