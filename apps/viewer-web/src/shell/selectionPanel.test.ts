// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { GlobalId, ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/selection/selectionEvents.js';

import { createSelectionPanel } from './selectionPanel.js';

const selector = '[data-testid="selection-globalid"]';
const text = (): string => document.querySelector(selector)?.textContent ?? '';

const startPanel = async (context: TestContext) => {
  const panel = createSelectionPanel({ selector });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const selected = {
  modelId: 'model-1' as ModelId,
  globalId: '0ZQeYb8Yr9UfXcM1kTPvJd' as GlobalId,
};

describe('createSelectionPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `<p data-testid="selection-globalid"></p>`;
  });

  it('선택이 없으면 안내 문구를 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(text()).toBe('선택 없음');
  });

  it('선택하면 GlobalId를 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('selection/changed', { selected });

    expect(text()).toBe('GlobalId: 0ZQeYb8Yr9UfXcM1kTPvJd');
  });

  it('선택을 풀면 안내 문구로 돌아간다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('selection/changed', { selected });
    await context.events.publish('selection/changed', { selected: null });

    expect(text()).toBe('선택 없음');
  });

  it('dispose 후에는 Event를 받아도 바뀌지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await context.events.publish('selection/changed', { selected });

    expect(text()).toBe('선택 없음');
  });

  it('표시할 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createSelectionPanel({ selector });

    await expect(panel.initialize(context)).rejects.toThrow(/selection-globalid/);
  });
});
