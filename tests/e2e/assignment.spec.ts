import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { findPickPoint, clickViewerAt } from './support/picking.js';

const modelFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const scheduleFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/mock-three-elements.json', import.meta.url),
);

const openSchedule = async (page: Page): Promise<void> => {
  await page.getByTestId('schedule-file').setInputFiles(scheduleFixture);
  await expect(page.getByTestId('schedule-panel')).toBeVisible();
};

const openModel = async (page: Page): Promise<void> => {
  await page.getByTestId('model-file').setInputFiles(modelFixture);
  await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
};

/** 부재가 하나도 걸려 있지 않은 Task를 새로 만든다. 그 줄에서 연결을 시험한다. */
const addEmptyTask = async (page: Page): Promise<void> => {
  await page.getByTestId('task-add').click();
  await page.getByTestId('task-draft-id').fill('T900');
  await page.getByTestId('task-draft-name').fill('연결 시험');
  await page.getByTestId('task-draft-start').fill('2026-04-06');
  await page.getByTestId('task-draft-finish').fill('2026-04-08');
  await page.getByTestId('task-draft-add').click();
  await expect(page.getByTestId('task-row')).toHaveCount(9);
};

test.describe('IFC–Task 연결', () => {
  test('부재 수 칸을 눌러 연결 줄을 열고 닫는다', async ({ page }) => {
    await page.goto('/');
    await openSchedule(page);

    await page.getByTestId('task-assigned').nth(1).click();

    await expect(page.getByTestId('assignment-editor')).toHaveCount(1);
    await expect(page.getByTestId('assignment-chip')).toHaveCount(1);

    await page.getByTestId('task-assigned').nth(1).click();
    await expect(page.getByTestId('assignment-editor')).toHaveCount(0);
  });

  test('모델을 열지 않으면 걸린 부재를 3D에서 찾을 수 없다', async ({ page }) => {
    await page.goto('/');
    await openSchedule(page);

    await page.getByTestId('task-assigned').nth(1).click();

    // 무엇에 걸려 있는지는 모델과 무관한 일정의 사실이라 보여 준다.
    await expect(page.getByTestId('assignment-chip')).toHaveAttribute('data-bound', 'false');
    await expect(page.getByTestId('assignment-show')).toBeDisabled();
  });

  test('뷰어에서 고른 부재를 Task에 걸고 다시 끊는다', async ({ page }) => {
    await page.goto('/');
    await openModel(page);
    await openSchedule(page);
    await addEmptyTask(page);

    await findPickPoint(page);
    const picked = (await page.getByTestId('selection-globalid').innerText()).replace(
      'GlobalId: ',
      '',
    );

    await page.getByTestId('task-assigned').last().click();
    await expect(page.getByTestId('assignment-empty')).toBeVisible();

    await page.getByTestId('assignment-add').click();

    await expect(page.getByTestId('assignment-chip')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('assignment-chip')).toHaveAttribute('data-global-id', picked);
    await expect(page.getByTestId('assignment-chip')).toHaveAttribute('data-bound', 'true');
    await expect(page.getByTestId('task-assigned').last()).toHaveText('1');

    // 걸린 부재를 3D에서 다시 고른다.
    await clickViewerAt(page, 0.02, 0.02);
    await page.getByTestId('assignment-show').click();
    await expect(page.getByTestId('selection-globalid')).toHaveText(`GlobalId: ${picked}`);

    await page.getByTestId('assignment-remove').click();
    await expect(page.getByTestId('assignment-chip')).toHaveCount(0);
    await expect(page.getByTestId('task-assigned').last()).toHaveText('0');
    await expect(page.getByTestId('assignment-empty')).toBeVisible();
  });

  test('고른 종류로 걸고 칩에 그대로 적는다', async ({ page }) => {
    await page.goto('/');
    await openModel(page);
    await openSchedule(page);
    await addEmptyTask(page);
    await findPickPoint(page);

    await page.getByTestId('task-assigned').last().click();
    await page.getByTestId('assignment-operation').selectOption('DEMOLISH');
    await page.getByTestId('assignment-add').click();
    await expect(page.getByTestId('assignment-chip')).toHaveCount(1);

    // 칩은 무엇을, 어느 모델에서, 무엇으로 걸었는지를 한 줄로 보여 준다.
    await expect(page.getByTestId('assignment-label')).toContainText('철거');
    await expect(page.getByTestId('assignment-label')).toContainText('three-elements-ifc4.ifc');
  });
});

test.describe('미연결 필터', () => {
  test('부재가 걸리지 않은 Task만 골라 본다', async ({ page }) => {
    await page.goto('/');
    await openSchedule(page);
    // fixture의 Task에는 모두 부재가 걸려 있다.
    await page.getByTestId('filter-unassigned').click();
    await expect(page.getByTestId('task-row')).toHaveCount(0);

    await page.getByTestId('filter-unassigned').click();
    await addEmptyTask(page);
    await page.getByTestId('filter-unassigned').click();

    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(page.getByTestId('task-name')).toHaveText('연결 시험');
    await expect(page.getByTestId('filter-unassigned')).toHaveAttribute('aria-pressed', 'true');
  });

  test('모두 걸려 있으면 미연결 부재가 없다고 알린다', async ({ page }) => {
    await page.goto('/');
    await openModel(page);
    await openSchedule(page);

    await page.getByTestId('select-unassigned').click();

    // 부재 목록은 공간 구조에서 읽는다. 모델이 큰 날에는 첫 응답이 늦다.
    await expect(page.getByTestId('schedule-status')).toContainText('미연결 부재가 없다', {
      timeout: 30_000,
    });
  });

  test('연결을 끊은 부재를 3D에서 찾아 준다', async ({ page }) => {
    await page.goto('/');
    await openModel(page);
    await openSchedule(page);

    // 슬래브는 T001과 T006 두 곳에 걸려 있다. 둘 다 끊어야 미연결이 된다.
    await page.getByTestId('task-assigned').nth(1).click();
    await page.getByTestId('assignment-remove').first().click();
    await expect(page.getByTestId('assignment-empty')).toBeVisible();

    await page.getByTestId('task-assigned').nth(7).click();
    await page.getByTestId('assignment-remove').first().click();
    await expect(page.getByTestId('assignment-empty')).toBeVisible();

    await page.getByTestId('select-unassigned').click();

    await expect(page.getByTestId('schedule-status')).toContainText('1개', { timeout: 15_000 });
    await expect(page.getByTestId('selection-globalid')).toContainText('GlobalId: ');
  });
});
