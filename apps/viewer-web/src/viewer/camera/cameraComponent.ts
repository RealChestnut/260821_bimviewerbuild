import type { AppComponent, AppContext } from '@bim4d/contracts';

import './cameraEvents.js';
import type { CameraPort } from './cameraPort.js';

export interface CameraComponentOptions {
  readonly port: CameraPort;
}

/**
 * 카메라 명령을 받는 Component.
 *
 * 카메라 상태는 Adapter가 들고 있다. 여기서 위치를 따로 기억하지 않는다.
 * 사용자가 마우스로 돌린 뒤에도 진실은 언제나 Adapter 쪽 하나뿐이다.
 */
export const createCameraComponent = (options: CameraComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let registered = false;

  return {
    id: 'viewer.camera',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');

      if (!registered) {
        context.commands.register('viewer/fit-camera', async () => ({
          fitted: await port.fitToModels(),
        }));
        registered = true;
      }
      return Promise.resolve();
    },

    stop: () => Promise.resolve(),

    dispose: () => {
      context = null;
      return Promise.resolve();
    },
  };
};
