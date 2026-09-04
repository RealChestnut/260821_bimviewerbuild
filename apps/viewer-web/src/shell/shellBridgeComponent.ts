import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import '../viewer/model/modelEvents.js';

/**
 * 데스크톱 셸이 붙어 있을 때만 사는 다리.
 *
 * 셸(WPF)은 WebView2로 이 앱을 띄우고 `window.chrome.webview`로 말을 건다. 모양의 정본은
 * `docs/adr/0010-shell-web-bridge.md`다.
 *
 * **셸이 없어도 앱은 그대로 돈다.** `window.chrome.webview`가 없으면 이 Component는 아무것도
 * 하지 않는다. 브라우저에서 개발하고 시험하는 길(`pnpm dev`, Playwright)을 막지 않기 위해서다.
 *
 * 파일 바이트는 메시지로 오지 않는다. 셸이 그 파일 하나만 열어 주는 주소를 주고, 이 다리가
 * 평범한 `fetch`로 읽는다. 수백 MB를 메시지에 실으면 셸과 웹이 같은 바이트를 둘 다 든다.
 */

/** 셸이 심어 주는 창구. 시험이 갈아 끼울 수 있게 최소한만 적는다. */
export interface ShellHost {
  addEventListener(type: 'message', handler: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', handler: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export interface ShellBridgeOptions {
  /** 없으면 `window.chrome.webview`를 찾는다. 그것도 없으면 다리를 놓지 않는다. */
  readonly host?: ShellHost | null;
  /** 주소에서 바이트를 읽는 방법. 기본은 `fetch`다. */
  readonly readBytes?: (url: string) => Promise<Uint8Array>;
}

interface WebViewWindow {
  readonly chrome?: { readonly webview?: ShellHost };
}

const defaultReadBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`모델을 읽지 못했다 (HTTP ${String(response.status)})`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** 셸이 보낸 말은 문자열로 올 수도, 객체로 올 수도 있다. 둘 다 받는다. */
const parseMessage = (data: unknown): Record<string, unknown> | null => {
  if (typeof data === 'string') {
    try {
      return asRecord(JSON.parse(data));
    } catch {
      return null;
    }
  }
  return asRecord(data);
};

const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const createShellBridgeComponent = (options: ShellBridgeOptions = {}): AppComponent => {
  const readBytes = options.readBytes ?? defaultReadBytes;

  let context: AppContext | null = null;
  let host: ShellHost | null = null;
  let subscriptions: Unsubscribe[] = [];
  let listening = false;

  const tell = (kind: string, fields: Record<string, unknown>): void => {
    host?.postMessage(JSON.stringify({ kind, ...fields }));
  };

  const openModel = async (message: Record<string, unknown>): Promise<void> => {
    if (context === null) return;
    const url = textOf(message['url']);
    const name = textOf(message['name']);
    if (url === null || name === null) return;

    try {
      const bytes = await readBytes(url);
      const result = await context.commands.dispatch('viewer/load-model', {
        bytes,
        displayName: name,
      });
      if (!result.ok) tell('web/error', { message: result.error.message, code: result.error.code });
    } catch (cause) {
      // 셸은 사용자에게 보일 오류 리포트를 만든다. 조용히 삼키지 않는다.
      tell('web/error', { message: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const openSchedule = async (message: Record<string, unknown>): Promise<void> => {
    if (context === null) return;
    const schedule = message['schedule'];
    if (schedule === undefined) return;

    // 검증은 도메인의 parseSchedule이 한다. 셸은 옮기기만 한다.
    const result = await context.commands.dispatch('scheduler/load-schedule', { source: schedule });
    if (!result.ok) tell('web/error', { message: result.error.message, code: result.error.code });
  };

  const onMessage = (event: { readonly data: unknown }): void => {
    const message = parseMessage(event.data);
    const kind = message === null ? null : textOf(message['kind']);
    if (message === null || kind === null) return;

    if (kind === 'shell/model-opened') {
      void openModel(message);
      return;
    }
    if (kind === 'shell/schedule-opened') {
      void openSchedule(message);
    }
  };

  const detach = (): void => {
    if (listening) {
      host?.removeEventListener('message', onMessage);
      listening = false;
    }
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.shell-bridge',

    initialize: (appContext: AppContext) => {
      context = appContext;
      host = options.host ?? (globalThis as unknown as WebViewWindow).chrome?.webview ?? null;
      return Promise.resolve();
    },

    start: () => {
      // 셸이 없으면 다리를 놓지 않는다. 브라우저에서는 이 Component가 없는 것과 같다.
      if (host === null || context === null || listening) return Promise.resolve();
      const app = context;

      host.addEventListener('message', onMessage);
      listening = true;

      subscriptions = [
        // 셸이 웹의 기록을 자기 로그에 함께 남긴다. 프로세스 셋을 잇는 유일한 실이다.
        app.events.subscribe('model/load-failed', ({ payload }) => {
          tell('web/error', { message: `${payload.displayName}: ${payload.reason}` });
        }),
        app.events.subscribe('scheduler/load-failed', ({ payload }) => {
          tell('web/error', { message: payload.reason, code: payload.code });
        }),
        app.events.subscribe('model/loaded', ({ payload }) => {
          tell('web/log', { level: 'info', message: `모델을 열었다: ${payload.displayName}` });
        }),
      ];

      // 셸은 이 말을 듣고 첫 모델을 보낸다. 뜨기 전에 보내면 놓친다.
      tell('web/ready', {});
      return Promise.resolve();
    },

    stop: () => {
      detach();
      return Promise.resolve();
    },

    dispose: () => {
      detach();
      host = null;
      context = null;
      return Promise.resolve();
    },
  };
};
