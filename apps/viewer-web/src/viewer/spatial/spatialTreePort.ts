import type { ModelId } from '@bim4d/contracts';
import type { RawSpatialNode } from '@bim4d/domain';

/**
 * 적재된 모델의 공간 구조를 읽는 Query Port.
 *
 * 조회는 Event가 아니라 Port 직접 호출이다 (마스터 계획 5.3절).
 * Port를 넘나드는 것은 식별자와 이름뿐이며, Mesh나 Fragment 데이터는 넘기지 않는다.
 */
export interface SpatialTreePort {
  /** 모델이 없거나 아직 적재 중이면 null. */
  read(modelId: ModelId): Promise<RawSpatialNode | null>;
}
