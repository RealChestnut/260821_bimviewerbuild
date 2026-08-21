// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/selection/selectionEvents.js';
import '../viewer/visibility/visibilityEvents.js';

import { createVisibilityPanel } from './visibilityPanel.js';

const markup = `
  <button type="button" data-testid="hide-selected" disabled>숨기기</button>
  <button type="button" data-testid="isolate-selected" disabled>격리</button>
  <button type="button" data-testid="show-all" disabled>전체 표시</button>
  <p data-testid="visibility-status"></p>
`;

const button = (testId: string): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`${testId} missing`);
  return found;
};

const status = (): string =>
  document.querySelector('[data-testid="visibility-status"]')?.textContent ?? '';

const wall: ProductKey = {
  modelId: 'model-1' as ModelId,
  globalId: '0BnKdW4tq7SfUcM3vHxZgR' as GlobalId,
};

const startPanel = async (context: TestContext) => {
  const panel = createVisibilityPanel({
    hideButtonSelector: '[data-testid="hide-selected"]',
    isolateButtonSelector: '[data-testid="isolate-selected"]',
    showAllButtonSelector: '[data-testid="show-all"]',
    statusSelector: '[data-testid="visibility-status"]',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

describe('createVisibilityPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('선택이 없으면 숨기기와 격리를 누를 수 없다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(button('hide-selected').disabled).toBe(true);
    expect(button('isolate-selected').disabled).toBe(true);
  });

  it('선택하면 숨기기와 격리가 열린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('selection/changed', { selected: [wall] });

    expect(button('hide-selected').disabled).toBe(false);
    expect(button('isolate-selected').disabled).toBe(false);
  });

  it('숨기기는 현재 선택으로 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { products: readonly ProductKey[] }) => {
      void input;
      return Promise.resolve({ hiddenCount: 1 });
    });
    context.commands.register('viewer/hide-products', handler);
    await startPanel(context);
    await context.events.publish('selection/changed', { selected: [wall] });

    button('hide-selected').click();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    expect(handler.mock.calls[0]?.[0]).toEqual({ products: [wall] });
  });

  it('격리는 현재 선택으로 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { products: readonly ProductKey[] }) => {
      void input;
      return Promise.resolve({ isolated: true });
    });
    context.commands.register('viewer/isolate-products', handler);
    await startPanel(context);
    await context.events.publish('selection/changed', { selected: [wall] });

    button('isolate-selected').click();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    expect(handler.mock.calls[0]?.[0]).toEqual({ products: [wall] });
  });

  it('감춘 것이 생기면 전체 표시가 열리고 개수를 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('visibility/changed', { hiddenCount: 2, isolated: false });

    expect(button('show-all').disabled).toBe(false);
    expect(status()).toBe('2개 숨김');
  });

  it('격리 중이면 격리 상태를 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('visibility/changed', { hiddenCount: 0, isolated: true });

    expect(button('show-all').disabled).toBe(false);
    expect(status()).toBe('격리 중');
  });

  it('모두 되돌아오면 전체 표시를 다시 잠근다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await context.events.publish('visibility/changed', { hiddenCount: 1, isolated: false });

    await context.events.publish('visibility/changed', { hiddenCount: 0, isolated: false });

    expect(button('show-all').disabled).toBe(true);
    expect(status()).toBe('');
  });

  it('전체 표시 버튼은 show-all Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() => Promise.resolve({ restored: true }));
    context.commands.register('viewer/show-all', handler);
    await startPanel(context);
    await context.events.publish('visibility/changed', { hiddenCount: 1, isolated: false });

    button('show-all').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('dispose 후에는 버튼이 Command를 보내지 않는다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() => Promise.resolve({ restored: true }));
    context.commands.register('viewer/show-all', handler);
    const panel = await startPanel(context);
    await context.events.publish('visibility/changed', { hiddenCount: 1, isolated: false });

    await panel.stop();
    await panel.dispose();
    button('show-all').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).not.toHaveBeenCalled();
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createVisibilityPanel({
      hideButtonSelector: '[data-testid="hide-selected"]',
      isolateButtonSelector: '[data-testid="isolate-selected"]',
      showAllButtonSelector: '[data-testid="show-all"]',
      statusSelector: '[data-testid="visibility-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/hide-selected/);
  });
});
