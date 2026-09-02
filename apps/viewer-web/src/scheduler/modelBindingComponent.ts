import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import type { ModelRefBindingRegistry } from '../adapters/inMemoryModelRefBinding.js';
import '../viewer/model/modelEvents.js';

import './schedulerEvents.js';

export interface ModelBindingComponentOptions {
  readonly registry: ModelRefBindingRegistry;
}

/**
 * 적재된 모델을 일정의 `modelRef`에 묶는 Component.
 *
 * 묶음을 채우는 곳은 여기 하나다. 읽는 쪽(시뮬레이션, 부재 연결 화면)은 Port만 본다.
 * 그래서 바인딩 규칙이 파일명 대조에서 fingerprint로 바뀌어도 고칠 자리가 늘지 않는다
 * (ADR-0005의 잠정 항목).
 *
 * 바뀐 사실은 Event로 알린다. 소비자가 `model/loaded`를 직접 듣게 하면 누가 먼저 처리되는지가
 * 등록 순서에 달리고, 묶기 전에 다시 묶으려 드는 순서가 나온다.
 */
export const createModelBindingComponent = (
  options: ModelBindingComponentOptions,
): AppComponent => {
  const { registry } = options;

  let context: AppContext | null = null;
  let subscriptions: Unsubscribe[] = [];

  const announce = (app: AppContext): Promise<void> =>
    app.events.publish('scheduler/model-binding-changed', {
      boundCount: registry.entries().size,
    });

  const detach = (): void => {
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'scheduler.model-binding',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      if (subscriptions.length > 0) return Promise.resolve();
      const app = context;

      subscriptions = [
        app.events.subscribe('model/loaded', ({ payload }) => {
          // 일정 파일에 적힌 이름은 모델 파일명이다 (ADR-0005, 잠정).
          registry.bind(payload.modelId, payload.displayName);
          return announce(app);
        }),
        app.events.subscribe('model/unloaded', ({ payload }) => {
          // 묶여 있지 않던 모델이면 바뀐 것이 없다. 없는 변화를 알리지 않는다.
          if (registry.refOf(payload.modelId) === null) return;
          registry.unbind(payload.modelId);
          return announce(app);
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      detach();
      return Promise.resolve();
    },

    dispose: () => {
      detach();
      registry.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
