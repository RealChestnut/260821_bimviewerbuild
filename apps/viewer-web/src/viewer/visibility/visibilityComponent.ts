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

  const showAll = async (): Promise<boolean> => {
    if (hidden.size === 0 && isolatedTo.length === 0) return false;

    await port.showAll();
    hidden.clear();
    isolatedTo = [];
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

      if (hidden.size > 0 || isolatedTo.length > 0) {
        await port.showAll();
        hidden.clear();
        isolatedTo = [];
      }
      context = null;
    },
  };
};
