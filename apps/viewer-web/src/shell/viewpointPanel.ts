import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../viewer/model/modelEvents.js';
import '../viewer/viewpoint/viewpointEvents.js';

export interface ViewpointPanelOptions {
  readonly saveButtonSelector: string;
  readonly listSelector: string;
  readonly restoreButtonSelector: string;
  readonly removeButtonSelector: string;
}

const requireButton = (selector: string): HTMLButtonElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`button 요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

const requireSelect = (selector: string): HTMLSelectElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`select 요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

/**
 * 시점 저장과 복원을 다루는 화면 조각.
 *
 * 저장은 카메라가 무언가를 보고 있을 때만 뜻이 있으므로 모델이 열려 있어야 한다.
 * 복원과 삭제는 저장된 시점이 있을 때만 연다.
 */
export const createViewpointPanel = (options: ViewpointPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let listElement: HTMLSelectElement | null = null;
  let restoreButton: HTMLButtonElement | null = null;
  let removeButton: HTMLButtonElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  const loadedModels = new Set<ModelId>();

  const selectedId = (): string | null => {
    const value = listElement?.value ?? '';
    return value.length === 0 ? null : value;
  };

  const onSaveClicked = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/save-viewpoint', {});
  };

  const onRestoreClicked = (): void => {
    const viewpointId = selectedId();
    if (context === null || viewpointId === null) return;
    void context.commands.dispatch('viewer/restore-viewpoint', { viewpointId });
  };

  const onRemoveClicked = (): void => {
    const viewpointId = selectedId();
    if (context === null || viewpointId === null) return;
    void context.commands.dispatch('viewer/remove-viewpoint', { viewpointId });
  };

  const renderList = (
    viewpoints: readonly { readonly id: string; readonly name: string }[],
  ): void => {
    if (listElement === null) return;

    // 목록이 늘어나도 고르고 있던 시점이 그대로여야 한다. 다시 그리면 선택이 첫 항목으로 돌아간다.
    const previous = listElement.value;

    listElement.replaceChildren(
      ...viewpoints.map((viewpoint) => {
        const option = document.createElement('option');
        option.value = viewpoint.id;
        option.textContent = viewpoint.name;
        return option;
      }),
    );

    if (viewpoints.some((viewpoint) => viewpoint.id === previous)) {
      listElement.value = previous;
    }

    const empty = viewpoints.length === 0;
    listElement.disabled = empty;
    if (restoreButton !== null) restoreButton.disabled = empty;
    if (removeButton !== null) removeButton.disabled = empty;
  };

  const detach = (): void => {
    saveButton?.removeEventListener('click', onSaveClicked);
    restoreButton?.removeEventListener('click', onRestoreClicked);
    removeButton?.removeEventListener('click', onRemoveClicked);
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.viewpoint-panel',

    initialize: (appContext: AppContext) => {
      try {
        saveButton = requireButton(options.saveButtonSelector);
        listElement = requireSelect(options.listSelector);
        restoreButton = requireButton(options.restoreButtonSelector);
        removeButton = requireButton(options.removeButtonSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      saveButton.disabled = true;
      renderList([]);
      return Promise.resolve();
    },

    start: () => {
      if (context === null || saveButton === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      saveButton.addEventListener('click', onSaveClicked);
      restoreButton?.addEventListener('click', onRestoreClicked);
      removeButton?.addEventListener('click', onRemoveClicked);

      subscriptions = [
        context.events.subscribe('model/loaded', ({ payload }) => {
          loadedModels.add(payload.modelId);
          if (saveButton !== null) saveButton.disabled = false;
        }),
        context.events.subscribe('model/unloaded', ({ payload }) => {
          loadedModels.delete(payload.modelId);
          if (loadedModels.size === 0 && saveButton !== null) saveButton.disabled = true;
        }),
        context.events.subscribe('viewpoint/changed', ({ payload }) => {
          renderList(payload.viewpoints);
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      detach();
      return Promise.resolve();
    },

    dispose: () => {
      detach();
      saveButton = null;
      listElement = null;
      restoreButton = null;
      removeButton = null;
      loadedModels.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
