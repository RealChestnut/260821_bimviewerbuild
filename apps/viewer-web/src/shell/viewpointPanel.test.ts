// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/model/modelEvents.js';
import '../viewer/viewpoint/viewpointEvents.js';

import { createViewpointPanel } from './viewpointPanel.js';

const markup = `
  <button type="button" data-testid="viewpoint-save" disabled>시점 저장</button>
  <select data-testid="viewpoint-list" disabled></select>
  <button type="button" data-testid="viewpoint-restore" disabled>복원</button>
  <button type="button" data-testid="viewpoint-remove" disabled>삭제</button>
`;

const button = (testId: string): HTMLButtonElement => {
  const found = document.querySelector(`[data-testid="${testId}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`button 없음: ${testId}`);
  return found;
};

const list = (): HTMLSelectElement => {
  const found = document.querySelector('[data-testid="viewpoint-list"]');
  if (!(found instanceof HTMLSelectElement)) throw new Error('select 없음');
  return found;
};

const startPanel = async (context: TestContext) => {
  const panel = createViewpointPanel({
    saveButtonSelector: '[data-testid="viewpoint-save"]',
    listSelector: '[data-testid="viewpoint-list"]',
    restoreButtonSelector: '[data-testid="viewpoint-restore"]',
    removeButtonSelector: '[data-testid="viewpoint-remove"]',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const openModel = (context: TestContext): Promise<void> =>
  context.events.publish('model/loaded', {
    modelId: 'm1' as ModelId,
    displayName: 'a.ifc',
    schema: 'IFC4',
  });

const publishList = (
  context: TestContext,
  viewpoints: readonly { id: string; name: string }[],
): Promise<void> => context.events.publish('viewpoint/changed', { viewpoints });

describe('createViewpointPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('모델이 없으면 저장 버튼을 잠가 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(button('viewpoint-save').disabled).toBe(true);
    expect(button('viewpoint-restore').disabled).toBe(true);
  });

  it('모델이 열리면 저장 버튼을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await openModel(context);

    expect(button('viewpoint-save').disabled).toBe(false);
  });

  it('저장 버튼이 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() => Promise.resolve({ viewpointId: 'vp-1' }));
    context.commands.register('viewer/save-viewpoint', handler);
    await startPanel(context);
    await openModel(context);

    button('viewpoint-save').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('목록을 받으면 고를 수 있게 채운다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishList(context, [
      { id: 'vp-1', name: '정면' },
      { id: 'vp-2', name: '평면' },
    ]);

    expect([...list().options].map((option) => [option.value, option.textContent])).toEqual([
      ['vp-1', '정면'],
      ['vp-2', '평면'],
    ]);
    expect(list().disabled).toBe(false);
    expect(button('viewpoint-restore').disabled).toBe(false);
  });

  it('복원 버튼은 고른 시점으로 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { viewpointId: string }) => {
      void input;
      return Promise.resolve({ restored: true });
    });
    context.commands.register('viewer/restore-viewpoint', handler);
    await startPanel(context);
    await publishList(context, [
      { id: 'vp-1', name: '정면' },
      { id: 'vp-2', name: '평면' },
    ]);

    list().value = 'vp-2';
    button('viewpoint-restore').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ viewpointId: 'vp-2' });
  });

  it('삭제 버튼은 고른 시점으로 Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { viewpointId: string }) => {
      void input;
      return Promise.resolve({ removed: true });
    });
    context.commands.register('viewer/remove-viewpoint', handler);
    await startPanel(context);
    await publishList(context, [{ id: 'vp-1', name: '정면' }]);

    button('viewpoint-remove').click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ viewpointId: 'vp-1' });
  });

  it('목록이 비면 복원과 삭제를 다시 잠근다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishList(context, [{ id: 'vp-1', name: '정면' }]);

    await publishList(context, []);

    expect(list().options).toHaveLength(0);
    expect(list().disabled).toBe(true);
    expect(button('viewpoint-restore').disabled).toBe(true);
    expect(button('viewpoint-remove').disabled).toBe(true);
  });

  it('목록이 갱신돼도 고르고 있던 시점을 유지한다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishList(context, [
      { id: 'vp-1', name: '정면' },
      { id: 'vp-2', name: '평면' },
    ]);
    list().value = 'vp-2';

    await publishList(context, [
      { id: 'vp-1', name: '정면' },
      { id: 'vp-2', name: '평면' },
      { id: 'vp-3', name: '등각' },
    ]);

    expect(list().value).toBe('vp-2');
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await publishList(context, [{ id: 'vp-1', name: '정면' }]);

    expect(list().options).toHaveLength(0);
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createViewpointPanel({
      saveButtonSelector: '[data-testid="viewpoint-save"]',
      listSelector: '[data-testid="viewpoint-list"]',
      restoreButtonSelector: '[data-testid="viewpoint-restore"]',
      removeButtonSelector: '[data-testid="viewpoint-remove"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/viewpoint-save/u);
  });
});
