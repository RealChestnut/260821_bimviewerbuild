import type { TraceId } from '@bim4d/contracts';

/**
 * 하나의 작업 흐름을 로그에서 잇기 위한 추적 ID를 만든다.
 * WebView2와 Node 양쪽에서 동작해야 하므로 `crypto.randomUUID`가 없으면 대체 경로를 쓴다.
 */
export const createTraceIdFactory = (): (() => TraceId) => {
  let counter = 0;
  return () => {
    // 타입 정의는 crypto가 항상 있다고 보지만, 보안 컨텍스트가 아니면 randomUUID가 없을 수 있다.
    const cryptoApi = globalThis.crypto as Partial<Crypto> | undefined;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    counter += 1;
    return `trace-${String(Date.now())}-${String(counter)}`;
  };
};
