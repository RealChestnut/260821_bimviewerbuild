import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ifcFixtures, minimalWallIfc4, threeElementsIfc4 } from './index.js';

const readFixture = (path: string): string => readFileSync(path, 'utf8');

/** IFC GlobalId: 22자, IFC base64 문자 집합, 첫 글자는 0-3. */
const GLOBAL_ID_PATTERN = /^[0-3][0-9A-Za-z_$]{21}$/;

/**
 * IfcRoot 파생 Entity만 GlobalId를 가진다. 이들은 첫 인자가 GlobalId, 둘째가 OwnerHistory 참조다.
 * 첫 인자가 문자열이라도 둘째가 참조가 아닌 Entity(예: IfcGeometricRepresentationSubContext)는 제외된다.
 */
const globalIdsOf = (content: string): string[] =>
  [...content.matchAll(/^#\d+=IFC[A-Z0-9]+\('([^']*)',#\d+,/gmu)].map((match) => match[1] ?? '');

describe('IFC fixtures', () => {
  it('등록된 fixture 파일을 모두 읽을 수 있다', () => {
    for (const fixture of ifcFixtures) {
      expect(readFixture(fixture.path).length).toBeGreaterThan(0);
    }
  });

  it('Schema 버전은 파일명이 아니라 Header의 FILE_SCHEMA에서 확인한다', () => {
    for (const fixture of ifcFixtures) {
      expect(readFixture(fixture.path)).toContain(`FILE_SCHEMA(('${fixture.schema}'))`);
    }
  });

  it('모든 GlobalId가 IFC GlobalId 형식을 만족한다', () => {
    for (const fixture of ifcFixtures) {
      const ids = globalIdsOf(readFixture(fixture.path));
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id).toMatch(GLOBAL_ID_PATTERN);
      }
    }
  });

  it('GlobalId가 파일 안에서 중복되지 않는다', () => {
    for (const fixture of ifcFixtures) {
      const ids = globalIdsOf(readFixture(fixture.path));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('minimal-wall-ifc4는 공간 계층과 IfcWall 1개를 담는다', () => {
    const content = readFixture(minimalWallIfc4.path);
    expect(content).toMatch(/=IFCPROJECT\(/u);
    expect(content).toMatch(/=IFCSITE\(/u);
    expect(content).toMatch(/=IFCBUILDING\(/u);
    expect(content).toMatch(/=IFCBUILDINGSTOREY\(/u);
    expect([...content.matchAll(/=IFCWALL\(/gu)]).toHaveLength(1);
    expect(content).toMatch(/=IFCRELCONTAINEDINSPATIALSTRUCTURE\(/u);
  });

  it('three-elements-ifc4는 서로 다른 Entity 3개를 담는다', () => {
    const content = readFixture(threeElementsIfc4.path);
    expect([...content.matchAll(/=IFCWALL\(/gu)]).toHaveLength(2);
    expect([...content.matchAll(/=IFCSLAB\(/gu)]).toHaveLength(1);
  });

  it('three-elements-ifc4는 표준 Pset과 자체 접두어 Pset, Qto를 함께 담는다', () => {
    const content = readFixture(threeElementsIfc4.path);
    expect(content).toContain("'Pset_WallCommon'");
    // 내부에서 만드는 Pset은 예약 접두어 Pset_을 쓰지 않는다 (AGENTS.md 2.4).
    expect(content).toContain("'BIM4D_Custom'");
    expect(content).toContain("'Qto_WallBaseQuantities'");
  });

  it('원본 Pset을 보존하는지 확인할 수 있게 Pset을 담는다', () => {
    const content = readFixture(minimalWallIfc4.path);
    expect(content).toContain("'Pset_WallCommon'");
    expect(content).toMatch(/=IFCRELDEFINESBYPROPERTIES\(/u);
  });
});
