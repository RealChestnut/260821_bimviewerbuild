import type { AppEventName, ModelId } from '@bim4d/contracts';

import { createInMemoryModelRepository } from './adapters/inMemoryModelRepository.js';
import { createThatOpenViewerAdapter } from './adapters/thatopen/thatOpenViewerAdapter.js';
import { createKernel } from './kernel/index.js';
import { createCameraPanel } from './shell/cameraPanel.js';
import { createClippingPanel } from './shell/clippingPanel.js';
import { createModelPanel } from './shell/modelPanel.js';
import { createSelectionPanel } from './shell/selectionPanel.js';
import { createVisibilityPanel } from './shell/visibilityPanel.js';
import { createSimulationPanel } from './shell/simulationPanel.js';
import { createViewpointPanel } from './shell/viewpointPanel.js';
import { createStatusComponent } from './shell/statusComponent.js';
import { createSimulationComponent } from './simulation/simulationComponent.js';
import { createModelLoadingComponent } from './viewer/model/modelLoadingComponent.js';
import { createCameraComponent } from './viewer/camera/cameraComponent.js';
import { createClippingComponent } from './viewer/clipping/clippingComponent.js';
import { createSelectionComponent } from './viewer/selection/selectionComponent.js';
import { createViewpointComponent } from './viewer/viewpoint/viewpointComponent.js';
import { createVisibilityComponent } from './viewer/visibility/visibilityComponent.js';
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
    createSelectionComponent({
      selector: '[data-testid="viewer-container"]',
      port: viewer.selection,
    }),
  );
  kernel.register(createVisibilityComponent({ port: viewer.visibility }));
  kernel.register(createClippingComponent({ port: viewer.clipping }));
  kernel.register(createCameraComponent({ port: viewer.camera }));
  kernel.register(
    createViewpointComponent({
      port: viewer.viewpoint,
      newViewpointId: () => globalThis.crypto.randomUUID(),
    }),
  );
  kernel.register(createSimulationComponent({ port: viewer.simulation }));
  kernel.register(
    createModelPanel({
      fileInputSelector: '[data-testid="model-file"]',
      listSelector: '[data-testid="model-list"]',
      statusSelector: '[data-testid="model-status"]',
    }),
  );
  kernel.register(
    createClippingPanel({
      axisButtonSelectors: {
        X: '[data-testid="clip-x"]',
        Y: '[data-testid="clip-y"]',
        Z: '[data-testid="clip-z"]',
      },
      clearButtonSelector: '[data-testid="clip-clear"]',
      statusSelector: '[data-testid="clipping-status"]',
    }),
  );
  kernel.register(
    createCameraPanel({
      fitButtonSelector: '[data-testid="view-fit"]',
      viewButtonSelectors: {
        FRONT: '[data-testid="view-front"]',
        TOP: '[data-testid="view-top"]',
        ISO: '[data-testid="view-iso"]',
      },
    }),
  );
  kernel.register(
    createViewpointPanel({
      saveButtonSelector: '[data-testid="viewpoint-save"]',
      listSelector: '[data-testid="viewpoint-list"]',
      restoreButtonSelector: '[data-testid="viewpoint-restore"]',
      removeButtonSelector: '[data-testid="viewpoint-remove"]',
    }),
  );
  kernel.register(createSelectionPanel({ selector: '[data-testid="selection-globalid"]' }));
  kernel.register(
    createSimulationPanel({
      fileInputSelector: '[data-testid="schedule-file"]',
      timeSliderSelector: '[data-testid="simulation-time"]',
      playButtonSelector: '[data-testid="simulation-play"]',
      speedSelectSelector: '[data-testid="simulation-speed"]',
      dateSelector: '[data-testid="simulation-date"]',
      statusSelector: '[data-testid="simulation-status"]',
    }),
  );
  kernel.register(
    createVisibilityPanel({
      hideButtonSelector: '[data-testid="hide-selected"]',
      isolateButtonSelector: '[data-testid="isolate-selected"]',
      showAllButtonSelector: '[data-testid="show-all"]',
      statusSelector: '[data-testid="visibility-status"]',
    }),
  );

  await kernel.start();

  let shuttingDown: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    shuttingDown ??= kernel.shutdown();
    return shuttingDown;
  };

  window.bim4d = {
    shutdown,
    // Shell은 이름을 문자열로 넘긴다. 계약의 키인지는 여기서 좁힌다.
    subscribe: (eventName, handler) =>
      kernel.context.events.subscribe(eventName as AppEventName, (event) => {
        handler(event.payload);
      }),
  };

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
