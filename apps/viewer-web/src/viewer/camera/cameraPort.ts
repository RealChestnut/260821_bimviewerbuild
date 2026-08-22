/** 미리 정해 둔 시점. 모델 전체가 화면에 들어오도록 거리를 맞춘다. */
export type StandardView = 'FRONT' | 'TOP' | 'ISO';

/**
 * 카메라 조작을 다루는 Port.
 *
 * Three.js 카메라 객체는 Port를 넘지 않는다. Feature는 "어디를 보라"만 말한다.
 */
export interface CameraPort {
  /** 열린 모델 전체가 보이도록 맞춘다. 맞출 대상이 없으면 false. */
  fitToModels(): Promise<boolean>;
  /** 표준 시점으로 옮긴다. 대상이 없으면 false. */
  setStandardView(view: StandardView): Promise<boolean>;
}
