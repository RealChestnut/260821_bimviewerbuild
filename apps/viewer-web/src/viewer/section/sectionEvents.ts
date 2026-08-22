/**
 * 단면 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 평면 목록 전체는 Event에 싣지 않는다. 화면이 필요로 하는 것은 개수와 켜짐 여부다.
 */

import type { SectionAxis, SectionPlaneState } from './sectionPort.js';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'section/changed': {
      readonly count: number;
      /** 평면이 있어도 꺼 두면 자르지 않는다. */
      readonly enabled: boolean;
    };
  }

  interface AppCommandMap {
    'viewer/create-section': {
      input: { readonly axis: SectionAxis };
      output: { readonly planeId: string | null };
    };
    'viewer/remove-section': {
      input: { readonly planeId: string };
      output: { readonly removed: boolean };
    };
    'viewer/clear-sections': {
      input: Record<string, never>;
      output: { readonly removed: number };
    };
    /** Viewpoint 복원용. 있던 평면을 지우고 주어진 상태로 다시 만든다. */
    'viewer/restore-sections': {
      input: { readonly planes: readonly SectionPlaneState[] };
      output: { readonly count: number };
    };
    'viewer/set-sections-enabled': {
      input: { readonly enabled: boolean };
      output: { readonly enabled: boolean };
    };
  }
}

export {};
