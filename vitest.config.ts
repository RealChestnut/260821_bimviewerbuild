import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@bim4d/contracts': resolvePath('./packages/contracts/src/index.ts'),
      '@bim4d/domain': resolvePath('./packages/domain/src/index.ts'),
      '@bim4d/ifc-worker-client': resolvePath('./packages/ifc-worker-client/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/viewer-web/src/**/*.test.ts'],
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
      // Python 워커를 띄우는 테스트다. vitest.worker.config.ts가 따로 돌린다.
      'packages/ifc-worker-client/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/viewer-web/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
