import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';

import type { GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import type { ModelLoaderPort, ModelLoadRequest } from '../../viewer/model/modelLoaderPort.js';
import type { DisplayStateChange, SimulationViewPort } from '../../simulation/simulationPort.js';
import type { CameraPort, StandardView } from '../../viewer/camera/cameraPort.js';
import type { ClipAxis, ClippingPort } from '../../viewer/clipping/clippingPort.js';
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
  /** 4D 시뮬레이션에서 작업 진행 중인 부재의 색. 기본값은 주황이다. */
  readonly inProgressColor?: number;
}

const DEFAULTS = {
  wasmPath: '/vendor/web-ifc/',
  workerUrl: '/vendor/fragments/worker.mjs',
  initialCamera: {
    position: [12, 8, 12],
    target: [0, 0, 0],
  },
  highlightColor: 0x2f7de1,
  inProgressColor: 0xf59e0b,
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
  readonly simulation: SimulationViewPort;
  readonly clipping: ClippingPort;
  readonly camera: CameraPort;
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
  const inProgressColor = options.inProgressColor ?? DEFAULTS.inProgressColor;

  /**
   * 선택이 지금 강조하고 있는 항목.
   *
   * `resetHighlight()`를 인자 없이 부르면 화면의 모든 강조가 지워진다. 시뮬레이션도 같은
   * 강조 통로를 쓰므로, 선택은 자기가 건 것만 지워야 서로를 밀어내지 않는다.
   */
  let selectionItems: Record<string, Set<number>> = {};

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

      selectionItems = {};
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

  /** 열려 있는 모델 전체를 감싸는 상자. 아무것도 없으면 null. */
  const boundsOfModels = (current: ViewerState): THREE.Box3 | null => {
    const boxer = current.components.get(OBC.BoundingBoxer);
    boxer.dispose();
    boxer.addFromModels();
    const box = boxer.get();
    boxer.dispose();

    return box.isEmpty() ? null : box;
  };

  /** 초기 시점과 같은 대각선 방향. 등각 시점의 기준이기도 하다. */
  const isoDirection = (): THREE.Vector3 =>
    new THREE.Vector3(...initialCamera.position)
      .sub(new THREE.Vector3(...initialCamera.target))
      .normalize();

  /**
   * 주어진 방향에서 모델 전체가 보이도록 카메라를 놓는다.
   *
   * `fitToBox`는 카메라를 축에 맞춰 돌려 버리므로 쓰지 않는다. 방향은 호출자가 정하고
   * 거리만 모델 크기에 맞춘다. 측량 좌표계로 저장된 모델은 원점에서 수 킬로미터 떨어져
   * 있어, 맞추지 않으면 화면에 아무것도 보이지 않는다.
   */
  const frameModels = async (current: ViewerState, direction: THREE.Vector3): Promise<boolean> => {
    const box = boundsOfModels(current);
    if (box === null) return false;

    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const position = center.clone().add(
      direction
        .clone()
        .normalize()
        .multiplyScalar(radius * 2.5),
    );

    await current.world.camera.controls.setLookAt(
      position.x,
      position.y,
      position.z,
      center.x,
      center.y,
      center.z,
      false,
    );
    return true;
  };

  const fitToLoadedModels = async (current: ViewerState): Promise<void> => {
    await frameModels(current, isoDirection());
  };

  const modelLoader: ModelLoaderPort = {
    load: async (request: ModelLoadRequest): Promise<void> => {
      const current = requireState();
      await ensureLoaderReady(current);

      const ifcLoader = current.components.get(OBC.IfcLoader);
      const fragments = current.components.get(OBC.FragmentsManager);

      // fragments는 세 번째 인자를 모델 식별자로 쓴다. 연합 모델에서는 같은 파일을 두 번
      // 열 수 있으므로 파일명만으로는 충돌한다. 우리 modelId를 덧붙여 고유하게 만든다.
      const fragmentsModelName = `${request.displayName}#${request.modelId}`;
      const model = await ifcLoader.load(request.bytes, true, fragmentsModelName, {
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
      if (Object.keys(selectionItems).length > 0) await fragments.resetHighlight(selectionItems);
      selectionItems = items;

      if (Object.keys(items).length === 0) {
        await fragments.core.update(true);
        return;
      }

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

      if (Object.keys(selectionItems).length > 0) await fragments.resetHighlight(selectionItems);
      selectionItems = {};

      // 남은 모델이 없을 때의 강제 update는 돌아오지 않을 수 있다 (ADR-0004).
      if (current.models.size > 0) {
        await fragments.core.update(true);
      }
    },
  };

  /**
   * 영구 키 목록을 Adapter 내부 식별자 묶음으로 되돌린다.
   *
   * GlobalId는 파일 안에서만 고유하다. 연합 모델에서 같은 파일이 두 번 열려 있으면
   * 같은 GlobalId가 두 모델에 존재하는데, `guidsToModelIdMap`은 열린 모델을 전부 뒤진다.
   * 영구 키가 지목한 모델의 것만 남겨야 한쪽만 숨기거나 격리할 수 있다.
   */
  const toItems = async (
    current: ViewerState,
    products: readonly ProductKey[],
  ): Promise<Record<string, Set<number>>> => {
    if (products.length === 0) return {};

    const byModel = new Map<ModelId, GlobalId[]>();
    for (const product of products) {
      const bucket = byModel.get(product.modelId);
      if (bucket === undefined) {
        byModel.set(product.modelId, [product.globalId]);
      } else {
        bucket.push(product.globalId);
      }
    }

    const fragments = current.components.get(OBC.FragmentsManager);
    const items: Record<string, Set<number>> = {};

    for (const [modelId, globalIds] of byModel) {
      const fragmentsModelId = current.models.get(modelId);
      if (fragmentsModelId === undefined) continue;

      const found = await fragments.guidsToModelIdMap(globalIds);
      const localIds = found[fragmentsModelId];
      if (localIds !== undefined) items[fragmentsModelId] = localIds;
    }
    return items;
  };

  /** 화면 갱신 없이 표시 여부만 바꾼다. 여러 묶음을 모아 한 번에 갱신할 때 쓴다. */
  const applyVisibility = async (
    current: ViewerState,
    products: readonly ProductKey[],
    visible: boolean,
  ): Promise<void> => {
    if (products.length === 0) return;

    const fragments = current.components.get(OBC.FragmentsManager);
    const items = await toItems(current, products);

    for (const [fragmentsModelId, localIds] of Object.entries(items)) {
      const model = fragments.list.get(fragmentsModelId);
      await model?.setVisible([...localIds], visible);
    }
  };

  const setVisibility = async (
    products: readonly ProductKey[],
    visible: boolean,
  ): Promise<void> => {
    const current = state;
    if (current === null || current.models.size === 0) return;

    await applyVisibility(current, products, visible);
    await current.components.get(OBC.FragmentsManager).core.update(true);
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

  const productsWith = (
    changes: readonly DisplayStateChange[],
    ...states: readonly DisplayStateChange['state'][]
  ): readonly ProductKey[] =>
    changes.filter((change) => states.includes(change.state)).map((change) => change.product);

  /**
   * 4D 시뮬레이션 표현 (ADR-0006).
   *
   * `HIDDEN`은 렌더링하지 않고, `IN_PROGRESS`는 반투명 주황으로 덧칠하며, `PRESENT`는
   * 원래 표현으로 되돌린다. 강조 통로는 선택과 공유하므로, 한 부재가 선택된 채로 시뮬레이션
   * 상태가 바뀌면 선택 강조가 지워진다. 알려진 한계이며 다시 누르면 복원된다.
   */
  const simulation: SimulationViewPort = {
    apply: async (changes): Promise<void> => {
      const current = state;
      if (current === null || current.models.size === 0 || changes.length === 0) return;

      const fragments = current.components.get(OBC.FragmentsManager);
      const inProgress = productsWith(changes, 'IN_PROGRESS');
      const settled = productsWith(changes, 'HIDDEN', 'PRESENT');

      // 진행 중에서 벗어난 부재의 덧칠을 먼저 지운다. 지우지 않으면 완료된 부재가 계속 주황이다.
      const cleared = await toItems(current, settled);
      if (Object.keys(cleared).length > 0) await fragments.resetHighlight(cleared);

      await applyVisibility(current, productsWith(changes, 'HIDDEN'), false);
      await applyVisibility(current, productsWith(changes, 'IN_PROGRESS', 'PRESENT'), true);

      const items = await toItems(current, inProgress);
      if (Object.keys(items).length > 0) {
        await fragments.highlight(
          {
            color: new THREE.Color(inProgressColor),
            opacity: 0.6,
            transparent: true,
            renderedFaces: FRAGS.RenderedFaces.TWO,
          },
          items,
        );
      }
      await fragments.core.update(true);
    },

    reset: async (products): Promise<void> => {
      const current = state;
      if (current === null || current.models.size === 0 || products.length === 0) return;

      const fragments = current.components.get(OBC.FragmentsManager);
      const items = await toItems(current, products);
      if (Object.keys(items).length > 0) await fragments.resetHighlight(items);

      await applyVisibility(current, products, true);
      await fragments.core.update(true);
    },
  };

  /**
   * 자를 방향의 법선. Viewer 좌표계 기준이며 Y가 수직이다.
   *
   * `Clipper.create(world)`는 마우스가 가리키는 곳에 평면을 만든다. 같은 조작이 화면 상태에
   * 따라 다른 결과를 내므로 쓰지 않고, 모델 중앙을 지나는 축 정렬 평면으로 만든다.
   */
  const AXIS_NORMALS: Readonly<Record<ClipAxis, readonly [number, number, number]>> = {
    X: [1, 0, 0],
    Y: [0, 1, 0],
    Z: [0, 0, 1],
  };

  const clipping: ClippingPort = {
    addAxisPlane: async (axis): Promise<string | null> => {
      const current = state;
      if (current === null || current.models.size === 0) return null;

      const box = boundsOfModels(current);
      if (box === null) return null;

      const clipper = current.components.get(OBC.Clipper);
      if (!clipper.isSetup) clipper.setup();
      clipper.enabled = true;

      // 평면은 재질 단위로 적용된다. 렌더러가 국소 클리핑을 켜 두지 않으면 아무것도 잘리지 않는다.
      const renderer = current.world.renderer;
      if (renderer !== null) renderer.three.localClippingEnabled = true;

      const [nx, ny, nz] = AXIS_NORMALS[axis];
      const center = box.getCenter(new THREE.Vector3());

      const planeId = clipper.createFromNormalAndCoplanarPoint(
        current.world,
        new THREE.Vector3(nx, ny, nz),
        center,
      );
      await current.components.get(OBC.FragmentsManager).core.update(true);
      return planeId;
    },

    removeAll: async (): Promise<void> => {
      const current = state;
      if (current === null) return;

      const clipper = current.components.get(OBC.Clipper);
      clipper.deleteAll();
      clipper.enabled = false;

      if (current.models.size > 0) {
        await current.components.get(OBC.FragmentsManager).core.update(true);
      }
    },
  };

  const camera: CameraPort = {
    fitToModels: async (): Promise<boolean> => {
      const current = state;
      if (current === null) return false;
      return await frameModels(current, isoDirection());
    },

    setStandardView: async (view: StandardView): Promise<boolean> => {
      const current = state;
      if (current === null) return false;

      // 평면도는 정확히 수직으로 내려다보면 카메라의 up 벡터와 시선이 겹쳐 방향이 불안정해진다.
      // 아주 조금 기울여 그 축퇴를 피한다.
      const directions: Readonly<Record<StandardView, THREE.Vector3>> = {
        FRONT: new THREE.Vector3(0, 0, 1),
        TOP: new THREE.Vector3(0, 1, 0.0001),
        ISO: isoDirection(),
      };
      return await frameModels(current, directions[view]);
    },
  };

  return { worldFactory, modelLoader, selection, visibility, simulation, clipping, camera };
};
