import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickViewerAt, selectSingle } from './support/picking.js';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const openFixture = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(fixture);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

/** 벽 A가 보이는 지점과 슬래브가 보이는 지점. */
const WALL_A = { ratioX: 0.4, ratioY: 0.65, label: '' } as const;
const SLAB = { ratioX: 0.5, ratioY: 0.78, label: '' } as const;

test.describe('숨김과 격리', () => {
  test('선택한 부재를 숨기면 그 자리에서 더 이상 집히지 않는다', async ({ page }) => {
    await openFixture(page);
    const hidden = await selectSingle(page, WALL_A);

    await page.getByTestId('hide-selected').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');

    await clickViewerAt(page, WALL_A.ratioX, WALL_A.ratioY);
    await expect(page.getByTestId('selection-globalid')).not.toHaveText(hidden);
  });

  test('전체 표시가 숨긴 부재를 되돌린다', async ({ page }) => {
    await openFixture(page);
    await selectSingle(page, WALL_A);
    await page.getByTestId('hide-selected').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');

    await page.getByTestId('show-all').click();

    await expect(page.getByTestId('visibility-status')).toHaveText('');
    await expect(page.getByTestId('show-all')).toBeDisabled();
  });

  test('격리하면 고른 부재만 남는다', async ({ page }) => {
    await openFixture(page);
    const isolated = await selectSingle(page, WALL_A);

    await page.getByTestId('isolate-selected').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('격리 중');

    // 격리 대상이 아닌 슬래브 자리를 눌러도 아무것도 집히지 않는다.
    await clickViewerAt(page, SLAB.ratioX, SLAB.ratioY);
    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');

    // 격리 대상 자리는 그대로 집힌다.
    await clickViewerAt(page, WALL_A.ratioX, WALL_A.ratioY);
    await expect(page.getByTestId('selection-globalid')).toHaveText(isolated);
  });

  test('모델을 해제하면 가시성 상태도 초기화된다', async ({ page }) => {
    await openFixture(page);
    await selectSingle(page, WALL_A);
    await page.getByTestId('hide-selected').click();
    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('visibility-status')).toHaveText('');
    await expect(page.getByTestId('show-all')).toBeDisabled();
  });
});
