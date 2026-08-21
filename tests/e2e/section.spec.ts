import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickViewerAt, selectSingle } from './support/picking.js';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

/** 벽 A가 보이는 지점. 가시성 테스트와 같은 자리다. */
const WALL_A = { ratioX: 0.4, ratioY: 0.65, label: '' } as const;

const openFixture = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(fixture);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

test.describe('단면', () => {
  test('모델이 없으면 단면을 만들지 않는다', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('section-axis').filter({ hasText: 'Y 단면' }).click();

    await expect(page.getByTestId('section-status')).toHaveText('');
    await expect(page.getByTestId('section-clear')).toBeDisabled();
  });

  test('축 단면을 만들면 개수를 표시한다', async ({ page }) => {
    await openFixture(page);

    await page.getByTestId('section-axis').filter({ hasText: 'Y 단면' }).click();

    await expect(page.getByTestId('section-status')).toHaveText('단면 1개');
    await expect(page.getByTestId('section-clear')).toBeEnabled();
  });

  test('단면을 만들면 잘려 나간 쪽은 더 이상 집히지 않는다', async ({ page }) => {
    await openFixture(page);
    const wall = await selectSingle(page, WALL_A);
    await page.getByTestId('viewer-container').click({ position: { x: 5, y: 5 } });

    // Z 단면은 모델 한가운데를 지난다. 벽 A는 잘려 나가는 쪽에 있다.
    await page.getByTestId('section-axis').filter({ hasText: 'Z 단면' }).click();
    await expect(page.getByTestId('section-status')).toHaveText('단면 1개');

    await clickViewerAt(page, WALL_A.ratioX, WALL_A.ratioY);
    await expect(page.getByTestId('selection-globalid')).not.toHaveText(wall);
  });

  test('단면을 끄면 평면은 남고 자르기만 멈춘다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('section-axis').filter({ hasText: 'Z 단면' }).click();

    await page.getByTestId('section-toggle').click();

    await expect(page.getByTestId('section-status')).toHaveText('단면 1개 (꺼짐)');
    await expect(page.getByTestId('section-toggle')).toHaveText('단면 켜기');
  });

  test('단면 해제가 모든 평면을 지운다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('section-axis').filter({ hasText: 'X 단면' }).click();
    await page.getByTestId('section-axis').filter({ hasText: 'Y 단면' }).click();
    await expect(page.getByTestId('section-status')).toHaveText('단면 2개');

    await page.getByTestId('section-clear').click();

    await expect(page.getByTestId('section-status')).toHaveText('');
    await expect(page.getByTestId('section-toggle')).toBeDisabled();
  });

  test('모델을 해제하면 단면도 함께 사라진다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('section-axis').filter({ hasText: 'Y 단면' }).click();
    await expect(page.getByTestId('section-status')).toHaveText('단면 1개');

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('section-status')).toHaveText('');
    await expect(page.getByTestId('section-clear')).toBeDisabled();
  });
});
