import { describe, expect, it, vi } from 'vitest';

import { createEventBus } from './eventBus.js';
import { createTestLogger } from './testing/testLogger.js';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'test/ping': { readonly value: number };
    'test/pong': { readonly value: number };
  }
}

describe('createEventBus', () => {
  it('구독자에게 payload와 이름을 전달한다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const handler = vi.fn();
    bus.subscribe('test/ping', handler);

    await bus.publish('test/ping', { value: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      name: 'test/ping',
      payload: { value: 1 },
    });
  });

  it('다른 이름의 구독자는 호출하지 않는다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const other = vi.fn();
    bus.subscribe('test/pong', other);

    await bus.publish('test/ping', { value: 1 });

    expect(other).not.toHaveBeenCalled();
  });

  it('구독자가 없어도 실패하지 않는다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    await expect(bus.publish('test/ping', { value: 1 })).resolves.toBeUndefined();
  });

  it('비동기 handler가 끝날 때까지 기다린다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    let done = false;
    bus.subscribe('test/ping', async () => {
      await Promise.resolve();
      done = true;
    });

    await bus.publish('test/ping', { value: 1 });

    expect(done).toBe(true);
  });

  it('구독 해지 후에는 호출하지 않는다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('test/ping', handler);

    unsubscribe();
    await bus.publish('test/ping', { value: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('구독 해지는 여러 번 호출해도 안전하다', () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = bus.subscribe('test/ping', vi.fn());

    unsubscribe();
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });

  it('handler 하나가 실패해도 나머지 handler는 호출하고 오류를 기록한다', async () => {
    const logger = createTestLogger();
    const bus = createEventBus({ logger });
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const healthy = vi.fn();
    bus.subscribe('test/ping', failing);
    bus.subscribe('test/ping', healthy);

    await bus.publish('test/ping', { value: 1 });

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(logger.entries.some((entry) => entry.level === 'error')).toBe(true);
  });

  it('발행 도중에 추가된 구독자는 진행 중인 Event를 받지 않는다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const late = vi.fn();
    bus.subscribe('test/ping', () => {
      bus.subscribe('test/ping', late);
    });

    await bus.publish('test/ping', { value: 1 });

    expect(late).not.toHaveBeenCalled();
  });

  it('전달한 traceId를 Event에 싣는다', async () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const handler = vi.fn();
    bus.subscribe('test/ping', handler);

    await bus.publish('test/ping', { value: 1 }, { traceId: 'trace-1' });

    expect(handler.mock.calls[0]?.[0]).toMatchObject({ traceId: 'trace-1' });
  });
});
