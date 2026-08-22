import { describe, expect, it } from 'vitest';

import type { AppEvent, GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';
import '../section/sectionEvents.js';
import '../visibility/visibilityEvents.js';

import type { CameraPort, CameraView } from '../camera/cameraPort.js';
import type { SectionPlaneState, SectionPort } from '../section/sectionPort.js';

import { createViewpointComponent } from './viewpointComponent.js';

const product = (globalId: string): ProductKey => ({
  modelId: 'model-1' as ModelId,
  globalId: globalId as GlobalId,
});

const wallA = product('0BnKdW4tq7SfUcM3vHxZgR');
const wallB = product('1MjTgR8dp5NkXbC2wFyQsA');

const view = (x: number): CameraView => ({ position: [x, 8, 12], target: [0, 0, 0] });
const plane = (y: number): SectionPlaneState => ({ normal: [0, 1, 0], origin: [0, y, 0] });

interface FakeCamera extends CameraPort {
  current: CameraView | null;
  readonly applied: CameraView[];
}

const createFakeCamera = (): FakeCamera => {
  const port: FakeCamera = {
    current: view(12),
    applied: [],
    getView: () => Promise.resolve(port.current),
    setView: (next) => {
      port.applied.push(next);
      port.current = next;
      return Promise.resolve();
    },
    fitToModels: () => Promise.resolve(true),
  };
  return port;
};

interface FakeSection extends SectionPort {
  planes: SectionPlaneState[];
}

const createFakeSection = (): FakeSection => {
  const port: FakeSection = {
    planes: [],
    createAxisPlane: () => Promise.resolve(null),
    remove: () => Promise.resolve(false),
    removeAll: () => Promise.resolve(0),
    setEnabled: () => Promise.resolve(),
    describe: () => Promise.resolve([...port.planes]),
    restore: (next) => {
      port.planes = [...next];
      return Promise.resolve(port.planes.map((_item, index) => `plane-${String(index + 1)}`));
    },
  };
  return port;
};

interface Dispatched {
  readonly name: string;
  readonly input: unknown;
}

interface Harness {
  readonly context: TestContext;
  readonly camera: FakeCamera;
  readonly section: FakeSection;
  readonly events: AppEvent<'viewpoint/changed'>[];
  readonly dispatched: Dispatched[];
  readonly setVisibility: (
    hidden: readonly ProductKey[],
    isolatedProducts: readonly ProductKey[],
    hiddenModels?: readonly ModelId[],
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const camera = createFakeCamera();
  const section = createFakeSection();
  const events: AppEvent<'viewpoint/changed'>[] = [];
  const dispatched: Dispatched[] = [];

  context.events.subscribe('viewpoint/changed', (event) => {
    events.push(event);
  });

  // 되살리기가 다른 슬라이스에 무엇을 요청하는지만 본다. 실제 동작은 그 슬라이스의 몫이다.
  context.commands.register('viewer/show-all', (input) => {
    dispatched.push({ name: 'show-all', input });
    return Promise.resolve({ restored: true });
  });
  context.commands.register('viewer/hide-products', (input) => {
    dispatched.push({ name: 'hide-products', input });
    return Promise.resolve({ hiddenCount: input.products.length });
  });
  context.commands.register('viewer/isolate-products', (input) => {
    dispatched.push({ name: 'isolate-products', input });
    return Promise.resolve({ isolated: true });
  });
  context.commands.register('viewer/set-model-visible', (input) => {
    dispatched.push({ name: 'set-model-visible', input });
    return Promise.resolve({ visible: input.visible });
  });
  context.commands.register('viewer/restore-sections', (input) => {
    dispatched.push({ name: 'restore-sections', input });
    return Promise.resolve({ count: input.planes.length });
  });

  let counter = 0;
  const component = createViewpointComponent({
    camera,
    section,
    newId: () => `vp-${String(++counter)}`,
  });
  await component.initialize(context);
  await component.start();

  return {
    context,
    camera,
    section,
    events,
    dispatched,
    setVisibility: (hidden, isolatedProducts, hiddenModels = []) =>
      context.events.publish('visibility/changed', {
        hiddenCount: hidden.length,
        isolated: isolatedProducts.length > 0,
        hidden,
        isolatedProducts,
        hiddenModels,
      }),
    dispose: () => component.dispose(),
  };
};

describe('createViewpointComponent', () => {
  it('저장하면 이름과 함께 목록에 넣는다', async () => {
    const { context, events } = await setup();

    const result = await context.commands.dispatch('viewer/save-viewpoint', {});

    expect(result).toEqual({ ok: true, value: { id: 'vp-1', name: '시점 1' } });
    expect(events.at(-1)?.payload.items).toEqual([{ id: 'vp-1', name: '시점 1' }]);
  });

  it('이름을 주면 그 이름으로 저장한다', async () => {
    const { context } = await setup();

    const result = await context.commands.dispatch('viewer/save-viewpoint', { name: ' 3층 배관 ' });

    expect(result).toEqual({ ok: true, value: { id: 'vp-1', name: '3층 배관' } });
  });

  it('카메라와 단면과 가시성을 함께 담는다', async () => {
    const harness = await setup();
    harness.camera.current = view(30);
    harness.section.planes = [plane(3)];
    await harness.setVisibility([wallA], []);

    await harness.context.commands.dispatch('viewer/save-viewpoint', {});
    // 저장 뒤에 화면을 바꿔 둔다. 되살리기가 저장 당시 값을 쓰는지 보기 위해서다.
    harness.camera.current = view(99);
    harness.section.planes = [];
    await harness.setVisibility([], []);

    await harness.context.commands.dispatch('viewer/restore-viewpoint', { id: 'vp-1' });

    expect(harness.camera.applied.at(-1)).toEqual(view(30));
    expect(harness.dispatched).toEqual([
      { name: 'show-all', input: {} },
      { name: 'hide-products', input: { products: [wallA] } },
      { name: 'restore-sections', input: { planes: [plane(3)] } },
    ]);
  });

  it('격리 중이던 화면은 격리로 되살린다', async () => {
    const harness = await setup();
    await harness.setVisibility([], [wallB]);

    await harness.context.commands.dispatch('viewer/save-viewpoint', {});
    await harness.context.commands.dispatch('viewer/restore-viewpoint', { id: 'vp-1' });

    expect(harness.dispatched.map((item) => item.name)).toEqual([
      'show-all',
      'isolate-products',
      'restore-sections',
    ]);
  });

  it('아무것도 감추지 않았던 화면은 전체 표시로 되살린다', async () => {
    const harness = await setup();
    await harness.setVisibility([wallA], []);
    await harness.context.commands.dispatch('viewer/save-viewpoint', { name: '전체' });
    await harness.setVisibility([], []);

    await harness.context.commands.dispatch('viewer/save-viewpoint', { name: '숨김 없음' });
    harness.dispatched.length = 0;
    await harness.context.commands.dispatch('viewer/restore-viewpoint', { id: 'vp-2' });

    expect(harness.dispatched.map((item) => item.name)).toEqual(['show-all', 'restore-sections']);
  });

  it('모르는 id를 되살리면 아무 일도 하지 않는다', async () => {
    const harness = await setup();

    const result = await harness.context.commands.dispatch('viewer/restore-viewpoint', {
      id: 'none',
    });

    expect(result).toEqual({ ok: true, value: { restored: false } });
    expect(harness.dispatched).toEqual([]);
  });

  it('지우면 목록에서 빠진다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/save-viewpoint', {});
    await context.commands.dispatch('viewer/save-viewpoint', {});

    const result = await context.commands.dispatch('viewer/delete-viewpoint', { id: 'vp-1' });

    expect(result).toEqual({ ok: true, value: { deleted: true } });
    expect(events.at(-1)?.payload.items).toEqual([{ id: 'vp-2', name: '시점 2' }]);
  });

  it('모르는 id는 지우지 않는다', async () => {
    const { context, events } = await setup();
    await context.commands.dispatch('viewer/save-viewpoint', {});

    const result = await context.commands.dispatch('viewer/delete-viewpoint', { id: 'none' });

    expect(result).toEqual({ ok: true, value: { deleted: false } });
    expect(events).toHaveLength(1);
  });

  it('World가 없으면 저장이 실패로 돌아온다', async () => {
    const harness = await setup();
    harness.camera.current = null;

    const result = await harness.context.commands.dispatch('viewer/save-viewpoint', {});

    expect(result.ok).toBe(false);
  });

  it('dispose하면 저장한 화면을 모두 버린다', async () => {
    const harness = await setup();
    await harness.context.commands.dispatch('viewer/save-viewpoint', {});

    await harness.dispose();

    expect(harness.events.at(-1)?.payload.items).toHaveLength(1);
  });
  it('통째로 감춰 두었던 모델도 되살린다', async () => {
    const harness = await setup();
    await harness.setVisibility([], [], ['model-2' as ModelId]);

    await harness.context.commands.dispatch('viewer/save-viewpoint', {});
    await harness.setVisibility([], []);
    harness.dispatched.length = 0;
    await harness.context.commands.dispatch('viewer/restore-viewpoint', { id: 'vp-1' });

    expect(harness.dispatched).toEqual([
      { name: 'show-all', input: {} },
      { name: 'set-model-visible', input: { modelId: 'model-2', visible: false } },
      { name: 'restore-sections', input: { planes: [] } },
    ]);
  });
});
