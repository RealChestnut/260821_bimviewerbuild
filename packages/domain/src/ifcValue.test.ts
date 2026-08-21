import { describe, expect, it } from 'vitest';

import { formatIfcValue } from './ifcValue.js';

describe('formatIfcValue', () => {
  it('IfcBoolean을 TRUE와 FALSE로 옮긴다', () => {
    expect(formatIfcValue(true, 'IFCBOOLEAN')).toBe('TRUE');
    expect(formatIfcValue(false, 'IFCBOOLEAN')).toBe('FALSE');
  });

  it('문자열은 그대로 둔다', () => {
    expect(formatIfcValue('Zone-A', 'IFCLABEL')).toBe('Zone-A');
  });

  it('숫자를 문자열로 옮긴다', () => {
    expect(formatIfcValue(18, 'IFCAREAMEASURE')).toBe('18');
    expect(formatIfcValue(0.75, 'IFCREAL')).toBe('0.75');
  });

  it('값이 없으면 빈 문자열이다', () => {
    expect(formatIfcValue(null, 'IFCLABEL')).toBe('');
    expect(formatIfcValue(undefined)).toBe('');
  });

  it('IfcLogical의 빈 값은 UNKNOWN이다', () => {
    expect(formatIfcValue(null, 'IfcLogical')).toBe('UNKNOWN');
  });

  it('목록형 값을 쉼표로 잇는다', () => {
    expect(formatIfcValue(['A', 'B', 'C'], 'IFCLABEL')).toBe('A, B, C');
  });

  it('목록 안의 빈 값은 건너뛴다', () => {
    expect(formatIfcValue(['A', null, 'C'], 'IFCLABEL')).toBe('A, C');
  });

  it('중첩된 값 표현의 한 겹을 벗긴다', () => {
    expect(formatIfcValue({ value: 'Girder-A' }, 'IFCLABEL')).toBe('Girder-A');
  });

  it('해석할 수 없는 값은 빈 문자열로 둔다', () => {
    expect(formatIfcValue({ unexpected: 1 }, 'IFCLABEL')).toBe('');
  });
});
