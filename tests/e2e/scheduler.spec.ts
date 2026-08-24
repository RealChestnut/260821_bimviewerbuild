import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const modelFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const scheduleV2 = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/mock-three-elements.json', import.meta.url),
);

const scheduleV1 = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/legacy-v1-three-elements.json', import.meta.url),
);

const openSchedule = async (page: Page, file: string): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('schedule-file').setInputFiles(file);
  await expect(page.getByTestId('schedule-panel')).toBeVisible();
};

test.describe('Scheduler', () => {
  test('일정이 없으면 목록을 보이지 않는다', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('schedule-panel')).toBeHidden();
    await expect(page.getByTestId('task-row')).toHaveCount(0);
  });

  test('일정을 열면 계층 순서로 Task 목록을 그린다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // 요약 2개와 작업 5개, 시간 미정 1개.
    await expect(page.getByTestId('task-row')).toHaveCount(8);
    await expect(page.getByTestId('task-name').first()).toHaveText('1층 골조');
    await expect(page.getByTestId('schedule-name')).toHaveText(
      'three-elements-ifc4 Mock 4D 일정 (v2)',
    );
  });

  test('요약 Task의 기간을 자손에서 계산해 보여 준다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // W1은 슬래브 시작부터 벽 B 완료까지다.
    await expect(page.getByTestId('task-dates').first()).toHaveText('2026-03-02 ~ 2026-03-20');
  });

  test('시간이 정해지지 않은 Task를 경고로 알린다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    await expect(page.getByTestId('schedule-warning')).toHaveCount(1);
    await expect(page.getByTestId('schedule-warning')).toContainText('시간이 정해지지 않았다');
  });

  test('옛 형식(v1) 파일도 열린다', async ({ page }) => {
    // 읽고 나면 v2가 되므로 화면은 계층 없는 목록을 그린다 (ADR-0006).
    await openSchedule(page, scheduleV1);

    await expect(page.getByTestId('task-row')).toHaveCount(6);
  });

  test('일정을 열면 시뮬레이션 타임라인도 함께 열린다', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('model-file').setInputFiles(modelFixture);
    await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });

    await page.getByTestId('schedule-file').setInputFiles(scheduleV2);

    await expect(page.getByTestId('simulation-date')).toHaveText('2026-03-02');
    await expect(page.getByTestId('simulation-play')).toBeEnabled();
  });

  test('스키마에 맞지 않으면 이유를 표시하고 목록을 열지 않는다', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('schedule-file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schemaVersion": 99}', 'utf8'),
    });

    await expect(page.getByTestId('schedule-status')).toContainText('일정 열기 실패');
    await expect(page.getByTestId('schedule-panel')).toBeHidden();
    await expect(page.getByTestId('simulation-time')).toBeDisabled();
  });
});
