import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createInMemoryModelRefBinding } from '../adapters/inMemoryModelRefBinding.js';
import type { ModelRefBindingRegistry } from '../adapters/inMemoryModelRefBinding.js';
import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../viewer/model/modelEvents.js';

import { createModelBindingComponent } from './modelBindingComponent.js';
import './schedulerEvents.js';

const MODEL = 'model-a' as ModelId;

let registry: ModelRefBindingRegistry;

const startComponent = async (context: TestContext) => {
  const component = createModelBindingComponent({ registry });
  await component.initialize(context);
  await component.start();
  return component;
};

const listenChanges = (context: TestContext): { boundCount: number }[] => {
  const seen: { boundCount: number }[] = [];
  context.events.subscribe('scheduler/model-binding-changed', ({ payload }) => {
    seen.push(payload);
  });
  return seen;
};

const load = async (context: TestContext, modelId: ModelId, displayName: string): Promise<void> => {
  await context.events.publish('model/loaded', { modelId, displayName, schema: 'IFC4' });
};

beforeEach(() => {
  registry = createInMemoryModelRefBinding();
});

describe('createModelBindingComponent', () => {
  it('모델이 열리면 파일명으로 묶는다', async () => {
    const context = createTestContext();
    await startComponent(context);

    await load(context, MODEL, 'a.ifc');

    // 일정의 modelRef는 파일명이다 (ADR-0005, 잠정).
    expect(registry.idOf('a.ifc')).toBe(MODEL);
  });

  it('묶은 뒤에 바뀐 사실을 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await load(context, MODEL, 'a.ifc');

    expect(changes).toEqual([{ boundCount: 1 }]);
  });

  it('모델이 닫히면 풀고 알린다', async () => {
    const context = createTestContext();
    await startComponent(context);
    await load(context, MODEL, 'a.ifc');
    const changes = listenChanges(context);

    await context.events.publish('model/unloaded', { modelId: MODEL });

    expect(registry.refOf(MODEL)).toBeNull();
    expect(changes).toEqual([{ boundCount: 0 }]);
  });

  it('묶이지 않은 모델이 닫히면 아무 말도 하지 않는다', async () => {
    const context = createTestContext();
    await startComponent(context);
    const changes = listenChanges(context);

    await context.events.publish('model/unloaded', { modelId: 'model-z' as ModelId });

    expect(changes).toEqual([]);
  });

  it('stop 뒤에는 Event를 받아도 묶지 않는다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);

    await component.stop();
    await load(context, MODEL, 'a.ifc');

    expect(registry.idOf('a.ifc')).toBeNull();
  });

  it('dispose하면 묶음을 비운다', async () => {
    const context = createTestContext();
    const component = await startComponent(context);
    await load(context, MODEL, 'a.ifc');

    await component.stop();
    await component.dispose();

    expect(registry.entries().size).toBe(0);
  });
});
