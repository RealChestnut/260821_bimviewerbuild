import { createKernel } from './kernel/index.js';
import { createStatusComponent } from './shell/statusComponent.js';

/**
 * 애플리케이션 진입점.
 *
 * Phase 0에서는 Kernel 기동과 해제 경로만 확인한다.
 * Viewer Component는 Phase 1에서 이 자리에 등록한다.
 */
const bootstrap = async (): Promise<void> => {
  const kernel = createKernel();
  kernel.register(createStatusComponent({ selector: '[data-testid="kernel-status"]' }));

  await kernel.start();

  // WebView2 창이 닫히거나 새로고침될 때 자원을 해제한다.
  window.addEventListener(
    'pagehide',
    () => {
      void kernel.shutdown();
    },
    { once: true },
  );
};

void bootstrap();
