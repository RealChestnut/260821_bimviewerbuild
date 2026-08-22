import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectSingle } from './support/picking.js';

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

const viewpoints = (page: Page) => page.getByTestId('viewpoint-restore');

test.describe('시점 저장과 되살리기', () => {
  test('저장한 시점이 없으면 빈 상태다', async ({ page }) => {
    await openFixture(page);

    await expect(page.getByTestId('viewpoint-list')).toHaveText('저장한 시점 없음');
  });

  test('저장하면 목록에 이름이 생긴다', async ({ page }) => {
    await openFixture(page);

    await page.getByTestId('viewpoint-save').click();

    await expect(viewpoints(page)).toHaveText(['시점 1']);
  });

  test('되살리면 저장 당시의 가시성으로 돌아간다', async ({ page }) => {
    await openFixture(page);
    await selectSingle(page, WALL_A);
    await page.getByTestId('hide-selected').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');

    await page.getByTestId('viewpoint-save').click();
    await expect(viewpoints(page)).toHaveText(['시점 1']);

    // 저장한 뒤 화면을 흐트러뜨린다.
    await page.getByTestId('show-all').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('');

    await viewpoints(page).first().click();

    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');
  });

  test('되살리면 저장 당시의 단면으로 돌아간다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('section-axis').filter({ hasText: 'Z 단면' }).click();
    await expect(page.getByTestId('section-status')).toHaveText('단면 1개');

    await page.getByTestId('viewpoint-save').click();
    await page.getByTestId('section-clear').click();
    await expect(page.getByTestId('section-status')).toHaveText('');

    await viewpoints(page).first().click();

    await expect(page.getByTestId('section-status')).toHaveText('단면 1개');
  });

  test('단면이 없던 시점으로 되살리면 단면도 사라진다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('viewpoint-save').click();
    await page.getByTestId('section-axis').filter({ hasText: 'Y 단면' }).click();
    await expect(page.getByTestId('section-status')).toHaveText('단면 1개');

    await viewpoints(page).first().click();

    await expect(page.getByTestId('section-status')).toHaveText('');
  });

  test('시점을 지우면 목록에서 빠진다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('viewpoint-save').click();
    await page.getByTestId('viewpoint-save').click();
    await expect(viewpoints(page)).toHaveCount(2);

    await page.getByTestId('viewpoint-delete').first().click();

    await expect(viewpoints(page)).toHaveText(['시점 2']);
  });

  test('화면 맞춤이 모델을 다시 화면에 담는다', async ({ page }) => {
    await openFixture(page);

    // 멀리 밀어낸 뒤 맞춤을 누르면 다시 부재가 집힌다.
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -4000);
    await page.getByTestId('camera-fit').click();

    const picked = await selectSingle(page, WALL_A);
    expect(picked).toContain('GlobalId: ');
  });
});
