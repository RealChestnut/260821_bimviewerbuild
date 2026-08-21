import type { GlobalId } from '@bim4d/contracts';

/**
 * Adapter가 읽어 온 공간 구조 한 마디.
 *
 * IFC 공간 계층과 조립 관계는 `IfcRelAggregates`와 `IfcRelContainedInSpatialStructure`로
 * 표현된다 (기준서 9절, 12절). 그 관계를 푸는 일은 Adapter 몫이고, 도메인은 결과 트리만 다룬다.
 */
export interface RawSpatialNode {
  /** IFC Entity 이름. 예: `IFCBUILDINGSTOREY`. 파일에 따라 없을 수 있다. */
  readonly category: string | null;
  readonly name: string | null;
  /** `IfcRoot.GlobalId`. 파일에 따라 비어 있을 수 있다. */
  readonly globalId: GlobalId | null;
  readonly children: readonly RawSpatialNode[];
}

/**
 * 화면에 그리는 마디의 종류.
 *
 * 공간 요소인지 조립체인지는 Entity 이름 목록을 코드에 굳혀야 알 수 있고, 그 목록은
 * Schema 버전마다 다르다. 대신 "아래에 무언가를 담고 있는가"로만 나눈다.
 * 담고 있으면 `branch`, 담긴 것이 없으면 `product`다. `category`는 분류별로 묶으려고
 * 트리를 만들 때 끼워 넣는 마디이며 IFC에는 대응하는 객체가 없다.
 */
export type SpatialNodeKind = 'branch' | 'category' | 'product';

export interface SpatialTreeNode {
  /** 트리 안에서 마디를 구분하는 표시용 id. 영구 키가 아니다. */
  readonly id: string;
  readonly kind: SpatialNodeKind;
  readonly label: string;
  readonly category: string | null;
  readonly globalId: GlobalId | null;
  /** 이 마디 아래에 있는 부재 수. `category`와 `branch`는 자손을 합산한 값이다. */
  readonly productCount: number;
  readonly children: readonly SpatialTreeNode[];
}

/** 원본 파일에서 발견한 문제. 조용히 넘어가지 않고 호출부가 기록하게 한다. */
export interface SpatialTreeIssue {
  readonly code: 'spatial.global-id.missing' | 'spatial.global-id.duplicate';
  readonly count: number;
  /** 처음 마주친 마디의 표시 이름. 원본에서 위치를 찾는 실마리다. */
  readonly sample: string;
}

export interface SpatialTree {
  readonly root: SpatialTreeNode;
  readonly issues: readonly SpatialTreeIssue[];
}

const NAMELESS = '(이름 없음)';
const UNCATEGORIZED = '(분류 없음)';

interface BuildState {
  readonly issues: Map<SpatialTreeIssue['code'], { count: number; sample: string }>;
  readonly seenGlobalIds: Set<string>;
  internalIdCounter: number;
}

const labelOf = (node: RawSpatialNode): string => {
  const name = node.name?.trim() ?? '';
  if (name.length > 0) return name;
  return node.category ?? NAMELESS;
};

const record = (state: BuildState, code: SpatialTreeIssue['code'], sample: string): void => {
  const found = state.issues.get(code);
  if (found === undefined) {
    state.issues.set(code, { count: 1, sample });
    return;
  }
  found.count += 1;
};

/**
 * 마디의 표시용 id를 정한다.
 *
 * GlobalId가 있으면 그대로 쓴다. 없거나 파일 안에서 중복이면 내부 id를 만들고 문제로 남긴다.
 * 두 마디가 같은 id를 갖게 두면 트리에서 어느 쪽을 눌렀는지 구분할 수 없다.
 */
const identify = (node: RawSpatialNode, state: BuildState): string => {
  const internal = (): string => `node-${String(++state.internalIdCounter)}`;

  if (node.globalId === null) {
    record(state, 'spatial.global-id.missing', labelOf(node));
    return internal();
  }
  if (state.seenGlobalIds.has(node.globalId)) {
    record(state, 'spatial.global-id.duplicate', labelOf(node));
    return internal();
  }
  state.seenGlobalIds.add(node.globalId);
  return node.globalId;
};

const buildNode = (node: RawSpatialNode, state: BuildState): SpatialTreeNode => {
  const id = identify(node, state);
  const label = labelOf(node);

  if (node.children.length === 0) {
    return {
      id,
      kind: 'product',
      label,
      category: node.category,
      globalId: node.globalId,
      productCount: 1,
      children: [],
    };
  }

  const branches: SpatialTreeNode[] = [];
  const leaves: RawSpatialNode[] = [];
  for (const child of node.children) {
    if (child.children.length > 0) branches.push(buildNode(child, state));
    else leaves.push(child);
  }

  const children = [...branches, ...groupByCategory(leaves, id, state)];
  return {
    id,
    kind: 'branch',
    label,
    category: node.category,
    globalId: node.globalId,
    productCount: children.reduce((sum, child) => sum + child.productCount, 0),
    children,
  };
};

/**
 * 같은 층에 놓인 부재를 분류별로 묶는다.
 *
 * 층 하나에 부재가 수백 개 있으면 목록을 그대로 펼쳐 봐야 읽히지 않는다.
 * 분류 이름은 원본 Entity 이름을 그대로 쓴다. 우리가 정한 분류 체계를 끼워 넣지 않는다.
 */
const groupByCategory = (
  leaves: readonly RawSpatialNode[],
  parentId: string,
  state: BuildState,
): SpatialTreeNode[] => {
  const buckets = new Map<string, RawSpatialNode[]>();
  for (const leaf of leaves) {
    const key = leaf.category ?? UNCATEGORIZED;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [leaf]);
    else bucket.push(leaf);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, nodes]) => {
      const children = nodes
        .map((leaf) => buildNode(leaf, state))
        .sort((left, right) => left.label.localeCompare(right.label));
      return {
        id: `${parentId}/${category}`,
        kind: 'category' as const,
        label: category,
        category: category === UNCATEGORIZED ? null : category,
        globalId: null,
        productCount: children.length,
        children,
      };
    });
};

/**
 * 원본 공간 구조를 화면에 그릴 트리로 바꾼다.
 *
 * 담긴 것이 있는 마디는 계층 그대로 두고, 잎에 해당하는 부재만 분류별로 묶는다.
 */
export const buildSpatialTree = (root: RawSpatialNode): SpatialTree => {
  const state: BuildState = {
    issues: new Map(),
    seenGlobalIds: new Set(),
    internalIdCounter: 0,
  };

  const built = buildNode(root, state);
  const issues = [...state.issues.entries()].map(([code, { count, sample }]) => ({
    code,
    count,
    sample,
  }));

  return { root: built, issues };
};

/**
 * 마디 아래에 있는 부재의 GlobalId를 모은다.
 *
 * 담고 있는 마디 자신의 GlobalId는 넣지 않는다. 층이나 조립체를 눌렀을 때 필요한 것은
 * 그 아래 실제 부재이고, 담는 객체 자체에는 대개 형상이 없다.
 */
export const collectProductGlobalIds = (node: SpatialTreeNode): readonly GlobalId[] => {
  const result: GlobalId[] = [];
  const walk = (current: SpatialTreeNode): void => {
    if (current.kind === 'product' && current.globalId !== null) result.push(current.globalId);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return result;
};

/** 트리에서 id로 마디 하나를 찾는다. 없으면 null. */
export const findSpatialNode = (root: SpatialTreeNode, id: string): SpatialTreeNode | null => {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findSpatialNode(child, id);
    if (found !== null) return found;
  }
  return null;
};
