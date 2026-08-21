/**
 * 가시성 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 감춘 부재의 목록 전체는 Event에 싣지 않는다. 화면이 필요로 하는 것은 개수와 격리 여부다.
 */

import type { ProductKey } from '@bim4d/contracts';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'visibility/changed': {
      /** 사용자가 직접 감춘 부재 수. 격리로 가려진 부재는 세지 않는다. */
      readonly hiddenCount: number;
      readonly isolated: boolean;
    };
  }

  interface AppCommandMap {
    'viewer/hide-products': {
      input: { readonly products: readonly ProductKey[] };
      output: { readonly hiddenCount: number };
    };
    'viewer/show-products': {
      input: { readonly products: readonly ProductKey[] };
      output: { readonly hiddenCount: number };
    };
    'viewer/isolate-products': {
      input: { readonly products: readonly ProductKey[] };
      output: { readonly isolated: boolean };
    };
    'viewer/show-all': {
      input: Record<string, never>;
      output: { readonly restored: boolean };
    };
  }
}

export {};
