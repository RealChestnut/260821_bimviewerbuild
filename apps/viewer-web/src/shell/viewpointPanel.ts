import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../viewer/camera/cameraEvents.js';
import '../viewer/viewpoint/viewpointEvents.js';

export interface ViewpointPanelOptions {
  /** 지금 화면을 저장하는 버튼. */
  readonly saveButtonSelector: string;
  /** 모델 전체가 보이도록 카메라를 맞추는 버튼. */
  readonly fitButtonSelector: string;
  /** 저장한 화면 목록을 그릴 요소. */
  readonly listSelector: string;
}

const IDLE_TEXT = '저장한 시점 없음';

const requireButton = (selector: string): HTMLButtonElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`button 요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`요소를 찾지 못했다: ${selector}`);
  return element;
};

/**
 * 저장한 화면을 다루는 화면 조각.
 *
 * 목록은 `viewpoint/changed`로만 안다. 버튼은 Command를 보낼 뿐이며 저장된 내용을
 * 직접 들고 있지 않는다.
 */
export const createViewpointPanel = (options: ViewpointPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let fitButton: HTMLButtonElement | null = null;
  let list: HTMLElement | null = null;
  let subscription: Unsubscribe | null = null;

  const onSave = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/save-viewpoint', {});
  };

  const onFit = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/fit-camera', {});
  };

  const renderEmpty = (): void => {
    if (list === null) return;

    const empty = document.createElement('p');
    empty.className = 'viewpoint-empty';
    empty.dataset['testid'] = 'viewpoint-empty';
    empty.textContent = IDLE_TEXT;
    list.replaceChildren(empty);
  };

  const render = (items: readonly { readonly id: string; readonly name: string }[]): void => {
    if (list === null) return;
    if (items.length === 0) {
      renderEmpty();
      return;
    }

    const listElement = document.createElement('ul');
    listElement.className = 'viewpoint-list';

    for (const item of items) {
      const row = document.createElement('li');

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'viewpoint-restore';
      restore.dataset['testid'] = 'viewpoint-restore';
      restore.dataset['viewpointId'] = item.id;
      restore.textContent = item.name;
      restore.addEventListener('click', () => {
        void context?.commands.dispatch('viewer/restore-viewpoint', { id: item.id });
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'viewpoint-delete';
      remove.dataset['testid'] = 'viewpoint-delete';
      remove.dataset['viewpointId'] = item.id;
      remove.textContent = '삭제';
      remove.setAttribute('aria-label', `${item.name} 삭제`);
      remove.addEventListener('click', () => {
        void context?.commands.dispatch('viewer/delete-viewpoint', { id: item.id });
      });

      row.append(restore, remove);
      listElement.append(row);
    }
    list.replaceChildren(listElement);
  };

  return {
    id: 'shell.viewpoint-panel',

    initialize: (appContext: AppContext) => {
      try {
        saveButton = requireButton(options.saveButtonSelector);
        fitButton = requireButton(options.fitButtonSelector);
        list = requireElement(options.listSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      renderEmpty();
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      if (subscription !== null) return Promise.resolve();

      saveButton?.addEventListener('click', onSave);
      fitButton?.addEventListener('click', onFit);

      subscription = context.events.subscribe('viewpoint/changed', ({ payload }) => {
        render(payload.items);
      });
      return Promise.resolve();
    },

    stop: () => {
      saveButton?.removeEventListener('click', onSave);
      fitButton?.removeEventListener('click', onFit);
      subscription?.();
      subscription = null;
      return Promise.resolve();
    },

    dispose: () => {
      saveButton?.removeEventListener('click', onSave);
      fitButton?.removeEventListener('click', onFit);
      subscription?.();
      subscription = null;

      list?.replaceChildren();
      saveButton = null;
      fitButton = null;
      list = null;
      context = null;
      return Promise.resolve();
    },
  };
};
