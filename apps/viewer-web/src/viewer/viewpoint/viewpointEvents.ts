/**
 * Viewpoint 슬라이스가 발행하는 Event와 받는 Command.
 *
 * Viewpoint는 "그때 화면"이다. 카메라만 저장하면 같은 화면이 나오지 않는다.
 * 무엇이 감춰져 있었는지, 어디를 잘라 두었는지가 함께 있어야 한다.
 *
 * Event에는 목록의 이름표만 싣는다. 저장된 내용 전체는 Command 응답으로만 나간다.
 */

import type { Viewpoint } from './viewpointComponent.js';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'viewpoint/changed': {
      readonly items: readonly { readonly id: string; readonly name: string }[];
    };
  }

  interface AppCommandMap {
    'viewer/save-viewpoint': {
      input: { readonly name?: string };
      output: { readonly id: string; readonly name: string };
    };
    'viewer/restore-viewpoint': {
      input: { readonly id: string };
      output: { readonly restored: boolean };
    };
    /**
     * 지금 화면을 뜬다. 목록에 넣지 않는다.
     *
     * 프로젝트 저장이 쓰는 길이다. 사용자가 이름 붙여 저장한 시점과 "지금 화면"은 다른
     * 것이라 목록을 늘리지 않는다 (ADR-0013).
     */
    'viewer/capture-viewpoint': {
      input: Record<string, never>;
      /** World가 없으면 없다. */
      output: { readonly viewpoint: Viewpoint | null };
    };
    /** 받은 화면을 그대로 되살린다. 목록에 없는 것도 된다. */
    'viewer/apply-viewpoint': {
      input: { readonly viewpoint: Viewpoint };
      output: { readonly restored: boolean };
    };
    'viewer/delete-viewpoint': {
      input: { readonly id: string };
      output: { readonly deleted: boolean };
    };
  }
}

export {};
