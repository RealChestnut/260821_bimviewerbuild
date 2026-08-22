/**
 * Viewpoint 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 목록에는 식별자와 이름만 싣는다. 카메라 자세는 화면이 쓸 일이 없고, 되돌리는 것은
 * Command의 몫이다.
 */

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'viewpoint/changed': {
      readonly viewpoints: readonly { readonly id: string; readonly name: string }[];
    };
    'viewpoint/restored': { readonly viewpointId: string };
  }

  interface AppCommandMap {
    'viewer/save-viewpoint': {
      /** 이름을 주지 않으면 순번으로 붙인다. */
      input: { readonly name?: string };
      output: { readonly viewpointId: string };
    };
    'viewer/restore-viewpoint': {
      input: { readonly viewpointId: string };
      output: { readonly restored: boolean };
    };
    'viewer/remove-viewpoint': {
      input: { readonly viewpointId: string };
      output: { readonly removed: boolean };
    };
  }
}

export {};
