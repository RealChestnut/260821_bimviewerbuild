import type { ElementDisplayState, ProductKey } from '@bim4d/contracts';

export interface DisplayStateChange {
  readonly product: ProductKey;
  readonly state: ElementDisplayState;
}

/**
 * 시뮬레이션 상태를 화면에 반영하는 Port.
 *
 * 인자는 영구 키(modelId + GlobalId)다. Adapter 내부 번호는 Port를 넘지 않는다.
 * 전체 상태가 아니라 바뀐 것만 받는다. 타임라인을 한 칸 옮길 때마다 모델 전체를 다시
 * 그리면 부재가 많은 모델에서 감당할 수 없다.
 */
export interface SimulationViewPort {
  apply(changes: readonly DisplayStateChange[]): Promise<void>;
  /** 시뮬레이션이 건 표현을 되돌린다. 원래의 사용자 표시 상태로 돌아간다. */
  reset(products: readonly ProductKey[]): Promise<void>;
}
