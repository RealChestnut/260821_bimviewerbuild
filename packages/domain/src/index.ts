export { parseIfcHeader } from './ifcHeader.js';
export type { IfcHeader } from './ifcHeader.js';
export { formatProductKey, parseGlobalId, parseModelId, parseProductKey } from './productKey.js';
export type { Parsed } from './productKey.js';
export { buildSpatialTree, collectProductGlobalIds, findSpatialNode } from './spatialTree.js';
export type {
  RawSpatialNode,
  SpatialNodeKind,
  SpatialTree,
  SpatialTreeIssue,
  SpatialTreeNode,
} from './spatialTree.js';
