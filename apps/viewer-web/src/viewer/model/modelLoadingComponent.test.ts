import { describe, expect, it, vi } from 'vitest';

import type { AppEvent, AppEventName, ModelId, ModelRepositoryPort } from '@bim4d/contracts';

import { createInMemoryModelRepository } from '../../adapters/inMemoryModelRepository.js';
import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';

import { createModelLoadingComponent } from './modelLoadingComponent.js';
import type { ModelLoaderPort, ModelLoadRequest } from './modelLoaderPort.js';

const ifcBytes = (schema = 'IFC4'): Uint8Array =>
  new TextEncoder().encode(
    [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_SCHEMA(('${schema}'));`,
      'ENDSEC;',
      'DATA;',
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
  );

interface FakeLoader extends ModelLoaderPort {
  readonly requests: ModelLoadRequest[];
  readonly unloaded: ModelId[];
  failWith?: Error;
  progressSteps: number[];
}

const createFakeLoader = (): FakeLoader => {
  const loaded = new Set<ModelId>();
  const loader: FakeLoader = {
    requests: [],
    unloaded: [],
    progressSteps: [],
    load: (request) => {
      if (loader.failWith !== undefined) return Promise.reject(loader.failWith);
      loader.requests.push(request);
      for (const step of loader.progressSteps) request.onProgress?.(step);
      loaded.add(request.modelId);
      return Promise.resolve();
    },
    unload: (modelId) => {
      loader.unloaded.push(modelId);
      return Promise.resolve(loaded.delete(modelId));
    },
    loadedModelIds: () => [...loaded],
  };
  return loader;
};

const recordEvents = (context: TestContext, names: AppEventName[]): AppEvent[] => {
  const received: AppEvent[] = [];
  for (const name of names) {
    context.events.subscribe(name, (event) => {
      received.push(event);
    });
  }
  return received;
};

const setup = async (): Promise<{
  context: TestContext;
  loader: FakeLoader;
  repository: ModelRepositoryPort;
  events: AppEvent[];
  dispose: () => Promise<void>;
}> => {
  const context = createTestContext();
  const loader = createFakeLoader();
  const repository = createInMemoryModelRepository();
  let counter = 0;
  const component = createModelLoadingComponent({
    loader,
    repository,
    newModelId: () => `model-${String(++counter)}` as ModelId,
  });

  const events = recordEvents(context, [
    'model/load-started',
    'model/load-progress',
    'model/loaded',
    'model/load-failed',
    'model/unloaded',
  ]);

  await component.initialize(context);
  await component.start();

  return { context, loader, repository, events, dispose: () => component.dispose() };
};

const names = (events: AppEvent[]): string[] => events.map((event) => event.name);

describe('createModelLoadingComponent', () => {
  it('load Command가 모델을 적재하고 modelId를 돌려준다', async () => {
    const { context, loader } = await setup();

    const result = await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });

    expect(result).toEqual({ ok: true, value: { modelId: 'model-1' } });
    expect(loader.requests.map((request) => request.displayName)).toEqual(['wall.ifc']);
  });

  it('적재 순서대로 started, progress, loaded를 발행한다', async () => {
    const { context, loader, events } = await setup();
    loader.progressSteps = [0.5, 1];

    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });

    expect(names(events)).toEqual([
      'model/load-started',
      'model/load-progress',
      'model/load-progress',
      'model/loaded',
    ]);
  });

  it('Header에서 읽은 Schema와 fingerprint를 보관소에 저장한다', async () => {
    const { context, repository } = await setup();

    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes('IFC2X3'),
      displayName: 'wall.ifc',
    });

    const record = await repository.get('model-1' as ModelId);
    expect(record).toMatchObject({ displayName: 'wall.ifc', schema: 'IFC2X3' });
    expect(record?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('같은 내용을 다시 적재하면 같은 fingerprint가 나온다', async () => {
    const { context, repository } = await setup();

    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'a.ifc',
    });
    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'b.ifc',
    });

    const first = await repository.get('model-1' as ModelId);
    const second = await repository.get('model-2' as ModelId);
    expect(first?.fingerprint).toBe(second?.fingerprint);
  });

  it('STEP 파일이 아니면 Adapter를 부르지 않고 실패를 알린다', async () => {
    const { context, loader, repository, events } = await setup();

    const result = await context.commands.dispatch('viewer/load-model', {
      bytes: new TextEncoder().encode('<?xml version="1.0"?>'),
      displayName: 'model.ifcXML',
    });

    expect(result.ok).toBe(false);
    expect(loader.requests).toEqual([]);
    expect(await repository.list()).toEqual([]);
    expect(names(events)).toEqual(['model/load-failed']);
  });

  it('지원하지 않는 Schema는 적재하지 않는다', async () => {
    const { context, loader, events } = await setup();

    const result = await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes('IFC5'),
      displayName: 'future.ifc',
    });

    expect(result.ok).toBe(false);
    expect(loader.requests).toEqual([]);
    expect(names(events)).toEqual(['model/load-failed']);
  });

  it('Adapter 적재가 실패하면 보관소에 모델을 남기지 않는다', async () => {
    const { context, loader, repository, events } = await setup();
    loader.failWith = new Error('web-ifc 실패');

    const result = await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });

    expect(result.ok).toBe(false);
    expect(await repository.list()).toEqual([]);
    expect(names(events)).toEqual(['model/load-started', 'model/load-failed']);
  });

  it('unload Command가 Scene과 보관소에서 모델을 지운다', async () => {
    const { context, loader, repository, events } = await setup();
    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });

    const result = await context.commands.dispatch('viewer/unload-model', {
      modelId: 'model-1' as ModelId,
    });

    expect(result).toEqual({ ok: true, value: { removed: true } });
    expect(loader.loadedModelIds()).toEqual([]);
    expect(await repository.list()).toEqual([]);
    expect(names(events).at(-1)).toBe('model/unloaded');
  });

  it('없는 모델을 해제하면 removed=false를 돌려주고 Event를 발행하지 않는다', async () => {
    const { context, events } = await setup();

    const result = await context.commands.dispatch('viewer/unload-model', {
      modelId: 'missing' as ModelId,
    });

    expect(result).toEqual({ ok: true, value: { removed: false } });
    expect(names(events)).toEqual([]);
  });

  it('dispose는 남아 있는 모든 모델을 해제한다', async () => {
    const { context, loader, repository, dispose } = await setup();
    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'a.ifc',
    });
    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes('IFC2X3'),
      displayName: 'b.ifc',
    });

    await dispose();

    expect(loader.loadedModelIds()).toEqual([]);
    expect(await repository.list()).toEqual([]);
  });

  it('적재와 해제를 10회 반복해도 잔여 모델이 없다', async () => {
    const { context, loader, repository } = await setup();

    for (let round = 0; round < 10; round += 1) {
      const loaded = await context.commands.dispatch('viewer/load-model', {
        bytes: ifcBytes(),
        displayName: `round-${String(round)}.ifc`,
      });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      await context.commands.dispatch('viewer/unload-model', { modelId: loaded.value.modelId });
    }

    expect(loader.loadedModelIds()).toEqual([]);
    expect(await repository.list()).toEqual([]);
  });

  it('진행률은 0과 1 사이로 맞춰 발행한다', async () => {
    const { context, loader, events } = await setup();
    loader.progressSteps = [-1, 0.25, 5];

    await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });

    const fractions = events
      .filter((event) => event.name === 'model/load-progress')
      .map((event) => (event.payload as { fraction: number }).fraction);
    expect(fractions).toEqual([0, 0.25, 1]);
  });

  it('적재가 끝나기 전에 들어온 해제 요청은 적재 뒤에 실행한다', async () => {
    const { context, loader, events } = await setup();
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const originalLoad = loader.load.bind(loader);
    loader.load = async (request) => {
      await gate;
      return originalLoad(request);
    };

    const loading = context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });
    const unloading = context.commands.dispatch('viewer/unload-model', {
      modelId: 'model-1' as ModelId,
    });

    releaseLoad?.();
    await loading;
    const result = await unloading;

    expect(result).toEqual({ ok: true, value: { removed: true } });
    expect(names(events)).toEqual(['model/load-started', 'model/loaded', 'model/unloaded']);
    expect(loader.loadedModelIds()).toEqual([]);
  });

  it('start 전에는 Command를 등록하지 않는다', async () => {
    const context = createTestContext();
    const component = createModelLoadingComponent({
      loader: createFakeLoader(),
      repository: createInMemoryModelRepository(),
      newModelId: vi.fn(() => 'model-1' as ModelId),
    });
    await component.initialize(context);

    const result = await context.commands.dispatch('viewer/load-model', {
      bytes: ifcBytes(),
      displayName: 'wall.ifc',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'kernel.command.handler-not-found' },
    });
  });
});
