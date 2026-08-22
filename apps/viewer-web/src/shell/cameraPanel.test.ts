// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/camera/cameraEvents.js';
import '../viewer/model/modelEvents.js';

import { createCameraPanel } from './cameraPanel.js';

const markup = `
  <button type="button" data-testid="view-fit" disabled>전체</button>
  <button type="button" data-testid="view-front" disabled>정면</button>
  <button type="button" data-testid="view-top" disabled>평면</button>
  <button type="button" data-testid="view-iso" disabled>등각</button>
`;

const button = (testId: string): HTMLButtonElement => {
  const found = document.querySelector(`[data-testid="${testId}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`button 없음: ${testId}`);
  return found;
};

const startPanel = async (context: TestContext) => {
  const panel = createCameraPanel({
    fitButtonSelector: '[data-testid="view-fit"]',
    viewButtonSelectors: {
      FRONT: '[data-testid="view-front"]',
      TOP: '[data-testid="view-top"]',
      ISO: '[data-testid="view-iso"]',
    },
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const openModel = (context: TestContext, modelId: string): Promise<void> =>
  context.events.publish('model/loaded', {
    modelId: modelId as ModelId,
    displayName: `${modelId}.ifc`,
    schema: 'IFC4',
  });

describe('createCameraPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('모델이 없으면 버튼을 잠가 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(button('view-fit').disabled).toBe(true);
    expect(button('view-top').disabled).toBe(true);
  });

  it('모델이 열리면 버튼을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await openModel(context, 'm1');

    expect(button('view-fit').disabled).toBe(false);
    expect(button('view-iso').disabled).toBe(false);
  });

  it('전체 맞춤 버튼이 fit-view Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() => Promise.resolve({ fitted: true }));
    context.commands.register('viewer/fit-view', handler);
    await startPanel(context);
    await openModel(context, 'm1');

    button('view-fit').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('시점 버튼은 각자의 시점을 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { view: string }) => {
      void input;
      return Promise.resolve({ applied: true });
    });
    context.commands.register('viewer/set-standard-view', handler);
    await startPanel(context);
    await openModel(context, 'm1');

    button('view-top').click();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    button('view-front').click();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(2);
    });

    expect(handler.mock.calls.map((call) => call[0])).toEqual([{ view: 'TOP' }, { view: 'FRONT' }]);
  });

  it('모든 모델을 해제하면 버튼을 다시 잠근다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await openModel(context, 'm1');

    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(button('view-fit').disabled).toBe(true);
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await openModel(context, 'm1');

    expect(button('view-fit').disabled).toBe(true);
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createCameraPanel({
      fitButtonSelector: '[data-testid="view-fit"]',
      viewButtonSelectors: {
        FRONT: '[data-testid="view-front"]',
        TOP: '[data-testid="view-top"]',
        ISO: '[data-testid="view-iso"]',
      },
    });

    await expect(panel.initialize(context)).rejects.toThrow(/view-fit/u);
  });
});
