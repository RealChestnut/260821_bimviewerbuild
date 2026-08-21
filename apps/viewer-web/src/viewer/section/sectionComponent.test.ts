import { describe, expect, it } from 'vitest';

import type { AppEvent, ModelId } from '@bim4d/contracts';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';
import '../model/modelEvents.js';

import { createSectionComponent } from './sectionComponent.js';
import type { SectionAxis, SectionPort } from './sectionPort.js';

interface FakePort extends SectionPort {
  readonly calls: string[];
  /** 다음 `createAxisPlane`이 돌려줄 값. null이면 만들지 못한 경우다. */
  nextPlaneId: string | null;
  readonly planes: string[];
}

const createFakePort = (): FakePort => {
  const port: FakePort = {
    calls: [],
    nextPlaneId: 'plane-1',
    planes: [],
    createAxisPlane: (axis: SectionAxis) => {
      port.calls.push(`create:${axis}`);
      if (port.nextPlaneId === null) return Promise.resolve(null);

      const planeId = `${port.nextPlaneId}-${String(port.planes.length + 1)}`;
      port.planes.push(planeId);
      return Promise.resolve(planeId);
    },
    remove: (planeId) => {
      port.calls.push(`remove:${planeId}`);
      const index = port.planes.indexOf(planeId);
      if (index < 0) return Promise.resolve(false);

      port.planes.splice(index, 1);
      return Promise.resolve(true);
    },
    removeAll: () => {
      port.calls.push('removeAll');
      const removed = port.planes.length;
      port.planes.length = 0;
      return Promise.resolve(removed);
    },
    setEnabled: (enabled) => {
      port.calls.push(`enabled:${String(enabled)}`);
      return Promise.resolve();
    },
  };
  return port;
};

interface Harness {
  readonly context: TestContext;
  readonly port: FakePort;
  readonly events: AppEvent<'section/changed'>[];
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const port = createFakePort();
  const events: AppEvent<'section/changed'>[] = [];
  context.events.subscribe('section/changed', (event) => {
    events.push(event);
  });

  const component = createSectionComponent({ port });
  await component.initialize(context);
  await component.start();

  return { context, port, events, dispose: () => component.dispose() };
};

describe('createSectionComponent', () => {
  it('축 단면을 만들고 개수를 알린다', async () => {
    const { context, port, events } = await setup();

    const result = await context.commands.dispatch('viewer/create-section', { axis: 'y' });

    expect(result).toEqual({ ok: true, value: { planeId: 'plane-1-1' } });
    expect(port.calls).toEqual(['create:y']);
    expect(events.at(-1)?.payload).toEqual({ count: 1, enabled: true });
  });

  it('모델이 없어 평면을 만들지 못하면 Event를 발행하지 않는다', async () => {
    const { context, port, events } = await setup();
    port.nextPlaneId = null;

    const result = await context.commands.dispatch('viewer/create-section', { axis: 'x' });

    expect(result).toEqual({ ok: true, value: { planeId: null } });
    expect(events).toHaveLength(0);
  });

  it('평면 하나를 지운다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/create-section', { axis: 'x' });
    await context.commands.dispatch('viewer/create-section', { axis: 'z' });

    const result = await context.commands.dispatch('viewer/remove-section', {
      planeId: 'plane-1-1',
    });

    expect(result).toEqual({ ok: true, value: { removed: true } });
    expect(events.at(-1)?.payload).toEqual({ count: 1, enabled: true });
  });

  it('모르는 평면 id는 지우지 않는다', async () => {
    const { context, port } = await setup();
    await context.commands.dispatch('viewer/create-section', { axis: 'x' });

    const result = await context.commands.dispatch('viewer/remove-section', { planeId: 'other' });

    expect(result).toEqual({ ok: true, value: { removed: false } });
    expect(port.calls).toEqual(['create:x']);
  });

  it('전체를 지우면 개수가 0이 된다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/create-section', { axis: 'x' });
    await context.commands.dispatch('viewer/create-section', { axis: 'y' });

    const result = await context.commands.dispatch('viewer/clear-sections', {});

    expect(result).toEqual({ ok: true, value: { removed: 2 } });
    expect(events.at(-1)?.payload).toEqual({ count: 0, enabled: true });
  });

  it('평면이 없으면 전체 지우기가 아무 일도 하지 않는다', async () => {
    const { context, port, events } = await setup();

    const result = await context.commands.dispatch('viewer/clear-sections', {});

    expect(result).toEqual({ ok: true, value: { removed: 0 } });
    expect(port.calls).toEqual([]);
    expect(events).toHaveLength(0);
  });

  it('끄면 평면을 지우지 않고 자르기만 멈춘다', async () => {
    const { context, port, events } = await setup();
    await context.commands.dispatch('viewer/create-section', { axis: 'x' });

    await context.commands.dispatch('viewer/set-sections-enabled', { enabled: false });

    expect(port.planes).toHaveLength(1);
    expect(events.at(-1)?.payload).toEqual({ count: 1, enabled: false });
  });

  it('같은 상태로 다시 켜거나 꺼도 Event를 발행하지 않는다', async () => {
    const { context, events } = await setup();

    await context.commands.dispatch('viewer/set-sections-enabled', { enabled: true });

    expect(events).toHaveLength(0);
  });

  it('꺼 둔 상태에서 새 단면을 만들면 다시 켠다', async () => {
    const { context, port, events } = await setup();
    await context.commands.dispatch('viewer/create-section', { axis: 'x' });
    await context.commands.dispatch('viewer/set-sections-enabled', { enabled: false });

    await context.commands.dispatch('viewer/create-section', { axis: 'y' });

    expect(port.calls.at(-1)).toBe('enabled:true');
    expect(events.at(-1)?.payload).toEqual({ count: 2, enabled: true });
  });

  it('모델을 해제하면 평면을 모두 지운다', async () => {
    const { context, port, events } = await setup();
    await context.commands.dispatch('viewer/create-section', { axis: 'x' });

    await context.events.publish('model/unloaded', { modelId: 'model-1' as ModelId });

    expect(port.planes).toHaveLength(0);
    expect(events.at(-1)?.payload).toEqual({ count: 0, enabled: true });
  });

  it('dispose하면 남은 평면을 지운다', async () => {
    const harness = await setup();
    await harness.context.commands.dispatch('viewer/create-section', { axis: 'x' });

    await harness.dispose();

    expect(harness.port.planes).toHaveLength(0);
    expect(harness.port.calls.at(-1)).toBe('removeAll');
  });
});
