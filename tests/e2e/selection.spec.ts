import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/minimal-wall-ifc4.ifc', import.meta.url),
);

const multiFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

/** minimal-wall-ifc4의 유일한 IfcWall GlobalId. */
const WALL_GLOBAL_ID = '0ZQeYb8Yr9UfXcM1kTPvJd';

const openFixture = async (page: Page, file = fixture): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(file);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

/** 컨테이너 안의 상대 위치(0~1)를 눌러 서로 다른 부재를 고른다. */
const clickViewerAt = async (
  page: Page,
  ratioX: number,
  ratioY: number,
  modifiers: { readonly ctrl?: boolean } = {},
): Promise<void> => {
  const box = await page.getByTestId('viewer-container').boundingBox();
  if (box === null) throw new Error('viewer container has no box');
  const point = { x: box.x + box.width * ratioX, y: box.y + box.height * ratioY };
  if (modifiers.ctrl === true) {
    await page.keyboard.down('Control');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('Control');
    return;
  }
  await page.mouse.click(point.x, point.y);
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

  test('Ctrl을 누른 채 다른 부재를 누르면 함께 선택한다', async ({ page }) => {
    await openFixture(page, multiFixture);

    await clickViewerAt(page, 0.35, 0.6);
    await expect(page.getByTestId('selection-globalid')).toContainText('GlobalId: ');
    const first = await page.getByTestId('selection-globalid').textContent();

    await clickViewerAt(page, 0.52, 0.42, { ctrl: true });

    await expect(page.getByTestId('selection-globalid')).toHaveText('2개 선택');
    expect(first).not.toBe('선택 없음');
  });

  test('Ctrl을 누른 채 이미 고른 부재를 다시 누르면 선택에서 뺀다', async ({ page }) => {
    await openFixture(page, multiFixture);
    await clickViewerAt(page, 0.35, 0.6);
    await clickViewerAt(page, 0.52, 0.42, { ctrl: true });
    await expect(page.getByTestId('selection-globalid')).toHaveText('2개 선택');

    await clickViewerAt(page, 0.52, 0.42, { ctrl: true });

    await expect(page.getByTestId('selection-globalid')).toContainText('GlobalId: ');
  });

  test('모델을 해제하면 선택도 풀린다', async ({ page }) => {
    await openFixture(page);
    await clickViewerCenter(page);
    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${WALL_GLOBAL_ID}`);

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');
  });
});
