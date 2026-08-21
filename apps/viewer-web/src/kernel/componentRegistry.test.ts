import { describe, expect, it, vi } from 'vitest';

import type { AppComponent, AppContext } from '@bim4d/contracts';

import { createComponentRegistry } from './componentRegistry.js';
import { createTestContext } from './testing/testContext.js';

const createRecordedComponent = (id: string, log: string[]): AppComponent => {
  const record = (name: string): void => {
    log.push(`${id}:${name}`);
  };
  return {
    id,
    initialize: (_context: AppContext) => {
      record('initialize');
      return Promise.resolve();
    },
    start: () => {
      record('start');
      return Promise.resolve();
    },
    stop: () => {
      record('stop');
      return Promise.resolve();
    },
    dispose: () => {
      record('dispose');
      return Promise.resolve();
    },
  };
};

const createRegistry = () => createComponentRegistry({ context: createTestContext() });

describe('createComponentRegistry', () => {
  it('등록 순서대로 initialize하고 start한다', async () => {
    const log: string[] = [];
    const registry = createRegistry();
    registry.register(createRecordedComponent('a', log));
    registry.register(createRecordedComponent('b', log));

    await registry.initializeAll();
    await registry.startAll();

    expect(log).toEqual(['a:initialize', 'b:initialize', 'a:start', 'b:start']);
  });

  it('stop과 dispose는 등록 역순으로 실행한다', async () => {
    const log: string[] = [];
    const registry = createRegistry();
    registry.register(createRecordedComponent('a', log));
    registry.register(createRecordedComponent('b', log));

    await registry.initializeAll();
    await registry.startAll();
    log.length = 0;
    await registry.stopAll();
    await registry.disposeAll();

    expect(log).toEqual(['b:stop', 'a:stop', 'b:dispose', 'a:dispose']);
  });

  it('같은 id를 두 번 등록하면 거부한다', () => {
    const log: string[] = [];
    const registry = createRegistry();
    registry.register(createRecordedComponent('a', log));

    expect(() => {
      registry.register(createRecordedComponent('a', log));
    }).toThrow(/a/);
  });

  it('initialize 없이 start하면 거부한다', async () => {
    const log: string[] = [];
    const registry = createRegistry();
    registry.register(createRecordedComponent('a', log));

    await expect(registry.startAll()).rejects.toThrow(/initialize/);
  });

  it('생명주기 상태를 조회할 수 있다', async () => {
    const log: string[] = [];
    const registry = createRegistry();
    registry.register(createRecordedComponent('a', log));

    expect(registry.stateOf('a')).toBe('created');
    await registry.initializeAll();
    expect(registry.stateOf('a')).toBe('initialized');
    await registry.startAll();
    expect(registry.stateOf('a')).toBe('started');
    await registry.stopAll();
    expect(registry.stateOf('a')).toBe('stopped');
    await registry.disposeAll();
    expect(registry.stateOf('a')).toBe('disposed');
  });

  it('dispose가 실패해도 나머지 Component를 dispose하고 오류를 모아 던진다', async () => {
    const log: string[] = [];
    const registry = createRegistry();
    const failing = createRecordedComponent('bad', log);
    const disposeSpy = vi.spyOn(failing, 'dispose').mockRejectedValue(new Error('boom'));
    registry.register(createRecordedComponent('a', log));
    registry.register(failing);

    await registry.initializeAll();
    await registry.startAll();
    await registry.stopAll();

    await expect(registry.disposeAll()).rejects.toThrow(/bad/);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(log).toContain('a:dispose');
  });

  it('dispose한 Component는 다시 start하지 않는다', async () => {
    const log: string[] = [];
    const registry = createRegistry();
    registry.register(createRecordedComponent('a', log));

    await registry.initializeAll();
    await registry.startAll();
    await registry.stopAll();
    await registry.disposeAll();

    await expect(registry.startAll()).rejects.toThrow(/disposed/);
  });
});
