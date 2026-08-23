import { fileURLToPath } from 'node:url';

/**
 * 테스트용 IFC fixture 경로.
 *
 * 새 fixture를 추가하기 전에 IFC 기준서 20절 수령 체크리스트를 수행하고 결과를 기록한다.
 */
export interface IfcFixture {
  readonly id: string;
  readonly schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  /** fixture가 담고 있는 것에 대한 짧은 설명. */
  readonly description: string;
  readonly path: string;
}

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../ifc/${name}`, import.meta.url));

export const minimalWallIfc4: IfcFixture = {
  id: 'minimal-wall-ifc4',
  schema: 'IFC4',
  description:
    'Project–Site–Building–Storey 공간 계층 1개씩과 IfcWall 1개. 압출 형상과 Pset_WallCommon 포함.',
  path: fixturePath('minimal-wall-ifc4.ifc'),
};

export const threeElementsIfc4: IfcFixture = {
  id: 'three-elements-ifc4',
  schema: 'IFC4',
  description:
    'IfcWall 2개와 IfcSlab 1개가 같은 층에 있다. 다중 선택, 분류, 속성 패널 테스트용이며 표준 Pset, 자체 접두어 Pset, Qto를 함께 담는다.',
  path: fixturePath('three-elements-ifc4.ifc'),
};

export const ifcFixtures: readonly IfcFixture[] = [minimalWallIfc4, threeElementsIfc4];

/** 테스트용 일정 fixture 경로. 필드 스키마는 `docs/adr/0006-schedule-schema.md`가 정본이다. */
export interface ScheduleFixture {
  readonly id: string;
  /** 이 일정이 가리키는 IFC fixture. `modelRef`가 이 파일명과 맞아야 바인딩된다. */
  readonly modelRef: string;
  readonly description: string;
  readonly path: string;
}

const schedulePath = (name: string): string =>
  fileURLToPath(new URL(`../schedule/${name}`, import.meta.url));

export const mockThreeElementsSchedule: ScheduleFixture = {
  id: 'mock-three-elements',
  modelRef: 'three-elements-ifc4.ifc',
  description:
    'schemaVersion 2. 요약 Task 2개 아래 작업 5개와 시간 미정 Task 1개. FINISH_START 선후행 4개를 담는다.',
  path: schedulePath('mock-three-elements.json'),
};

/** v1 → v2 승격 경로를 고정하기 위해 남겨 둔 옛 형식 파일. */
export const legacyV1ThreeElementsSchedule: ScheduleFixture = {
  id: 'legacy-v1-three-elements',
  modelRef: 'three-elements-ifc4.ifc',
  description: 'schemaVersion 1. 계층도 선후행도 없는 옛 형식이며 읽으면 v2로 승격된다.',
  path: schedulePath('legacy-v1-three-elements.json'),
};

export const scheduleFixtures: readonly ScheduleFixture[] = [
  mockThreeElementsSchedule,
  legacyV1ThreeElementsSchedule,
];
