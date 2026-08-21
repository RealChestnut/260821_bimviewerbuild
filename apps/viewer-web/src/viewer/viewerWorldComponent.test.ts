// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEvent } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';

import { createViewerWorldComponent } from './viewerWorldComponent.js';
import type { ViewerWorld, ViewerWorldFactory } from './viewerWorldPort.js';

const selector = '[data-testid="viewer-container"]';

interface FakeWorld extends ViewerWorld {
  readonly enabledCalls: boolean[];
  disposeCount: number;
}

const createFakeFactory = (): ViewerWorldFactory & { readonly worlds: FakeWorld[] } => {
  const worlds: FakeWorld[] = [];
  return {
    worlds,
    create: () => {
      const world: FakeWorld = {
        id: `world-${String(worlds.length + 1)}`,
        enabledCalls: [],
        disposeCount: 0,
        setEnabled: (enabled) => {
          world.enabledCalls.push(enabled);
        },
        dispose: () => {
          world.disposeCount += 1;
        },
      };
      worlds.push(world);
      return world;
    },
  };
};

const collect = <
  TName extends 'viewer/world-ready' | 'viewer/world-disposed' | 'viewer/world-failed',
>(
  context: TestContext,
  name: TName,
): AppEvent<TName>[] => {
  const received: AppEvent<TName>[] = [];
  context.events.subscribe(name, (event) => {
    received.push(event);
  });
  return received;
};

describe('createViewerWorldComponent', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div data-testid="viewer-container"></div>`;
  });

  it('start하면 World를 만들고 world-ready를 발행한다', async () => {
    const context = createTestContext();
    const factory = createFakeFactory();
    const ready = collect(context, 'viewer/world-ready');
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);
    await component.start();

    expect(factory.worlds).toHaveLength(1);
    expect(ready.map((event) => event.payload.worldId)).toEqual(['world-1']);
  });

  it('stop은 World를 해제하지 않고 렌더 루프에서만 뺀다', async () => {
    const context = createTestContext();
    const factory = createFakeFactory();
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);
    await component.start();
    await component.stop();

    const world = factory.worlds[0];
    expect(world?.disposeCount).toBe(0);
    expect(world?.enabledCalls).toEqual([false]);
  });

  it('stop 후 다시 start하면 World를 새로 만들지 않고 다시 켠다', async () => {
    const context = createTestContext();
    const factory = createFakeFactory();
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);
    await component.start();
    await component.stop();
    await component.start();

    expect(factory.worlds).toHaveLength(1);
    expect(factory.worlds[0]?.enabledCalls).toEqual([false, true]);
  });

  it('dispose하면 World를 해제하고 world-disposed를 발행한다', async () => {
    const context = createTestContext();
    const factory = createFakeFactory();
    const disposed = collect(context, 'viewer/world-disposed');
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);
    await component.start();
    await component.stop();
    await component.dispose();

    expect(factory.worlds[0]?.disposeCount).toBe(1);
    expect(disposed.map((event) => event.payload.worldId)).toEqual(['world-1']);
  });

  it('dispose를 두 번 호출해도 한 번만 해제한다', async () => {
    const context = createTestContext();
    const factory = createFakeFactory();
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);
    await component.start();
    await component.dispose();
    await component.dispose();

    expect(factory.worlds[0]?.disposeCount).toBe(1);
  });

  it('start하지 않고 dispose해도 실패하지 않는다', async () => {
    const context = createTestContext();
    const factory = createFakeFactory();
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);

    await expect(component.dispose()).resolves.toBeUndefined();
    expect(factory.worlds).toHaveLength(0);
  });

  it('컨테이너 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const component = createViewerWorldComponent({ selector, factory: createFakeFactory() });

    await expect(component.initialize(context)).rejects.toThrow(/viewer-container/);
  });

  it('World 생성이 실패하면 world-failed를 발행하고 오류를 올린다', async () => {
    const context = createTestContext();
    const failed = collect(context, 'viewer/world-failed');
    const factory: ViewerWorldFactory = {
      create: vi.fn(() => {
        throw new Error('WebGL 사용 불가');
      }),
    };
    const component = createViewerWorldComponent({ selector, factory });

    await component.initialize(context);

    await expect(component.start()).rejects.toThrow(/WebGL/);
    expect(failed.map((event) => event.payload.reason)).toEqual(['WebGL 사용 불가']);
  });
});
