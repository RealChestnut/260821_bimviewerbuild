import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectSingle } from './support/picking.js';

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

/** 같은 파일을 두 번 연다. 두 모델에 같은 GlobalId가 존재하는 상태가 된다. */
const openSameTwice = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles([threeElements]);
  await expect(modelNames(page)).toHaveCount(1, { timeout: 60_000 });

  await page.getByTestId('model-file').setInputFiles([threeElements]);
  await expect(modelNames(page)).toHaveCount(2, { timeout: 60_000 });
};

/** 두 모델이 겹쳐 있어도 같은 자리에서 집히는 부재. */
const WALL_A = { ratioX: 0.4, ratioY: 0.65, label: '' } as const;

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

  test('같은 파일을 두 번 열어도 각각 다른 모델로 다룬다', async ({ page }) => {
    // fragments는 모델 이름을 식별자로 쓴다. 파일명만 넘기면 둘째 적재가 첫째를 덮어쓴다.
    await openSameTwice(page);

    await expect(projectRoots(page)).toHaveCount(2);

    // 첫째를 해제한다. 둘이 같은 fragments 모델을 공유했다면 형상이 함께 사라진다.
    await page.getByTestId('model-remove').first().click();
    await expect(modelNames(page)).toHaveCount(1);

    // 남은 모델의 부재가 여전히 집혀야 한다.
    expect(await selectSingle(page, WALL_A)).toContain('GlobalId: ');
  });

  test('한 모델의 부재를 숨겨도 다른 모델의 같은 부재는 남는다', async ({ page }) => {
    // 영구 키는 modelId + GlobalId다. GlobalId만으로 찾으면 두 모델이 함께 숨겨진다.
    await openSameTwice(page);
    const selected = await selectSingle(page, WALL_A);

    await page.getByTestId('hide-selected').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');

    // 다른 모델의 복사본이 그대로이므로 같은 자리에서 같은 GlobalId가 다시 집힌다.
    expect(await selectSingle(page, WALL_A)).toBe(selected);
  });
});
