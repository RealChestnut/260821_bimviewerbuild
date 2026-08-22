import type { AppComponent, AppContext } from '@bim4d/contracts';

import './cameraEvents.js';

import type { CameraPort, StandardView } from './cameraPort.js';

export interface CameraComponentOptions {
  readonly port: CameraPort;
}

const STANDARD_VIEWS: readonly StandardView[] = ['FRONT', 'TOP', 'ISO'];

/**
 * 카메라 조작을 다루는 Component.
 *
 * Viewpoint 저장·복원은 여기 없다. 저장할 곳(Project의 ViewerState)이 생기는 Phase 5에서
 * 별도 슬라이스로 붙인다 (ADR-0005).
 */
export const createCameraComponent = (options: CameraComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let registered = false;

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  return {
    id: 'viewer.camera',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();
      if (registered) return Promise.resolve();

      app.commands.register('viewer/fit-view', async () => ({
        // 열어 둔 모델이 없을 때 누르는 것은 오류가 아니다. 아무 일도 일어나지 않았다고만 알린다.
        fitted: await port.fitToModels(),
      }));

      app.commands.register('viewer/set-standard-view', async ({ view }) => {
        if (!STANDARD_VIEWS.includes(view)) {
          throw new Error(`알 수 없는 시점이다: ${view}`);
        }

        const applied = await port.setStandardView(view);
        if (applied) await app.events.publish('camera/view-changed', { view });
        return { applied };
      });

      registered = true;
      return Promise.resolve();
    },

    stop: () => Promise.resolve(),

    dispose: () => {
      context = null;
      return Promise.resolve();
    },
  };
};
