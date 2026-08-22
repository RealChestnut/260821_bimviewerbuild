import type { ModelId, ProductKey } from '@bim4d/contracts';

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
  /** 모델 하나를 통째로 감추거나 되돌린다. 여러 모델을 겹쳐 볼 때 쓴다. */
  setModelVisible(modelId: ModelId, visible: boolean): Promise<void>;
  /** 감춘 것을 모두 되돌린다. 모델 단위로 감춘 것도 함께 되돌아온다. */
  showAll(): Promise<void>;
}
