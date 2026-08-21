/**
 * Viewer World Port.
 *
 * Feature는 이 인터페이스에만 의존한다. That Open Components와 Three.js는 Adapter 뒤에 둔다.
 * Port를 통해 오가는 것은 식별자와 상태뿐이며, Scene이나 Mesh 객체는 넘기지 않는다.
 */
export interface ViewerWorld {
  /** Adapter가 만든 World의 식별자. 로그와 Event payload에 쓴다. */
  readonly id: string;
  /** 렌더 루프 참여 여부. `stop()`에서 끄고 `start()`에서 켠다. */
  setEnabled(enabled: boolean): void;
  /** GPU 자원과 DOM 캔버스를 해제한다. 호출 후 이 World는 다시 쓰지 않는다. */
  dispose(): void;
}

export interface ViewerWorldFactory {
  /** 주어진 컨테이너 요소 안에 World를 만든다. */
  create(container: HTMLElement): ViewerWorld;
}
