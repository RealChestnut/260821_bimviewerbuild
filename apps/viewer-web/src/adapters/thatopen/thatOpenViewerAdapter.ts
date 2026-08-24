import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as THREE from 'three';

import type { GlobalId, ModelId, ProductKey } from '@bim4d/contracts';
import type { RawSpatialNode } from '@bim4d/domain';
import { formatIfcValue } from '@bim4d/domain';

import type { DisplayStateChange, SimulationViewPort } from '../../simulation/simulationPort.js';
import type { ModelLoaderPort, ModelLoadRequest } from '../../viewer/model/modelLoaderPort.js';
import type { VisibilityPort } from '../../viewer/visibility/visibilityPort.js';
import type { SelectionHit, SelectionPort } from '../../viewer/selection/selectionPort.js';
import type {
  ProductProperties,
  PropertyEntry,
  PropertyPort,
  PropertySetEntry,
} from '../../viewer/property/propertyPort.js';
import type { CameraPort, CameraView } from '../../viewer/camera/cameraPort.js';
import type {
  SectionAxis,
  SectionPlaneState,
  SectionPort,
} from '../../viewer/section/sectionPort.js';
import type { SpatialTreePort } from '../../viewer/spatial/spatialTreePort.js';
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
  readonly spatialTree: SpatialTreePort;
  readonly properties: PropertyPort;
  readonly section: SectionPort;
  readonly camera: CameraPort;
  readonly simulation: SimulationViewPort;
}

/**
 * fragments가 돌려주는 항목의 값 표현. 속성 하나는 `{ value, type }` 꼴이고,
 * 관계로 딸려 온 객체는 같은 모양의 항목 배열이다.
 */
type ItemField = { readonly value?: unknown; readonly type?: unknown } | readonly unknown[];

/** fragments가 붙이는 내부 필드와 속성 이름 자리. 값 자리를 찾을 때 건너뛴다. */
const NON_VALUE_FIELDS = new Set([
  '_category',
  '_localId',
  '_guid',
  'Name',
  'Description',
  'Specification',
  'Unit',
]);

const fieldOf = (item: Readonly<Record<string, unknown>>, key: string): ItemField | null => {
  const found: unknown = item[key];
  if (found === null || typeof found !== 'object') return null;
  return found;
};

