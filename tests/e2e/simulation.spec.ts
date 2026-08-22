import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { clickViewerAt, findPickPoint } from './support/picking.js';

const modelFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const scheduleFixture = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/mock-three-elements.json', import.meta.url),
);

/** three-elements-ifc4의 벽 A. 일정에서 2026-03-09에 시공된다. */
const WALL_A = '0BnKdW4tq7SfUcM3vHxZgR';

const START_DATE = '2026-03-02';
const FINISH_DATE = '2026-04-01';

/** 시작 시각: 슬래브만 진행 중이고 두 벽은 아직 시공 전이다. */
const START_SUMMARY = '진행 1 · 표시 0 · 숨김 2';
/** 끝 시각: 벽 B가 철거 진행 중이고 나머지 둘은 통상 표현이다. */
const FINISH_SUMMARY = '진행 1 · 표시 2 · 숨김 0';

const openModelAndSchedule = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(modelFixture);
  await expect(page.getByTestId('model-status')).toHaveText('모델 1개', { timeout: 60_000 });

  await page.getByTestId('schedule-file').setInputFiles(scheduleFixture);
  await expect(page.getByTestId('simulation-date')).toHaveText(START_DATE);
  await expect(page.getByTestId('simulation-status')).toHaveText(START_SUMMARY);
};

/** 슬라이더를 특정 시각으로 옮긴다. */
const moveTo = async (page: Page, value: string): Promise<void> => {
  await page.getByTestId('simulation-time').fill(value);
};

const boundsOf = async (page: Page): Promise<{ min: string; max: string }> => {
  const slider = page.getByTestId('simulation-time');
  const min = await slider.getAttribute('min');
  const max = await slider.getAttribute('max');
  if (min === null || max === null) throw new Error('슬라이더 구간이 없다.');
  return { min, max };
};

test.describe('Mock 4D Simulation', () => {
  test('일정을 열면 타임라인이 열리고 시작 시각의 상태를 계산한다', async ({ page }) => {
    await openModelAndSchedule(page);

    await expect(page.getByTestId('simulation-status')).toHaveText(START_SUMMARY);
    await expect(page.getByTestId('simulation-play')).toBeEnabled();
  });

  test('타임라인 끝으로 옮기면 시공된 부재가 표시로 바뀐다', async ({ page }) => {
    await openModelAndSchedule(page);
    const { max } = await boundsOf(page);

    await moveTo(page, max);

    await expect(page.getByTestId('simulation-date')).toHaveText(FINISH_DATE);
    await expect(page.getByTestId('simulation-status')).toHaveText(FINISH_SUMMARY);
  });

  test('시공 전 부재는 실제로 화면에서 집히지 않는다', async ({ page }) => {
    await openModelAndSchedule(page);
    const { min, max } = await boundsOf(page);

    // 먼저 벽 A가 보이는 시점에서 그것이 집히는 지점을 확정한다.
    await moveTo(page, max);
    const [ratioX, ratioY] = await findPickPoint(page, WALL_A);

    // 같은 지점이 시공 전 시점에서는 벽 A를 내주지 않아야 한다.
    await moveTo(page, min);
    await expect(page.getByTestId('simulation-date')).toHaveText(START_DATE);
    await clickViewerAt(page, ratioX, ratioY);

    await expect(page.getByTestId('selection-globalid')).not.toContainText(WALL_A);
  });

  test('앞뒤로 오간 뒤 같은 시각이면 상태가 같다', async ({ page }) => {
    await openModelAndSchedule(page);
    const { min, max } = await boundsOf(page);

    await moveTo(page, max);
    await expect(page.getByTestId('simulation-status')).toHaveText(FINISH_SUMMARY);
    await moveTo(page, String(Number(min) + 15 * 86_400_000));
    await moveTo(page, min);

    // 상태는 t의 함수이므로 어디를 거쳐 왔는지와 무관하게 처음과 같아야 한다.
    await expect(page.getByTestId('simulation-status')).toHaveText(START_SUMMARY);
    await expect(page.getByTestId('simulation-date')).toHaveText(START_DATE);
  });

  test('재생하면 시간이 흐르고 끝에서 스스로 멈춘다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await openModelAndSchedule(page);
    await page.getByTestId('simulation-speed').selectOption('4');

    await page.getByTestId('simulation-play').click();
    await expect(page.getByTestId('simulation-play')).toHaveText('정지');

    await expect(page.getByTestId('simulation-date')).toHaveText(FINISH_DATE, { timeout: 30_000 });
    await expect(page.getByTestId('simulation-play')).toHaveText('재생', { timeout: 10_000 });
    expect(consoleErrors).toEqual([]);
  });

  test('일정 JSON이 스키마에 맞지 않으면 이유를 표시하고 타임라인을 열지 않는다', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByTestId('schedule-file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schemaVersion": 99}', 'utf8'),
    });

    await expect(page.getByTestId('simulation-status')).toContainText('일정 열기 실패');
    await expect(page.getByTestId('simulation-time')).toBeDisabled();
  });
});
