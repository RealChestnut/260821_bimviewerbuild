/**
 * 카메라 자세 하나.
 *
 * 마스터 계획 6.2절의 `ViewerState`가 결국 담을 값이며, 단위는 미터다. Three.js 카메라
 * 객체나 행렬은 Port를 넘지 않는다.
 *
 * `up`이 없으면 자세가 온전하지 않다. 위치와 시선이 같아도 up이 다르면 화면이 돌아간
 * 그림이 나오고, 카메라가 천정 부근을 지나오면 up이 실제로 바뀐다.
 */
export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

export interface ViewpointPort {
  /** 지금 카메라 자세를 읽는다. World가 없으면 null. */
  capture(): Promise<CameraPose | null>;
  /** 저장해 둔 자세로 되돌린다. 되돌릴 수 없으면 false. */
  restore(pose: CameraPose): Promise<boolean>;
}
