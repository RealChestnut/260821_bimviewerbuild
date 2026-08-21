import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../viewer/selection/selectionEvents.js';

export interface SelectionPanelOptions {
  /** GlobalId를 표시할 요소의 CSS selector. */
  readonly selector: string;
}

const IDLE_TEXT = '선택 없음';

/**
 * 선택한 객체의 GlobalId를 보여 주는 화면 조각.
 *
 * GlobalId는 모델 파일을 다시 저장해도 유지되는 영구 키다. STEP ID(`#123`)는 보여 주지 않는다.
 */
export const createSelectionPanel = (options: SelectionPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let target: HTMLElement | null = null;
  let subscription: Unsubscribe | null = null;

  const write = (text: string): void => {
    if (target !== null) target.textContent = text;
  };

  return {
    id: 'shell.selection-panel',

    initialize: (appContext: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`요소를 찾지 못했다: ${options.selector}`));
      }
      context = appContext;
      target = found;
      write(IDLE_TEXT);
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      subscription ??= context.events.subscribe('selection/changed', ({ payload }) => {
        const [first] = payload.selected;
        if (first === undefined) {
          write(IDLE_TEXT);
          return;
        }
        // 여러 개를 고른 경우 GlobalId를 나열하면 헤더가 넘친다. 개수만 보여 준다.
        write(
          payload.selected.length === 1
            ? `GlobalId: ${first.globalId}`
            : `${String(payload.selected.length)}개 선택`,
        );
      });
      return Promise.resolve();
    },

    stop: () => {
      subscription?.();
      subscription = null;
      return Promise.resolve();
    },

    dispose: () => {
      subscription?.();
      subscription = null;
      target = null;
      context = null;
      return Promise.resolve();
    },
  };
};
