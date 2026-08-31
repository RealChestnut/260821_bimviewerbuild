import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * 일정 독의 배치 계약.
 *
 * 마스터 계획 10.2절의 Visual 계층이다. 나머지 e2e는 testid의 존재와 개수와 글자만
 * 보므로, 칸이 눌려 읽을 수 없는 화면이 되어도 전부 통과한다. 실제로 그런 일이
 * 있었다. 일정 목록과 Gantt가 18rem 사이드바에 있을 때 한 달치 축이 150px에 눌려
 * 날짜가 서로 겹치고 막대가 점으로 줄었는데 테스트는 모두 초록이었다.
 *
 * 그래서 여기서는 그려진 결과의 크기와 자리를 잰다. 숫자는 "사람이 읽을 수 있는가"의
 * 하한이며, 디자인을 고정하려는 값이 아니다.
 */

const scheduleV2 = fileURLToPath(
  new URL('../../packages/test-fixtures/schedule/mock-three-elements.json', import.meta.url),
);

/** 축과 막대를 판단하는 기준 폭. 사이드바 시절 트랙은 150px 안팎이었다. */
const MIN_TRACK_WIDTH = 480;

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box, '요소가 화면에 없다').not.toBeNull();
  return box!;
};

const openSchedule = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto('/');
  await page.getByTestId('schedule-file').setInputFiles(scheduleV2);
  await expect(page.getByTestId('schedule-panel')).toBeVisible();
  await expect(page.getByTestId('gantt')).toBeVisible();
};

test.describe('일정 독 배치', () => {
  test('막대 칸이 사람이 읽을 만큼 넓다', async ({ page }) => {
    await openSchedule(page);

    const track = await boxOf(page.getByTestId('gantt-track').first());

    expect(track.width).toBeGreaterThan(MIN_TRACK_WIDTH);
  });

  test('왼쪽 표와 오른쪽 막대의 같은 Task가 같은 줄에 있다', async ({ page }) => {
    await openSchedule(page);

    const rows = await page.getByTestId('task-row').count();
    expect(rows).toBeGreaterThan(1);

    // 두 칸은 서로 다른 컴포넌트가 그린다. 줄 높이와 머리 여백이 어긋나면 여기서 벌어진다.
    for (const index of [0, rows - 1]) {
      const left = await boxOf(page.getByTestId('task-row').nth(index));
      const right = await boxOf(page.getByTestId('gantt-row').nth(index));

      expect(Math.abs(left.y - right.y), `${String(index)}번째 줄이 어긋났다`).toBeLessThanOrEqual(
        2,
      );
    }
  });

  test('축 눈금의 날짜가 서로 겹치지 않는다', async ({ page }) => {
    await openSchedule(page);

    const ticks = page.getByTestId('gantt-tick');
    const count = await ticks.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 1; index < count; index += 1) {
      const previous = await boxOf(ticks.nth(index - 1));
      const current = await boxOf(ticks.nth(index));

      expect(current.x, '앞 눈금의 글자가 뒤 눈금을 침범했다').toBeGreaterThanOrEqual(
        previous.x + previous.width,
      );
    }
  });

  test('마지막 눈금의 날짜가 오른쪽에서 잘리지 않는다', async ({ page }) => {
    await openSchedule(page);

    const gantt = await boxOf(page.getByTestId('gantt'));
    const ticks = page.getByTestId('gantt-tick');
    const last = await boxOf(ticks.nth((await ticks.count()) - 1));

    expect(last.x + last.width).toBeLessThanOrEqual(gantt.x + gantt.width);
  });

  test('일정을 열어도 화면이 가로로 넘치지 않는다', async ({ page }) => {
    await openSchedule(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('일정 독이 뷰어 화면을 밀어내지 않는다', async ({ page }) => {
    await openSchedule(page);

    const viewer = await boxOf(page.getByTestId('viewer-container'));
    const dock = await boxOf(page.getByTestId('schedule-panel'));

    // 3D 화면이 독 위에 남아 있어야 4D 재생과 막대를 함께 볼 수 있다.
    expect(viewer.height).toBeGreaterThan(200);
    expect(dock.y).toBeGreaterThanOrEqual(viewer.y + viewer.height - 1);
  });

  /*
   * 마스터 계획 10.2절이 말하는 "제한적 screenshot regression"이다. 3D 캔버스는 GPU와
   * 드라이버에 따라 픽셀이 달라지므로 찍지 않는다. 일정 독만 찍는다. 위 단언들이 잡지
   * 못하는 종류의 어긋남(글자 잘림, 겹침, 색)을 여기서 잡는다.
   */
  test('일정 독의 모습이 기준과 같다', async ({ page }) => {
    await openSchedule(page);

    await expect(page.locator('#schedule-dock')).toHaveScreenshot('schedule-dock.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
