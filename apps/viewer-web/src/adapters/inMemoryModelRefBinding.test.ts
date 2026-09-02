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

  it('묶은 뒤에는 양방향으로 찾는다', () => {
    const binding = createInMemoryModelRefBinding();

    binding.bind(A, 'a.ifc');

    expect(binding.idOf('a.ifc')).toBe(A);
    expect(binding.refOf(A)).toBe('a.ifc');
  });

  it('푼 모델은 양쪽에서 사라진다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.bind(A, 'a.ifc');

    binding.unbind(A);

    expect(binding.idOf('a.ifc')).toBeNull();
    expect(binding.refOf(A)).toBeNull();
  });

  it('같은 이름을 다시 묶으면 나중 모델이 이긴다', () => {
    // 같은 파일을 다시 열면 새 ModelId가 붙는다. 일정은 방금 연 모델을 가리켜야 한다.
    const binding = createInMemoryModelRefBinding();
    binding.bind(A, 'a.ifc');

    binding.bind(B, 'a.ifc');

    expect(binding.idOf('a.ifc')).toBe(B);
    // 밀려난 모델은 이름을 잃는다. 두 모델이 한 이름을 함께 쓰면 일정이 어느 쪽인지 모른다.
    expect(binding.refOf(A)).toBeNull();
    expect(binding.entries().size).toBe(1);
  });

  it('다른 이름의 모델은 서로 건드리지 않는다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.bind(A, 'a.ifc');
    binding.bind(B, 'b.ifc');

    binding.unbind(A);

    expect(binding.idOf('b.ifc')).toBe(B);
    expect(binding.entries().size).toBe(1);
  });

  it('묶은 짝을 한 번에 준다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.bind(A, 'a.ifc');
    binding.bind(B, 'b.ifc');

    expect([...binding.entries()]).toEqual([
      ['a.ifc', A],
      ['b.ifc', B],
    ]);
  });

  it('비우면 아무것도 남지 않는다', () => {
    const binding = createInMemoryModelRefBinding();
    binding.bind(A, 'a.ifc');

    binding.clear();

    expect(binding.entries().size).toBe(0);
  });
});
