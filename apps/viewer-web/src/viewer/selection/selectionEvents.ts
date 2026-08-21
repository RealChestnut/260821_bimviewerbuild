/**
 * 선택 슬라이스가 발행하는 Event와 받는 Command.
 *
 * `selection/changed`는 선택이 실제로 바뀔 때만 발행한다. 같은 객체를 다시 눌러도 다시 발행하지 않는다.
 */

import type { GlobalId, ModelId } from '@bim4d/contracts';

interface SelectedProduct {
  readonly modelId: ModelId;
  readonly globalId: GlobalId;
}

declare module '@bim4d/contracts' {
  interface AppEventMap {
    /** 선택이 바뀌었다. 선택을 푼 경우 `selected`는 null이다. */
    'selection/changed': { readonly selected: SelectedProduct | null };
  }

  interface AppCommandMap {
    'viewer/select-at': {
      input: { readonly clientX: number; readonly clientY: number };
      output: { readonly selected: SelectedProduct | null };
    };
    'viewer/clear-selection': {
      input: Record<string, never>;
      output: { readonly cleared: boolean };
    };
  }
}

export type { SelectedProduct };
