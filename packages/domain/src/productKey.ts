import type { AppError, GlobalId, ModelId, ProductKey } from '@bim4d/contracts';

/** 도메인 검증 결과. 실패를 예외가 아니라 값으로 돌려준다. */
export type Parsed<TValue> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: AppError };

/** IfcGloballyUniqueId는 22자다. */
const GLOBAL_ID_LENGTH = 22;

/**
 * IFC base64 문자 집합. 표준 base64와 달리 `+` `/` 대신 `_` `$`를 쓴다.
 * 기준서 5절, IFC 스펙의 IfcGloballyUniqueId 정의를 따른다.
 */
const GLOBAL_ID_CHARSET = /^[0-9A-Za-z_$]+$/;

const fail = (code: string, message: string): { ok: false; error: AppError } => ({
  ok: false,
  error: { kind: 'invalid-input', code, message },
});

/**
 * IFC `IfcRoot.GlobalId` 문자열을 검증한다.
 *
 * 형식만 본다. 파일 안에서 실제로 유일한지는 모델 적재 단계에서 확인한다.
 */
export const parseGlobalId = (raw: string): Parsed<GlobalId> => {
  if (raw.length !== GLOBAL_ID_LENGTH) {
    return fail(
      'identity.global-id.invalid-length',
      `GlobalId는 ${String(GLOBAL_ID_LENGTH)}자여야 한다. 받은 길이: ${String(raw.length)}`,
    );
  }
  if (!GLOBAL_ID_CHARSET.test(raw)) {
    return fail(
      'identity.global-id.invalid-charset',
      'GlobalId는 IFC base64 문자(0-9, A-Z, a-z, _, $)만 쓸 수 있다.',
    );
  }
  return { ok: true, value: raw as GlobalId };
};

/** 프로젝트 안에서 모델을 가리키는 식별자를 검증한다. */
export const parseModelId = (raw: string): Parsed<ModelId> => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail('identity.model-id.empty', 'modelId는 비어 있을 수 없다.');
  }
  return { ok: true, value: trimmed as ModelId };
};

/**
 * 모듈 사이에서 IFC 객체 하나를 가리키는 영구 키를 만든다.
 *
 * STEP ID(`#123`)는 파일을 다시 저장하면 바뀌므로 키에 넣지 않는다.
 */
export const parseProductKey = (rawModelId: string, rawGlobalId: string): Parsed<ProductKey> => {
  const modelId = parseModelId(rawModelId);
  if (!modelId.ok) return modelId;

  const globalId = parseGlobalId(rawGlobalId);
  if (!globalId.ok) return globalId;

  return { ok: true, value: { modelId: modelId.value, globalId: globalId.value } };
};

/** Map 키나 로그에 쓰는 문자열 형태. `::`는 두 식별자 어디에도 나올 수 없는 구분자다. */
export const formatProductKey = (key: ProductKey): string => `${key.modelId}::${key.globalId}`;
