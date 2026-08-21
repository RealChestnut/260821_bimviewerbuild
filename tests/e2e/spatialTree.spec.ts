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

/** 라벨로 마디를 찾는다. 부재 수가 붙는 마디는 접두 일치로 찾는다. */
const node = (page: Page, label: string) =>
  page.getByTestId('spatial-node').filter({ hasText: label });

/** 마디 옆의 펼치기 버튼을 누른다. */
const expand = async (page: Page, label: string): Promise<void> => {
  const nodeId = await node(page, label).first().getAttribute('data-node-id');
  await page.locator(`[data-testid="spatial-toggle"][data-node-id="${String(nodeId)}"]`).click();
};

test.describe('공간 구조 트리', () => {
  test('모델을 열면 공간 계층과 분류가 보인다', async ({ page }) => {
    await openFixture(page);

    // fixture 구조: Project → Site → Building → Level 1 → 벽 둘과 슬래브 하나.
    await expect(node(page, 'Fixture Project')).toBeVisible();
    await expand(page, 'Fixture Site');
    await expand(page, 'Fixture Building');
    await expect(node(page, 'Level 1')).toBeVisible();

    await expand(page, 'Level 1');
    await expect(node(page, 'IFCWALL')).toHaveText('IFCWALL (2)');
    await expect(node(page, 'IFCSLAB')).toHaveText('IFCSLAB (1)');
  });

  test('분류 묶음을 누르면 그 부재가 선택된다', async ({ page }) => {
    await openFixture(page);
    await expand(page, 'Fixture Site');
    await expand(page, 'Fixture Building');
    await expand(page, 'Level 1');

    await node(page, 'IFCWALL').click();

    await expect(page.getByTestId('selection-globalid')).toHaveText('2개 선택');
    await expect(page.getByTestId('isolate-selected')).toBeEnabled();
  });

  test('부재 하나를 누르면 그 부재의 GlobalId가 보인다', async ({ page }) => {
    await openFixture(page);
    await expand(page, 'Fixture Site');
    await expand(page, 'Fixture Building');
    await expand(page, 'Level 1');
    await expand(page, 'IFCSLAB');

    await node(page, 'Slab 1').click();

    await expect(page.getByTestId('selection-globalid')).toHaveText(
      'GlobalId: 2YsHnV6bk3PgZdL9uCxWtM',
    );
  });

  test('트리에서 고른 부재를 격리할 수 있다', async ({ page }) => {
    await openFixture(page);
    await expand(page, 'Fixture Site');
    await expand(page, 'Fixture Building');
    await expand(page, 'Level 1');

    await node(page, 'IFCWALL').click();
    await page.getByTestId('isolate-selected').click();

    await expect(page.getByTestId('visibility-status')).toHaveText('격리 중');
  });

  test('모델을 해제하면 트리가 비워진다', async ({ page }) => {
    await openFixture(page);
    await expect(node(page, 'Fixture Project')).toBeVisible();

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('spatial-tree')).toHaveText('열린 모델 없음');
  });
});
