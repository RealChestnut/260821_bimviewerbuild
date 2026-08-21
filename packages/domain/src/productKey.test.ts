import { describe, expect, it } from 'vitest';

import { formatProductKey, parseGlobalId, parseModelId, parseProductKey } from './productKey.js';

const validGlobalId = '3vB2_1Ks9E1QF$aVJ0Zt_h';

describe('parseGlobalId', () => {
  it('IFC GlobalId 문자 집합과 길이 22를 만족하면 통과한다', () => {
    expect(parseGlobalId(validGlobalId)).toEqual({ ok: true, value: validGlobalId });
  });

  it('길이가 22가 아니면 거부한다', () => {
    expect(parseGlobalId('3vB2_1Ks9E1QF$aVJ0Zt_')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', code: 'identity.global-id.invalid-length' },
    });
  });

  it('IFC base64 문자 집합 밖의 문자를 거부한다', () => {
    expect(parseGlobalId('3vB2-1Ks9E1QF$aVJ0Zt_h')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', code: 'identity.global-id.invalid-charset' },
    });
  });
});

describe('parseModelId', () => {
  it('빈 문자열을 거부한다', () => {
    expect(parseModelId('  ')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', code: 'identity.model-id.empty' },
    });
  });

  it('앞뒤 공백을 제거한 값을 돌려준다', () => {
    expect(parseModelId(' model-a ')).toEqual({ ok: true, value: 'model-a' });
  });
});

describe('parseProductKey', () => {
  it('modelId와 globalId가 모두 유효하면 키를 만든다', () => {
    expect(parseProductKey('model-a', validGlobalId)).toEqual({
      ok: true,
      value: { modelId: 'model-a', globalId: validGlobalId },
    });
  });

  it('globalId가 유효하지 않으면 실패를 그대로 전달한다', () => {
    expect(parseProductKey('model-a', 'nope')).toMatchObject({
      ok: false,
      error: { code: 'identity.global-id.invalid-length' },
    });
  });

  it('실패한 결과에는 사람이 읽을 message가 들어 있다', () => {
    const result = parseProductKey('model-a', 'nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});

describe('formatProductKey', () => {
  it('modelId와 globalId를 구분자로 이어 붙인다', () => {
    const key = parseProductKey('model-a', validGlobalId);
    expect(key.ok).toBe(true);
    if (!key.ok) return;
    expect(formatProductKey(key.value)).toBe(`model-a::${validGlobalId}`);
  });

  it('서로 다른 모델의 같은 GlobalId는 다른 키가 된다', () => {
    const a = parseProductKey('model-a', validGlobalId);
    const b = parseProductKey('model-b', validGlobalId);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(formatProductKey(a.value)).not.toBe(formatProductKey(b.value));
  });
});
