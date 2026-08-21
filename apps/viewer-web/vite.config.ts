import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * 런타임에 필요한 vendor 자산을 `public/vendor/`로 복사한다.
 *
 * That Open의 기본 동작은 web-ifc WASM과 fragments worker를 unpkg에서 내려받는 것이다.
 * 이 제품은 오프라인 Windows 데스크톱 앱이므로 두 자산을 앱과 함께 배포해야 한다.
 * 복사본은 빌드 산출물이며 저장소에 커밋하지 않는다 (ADR-0004).
 */
const vendorAssets = (): Plugin => ({
  name: 'bim4d:vendor-assets',
  buildStart() {
    const targets = [
      {
        from: require.resolve('web-ifc/web-ifc.wasm'),
        to: join(projectRoot, 'public/vendor/web-ifc/web-ifc.wasm'),
      },
      {
        from: join(dirname(require.resolve('@thatopen/fragments')), 'Worker/worker.mjs'),
        to: join(projectRoot, 'public/vendor/fragments/worker.mjs'),
      },
    ];

    for (const target of targets) {
      mkdirSync(dirname(target.to), { recursive: true });
      copyFileSync(target.from, target.to);
    }
  },
});

export default defineConfig({
  plugins: [vendorAssets()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
