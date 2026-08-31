import type { AppEventName, ModelId } from '@bim4d/contracts';

import { createInMemoryModelRepository } from './adapters/inMemoryModelRepository.js';
import { createInMemoryScheduleRepository } from './adapters/inMemoryScheduleRepository.js';
import { createThatOpenViewerAdapter } from './adapters/thatopen/thatOpenViewerAdapter.js';
import { createKernel } from './kernel/index.js';
import { createModelPanel } from './shell/modelPanel.js';
import { createModelListPanel } from './shell/modelListPanel.js';
import { createSelectionPanel } from './shell/selectionPanel.js';
import { createPropertyPanel } from './shell/propertyPanel.js';
import { createSectionPanel } from './shell/sectionPanel.js';
import { createViewpointPanel } from './shell/viewpointPanel.js';
import { createGanttPanel } from './shell/ganttPanel.js';
import { createSchedulerPanel } from './shell/schedulerPanel.js';
import { createSimulationPanel } from './shell/simulationPanel.js';
import { createSpatialPanel } from './shell/spatialPanel.js';
import { createVisibilityPanel } from './shell/visibilityPanel.js';
import { createStatusComponent } from './shell/statusComponent.js';
import { createModelLoadingComponent } from './viewer/model/modelLoadingComponent.js';
import { createCameraComponent } from './viewer/camera/cameraComponent.js';
import { createSectionComponent } from './viewer/section/sectionComponent.js';
import { createSelectionComponent } from './viewer/selection/selectionComponent.js';
import { createVisibilityComponent } from './viewer/visibility/visibilityComponent.js';
import { createViewerWorldComponent } from './viewer/viewerWorldComponent.js';
import { createViewpointComponent } from './viewer/viewpoint/viewpointComponent.js';
import { createSchedulerComponent } from './scheduler/schedulerComponent.js';
import { createSimulationComponent } from './simulation/simulationComponent.js';

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
  const scheduleRepository = createInMemoryScheduleRepository();

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
  kernel.register(createSectionComponent({ port: viewer.section }));
  kernel.register(createCameraComponent({ port: viewer.camera }));
  kernel.register(createViewpointComponent({ camera: viewer.camera, section: viewer.section }));
  kernel.register(createSchedulerComponent({ repository: scheduleRepository }));
  kernel.register(
    createSimulationComponent({ port: viewer.simulation, repository: scheduleRepository }),
  );
  kernel.register(
    createModelPanel({
      fileInputSelector: '[data-testid="model-file"]',
      unloadButtonSelector: '[data-testid="model-unload"]',
      statusSelector: '[data-testid="model-status"]',
    }),
  );
  kernel.register(createModelListPanel({ selector: '[data-testid="model-list"]' }));
  kernel.register(
    createSchedulerPanel({
      fileInputSelector: '[data-testid="schedule-file"]',
      panelSelector: '[data-testid="schedule-panel"]',
      nameSelector: '[data-testid="schedule-name"]',
      taskListSelector: '[data-testid="task-list"]',
      warningListSelector: '[data-testid="schedule-warnings"]',
      statusSelector: '[data-testid="schedule-status"]',
      exportJsonSelector: '[data-testid="schedule-export-json"]',
      exportCsvSelector: '[data-testid="schedule-export-csv"]',
    }),
  );
  kernel.register(
    createGanttPanel({
      panelSelector: '[data-testid="gantt"]',
      axisSelector: '[data-testid="gantt-axis"]',
      rowListSelector: '[data-testid="gantt-rows"]',
      cursorSelector: '[data-testid="gantt-cursor"]',
      statusSelector: '[data-testid="gantt-status"]',
    }),
  );
  kernel.register(
    createSimulationPanel({
      timeSliderSelector: '[data-testid="simulation-time"]',
      playButtonSelector: '[data-testid="simulation-play"]',
      speedSelectSelector: '[data-testid="simulation-speed"]',
      dateSelector: '[data-testid="simulation-date"]',
      statusSelector: '[data-testid="simulation-status"]',
    }),
  );
  kernel.register(createSelectionPanel({ selector: '[data-testid="selection-globalid"]' }));
  kernel.register(
    createSpatialPanel({
      selector: '[data-testid="spatial-tree"]',
      port: viewer.spatialTree,
    }),
  );
  kernel.register(
    createSectionPanel({
      axisButtonSelector: '[data-testid="section-axis"]',
      toggleButtonSelector: '[data-testid="section-toggle"]',
      clearButtonSelector: '[data-testid="section-clear"]',
      statusSelector: '[data-testid="section-status"]',
    }),
  );
  kernel.register(
    createViewpointPanel({
      saveButtonSelector: '[data-testid="viewpoint-save"]',
      fitButtonSelector: '[data-testid="camera-fit"]',
      listSelector: '[data-testid="viewpoint-list"]',
    }),
  );
  kernel.register(
    createPropertyPanel({
      selector: '[data-testid="property-panel"]',
      port: viewer.properties,
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
