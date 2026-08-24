import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSchedule, validateSchedule } from '@bim4d/domain';

import {
  ifcFixtures,
  legacyV1ThreeElementsSchedule,
  minimalWallIfc4,
  mockThreeElementsSchedule,
  scheduleFixtures,
  threeElementsIfc4,
} from './index.js';

const readFixture = (path: string): string => readFileSync(path, 'utf8');

/** IFC GlobalId: 22자, IFC base64 문자 집합, 첫 글자는 0-3. */
const GLOBAL_ID_PATTERN = /^[0-3][0-9A-Za-z_$]{21}$/;

/**
 * IfcRoot 파생 Entity만 GlobalId를 가진다. 이들은 첫 인자가 GlobalId, 둘째가 OwnerHistory 참조다.
 * 첫 인자가 문자열이라도 둘째가 참조가 아닌 Entity(예: IfcGeometricRepresentationSubContext)는 제외된다.
 */
const globalIdsOf = (content: string): string[] =>
  [...content.matchAll(/^#\d+=IFC[A-Z0-9]+\('([^']*)',#\d+,/gmu)].map((match) => match[1] ?? '');

const fixtureDirectory = fileURLToPath(new URL('../ifc/', import.meta.url));

describe('fixture 디렉터리', () => {
  const trackedFiles = readdirSync(fixtureDirectory).filter((name) => name.endsWith('.ifc'));

  it('디렉터리에 있는 모든 IFC가 fixture 목록에 등록돼 있다', () => {
    const registered = new Set(ifcFixtures.map((fixture) => basename(fixture.path)));
    expect([...trackedFiles].sort()).toEqual([...registered].sort());
  });

  it('저장소에 두는 fixture는 1MB를 넘지 않는다', () => {
    // 실모델은 local/에 두고 커밋하지 않는다. 큰 파일이 여기 들어오면 CI가 막는다.
    for (const name of trackedFiles) {
      expect(statSync(join(fixtureDirectory, name)).size).toBeLessThan(1_000_000);
    }
  });
});

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

const scheduleDirectory = fileURLToPath(new URL('../schedule/', import.meta.url));

describe('일정 fixtures', () => {
  it('디렉터리에 있는 모든 일정 JSON이 fixture 목록에 등록돼 있다', () => {
    const tracked = readdirSync(scheduleDirectory).filter((name) => name.endsWith('.json'));
    const registered = new Set(scheduleFixtures.map((fixture) => basename(fixture.path)));

    expect([...tracked].sort()).toEqual([...registered].sort());
  });

  it('등록된 일정이 모두 스키마 검증을 통과한다', () => {
    for (const fixture of scheduleFixtures) {
      const parsed = parseSchedule(JSON.parse(readFixture(fixture.path)));
      if (!parsed.ok) throw new Error(`${fixture.id}: ${parsed.error.message}`);

      expect(parsed.value.assignments.length).toBeGreaterThan(0);
    }
  });

  it('일정이 가리키는 GlobalId가 대상 IFC에 실제로 있다', () => {
    // 연결 키는 modelId + GlobalId다. 일정 쪽 GlobalId가 모델에 없으면 조용히 아무것도
    // 움직이지 않으므로, fixture 단계에서 막는다.
    for (const fixture of scheduleFixtures) {
      const model = ifcFixtures.find((ifc) => basename(ifc.path) === fixture.modelRef);
      if (model === undefined) throw new Error(`${fixture.id}의 modelRef가 IFC fixture에 없다.`);

      const available = new Set(globalIdsOf(readFixture(model.path)));
      const parsed = parseSchedule(JSON.parse(readFixture(fixture.path)));
      if (!parsed.ok) throw new Error(parsed.error.message);

      for (const assignment of parsed.value.assignments) {
        expect(available).toContain(assignment.productGlobalId);
        expect(assignment.modelRef).toBe(fixture.modelRef);
      }
    }
  });
});

describe('일정 fixtures — 스키마 v2', () => {
  it('읽고 나면 버전이 무엇이든 v2다', () => {
    // 소비자가 버전을 분기하지 않게 하려는 것이다 (ADR-0006).
    for (const fixture of scheduleFixtures) {
      const parsed = parseSchedule(JSON.parse(readFixture(fixture.path)));
      if (!parsed.ok) throw new Error(`${fixture.id}: ${parsed.error.message}`);

      expect(parsed.value.schemaVersion).toBe(2);
    }
  });

  it('v1 파일은 계층 없음·선후행 없음으로 승격된다', () => {
    const parsed = parseSchedule(JSON.parse(readFixture(legacyV1ThreeElementsSchedule.path)));
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.dependencies).toEqual([]);
    expect(parsed.value.tasks.every((task) => task.parentTaskId === undefined)).toBe(true);
  });

  it('v2 fixture는 요약 Task와 선후행을 담는다', () => {
    const parsed = parseSchedule(JSON.parse(readFixture(mockThreeElementsSchedule.path)));
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.tasks.filter((task) => task.parentTaskId !== undefined)).not.toHaveLength(
      0,
    );
    expect(parsed.value.dependencies).not.toHaveLength(0);
  });

  it('v2 fixture의 유일한 경고는 시간 미정 Task뿐이다', () => {
    // 선후행 위반이나 미연결 Task가 섞여 있으면 fixture로 쓸 수 없다.
    const parsed = parseSchedule(JSON.parse(readFixture(mockThreeElementsSchedule.path)));
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(validateSchedule(parsed.value).map((warning) => warning.code)).toEqual([
      'schedule.warn.task-without-time',
    ]);
  });
});
