import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/minimal-wall-ifc4.ifc', import.meta.url),
);

test.describe('IFC 적재와 해제', () => {
  test('fixture를 열면 목록에 Schema와 함께 올라오고 Scene에 형상이 생긴다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('model-status')).toHaveText('열린 모델 없음');
    await expect(page.getByTestId('model-row')).toHaveCount(0);

    await page.getByTestId('model-file').setInputFiles(fixture);

    await expect(page.getByTestId('model-name')).toHaveText('minimal-wall-ifc4.ifc (IFC4)', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('model-status')).toHaveText('모델 1개');
  });

  test('STEP 파일이 아니면 이유를 표시하고 목록에 올리지 않는다', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('model-file').setInputFiles({
      name: 'broken.ifc',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('<?xml version="1.0"?>', 'utf8'),
    });

    await expect(page.getByTestId('model-status')).toContainText('열기 실패');
    await expect(page.getByTestId('model-row')).toHaveCount(0);
  });

  test('해제하면 안내 문구로 돌아간다', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('model-file').setInputFiles(fixture);
    await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('model-status')).toHaveText('열린 모델 없음');
    await expect(page.getByTestId('model-row')).toHaveCount(0);
  });

  test('적재와 해제를 10회 반복해도 오류가 없다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');

    for (let round = 0; round < 10; round += 1) {
      await page.getByTestId('model-file').setInputFiles(fixture);
      await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('model-unload').click();
      await expect(page.getByTestId('model-status')).toHaveText('열린 모델 없음');
    }

    expect(consoleErrors).toEqual([]);
  });
});
