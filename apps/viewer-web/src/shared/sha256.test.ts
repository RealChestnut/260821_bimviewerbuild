import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256.js';

describe('sha256Hex', () => {
  it('빈 입력의 SHA-256을 계산한다', async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"abc"의 SHA-256을 계산한다', async () => {
    await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('같은 입력은 같은 값을 준다', async () => {
    const bytes = new TextEncoder().encode('bim4d');
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(bytes));
  });
});
