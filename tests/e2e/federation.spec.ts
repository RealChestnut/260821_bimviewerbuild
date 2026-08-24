import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const threeElements = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);
const minimalWall = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/minimal-wall-ifc4.ifc', import.meta.url),
);

const modelNames = (page: Page) => page.getByTestId('model-name');

/** 트리의 뿌리 마디. 모델 하나에 하나씩 온다. */
const projectRoots = (page: Page) =>
  page.getByTestId('spatial-node').filter({ hasText: 'Fixture Project' });

/** 두 파일을 한 번에 고른다. 적재는 하나씩 순서대로 진행된다. */
const openBoth = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles([threeElements, minimalWall]);
  await expect(modelNames(page)).toHaveCount(2, { timeout: 60_000 });
};

test.describe('복수 모델 연합', () => {
  test('여러 IFC를 한 번에 열면 목록에 모두 나온다', async ({ page }) => {
    await openBoth(page);

    await expect(modelNames(page)).toHaveText(['three-elements-ifc4.ifc', 'minimal-wall-ifc4.ifc']);
  });

  test('모델마다 공간 구조 트리를 함께 그린다', async ({ page }) => {
    await openBoth(page);

    // 두 fixture 모두 IfcProject 이름이 'Fixture Project'다. 뿌리가 둘이면 트리도 둘이다.
    await expect(projectRoots(page)).toHaveCount(2);
  });

  test('모델 하나만 감췄다 되돌릴 수 있다', async ({ page }) => {
    await openBoth(page);
    const second = page.getByTestId('model-visible').nth(1);

    await second.uncheck();
    await expect(second).not.toBeChecked();

    await second.check();
    await expect(second).toBeChecked();
  });

  test('모델 하나만 해제해도 나머지는 남는다', async ({ page }) => {
    await openBoth(page);

    await page.getByTestId('model-remove').first().click();

    await expect(modelNames(page)).toHaveText(['minimal-wall-ifc4.ifc']);
    await expect(projectRoots(page)).toHaveCount(1);
  });

  test('모델을 모두 해제하면 빈 상태로 돌아간다', async ({ page }) => {
    await openBoth(page);

    await page.getByTestId('model-remove').first().click();
    await expect(modelNames(page)).toHaveCount(1);
    await page.getByTestId('model-remove').first().click();

    await expect(page.getByTestId('model-list')).toHaveText('열린 모델 없음');
    await expect(page.getByTestId('spatial-tree')).toHaveText('열린 모델 없음');
  });
});
