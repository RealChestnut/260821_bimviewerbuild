/**
 * 모델 fingerprint 계산.
 *
 * 원본 IFC 내용의 SHA-256을 모델 버전 식별에 쓴다. 파일명이나 수정 시각은 쓰지 않는다.
 * 같은 내용을 다른 이름으로 다시 열어도 같은 값이 나와야 파생물 캐시를 재사용할 수 있다.
 */
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
