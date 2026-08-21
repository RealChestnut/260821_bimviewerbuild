/**
 * 모듈 사이에서 사용하는 영구 식별자 계약.
 *
 * 영구 연결 키는 `modelId + IfcRoot.GlobalId` 조합이다.
 * STEP ID(`#123`)는 파일을 다시 저장하면 바뀌므로 영구 키로 쓰지 않는다.
 */

declare const modelIdBrand: unique symbol;
declare const globalIdBrand: unique symbol;

/** 프로젝트 안에서 하나의 모델 파일을 가리키는 식별자. */
export type ModelId = string & { readonly [modelIdBrand]: 'ModelId' };

/** IFC `IfcRoot.GlobalId` (IfcGloballyUniqueId, 22자 base64 문자열). */
export type GlobalId = string & { readonly [globalIdBrand]: 'GlobalId' };

/** 모듈 사이에서 하나의 IFC 객체를 가리키는 영구 키. */
export interface ProductKey {
  readonly modelId: ModelId;
  readonly globalId: GlobalId;
}

/** 모델 파일 내용의 SHA-256 fingerprint. 모델 버전 식별에 사용한다. */
export type ModelFingerprint = string;
