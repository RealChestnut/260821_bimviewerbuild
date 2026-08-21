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
