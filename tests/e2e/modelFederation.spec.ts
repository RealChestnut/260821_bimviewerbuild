import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { findPickPoint } from './support/picking.js';

const wallFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/minimal-wall-ifc4.ifc', import.meta.url),
);

const threeFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

/** 모델 하나를 열고 목록이 기대한 개수가 될 때까지 기다린다. */
const openModel = async (page: Page, file: string, expectedCount: number): Promise<void> => {
  await page.getByTestId('model-file').setInputFiles(file);
  await expect(page.getByTestId('model-status')).toHaveText(`모델 ${String(expectedCount)}개`, {
    timeout: 60_000,
  });
};

test.describe('복수 모델 연합', () => {
  test('두 모델을 함께 열면 목록에 적재 순서대로 쌓인다', async ({ page }) => {
    await page.goto('/');

    await openModel(page, threeFixture, 1);
    await openModel(page, wallFixture, 2);

    await expect(page.getByTestId('model-name')).toHaveText([
      'three-elements-ifc4.ifc (IFC4)',
      'minimal-wall-ifc4.ifc (IFC4)',
    ]);
  });

  test('한 모델만 해제하면 나머지 모델이 화면에 남는다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');
    await openModel(page, threeFixture, 1);
    await openModel(page, wallFixture, 2);

    // 둘째 줄만 해제한다. 첫 줄의 모델은 그대로 있어야 한다.
    await page.getByTestId('model-unload').nth(1).click();

    await expect(page.getByTestId('model-status')).toHaveText('모델 1개');
    await expect(page.getByTestId('model-name')).toHaveText('three-elements-ifc4.ifc (IFC4)');
    await findPickPoint(page);
    expect(consoleErrors).toEqual([]);
  });

  test('같은 파일을 두 번 열어도 각각 다른 모델로 다룬다', async ({ page }) => {
    await page.goto('/');

    await openModel(page, wallFixture, 1);
    await openModel(page, wallFixture, 2);
    await expect(page.getByTestId('model-row')).toHaveCount(2);

    // 첫 줄을 해제해도 둘째 줄의 모델은 살아 있어야 한다.
    // 두 모델이 같은 내부 식별자를 공유했다면 여기서 둘 다 사라진다.
    await page.getByTestId('model-unload').first().click();

    await expect(page.getByTestId('model-status')).toHaveText('모델 1개');
    await findPickPoint(page);
  });
});
