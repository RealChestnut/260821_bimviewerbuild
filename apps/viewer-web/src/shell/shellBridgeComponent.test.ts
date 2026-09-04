import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import '../viewer/model/modelEvents.js';

import { createShellBridgeComponent } from './shellBridgeComponent.js';
import type { ShellHost } from './shellBridgeComponent.js';

/** 셸을 흉내 내는 창구. 보낸 말을 모으고 받은 말을 흘려보낸다. */
const createFakeHost = () => {
  const handlers: ((event: { readonly data: unknown }) => void)[] = [];
  const sent: Record<string, unknown>[] = [];

  const host: ShellHost = {
    addEventListener: (_type, handler) => handlers.push(handler),
    removeEventListener: (_type, handler) => {
      const at = handlers.indexOf(handler);
      if (at >= 0) handlers.splice(at, 1);
    },
    postMessage: (message) => {
      sent.push(JSON.parse(message as string) as Record<string, unknown>);
    },
  };

  return {
    host,
    sent,
    listenerCount: () => handlers.length,
    send: (message: unknown) => {
      for (const handler of [...handlers]) handler({ data: message });
    },
  };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let bytesByUrl: Map<string, Uint8Array>;

const startBridge = async (context: TestContext, host: ShellHost | null) => {
  const bridge = createShellBridgeComponent({
    host,
    readBytes: (url) => {
      const bytes = bytesByUrl.get(url);
      if (bytes === undefined) throw new Error(`모델을 읽지 못했다: ${url}`);
      return Promise.resolve(bytes);
    },
  });
  await bridge.initialize(context);
  await bridge.start();
  return bridge;
};

/** 모델 적재 명령을 가로챈다. */
const captureLoads = (context: TestContext, ok = true): { displayName: string; size: number }[] => {
  const seen: { displayName: string; size: number }[] = [];
  context.commands.register('viewer/load-model', (input) => {
    seen.push({ displayName: input.displayName, size: input.bytes.length });
    if (!ok) throw new Error('적재 실패');
    return Promise.resolve({ modelId: 'm1' as ModelId });
  });
  return seen;
};

beforeEach(() => {
  bytesByUrl = new Map([['https://model.local/abc', new Uint8Array([1, 2, 3, 4])]]);
});

describe('createShellBridgeComponent — 셸이 없을 때', () => {
  it('창구가 없으면 아무것도 하지 않는다', async () => {
    const context = createTestContext();

    // 브라우저에서 개발하고 시험하는 길을 막지 않는다 (ADR-0010).
    await expect(startBridge(context, null)).resolves.toBeDefined();
  });
});

describe('createShellBridgeComponent — 셸이 있을 때', () => {
  it('뜨면 준비됐다고 알린다', async () => {
    const context = createTestContext();
    const shell = createFakeHost();

    await startBridge(context, shell.host);

    // 셸은 이 말을 듣고 첫 모델을 보낸다. 뜨기 전에 보내면 놓친다.
    expect(shell.sent).toEqual([{ kind: 'web/ready' }]);
  });

  it('모델을 열라는 말을 받으면 주소에서 읽어 적재한다', async () => {
    const context = createTestContext();
    const loads = captureLoads(context);
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    shell.send(
      JSON.stringify({
        kind: 'shell/model-opened',
        id: 'abc',
        name: '벽체.ifc',
        url: 'https://model.local/abc',
      }),
    );
    await flush();

    // 바이트는 메시지로 오지 않는다. 셸이 연 주소에서 읽는다.
    expect(loads).toEqual([{ displayName: '벽체.ifc', size: 4 }]);
  });

  it('객체로 온 말도 읽는다', async () => {
    const context = createTestContext();
    const loads = captureLoads(context);
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    shell.send({
      kind: 'shell/model-opened',
      id: 'abc',
      name: '벽체.ifc',
      url: 'https://model.local/abc',
    });
    await flush();

    expect(loads).toHaveLength(1);
  });

  it('읽지 못하면 셸에 오류를 올린다', async () => {
    const context = createTestContext();
    captureLoads(context);
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    shell.send({
      kind: 'shell/model-opened',
      name: '없다.ifc',
      url: 'https://model.local/없는id',
    });
    await flush();

    // 조용히 삼키지 않는다. 셸이 사용자에게 보일 리포트를 만든다.
    expect(shell.sent.at(-1)).toMatchObject({ kind: 'web/error' });
  });

  it('일정을 열라는 말은 그대로 Scheduler에 넘긴다', async () => {
    const context = createTestContext();
    const sources: unknown[] = [];
    context.commands.register('scheduler/load-schedule', (input) => {
      sources.push(input.source);
      return Promise.resolve({ scheduleId: 's1', taskCount: 0 });
    });
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    shell.send({ kind: 'shell/schedule-opened', name: 'a.ifc', schedule: { scheduleId: 's1' } });
    await flush();

    // 검증은 도메인의 parseSchedule이 한다. 다리는 옮기기만 한다.
    expect(sources).toEqual([{ scheduleId: 's1' }]);
  });

  it('모르는 말은 흘려보낸다', async () => {
    const context = createTestContext();
    const loads = captureLoads(context);
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    shell.send({ kind: 'shell/무엇인가' });
    shell.send('{ 깨졌다');
    shell.send(42);
    await flush();

    expect(loads).toEqual([]);
  });

  it('적재가 실패하면 그 사실을 셸에 올린다', async () => {
    const context = createTestContext();
    captureLoads(context, false);
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    shell.send({
      kind: 'shell/model-opened',
      name: '벽체.ifc',
      url: 'https://model.local/abc',
    });
    await flush();

    expect(shell.sent.at(-1)).toMatchObject({ kind: 'web/error' });
  });

  it('앱의 실패를 셸 기록으로 넘긴다', async () => {
    const context = createTestContext();
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    await context.events.publish('scheduler/load-failed', {
      reason: '스키마가 맞지 않는다',
      code: 'schedule.parse.unsupported-version',
    });

    expect(shell.sent.at(-1)).toMatchObject({
      kind: 'web/error',
      code: 'schedule.parse.unsupported-version',
    });
  });

  it('모델을 열면 셸 로그에도 남긴다', async () => {
    const context = createTestContext();
    const shell = createFakeHost();
    await startBridge(context, shell.host);

    await context.events.publish('model/loaded', {
      modelId: 'm1' as ModelId,
      displayName: '벽체.ifc',
      schema: 'IFC4',
      fingerprint: '0'.repeat(64),
    });

    expect(shell.sent.at(-1)).toMatchObject({ kind: 'web/log', level: 'info' });
  });
});

describe('createShellBridgeComponent — 정리', () => {
  it('stop하면 더 듣지 않는다', async () => {
    const context = createTestContext();
    const loads = captureLoads(context);
    const shell = createFakeHost();
    const bridge = await startBridge(context, shell.host);

    await bridge.stop();
    shell.send({ kind: 'shell/model-opened', name: 'a.ifc', url: 'https://model.local/abc' });
    await flush();

    expect(shell.listenerCount()).toBe(0);
    expect(loads).toEqual([]);
  });

  it('dispose해도 두 번 걷지 않는다', async () => {
    const context = createTestContext();
    const shell = createFakeHost();
    const bridge = await startBridge(context, shell.host);

    await bridge.stop();
    await expect(bridge.dispose()).resolves.toBeUndefined();
  });
});