const stringField = (item: Readonly<Record<string, unknown>>, key: string): string | null => {
  const field = fieldOf(item, key);
  if (field === null || Array.isArray(field)) return null;

  const value = (field as { readonly value?: unknown }).value;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const typeOf = (field: { readonly type?: unknown }): string | null =>
  typeof field.type === 'string' ? field.type : null;

/**
 * 속성 항목 하나에서 값 자리를 찾는다.
 *
 * 값이 들어가는 필드 이름은 Property Entity와 Quantity Class마다 다르다
 * (`NominalValue`, `AreaValue`, `LengthValue` …, 기준서 10.1절과 11절).
 * 이름 목록을 코드에 굳히면 새 Entity가 나올 때마다 값이 사라진다. 이름 대신
 * "내부 필드도 이름 자리도 아닌 첫 필드"를 값으로 본다.
 */
const readPropertyEntry = (item: Readonly<Record<string, unknown>>): PropertyEntry | null => {
  const name = stringField(item, 'Name');
  if (name === null) return null;

  for (const key of Object.keys(item)) {
    if (NON_VALUE_FIELDS.has(key)) continue;

    const field = fieldOf(item, key);
    if (field === null) continue;

    if (Array.isArray(field)) {
      return { name, value: formatIfcValue(field), type: null };
    }
    const single = field as { readonly value?: unknown; readonly type?: unknown };
    return { name, value: formatIfcValue(single.value, typeOf(single)), type: typeOf(single) };
  }
  return { name, value: '', type: null };
};

/**
 * `getItemsData`가 돌려준 항목에서 이름을 읽는다.
 *
 * 속성 값의 타입은 파일마다 다르므로 문자열일 때만 받는다. 이름이 없는 객체는 정상이다
 * (기준서 7절). 없으면 null을 돌려주고 표시 이름은 상위에서 정한다.
 */
const readItemName = (item: Readonly<Record<string, unknown>>): string | null => {
  const attribute = item['Name'];
  if (typeof attribute !== 'object' || attribute === null) return null;

  const value: unknown = (attribute as { value?: unknown }).value;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

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

    resolve: async (products): Promise<readonly SelectionHit[]> => {
      const current = state;
      if (current === null || products.length === 0) return [];

      const fragments = current.components.get(OBC.FragmentsManager);
      // 모델별로 나눠 묻는다. 한 번에 물으면 어느 GlobalId가 어느 번호인지 짝을 잃는다.
      const byModel = new Map<ModelId, GlobalId[]>();
      for (const product of products) {
        const bucket = byModel.get(product.modelId);
        if (bucket === undefined) byModel.set(product.modelId, [product.globalId]);
        else bucket.push(product.globalId);
      }

      const hits: SelectionHit[] = [];
      for (const [modelId, globalIds] of byModel) {
        const fragmentsModelId = current.models.get(modelId);
        if (fragmentsModelId === undefined) continue;

        const model = fragments.list.get(fragmentsModelId);
        if (model === undefined) continue;

        // getLocalIdsByGuids는 입력 순서를 지킨다. 없는 GlobalId 자리에는 null이 온다.
        const localIds = await model.getLocalIdsByGuids([...globalIds]);
        localIds.forEach((localId, index) => {
          const globalId = globalIds[index];
          if (localId === null || globalId === undefined) return;
          hits.push({ modelId, globalId, localId });
        });
      }
      return hits;
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

  /** 영구 키 목록을 Adapter 내부 식별자 묶음으로 되돌린다. */
  const toItems = async (
    current: ViewerState,
    products: readonly ProductKey[],
  ): Promise<Record<string, Set<number>>> => {
    if (products.length === 0) return {};

    // GlobalId는 파일 안에서만 고유하다. 연합 모델에서 같은 파일이 두 번 열려 있으면
    // 같은 GlobalId가 두 모델에 존재하는데, guidsToModelIdMap은 열린 모델을 전부 뒤진다.
    // 영구 키가 지목한 모델의 것만 남겨야 한쪽만 숨기거나 격리할 수 있다.
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

    setModelVisible: async (modelId, visible): Promise<void> => {
      const current = state;
      const fragmentsModelId = current?.models.get(modelId);
      if (current === null || fragmentsModelId === undefined) return;

      const fragments = current.components.get(OBC.FragmentsManager);
      const model = fragments.list.get(fragmentsModelId);
      if (model === undefined) return;

      // localId를 주지 않으면 모델 전체가 대상이다.
      await model.setVisible(undefined, visible);
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

  /**
   * fragments가 읽어 둔 공간 구조를 Port 계약의 모양으로 옮긴다.
   *
   * 계층 자체는 fragments가 `IfcRelAggregates`와 `IfcRelContainedInSpatialStructure`를
   * 풀어 만든 결과다. 여기서는 Adapter 내부 번호를 영구 키(GlobalId)와 이름으로 바꾼다.
   */
  const spatialTree: SpatialTreePort = {
    read: async (modelId: ModelId): Promise<RawSpatialNode | null> => {
      const current = state;
      const fragmentsModelId = current?.models.get(modelId);
      if (current === null || fragmentsModelId === undefined) return null;

      const fragments = current.components.get(OBC.FragmentsManager);
      const model = fragments.list.get(fragmentsModelId);
      if (model === undefined) return null;

      const structure = await model.getSpatialStructure();

      const localIds: number[] = [];
      const collect = (item: FRAGS.SpatialTreeItem): void => {
        if (item.localId !== null) localIds.push(item.localId);
        for (const child of item.children ?? []) collect(child);
      };
      collect(structure);

      const globalIds = new Map<number, GlobalId>();
      const names = new Map<number, string>();

      // 빈 배열을 넘기면 모델 전체를 돌려주므로 (fragments 3.4.7) 길이를 먼저 본다.
      if (localIds.length > 0) {
        const guids = await model.getGuidsByLocalIds(localIds);
        guids.forEach((guid, index) => {
          const localId = localIds[index];
          if (guid === null || localId === undefined) return;
          globalIds.set(localId, guid as GlobalId);
        });

        // 이름 하나만 읽는다. Pset까지 따라가면 트리 한 번 그리는 데 파일 전체를 훑는다.
        const items = await model.getItemsData(localIds, {
          attributesDefault: false,
          attributes: ['Name'],
          relationsDefault: { attributes: false, relations: false },
        });
        items.forEach((item, index) => {
          const localId = localIds[index];
          const name = readItemName(item);
          if (localId === undefined || name === null) return;
          names.set(localId, name);
        });
      }

      /**
       * fragments의 트리는 분류 마디와 객체 마디를 번갈아 놓는다. 분류 마디는 `localId`가
       * 없고 `category`만 있으며, 그 아래에 같은 분류의 객체가 온다. 분류는 객체에 물려주고
       * 마디 자체는 없앤다. 묶는 방식은 도메인이 정한다.
       */
      const flatten = (item: FRAGS.SpatialTreeItem, inherited: string | null): RawSpatialNode[] => {
        const children = item.children ?? [];
        const category = item.category ?? inherited;

        if (item.localId === null) {
          return children.flatMap((child) => flatten(child, category));
        }
        return [
          {
            category,
            name: names.get(item.localId) ?? null,
            globalId: globalIds.get(item.localId) ?? null,
            children: children.flatMap((child) => flatten(child, null)),
          },
        ];
      };

      const roots = flatten(structure, null);
      const [first] = roots;
      if (roots.length === 1 && first !== undefined) return first;

      // IfcProject가 여럿이거나 하나도 없는 파일이다. 화면에서는 한 뿌리로 묶어 보여 준다.
      return { category: null, name: null, globalId: null, children: roots };
    },
  };

  /**
   * 부재 하나의 Attribute와 PropertySet / QuantitySet을 읽는다.
   *
   * `IsDefinedBy` 관계만 따라간다 (기준서 12절). 원본에 있는 Set은 이름이나 접두어로
   * 거르지 않고 전량 싣는다 (AGENTS.md 2.4절).
   */
  const properties: PropertyPort = {
    read: async (product): Promise<ProductProperties | null> => {
      const current = state;
      const fragmentsModelId = current?.models.get(product.modelId);
      if (current === null || fragmentsModelId === undefined) return null;

      const fragments = current.components.get(OBC.FragmentsManager);
      const model = fragments.list.get(fragmentsModelId);
      if (model === undefined) return null;

      const [localId] = await model.getLocalIdsByGuids([product.globalId]);
      if (localId === null || localId === undefined) return null;

      const [data] = await model.getItemsData([localId], {
        attributesDefault: true,
        relations: {
          IsDefinedBy: { attributes: true, relations: true },
          DefinesOccurrence: { attributes: false, relations: false },
        },
        relationsDefault: { attributes: false, relations: false },
      });
      if (data === undefined) return null;

      const item: Readonly<Record<string, unknown>> = data;

      const attributes: PropertyEntry[] = [];
      for (const key of Object.keys(item)) {
        // 내부 필드와 관계는 Attribute가 아니다. 관계는 아래에서 따로 다룬다.
        if (key.startsWith('_')) continue;

        const field = fieldOf(item, key);
        if (field === null || Array.isArray(field)) continue;

        const single = field as { readonly value?: unknown; readonly type?: unknown };
        attributes.push({
          name: key,
          value: formatIfcValue(single.value, typeOf(single)),
          type: typeOf(single),
        });
      }

      const sets: PropertySetEntry[] = [];
      const definitions = fieldOf(item, 'IsDefinedBy');
      if (definitions !== null && Array.isArray(definitions)) {
        for (const raw of definitions) {
          if (raw === null || typeof raw !== 'object') continue;

          const definition: Readonly<Record<string, unknown>> = raw as Record<string, unknown>;
          const name = stringField(definition, 'Name');

          // PropertySet은 HasProperties, QuantitySet은 Quantities에 항목을 담는다.
          const entries: PropertyEntry[] = [];
          for (const key of Object.keys(definition)) {
            const field = fieldOf(definition, key);
            if (field === null || !Array.isArray(field)) continue;

            for (const member of field) {
              if (member === null || typeof member !== 'object') continue;
              const entry = readPropertyEntry(member as Record<string, unknown>);
              if (entry !== null) entries.push(entry);
            }
          }

          sets.push({ name: name ?? '(이름 없는 Set)', properties: entries });
        }
      }

      return {
        product,
        category: stringField(item, '_category'),
        name: stringField(item, 'Name'),
        attributes,
        sets,
      };
    },
  };

  /** 축 이름을 자르는 방향의 법선으로 바꾼다. */
  const AXIS_NORMALS: Record<SectionAxis, readonly [number, number, number]> = {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
  };

  /**
   * 단면 평면을 다룬다.
   *
   * 평면은 World에 속하므로 Clipper도 World와 같은 `Components`에서 가져온다.
   * 만든 평면은 화면에서 gizmo로 끌어 옮길 수 있다.
   */
  const section: SectionPort = {
    createAxisPlane: (axis): Promise<string | null> => {
      const current = state;
      if (current === null || current.models.size === 0) return Promise.resolve(null);

      const boxer = current.components.get(OBC.BoundingBoxer);
      boxer.dispose();
      boxer.addFromModels();
      const box = boxer.get();
      boxer.dispose();
      if (box.isEmpty()) return Promise.resolve(null);

      const clipper = current.components.get(OBC.Clipper);
      clipper.enabled = true;

      // 모델 한가운데를 지나게 둔다. 끝에서 시작하면 아무것도 잘리지 않아 만든 티가 안 난다.
      const center = box.getCenter(new THREE.Vector3());
      const normal = new THREE.Vector3(...AXIS_NORMALS[axis]);
      return Promise.resolve(
        clipper.createFromNormalAndCoplanarPoint(current.world, normal, center),
      );
    },

    remove: async (planeId): Promise<boolean> => {
      const current = state;
      if (current === null) return false;

      const clipper = current.components.get(OBC.Clipper);
      if (!clipper.list.has(planeId)) return false;

      await clipper.delete(current.world, planeId);
      return true;
    },

    removeAll: (): Promise<number> => {
      const current = state;
      if (current === null) return Promise.resolve(0);

      const clipper = current.components.get(OBC.Clipper);
      const removed = clipper.list.size;
      clipper.deleteAll();
      return Promise.resolve(removed);
    },

    describe: (): Promise<readonly SectionPlaneState[]> => {
      const current = state;
      if (current === null) return Promise.resolve([]);

      const clipper = current.components.get(OBC.Clipper);
      const planes: SectionPlaneState[] = [];
      for (const plane of clipper.list.values()) {
        // 사용자가 gizmo로 끌어 옮긴 위치가 그대로 담긴다.
        planes.push({
          normal: [plane.normal.x, plane.normal.y, plane.normal.z],
          origin: [plane.origin.x, plane.origin.y, plane.origin.z],
        });
      }
      return Promise.resolve(planes);
    },

    restore: (planes): Promise<readonly string[]> => {
      const current = state;
      if (current === null) return Promise.resolve([]);

      const clipper = current.components.get(OBC.Clipper);
      clipper.deleteAll();
      if (planes.length === 0) return Promise.resolve([]);

      clipper.enabled = true;
      clipper.visible = true;

      const ids = planes.map((plane) =>
        clipper.createFromNormalAndCoplanarPoint(
          current.world,
          new THREE.Vector3(...plane.normal),
          new THREE.Vector3(...plane.origin),
        ),
      );
      return Promise.resolve(ids);
    },

    setEnabled: (enabled): Promise<void> => {
      const current = state;
      if (current === null) return Promise.resolve();

      const clipper = current.components.get(OBC.Clipper);
      clipper.enabled = enabled;
      // 자르기를 멈추면 gizmo도 함께 숨긴다. 잘리지 않는 평면만 떠 있으면 오해를 부른다.
      clipper.visible = enabled;
      return Promise.resolve();
    },
  };

  /**
   * 카메라를 다룬다.
   *
   * 상태를 여기에 따로 기억하지 않는다. 사용자가 마우스로 돌린 뒤에도 진실은 controls
   * 하나뿐이고, 물어볼 때마다 지금 값을 읽는다.
   */
  const camera: CameraPort = {
    getView: (): Promise<CameraView | null> => {
      const current = state;
      if (current === null) return Promise.resolve(null);

      const controls = current.world.camera.controls;
      const position = controls.getPosition(new THREE.Vector3());
      const target = controls.getTarget(new THREE.Vector3());

      return Promise.resolve({
        position: [position.x, position.y, position.z],
        target: [target.x, target.y, target.z],
      });
    },

    setView: async (view, options): Promise<void> => {
      const current = state;
      if (current === null) return;

      const [px, py, pz] = view.position;
      const [tx, ty, tz] = view.target;
      await current.world.camera.controls.setLookAt(
        px,
        py,
        pz,
        tx,
        ty,
        tz,
        options?.animate ?? true,
      );
    },

    fitToModels: async (): Promise<boolean> => {
      const current = state;
      if (current === null || current.models.size === 0) return false;

      await fitToLoadedModels(current);
      return true;
    },
  };

  const productsWith = (
    changes: readonly DisplayStateChange[],
    ...states: readonly DisplayStateChange['state'][]
  ): readonly ProductKey[] =>
    changes.filter((change) => states.includes(change.state)).map((change) => change.product);

  /**
   * 4D 시뮬레이션 표현 (ADR-0005).
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

  return {
    worldFactory,
    modelLoader,
    selection,
    visibility,
    spatialTree,
    properties,
    section,
    camera,
    simulation,
  };
};
