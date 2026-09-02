import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * 모델 교체 감지 (ADR-0008).
 *
 * 일정은 처음 묶일 때 그 이름이 가리키던 파일의 fingerprint를 적어 둔다. 나중에 같은
 * 이름으로 다른 파일을 열면 이름으로는 묶이되 교체로 알린다. 여기서는 이름만 같고 내용이
 * 다른 파일을 만들어 그 길을 지난다.
 */

const modelFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

/** 일정이 가리키는 이름을 그대로 쓰되 내용은 다른 모델. 부재도 GlobalId도 다르다. */
const replacementBytes = readFileSync(
  fileURLToPath(new URL('../../packages/test-fixtures/ifc/minimal-wall-ifc4.ifc', import.meta.url)),
);

const scheduleFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/mock-three-elements.json', import.meta.url),
);

const openOriginal = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(modelFixture);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('schedule-file').setInputFiles(scheduleFixture);
  await expect(page.getByTestId('schedule-panel')).toBeVisible();
};

const openReplacement = async (page: Page): Promise<void> => {
  await page.getByTestId('model-unload').click();
  await page.getByTestId('model-file').setInputFiles({
    // 이름은 그대로, 내용만 다르다.
    name: 'three-elements-ifc4.ifc',
    mimeType: 'application/octet-stream',
    buffer: replacementBytes,
  });
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

test.describe('모델 교체', () => {
  test('같은 이름의 같은 파일은 교체가 아니다', async ({ page }) => {
    await openOriginal(page);

    // 처음 묶으면서 fingerprint를 적어 둔다. 같은 파일이므로 알릴 것이 없다.
    await expect(page.getByTestId('model-replaced')).toHaveCount(0);
  });

  test('이름은 같고 내용이 다른 파일을 열면 알린다', async ({ page }) => {
    await openOriginal(page);

    await openReplacement(page);

    await expect(page.getByTestId('model-replaced')).toHaveCount(1);
    await expect(page.getByTestId('model-replaced')).toContainText('three-elements-ifc4.ifc');
  });

  test('교체를 승인하면 알림이 사라지고 잃은 부재를 알린다', async ({ page }) => {
    await openOriginal(page);
    await openReplacement(page);
    await expect(page.getByTestId('model-adopt')).toBeVisible();

    await page.getByTestId('model-adopt').click();

    // 새 모델에는 일정이 걸어 둔 부재 셋이 모두 없다. 연결은 지우지 않고 알리기만 한다.
    await expect(page.getByTestId('schedule-status')).toContainText('3개');
    await expect(page.getByTestId('model-replaced')).toHaveCount(0);
  });

  test('승인해도 걸린 부재는 그대로 남는다', async ({ page }) => {
    await openOriginal(page);
    await openReplacement(page);
    await page.getByTestId('model-adopt').click();
    await expect(page.getByTestId('model-replaced')).toHaveCount(0);

    await page.getByTestId('task-assigned').nth(1).click();

    // 지우는 것은 사용자의 결정이다 (ADR-0008).
    await expect(page.getByTestId('assignment-chip')).toHaveCount(1);
    await expect(page.getByTestId('assignment-chip')).toHaveAttribute('data-bound', 'true');
  });
});
