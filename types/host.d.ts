/**
 * 호스트(WebView2 Shell, 브라우저 테스트)가 부르는 애플리케이션 제어 API.
 *
 * 애플리케이션 코드와 브라우저 테스트가 같은 선언을 보도록 저장소 루트에 둔다.
 */
interface Bim4dHostApi {
  /** Component를 stop → dispose 순서로 해제한다. 여러 번 불러도 한 번만 수행한다. */
  shutdown(): Promise<void>;
}

interface Window {
  bim4d?: Bim4dHostApi;
}
