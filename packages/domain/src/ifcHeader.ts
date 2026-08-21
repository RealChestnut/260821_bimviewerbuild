import type { AppError, IfcSchemaVersion } from '@bim4d/contracts';

import type { Parsed } from './productKey.js';

export interface IfcHeader {
  readonly schema: IfcSchemaVersion;
}

/** STEP 물리 파일의 첫 토큰. 이것이 없으면 IFC-SPF가 아니다. */
const STEP_MAGIC = 'ISO-10303-21';

/**
 * HEADER 구역만 잘라 낸다.
 *
 * DATA 구역의 문자열 값에 `FILE_SCHEMA`가 들어 있을 수 있으므로, 첫 `ENDSEC;`까지만 본다.
 */
const headerSection = (text: string): string => {
  const end = text.search(/ENDSEC\s*;/iu);
  return end === -1 ? text : text.slice(0, end);
};

const fail = (
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): { ok: false; error: AppError } => ({
  ok: false,
  error:
    details === undefined
      ? { kind: 'invalid-input', code, message }
      : { kind: 'invalid-input', code, message, details },
});

/**
 * `IFC4X3_ADD2`처럼 세부 판이 붙은 이름을 내부에서 쓰는 버전으로 정규화한다.
 * 지원 목록에 없으면 undefined를 돌려준다. 임의로 가장 가까운 버전에 끼워 맞추지 않는다.
 */
const normalizeSchema = (raw: string): IfcSchemaVersion | undefined => {
  const upper = raw.toUpperCase();
  if (upper === 'IFC2X3') return 'IFC2X3';
  if (upper === 'IFC4') return 'IFC4';
  if (upper.startsWith('IFC4X3')) return 'IFC4X3';
  return undefined;
};

/**
 * IFC 파일 Header에서 Schema 버전을 읽는다.
 *
 * Schema 버전은 Header의 `FILE_SCHEMA`로만 판별한다. 파일명이나 확장자로 추정하지 않는다.
 * 파일 전체가 아니라 앞부분만 넘겨도 된다. Header는 파일 맨 앞에 있다.
 */
export const parseIfcHeader = (text: string): Parsed<IfcHeader> => {
  if (!text.trimStart().startsWith(STEP_MAGIC)) {
    return fail(
      'ifc.header.not-step-file',
      `STEP 물리 파일이 아니다. ${STEP_MAGIC}로 시작해야 한다.`,
    );
  }

  const match = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/iu.exec(headerSection(text));
  if (match === null) {
    return fail('ifc.header.file-schema-missing', 'HEADER 구역에 FILE_SCHEMA가 없다.');
  }

  const raw = match[1] ?? '';
  const schema = normalizeSchema(raw);
  if (schema === undefined) {
    return fail('ifc.header.schema-unsupported', `지원하지 않는 IFC Schema다: ${raw}`, {
      schema: raw,
    });
  }

  return { ok: true, value: { schema } };
};
