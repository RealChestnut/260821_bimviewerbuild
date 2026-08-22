import type { AppComponent, AppContext, IfcSchemaVersion, ModelId } from '@bim4d/contracts';
import type { Unsubscribe } from '@bim4d/contracts';

import '../viewer/model/modelEvents.js';

export interface ModelPanelOptions {
  readonly fileInputSelector: string;
  /** 열린 모델을 한 줄씩 담을 목록 요소의 CSS selector. */
  readonly listSelector: string;
  readonly statusSelector: string;
}

interface OpenModel {
  readonly displayName: string;
  readonly schema: IfcSchemaVersion;
}

const IDLE_TEXT = '열린 모델 없음';

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

/** 화면 구조가 바뀌어 다른 요소가 잡히면 조용히 동작하지 않는 대신 여기서 멈춘다. */
const requireInput = (selector: string): HTMLInputElement => {
  const element = requireElement(selector);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`input 요소가 아니다: ${selector}`);
  }
  return element;
};

/**
 * 모델 열기와 해제를 다루는 화면 조각.
 *
 * 상태는 Event로만 받는다. Command를 보낸 결과를 직접 읽어 화면을 갱신하지 않는다.
 * 그래야 다른 경로(호스트 메뉴, 자동 복원)로 모델이 열려도 같은 표시가 나온다.
 *
 * 열린 모델은 하나가 아니라 목록이다. 연합 모델에서는 여러 파일이 동시에 떠 있고
 * 해제는 그중 하나만 골라서 하므로, 화면도 모델마다 자기 줄과 자기 해제 버튼을 갖는다.
 */
export const createModelPanel = (options: ModelPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let fileInput: HTMLInputElement | null = null;
  let listElement: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  /** 열린 순서를 그대로 화면 순서로 쓴다. */
  const models = new Map<ModelId, OpenModel>();
  /** 적재 중인 모델의 이름. 진행률 Event에는 이름이 없으므로 시작 시점에 받아 둔다. */
  const loading = new Map<ModelId, string>();

  const write = (text: string): void => {
    if (statusText !== null) statusText.textContent = text;
  };

  /** 적재도 실패도 진행 중이 아닐 때 보여 주는 문구. */
  const writeSummary = (): void => {
    write(models.size === 0 ? IDLE_TEXT : `모델 ${String(models.size)}개`);
  };

  const setFileInputEnabled = (enabled: boolean): void => {
    if (fileInput !== null) fileInput.disabled = !enabled;
  };

  const unloadModel = (modelId: ModelId): void => {
    if (context === null) return;
    const app = context;

    void (async () => {
      const result = await app.commands.dispatch('viewer/unload-model', { modelId });
      // 해제 실패는 발행할 Event가 없다. 실패를 삼키면 버튼이 먹통으로 보이므로 여기서 알린다.
      if (!result.ok) {
        write(`모델 해제 실패: ${result.error.message}`);
      }
    })();
  };

  const createRow = (modelId: ModelId, model: OpenModel): HTMLLIElement => {
    const row = document.createElement('li');
    row.dataset['testid'] = 'model-row';
    row.dataset['modelId'] = modelId;

    const name = document.createElement('span');
    name.dataset['testid'] = 'model-name';
    name.textContent = `${model.displayName} (${model.schema})`;

    const unloadButton = document.createElement('button');
    unloadButton.type = 'button';
    unloadButton.dataset['testid'] = 'model-unload';
    unloadButton.textContent = '해제';
    // 줄과 함께 만들어지고 줄과 함께 사라지므로 따로 해지할 구독이 남지 않는다.
    unloadButton.addEventListener('click', () => {
      unloadModel(modelId);
    });

    row.append(name, unloadButton);
    return row;
  };

  const renderList = (): void => {
    if (listElement === null) return;
    listElement.replaceChildren(
      ...[...models].map(([modelId, model]) => createRow(modelId, model)),
    );
  };

  const onFileChosen = (): void => {
    const file = fileInput?.files?.[0];
    if (file === undefined || context === null) return;
    const app = context;

    void (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await app.commands.dispatch('viewer/load-model', { bytes, displayName: file.name });
      // 같은 파일을 다시 고를 수 있도록 값을 비운다. change 이벤트는 값이 바뀔 때만 난다.
      if (fileInput !== null) fileInput.value = '';
    })();
    // 적재 실패는 model/load-failed로 화면에 나온다. 여기서 결과를 다시 읽지 않는다.
  };

  return {
    id: 'shell.model-panel',

    initialize: (appContext: AppContext) => {
      try {
        fileInput = requireInput(options.fileInputSelector);
        listElement = requireElement(options.listSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
      context = appContext;
      renderList();
      writeSummary();
      return Promise.resolve();
    },

    start: () => {
      if (context === null || fileInput === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      fileInput.addEventListener('change', onFileChosen);

      subscriptions = [
        context.events.subscribe('model/load-started', ({ payload }) => {
          loading.set(payload.modelId, payload.displayName);
          write(`${payload.displayName} 여는 중… 0%`);
          setFileInputEnabled(false);
        }),
        context.events.subscribe('model/load-progress', ({ payload }) => {
          const name = loading.get(payload.modelId);
          if (name === undefined) return;
          const percent = Math.round(payload.fraction * 100);
          write(`${name} 여는 중… ${String(percent)}%`);
        }),
        context.events.subscribe('model/loaded', ({ payload }) => {
          loading.delete(payload.modelId);
          models.set(payload.modelId, {
            displayName: payload.displayName,
            schema: payload.schema,
          });
          renderList();
          writeSummary();
          setFileInputEnabled(true);
        }),
        context.events.subscribe('model/load-failed', ({ payload }) => {
          // 실패 Event에는 modelId가 없다. 적재는 한 번에 하나씩 진행하므로 대기 목록을 비운다.
          loading.clear();
          write(`${payload.displayName} 열기 실패: ${payload.reason}`);
          setFileInputEnabled(true);
        }),
        context.events.subscribe('model/unloaded', ({ payload }) => {
          if (!models.delete(payload.modelId)) return;
          renderList();
          writeSummary();
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      fileInput?.removeEventListener('change', onFileChosen);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      fileInput?.removeEventListener('change', onFileChosen);
      fileInput = null;
      listElement = null;
      statusText = null;
      models.clear();
      loading.clear();
      context = null;
      return Promise.resolve();
    },
  };
};
