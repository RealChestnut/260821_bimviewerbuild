import { expect, test } from '@playwright/test';

test.describe('애플리케이션 기동', () => {
  test('브라우저에서 Kernel이 기동하고 상태를 표시한다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');

    await expect(page.getByTestId('app-title')).toHaveText('BIM 4D Viewer');
    await expect(page.getByTestId('kernel-status')).toHaveText('kernel: started');
    expect(consoleErrors).toEqual([]);
  });
});
