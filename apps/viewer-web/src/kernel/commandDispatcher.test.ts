import { describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '@bim4d/contracts';

import { createCommandDispatcher } from './commandDispatcher.js';
import { createTestLogger } from './testing/testLogger.js';

declare module '@bim4d/contracts' {
  interface AppCommandMap {
    'test/echo': { input: { readonly text: string }; output: { readonly text: string } };
    'test/fail': { input: Record<string, never>; output: never };
  }
}

const traceIds = (): (() => string) => {
  let next = 0;
  return () => `trace-${String(++next)}`;
};

const createDispatcher = () =>
  createCommandDispatcher({ logger: createTestLogger(), newTraceId: traceIds() });

describe('createCommandDispatcher', () => {
  it('등록한 handler의 결과를 ok 값으로 돌려준다', async () => {
    const dispatcher = createDispatcher();
    dispatcher.register('test/echo', ({ text }) => Promise.resolve({ text }));

    const result = await dispatcher.dispatch('test/echo', { text: 'hi' });

    expect(result).toEqual({ ok: true, value: { text: 'hi' } });
  });

  it('같은 Command에 두 번째 handler를 등록하면 거부한다', () => {
    const dispatcher = createDispatcher();
    dispatcher.register('test/echo', ({ text }) => Promise.resolve({ text }));

    expect(() => {
      dispatcher.register('test/echo', ({ text }) => Promise.resolve({ text }));
    }).toThrow(/test\/echo/);
  });

  it('handler가 없는 Command는 not-found 오류를 돌려준다', async () => {
    const dispatcher = createDispatcher();

    const result = await dispatcher.dispatch('test/echo', { text: 'hi' });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not-found', code: 'kernel.command.handler-not-found' },
    });
  });

  it('handler가 던진 예외를 internal 오류로 바꾸고 cause를 보존한다', async () => {
    const dispatcher = createDispatcher();
    const cause = new Error('boom');
    dispatcher.register('test/fail', () => Promise.reject(cause));

    const result = await dispatcher.dispatch('test/fail', {});

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'internal', code: 'kernel.command.handler-failed', cause },
    });
  });

  it('traceId를 주지 않으면 새로 만들어 handler에 전달한다', async () => {
    const dispatcher = createDispatcher();
    const handler = vi.fn((input: { text: string }, _context: CommandContext) =>
      Promise.resolve({ text: input.text }),
    );
    dispatcher.register('test/echo', handler);

    await dispatcher.dispatch('test/echo', { text: 'hi' });

    expect(handler.mock.calls[0]?.[1]).toEqual({ traceId: 'trace-1' });
  });

  it('전달한 traceId를 그대로 오류에 싣는다', async () => {
    const dispatcher = createDispatcher();
    dispatcher.register('test/fail', () => Promise.reject(new Error('boom')));

    const result = await dispatcher.dispatch('test/fail', {}, { traceId: 'trace-fixed' });

    expect(result).toMatchObject({ ok: false, error: { traceId: 'trace-fixed' } });
  });
});
