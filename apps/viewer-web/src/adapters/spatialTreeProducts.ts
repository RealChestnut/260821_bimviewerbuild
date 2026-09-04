import { buildSpatialTree, collectProductGlobalIds } from '@bim4d/domain';
import type { GlobalId, ModelId } from '@bim4d/contracts';

import type { ProductsOf } from '../scheduler/modelBindingComponent.js';
import type { SpatialTreePort } from '../viewer/spatial/spatialTreePort.js';

/**
 * 공간 구조 트리에서 부재 GlobalId만 모은다.
 *
 * 모델에 무엇이 들어 있는지 묻는 유일한 길이 지금은 공간 구조다. 모델이 없거나 아직
 * 적재 중이면 빈 목록이며, 그때는 "사라진 부재가 없다"가 아니라 "셀 수 없다"이므로
 * 부르는 쪽이 그 뜻을 알고 써야 한다.
 */
export const createSpatialTreeProducts =
  (port: SpatialTreePort): ProductsOf =>
  async (modelId: ModelId): Promise<readonly GlobalId[]> => {
    const raw = await port.read(modelId);
    if (raw === null) return [];
    return collectProductGlobalIds(buildSpatialTree(raw).root);
  };
