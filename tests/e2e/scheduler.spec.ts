import { readFile } from 'node:fs/promises';
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

test.describe('Scheduler — 화면 편집', () => {
  test('표에서 이름을 고치면 목록과 내보낸 CSV에 함께 반영된다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // 값을 보는 자리에서 그대로 고친다. 폼을 따로 두지 않는다 (79da5ac).
    await page.getByTestId('task-name').nth(1).click();
    await page.getByTestId('task-name-input').fill('슬래브 타설 (수정)');
    await page.getByTestId('task-name-input').press('Enter');

    await expect(page.getByTestId('task-name').nth(1)).toHaveText('슬래브 타설 (수정)');

    const downloads = await collectDownloads(page, 'schedule-export-csv', 4);
    const tasks = downloads.find((download) => download.suggestedFilename() === 'tasks.csv');
    const path = await tasks?.path();
    expect(path).toBeTruthy();
    expect(await readFile(path ?? '', 'utf8')).toContain('슬래브 타설 (수정)');
  });

  test('날짜 칸을 고치면 막대도 함께 움직인다', async ({ page }) => {
    await openSchedule(page, scheduleV2);
    const before = await page.getByTestId('gantt-bar').nth(1).boundingBox();

    await page.getByTestId('task-finish').nth(1).click();
    await page.getByTestId('task-finish-input').fill('2026-03-13');
    await page.getByTestId('task-finish-input').press('Enter');

    await expect(page.getByTestId('task-finish').nth(1)).toHaveText('2026-03-13');
    const after = await page.getByTestId('gantt-bar').nth(1).boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
  });

  test('요약 Task의 날짜 칸은 열리지 않는다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // 보이는 값은 자손에서 계산한 값이라 그 Task의 것이 아니다 (ADR-0006).
    await page.getByTestId('task-start').first().click();

    await expect(page.getByTestId('task-start-input')).toHaveCount(0);
    await expect(page.getByTestId('task-id').first()).toHaveAttribute('data-editable', 'false');
  });

  test('들여쓰기가 앞 형제 밑으로 옮긴다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // T006의 앞 형제는 최상위 요약 W2다.
    await page.getByTestId('task-indent').nth(7).click();

    await expect(page.getByTestId('task-row').nth(7)).toHaveAttribute('data-depth', '1');
    await expect(page.getByTestId('task-row').nth(7)).toHaveAttribute('data-task-id', 'T006');
  });

  test('시간을 가진 Task 밑으로 들여쓰면 이유를 표시한다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // T003의 앞 형제 T002는 제 시간을 가졌다. 자식이 생기면 요약 Task가 되어 규칙을
    // 깬다 (ADR-0006). 화면은 막지 않고 도메인이 낸 이유를 옮겨 적는다.
    await page.getByTestId('task-indent').nth(3).click();

    await expect(page.getByTestId('gantt-status')).toContainText('편집 실패');
    await expect(page.getByTestId('task-row').nth(3)).toHaveAttribute('data-depth', '1');
  });

  test('Task를 더하면 목록에 나온다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    await page.getByTestId('task-add').click();
    await page.getByTestId('task-draft-id').fill('T900');
    await page.getByTestId('task-draft-name').fill('추가 검사');
    await page.getByTestId('task-draft-start').fill('2026-04-02');
    await page.getByTestId('task-draft-finish').fill('2026-04-03');
    await page.getByTestId('task-draft-add').click();

    await expect(page.getByTestId('task-row')).toHaveCount(9);
    await expect(page.getByTestId('task-name').last()).toHaveText('추가 검사');
  });

  test('이미 있는 ID로 더하면 이유를 표시하고 목록을 그대로 둔다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    await page.getByTestId('task-add').click();
    await page.getByTestId('task-draft-id').fill('T001');
    await page.getByTestId('task-draft-name').fill('겹치는 Task');
    await page.getByTestId('task-draft-add').click();

    await expect(page.getByTestId('gantt-status')).toContainText('편집 실패');
    await expect(page.getByTestId('task-row')).toHaveCount(8);
  });

  test('Task를 지우면 함께 사라진 부재 연결을 알린다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    await page.getByTestId('task-remove').nth(1).click();

    await expect(page.getByTestId('task-row')).toHaveCount(7);
    await expect(page.getByTestId('gantt-status')).toContainText('부재 연결 1개');
  });

  test('선후행을 더하고 지운다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // T002로 들어오는 선행은 T001 하나다.
    await page.getByTestId('task-links').nth(2).click();
    await expect(page.getByTestId('dependency-chip')).toHaveCount(1);
    await expect(page.getByTestId('dependency-label')).toHaveText('T001 FS');

    await page.getByTestId('dependency-predecessor').selectOption('W1');
    await page.getByTestId('dependency-type').selectOption('START_START');
    await page.getByTestId('dependency-lag').fill('2');
    await page.getByTestId('dependency-add').click();

    // 고쳐도 펼친 줄은 그대로 있어야 이어서 더할 수 있다.
    await expect(page.getByTestId('dependency-chip')).toHaveCount(2);
    await expect(page.getByTestId('dependency-label').last()).toHaveText('W1 SS +2일');

    await page.getByTestId('dependency-remove').last().click();
    await expect(page.getByTestId('dependency-chip')).toHaveCount(1);
  });

  test('선후행을 더해도 막대는 움직이지 않는다', async ({ page }) => {
    await openSchedule(page, scheduleV2);
    // 여섯째 막대가 T005다. T006은 시간이 없어 막대를 갖지 않는다.
    const before = await page.getByTestId('gantt-bar').nth(6).boundingBox();

    // T005로 들어오는 선행은 T004 하나다. 여기에 T001을 하나 더 건다.
    await page.getByTestId('task-links').nth(6).click();
    await page.getByTestId('dependency-predecessor').selectOption('T001');
    await page.getByTestId('dependency-add').click();
    await expect(page.getByTestId('dependency-chip')).toHaveCount(2);

    // ADR-0006은 선후행을 저장·검증만 한다. 화면이 날짜를 밀면 CPM을 도입한 셈이 된다.
    const after = await page.getByTestId('gantt-bar').nth(6).boundingBox();
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
    expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);
  });

  test('선후행이 순환하면 이유를 표시한다', async ({ page }) => {
    await openSchedule(page, scheduleV2);

    // T001 → T002 → T003이 이미 있다. T003을 T001의 선행으로 걸면 고리가 된다.
    await page.getByTestId('task-links').nth(1).click();
    await page.getByTestId('dependency-predecessor').selectOption('T003');
    await page.getByTestId('dependency-add').click();

    await expect(page.getByTestId('gantt-status')).toContainText('순환');
    await expect(page.getByTestId('dependency-chip')).toHaveCount(0);
  });
});
