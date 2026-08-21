import type { ModelId } from '@bim4d/contracts';

import { createInMemoryModelRepository } from './adapters/inMemoryModelRepository.js';
import { createThatOpenViewerAdapter } from './adapters/thatopen/thatOpenViewerAdapter.js';
import { createKernel } from './kernel/index.js';
import { createModelPanel } from './shell/modelPanel.js';
import { createStatusComponent } from './shell/statusComponent.js';
import { createModelLoadingComponent } from './viewer/model/modelLoadingComponent.js';
import { createViewerWorldComponent } from './viewer/viewerWorldComponent.js';

/**
 * 애플리케이션 진입점.
 *
 * Component 등록 순서가 곧 생명주기 순서다. World가 먼저 서야 모델을 올릴 수 있고,
 * 해제는 역순으로 진행되므로 모델이 먼저 내려간 뒤 World가 사라진다.
 */
const bootstrap = async (): Promise<void> => {
  const kernel = createKernel();
  const viewer = createThatOpenViewerAdapter();
  const repository = createInMemoryModelRepository();

  kernel.register(createStatusComponent({ selector: '[data-testid="kernel-status"]' }));
  kernel.register(
    createViewerWorldComponent({
      selector: '[data-testid="viewer-container"]',
      factory: viewer.worldFactory,
    }),
  );
  kernel.register(
    createModelLoadingComponent({
      loader: viewer.modelLoader,
      repository,
      newModelId: () => globalThis.crypto.randomUUID() as ModelId,
    }),
  );
  kernel.register(
    createModelPanel({
      fileInputSelector: '[data-testid="model-file"]',
      unloadButtonSelector: '[data-testid="model-unload"]',
      statusSelector: '[data-testid="model-status"]',
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
