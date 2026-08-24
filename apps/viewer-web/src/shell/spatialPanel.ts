import type { AppComponent, AppContext, ModelId, ProductKey, Unsubscribe } from '@bim4d/contracts';
import type { SpatialTree, SpatialTreeNode } from '@bim4d/domain';
import { buildSpatialTree, collectProductGlobalIds, findSpatialNode } from '@bim4d/domain';

import '../viewer/model/modelEvents.js';
import '../viewer/selection/selectionEvents.js';
import type { SpatialTreePort } from '../viewer/spatial/spatialTreePort.js';

export interface SpatialPanelOptions {
  /** 트리를 그릴 요소의 CSS selector. */
  readonly selector: string;
  /** 공간 구조 조회 Port. 조회는 Event가 아니라 Port 직접 호출이다 (마스터 계획 5.3절). */
  readonly port: SpatialTreePort;
}

interface LoadedModel {
  readonly displayName: string;
  readonly tree: SpatialTree;
}

const IDLE_TEXT = '열린 모델 없음';

/** 트리 안에서 마디를 가리키는 키. 모델이 여럿이면 마디 id만으로는 겹칠 수 있다. */
const rowKey = (modelId: ModelId, nodeId: string): string => `${modelId}::${nodeId}`;

/**
 * IFC 공간 구조와 분류를 보여 주는 화면 조각.
 *
 * 모델을 열면 Port로 계층을 읽어 트리를 그리고, 마디를 누르면 그 아래 부재를 선택한다.
 * 선택 자체는 하지 않고 `viewer/select-products` Command만 보낸다. 숨김·격리는 이미
 * 선택을 보고 동작하므로 트리에서 고른 것에도 그대로 적용된다.
 */
export const createSpatialPanel = (options: SpatialPanelOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let container: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  /** 적재 순서를 유지한다. 트리도 같은 순서로 그린다. */
  const models = new Map<ModelId, LoadedModel>();
  /** 펼쳐 둔 마디. 다시 그려도 접고 편 상태가 유지된다. */
  const expanded = new Set<string>();

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const onNodeClick = (modelId: ModelId, nodeId: string): void => {
    const model = models.get(modelId);
    if (model === undefined) return;

    const node = findSpatialNode(model.tree.root, nodeId);
    if (node === null) return;

    const products: ProductKey[] = collectProductGlobalIds(node).map((globalId) => ({
      modelId,
      globalId,
    }));
    void requireContext().commands.dispatch('viewer/select-products', { products });
  };

  const renderNode = (modelId: ModelId, node: SpatialTreeNode): HTMLLIElement => {
    const item = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'spatial-row';

    const hasChildren = node.children.length > 0;
    const key = rowKey(modelId, node.id);
    const open = expanded.has(key);

    if (hasChildren) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'spatial-toggle';
      toggle.dataset['testid'] = 'spatial-toggle';
      toggle.dataset['nodeId'] = node.id;
      toggle.textContent = open ? '▾' : '▸';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '접기' : '펼치기');
      toggle.addEventListener('click', () => {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        render();
      });
      row.append(toggle);
    } else {
      // 자리를 비워 두면 잎 마디의 이름이 형제 마디와 어긋나 보인다.
      const spacer = document.createElement('span');
      spacer.className = 'spatial-toggle';
      spacer.setAttribute('aria-hidden', 'true');
      row.append(spacer);
    }

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'spatial-node';
    select.dataset['testid'] = 'spatial-node';
    select.dataset['nodeId'] = node.id;
    select.dataset['kind'] = node.kind;
    select.textContent = hasChildren ? `${node.label} (${String(node.productCount)})` : node.label;
    select.addEventListener('click', () => {
      onNodeClick(modelId, node.id);
    });
    row.append(select);
    item.append(row);

    if (hasChildren && open) {
      const list = document.createElement('ul');
      for (const child of node.children) list.append(renderNode(modelId, child));
      item.append(list);
    }
    return item;
  };

  const render = (): void => {
    if (container === null) return;

    if (models.size === 0) {
      const empty = document.createElement('p');
      empty.className = 'spatial-empty';
      empty.textContent = IDLE_TEXT;
      container.replaceChildren(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'spatial-tree';
    for (const [modelId, model] of models) {
      list.append(renderNode(modelId, model.tree.root));
    }
    container.replaceChildren(list);
  };

  /**
   * 모델 하나의 공간 구조를 읽어 트리에 더한다.
   *
   * 읽는 사이에 모델이 해제될 수 있다. 그 경우 결과를 버린다.
   */
  const addModel = async (modelId: ModelId, displayName: string): Promise<void> => {
    const app = requireContext();

    const raw = await port.read(modelId);
    if (raw === null) {
      app.logger.warn('공간 구조를 읽지 못했다.', { modelId, displayName });
      return;
    }

    const tree = buildSpatialTree(raw);
    for (const issue of tree.issues) {
      // 원본 파일의 문제는 조용히 넘어가지 않는다 (AGENTS.md 2.2).
      app.logger.warn('공간 구조에서 식별자 문제를 발견했다.', {
        modelId,
        code: issue.code,
        count: issue.count,
        sample: issue.sample,
      });
    }

    models.set(modelId, { displayName, tree });
    // 모델 최상위는 펼친 채로 시작한다. 접힌 트리만 보이면 무엇이 열렸는지 알 수 없다.
    expanded.add(rowKey(modelId, tree.root.id));
    render();
  };

  const removeModel = (modelId: ModelId): void => {
    if (!models.delete(modelId)) return;

    for (const key of expanded) {
      if (key.startsWith(`${modelId}::`)) expanded.delete(key);
    }
    render();
  };

  return {
    id: 'shell.spatial-panel',

    initialize: (appContext: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`요소를 찾지 못했다: ${options.selector}`));
      }
      context = appContext;
      container = found;
      render();
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();
      if (subscriptions.length > 0) return Promise.resolve();

      subscriptions = [
        app.events.subscribe('model/loaded', ({ payload }) => {
          void addModel(payload.modelId, payload.displayName);
        }),
        app.events.subscribe('model/unloaded', ({ payload }) => {
          removeModel(payload.modelId);
        }),
      ];
      return Promise.resolve();
    },

    stop: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      models.clear();
      expanded.clear();
      container?.replaceChildren();
      container = null;
      context = null;
      return Promise.resolve();
    },
  };
};
