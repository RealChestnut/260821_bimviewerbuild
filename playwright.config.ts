import { defineConfig, devices } from '@playwright/test';

const isCI = process.env['CI'] !== undefined;
const PORT = 4173;
const baseURL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // CI에서는 1 worker로 고정한다. 로컬에서는 Playwright 기본값을 그대로 둔다.
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 워크스페이스 패키지(contracts, domain)는 dist를 통해 참조되므로 앱보다 먼저 빌드해야 한다.
    command: 'pnpm build && pnpm --filter @bim4d/viewer-web preview',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
