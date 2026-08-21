/**
 * 단면을 다루는 Port.
 *
 * 평면은 Adapter가 소유하고, Feature는 평면 id만 들고 있는다. Three.js Plane이나
 * gizmo 객체는 Port를 넘지 않는다.
 */

/** 좌표축에 직교하는 단면. 값은 자르는 방향의 축이다. */
export type SectionAxis = 'x' | 'y' | 'z';

export interface SectionPort {
  /**
   * 적재된 모델의 중심을 지나는 축 직교 평면을 만든다.
   *
   * 모델이 없으면 자를 대상이 없으므로 null. 만든 평면은 화면에서 끌어 옮길 수 있다.
   */
  createAxisPlane(axis: SectionAxis): Promise<string | null>;
  /** 평면 하나를 지운다. 없는 id면 false. */
  remove(planeId: string): Promise<boolean>;
  /** 모든 평면을 지운다. 지운 수를 돌려준다. */
  removeAll(): Promise<number>;
  /** 평면을 지우지 않고 자르기만 잠시 멈추거나 되살린다. */
  setEnabled(enabled: boolean): Promise<void>;
}
