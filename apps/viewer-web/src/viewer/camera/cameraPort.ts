/**
 * 카메라를 다루는 Port.
 *
 * 좌표만 Port를 넘나든다. Three.js 카메라와 controls는 Adapter 뒤에 있다.
 */

/** 카메라가 어디에서 어디를 보고 있는지. 단위는 모델 좌표와 같다. */
export interface CameraView {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export interface CameraPort {
  /** World가 없으면 null. */
  getView(): Promise<CameraView | null>;
  /** 저장해 둔 시점으로 되돌린다. */
  setView(view: CameraView, options?: { readonly animate?: boolean }): Promise<void>;
  /** 적재된 모델 전체가 보이도록 맞춘다. 맞출 모델이 없으면 false. */
  fitToModels(): Promise<boolean>;
}
