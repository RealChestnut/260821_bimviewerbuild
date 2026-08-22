import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../model/modelEvents.js';
import './clippingEvents.js';

import type { ClipAxis, ClippingPort } from './clippingPort.js';

export interface ClippingComponentOptions {
  readonly port: ClippingPort;
}

/**
 * 단면을 다루는 Component.
 *
 * 평면은 열린 모델을 기준으로 놓이므로, 마지막 모델이 내려가면 함께 정리한다. 남겨 두면
 * 다음 모델을 열었을 때 이유를 알 수 없는 자리에서 잘린 화면을 보게 된다.
 */
export const createClippingComponent = (options: ClippingComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  const planeIds: string[] = [];
  const loadedModels = new Set<ModelId>();

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const publishState = async (): Promise<void> => {
    await requireContext().events.publish('clipping/changed', { planeCount: planeIds.length });
  };

  const addPlane = async (axis: ClipAxis): Promise<number> => {
    const planeId = await port.addAxisPlane(axis);
    // 자를 대상이 없으면 Adapter가 평면을 만들지 않는다. 개수만 늘리면 화면과 어긋난다.
    if (planeId === null) return planeIds.length;

    planeIds.push(planeId);
    await publishState();
    return planeIds.length;
  };

  const clearPlanes = async (): Promise<boolean> => {
    if (planeIds.length === 0) return false;

    await port.removeAll();
    planeIds.length = 0;
    await publishState();
    return true;
  };

  return {
    id: 'viewer.clipping',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();

      subscriptions = [
        app.events.subscribe('model/loaded', ({ payload }) => {
          loadedModels.add(payload.modelId);
        }),
        app.events.subscribe('model/unloaded', ({ payload }) => {
          loadedModels.delete(payload.modelId);
          if (loadedModels.size === 0) void clearPlanes();
        }),
      ];

      if (!registered) {
        app.commands.register('viewer/add-clip-plane', async ({ axis }) => ({
          planeCount: await addPlane(axis),
        }));
        app.commands.register('viewer/clear-clip-planes', async () => ({
          removed: await clearPlanes(),
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

    dispose: async () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      if (planeIds.length > 0) {
        await port.removeAll();
        planeIds.length = 0;
      }
      loadedModels.clear();
      context = null;
    },
  };
};
