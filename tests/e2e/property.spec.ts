import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const openFixture = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(fixture);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

const node = (page: Page, label: string) =>
  page.getByTestId('spatial-node').filter({ hasText: label });

const expand = async (page: Page, label: string): Promise<void> => {
  const nodeId = await node(page, label).first().getAttribute('data-node-id');
  await page.locator(`[data-testid="spatial-toggle"][data-node-id="${String(nodeId)}"]`).click();
};

/** 트리를 타고 내려가 층 아래 분류 묶음까지 펼친다. */
const openStorey = async (page: Page): Promise<void> => {
  await expand(page, 'Fixture Site');
  await expand(page, 'Fixture Building');
  await expand(page, 'Level 1');
};

const row = (page: Page, setName: string, propertyName: string) =>
  page
    .locator(`[data-set-name="${setName}"] [data-testid="property-row"]`)
    .filter({ has: page.locator('th', { hasText: propertyName }) })
    .locator('td');

test.describe('속성 패널', () => {
  test('선택 전에는 빈 상태다', async ({ page }) => {
    await openFixture(page);

    await expect(page.getByTestId('property-panel')).toHaveText('선택 없음');
  });

  test('부재를 고르면 Attribute와 표준 Pset, Qto를 보여 준다', async ({ page }) => {
    await openFixture(page);
    await openStorey(page);
    await expand(page, 'IFCWALL');

    await node(page, 'Wall A').click();

    await expect(page.getByTestId('property-title')).toHaveText('Wall A');
    await expect(page.getByTestId('property-category')).toHaveText('IFCWALL');
    await expect(row(page, '기본 Attribute', 'Tag')).toHaveText('WALL-A');
    await expect(row(page, 'Pset_WallCommon', 'IsExternal')).toHaveText('TRUE');
    await expect(row(page, 'Qto_WallBaseQuantities', 'NetSideArea')).toHaveText('18');
  });

  test('사용자 정의 Pset도 거르지 않고 보여 준다', async ({ page }) => {
    await openFixture(page);
    await openStorey(page);
    await expand(page, 'IFCSLAB');

    await node(page, 'Slab 1').click();

    await expect(page.getByTestId('property-title')).toHaveText('Slab 1');
    await expect(row(page, 'BIM4D_Custom', 'BIM4D_Zone')).toHaveText('Zone-A');
  });

  test('여러 개를 고르면 개수만 알린다', async ({ page }) => {
    await openFixture(page);
    await openStorey(page);

    await node(page, 'IFCWALL').click();

    await expect(page.getByTestId('property-panel')).toHaveText('2개 선택');
  });

  test('모델을 해제하면 빈 상태로 돌아간다', async ({ page }) => {
    await openFixture(page);
    await openStorey(page);
    await expand(page, 'IFCSLAB');
    await node(page, 'Slab 1').click();
    await expect(page.getByTestId('property-title')).toBeVisible();

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('property-panel')).toHaveText('선택 없음');
  });
});
