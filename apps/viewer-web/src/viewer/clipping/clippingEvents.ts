/**
 * 단면 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 평면의 위치나 법선은 Event에 싣지 않는다. 화면이 필요로 하는 것은 지금 몇 개가 걸려 있는지다.
 */

import type { ClipAxis } from './clippingPort.js';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'clipping/changed': { readonly planeCount: number };
  }

  interface AppCommandMap {
    'viewer/add-clip-plane': {
      input: { readonly axis: ClipAxis };
      output: { readonly planeCount: number };
    };
    'viewer/clear-clip-planes': {
      input: Record<string, never>;
      output: { readonly removed: boolean };
    };
  }
}

export {};
