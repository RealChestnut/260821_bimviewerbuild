import { describe, expect, it } from 'vitest';

import type { ModelFingerprint, ModelId, Schedule } from '@bim4d/contracts';

import { resolveModelBindings, scheduleModelRefs } from './modelBinding.js';
import type { OpenModel } from './modelBinding.js';
import { parseSchedule } from './schedule.js';

const WALL = '0BnKdW4tq7SfUcM3vHxZgR';

const FP_A: ModelFingerprint = 'a'.repeat(64);
const FP_B: ModelFingerprint = 'b'.repeat(64);

const MODEL_1 = 'm1' as ModelId;
const MODEL_2 = 'm2' as ModelId;

const build = (source: Record<string, unknown>): Schedule => {
  const parsed = parseSchedule({
    scheduleId: 's1',
    name: '시험',
    schemaVersion: 3,
    models: [],
    tasks: [{ taskId: 'T001', name: '벽', start: '2026-03-02', finish: '2026-03-06' }],
    dependencies: [],
    assignments: [
      { taskId: 'T001', modelRef: 'a.ifc', productGlobalId: WALL, operation: 'CONSTRUCT' },
    ],
    ...source,
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

const opened = (
  modelId: ModelId,
  displayName: string,
  fingerprint: ModelFingerprint,
): OpenModel => ({ modelId, displayName, fingerprint });

describe('scheduleModelRefs', () => {
  it('표에 적힌 이름과 부재가 가리키는 이름을 모두 센다', () => {
    const schedule = build({ models: [{ modelRef: '설비.ifc' }] });

    expect(scheduleModelRefs(schedule)).toEqual(['설비.ifc', 'a.ifc']);
  });

  it('같은 이름을 두 번 세지 않는다', () => {
    const schedule = build({ models: [{ modelRef: 'a.ifc' }] });

    expect(scheduleModelRefs(schedule)).toEqual(['a.ifc']);
  });
});

describe('resolveModelBindings', () => {
  it('fingerprint가 같으면 이름이 달라도 묶는다', () => {
    const schedule = build({ models: [{ modelRef: 'a.ifc', fingerprint: FP_A }] });

    const result = resolveModelBindings(schedule, [opened(MODEL_1, '이름이_바뀐.ifc', FP_A)]);

    // 파일 이름을 바꿔도 연결이 유지된다. 이것이 ADR-0008의 목적이다.
    expect(result.bindings.get('a.ifc')).toBe(MODEL_1);
    expect(result.replaced).toEqual([]);
  });

  it('fingerprint를 모르면 이름으로 묶는다', () => {
    const schedule = build({ models: [] });

    const result = resolveModelBindings(schedule, [opened(MODEL_1, 'a.ifc', FP_A)]);

    expect(result.bindings.get('a.ifc')).toBe(MODEL_1);
    expect(result.replaced).toEqual([]);
  });

  it('이름으로 묶였는데 내용이 다르면 교체로 알린다', () => {
    const schedule = build({ models: [{ modelRef: 'a.ifc', fingerprint: FP_A }] });

    const result = resolveModelBindings(schedule, [opened(MODEL_1, 'a.ifc', FP_B)]);

    // 묶기는 한다. 연결을 지키는 것이 목적이고, 바뀐 사실은 따로 알린다.
    expect(result.bindings.get('a.ifc')).toBe(MODEL_1);
    expect(result.replaced).toEqual([
      { modelRef: 'a.ifc', modelId: MODEL_1, expected: FP_A, actual: FP_B },
    ]);
  });

  it('fingerprint 일치가 이름 일치보다 앞선다', () => {
    const schedule = build({ models: [{ modelRef: 'a.ifc', fingerprint: FP_A }] });

    const result = resolveModelBindings(schedule, [
      opened(MODEL_1, 'a.ifc', FP_B),
      opened(MODEL_2, '다른이름.ifc', FP_A),
    ]);

    expect(result.bindings.get('a.ifc')).toBe(MODEL_2);
    // 이름만 같은 모델은 붙지 않았으므로 교체가 아니다.
    expect(result.replaced).toEqual([]);
  });

  it('한 모델은 이름 하나에만 묶인다', () => {
    const schedule = build({
      models: [{ modelRef: 'a.ifc', fingerprint: FP_A }, { modelRef: 'b.ifc' }],
    });

    const result = resolveModelBindings(schedule, [opened(MODEL_1, 'b.ifc', FP_A)]);

    // fingerprint로 a.ifc가 먼저 가져간다. b.ifc는 남은 모델이 없어 묶이지 않는다.
    expect(result.bindings.get('a.ifc')).toBe(MODEL_1);
    expect(result.bindings.has('b.ifc')).toBe(false);
  });

  it('열려 있지 않은 이름은 묶지 않는다', () => {
    const schedule = build({ models: [{ modelRef: 'a.ifc', fingerprint: FP_A }] });

    const result = resolveModelBindings(schedule, []);

    // 조용히 아무 모델에나 붙이지 않는다.
    expect(result.bindings.size).toBe(0);
  });

  it('표에 없이 부재만 가리키는 이름도 묶는다', () => {
    const schedule = build({ models: [] });

    const result = resolveModelBindings(schedule, [
      opened(MODEL_1, 'a.ifc', FP_A),
      opened(MODEL_2, 'b.ifc', FP_B),
    ]);

    expect(result.bindings.get('a.ifc')).toBe(MODEL_1);
    expect(result.bindings.has('b.ifc')).toBe(false);
  });
});
