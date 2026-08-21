import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/minimal-wall-ifc4.ifc', import.meta.url),
);

/** fixture의 유일한 IfcWall GlobalId. */
const WALL_GLOBAL_ID = '0ZQeYb8Yr9UfXcM1kTPvJd';

const openFixture = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(fixture);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

const clickViewerCenter = async (page: Page): Promise<void> => {
  const container = page.getByTestId('viewer-container');
  const box = await container.boundingBox();
  if (box === null) throw new Error('viewer container has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

test.describe('객체 선택', () => {
  test('객체를 누르면 GlobalId를 표시한다', async ({ page }) => {
    await openFixture(page);
    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');

    await clickViewerCenter(page);

    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${WALL_GLOBAL_ID}`);
  });

  test('같은 객체를 두 번 눌러도 selection/changed는 한 번만 발생한다', async ({ page }) => {
    await openFixture(page);

    await page.evaluate(() => {
      const received: unknown[] = [];
      (window as unknown as { __changes: unknown[] }).__changes = received;
      window.bim4d?.subscribe('selection/changed', (payload) => {
        received.push(payload);
      });
    });

    await clickViewerCenter(page);
    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${WALL_GLOBAL_ID}`);
    await clickViewerCenter(page);
    await page.waitForTimeout(500);

    const changes = await page.evaluate(
      () => (window as unknown as { __changes: unknown[] }).__changes.length,
    );
    expect(changes).toBe(1);
  });

  test('빈 곳을 누르면 선택이 풀린다', async ({ page }) => {
    await openFixture(page);
    await clickViewerCenter(page);
    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${WALL_GLOBAL_ID}`);

    const box = await page.getByTestId('viewer-container').boundingBox();
    if (box === null) throw new Error('viewer container has no box');
    await page.mouse.click(box.x + 20, box.y + box.height - 20);

    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');
  });

  test('모델을 해제하면 선택도 풀린다', async ({ page }) => {
    await openFixture(page);
    await clickViewerCenter(page);
    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${WALL_GLOBAL_ID}`);

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');
  });
});
