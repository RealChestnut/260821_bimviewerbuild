import { beforeEach, describe, expect, it } from 'vitest';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';

import { createViewpointComponent } from './viewpointComponent.js';
import type { CameraPose, ViewpointPort } from './viewpointPort.js';

interface FakePort extends ViewpointPort {
  readonly restored: CameraPose[];
  /** capture가 돌려줄 자세. null이면 World가 없는 상황이다. */
  pose: CameraPose | null;
}

const poseAt = (x: number): CameraPose => ({
  position: [x, x + 1, x + 2],
  target: [0, 0, 0],
  up: [0, 1, 0],
});

const createFakePort = (): FakePort => {
  const port: FakePort = {
    restored: [],
    pose: poseAt(10),
    capture: () => Promise.resolve(port.pose),
    restore: (pose) => {
      if (port.pose === null) return Promise.resolve(false);
      port.restored.push(pose);
      return Promise.resolve(true);
    },
  };
  return port;
};

let port: FakePort;
let nextId: number;

const startComponent = async (context: TestContext) => {
  const component = createViewpointComponent({
    port,
    newViewpointId: () => `vp-${String(++nextId)}`,
  });
  await component.initialize(context);
  await component.start();
  return component;
};

/** 마지막으로 발행된 목록. */
const listenList = (context: TestContext): { readonly id: string; readonly name: string }[][] => {
  const seen: { readonly id: string; readonly name: string }[][] = [];
  context.events.subscribe('viewpoint/changed', ({ payload }) => {
    seen.push([...payload.viewpoints]);
  });
  return seen;
};

beforeEach(() => {
  port = createFakePort();
  nextId = 0;
});

describe('createViewpointComponent — 저장', () => {
  it('지금 카메라 자세를 담아 목록에 넣는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const lists = listenList(context);

    const result = await context.commands.dispatch('viewer/save-viewpoint', { name: '정면' });

    expect(result.ok && result.value.viewpointId).toBe('vp-1');
    expect(lists).toEqual([[{ id: 'vp-1', name: '정면' }]]);
  });

  it('이름을 주지 않으면 순번으로 붙인다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const lists = listenList(context);

    await context.commands.dispatch('viewer/save-viewpoint', {});
    await context.commands.dispatch('viewer/save-viewpoint', {});

    expect(lists.at(-1)).toEqual([
      { id: 'vp-1', name: '시점 1' },
      { id: 'vp-2', name: '시점 2' },
    ]);
  });

  it('World가 없으면 저장하지 않는다', async () => {
    // 읽어 올 카메라가 없는데 빈 시점을 만들어 두면 복원할 때 어디로 갈지 알 수 없다.
    const context = createTestContext();
    await startComponent(context);
    const lists = listenList(context);
    port.pose = null;

    const result = await context.commands.dispatch('viewer/save-viewpoint', {});

    expect(result.ok).toBe(false);
    expect(lists).toEqual([]);
  });

  it('같은 자세를 두 번 저장해도 각각 남는다', async () => {
    const context = createTestContext();
    await startComponent(context);

    await context.commands.dispatch('viewer/save-viewpoint', { name: '같은 곳' });
    const second = await context.commands.dispatch('viewer/save-viewpoint', { name: '같은 곳' });

    expect(second.ok && second.value.viewpointId).toBe('vp-2');
  });
});

describe('createViewpointComponent — 복원', () => {
  it('저장할 때의 자세를 그대로 Port에 넘긴다', async () => {
    const context = createTestContext();
    await startComponent(context);
    port.pose = poseAt(42);
    await context.commands.dispatch('viewer/save-viewpoint', { name: '기록' });

    // 저장 뒤 카메라가 다른 곳으로 옮겨져도 복원값은 저장 시점의 것이어야 한다.
    port.pose = poseAt(99);
    await context.commands.dispatch('viewer/restore-viewpoint', { viewpointId: 'vp-1' });

    expect(port.restored).toEqual([poseAt(42)]);
  });

  it('없는 시점을 복원하면 실패한다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('viewer/restore-viewpoint', {
      viewpointId: '없음',
    });

    expect(result.ok).toBe(false);
    expect(port.restored).toEqual([]);
  });

  it('복원했음을 Event로 알린다', async () => {
    const context = createTestContext();
    const seen: string[] = [];
    await startComponent(context);
    context.events.subscribe('viewpoint/restored', ({ payload }) => {
      seen.push(payload.viewpointId);
    });
    await context.commands.dispatch('viewer/save-viewpoint', {});

    await context.commands.dispatch('viewer/restore-viewpoint', { viewpointId: 'vp-1' });

    expect(seen).toEqual(['vp-1']);
  });
});

describe('createViewpointComponent — 삭제와 정리', () => {
  it('삭제하면 목록에서 빠진다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await context.commands.dispatch('viewer/save-viewpoint', { name: '하나' });
    await context.commands.dispatch('viewer/save-viewpoint', { name: '둘' });
    const lists = listenList(context);

    const result = await context.commands.dispatch('viewer/remove-viewpoint', {
      viewpointId: 'vp-1',
    });

    expect(result.ok && result.value.removed).toBe(true);
    expect(lists.at(-1)).toEqual([{ id: 'vp-2', name: '둘' }]);
  });

  it('없는 시점을 삭제해도 오류가 아니다', async () => {
    const context = createTestContext();
    await startComponent(context);

    const result = await context.commands.dispatch('viewer/remove-viewpoint', {
      viewpointId: '없음',
    });

    expect(result.ok && result.value.removed).toBe(false);
  });

  it('dispose하면 목록을 비운다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);
    await context.commands.dispatch('viewer/save-viewpoint', {});

    await component.stop();
    await component.dispose();

    const result = await context.commands.dispatch('viewer/restore-viewpoint', {
      viewpointId: 'vp-1',
    });
    expect(result.ok).toBe(false);
  });
});
