import type { GlobalId, ModelId } from '@bim4d/contracts';

/**
 * 화면에서 객체를 집고 강조하는 Port.
 *
 * Feature는 이 인터페이스만 본다. Raycast와 Material은 Adapter 뒤에 있다.
 * Port를 넘나드는 것은 좌표와 식별자뿐이며, Mesh나 Three.js 객체는 넘기지 않는다.
 */
export interface SelectionHit {
  readonly modelId: ModelId;
  readonly globalId: GlobalId;
  /** 모델 안에서 객체를 가리키는 Adapter 내부 번호. 저장하지 않는다. */
  readonly localId: number;
}

export interface SelectionPort {
  /** 화면 좌표에서 객체를 집는다. 빈 곳이면 null. */
  pickAt(point: {
    readonly clientX: number;
    readonly clientY: number;
  }): Promise<SelectionHit | null>;
  highlight(hit: SelectionHit): Promise<void>;
  clearHighlight(): Promise<void>;
}
