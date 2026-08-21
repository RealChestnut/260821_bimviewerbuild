import type { AppComponent, AppContext, ProductKey, Unsubscribe } from '@bim4d/contracts';

import '../viewer/selection/selectionEvents.js';
import '../viewer/visibility/visibilityEvents.js';

export interface VisibilityPanelOptions {
  readonly hideButtonSelector: string;
  readonly isolateButtonSelector: string;
  readonly showAllButtonSelector: string;
  readonly statusSelector: string;
}

const requireButton = (selector: string): HTMLButtonElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`button 요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

/**
 * 숨김·격리·전체 표시 버튼을 다루는 화면 조각.
 *
 * 현재 선택은 `selection/changed`로만 알고, 가시성 상태는 `visibility/changed`로만 안다.
 * 버튼은 Command를 보낼 뿐이며 자기 상태를 스스로 바꾸지 않는다.
 */
export const createVisibilityPanel = (options: VisibilityPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let hideButton: HTMLButtonElement | null = null;
  let isolateButton: HTMLButtonElement | null = null;
  let showAllButton: HTMLButtonElement | null = null;
  let statusText: HTMLElement | null = null;
  let selection: readonly ProductKey[] = [];
  let subscriptions: Unsubscribe[] = [];

  const write = (text: string): void => {
    if (statusText !== null) statusText.textContent = text;
  };

  const setSelectionButtons = (enabled: boolean): void => {
    if (hideButton !== null) hideButton.disabled = !enabled;
    if (isolateButton !== null) isolateButton.disabled = !enabled;
  };

  const onHide = (): void => {
    if (context === null || selection.length === 0) return;
    void context.commands.dispatch('viewer/hide-products', { products: selection });
  };

  const onIsolate = (): void => {
    if (context === null || selection.length === 0) return;
    void context.commands.dispatch('viewer/isolate-products', { products: selection });
  };

  const onShowAll = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/show-all', {});
  };

  return {
    id: 'shell.visibility-panel',

    initialize: (appContext: AppContext) => {
      try {
        hideButton = requireButton(options.hideButtonSelector);
        isolateButton = requireButton(options.isolateButtonSelector);
        showAllButton = requireButton(options.showAllButtonSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      setSelectionButtons(false);
      showAllButton.disabled = true;
      write('');
      return Promise.resolve();
    },

    start: () => {
      if (context === null || hideButton === null || isolateButton === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      hideButton.addEventListener('click', onHide);
      isolateButton.addEventListener('click', onIsolate);
      showAllButton?.addEventListener('click', onShowAll);

      subscriptions = [
        context.events.subscribe('selection/changed', ({ payload }) => {
          selection = payload.selected;
          setSelectionButtons(selection.length > 0);
        }),
        context.events.subscribe('visibility/changed', ({ payload }) => {
          const restorable = payload.isolated || payload.hiddenCount > 0;
          if (showAllButton !== null) showAllButton.disabled = !restorable;

          if (payload.isolated) {
            write('격리 중');
            return;
          }
          write(payload.hiddenCount === 0 ? '' : `${String(payload.hiddenCount)}개 숨김`);
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      hideButton?.removeEventListener('click', onHide);
      isolateButton?.removeEventListener('click', onIsolate);
      showAllButton?.removeEventListener('click', onShowAll);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      hideButton?.removeEventListener('click', onHide);
      isolateButton?.removeEventListener('click', onIsolate);
      showAllButton?.removeEventListener('click', onShowAll);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      hideButton = null;
      isolateButton = null;
      showAllButton = null;
      statusText = null;
      selection = [];
      context = null;
      return Promise.resolve();
    },
  };
};
