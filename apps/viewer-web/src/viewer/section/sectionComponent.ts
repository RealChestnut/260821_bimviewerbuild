import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../model/modelEvents.js';
import './sectionEvents.js';

import type { SectionAxis, SectionPort } from './sectionPort.js';

export interface SectionComponentOptions {
  readonly port: SectionPort;
}

/**
 * 단면을 다루는 Component.
 *
 * 평면은 World에 속하고 모델에 속하지 않는다. 그래서 모델이 내려가면 평면을 모두 지운다.
 * 자르던 대상이 사라진 평면만 남으면 빈 화면에 gizmo만 떠 있게 된다.
 *
 * 켜고 끄기는 평면을 지우지 않는다. 잠시 전체를 보고 다시 같은 자리로 돌아오는 일이
 * 흔하기 때문이다.
 */
export const createSectionComponent = (options: SectionComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  let planeIds: string[] = [];
  let enabled = true;

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const publishState = async (): Promise<void> => {
    await requireContext().events.publish('section/changed', {
      count: planeIds.length,
      enabled,
    });
  };

  const createPlane = async (axis: SectionAxis): Promise<string | null> => {
    const planeId = await port.createAxisPlane(axis);
    if (planeId === null) return null;

    planeIds = [...planeIds, planeId];
    // 꺼 둔 상태에서 새로 만들면 아무 일도 일어나지 않은 것처럼 보인다. 다시 켠다.
    if (!enabled) {
      await port.setEnabled(true);
      enabled = true;
    }
    await publishState();
    return planeId;
  };

  const removePlane = async (planeId: string): Promise<boolean> => {
    if (!planeIds.includes(planeId)) return false;

    const removed = await port.remove(planeId);
    if (!removed) return false;

    planeIds = planeIds.filter((id) => id !== planeId);
    await publishState();
    return true;
  };

  const clearPlanes = async (): Promise<number> => {
    if (planeIds.length === 0) return 0;

    const removed = await port.removeAll();
    planeIds = [];
    await publishState();
    return removed;
  };

  const setEnabled = async (next: boolean): Promise<boolean> => {
    if (next === enabled) return enabled;

    await port.setEnabled(next);
    enabled = next;
    await publishState();
    return enabled;
  };

  return {
    id: 'viewer.section',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();

      subscriptions = [
        app.events.subscribe('model/unloaded', () => {
          void clearPlanes();
        }),
      ];

      if (!registered) {
        app.commands.register('viewer/create-section', async ({ axis }) => ({
          planeId: await createPlane(axis),
        }));
        app.commands.register('viewer/remove-section', async ({ planeId }) => ({
          removed: await removePlane(planeId),
        }));
        app.commands.register('viewer/clear-sections', async () => ({
          removed: await clearPlanes(),
        }));
        app.commands.register('viewer/set-sections-enabled', async (input) => ({
          enabled: await setEnabled(input.enabled),
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
        planeIds = [];
      }
      enabled = true;
      context = null;
    },
  };
};
