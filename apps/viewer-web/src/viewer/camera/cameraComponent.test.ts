import { beforeEach, describe, expect, it } from 'vitest';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';

import { createCameraComponent } from './cameraComponent.js';
import type { CameraPort, StandardView } from './cameraPort.js';

interface FakePort extends CameraPort {
  readonly views: StandardView[];
  fitCalls: number;
  /** 열린 모델이 없는 상황을 흉내 낸다. */
  empty: boolean;
}

const createFakePort = (): FakePort => {
  const port: FakePort = {
    views: [],
    fitCalls: 0,
    empty: false,
    fitToModels: () => {
      port.fitCalls += 1;
      return Promise.resolve(!port.empty);
    },
    setStandardView: (view) => {
      if (port.empty) return Promise.resolve(false);
      port.views.push(view);
      return Promise.resolve(true);
    },
  };
  return port;
};

let port: FakePort;

const startComponent = async (context: TestContext) => {
  const component = createCameraComponent({ port });
  await component.initialize(context);
  await component.start();
  return component;
};

beforeEach(() => {
  port = createFakePort();
});

describe('createCameraComponent', () => {
  it('전체 맞춤 Command가 Port를 부른다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('viewer/fit-view', {});

    expect(result.ok && result.value.fitted).toBe(true);
    expect(port.fitCalls).toBe(1);
  });

  it('맞출 모델이 없으면 실패가 아니라 false를 돌려준다', async () => {
    // 아직 아무것도 열지 않은 상태에서 버튼을 누르는 것은 오류가 아니다.
    const context = createTestContext();
    await startComponent(context);
    port.empty = true;

    const result = await context.commands.dispatch('viewer/fit-view', {});

    expect(result.ok && result.value.fitted).toBe(false);
  });

  it('표준 시점을 그대로 Port에 넘긴다', async () => {
    const context = createTestContext();
    await startComponent(context);

    await context.commands.dispatch('viewer/set-standard-view', { view: 'TOP' });
    await context.commands.dispatch('viewer/set-standard-view', { view: 'FRONT' });

    expect(port.views).toEqual(['TOP', 'FRONT']);
  });

  it('시점이 바뀌면 Event로 알린다', async () => {
    const context = createTestContext();
    const seen: string[] = [];
    await startComponent(context);
    context.events.subscribe('camera/view-changed', ({ payload }) => {
      seen.push(payload.view);
    });

    await context.commands.dispatch('viewer/set-standard-view', { view: 'ISO' });

    expect(seen).toEqual(['ISO']);
  });

  it('시점을 옮기지 못했으면 Event를 내지 않는다', async () => {
    const context = createTestContext();
    const seen: string[] = [];
    await startComponent(context);
    context.events.subscribe('camera/view-changed', ({ payload }) => {
      seen.push(payload.view);
    });
    port.empty = true;

    await context.commands.dispatch('viewer/set-standard-view', { view: 'ISO' });

    expect(seen).toEqual([]);
  });

  it('알 수 없는 시점은 거부한다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('viewer/set-standard-view', {
      view: 'SIDEWAYS' as StandardView,
    });

    expect(result.ok).toBe(false);
    expect(port.views).toEqual([]);
  });
});
