// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/camera/cameraEvents.js';
import '../viewer/viewpoint/viewpointEvents.js';

import { createViewpointPanel } from './viewpointPanel.js';

const markup = `
  <button type="button" data-testid="viewpoint-save">시점 저장</button>
  <button type="button" data-testid="camera-fit">화면 맞춤</button>
  <div data-testid="viewpoint-list"></div>
`;

const options = {
  saveButtonSelector: '[data-testid="viewpoint-save"]',
  fitButtonSelector: '[data-testid="camera-fit"]',
  listSelector: '[data-testid="viewpoint-list"]',
};

const button = (testId: string): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`${testId} missing`);
  return found;
};

const listText = (): string =>
  document.querySelector('[data-testid="viewpoint-list"]')?.textContent ?? '';

const restoreButtons = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-testid="viewpoint-restore"]'),
];

interface Harness {
  readonly context: TestContext;
  readonly calls: { readonly name: string; readonly id?: string }[];
  readonly publish: (
    items: readonly { readonly id: string; readonly name: string }[],
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const calls: { name: string; id?: string }[] = [];

  context.commands.register('viewer/save-viewpoint', () => {
    calls.push({ name: 'save' });
    return Promise.resolve({ id: 'vp-1', name: '시점 1' });
  });
  context.commands.register('viewer/restore-viewpoint', ({ id }) => {
    calls.push({ name: 'restore', id });
    return Promise.resolve({ restored: true });
  });
  context.commands.register('viewer/delete-viewpoint', ({ id }) => {
    calls.push({ name: 'delete', id });
    return Promise.resolve({ deleted: true });
  });
  context.commands.register('viewer/fit-camera', () => {
    calls.push({ name: 'fit' });
    return Promise.resolve({ fitted: true });
  });

  const panel = createViewpointPanel(options);
  await panel.initialize(context);
  await panel.start();

  return {
    context,
    calls,
    publish: (items) => context.events.publish('viewpoint/changed', { items }),
    dispose: () => panel.dispose(),
  };
};

beforeEach(() => {
  document.body.innerHTML = markup;
});

describe('createViewpointPanel', () => {
  it('저장한 시점이 없으면 빈 상태를 보여 준다', async () => {
    await setup();

    expect(listText()).toBe('저장한 시점 없음');
  });

  it('저장 버튼이 저장 Command를 보낸다', async () => {
    const harness = await setup();

    button('viewpoint-save').click();
    await Promise.resolve();

    expect(harness.calls).toEqual([{ name: 'save' }]);
  });

  it('화면 맞춤 버튼이 카메라 Command를 보낸다', async () => {
    const harness = await setup();

    button('camera-fit').click();
    await Promise.resolve();

    expect(harness.calls).toEqual([{ name: 'fit' }]);
  });

  it('저장한 시점을 이름으로 나열한다', async () => {
    const harness = await setup();

    await harness.publish([
      { id: 'vp-1', name: '시점 1' },
      { id: 'vp-2', name: '3층 배관' },
    ]);

    expect(restoreButtons().map((item) => item.textContent)).toEqual(['시점 1', '3층 배관']);
  });

  it('시점 이름을 누르면 되살리기를 요청한다', async () => {
    const harness = await setup();
    await harness.publish([{ id: 'vp-2', name: '3층 배관' }]);

    restoreButtons()[0]?.click();
    await Promise.resolve();

    expect(harness.calls).toEqual([{ name: 'restore', id: 'vp-2' }]);
  });

  it('삭제 버튼이 그 시점의 삭제를 요청한다', async () => {
    const harness = await setup();
    await harness.publish([{ id: 'vp-2', name: '3층 배관' }]);

    document.querySelector<HTMLButtonElement>('[data-testid="viewpoint-delete"]')?.click();
    await Promise.resolve();

    expect(harness.calls).toEqual([{ name: 'delete', id: 'vp-2' }]);
  });

  it('목록이 비면 빈 상태로 돌아간다', async () => {
    const harness = await setup();
    await harness.publish([{ id: 'vp-1', name: '시점 1' }]);

    await harness.publish([]);

    expect(listText()).toBe('저장한 시점 없음');
  });

  it('dispose하면 목록을 비우고 버튼이 Command를 보내지 않는다', async () => {
    const harness = await setup();
    await harness.publish([{ id: 'vp-1', name: '시점 1' }]);

    await harness.dispose();
    button('viewpoint-save').click();
    await Promise.resolve();

    expect(listText()).toBe('');
    expect(harness.calls).toEqual([]);
  });
});
