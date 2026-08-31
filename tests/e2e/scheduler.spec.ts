import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';

const modelFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const scheduleV2 = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/mock-three-elements.json', import.meta.url),
);

const scheduleV1 = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/legacy-v1-three-elements.json', import.meta.url),
);

const csvBundle = ['schedule.csv', 'tasks.csv', 'dependencies.csv', 'assignments.csv'].map((name) =>
  fileURLToPath(new URL(`../../packages/test-fixtures/schedule/csv/${name}`, import.meta.url)),
);

/** 내보내기 버튼 하나가 만드는 다운로드를 모두 받는다. */
const collectDownloads = async (page: Page, testId: string, expected: number) => {
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));

  await page.getByTestId(testId).click();
  await expect.poll(() => downloads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(expected);

  return downloads;
};

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
    await expect(page.getByTestId('task-start').first()).toHaveText('2026-03-02');
    await expect(page.getByTestId('task-finish').first()).toHaveText('2026-03-20');
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

  test('CSV 묶음 네 파일을 골라도 일정이 열린다', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('schedule-file').setInputFiles(csvBundle);

    // JSON fixture와 같은 일정이므로 화면도 같아야 한다.
    await expect(page.getByTestId('schedule-panel')).toBeVisible();
    await expect(page.getByTestId('task-row')).toHaveCount(8);
    await expect(page.getByTestId('schedule-name')).toHaveText(
      'three-elements-ifc4 Mock 4D 일정 (v2)',
    );
  });

  test('CSV 묶음에 필수 파일이 빠지면 이유를 표시한다', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('schedule-file').setInputFiles(csvBundle.slice(0, 2));

    await expect(page.getByTestId('schedule-status')).toContainText('assignments.csv가 없다');
    await expect(page.getByTestId('schedule-panel')).toBeHidden();
  });

  test('CSV로 내보내면 파일 넷을 내려받는다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    const downloads = await collectDownloads(page, 'schedule-export-csv', 4);

    expect(downloads.map((download) => download.suggestedFilename()).sort()).toEqual([
      'assignments.csv',
      'dependencies.csv',
      'schedule.csv',
      'tasks.csv',
    ]);
    await expect(page.getByTestId('schedule-status')).toContainText('4개');
  });

  test('JSON으로 내보내면 파일 하나를 내려받는다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    const downloads = await collectDownloads(page, 'schedule-export-json', 1);

    expect(downloads[0]?.suggestedFilename()).toBe('schedule.json');
  });

  test('일정이 없으면 내보내기가 이유를 표시한다', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('schedule-export-csv').click();

    await expect(page.getByTestId('schedule-status')).toContainText('내보내기 실패');
  });

  test('Gantt가 Task마다 막대를 그린다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    await expect(page.getByTestId('schedule-table')).toBeVisible();
    await expect(page.getByTestId('task-row')).toHaveCount(8);
    // 시간 미정 Task 하나만 막대가 없다.
    await expect(page.getByTestId('gantt-bar')).toHaveCount(7);
    await expect(page.getByTestId('gantt-range')).toHaveText('2026-03-02 ~ 2026-04-01');
  });

  test('Gantt가 시뮬레이션 시각을 커서로 보여 준다', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('model-file').setInputFiles(modelFixture);
    await expect(page.getByTestId('model-unload')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('schedule-file').setInputFiles(scheduleV2);

    await expect(page.getByTestId('gantt-cursor')).toBeHidden();

    await page.getByTestId('simulation-play').click();
    await expect(page.getByTestId('gantt-cursor')).toBeVisible();
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
