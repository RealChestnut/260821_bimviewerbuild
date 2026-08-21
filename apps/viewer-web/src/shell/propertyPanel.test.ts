// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import type { LogEntry } from '../kernel/testing/testLogger.js';
import '../viewer/selection/selectionEvents.js';
import type { ProductProperties, PropertyPort } from '../viewer/property/propertyPort.js';

import { createPropertyPanel } from './propertyPanel.js';

const selector = '[data-testid="property-panel"]';
const markup = `<aside data-testid="property-panel"></aside>`;

const modelId = 'model-1' as ModelId;
const wall: ProductKey = { modelId, globalId: '0BnKdW4tq7SfUcM3vHxZgR' as GlobalId };
const slab: ProductKey = { modelId, globalId: '2YsHnV6bk3PgZdL9uCxWtM' as GlobalId };

/** fixture의 Wall A와 같은 모양이다. 표준 Pset 하나와 Qto 하나를 가진다. */
const wallProperties = (): ProductProperties => ({
  product: wall,
  category: 'IFCWALL',
  name: 'Wall A',
  attributes: [
    { name: 'Name', value: 'Wall A', type: 'IFCLABEL' },
    { name: 'Tag', value: 'WALL-A', type: 'IFCIDENTIFIER' },
  ],
  sets: [
    {
      name: 'Pset_WallCommon',
      properties: [
        { name: 'IsExternal', value: 'TRUE', type: 'IFCBOOLEAN' },
        { name: 'LoadBearing', value: 'TRUE', type: 'IFCBOOLEAN' },
      ],
    },
    {
      name: 'Qto_WallBaseQuantities',
      properties: [{ name: 'NetSideArea', value: '18', type: 'IFCAREAMEASURE' }],
    },
  ],
});

interface FakePort extends PropertyPort {
  readonly answers: Map<string, ProductProperties>;
  /** 조회를 붙잡아 둘 때 쓴다. 늦게 오는 응답을 만들 수 있다. */
  gate: { readonly promise: Promise<void>; readonly open: () => void } | null;
}

const createFakePort = (): FakePort => {
  const port: FakePort = {
    answers: new Map(),
    gate: null,
    read: async (product) => {
      if (port.gate !== null) await port.gate.promise;
      return port.answers.get(product.globalId) ?? null;
    },
  };
  return port;
};

const createGate = (): NonNullable<FakePort['gate']> => {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

const panelText = (): string => document.querySelector(selector)?.textContent ?? '';

const sectionNames = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="property-set"]')].map(
    (element) => element.dataset['setName'] ?? '',
  );

const rows = (setName: string): [string, string][] => {
  const section = document.querySelector(`[data-set-name="${setName}"]`);
  if (section === null) throw new Error(`Set을 찾지 못했다: ${setName}`);

  return [...section.querySelectorAll('[data-testid="property-row"]')].map((row) => [
    row.querySelector('th')?.textContent ?? '',
    row.querySelector('td')?.textContent ?? '',
  ]);
};

const warnings = (context: TestContext): LogEntry[] =>
  context.logger.entries.filter((entry) => entry.level === 'warn');

interface Harness {
  readonly context: TestContext;
  readonly port: FakePort;
  readonly select: (...products: readonly ProductKey[]) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const setup = async (): Promise<Harness> => {
  const context = createTestContext();
  const port = createFakePort();

  const panel = createPropertyPanel({ selector, port });
  await panel.initialize(context);
  await panel.start();

  return {
    context,
    port,
    select: async (...products) => {
      await context.events.publish('selection/changed', { selected: products });
      // Port 조회가 한 번 더 돌아올 틈을 준다.
      await Promise.resolve();
      await Promise.resolve();
    },
    dispose: () => panel.dispose(),
  };
};

beforeEach(() => {
  document.body.innerHTML = markup;
});

describe('createPropertyPanel', () => {
  it('선택이 없으면 빈 상태를 보여 준다', async () => {
    await setup();

    expect(panelText()).toBe('선택 없음');
  });

  it('부재 하나를 고르면 이름과 분류를 보여 준다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());

    await harness.select(wall);

    expect(document.querySelector('[data-testid="property-title"]')?.textContent).toBe('Wall A');
    expect(document.querySelector('[data-testid="property-category"]')?.textContent).toBe(
      'IFCWALL',
    );
  });

  it('Attribute와 원본 Set을 모두 보여 준다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());

    await harness.select(wall);

    expect(sectionNames()).toEqual(['기본 Attribute', 'Pset_WallCommon', 'Qto_WallBaseQuantities']);
    expect(rows('Pset_WallCommon')).toEqual([
      ['IsExternal', 'TRUE'],
      ['LoadBearing', 'TRUE'],
    ]);
    expect(rows('Qto_WallBaseQuantities')).toEqual([['NetSideArea', '18']]);
  });

  it('사용자 정의 Set도 거르지 않고 보여 준다', async () => {
    const harness = await setup();
    harness.port.answers.set(slab.globalId, {
      product: slab,
      category: 'IFCSLAB',
      name: 'Slab 1',
      attributes: [{ name: 'Name', value: 'Slab 1', type: 'IFCLABEL' }],
      sets: [
        {
          name: 'BIM4D_Custom',
          properties: [{ name: 'BIM4D_Zone', value: 'Zone-A', type: 'IFCLABEL' }],
        },
      ],
    });

    await harness.select(slab);

    expect(rows('BIM4D_Custom')).toEqual([['BIM4D_Zone', 'Zone-A']]);
  });

  it('원본 Type은 값 옆에 쓰지 않고 title로 남긴다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());

    await harness.select(wall);

    const value = document.querySelector('[data-set-name="Qto_WallBaseQuantities"] td');
    expect(value?.getAttribute('title')).toBe('IFCAREAMEASURE');
  });

  it('Set이 하나도 없어도 오류로 다루지 않는다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, {
      product: wall,
      category: 'IFCWALL',
      name: 'Wall A',
      attributes: [{ name: 'Name', value: 'Wall A', type: 'IFCLABEL' }],
      sets: [],
    });

    await harness.select(wall);

    expect(document.querySelector('[data-testid="property-no-set"]')?.textContent).toBe(
      '속성 Set 없음',
    );
    expect(warnings(harness.context)).toHaveLength(0);
  });

  it('여러 개를 고르면 개수만 알린다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());

    await harness.select(wall, slab);

    expect(panelText()).toBe('2개 선택');
  });

  it('선택이 풀리면 빈 상태로 돌아간다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());
    await harness.select(wall);

    await harness.select();

    expect(panelText()).toBe('선택 없음');
  });

  it('속성을 읽지 못하면 경고를 남긴다', async () => {
    const harness = await setup();

    await harness.select(wall);

    expect(warnings(harness.context).at(-1)?.message).toContain('속성을 읽지 못했다');
    expect(panelText()).toBe('선택 없음');
  });

  it('늦게 도착한 이전 조회 결과는 버린다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());
    harness.port.answers.set(slab.globalId, {
      product: slab,
      category: 'IFCSLAB',
      name: 'Slab 1',
      attributes: [],
      sets: [],
    });

    const gate = createGate();
    harness.port.gate = gate;
    await harness.select(wall);

    harness.port.gate = null;
    await harness.select(slab);
    gate.open();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('[data-testid="property-title"]')?.textContent).toBe('Slab 1');
  });

  it('dispose하면 그린 것을 모두 지운다', async () => {
    const harness = await setup();
    harness.port.answers.set(wall.globalId, wallProperties());
    await harness.select(wall);

    await harness.dispose();

    expect(panelText()).toBe('');
  });
});
