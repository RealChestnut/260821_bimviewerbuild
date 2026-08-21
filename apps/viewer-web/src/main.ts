import { createKernel } from './kernel/index.js';
import { createStatusComponent } from './shell/statusComponent.js';
import { createThatOpenWorldFactory } from './adapters/thatopen/thatOpenWorldFactory.js';
import { createViewerWorldComponent } from './viewer/viewerWorldComponent.js';

/**
 * 애플리케이션 진입점.
 *
 * Phase 1 범위는 Kernel 기동과 Viewer World 생성·해제까지다.
 * 모델 적재는 Phase 2에서 이 자리에 Component로 추가한다.
 */
const bootstrap = async (): Promise<void> => {
  const kernel = createKernel();

  kernel.register(createStatusComponent({ selector: '[data-testid="kernel-status"]' }));
  kernel.register(
    createViewerWorldComponent({
      selector: '[data-testid="viewer-container"]',
      factory: createThatOpenWorldFactory(),
    }),
  );

  await kernel.start();

  let shuttingDown: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shuttingDown ??= kernel.shutdown();
    return shuttingDown;
  };

  window.bim4d = { shutdown };

  // 창이 닫히거나 새로고침될 때도 자원을 반납한다.
  window.addEventListener(
    'pagehide',
    () => {
      void shutdown();
    },
    { once: true },
  );
};

void bootstrap();
