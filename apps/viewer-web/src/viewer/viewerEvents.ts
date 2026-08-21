/**
 * Viewer 슬라이스가 발행하는 Event.
 *
 * 이름은 `AppEventMap`의 키로만 등장한다. 코드 여러 곳에 문자열로 쓰지 않는다.
 */

declare module '@bim4d/contracts' {
  interface AppEventMap {
    /** World가 만들어져 렌더 루프에 들어갔다. */
    'viewer/world-ready': { readonly worldId: string };
    /** World가 해제됐다. GPU 자원과 캔버스가 모두 반납된 뒤 발행한다. */
    'viewer/world-disposed': { readonly worldId: string };
    /** World 생성이 실패했다. 사용자에게는 Viewer를 열 수 없다고 알린다. */
    'viewer/world-failed': { readonly reason: string };
  }
}

export {};
