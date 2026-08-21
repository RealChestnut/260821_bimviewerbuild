// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppCommandInput } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/section/sectionEvents.js';

import { createSectionPanel } from './sectionPanel.js';

const markup = `
  <button type="button" data-testid="section-axis" data-axis="x">X 단면</button>
  <button type="button" data-testid="section-axis" data-axis="y">Y 단면</button>
  <button type="button" data-testid="section-axis" data-axis="z">Z 단면</button>
  <button type="button" data-testid="section-toggle" disabled>단면 끄기</button>
  <button type="button" data-testid="section-clear" disabled>단면 해제</button>
  <p data-testid="section-status"></p>
`;

const options = {
  axisButtonSelector: '[data-testid="section-axis"]',
  toggleButtonSelector: '[data-testid="section-toggle"]',
  clearButtonSelector: '[data-testid="section-clear"]',
  statusSelector: '[data-testid="section-status"]',
};

const button = (testId: string, axis?: string): HTMLButtonElement => {
  const selector =
    axis === undefined
      ? `[data-testid="${testId}"]`
      : `[data-testid="${testId}"][data-axis="${axis}"]`;
  const found = document.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`${testId} missing`);
  return found;
};

const status = (): string =>
  document.querySelector('[data-testid="section-status"]')?.textContent ?? '';

interface Harness {
  readonly context: TestContext;
  readonly created: AppCommandInput<'viewer/create-section'>[];
  readonly toggled: AppCommandInput<'viewer/set-sections-enabled'>[];
  readonly clearedCount: () => number;
  readonly publish: (count: number, enabled: boolean) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const created: AppCommandInput<'viewer/create-section'>[] = [];
  const toggled: AppCommandInput<'viewer/set-sections-enabled'>[] = [];
  let cleared = 0;

  context.commands.register('viewer/create-section', (input) => {
    created.push(input);
    return Promise.resolve({ planeId: 'plane-1' });
  });
  context.commands.register('viewer/set-sections-enabled', (input) => {
    toggled.push(input);
    return Promise.resolve({ enabled: input.enabled });
  });
  context.commands.register('viewer/clear-sections', () => {
    cleared += 1;
    return Promise.resolve({ removed: 1 });
  });

  const panel = createSectionPanel(options);
  await panel.initialize(context);
  await panel.start();

  return {
    context,
    created,
    toggled,
    clearedCount: () => cleared,
    publish: (count, enabled) => context.events.publish('section/changed', { count, enabled }),
    dispose: () => panel.dispose(),
  };
};

beforeEach(() => {
  document.body.innerHTML = markup;
});

describe('createSectionPanel', () => {
  it('축 버튼이 그 축의 단면 생성 Command를 보낸다', async () => {
    const harness = await setup();

    button('section-axis', 'y').click();
    await Promise.resolve();

    expect(harness.created).toEqual([{ axis: 'y' }]);
  });

  it('단면이 없으면 끄기와 해제 버튼이 꺼져 있다', async () => {
    await setup();

    expect(button('section-toggle').disabled).toBe(true);
    expect(button('section-clear').disabled).toBe(true);
    expect(status()).toBe('');
  });

  it('단면이 생기면 개수를 보여 주고 버튼을 켠다', async () => {
    const harness = await setup();

    await harness.publish(2, true);

    expect(status()).toBe('단면 2개');
    expect(button('section-toggle').disabled).toBe(false);
    expect(button('section-clear').disabled).toBe(false);
  });

  it('꺼진 단면은 그 사실을 함께 보여 준다', async () => {
    const harness = await setup();

    await harness.publish(1, false);

    expect(status()).toBe('단면 1개 (꺼짐)');
    expect(button('section-toggle').textContent).toBe('단면 켜기');
  });

  it('끄기 버튼이 현재 상태의 반대를 요청한다', async () => {
    const harness = await setup();
    await harness.publish(1, true);

    button('section-toggle').click();
    await Promise.resolve();

    expect(harness.toggled).toEqual([{ enabled: false }]);
  });

  it('꺼진 상태에서는 켜기를 요청한다', async () => {
    const harness = await setup();
    await harness.publish(1, false);

    button('section-toggle').click();
    await Promise.resolve();

    expect(harness.toggled).toEqual([{ enabled: true }]);
  });

  it('해제 버튼이 전체 지우기를 요청한다', async () => {
    const harness = await setup();
    await harness.publish(1, true);

    button('section-clear').click();
    await Promise.resolve();

    expect(harness.clearedCount()).toBe(1);
  });

  it('모두 지워지면 버튼과 표시가 처음 상태로 돌아간다', async () => {
    const harness = await setup();
    await harness.publish(1, true);

    await harness.publish(0, true);

    expect(status()).toBe('');
    expect(button('section-toggle').disabled).toBe(true);
    expect(button('section-clear').disabled).toBe(true);
  });

  it('dispose 뒤에는 버튼이 Command를 보내지 않는다', async () => {
    const harness = await setup();
    await harness.dispose();

    button('section-axis', 'x').click();
    await Promise.resolve();

    expect(harness.created).toEqual([]);
  });
});
