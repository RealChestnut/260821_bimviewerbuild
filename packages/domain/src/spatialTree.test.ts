import { describe, expect, it } from 'vitest';

import type { GlobalId } from '@bim4d/contracts';

import { buildSpatialTree, collectProductGlobalIds, findSpatialNode } from './spatialTree.js';
import type { RawSpatialNode } from './spatialTree.js';

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
          node('IFCWALL', 'Wall B', '1MjTgR8dp5NkXbC2wFyQsA'),
          node('IFCWALL', 'Wall A', '0BnKdW4tq7SfUcM3vHxZgR'),
          node('IFCSLAB', 'Slab 1', '2YsHnV6bk3PgZdL9uCxWtM'),
        ]),
      ]),
    ]),
  ]);

describe('buildSpatialTree', () => {
  it('공간 계층을 그대로 두고 잎 부재만 분류별로 묶는다', () => {
    const { root } = buildSpatialTree(fixtureTree());

    const storey = findSpatialNode(root, '3QwLmT5ce8KjYbV0rPzHdG');
    expect(storey?.kind).toBe('branch');
    expect(storey?.children.map((child) => [child.label, child.productCount])).toEqual([
      ['IFCSLAB', 1],
      ['IFCWALL', 2],
    ]);
  });

  it('분류 안의 부재를 이름 순으로 정렬한다', () => {
    const { root } = buildSpatialTree(fixtureTree());

    const walls = findSpatialNode(root, '3QwLmT5ce8KjYbV0rPzHdG/IFCWALL');
    expect(walls?.children.map((child) => child.label)).toEqual(['Wall A', 'Wall B']);
  });

  it('담고 있는 마디의 부재 수는 자손을 합한 값이다', () => {
    const { root } = buildSpatialTree(fixtureTree());

    expect(root.productCount).toBe(3);
  });

  it('이름이 없으면 분류 이름을 표시 이름으로 쓴다', () => {
    const { root } = buildSpatialTree(node('IFCPROJECT', '  ', '0hT6cQ2kv9NrXbW8ySmLdP'));

    expect(root.label).toBe('IFCPROJECT');
  });

  it('이름도 분류도 없으면 이름 없음으로 표시한다', () => {
    const { root } = buildSpatialTree(node(null, null, '0hT6cQ2kv9NrXbW8ySmLdP'));

    expect(root.label).toBe('(이름 없음)');
  });

  it('분류가 없는 부재를 한 묶음으로 모은다', () => {
    const { root } = buildSpatialTree(
      node('IFCPROJECT', 'P', '0hT6cQ2kv9NrXbW8ySmLdP', [
        node(null, 'Unknown 1', '1MjTgR8dp5NkXbC2wFyQsA'),
      ]),
    );

    const group = root.children[0];
    expect(group?.label).toBe('(분류 없음)');
    expect(group?.category).toBeNull();
  });

  it('GlobalId가 없는 마디에 내부 id를 만들고 문제로 남긴다', () => {
    const { root, issues } = buildSpatialTree(
      node('IFCPROJECT', 'P', '0hT6cQ2kv9NrXbW8ySmLdP', [node('IFCWALL', 'Wall A', null)]),
    );

    const wall = root.children[0]?.children[0];
    expect(wall?.id).toBe('node-1');
    expect(wall?.globalId).toBeNull();
    expect(issues).toEqual([{ code: 'spatial.global-id.missing', count: 1, sample: 'Wall A' }]);
  });

  it('GlobalId가 중복이면 뒤에 온 마디에 내부 id를 만들고 문제로 남긴다', () => {
    const duplicated = '1MjTgR8dp5NkXbC2wFyQsA';
    const { root, issues } = buildSpatialTree(
      node('IFCPROJECT', 'P', '0hT6cQ2kv9NrXbW8ySmLdP', [
        node('IFCWALL', 'Wall A', duplicated),
        node('IFCWALL', 'Wall B', duplicated),
      ]),
    );

    const walls = root.children[0]?.children ?? [];
    expect(walls.map((wall) => wall.id)).toEqual([duplicated, 'node-1']);
    expect(issues).toEqual([{ code: 'spatial.global-id.duplicate', count: 1, sample: 'Wall B' }]);
  });

  it('문제가 없으면 issues가 비어 있다', () => {
    expect(buildSpatialTree(fixtureTree()).issues).toEqual([]);
  });

  it('담긴 것이 있는 부재는 계층을 유지한다', () => {
    const assembly = '2GkPdM7xu4NbYfR1zTcWqO';
    const { root } = buildSpatialTree(
      node('IFCPROJECT', 'P', '0hT6cQ2kv9NrXbW8ySmLdP', [
        node('IFCELEMENTASSEMBLY', 'Truss 1', assembly, [
          node('IFCBEAM', 'Beam 1', '1MjTgR8dp5NkXbC2wFyQsA'),
        ]),
      ]),
    );

    const truss = findSpatialNode(root, assembly);
    expect(truss?.kind).toBe('branch');
    expect(truss?.children[0]?.label).toBe('IFCBEAM');
  });
});

describe('collectProductGlobalIds', () => {
  it('마디 아래의 부재 GlobalId만 모은다', () => {
    const { root } = buildSpatialTree(fixtureTree());
    const storey = findSpatialNode(root, '3QwLmT5ce8KjYbV0rPzHdG');

    expect(collectProductGlobalIds(storey!)).toEqual([
      '2YsHnV6bk3PgZdL9uCxWtM',
      '0BnKdW4tq7SfUcM3vHxZgR',
      '1MjTgR8dp5NkXbC2wFyQsA',
    ]);
  });

  it('담고 있는 마디 자신의 GlobalId는 넣지 않는다', () => {
    const { root } = buildSpatialTree(fixtureTree());

    expect(collectProductGlobalIds(root)).not.toContain('0hT6cQ2kv9NrXbW8ySmLdP');
  });
});

describe('findSpatialNode', () => {
  it('없는 id에는 null을 돌려준다', () => {
    const { root } = buildSpatialTree(fixtureTree());

    expect(findSpatialNode(root, 'no-such-id')).toBeNull();
  });
});
