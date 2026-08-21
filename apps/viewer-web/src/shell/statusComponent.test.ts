// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestContext } from '../kernel/testing/testContext.js';

import { createStatusComponent } from './statusComponent.js';

const selector = '[data-testid="kernel-status"]';

const element = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error('status element missing');
  return found;
};

describe('createStatusComponent', () => {
  beforeEach(() => {
    document.body.innerHTML = `<p data-testid="kernel-status">kernel: booting</p>`;
  });

  it('start하면 상태 문구를 started로 바꾼다', async () => {
    const component = createStatusComponent({ selector });
    await component.initialize(createTestContext());
    await component.start();

    expect(element().textContent).toBe('kernel: started');
  });

  it('stop하면 상태 문구를 stopped로 바꾼다', async () => {
    const component = createStatusComponent({ selector });
    await component.initialize(createTestContext());
    await component.start();
    await component.stop();

    expect(element().textContent).toBe('kernel: stopped');
  });

  it('dispose하면 DOM 참조를 놓고 더 이상 문구를 바꾸지 않는다', async () => {
    const component = createStatusComponent({ selector });
    await component.initialize(createTestContext());
    await component.start();
    await component.stop();
    await component.dispose();

    element().textContent = 'untouched';
    await component.stop();

    expect(element().textContent).toBe('untouched');
  });

  it('대상 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const component = createStatusComponent({ selector });

    await expect(component.initialize(createTestContext())).rejects.toThrow(/kernel-status/);
  });
});
