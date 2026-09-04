// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/model/modelEvents.js';

import { createModelPanel } from './modelPanel.js';

const markup = `
  <input type="file" data-testid="model-file" />
  <button type="button" data-testid="model-unload" disabled>해제</button>
  <p data-testid="model-status"></p>
`;

const status = (): string =>
  document.querySelector('[data-testid="model-status"]')?.textContent ?? '';
const unloadButton = (): HTMLButtonElement => {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="model-unload"]');
  if (button === null) throw new Error('unload button missing');
  return button;
};

const startPanel = async (context: TestContext) => {
  const panel = createModelPanel({
    fileInputSelector: '[data-testid="model-file"]',
    unloadButtonSelector: '[data-testid="model-unload"]',
    statusSelector: '[data-testid="model-status"]',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

describe('createModelPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
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

  it('적재가 끝나면 파일명과 Schema를 표시하고 해제 버튼을 켠다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('model/loaded', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
      schema: 'IFC4',
      fingerprint: '0'.repeat(64),
    });

    expect(status()).toBe('wall.ifc (IFC4)');
    expect(unloadButton().disabled).toBe(false);
  });

  it('적재가 실패하면 이유를 표시하고 해제 버튼은 꺼 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('model/load-failed', {
      displayName: 'bad.ifc',
      reason: 'HEADER 구역에 FILE_SCHEMA가 없다.',
    });

    expect(status()).toBe('bad.ifc 열기 실패: HEADER 구역에 FILE_SCHEMA가 없다.');
    expect(unloadButton().disabled).toBe(true);
  });

  it('해제하면 안내 문구로 돌아가고 버튼을 다시 끈다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('model/loaded', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
      schema: 'IFC4',
      fingerprint: '0'.repeat(64),
    });
    await context.events.publish('model/unloaded', { modelId: 'm1' as ModelId });

    expect(status()).toBe('열린 모델 없음');
    expect(unloadButton().disabled).toBe(true);
  });

  it('해제 버튼은 마지막으로 적재한 모델에 unload Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { modelId: ModelId }) => {
      void input;
      return Promise.resolve({ removed: true });
    });
    context.commands.register('viewer/unload-model', handler);
    await startPanel(context);

    await context.events.publish('model/loaded', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
      schema: 'IFC4',
      fingerprint: '0'.repeat(64),
    });
    unloadButton().click();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });

    expect(handler.mock.calls[0]?.[0]).toEqual({ modelId: 'm1' });
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    document.querySelector('[data-testid="model-status"]')!.textContent = 'untouched';
    await context.events.publish('model/loaded', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
      schema: 'IFC4',
      fingerprint: '0'.repeat(64),
    });

    expect(status()).toBe('untouched');
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

    await context.events.publish('model/loaded', {
      modelId: 'm1' as ModelId,
      displayName: 'wall.ifc',
      schema: 'IFC4',
      fingerprint: '0'.repeat(64),
    });
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

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createModelPanel({
      fileInputSelector: '[data-testid="model-file"]',
      unloadButtonSelector: '[data-testid="model-unload"]',
      statusSelector: '[data-testid="model-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/model-file/);
  });
});
