// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/model/modelEvents.js';

import { createModelPanel } from './modelPanel.js';

const markup = `
  <input type="file" data-testid="model-file" />
  <ul data-testid="model-list"></ul>
  <p data-testid="model-status"></p>
`;

const status = (): string =>
  document.querySelector('[data-testid="model-status"]')?.textContent ?? '';

/** 목록에 보이는 모델 이름을 화면 순서대로 읽는다. */
const listedNames = (): string[] =>
  [...document.querySelectorAll('[data-testid="model-name"]')].map(
    (element) => element.textContent,
  );

const unloadButtons = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-testid="model-unload"]'),
];

const startPanel = async (context: TestContext) => {
  const panel = createModelPanel({
    fileInputSelector: '[data-testid="model-file"]',
    listSelector: '[data-testid="model-list"]',
    statusSelector: '[data-testid="model-status"]',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const publishLoaded = async (
  context: TestContext,
  modelId: string,
  displayName: string,
): Promise<void> => {
  await context.events.publish('model/loaded', {
    modelId: modelId as ModelId,
    displayName,
    schema: 'IFC4',
  });
};

describe('createModelPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('열린 모델이 없으면 안내 문구를 보여 주고 목록은 비어 있다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(status()).toBe('열린 모델 없음');
    expect(listedNames()).toEqual([]);
  });

  it('적재 진행률을 백분율로 표시한다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('model/load-started', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
    });
    await context.events.publish('model/load-progress', {
      modelId: 'm1' as ModelId,
      fraction: 0.42,
    });

    expect(status()).toBe('wall.ifc 여는 중… 42%');
  });

  it('적재가 끝나면 목록에 파일명과 Schema를 담은 줄이 생긴다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');

    expect(listedNames()).toEqual(['wall.ifc (IFC4)']);
    expect(status()).toBe('모델 1개');
  });

  it('여러 모델을 열면 적재한 순서대로 목록에 쌓인다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    await publishLoaded(context, 'm2', 'slab.ifc');

    expect(listedNames()).toEqual(['wall.ifc (IFC4)', 'slab.ifc (IFC4)']);
    expect(status()).toBe('모델 2개');
  });

  it('줄마다 자기 모델의 modelId로 unload Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { modelId: ModelId }) => {
      void input;
      return Promise.resolve({ removed: true });
    });
    context.commands.register('viewer/unload-model', handler);
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    await publishLoaded(context, 'm2', 'slab.ifc');
    // 첫 줄이 아니라 둘째 줄을 눌러야 둘째 모델이 해제된다.
    unloadButtons()[1]?.click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ modelId: 'm2' });
  });

  it('한 모델을 해제하면 그 줄만 사라진다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    await publishLoaded(context, 'm2', 'slab.ifc');
    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(listedNames()).toEqual(['slab.ifc (IFC4)']);
    expect(status()).toBe('모델 1개');
  });

  it('모두 해제하면 안내 문구로 돌아간다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(listedNames()).toEqual([]);
    expect(status()).toBe('열린 모델 없음');
  });

  it('같은 modelId가 다시 적재되어도 줄이 늘어나지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    await publishLoaded(context, 'm1', 'wall.ifc');

    expect(listedNames()).toEqual(['wall.ifc (IFC4)']);
  });

  it('적재가 실패하면 이유를 표시하고 이미 열린 목록은 건드리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    await context.events.publish('model/load-failed', {
      displayName: 'bad.ifc',
      reason: 'HEADER 구역에 FILE_SCHEMA가 없다.',
    });

    expect(status()).toBe('bad.ifc 열기 실패: HEADER 구역에 FILE_SCHEMA가 없다.');
    expect(listedNames()).toEqual(['wall.ifc (IFC4)']);
  });

  it('해제 Command가 실패하면 이유를 표시한다', async () => {
    const context = createTestContext();
    context.commands.register('viewer/unload-model', () => {
      throw new Error('해제할 수 없다');
    });
    await startPanel(context);

    await publishLoaded(context, 'm1', 'wall.ifc');
    unloadButtons()[0]?.click();

    await vi.waitFor(() => {
      expect(status()).toContain('모델 해제 실패');
    });
  });

  it('적재하는 동안에는 파일 선택을 막고 끝나면 다시 연다', async () => {
    const context = createTestContext();
    await startPanel(context);
    const input = document.querySelector<HTMLInputElement>('[data-testid="model-file"]')!;

    await context.events.publish('model/load-started', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
    });
    expect(input.disabled).toBe(true);

    await publishLoaded(context, 'm1', 'wall.ifc');
    expect(input.disabled).toBe(false);
  });

  it('적재가 실패해도 파일 선택을 다시 연다', async () => {
    const context = createTestContext();
    await startPanel(context);
    const input = document.querySelector<HTMLInputElement>('[data-testid="model-file"]')!;

    await context.events.publish('model/load-started', {
      modelId: 'm1' as ModelId,
      displayName: 'bad.ifc',
    });
    await context.events.publish('model/load-failed', { displayName: 'bad.ifc', reason: '오류' });

    expect(input.disabled).toBe(false);
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    document.querySelector('[data-testid="model-status"]')!.textContent = 'untouched';
    await publishLoaded(context, 'm1', 'wall.ifc');

    expect(status()).toBe('untouched');
    expect(listedNames()).toEqual([]);
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createModelPanel({
      fileInputSelector: '[data-testid="model-file"]',
      listSelector: '[data-testid="model-list"]',
      statusSelector: '[data-testid="model-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/model-file/);
  });
});
