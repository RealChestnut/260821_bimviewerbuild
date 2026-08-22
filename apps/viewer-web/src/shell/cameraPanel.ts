import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../viewer/camera/cameraEvents.js';
import '../viewer/model/modelEvents.js';
import type { StandardView } from '../viewer/camera/cameraPort.js';

export interface CameraPanelOptions {
  readonly fitButtonSelector: string;
  readonly viewButtonSelectors: Readonly<Record<StandardView, string>>;
}

const VIEWS: readonly StandardView[] = ['FRONT', 'TOP', 'ISO'];

const requireButton = (selector: string): HTMLButtonElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`button 요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

/**
 * 카메라 조작을 다루는 화면 조각.
 *
 * 카메라는 열린 모델 전체를 기준으로 자리를 잡으므로, 모델이 없으면 옮길 곳이 없다.
 */
export const createCameraPanel = (options: CameraPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let fitButton: HTMLButtonElement | null = null;
  let viewButtons: Map<StandardView, HTMLButtonElement> | null = null;
  let subscriptions: Unsubscribe[] = [];

  const loadedModels = new Set<ModelId>();
  const viewHandlers = new Map<StandardView, () => void>();

  const setEnabled = (enabled: boolean): void => {
    if (fitButton !== null) fitButton.disabled = !enabled;
    for (const button of viewButtons?.values() ?? []) button.disabled = !enabled;
  };

  const onFitClicked = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/fit-view', {});
  };

  const detach = (): void => {
    for (const [view, button] of viewButtons ?? []) {
      const handler = viewHandlers.get(view);
      if (handler !== undefined) button.removeEventListener('click', handler);
    }
    viewHandlers.clear();
    fitButton?.removeEventListener('click', onFitClicked);
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.camera-panel',

    initialize: (appContext: AppContext) => {
      try {
        fitButton = requireButton(options.fitButtonSelector);
        const buttons = new Map<StandardView, HTMLButtonElement>();
        for (const view of VIEWS) {
          buttons.set(view, requireButton(options.viewButtonSelectors[view]));
        }
        viewButtons = buttons;
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      setEnabled(false);
      return Promise.resolve();
    },

    start: () => {
      if (context === null || fitButton === null || viewButtons === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      fitButton.addEventListener('click', onFitClicked);
      for (const [view, button] of viewButtons) {
        const handler = (): void => {
          if (context === null) return;
          void context.commands.dispatch('viewer/set-standard-view', { view });
        };
        viewHandlers.set(view, handler);
        button.addEventListener('click', handler);
      }

      subscriptions = [
        context.events.subscribe('model/loaded', ({ payload }) => {
          loadedModels.add(payload.modelId);
          setEnabled(true);
        }),
        context.events.subscribe('model/unloaded', ({ payload }) => {
          loadedModels.delete(payload.modelId);
          if (loadedModels.size === 0) setEnabled(false);
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
      fitButton = null;
      viewButtons = null;
      loadedModels.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
