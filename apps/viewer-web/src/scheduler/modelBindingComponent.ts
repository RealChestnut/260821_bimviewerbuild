import { resolveModelBindings } from '@bim4d/domain';
import type { OpenModel } from '@bim4d/domain';
import type {
  AppComponent,
  AppContext,
  GlobalId,
  ModelId,
  ScheduleRepositoryPort,
  Unsubscribe,
} from '@bim4d/contracts';

import type { ModelRefBindingRegistry } from '../adapters/inMemoryModelRefBinding.js';
import '../viewer/model/modelEvents.js';

import './schedulerEvents.js';

/** 모델 하나에 들어 있는 부재의 GlobalId를 읽는다. 없는 모델이면 빈 목록이다. */
export type ProductsOf = (modelId: ModelId) => Promise<readonly GlobalId[]>;

export interface ModelBindingComponentOptions {
  readonly registry: ModelRefBindingRegistry;
  /** 일정을 읽는다. 일정의 주인은 Scheduler이므로 보관소로만 읽는다 (마스터 계획 5.4절). */
  readonly repository: ScheduleRepositoryPort;
  /** 교체된 모델에서 사라진 부재를 세는 데 쓴다. */
  readonly productsOf: ProductsOf;
}

/**
 * 적재된 모델을 일정의 `modelRef`에 묶는 Component.
 *
 * 묶는 규칙은 도메인의 `resolveModelBindings`가 정한다 (ADR-0008). 여기서는 열려 있는
 * 모델을 모아 두고, 모델이나 일정이 바뀔 때마다 다시 묶어 보관소에 넣는다.
 *
 * 읽는 쪽(시뮬레이션, 부재 연결 화면)은 `ModelRefBindingPort`만 본다. 그래서 규칙이
 * 바뀌어도 고칠 자리가 늘지 않는다.
 *
 * 바뀐 사실은 Event로 알린다. 소비자가 `model/loaded`를 직접 듣게 하면 누가 먼저 처리되는지가
 * 등록 순서에 달리고, 묶기 전에 다시 묶으려 드는 순서가 나온다.
 */
export const createModelBindingComponent = (
  options: ModelBindingComponentOptions,
): AppComponent => {
  const { registry, repository, productsOf } = options;

  let context: AppContext | null = null;
  let subscriptions: Unsubscribe[] = [];
  let registered = false;

  /** 지금 열려 있는 모델. 적재 순서를 지킨다. */
  const open = new Map<ModelId, OpenModel>();

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  /**
   * 열린 모델과 일정을 다시 묶는다.
   *
   * 일정이 없으면 묶을 이름도 없다. 모델만 열려 있는 상태는 정상이다.
   */
  const rebind = async (): Promise<void> => {
    const app = requireContext();
    const schedule = await repository.get();

    if (schedule === null) {
      registry.replaceAll(new Map());
      await app.events.publish('scheduler/model-binding-changed', {
        boundCount: 0,
        replacedRefs: [],
      });
      return;
    }

    const result = resolveModelBindings(schedule, [...open.values()]);
    registry.replaceAll(result.bindings);

    await app.events.publish('scheduler/model-binding-changed', {
      boundCount: result.bindings.size,
      // 이름은 같은데 파일 내용이 다른 것. 화면이 사용자에게 물어볼 대상이다.
      replacedRefs: result.replaced.map((entry) => entry.modelRef),
    });

    await recordFirstFingerprints(schedule.models, result.bindings);
  };

  /**
   * 처음 묶인 이름의 fingerprint를 적어 둔다.
   *
   * 모르던 값을 적는 것과 알던 값을 바꾸는 것은 다르다. ADR-0008이 금지한 것은 뒤쪽이다.
   * 처음 한 번 적어 두지 않으면 어떤 파일이 정본이었는지 끝내 알 수 없고, 교체를 감지할
   * 근거도 생기지 않는다.
   *
   * 적고 나면 일정이 바뀌어 다시 묶는다. 그때는 모두 알고 있으므로 더 적지 않는다.
   */
  const recordFirstFingerprints = async (
    models: readonly { readonly modelRef: string; readonly fingerprint?: string }[],
    bindings: ReadonlyMap<string, ModelId>,
  ): Promise<void> => {
    const known = new Set(
      models.filter((model) => model.fingerprint !== undefined).map((model) => model.modelRef),
    );

    const edits = [...bindings]
      .filter(([modelRef]) => !known.has(modelRef))
      .flatMap(([modelRef, modelId]) => {
        const model = open.get(modelId);
        if (model === undefined) return [];
        return [
          {
            kind: 'set-model-fingerprint' as const,
            modelRef,
            fingerprint: model.fingerprint,
          },
        ];
      });

    if (edits.length === 0) return;
    await requireContext().commands.dispatch('scheduler/edit-schedule', { edits });
  };

  /**
   * 열린 모델을 그 이름의 정본으로 삼는다.
   *
   * fingerprint를 자동으로 갱신하지 않기로 했으므로(ADR-0008) 이 명령은 사용자의 결정으로만
   * 들어온다. 사라진 부재는 세어서 알리되 연결을 지우지는 않는다. 지우는 것도 사용자의
   * 결정이며, 되돌릴 수 없는 일을 대신 하지 않는다.
   */
  const adoptModel = async (
    modelRef: string,
  ): Promise<{ readonly missing: readonly GlobalId[] }> => {
    const app = requireContext();

    const modelId = registry.idOf(modelRef);
    const model = modelId === null ? undefined : open.get(modelId);
    if (model === undefined) {
      throw new Error(`${modelRef}에 묶인 모델이 열려 있지 않다.`);
    }

    const schedule = await repository.get();
    if (schedule === null) throw new Error('열려 있는 일정이 없다.');

    const present = new Set(await productsOf(model.modelId));
    // 같은 부재가 여러 Task에 걸려 있어도 사라진 부재는 하나다. 세는 것은 부재이지 줄이 아니다.
    const missing = [
      ...new Set(
        schedule.assignments
          .filter(
            (assignment) =>
              assignment.modelRef === modelRef && !present.has(assignment.productGlobalId),
          )
          .map((assignment) => assignment.productGlobalId),
      ),
    ];

    const result = await app.commands.dispatch('scheduler/edit-schedule', {
      edits: [{ kind: 'set-model-fingerprint', modelRef, fingerprint: model.fingerprint }],
    });
    if (!result.ok) throw new Error(result.error.message);

    return { missing };
  };

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
      const app = context;

      if (!registered) {
        app.commands.register('scheduler/adopt-model', ({ modelRef }) => adoptModel(modelRef));
        registered = true;
      }
      if (subscriptions.length > 0) return Promise.resolve();

      subscriptions = [
        app.events.subscribe('model/loaded', ({ payload }) => {
          open.set(payload.modelId, {
            modelId: payload.modelId,
            displayName: payload.displayName,
            fingerprint: payload.fingerprint,
          });
          return rebind();
        }),
        app.events.subscribe('model/unloaded', ({ payload }) => {
          if (!open.delete(payload.modelId)) return;
          return rebind();
        }),
        // 일정이 바뀌면 아는 fingerprint도 바뀐다. 같은 모델이라도 다시 묶어야 한다.
        app.events.subscribe('scheduler/schedule-changed', () => rebind()),
      ];

      return Promise.resolve();
    },

    stop: () => {
      detach();
      return Promise.resolve();
    },

    dispose: () => {
      detach();
      open.clear();
      registry.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
