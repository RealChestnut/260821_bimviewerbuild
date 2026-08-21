import { expect, test } from '@playwright/test';

test.describe('Viewer World 생명주기', () => {
  test('기동하면 컨테이너 안에 WebGL 캔버스가 생긴다', async ({ page }) => {
    await page.goto('/');

    const canvas = page.locator('[data-testid="viewer-container"] canvas');
    await expect(canvas).toHaveCount(1);

    const size = await canvas.boundingBox();
    expect(size?.width ?? 0).toBeGreaterThan(0);
    expect(size?.height ?? 0).toBeGreaterThan(0);
  });

  test('shutdown하면 캔버스와 WebGL context를 반납한다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="viewer-container"] canvas')).toHaveCount(1);

    // 해제 전에 context를 잡아 두고, 해제 후 잃었는지 같은 참조로 확인한다.
    const contextLost = await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="viewer-container"] canvas',
      );
      if (canvas === null) throw new Error('canvas missing');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (context === null) throw new Error('WebGL context missing');

      await window.bim4d?.shutdown();
      return context.isContextLost();
    });

    expect(contextLost).toBe(true);
    await expect(page.locator('[data-testid="viewer-container"] canvas')).toHaveCount(0);
    await expect(page.getByTestId('kernel-status')).toHaveText('kernel: stopped');
  });
});
