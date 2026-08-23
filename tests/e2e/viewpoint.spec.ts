import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickViewerAt, findPickPoint } from './support/picking.js';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

/** three-elements-ifc4의 벽 A. */
const WALL_A = '0BnKdW4tq7SfUcM3vHxZgR';

const openFixture = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(fixture);
  await expect(page.getByTestId('model-status')).toHaveText('모델 1개', { timeout: 60_000 });
};

test.describe('Viewpoint 저장과 복원', () => {
  test('모델이 없으면 저장 버튼을 잠가 둔다', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('viewpoint-save')).toBeDisabled();
    await expect(page.getByTestId('viewpoint-restore')).toBeDisabled();
  });

  test('저장하면 목록에 순번 이름으로 담긴다', async ({ page }) => {
    await openFixture(page);
    await expect(page.getByTestId('viewpoint-save')).toBeEnabled();

    await page.getByTestId('viewpoint-save').click();
    await expect(page.getByTestId('viewpoint-list').locator('option')).toHaveCount(1);

    await page.getByTestId('viewpoint-save').click();

    await expect(page.getByTestId('viewpoint-list').locator('option')).toHaveText([
      '시점 1',
      '시점 2',
    ]);
    await expect(page.getByTestId('viewpoint-restore')).toBeEnabled();
  });

  test('복원하면 저장할 때 보던 자리로 돌아온다', async ({ page }) => {
    // Phase 3 완료 기준. 카메라가 실제로 저장 시점으로 되돌아왔는지를 화면에서 확인한다.
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await openFixture(page);

    // 벽 A가 집히는 지점을 확정하고, 그 시점을 저장한다.
    const [ratioX, ratioY] = await findPickPoint(page, WALL_A);
    await page.getByTestId('viewpoint-save').click();
    await expect(page.getByTestId('viewpoint-restore')).toBeEnabled();
    const saved = await page.getByTestId('viewer-container').screenshot();

    // 카메라를 옮긴다. 같은 그림이면 옮겨지지 않은 것이므로 복원을 시험할 수 없다.
    await page.getByTestId('view-top').click();
    await expect
      .poll(async () => (await page.getByTestId('viewer-container').screenshot()).equals(saved), {
        timeout: 10_000,
      })
      .toBe(false);

    await page.getByTestId('viewpoint-restore').click();

    // 저장한 자리로 돌아왔다면 같은 지점이 다시 벽 A를 내준다.
    // 카메라를 옮긴 직후의 첫 raycast는 옛 상태로 계산될 수 있어 여러 번 눌러 본다.
    await expect
      .poll(
        async () => {
          await clickViewerAt(page, ratioX, ratioY);
          return (await page.getByTestId('selection-globalid').textContent()) ?? '';
        },
        { timeout: 20_000 },
      )
      .toContain(WALL_A);
    expect(consoleErrors).toEqual([]);
  });

  test('삭제하면 목록에서 빠지고 비면 다시 잠긴다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('viewpoint-save').click();
    await expect(page.getByTestId('viewpoint-remove')).toBeEnabled();

    await page.getByTestId('viewpoint-remove').click();

    await expect(page.getByTestId('viewpoint-list').locator('option')).toHaveCount(0);
    await expect(page.getByTestId('viewpoint-restore')).toBeDisabled();
  });
});
