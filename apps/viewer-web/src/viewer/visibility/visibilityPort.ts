import type { ProductKey } from '@bim4d/contracts';

/**
 * 부재의 표시 여부를 다루는 Port.
 *
 * 인자는 영구 키(modelId + GlobalId)다. Adapter 내부 번호는 Port를 넘지 않는다.
 * Adapter가 GlobalId를 자기 식별자로 되돌려 처리한다.
 */
export interface VisibilityPort {
  hide(products: readonly ProductKey[]): Promise<void>;
  show(products: readonly ProductKey[]): Promise<void>;
  /** 주어진 부재만 남기고 나머지를 모두 감춘다. */
  isolate(products: readonly ProductKey[]): Promise<void>;
  /** 감춘 것을 모두 되돌린다. */
  showAll(): Promise<void>;
}
