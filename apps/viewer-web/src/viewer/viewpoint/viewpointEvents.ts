/**
 * Viewpoint 슬라이스가 발행하는 Event와 받는 Command.
 *
 * Viewpoint는 "그때 화면"이다. 카메라만 저장하면 같은 화면이 나오지 않는다.
 * 무엇이 감춰져 있었는지, 어디를 잘라 두었는지가 함께 있어야 한다.
 *
 * Event에는 목록의 이름표만 싣는다. 저장된 내용 전체는 Command 응답으로만 나간다.
 */

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
    'viewer/delete-viewpoint': {
      input: { readonly id: string };
      output: { readonly deleted: boolean };
    };
  }
}

export {};
