/**
 * 카메라 자세 하나. 위치와 바라보는 지점만 담는다.
 *
 * 마스터 계획 6.2절의 `ViewerState`가 결국 담을 값이며, 단위는 미터다. Three.js 카메라
 * 객체나 행렬은 Port를 넘지 않는다.
 */
export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export interface ViewpointPort {
  /** 지금 카메라 자세를 읽는다. World가 없으면 null. */
  capture(): Promise<CameraPose | null>;
  /** 저장해 둔 자세로 되돌린다. 되돌릴 수 없으면 false. */
  restore(pose: CameraPose): Promise<boolean>;
}
