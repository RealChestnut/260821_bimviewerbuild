/**
 * 카메라 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 카메라 행렬이나 Three.js 객체는 Event에 싣지 않는다.
 */

import type { StandardView } from './cameraPort.js';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    /** 표준 시점으로 실제로 옮겨졌을 때만 발행한다. */
    'camera/view-changed': { readonly view: StandardView };
  }

  interface AppCommandMap {
    'viewer/fit-view': {
      input: Record<string, never>;
      output: { readonly fitted: boolean };
    };
    'viewer/set-standard-view': {
      input: { readonly view: StandardView };
      output: { readonly applied: boolean };
    };
  }
}

export {};
