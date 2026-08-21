import * as OBC from '@thatopen/components';

import type { ModelId } from '@bim4d/contracts';

import type { ModelLoaderPort, ModelLoadRequest } from '../../viewer/model/modelLoaderPort.js';
import type { ViewerWorld, ViewerWorldFactory } from '../../viewer/viewerWorldPort.js';

export interface ThatOpenViewerAdapterOptions {
  /**
   * web-ifc WASM이 놓인 경로. 기본값은 앱과 함께 배포되는 `/vendor/web-ifc/`다.
   * That Open 기본 동작(unpkg에서 내려받기)은 오프라인 데스크톱에서 쓸 수 없다 (ADR-0004).
   */
  readonly wasmPath?: string;
  /** fragments worker 파일 경로. 마찬가지로 앱과 함께 배포한다. */
  readonly workerUrl?: string;
  /** 카메라 초기 위치와 바라보는 지점. 단위는 미터다. */
  readonly initialCamera?: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
  };
}

const DEFAULTS = {
  wasmPath: '/vendor/web-ifc/',
  workerUrl: '/vendor/fragments/worker.mjs',
  initialCamera: {
    position: [12, 8, 12],
    target: [0, 0, 0],
  },
} as const;

interface ViewerState {
  readonly components: OBC.Components;
  readonly world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;
  readonly models: Map<ModelId, string>;
  loaderReady: Promise<void> | null;
}

export interface ThatOpenViewerAdapter {
  readonly worldFactory: ViewerWorldFactory;
  readonly modelLoader: ModelLoaderPort;
}

/**
 * That Open Components Adapter.
 *
 * World와 IFC 적재는 같은 `Components` 인스턴스를 공유해야 하므로 한 Adapter가 함께 소유한다.
 * `@thatopen/components`를 직접 참조하는 곳은 이 파일뿐이고, Feature는 Port만 본다.
 */
export const createThatOpenViewerAdapter = (
  options: ThatOpenViewerAdapterOptions = {},
): ThatOpenViewerAdapter => {
  const wasmPath = options.wasmPath ?? DEFAULTS.wasmPath;
  const workerUrl = options.workerUrl ?? DEFAULTS.workerUrl;
  const initialCamera = options.initialCamera ?? DEFAULTS.initialCamera;

  let state: ViewerState | null = null;

  const requireState = (): ViewerState => {
    if (state === null) {
      throw new Error('Viewer World가 없다. World를 먼저 만들어야 모델을 적재할 수 있다.');
    }
    return state;
  };

  /**
   * fragments worker와 web-ifc WASM은 처음 적재할 때 준비한다.
   * World만 띄우고 모델을 열지 않는 경우 WASM을 내려받지 않게 하려는 것이다.
   */
  const ensureLoaderReady = (current: ViewerState): Promise<void> => {
    current.loaderReady ??= (async (): Promise<void> => {
      const fragments = current.components.get(OBC.FragmentsManager);
      if (!fragments.initialized) {
        fragments.init(workerUrl);
      }

      const ifcLoader = current.components.get(OBC.IfcLoader);
      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: { path: wasmPath, absolute: true },
      });
    })();
    return current.loaderReady;
  };

  const worldFactory: ViewerWorldFactory = {
    create: (container: HTMLElement): ViewerWorld => {
      const components = new OBC.Components();
      const worlds = components.get(OBC.Worlds);
      const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();

      world.scene = new OBC.SimpleScene(components);
      world.renderer = new OBC.SimpleRenderer(components, container);
      world.camera = new OBC.SimpleCamera(components);

      components.init();
      world.scene.setup();

      const [px, py, pz] = initialCamera.position;
      const [tx, ty, tz] = initialCamera.target;
      void world.camera.controls.setLookAt(px, py, pz, tx, ty, tz);

      state = { components, world, models: new Map(), loaderReady: null };
      const created = state;
      let disposed = false;

      return {
        id: world.uuid,

        setEnabled: (enabled: boolean): void => {
          if (disposed) return;
          world.enabled = enabled;
        },

        dispose: (): void => {
          if (disposed) return;
          disposed = true;
          created.models.clear();
          // components.dispose()가 World, Renderer, FragmentsManager를 함께 해제한다.
          components.dispose();
          if (state === created) state = null;
        },
      };
    },
  };

  const modelLoader: ModelLoaderPort = {
    load: async (request: ModelLoadRequest): Promise<void> => {
      const current = requireState();
      await ensureLoaderReady(current);

      const ifcLoader = current.components.get(OBC.IfcLoader);
      const fragments = current.components.get(OBC.FragmentsManager);

      const model = await ifcLoader.load(request.bytes, true, request.displayName, {
        processData: {
          progressCallback: (progress: number) => {
            request.onProgress?.(progress);
          },
        },
      });

      model.useCamera(current.world.camera.three);
      current.world.scene.three.add(model.object);
      current.models.set(request.modelId, model.modelId);

      await fragments.core.update(true);
    },

    unload: async (modelId: ModelId): Promise<boolean> => {
      const current = state;
      const fragmentsModelId = current?.models.get(modelId);
      if (current === null || fragmentsModelId === undefined) return false;

      const fragments = current.components.get(OBC.FragmentsManager);
      const model = fragments.list.get(fragmentsModelId);
      if (model !== undefined) {
        current.world.scene.three.remove(model.object);
      }

      await fragments.core.disposeModel(fragmentsModelId);
      current.models.delete(modelId);

      // 해제 뒤에는 강제 update를 호출하지 않는다. 남은 모델이 없을 때 `update(true)`가
      // worker 응답을 기다리며 돌아오지 않는 경우가 있다 (fragments 3.4.7).
      // Scene에서는 이미 object를 뺐으므로 다음 렌더 프레임에 화면이 갱신된다.
      return true;
    },

    loadedModelIds: (): readonly ModelId[] => [...(state?.models.keys() ?? [])],
  };

  return { worldFactory, modelLoader };
};
