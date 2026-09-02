import { parseIfcHeader } from '@bim4d/domain';
import type { AppComponent, AppContext, ModelId, ModelRepositoryPort } from '@bim4d/contracts';

import { sha256Hex } from '../../shared/sha256.js';

import type { ModelLoaderPort } from './modelLoaderPort.js';

import './modelEvents.js';

export interface ModelLoadingComponentOptions {
  readonly loader: ModelLoaderPort;
  readonly repository: ModelRepositoryPort;
  /** 모델마다 새 식별자를 만든다. 테스트는 결정적인 값을 넣는다. */
  readonly newModelId: () => ModelId;
  /** epoch milliseconds. 테스트에서 시간을 고정하기 위한 주입 지점. */
  readonly now?: () => number;
}

/** Header 판별에 필요한 앞부분만 읽는다. 큰 파일 전체를 문자열로 만들지 않기 위해서다. */
const HEADER_BYTES = 4096;

const clampFraction = (value: number): number => Math.min(1, Math.max(0, value));

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * IFC 적재와 해제를 담당하는 Component.
 *
 * Schema 판별과 fingerprint 계산은 Adapter에 넘기기 전에 여기서 끝낸다.
 * 열 수 없는 파일이면 Adapter를 부르지 않으므로 WASM 초기화 비용도 들지 않는다.
 */
export const createModelLoadingComponent = (
  options: ModelLoadingComponentOptions,
): AppComponent => {
  const { loader, repository, newModelId } = options;
  const now = options.now ?? (() => Date.now());

  let context: AppContext | null = null;
  let registered = false;

  /**
   * 적재와 해제는 하나씩 순서대로 실행한다.
   *
   * 두 작업이 겹치면 web-ifc worker와 Scene을 동시에 건드리게 되고, 이미 해제한 모델의
   * 완료 Event가 뒤늦게 도착해 화면 상태가 뒤집힌다. 첫 적재는 WASM 준비 때문에 특히 느려서
   * 겹칠 여지가 크다.
   */
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <TResult>(work: () => Promise<TResult>): Promise<TResult> => {
    const result = queue.then(work, work);
    // 앞 작업이 실패해도 뒤 작업은 계속 실행한다.
    queue = result.catch(() => undefined);
    return result;
  };

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const unloadModel = async (modelId: ModelId): Promise<boolean> => {
    const app = requireContext();
    const removedFromScene = await loader.unload(modelId);
    const removedFromRepository = await repository.remove(modelId);
    const removed = removedFromScene || removedFromRepository;

    if (removed) {
      await app.events.publish('model/unloaded', { modelId });
    }
    return removed;
  };

  const loadModel = async (input: {
    readonly bytes: Uint8Array;
    readonly displayName: string;
  }): Promise<{ readonly modelId: ModelId }> => {
    const app = requireContext();
    const { bytes, displayName } = input;

    const headerText = new TextDecoder().decode(bytes.subarray(0, HEADER_BYTES));
    const header = parseIfcHeader(headerText);
    if (!header.ok) {
      await app.events.publish('model/load-failed', {
        displayName,
        reason: header.error.message,
      });
      throw new Error(header.error.message);
    }

    const modelId = newModelId();
    await app.events.publish('model/load-started', { modelId, displayName });

    // 적재 결과와 함께 알려야 하므로 try 밖에서 구한다. 실패해도 남는 값이 아니다.
    const fingerprint = await sha256Hex(bytes);

    try {
      await loader.load({
        modelId,
        bytes,
        displayName,
        onProgress: (fraction) => {
          void app.events.publish('model/load-progress', {
            modelId,
            fraction: clampFraction(fraction),
          });
        },
      });

      await repository.add({
        modelId,
        displayName,
        fingerprint,
        schema: header.value.schema,
        loadedAt: now(),
      });
    } catch (cause) {
      // 적재가 실패하면 Scene과 보관소 어느 쪽에도 흔적을 남기지 않는다.
      await loader.unload(modelId);
      await repository.remove(modelId);
      await app.events.publish('model/load-failed', { displayName, reason: reasonOf(cause) });
      throw cause;
    }

    await app.events.publish('model/loaded', {
      modelId,
      displayName,
      schema: header.value.schema,
      fingerprint,
    });

    return { modelId };
  };

  return {
    id: 'viewer.model-loading',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();
      if (registered) return Promise.resolve();

      app.commands.register('viewer/load-model', (input) => enqueue(() => loadModel(input)));
      app.commands.register('viewer/unload-model', ({ modelId }) =>
        enqueue(async () => ({ removed: await unloadModel(modelId) })),
      );
      registered = true;
      return Promise.resolve();
    },

    stop: () => Promise.resolve(),

    dispose: async () => {
      if (context === null) return;

      // 창을 닫을 때 GPU에 모델이 남지 않도록 남은 것을 모두 해제한다.
      // 진행 중인 적재가 있으면 끝난 뒤에 해제해야 Scene에 모델이 남지 않는다.
      await enqueue(async () => {
        for (const modelId of loader.loadedModelIds()) {
          await unloadModel(modelId);
        }
      });
      for (const record of await repository.list()) {
        await repository.remove(record.modelId);
      }
      context = null;
    },
  };
};
