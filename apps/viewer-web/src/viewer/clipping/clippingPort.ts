/** 자를 방향. 모델을 기준으로 한 축이며 화면 좌표가 아니다. */
export type ClipAxis = 'X' | 'Y' | 'Z';

/**
 * 단면 평면을 다루는 Port.
 *
 * 평면은 열린 모델 전체의 중앙을 지나는 축 정렬 평면으로 만든다. 마우스가 가리키는 곳에
 * 만드는 방식은 같은 조작이 화면 상태에 따라 다른 결과를 내므로 쓰지 않는다.
 */
export interface ClippingPort {
  /** 만들었으면 평면 id, 자를 대상이 없으면 null. */
  addAxisPlane(axis: ClipAxis): Promise<string | null>;
  removeAll(): Promise<void>;
}
