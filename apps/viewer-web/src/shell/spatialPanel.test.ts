// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppCommandInput, GlobalId, ModelId } from '@bim4d/contracts';
import type { RawSpatialNode } from '@bim4d/domain';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import type { LogEntry } from '../kernel/testing/testLogger.js';
import '../viewer/model/modelEvents.js';
import '../viewer/selection/selectionEvents.js';
import type { SpatialTreePort } from '../viewer/spatial/spatialTreePort.js';

import { createSpatialPanel } from './spatialPanel.js';

const selector = '[data-testid="spatial-tree"]';
const markup = `<aside data-testid="spatial-tree"></aside>`;

const modelId = 'model-1' as ModelId;

const node = (
  category: string | null,
  name: string | null,
  globalId: string | null,
  children: readonly RawSpatialNode[] = [],
): RawSpatialNode => ({
  category,
  name,
  globalId: globalId as GlobalId | null,
  children,
});

/** fixture와 같은 모양이다: Project → Site → Building → Storey → 벽 둘과 슬래브 하나. */
const fixtureTree = (): RawSpatialNode =>
  node('IFCPROJECT', 'Fixture Project', '0hT6cQ2kv9NrXbW8ySmLdP', [
    node('IFCSITE', 'Fixture Site', '1KpRfB7wz4MgVaJ2xTnQcE', [
      node('IFCBUILDING', 'Fixture Building', '2XdNvS9ur6LhZmC1kBwYtF', [
        node('IFCBUILDINGSTOREY', 'Level 1', '3QwLmT5ce8KjYbV0rPzHdG', [
          node('IFCWALL', 'Wall A', '0BnKdW4tq7SfUcM3vHxZgR'),
          node('IFCWALL', 'Wall B', '1MjTgR8dp5NkXbC2wFyQsA'),
          node('IFCSLAB', 'Slab 1', '2YsHnV6bk3PgZdL9uCxWtM'),
        ]),
      ]),
    ]),
  ]);

interface FakePort extends SpatialTreePort {
  /** modelId별로 돌려줄 원본 계층. 없으면 null을 돌려준다. */
  readonly trees: Map<ModelId, RawSpatialNode>;
}

const createFakePort = (): FakePort => {
  const trees = new Map<ModelId, RawSpatialNode>();
  return {
    trees,
    read: (id) => Promise.resolve(trees.get(id) ?? null),
  };
};

const labels = (): string[] =>
  [...document.querySelectorAll('[data-testid="spatial-node"]')].map(
    (element) => element.textContent,
  );

const nodeButton = (label: string): HTMLButtonElement => {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-testid="spatial-node"]'),
  ].find((element) => element.textContent === label);
  if (found === undefined) throw new Error(`마디를 찾지 못했다: ${label}`);
  return found;
};

const toggleFor = (button: HTMLButtonElement): HTMLButtonElement => {
  const nodeId = button.dataset['nodeId'] ?? '';
  const found = document.querySelector<HTMLButtonElement>(
    `[data-testid="spatial-toggle"][data-node-id="${nodeId}"]`,
  );
  if (found === null) throw new Error(`펼치기 버튼을 찾지 못했다: ${nodeId}`);
  return found;
};

/** 마디를 순서대로 눌러 아래로 내려가며 펼친다. */
const expandTo = (...path: readonly string[]): void => {
  for (const label of path) toggleFor(nodeButton(label)).click();
};

const warnings = (context: TestContext): LogEntry[] =>
  context.logger.entries.filter((entry) => entry.level === 'warn');

interface Harness {
  readonly context: TestContext;
  readonly port: FakePort;
  readonly selections: AppCommandInput<'viewer/select-products'>[];
  readonly loadModel: (id?: ModelId, displayName?: string) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const port = createFakePort();
  const selections: AppCommandInput<'viewer/select-products'>[] = [];

  context.commands.register('viewer/select-products', (input) => {
    selections.push(input);
    return Promise.resolve({ selected: [] });
  });

  const panel = createSpatialPanel({ selector, port });
  await panel.initialize(context);
  await panel.start();

  return {
    context,
    port,
    selections,
    loadModel: async (id = modelId, displayName = 'fixture.ifc') => {
      await context.events.publish('model/loaded', { modelId: id, displayName, schema: 'IFC4' });
    },
    dispose: () => panel.dispose(),
  };
};

