import type { AppComponent, AppContext } from '@bim4d/contracts';

import type { ViewerWorld, ViewerWorldFactory } from './viewerWorldPort.js';

import './viewerEvents.js';

export interface ViewerWorldComponentOptions {
  /** World를 붙일 컨테이너 요소의 CSS selector. */
  readonly selector: string;
  /** That Open Adapter가 구현한다. 테스트는 가짜 factory를 넣는다. */
  readonly factory: ViewerWorldFactory;
}

/**
 * Viewer World의 생명주기를 관리하는 Component.
 *
 * `start`에서 World를 만들고, `stop`에서는 렌더 루프에서만 빼며, 해제는 `dispose`에서만 한다.
 * 창을 닫거나 새로고침할 때 GPU 자원이 남지 않는 것이 이 Component의 완료 조건이다.
 */
export const createViewerWorldComponent = (options: ViewerWorldComponentOptions): AppComponent => {
  let context: AppContext | null = null;
  let container: HTMLElement | null = null;
  let world: ViewerWorld | null = null;

  return {
    id: 'viewer.world',

    initialize: (appContext: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`Viewer 컨테이너 요소를 찾지 못했다: ${options.selector}`));
      }
      context = appContext;
      container = found;
      return Promise.resolve();
    },

    start: async () => {
      if (context === null || container === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }

      if (world !== null) {
        // stop으로 껐던 World를 다시 켠다. 새로 만들면 GPU 자원이 중복된다.
        world.setEnabled(true);
        return;
      }

      try {
        world = options.factory.create(container);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        context.logger.error('viewer world creation failed', { reason, cause });
        await context.events.publish('viewer/world-failed', { reason });
        throw cause;
      }

      await context.events.publish('viewer/world-ready', { worldId: world.id });
    },

    stop: () => {
      world?.setEnabled(false);
      return Promise.resolve();
    },

    dispose: async () => {
      if (world === null) {
        container = null;
        context = null;
        return;
      }

      const worldId = world.id;
      const events = context?.events;
      world.dispose();
      world = null;
      container = null;
      context = null;

      await events?.publish('viewer/world-disposed', { worldId });
    },
  };
};
