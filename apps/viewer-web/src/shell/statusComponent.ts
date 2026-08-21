import type { AppComponent, AppContext } from '@bim4d/contracts';

export interface StatusComponentOptions {
  /** 상태 문구를 표시할 요소의 CSS selector. */
  readonly selector: string;
}

/**
 * Kernel 기동 상태를 화면에 표시하는 최소 Component.
 *
 * Phase 0의 목적은 생명주기 계약과 `dispose()` 경로를 실제 DOM에서 확인하는 것이다.
 * Viewer Component는 Phase 1에서 같은 계약으로 추가한다.
 */
export const createStatusComponent = (options: StatusComponentOptions): AppComponent => {
  let target: HTMLElement | null = null;

  const write = (text: string): void => {
    if (target === null) return;
    target.textContent = text;
  };

  return {
    id: 'shell.status',

    initialize: (_context: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`상태 표시 요소를 찾지 못했다: ${options.selector}`));
      }
      target = found;
      write('kernel: initialized');
      return Promise.resolve();
    },

    start: () => {
      write('kernel: started');
      return Promise.resolve();
    },

    stop: () => {
      write('kernel: stopped');
      return Promise.resolve();
    },

    dispose: () => {
      // DOM 참조를 놓아 창이 닫힌 뒤에도 요소가 남지 않게 한다.
      target = null;
      return Promise.resolve();
    },
  };
};