beforeEach(() => {
  document.body.innerHTML = markup;
});

describe('createSpatialPanel', () => {
  it('모델이 없으면 빈 상태를 보여 준다', async () => {
    await setup();

    expect(document.querySelector(selector)?.textContent).toBe('열린 모델 없음');
  });

  it('모델을 열면 최상위 마디를 펼친 채로 그린다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());

    await harness.loadModel();

    expect(labels()).toEqual(['Fixture Project (3)', 'Fixture Site (3)']);
  });

  it('펼치면 아래 계층과 분류 묶음이 보인다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();

    expandTo('Fixture Site (3)', 'Fixture Building (3)', 'Level 1 (3)');

    expect(labels()).toContain('IFCWALL (2)');
    expect(labels()).toContain('IFCSLAB (1)');
  });

  it('다시 누르면 접힌다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();

    expandTo('Fixture Site (3)');
    expandTo('Fixture Site (3)');

    expect(labels()).toEqual(['Fixture Project (3)', 'Fixture Site (3)']);
  });

  it('분류 묶음을 누르면 그 아래 부재를 선택한다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();
    expandTo('Fixture Site (3)', 'Fixture Building (3)', 'Level 1 (3)');

    nodeButton('IFCWALL (2)').click();
    await Promise.resolve();

    expect(harness.selections.at(-1)?.products).toEqual([
      { modelId, globalId: '0BnKdW4tq7SfUcM3vHxZgR' },
      { modelId, globalId: '1MjTgR8dp5NkXbC2wFyQsA' },
    ]);
  });

  it('부재 하나를 누르면 그 부재만 선택한다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();
    expandTo('Fixture Site (3)', 'Fixture Building (3)', 'Level 1 (3)', 'IFCSLAB (1)');

    nodeButton('Slab 1').click();
    await Promise.resolve();

    expect(harness.selections.at(-1)?.products).toEqual([
      { modelId, globalId: '2YsHnV6bk3PgZdL9uCxWtM' },
    ]);
  });

  it('층을 누르면 그 층의 부재를 모두 선택한다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();
    expandTo('Fixture Site (3)', 'Fixture Building (3)');

    nodeButton('Level 1 (3)').click();
    await Promise.resolve();

    expect(harness.selections.at(-1)?.products).toHaveLength(3);
  });

  it('모델을 해제하면 그 모델의 트리를 지운다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();

    await harness.context.events.publish('model/unloaded', { modelId });

    expect(document.querySelector(selector)?.textContent).toBe('열린 모델 없음');
  });

  it('모델이 여럿이면 각각의 트리를 함께 그린다', async () => {
    const harness = await setup();
    const second = 'model-2' as ModelId;
    harness.port.trees.set(modelId, fixtureTree());
    harness.port.trees.set(second, node('IFCPROJECT', 'Second Project', '1KpRfB7wz4MgVaJ2xTnQcE'));

    await harness.loadModel();
    await harness.loadModel(second, 'second.ifc');

    expect(labels()).toEqual(['Fixture Project (3)', 'Fixture Site (3)', 'Second Project']);
  });

  it('공간 구조를 읽지 못하면 경고를 남기고 트리를 비운 채 둔다', async () => {
    const harness = await setup();

    await harness.loadModel();

    expect(warnings(harness.context).at(-1)?.message).toContain('공간 구조를 읽지 못했다');
    expect(document.querySelector(selector)?.textContent).toBe('열린 모델 없음');
  });

  it('GlobalId 문제를 경고로 남긴다', async () => {
    const harness = await setup();
    harness.port.trees.set(
      modelId,
      node('IFCPROJECT', 'Fixture Project', '0hT6cQ2kv9NrXbW8ySmLdP', [
        node('IFCWALL', 'Wall A', null),
      ]),
    );

    await harness.loadModel();

    expect(warnings(harness.context).at(-1)?.details).toMatchObject({
      code: 'spatial.global-id.missing',
      count: 1,
    });
  });

  it('dispose하면 그린 것을 모두 지운다', async () => {
    const harness = await setup();
    harness.port.trees.set(modelId, fixtureTree());
    await harness.loadModel();

    await harness.dispose();

    expect(document.querySelector(selector)?.textContent).toBe('');
  });
});
