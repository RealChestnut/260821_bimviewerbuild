/**
 * 선택 슬라이스가 발행하는 Event와 받는 Command.
 *
 * `selection/changed`는 선택이 실제로 바뀔 때만 발행한다. 같은 상태로 다시 눌러도 발행하지 않는다.
 * payload에는 영구 키(modelId + GlobalId)만 싣는다. Adapter 내부 번호는 넘기지 않는다.
 */

import type { GlobalId, ModelId } from '@bim4d/contracts';

interface SelectedProduct {
  readonly modelId: ModelId;
  readonly globalId: GlobalId;
}

/**
 * `replace`는 기존 선택을 버리고 새로 고른다. `toggle`은 Ctrl/Shift를 누른 채 누른 경우로,
 * 이미 선택된 객체면 빼고 아니면 더한다.
 */
type SelectionMode = 'replace' | 'toggle';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    /** 선택이 바뀌었다. 아무것도 선택되지 않았으면 빈 배열이다. */
    'selection/changed': { readonly selected: readonly SelectedProduct[] };
  }

  interface AppCommandMap {
    'viewer/select-at': {
      input: {
        readonly clientX: number;
        readonly clientY: number;
        readonly mode?: SelectionMode;
      };
      output: { readonly selected: readonly SelectedProduct[] };
    };
    'viewer/clear-selection': {
      input: Record<string, never>;
      output: { readonly cleared: boolean };
    };
  }
}

export type { SelectedProduct, SelectionMode };
