import type { AppComponent, AppContext, ProductKey, Unsubscribe } from '@bim4d/contracts';

import '../model/modelEvents.js';
import '../section/sectionEvents.js';
import '../visibility/visibilityEvents.js';
import './viewpointEvents.js';

import type { CameraPort, CameraView } from '../camera/cameraPort.js';
import type { SectionPlaneState, SectionPort } from '../section/sectionPort.js';

export interface ViewpointComponentOptions {
  readonly camera: CameraPort;
  /** 평면의 기하 상태를 읽으려고 쓴다. 만들고 지우는 일은 단면 슬라이스가 한다. */
  readonly section: SectionPort;
  /** 저장한 Viewpoint의 id를 만든다. 테스트에서 갈아 끼운다. */
  readonly newId?: () => string;
}

/** 저장된 화면 하나. */
export interface Viewpoint {
  readonly id: string;
  readonly name: string;
  readonly camera: CameraView;
  readonly hidden: readonly ProductKey[];
  readonly isolated: readonly ProductKey[];
  readonly sections: readonly SectionPlaneState[];
}

/**
 * 화면을 저장하고 되살리는 Component.
 *
 * 카메라와 단면은 Port에서 지금 값을 읽는다. 가시성은 `visibility/changed`로 따라간다.
 * 다른 Component의 상태를 직접 들여다보지 않기 위해서다.
 *
 * 되살릴 때는 자기가 직접 화면을 고치지 않고 각 슬라이스에 Command를 보낸다. 그래야
 * 되살린 뒤의 상태도 그 슬라이스가 알고 있는 상태와 어긋나지 않는다.
 */
export const createViewpointComponent = (options: ViewpointComponentOptions): AppComponent => {
  const { camera, section } = options;
  const newId = options.newId ?? ((): string => globalThis.crypto.randomUUID());

  let context: AppContext | null = null;
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  const viewpoints = new Map<string, Viewpoint>();
  /** 지금 감춰져 있는 것. `visibility/changed`가 알려 준 마지막 값이다. */
  let hidden: readonly ProductKey[] = [];
  let isolated: readonly ProductKey[] = [];

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const publishState = async (): Promise<void> => {
    await requireContext().events.publish('viewpoint/changed', {
      items: [...viewpoints.values()].map(({ id, name }) => ({ id, name })),
    });
  };

  const save = async (name?: string): Promise<{ id: string; name: string } | null> => {
    const view = await camera.getView();
    // World가 없으면 되살릴 화면도 없다.
    if (view === null) return null;

    const id = newId();
    const viewpoint: Viewpoint = {
      id,
      name:
        name?.trim() === undefined || name.trim().length === 0
          ? `시점 ${String(viewpoints.size + 1)}`
          : name.trim(),
      camera: view,
      hidden: [...hidden],
      isolated: [...isolated],
      sections: [...(await section.describe())],
    };

    viewpoints.set(id, viewpoint);
    await publishState();
    return { id, name: viewpoint.name };
  };

  const restore = async (id: string): Promise<boolean> => {
    const viewpoint = viewpoints.get(id);
    if (viewpoint === undefined) return false;

    const app = requireContext();
    await camera.setView(viewpoint.camera);

    // 가시성은 항상 전체 표시에서 다시 쌓는다. 지금 감춰진 것이 무엇이든 결과가 같아진다.
    await app.commands.dispatch('viewer/show-all', {});
    if (viewpoint.isolated.length > 0) {
      await app.commands.dispatch('viewer/isolate-products', { products: viewpoint.isolated });
    } else if (viewpoint.hidden.length > 0) {
      await app.commands.dispatch('viewer/hide-products', { products: viewpoint.hidden });
    }

    await app.commands.dispatch('viewer/restore-sections', { planes: viewpoint.sections });
    return true;
  };

  const remove = async (id: string): Promise<boolean> => {
    if (!viewpoints.delete(id)) return false;

    await publishState();
    return true;
  };

  return {
    id: 'viewer.viewpoint',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();

      subscriptions = [
        app.events.subscribe('visibility/changed', ({ payload }) => {
          hidden = payload.hidden;
          isolated = payload.isolatedProducts;
        }),
      ];

      if (!registered) {
        app.commands.register('viewer/save-viewpoint', async (input) => {
          const saved = await save(input.name);
          if (saved === null)
            throw new Error('저장할 화면이 없다. Viewer World를 먼저 띄워야 한다.');
          return saved;
        });
        app.commands.register('viewer/restore-viewpoint', async ({ id }) => ({
          restored: await restore(id),
        }));
        app.commands.register('viewer/delete-viewpoint', async ({ id }) => ({
          deleted: await remove(id),
        }));
        registered = true;
      }
      return Promise.resolve();
    },

    stop: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      viewpoints.clear();
      hidden = [];
      isolated = [];
      context = null;
      return Promise.resolve();
    },
  };
};
