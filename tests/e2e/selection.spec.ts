import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickViewerAt, selectSingle } from './support/picking.js';

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

const clickViewerCenter = async (page: Page): Promise<void> => {
  await clickViewerAt(page, 0.5, 0.5);
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

  test('Ctrl을 누른 채 누르면 선택을 토글한다', async ({ page }) => {
    // 화면의 어느 픽셀에 어떤 부재가 오는지는 카메라 맞춤과 타일 스트리밍에 달려 있어
    // 고정할 수 없다. 여기서는 한 지점만 써서 수식어 클릭이 토글로 이어지는지 확인한다.
    // 여러 부재를 조합하는 규칙 자체는 selectionComponent 단위 테스트가 덮는다.
    await openFixture(page, multiFixture);
    const point = { ratioX: 0.5, ratioY: 0.5, label: '' };
    const selected = await selectSingle(page, point);

    await clickViewerAt(page, point.ratioX, point.ratioY, { ctrl: true });
    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');

    await clickViewerAt(page, point.ratioX, point.ratioY, { ctrl: true });
    await expect(page.getByTestId('selection-globalid')).toHaveText(selected);
  });

  test('모델을 해제하면 선택도 풀린다', async ({ page }) => {
    await openFixture(page);
    await clickViewerCenter(page);
    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${WALL_GLOBAL_ID}`);

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('selection-globalid')).toHaveText('선택 없음');
  });
});
