import { describe, expect, it } from 'vitest';

import { parseIfcHeader } from './ifcHeader.js';

const header = (schema: string): string =>
  [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION((''),'2;1');",
    "FILE_NAME('m.ifc','2026-08-21T00:00:00',(''),(''),'app','app','');",
    `FILE_SCHEMA(('${schema}'));`,
    'ENDSEC;',
    'DATA;',
  ].join('\n');

describe('parseIfcHeader', () => {
  it('FILE_SCHEMA에서 Schema 버전을 읽는다', () => {
    expect(parseIfcHeader(header('IFC4'))).toEqual({ ok: true, value: { schema: 'IFC4' } });
  });

  it('IFC2X3를 읽는다', () => {
    expect(parseIfcHeader(header('IFC2X3'))).toEqual({ ok: true, value: { schema: 'IFC2X3' } });
  });

  it('IFC4X3_ADD2 같은 세부 버전을 IFC4X3로 정규화한다', () => {
    expect(parseIfcHeader(header('IFC4X3_ADD2'))).toEqual({
      ok: true,
      value: { schema: 'IFC4X3' },
    });
  });

  it('공백과 소문자 표기를 허용한다', () => {
    const text = header('ifc4').replace('FILE_SCHEMA', 'file_schema  ');
    expect(parseIfcHeader(text)).toEqual({ ok: true, value: { schema: 'IFC4' } });
  });

  it('여러 줄에 걸친 FILE_SCHEMA도 읽는다', () => {
    const text = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(\n  ('IFC4')\n);\nENDSEC;";
    expect(parseIfcHeader(text)).toEqual({ ok: true, value: { schema: 'IFC4' } });
  });

  it('FILE_SCHEMA가 없으면 실패를 돌려준다', () => {
    expect(parseIfcHeader('ISO-10303-21;\nHEADER;\nENDSEC;')).toMatchObject({
      ok: false,
      error: { code: 'ifc.header.file-schema-missing' },
    });
  });

  it('지원하지 않는 Schema는 값을 그대로 담아 실패를 돌려준다', () => {
    const result = parseIfcHeader(header('IFC5'));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ifc.header.schema-unsupported' },
    });
    if (result.ok) return;
    expect(result.error.details).toEqual({ schema: 'IFC5' });
  });

  it('ISO-10303-21로 시작하지 않으면 STEP 파일이 아니라고 본다', () => {
    expect(parseIfcHeader('<?xml version="1.0"?>')).toMatchObject({
      ok: false,
      error: { code: 'ifc.header.not-step-file' },
    });
  });

  it('HEADER 구역 밖의 FILE_SCHEMA 문자열에 속지 않는다', () => {
    const text = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=IFCWALL('FILE_SCHEMA((''IFC4''))');";
    expect(parseIfcHeader(text)).toMatchObject({
      ok: false,
      error: { code: 'ifc.header.file-schema-missing' },
    });
  });
});
