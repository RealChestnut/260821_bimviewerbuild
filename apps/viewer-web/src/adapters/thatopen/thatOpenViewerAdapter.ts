import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';

import type { GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import type { ModelLoaderPort, ModelLoadRequest } from '../../viewer/model/modelLoaderPort.js';
import type { VisibilityPort } from '../../viewer/visibility/visibilityPort.js';
import type { SelectionHit, SelectionPort } from '../../viewer/selection/selectionPort.js';
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
  /** 선택 강조 색. 기본값은 파랑이다. */
  readonly highlightColor?: number;
}

const DEFAULTS = {
  wasmPath: '/vendor/web-ifc/',
  workerUrl: '/vendor/fragments/worker.mjs',
  initialCamera: {
    position: [12, 8, 12],
    target: [0, 0, 0],
  },
  highlightColor: 0x2f7de1,
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
  readonly selection: SelectionPort;
  readonly visibility: VisibilityPort;
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
  const highlightColor = options.highlightColor ?? DEFAULTS.highlightColor;

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

  /** Adapter 내부의 fragments 모델 id를 우리 ModelId로 되돌린다. */
  const toModelId = (current: ViewerState, fragmentsModelId: string): ModelId | undefined => {
    for (const [modelId, id] of current.models) {
      if (id === fragmentsModelId) return modelId;
    }
    return undefined;
  };

  /**
   * 적재한 모델 전체가 보이도록 카메라를 맞춘다.
   *
   * 측량 좌표계로 저장된 모델은 원점에서 수 킬로미터 떨어져 있어, 맞추지 않으면 화면에
   * 아무것도 보이지 않는다.
   */
  const fitToLoadedModels = async (current: ViewerState): Promise<void> => {
    const boxer = current.components.get(OBC.BoundingBoxer);
    boxer.dispose();
    boxer.addFromModels();
    const box = boxer.get();
    boxer.dispose();

    if (box.isEmpty()) return;

    // fitToBox는 카메라를 축에 맞춰 돌려 버려서 모델을 정면이나 옆면으로 보게 된다.
    // 방향은 초기 시점과 같은 대각선으로 유지하고 거리만 모델 크기에 맞춘다.
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const direction = new THREE.Vector3(...initialCamera.position)
      .sub(new THREE.Vector3(...initialCamera.target))
      .normalize();
    const position = center.clone().add(direction.multiplyScalar(radius * 2.5));

    await current.world.camera.controls.setLookAt(
      position.x,
      position.y,
      position.z,
      center.x,
      center.y,
      center.z,
      false,
    );
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
      await fitToLoadedModels(current);
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

  const selection: SelectionPort = {
    pickAt: async (point): Promise<SelectionHit | null> => {
      const current = state;
      if (current === null || current.models.size === 0) return null;

      const canvas = current.world.renderer?.three.domElement;
      if (canvas === undefined) return null;

      const fragments = current.components.get(OBC.FragmentsManager);
      if (!fragments.initialized) return null;

      // raycast의 mouse는 client 좌표를 그대로 받는다. 내부에서 캔버스 사각형으로 정규화한다.
      const result = await fragments.raycast({
        camera: current.world.camera.three,
        mouse: new THREE.Vector2(point.clientX, point.clientY),
        dom: canvas,
      });
      if (result === undefined) return null;

      const modelId = toModelId(current, result.fragments.modelId);
      if (modelId === undefined) return null;

      const guids = await fragments.modelIdMapToGuids({
        [result.fragments.modelId]: new Set([result.localId]),
      });
      const globalId = guids[0];
      // GlobalId가 없는 객체는 영구 키를 만들 수 없으므로 선택 대상에서 제외한다.
      if (globalId === undefined) return null;

      return { modelId, globalId: globalId as GlobalId, localId: result.localId };
    },

    highlight: async (hits): Promise<void> => {
      const current = state;
      if (current === null) return;

      // 여러 모델에 걸친 선택도 한 번의 호출로 강조한다.
      const items: Record<string, Set<number>> = {};
      for (const hit of hits) {
        const fragmentsModelId = current.models.get(hit.modelId);
        if (fragmentsModelId === undefined) continue;
        (items[fragmentsModelId] ??= new Set()).add(hit.localId);
      }

      const fragments = current.components.get(OBC.FragmentsManager);
      await fragments.resetHighlight();
      if (Object.keys(items).length === 0) return;

      await fragments.highlight(
        {
          color: new THREE.Color(highlightColor),
          opacity: 1,
          transparent: false,
          renderedFaces: FRAGS.RenderedFaces.TWO,
        },
        items,
      );
      await fragments.core.update(true);
    },

    clearHighlight: async (): Promise<void> => {
      const current = state;
      if (current === null) return;

      const fragments = current.components.get(OBC.FragmentsManager);
      if (!fragments.initialized) return;
      await fragments.resetHighlight();

      // 남은 모델이 없을 때의 강제 update는 돌아오지 않을 수 있다 (ADR-0004).
      if (current.models.size > 0) {
        await fragments.core.update(true);
      }
    },
  };

  /** 영구 키 목록을 Adapter 내부 식별자 묶음으로 되돌린다. */
  const toItems = async (
    current: ViewerState,
    products: readonly ProductKey[],
  ): Promise<Record<string, Set<number>>> => {
    const fragments = current.components.get(OBC.FragmentsManager);
    const globalIds = products.map((product) => product.globalId);
    return globalIds.length === 0 ? {} : await fragments.guidsToModelIdMap(globalIds);
  };

  const setVisibility = async (
    products: readonly ProductKey[],
    visible: boolean,
  ): Promise<void> => {
    const current = state;
    if (current === null || current.models.size === 0) return;

    const fragments = current.components.get(OBC.FragmentsManager);
    const items = await toItems(current, products);

    for (const [fragmentsModelId, localIds] of Object.entries(items)) {
      const model = fragments.list.get(fragmentsModelId);
      await model?.setVisible([...localIds], visible);
    }
    await fragments.core.update(true);
  };

  const visibility: VisibilityPort = {
    hide: (products) => setVisibility(products, false),

    show: (products) => setVisibility(products, true),

    isolate: async (products): Promise<void> => {
      const current = state;
      if (current === null || current.models.size === 0) return;

      const fragments = current.components.get(OBC.FragmentsManager);
      const items = await toItems(current, products);

      // 먼저 모두 감춘 뒤 대상만 되돌린다. 남길 부재가 없는 모델도 함께 가려진다.
      for (const model of fragments.list.values()) {
        await model.setVisible(undefined, false);
      }
      for (const [fragmentsModelId, localIds] of Object.entries(items)) {
        const model = fragments.list.get(fragmentsModelId);
        await model?.setVisible([...localIds], true);
      }
      await fragments.core.update(true);
    },

    showAll: async (): Promise<void> => {
      const current = state;
      if (current === null || current.models.size === 0) return;

      const fragments = current.components.get(OBC.FragmentsManager);
      for (const model of fragments.list.values()) {
        await model.resetVisible();
      }
      await fragments.core.update(true);
    },
  };

  return { worldFactory, modelLoader, selection, visibility };
};
