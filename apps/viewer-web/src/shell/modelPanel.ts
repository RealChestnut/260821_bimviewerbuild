import type { AppComponent, AppContext, ModelId, Unsubscribe } from '@bim4d/contracts';

import '../viewer/model/modelEvents.js';

export interface ModelPanelOptions {
  readonly fileInputSelector: string;
  readonly unloadButtonSelector: string;
  readonly statusSelector: string;
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

const requireButton = (selector: string): HTMLButtonElement => {
  const element = requireElement(selector);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`button 요소가 아니다: ${selector}`);
  }
  return element;
};

/**
 * 모델 열기와 해제를 다루는 화면 조각.
 *
 * 상태는 Event로만 받는다. Command를 보낸 결과를 직접 읽어 화면을 갱신하지 않는다.
 * 그래야 다른 경로(호스트 메뉴, 자동 복원)로 모델이 열려도 같은 표시가 나온다.
 */
export const createModelPanel = (options: ModelPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let fileInput: HTMLInputElement | null = null;
  let unloadButton: HTMLButtonElement | null = null;
  let statusText: HTMLElement | null = null;
  let currentModelId: ModelId | null = null;
  let subscriptions: Unsubscribe[] = [];

  const write = (text: string): void => {
    if (statusText !== null) statusText.textContent = text;
  };

  const setUnloadEnabled = (enabled: boolean): void => {
    if (unloadButton !== null) unloadButton.disabled = !enabled;
  };

  /** 적재 중에는 새 파일을 고를 수 없게 한다. 적재는 한 번에 하나씩만 진행한다. */
  const setFileInputEnabled = (enabled: boolean): void => {
    if (fileInput !== null) fileInput.disabled = !enabled;
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

  const onUnloadClicked = (): void => {
    if (context === null || currentModelId === null) return;
    const app = context;
    const modelId = currentModelId;

    void (async () => {
      const result = await app.commands.dispatch('viewer/unload-model', { modelId });
      // 해제 실패는 발행할 Event가 없다. 실패를 삼키면 버튼이 먹통으로 보이므로 여기서 알린다.
      if (!result.ok) {
        write(`모델 해제 실패: ${result.error.message}`);
      }
    })();
  };

  return {
    id: 'shell.model-panel',

    initialize: (appContext: AppContext) => {
      try {
        fileInput = requireInput(options.fileInputSelector);
        unloadButton = requireButton(options.unloadButtonSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
      context = appContext;
      write(IDLE_TEXT);
      setUnloadEnabled(false);
      return Promise.resolve();
    },

    start: () => {
      if (context === null || fileInput === null || unloadButton === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      fileInput.addEventListener('change', onFileChosen);
      unloadButton.addEventListener('click', onUnloadClicked);

      subscriptions = [
        context.events.subscribe('model/load-started', ({ payload }) => {
          write(`${payload.displayName} 여는 중… 0%`);
          setUnloadEnabled(false);
          setFileInputEnabled(false);
        }),
        context.events.subscribe('model/load-progress', ({ payload }) => {
          const percent = Math.round(payload.fraction * 100);
          const name = statusText?.textContent.split(' 여는 중')[0] ?? '';
          write(`${name} 여는 중… ${String(percent)}%`);
        }),
        context.events.subscribe('model/loaded', ({ payload }) => {
          currentModelId = payload.modelId;
          write(`${payload.displayName} (${payload.schema})`);
          setUnloadEnabled(true);
          setFileInputEnabled(true);
        }),
        context.events.subscribe('model/load-failed', ({ payload }) => {
          write(`${payload.displayName} 열기 실패: ${payload.reason}`);
          setUnloadEnabled(false);
          setFileInputEnabled(true);
        }),
        context.events.subscribe('model/unloaded', () => {
          currentModelId = null;
          write(IDLE_TEXT);
          setUnloadEnabled(false);
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      fileInput?.removeEventListener('change', onFileChosen);
      unloadButton?.removeEventListener('click', onUnloadClicked);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      fileInput?.removeEventListener('change', onFileChosen);
      unloadButton?.removeEventListener('click', onUnloadClicked);
      fileInput = null;
      unloadButton = null;
      statusText = null;
      currentModelId = null;
      context = null;
      return Promise.resolve();
    },
  };
};
