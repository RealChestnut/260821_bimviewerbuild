import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../viewer/model/modelEvents.js';
import '../viewer/visibility/visibilityEvents.js';

export interface ModelListPanelOptions {
  /** 열린 모델 목록을 그릴 요소의 CSS selector. */
  readonly selector: string;
}

const IDLE_TEXT = '열린 모델 없음';

/**
 * 열린 모델을 나열하는 화면 조각.
 *
 * 여러 모델을 겹쳐 볼 때 어느 파일이 올라와 있는지, 무엇을 잠시 감췄는지를 보여 준다.
 * 목록은 Event로만 안다. 표시 여부는 `visibility/changed`가 알려 주는 값을 그대로 쓴다.
 */
export const createModelListPanel = (options: ModelListPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let container: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  /** 적재 순서를 유지한다. */
  const models = new Map<ModelId, string>();
  let hiddenModels: readonly ModelId[] = [];

  const render = (): void => {
    if (container === null) return;

    if (models.size === 0) {
      const empty = document.createElement('p');
      empty.className = 'model-empty';
      empty.dataset['testid'] = 'model-empty';
      empty.textContent = IDLE_TEXT;
      container.replaceChildren(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'model-list';

    for (const [modelId, displayName] of models) {
      const row = document.createElement('li');
      const visible = !hiddenModels.includes(modelId);

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = visible;
      toggle.dataset['testid'] = 'model-visible';
      toggle.dataset['modelId'] = modelId;
      toggle.setAttribute('aria-label', `${displayName} 표시`);
      toggle.addEventListener('change', () => {
        void context?.commands.dispatch('viewer/set-model-visible', {
          modelId,
          visible: toggle.checked,
        });
      });

      const name = document.createElement('span');
      name.className = 'model-name';
      name.dataset['testid'] = 'model-name';
      name.dataset['modelId'] = modelId;
      name.textContent = displayName;
      name.title = displayName;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'model-remove';
      remove.dataset['testid'] = 'model-remove';
      remove.dataset['modelId'] = modelId;
      remove.textContent = '해제';
      remove.setAttribute('aria-label', `${displayName} 해제`);
      remove.addEventListener('click', () => {
        void context?.commands.dispatch('viewer/unload-model', { modelId });
      });

      row.append(toggle, name, remove);
      list.append(row);
    }
    container.replaceChildren(list);
  };

  return {
    id: 'shell.model-list-panel',

    initialize: (appContext: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`요소를 찾지 못했다: ${options.selector}`));
      }
      context = appContext;
      container = found;
      render();
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      if (subscriptions.length > 0) return Promise.resolve();

      subscriptions = [
        context.events.subscribe('model/loaded', ({ payload }) => {
          models.set(payload.modelId, payload.displayName);
          render();
        }),
        context.events.subscribe('model/unloaded', ({ payload }) => {
          if (!models.delete(payload.modelId)) return;
          render();
        }),
        context.events.subscribe('visibility/changed', ({ payload }) => {
          hiddenModels = payload.hiddenModels;
          render();
        }),
      ];
      return Promise.resolve();
    },

    stop: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      models.clear();
      hiddenModels = [];
      container?.replaceChildren();
      container = null;
      context = null;
      return Promise.resolve();
    },
  };
};
