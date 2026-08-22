import type { AppComponent, AppContext } from '@bim4d/contracts';

import './viewpointEvents.js';

import type { CameraPose, ViewpointPort } from './viewpointPort.js';

export interface ViewpointComponentOptions {
  readonly port: ViewpointPort;
  /** 시점마다 새 식별자를 만든다. 테스트는 결정적인 값을 넣는다. */
  readonly newViewpointId: () => string;
}

interface SavedViewpoint {
  readonly name: string;
  readonly pose: CameraPose;
}

/**
 * 카메라 시점을 저장하고 되돌리는 Component.
 *
 * 자세는 저장하는 순간의 값을 복사해 둔다. 나중에 카메라가 어디로 옮겨지든 복원값은
 * 저장 시점의 것이어야 한다.
 *
 * 지금 보관소는 메모리다. 창을 닫으면 사라진다. 마스터 계획 6.2절의 `ViewerState`로
 * 영구화하는 것은 Project 저장이 붙는 단계의 일이며, 그때 이 Component는 그대로 두고
 * 보관소만 Adapter로 바꾼다.
 */
export const createViewpointComponent = (options: ViewpointComponentOptions): AppComponent => {
  const { port, newViewpointId } = options;

  let context: AppContext | null = null;
  let registered = false;

  /** 저장 순서를 그대로 화면 순서로 쓴다. */
  const viewpoints = new Map<string, SavedViewpoint>();

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const publishList = async (): Promise<void> => {
    await requireContext().events.publish('viewpoint/changed', {
      viewpoints: [...viewpoints].map(([id, saved]) => ({ id, name: saved.name })),
    });
  };

  const saveViewpoint = async (name?: string): Promise<string> => {
    const pose = await port.capture();
    // 읽어 올 카메라가 없는데 빈 시점을 만들면 복원할 때 어디로 갈지 알 수 없다.
    if (pose === null) throw new Error('카메라가 없어 시점을 저장할 수 없다.');

    const viewpointId = newViewpointId();
    viewpoints.set(viewpointId, {
      name: name ?? `시점 ${String(viewpoints.size + 1)}`,
      pose,
    });
    await publishList();
    return viewpointId;
  };

  const restoreViewpoint = async (viewpointId: string): Promise<boolean> => {
    const saved = viewpoints.get(viewpointId);
    if (saved === undefined) throw new Error(`없는 시점이다: ${viewpointId}`);

    const restored = await port.restore(saved.pose);
    if (restored) {
      await requireContext().events.publish('viewpoint/restored', { viewpointId });
    }
    return restored;
  };

  const removeViewpoint = async (viewpointId: string): Promise<boolean> => {
    if (!viewpoints.delete(viewpointId)) return false;
    await publishList();
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
      if (registered) return Promise.resolve();

      app.commands.register('viewer/save-viewpoint', async ({ name }) => ({
        viewpointId: await saveViewpoint(name),
      }));
      app.commands.register('viewer/restore-viewpoint', async ({ viewpointId }) => ({
        restored: await restoreViewpoint(viewpointId),
      }));
      app.commands.register('viewer/remove-viewpoint', async ({ viewpointId }) => ({
        removed: await removeViewpoint(viewpointId),
      }));

      registered = true;
      return Promise.resolve();
    },

    stop: () => Promise.resolve(),

    dispose: () => {
      viewpoints.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
