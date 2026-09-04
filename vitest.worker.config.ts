import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * IFC Worker 클라이언트 테스트.
 *
 * 실제 Python 워커를 자식 프로세스로 띄우므로 Python과 ifcopenshell이 있어야 한다.
 * 기본 `pnpm test`에서 갈라 둔 것은 그 때문이다. 없는 환경에서 붉게 물들이지 않는다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@bim4d/contracts': resolvePath('./packages/contracts/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/ifc-worker-client/src/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    // 첫 요청은 Python과 IfcOpenShell을 함께 올린다.
    testTimeout: 120_000,
  },
});
