// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/clipping/clippingEvents.js';
import '../viewer/model/modelEvents.js';

import { createClippingPanel } from './clippingPanel.js';

const markup = `
  <button type="button" data-testid="clip-x" disabled>X</button>
  <button type="button" data-testid="clip-y" disabled>Y</button>
  <button type="button" data-testid="clip-z" disabled>Z</button>
  <button type="button" data-testid="clip-clear" disabled>단면 해제</button>
  <p data-testid="clipping-status"></p>
`;

const button = (testId: string): HTMLButtonElement => {
  const found = document.querySelector(`[data-testid="${testId}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`button 없음: ${testId}`);
  return found;
};

const status = (): string =>
  document.querySelector('[data-testid="clipping-status"]')?.textContent ?? '';

const startPanel = async (context: TestContext) => {
  const panel = createClippingPanel({
    axisButtonSelectors: {
      X: '[data-testid="clip-x"]',
      Y: '[data-testid="clip-y"]',
      Z: '[data-testid="clip-z"]',
    },
    clearButtonSelector: '[data-testid="clip-clear"]',
    statusSelector: '[data-testid="clipping-status"]',
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

describe('createClippingPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('모델이 없으면 축 버튼을 잠가 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(button('clip-z').disabled).toBe(true);
    expect(button('clip-clear').disabled).toBe(true);
    expect(status()).toBe('');
  });

  it('모델이 열리면 축 버튼을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await openModel(context, 'm1');

    expect(button('clip-x').disabled).toBe(false);
    expect(button('clip-y').disabled).toBe(false);
    expect(button('clip-z').disabled).toBe(false);
  });

  it('축 버튼은 자기 축으로 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { axis: string }) => {
      void input;
      return Promise.resolve({ planeCount: 1 });
    });
    context.commands.register('viewer/add-clip-plane', handler);
    await startPanel(context);
    await openModel(context, 'm1');

    button('clip-y').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ axis: 'Y' });
  });

  it('평면 개수를 표시하고 해제 버튼을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('clipping/changed', { planeCount: 2 });

    expect(status()).toBe('단면 2개');
    expect(button('clip-clear').disabled).toBe(false);
  });

  it('평면이 없으면 해제 버튼을 다시 잠근다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await context.events.publish('clipping/changed', { planeCount: 1 });

    await context.events.publish('clipping/changed', { planeCount: 0 });

    expect(status()).toBe('');
    expect(button('clip-clear').disabled).toBe(true);
  });

  it('해제 버튼이 전체 해제 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() => Promise.resolve({ removed: true }));
    context.commands.register('viewer/clear-clip-planes', handler);
    await startPanel(context);
    await context.events.publish('clipping/changed', { planeCount: 1 });

    button('clip-clear').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('모든 모델을 해제하면 축 버튼을 다시 잠근다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await openModel(context, 'm1');

    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(button('clip-z').disabled).toBe(true);
  });

  it('모델이 남아 있으면 축 버튼을 열어 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await openModel(context, 'm1');
    await openModel(context, 'm2');

    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(button('clip-z').disabled).toBe(false);
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await context.events.publish('clipping/changed', { planeCount: 3 });

    expect(status()).toBe('');
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createClippingPanel({
      axisButtonSelectors: {
        X: '[data-testid="clip-x"]',
        Y: '[data-testid="clip-y"]',
        Z: '[data-testid="clip-z"]',
      },
      clearButtonSelector: '[data-testid="clip-clear"]',
      statusSelector: '[data-testid="clipping-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/clip-x/u);
  });
});
