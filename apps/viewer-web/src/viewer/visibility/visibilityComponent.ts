import type { AppComponent, AppContext, ModelId, ProductKey, Unsubscribe } from '@bim4d/contracts';

import '../model/modelEvents.js';
import './visibilityEvents.js';

import type { VisibilityPort } from './visibilityPort.js';

export interface VisibilityComponentOptions {
  readonly port: VisibilityPort;
}

const keyOf = (product: ProductKey): string => `${product.modelId}::${product.globalId}`;

/**
 * 부재 숨김·표시·격리를 다루는 Component.
 *
 * 직접 감춘 목록과 격리는 서로 배타적으로 다룬다. 격리는 "고른 것만 보이기"이므로
 * 그 전에 감춰 둔 목록을 유지하면 격리를 풀었을 때 무엇이 왜 안 보이는지 설명하기 어렵다.
 */
export const createVisibilityComponent = (options: VisibilityComponentOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  /** 사용자가 직접 감춘 부재. 격리로 가려진 부재는 여기에 넣지 않는다. */
  const hidden = new Map<string, ProductKey>();
  /** 격리 중이면 그 대상. 비어 있으면 격리 중이 아니다. */
  let isolatedTo: ProductKey[] = [];
  /** 통째로 감춘 모델. 부재 단위 숨김과 따로 다룬다. */
  const hiddenModels = new Set<ModelId>();

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const publishState = async (): Promise<void> => {
    await requireContext().events.publish('visibility/changed', {
      hiddenCount: hidden.size,
      isolated: isolatedTo.length > 0,
      hidden: [...hidden.values()],
      isolatedProducts: [...isolatedTo],
      hiddenModels: [...hiddenModels],
    });
  };

  const hideProducts = async (products: readonly ProductKey[]): Promise<number> => {
    const added = products.filter((product) => !hidden.has(keyOf(product)));
    if (added.length === 0) return hidden.size;

    await port.hide(added);
    for (const product of added) hidden.set(keyOf(product), product);
    await publishState();
    return hidden.size;
  };

  const showProducts = async (products: readonly ProductKey[]): Promise<number> => {
    const removed = products.filter((product) => hidden.has(keyOf(product)));
    if (removed.length === 0) return hidden.size;

    await port.show(removed);
    for (const product of removed) hidden.delete(keyOf(product));
    await publishState();
    return hidden.size;
  };

  const isolateProducts = async (products: readonly ProductKey[]): Promise<boolean> => {
    if (products.length === 0) return isolatedTo.length > 0;

    await port.isolate(products);
    isolatedTo = [...products];
    hidden.clear();
    await publishState();
    return true;
  };

  /**
   * 모델 하나를 통째로 감추거나 되돌린다.
   *
   * 부재 단위 숨김과 겹칠 수 있다. 모델을 되돌려도 그 안에서 따로 감춘 부재는 감춰진
   * 채로 두는 것이 사용자가 한 일과 맞다.
   */
  const setModelVisible = async (modelId: ModelId, visible: boolean): Promise<boolean> => {
    if (visible === !hiddenModels.has(modelId)) return visible;

    await port.setModelVisible(modelId, visible);
    if (visible) hiddenModels.delete(modelId);
    else hiddenModels.add(modelId);

    if (visible) {
      // 모델을 되돌리면 그 안에서 따로 감춰 두었던 부재를 다시 감춘다.
      const toHide = [...hidden.values()].filter((product) => product.modelId === modelId);
      if (toHide.length > 0) await port.hide(toHide);
    }
    await publishState();
    return visible;
  };

  const showAll = async (): Promise<boolean> => {
    if (hidden.size === 0 && isolatedTo.length === 0 && hiddenModels.size === 0) return false;

    await port.showAll();
    hidden.clear();
    isolatedTo = [];
    hiddenModels.clear();
    await publishState();
    return true;
  };

  const forgetModel = async (modelId: ModelId): Promise<void> => {
    // 해제된 모델의 부재는 이미 화면에서 사라졌다. 목록에 남겨 두면 개수가 사실과 어긋난다.
    let changed = false;
    for (const [key, product] of hidden) {
      if (product.modelId !== modelId) continue;
      hidden.delete(key);
      changed = true;
    }

    if (hiddenModels.delete(modelId)) changed = true;

    const remainingIsolation = isolatedTo.filter((product) => product.modelId !== modelId);
    if (remainingIsolation.length !== isolatedTo.length) {
      if (remainingIsolation.length === 0) {
        // 격리 대상이 모두 사라졌다. 남은 모델까지 계속 가려 두면 화면이 비어 보인다.
        await showAll();
        return;
      }
      isolatedTo = remainingIsolation;
      changed = true;
    }

    if (changed) await publishState();
  };

  return {
    id: 'viewer.visibility',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();

      subscriptions = [
        app.events.subscribe('model/unloaded', ({ payload }) => {
          void forgetModel(payload.modelId);
        }),
      ];

      if (!registered) {
        app.commands.register('viewer/hide-products', async ({ products }) => ({
          hiddenCount: await hideProducts(products),
        }));
        app.commands.register('viewer/show-products', async ({ products }) => ({
          hiddenCount: await showProducts(products),
        }));
        app.commands.register('viewer/isolate-products', async ({ products }) => ({
          isolated: await isolateProducts(products),
        }));
        app.commands.register('viewer/set-model-visible', async ({ modelId, visible }) => ({
          visible: await setModelVisible(modelId, visible),
        }));
        app.commands.register('viewer/show-all', async () => ({ restored: await showAll() }));
        registered = true;
      }
      return Promise.resolve();
    },

    stop: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: async () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];

      if (hidden.size > 0 || isolatedTo.length > 0 || hiddenModels.size > 0) {
        await port.showAll();
        hidden.clear();
        isolatedTo = [];
        hiddenModels.clear();
      }
      context = null;
    },
  };
};
