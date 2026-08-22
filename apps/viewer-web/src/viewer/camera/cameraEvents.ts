/** 카메라 슬라이스가 받는 Command. 카메라 이동은 사실 통지가 필요 없어 Event를 두지 않는다. */

declare module '@bim4d/contracts' {
  interface AppCommandMap {
    'viewer/fit-camera': {
      input: Record<string, never>;
      output: { readonly fitted: boolean };
    };
  }
}

export {};
