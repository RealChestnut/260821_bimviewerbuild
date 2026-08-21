import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../viewer/section/sectionEvents.js';
import type { SectionAxis } from '../viewer/section/sectionPort.js';

export interface SectionPanelOptions {
  /** 축 단면 버튼. `data-axis` 속성으로 어느 축인지 구분한다. */
  readonly axisButtonSelector: string;
  /** 자르기를 껐다 켜는 버튼. */
  readonly toggleButtonSelector: string;
  /** 단면을 모두 지우는 버튼. */
  readonly clearButtonSelector: string;
  readonly statusSelector: string;
}

const AXES: readonly SectionAxis[] = ['x', 'y', 'z'];

const isAxis = (value: string | undefined): value is SectionAxis =>
  value !== undefined && AXES.includes(value as SectionAxis);

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`요소를 찾지 못했다: ${selector}`);
  return element;
};

const requireButton = (selector: string): HTMLButtonElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`button 요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

/**
 * 단면 버튼을 다루는 화면 조각.
 *
 * 버튼은 Command만 보내고 자기 상태를 스스로 바꾸지 않는다. 개수와 켜짐 여부는
 * `section/changed`로만 안다.
 */
export const createSectionPanel = (options: SectionPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let axisButtons: HTMLButtonElement[] = [];
  let toggleButton: HTMLButtonElement | null = null;
  let clearButton: HTMLButtonElement | null = null;
  let statusText: HTMLElement | null = null;
  let subscription: Unsubscribe | null = null;
  let enabled = true;

  const write = (text: string): void => {
    if (statusText !== null) statusText.textContent = text;
  };

  const onAxisClick = (event: Event): void => {
    if (context === null) return;

    const axis = (event.currentTarget as HTMLElement).dataset['axis'];
    if (!isAxis(axis)) return;

    void context.commands.dispatch('viewer/create-section', { axis });
  };

  const onToggle = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/set-sections-enabled', { enabled: !enabled });
  };

  const onClear = (): void => {
    if (context === null) return;
    void context.commands.dispatch('viewer/clear-sections', {});
  };

  return {
    id: 'shell.section-panel',

    initialize: (appContext: AppContext) => {
      try {
        axisButtons = [...document.querySelectorAll<HTMLButtonElement>(options.axisButtonSelector)];
        if (axisButtons.length === 0) {
          throw new Error(`단면 버튼을 찾지 못했다: ${options.axisButtonSelector}`);
        }
        toggleButton = requireButton(options.toggleButtonSelector);
        clearButton = requireButton(options.clearButtonSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      toggleButton.disabled = true;
      clearButton.disabled = true;
      write('');
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      if (subscription !== null) return Promise.resolve();

      for (const button of axisButtons) button.addEventListener('click', onAxisClick);
      toggleButton?.addEventListener('click', onToggle);
      clearButton?.addEventListener('click', onClear);

      subscription = context.events.subscribe('section/changed', ({ payload }) => {
        enabled = payload.enabled;

        const hasPlanes = payload.count > 0;
        if (toggleButton !== null) {
          toggleButton.disabled = !hasPlanes;
          toggleButton.textContent = payload.enabled ? '단면 끄기' : '단면 켜기';
        }
        if (clearButton !== null) clearButton.disabled = !hasPlanes;

        if (!hasPlanes) {
          write('');
          return;
        }
        write(
          payload.enabled
            ? `단면 ${String(payload.count)}개`
            : `단면 ${String(payload.count)}개 (꺼짐)`,
        );
      });
      return Promise.resolve();
    },

    stop: () => {
      for (const button of axisButtons) button.removeEventListener('click', onAxisClick);
      toggleButton?.removeEventListener('click', onToggle);
      clearButton?.removeEventListener('click', onClear);
      subscription?.();
      subscription = null;
      return Promise.resolve();
    },

    dispose: () => {
      for (const button of axisButtons) button.removeEventListener('click', onAxisClick);
      toggleButton?.removeEventListener('click', onToggle);
      clearButton?.removeEventListener('click', onClear);
      subscription?.();
      subscription = null;

      axisButtons = [];
      toggleButton = null;
      clearButton = null;
      statusText = null;
      enabled = true;
      context = null;
      return Promise.resolve();
    },
  };
};
