import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export interface PickPoint {
  /** 컨테이너 기준 상대 좌표(0~1). */
  readonly ratioX: number;
  readonly ratioY: number;
  /** 그 지점에서 집히는 부재의 화면 표시 문구. */
  readonly label: string;
}

/** 컨테이너 안의 상대 위치를 누른다. */
export const clickViewerAt = async (
  page: Page,
  ratioX: number,
  ratioY: number,
  modifiers: { readonly ctrl?: boolean } = {},
): Promise<void> => {
  const box = await page.getByTestId('viewer-container').boundingBox();
  if (box === null) throw new Error('viewer container has no box');

  const x = box.x + box.width * ratioX;
  const y = box.y + box.height * ratioY;

  if (modifiers.ctrl !== true) {
    await page.mouse.click(x, y);
    return;
  }
  await page.keyboard.down('Control');
  await page.mouse.click(x, y);
  await page.keyboard.up('Control');
};

/**
 * 한 부재만 고른 상태를 만든다.
 *
 * 형상 타일은 적재 직후 조금씩 채워지므로 같은 지점도 처음 몇 번은 빈 곳으로 집힐 수 있다.
 * 일반 클릭은 선택을 교체하므로 여러 번 눌러도 결과가 같다.
 */
export const selectSingle = async (page: Page, point: PickPoint): Promise<string> => {
  await expect
    .poll(
      async () => {
        await clickViewerAt(page, point.ratioX, point.ratioY);
        return page.getByTestId('selection-globalid').textContent();
      },
      { timeout: 20_000 },
    )
    .toContain('GlobalId: ');

  return await page.getByTestId('selection-globalid').innerText();
};

/**
 * 화면 곳곳을 눌러 부재가 집히는 지점을 찾는다.
 *
 * 카메라는 열려 있는 모델 전체에 맞춰지므로 어느 지점에 무엇이 오는지 미리 못 박을 수 없다.
 * 형상 타일도 적재 직후 조금씩 채워지므로 같은 지점이 처음 몇 번은 빈 곳으로 집힌다.
 *
 * @param target 특정 GlobalId를 찾으려면 준다. 없으면 무엇이든 하나 집히면 된다.
 */
export const findPickPoint = async (
  page: Page,
  target?: string,
): Promise<readonly [number, number]> => {
  const candidates: readonly (readonly [number, number])[] = [
    [0.5, 0.5],
    [0.4, 0.65],
    [0.45, 0.6],
    [0.55, 0.45],
    [0.5, 0.7],
    [0.35, 0.55],
    [0.4, 0.5],
  ];
  const needle = target ?? 'GlobalId: ';

  let matchedIndex = -1;
  let cursor = 0;

  await expect
    .poll(
      async () => {
        const index = cursor % candidates.length;
        const point = candidates[index];
        cursor += 1;
        if (point === undefined) return '';

        await clickViewerAt(page, point[0], point[1]);
        const label = (await page.getByTestId('selection-globalid').textContent()) ?? '';
        if (label.includes(needle)) matchedIndex = index;
        return label;
      },
      { timeout: 30_000 },
    )
    .toContain(needle);

  const matched = candidates[matchedIndex];
  if (matched === undefined) throw new Error(`집히는 지점을 찾지 못했다: ${needle}`);
  return matched;
};
