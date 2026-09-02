import { describe, expect, it } from 'vitest';

import type { ModelId } from '@bim4d/contracts';

import { createInMemoryModelRefBinding } from './inMemoryModelRefBinding.js';

const A = 'model-a' as ModelId;
const B = 'model-b' as ModelId;

describe('createInMemoryModelRefBinding', () => {
  it('묶기 전에는 양쪽 다 없다', () => {
    const binding = createInMemoryModelRefBinding();

    expect(binding.idOf('a.ifc')).toBeNull();
    expect(binding.refOf(A)).toBeNull();
    expect(binding.entries().size).toBe(0);
  });

  it('넣은 묶음을 양방향으로 찾는다', () => {
    const binding = createInMemoryModelRefBinding();

    binding.replaceAll(new Map([['a.ifc', A]]));

    expect(binding.idOf('a.ifc')).toBe(A);
    expect(binding.refOf(A)).toBe('a.ifc');
  });

  it('갈아 끼우면 앞의 묶음은 남지 않는다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.replaceAll(new Map([['a.ifc', A]]));

    binding.replaceAll(new Map([['b.ifc', B]]));

    // 부분 갱신을 두지 않는다. 묶는 규칙이 전체를 보고 정해지기 때문이다.
    expect(binding.idOf('a.ifc')).toBeNull();
    expect(binding.refOf(A)).toBeNull();
    expect(binding.idOf('b.ifc')).toBe(B);
  });

  it('넣은 짝을 그대로 돌려준다', () => {
    const binding = createInMemoryModelRefBinding();

    binding.replaceAll(
      new Map([
        ['a.ifc', A],
        ['b.ifc', B],
      ]),
    );

    expect([...binding.entries()]).toEqual([
      ['a.ifc', A],
      ['b.ifc', B],
    ]);
  });

  it('돌려준 짝을 고쳐도 안쪽은 바뀌지 않는다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.replaceAll(new Map([['a.ifc', A]]));

    // 복사본을 준다. 부르는 쪽이 고쳐도 묶음이 흔들리지 않는다.
    (binding.entries() as Map<string, ModelId>).set('b.ifc', B);

    expect(binding.idOf('b.ifc')).toBeNull();
  });

  it('비우면 아무것도 남지 않는다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.replaceAll(new Map([['a.ifc', A]]));

    binding.clear();

    expect(binding.entries().size).toBe(0);
  });
});
