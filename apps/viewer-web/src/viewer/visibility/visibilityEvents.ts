/**
 * 가시성 슬라이스가 발행하는 Event와 받는 Command.
 *
 * payload에는 영구 키만 싣는다. Viewpoint가 그때 화면을 되살리려면 개수가 아니라
 * 무엇이 감춰져 있었는지를 알아야 한다. 형상 데이터는 싣지 않는다.
 */

import type { ModelId, ProductKey } from '@bim4d/contracts';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'visibility/changed': {
      /** 사용자가 직접 감춘 부재 수. 격리로 가려진 부재는 세지 않는다. */
      readonly hiddenCount: number;
      readonly isolated: boolean;
      /** 사용자가 직접 감춘 부재. */
      readonly hidden: readonly ProductKey[];
      /** 격리 중이면 그 대상. 격리가 아니면 빈 배열이다. */
      readonly isolatedProducts: readonly ProductKey[];
      /** 통째로 감춘 모델. */
      readonly hiddenModels: readonly ModelId[];
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
    'viewer/set-model-visible': {
      input: { readonly modelId: ModelId; readonly visible: boolean };
      output: { readonly visible: boolean };
    };
    'viewer/show-all': {
      input: Record<string, never>;
      output: { readonly restored: boolean };
    };
  }
}

export {};
