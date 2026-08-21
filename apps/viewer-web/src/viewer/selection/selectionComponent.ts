import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../model/modelEvents.js';

import type { SelectedProduct, SelectionMode } from './selectionEvents.js';
import type { SelectionHit, SelectionPort } from './selectionPort.js';

export interface SelectionComponentOptions {
  /** 클릭을 받을 Viewer 컨테이너의 CSS selector. */
  readonly selector: string;
  readonly port: SelectionPort;
}

/** 선택 목록 안에서 객체를 구분하는 키. 영구 키와 같은 조합이다. */
const keyOf = (hit: SelectionHit | SelectedProduct): string => `${hit.modelId}::${hit.globalId}`;

const sameSelection = (left: readonly SelectionHit[], right: readonly SelectionHit[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((hit, index) => {
    const counterpart = right[index];
    return counterpart !== undefined && keyOf(hit) === keyOf(counterpart);
  });
};

const toProduct = (hit: SelectionHit): SelectedProduct => ({
  modelId: hit.modelId,
  globalId: hit.globalId,
});

/**
 * 객체 선택을 다루는 Component.
 *
 * 단일 선택과 다중 선택을 같은 경로로 처리한다. Ctrl 또는 Shift를 누른 채 누르면 토글이다.
 * `selection/changed`는 선택이 실제로 바뀔 때만 발행한다. 같은 객체를 다시 눌러도
 * 구독자가 같은 일을 두 번 하지 않게 하기 위해서다.
 */
export const createSelectionComponent = (options: SelectionComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let container: HTMLElement | null = null;
  let selected: SelectionHit[] = [];
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  /** 선택이 바뀐 경우에만 강조와 Event를 갱신한다. 바뀌었으면 true. */
  const applySelection = async (next: SelectionHit[]): Promise<boolean> => {
    const app = requireContext();
    if (sameSelection(selected, next)) return false;

    selected = next;
    if (next.length === 0) {
      await port.clearHighlight();
    } else {
      await port.highlight(next);
    }

    await app.events.publish('selection/changed', { selected: next.map(toProduct) });
    return true;
  };

  const nextSelection = (hit: SelectionHit | null, mode: SelectionMode): SelectionHit[] => {
    if (hit === null) {
      // 토글 중에 빈 곳을 누른 것은 실수인 경우가 많다. 기존 선택을 지우지 않는다.
      return mode === 'toggle' ? selected : [];
    }
    if (mode === 'replace') return [hit];

    const key = keyOf(hit);
    const without = selected.filter((item) => keyOf(item) !== key);
    return without.length === selected.length ? [...selected, hit] : without;
  };

  const selectAt = async (input: {
    readonly clientX: number;
    readonly clientY: number;
    readonly mode?: SelectionMode;
  }): Promise<{ readonly selected: readonly SelectedProduct[] }> => {
    const hit = await port.pickAt({ clientX: input.clientX, clientY: input.clientY });
    await applySelection(nextSelection(hit, input.mode ?? 'replace'));
    return { selected: selected.map(toProduct) };
  };

  const onContainerClick = (event: MouseEvent): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/select-at', {
      clientX: event.clientX,
      clientY: event.clientY,
      mode: event.ctrlKey || event.metaKey || event.shiftKey ? 'toggle' : 'replace',
    });
  };

  const clearModel = async (modelId: ModelId): Promise<void> => {
    // 해제된 모델의 객체가 선택된 채로 남으면 이후 조회가 빈 값을 돌려준다.
    const remaining = selected.filter((hit) => hit.modelId !== modelId);
    if (remaining.length === selected.length) return;
    await applySelection(remaining);
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
        app.events.subscribe('model/unloaded', ({ payload }) => {
          void clearModel(payload.modelId);
        }),
      ];

      if (!registered) {
        app.commands.register('viewer/select-at', (input) => selectAt(input));
        app.commands.register('viewer/clear-selection', async () => ({
          cleared: await applySelection([]),
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

      if (selected.length > 0) {
        selected = [];
        await port.clearHighlight();
      }
      container = null;
      context = null;
    },
  };
};
