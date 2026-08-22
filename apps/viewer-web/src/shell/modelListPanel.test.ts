// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/model/modelEvents.js';
import '../viewer/visibility/visibilityEvents.js';

import { createModelListPanel } from './modelListPanel.js';

const selector = '[data-testid="model-list"]';
const markup = `<div data-testid="model-list"></div>`;

const first = 'model-1' as ModelId;
const second = 'model-2' as ModelId;

const names = (): string[] =>
  [...document.querySelectorAll('[data-testid="model-name"]')].map(
    (element) => element.textContent,
  );

const toggle = (modelId: ModelId): HTMLInputElement => {
  const found = document.querySelector<HTMLInputElement>(
    `[data-testid="model-visible"][data-model-id="${modelId}"]`,
  );
  if (found === null) throw new Error(`표시 상자를 찾지 못했다: ${modelId}`);
  return found;
};

interface Harness {
  readonly context: TestContext;
  readonly calls: { readonly name: string; readonly input: unknown }[];
  readonly load: (modelId: ModelId, displayName: string) => Promise<void>;
  readonly setHiddenModels: (hiddenModels: readonly ModelId[]) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const calls: { name: string; input: unknown }[] = [];

  context.commands.register('viewer/set-model-visible', (input) => {
    calls.push({ name: 'set-model-visible', input });
    return Promise.resolve({ visible: input.visible });
  });
  context.commands.register('viewer/unload-model', (input) => {
    calls.push({ name: 'unload-model', input });
    return Promise.resolve({ removed: true });
  });

  const panel = createModelListPanel({ selector });
  await panel.initialize(context);
  await panel.start();

  return {
    context,
    calls,
    load: (modelId, displayName) =>
      context.events.publish('model/loaded', { modelId, displayName, schema: 'IFC4' }),
    setHiddenModels: (hiddenModels) =>
      context.events.publish('visibility/changed', {
        hiddenCount: 0,
        isolated: false,
        hidden: [],
        isolatedProducts: [],
        hiddenModels,
      }),
    dispose: () => panel.dispose(),
  };
};

beforeEach(() => {
  document.body.innerHTML = markup;
});

describe('createModelListPanel', () => {
  it('모델이 없으면 빈 상태를 보여 준다', async () => {
    await setup();

    expect(document.querySelector(selector)?.textContent).toBe('열린 모델 없음');
  });

  it('여러 모델을 연 순서대로 나열한다', async () => {
    const harness = await setup();

    await harness.load(first, '구조.ifc');
    await harness.load(second, '설비.ifc');

    expect(names()).toEqual(['구조.ifc', '설비.ifc']);
  });

  it('표시 상자를 끄면 그 모델만 감추기를 요청한다', async () => {
    const harness = await setup();
    await harness.load(first, '구조.ifc');
    await harness.load(second, '설비.ifc');

    const box = toggle(second);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(harness.calls).toEqual([
      { name: 'set-model-visible', input: { modelId: second, visible: false } },
    ]);
  });

  it('감춰진 모델의 표시 상자는 꺼진 채로 그린다', async () => {
    const harness = await setup();
    await harness.load(first, '구조.ifc');
    await harness.load(second, '설비.ifc');

    await harness.setHiddenModels([second]);

    expect(toggle(first).checked).toBe(true);
    expect(toggle(second).checked).toBe(false);
  });

  it('해제 버튼이 그 모델의 해제를 요청한다', async () => {
    const harness = await setup();
    await harness.load(first, '구조.ifc');

    document.querySelector<HTMLButtonElement>('[data-testid="model-remove"]')?.click();
    await Promise.resolve();

    expect(harness.calls).toEqual([{ name: 'unload-model', input: { modelId: first } }]);
  });

  it('해제된 모델은 목록에서 빠진다', async () => {
    const harness = await setup();
    await harness.load(first, '구조.ifc');
    await harness.load(second, '설비.ifc');

    await harness.context.events.publish('model/unloaded', { modelId: first });

    expect(names()).toEqual(['설비.ifc']);
  });

  it('마지막 모델을 해제하면 빈 상태로 돌아간다', async () => {
    const harness = await setup();
    await harness.load(first, '구조.ifc');

    await harness.context.events.publish('model/unloaded', { modelId: first });

    expect(document.querySelector(selector)?.textContent).toBe('열린 모델 없음');
  });

  it('dispose하면 목록을 비운다', async () => {
    const harness = await setup();
    await harness.load(first, '구조.ifc');

    await harness.dispose();

    expect(document.querySelector(selector)?.textContent).toBe('');
  });
});
