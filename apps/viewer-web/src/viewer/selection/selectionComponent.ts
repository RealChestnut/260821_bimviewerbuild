import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../model/modelEvents.js';

import type { SelectedProduct } from './selectionEvents.js';
import type { SelectionHit, SelectionPort } from './selectionPort.js';

export interface SelectionComponentOptions {
  /** 클릭을 받을 Viewer 컨테이너의 CSS selector. */
  readonly selector: string;
  readonly port: SelectionPort;
}

const sameProduct = (left: SelectionHit | null, right: SelectionHit | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.modelId === right.modelId && left.globalId === right.globalId;
};

const toProduct = (hit: SelectionHit): SelectedProduct => ({
  modelId: hit.modelId,
  globalId: hit.globalId,
});

/**
 * 단일 객체 선택을 다루는 Component.
 *
 * `selection/changed`는 선택이 실제로 바뀔 때만 발행한다. 같은 객체를 다시 눌러도
 * 구독자가 같은 일을 두 번 하지 않게 하기 위해서다.
 */
export const createSelectionComponent = (options: SelectionComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let container: HTMLElement | null = null;
  let selected: SelectionHit | null = null;
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  /** 선택이 바뀐 경우에만 강조와 Event를 갱신한다. 바뀌었으면 true. */
  const applySelection = async (next: SelectionHit | null): Promise<boolean> => {
    const app = requireContext();
    if (sameProduct(selected, next)) return false;

    selected = next;
    if (next === null) {
      await port.clearHighlight();
    } else {
      await port.highlight(next);
    }

    await app.events.publish('selection/changed', {
      selected: next === null ? null : toProduct(next),
    });
    return true;
  };

  const selectAt = async (point: {
    readonly clientX: number;
    readonly clientY: number;
  }): Promise<{ readonly selected: SelectedProduct | null }> => {
    const hit = await port.pickAt(point);
    await applySelection(hit);
    return { selected: hit === null ? null : toProduct(hit) };
  };

  const onContainerClick = (event: MouseEvent): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/select-at', {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  return {
    id: 'viewer.selection',

    initialize: (appContext: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`Viewer 컨테이너 요소를 찾지 못했다: ${options.selector}`));
      }
      context = appContext;
      container = found;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();
      container?.addEventListener('click', onContainerClick);

      subscriptions = [
        // 해제된 모델의 객체가 선택된 채로 남으면 이후 조회가 빈 값을 돌려준다.
        app.events.subscribe('model/unloaded', ({ payload }) => {
          void clearIfModel(payload.modelId);
        }),
      ];

      if (!registered) {
        app.commands.register('viewer/select-at', (input) => selectAt(input));
        app.commands.register('viewer/clear-selection', async () => ({
          cleared: await applySelection(null),
        }));
        registered = true;
      }
      return Promise.resolve();
    },

    stop: () => {
      container?.removeEventListener('click', onContainerClick);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: async () => {
      container?.removeEventListener('click', onContainerClick);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      if (selected !== null) {
        selected = null;
        await port.clearHighlight();
      }
      container = null;
      context = null;
    },
  };

  async function clearIfModel(modelId: ModelId): Promise<void> {
    if (selected?.modelId !== modelId) return;
    await applySelection(null);
  }
};
