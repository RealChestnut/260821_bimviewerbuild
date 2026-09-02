/**
 * 모델 적재 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 이름은 `AppEventMap`과 `AppCommandMap`의 키로만 등장한다.
 * payload에는 식별자와 요약만 싣는다. IFC 바이트나 형상 데이터는 Event로 옮기지 않는다.
 */

import type { IfcSchemaVersion, ModelFingerprint, ModelId } from '@bim4d/contracts';

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'model/load-started': { readonly modelId: ModelId; readonly displayName: string };
    'model/load-progress': {
      readonly modelId: ModelId;
      /** 0에서 1 사이. */
      readonly fraction: number;
    };
    'model/loaded': {
      readonly modelId: ModelId;
      readonly displayName: string;
      readonly schema: IfcSchemaVersion;
      /**
       * 파일 내용의 SHA-256.
       *
       * 일정이 이 모델을 알아보는 근거다. 이름이 바뀌어도 같은 파일이면 같은 값이다
       * (ADR-0008).
       */
      readonly fingerprint: ModelFingerprint;
    };
    'model/load-failed': { readonly displayName: string; readonly reason: string };
    'model/unloaded': { readonly modelId: ModelId };
  }

  interface AppCommandMap {
    'viewer/load-model': {
      input: { readonly bytes: Uint8Array; readonly displayName: string };
      output: { readonly modelId: ModelId };
    };
    'viewer/unload-model': {
      input: { readonly modelId: ModelId };
      output: { readonly removed: boolean };
    };
  }
}

export {};
