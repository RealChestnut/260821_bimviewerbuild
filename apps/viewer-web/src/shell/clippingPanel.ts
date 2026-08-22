import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../viewer/clipping/clippingEvents.js';
import '../viewer/model/modelEvents.js';
import type { ClipAxis } from '../viewer/clipping/clippingPort.js';

export interface ClippingPanelOptions {
  readonly axisButtonSelectors: Readonly<Record<ClipAxis, string>>;
  readonly clearButtonSelector: string;
  readonly statusSelector: string;
}

const AXES: readonly ClipAxis[] = ['X', 'Y', 'Z'];

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
 * 단면 조작을 다루는 화면 조각.
 *
 * 축 버튼은 열린 모델이 있을 때만 쓴다. 자를 대상이 없으면 Adapter가 평면을 만들지 않으므로,
 * 누를 수 있게 두면 아무 일도 일어나지 않는 버튼이 된다.
 */
export const createClippingPanel = (options: ClippingPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let axisButtons: Map<ClipAxis, HTMLButtonElement> | null = null;
  let clearButton: HTMLButtonElement | null = null;
  let statusText: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  const loadedModels = new Set<ModelId>();
  const axisHandlers = new Map<ClipAxis, () => void>();

  const write = (text: string): void => {
    if (statusText !== null) statusText.textContent = text;
  };

  const setAxisEnabled = (enabled: boolean): void => {
    for (const button of axisButtons?.values() ?? []) button.disabled = !enabled;
  };

  const onClearClicked = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/clear-clip-planes', {});
  };

  return {
    id: 'shell.clipping-panel',

    initialize: (appContext: AppContext) => {
      try {
        const buttons = new Map<ClipAxis, HTMLButtonElement>();
        for (const axis of AXES) {
          buttons.set(axis, requireButton(options.axisButtonSelectors[axis]));
        }
        axisButtons = buttons;
        clearButton = requireButton(options.clearButtonSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      setAxisEnabled(false);
      clearButton.disabled = true;
      write('');
      return Promise.resolve();
    },

    start: () => {
      if (context === null || axisButtons === null || clearButton === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      for (const [axis, button] of axisButtons) {
        const handler = (): void => {
          if (context === null) return;
          void context.commands.dispatch('viewer/add-clip-plane', { axis });
        };
        axisHandlers.set(axis, handler);
        button.addEventListener('click', handler);
      }
      clearButton.addEventListener('click', onClearClicked);

      subscriptions = [
        context.events.subscribe('model/loaded', ({ payload }) => {
          loadedModels.add(payload.modelId);
          setAxisEnabled(true);
        }),
        context.events.subscribe('model/unloaded', ({ payload }) => {
          loadedModels.delete(payload.modelId);
          if (loadedModels.size === 0) setAxisEnabled(false);
        }),
        context.events.subscribe('clipping/changed', ({ payload }) => {
          if (clearButton !== null) clearButton.disabled = payload.planeCount === 0;
          write(payload.planeCount === 0 ? '' : `단면 ${String(payload.planeCount)}개`);
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      for (const [axis, button] of axisButtons ?? []) {
        const handler = axisHandlers.get(axis);
        if (handler !== undefined) button.removeEventListener('click', handler);
      }
      axisHandlers.clear();
      clearButton?.removeEventListener('click', onClearClicked);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const [axis, button] of axisButtons ?? []) {
        const handler = axisHandlers.get(axis);
        if (handler !== undefined) button.removeEventListener('click', handler);
      }
      axisHandlers.clear();
      clearButton?.removeEventListener('click', onClearClicked);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      axisButtons = null;
      clearButton = null;
      statusText = null;
      loadedModels.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
