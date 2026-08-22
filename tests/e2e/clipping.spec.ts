import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { findPickPoint } from './support/picking.js';

const fixture = fileURLToPath(
  new URL('../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

const openFixture = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('model-file').setInputFiles(fixture);
  await expect(page.getByTestId('model-status')).toHaveText('모델 1개', { timeout: 60_000 });
};

test.describe('단면', () => {
  test('모델이 없으면 단면 버튼을 잠가 둔다', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('clip-z')).toBeDisabled();
    await expect(page.getByTestId('clip-clear')).toBeDisabled();
  });

  test('평면을 추가하면 개수를 표시한다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await openFixture(page);
    await expect(page.getByTestId('clip-z')).toBeEnabled();

    await page.getByTestId('clip-z').click();
    await expect(page.getByTestId('clipping-status')).toHaveText('단면 1개');

    await page.getByTestId('clip-x').click();
    await expect(page.getByTestId('clipping-status')).toHaveText('단면 2개');
    expect(consoleErrors).toEqual([]);
  });

  test('전체 해제하면 단면이 사라진다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('clip-z').click();
    await expect(page.getByTestId('clip-clear')).toBeEnabled();

    await page.getByTestId('clip-clear').click();

    await expect(page.getByTestId('clipping-status')).toHaveText('');
    await expect(page.getByTestId('clip-clear')).toBeDisabled();
  });

  test('단면이 켜진 상태에서도 선택과 숨김이 동작한다', async ({ page }) => {
    // Phase 3 완료 기준. 단면·선택·가시성이 같은 표현 통로를 건드리므로 함께 확인한다.
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await openFixture(page);
    await page.getByTestId('clip-y').click();
    await expect(page.getByTestId('clipping-status')).toHaveText('단면 1개');

    await findPickPoint(page);
    await expect(page.getByTestId('hide-selected')).toBeEnabled();

    await page.getByTestId('hide-selected').click();

    await expect(page.getByTestId('visibility-status')).toHaveText('1개 숨김');
    await expect(page.getByTestId('clipping-status')).toHaveText('단면 1개');
    expect(consoleErrors).toEqual([]);
  });

  test('모델을 해제하면 단면도 함께 정리된다', async ({ page }) => {
    await openFixture(page);
    await page.getByTestId('clip-z').click();
    await expect(page.getByTestId('clipping-status')).toHaveText('단면 1개');

    await page.getByTestId('model-unload').click();

    await expect(page.getByTestId('clipping-status')).toHaveText('');
    await expect(page.getByTestId('clip-z')).toBeDisabled();
  });
});

test.describe('카메라 조작', () => {
  test('모델이 없으면 시점 버튼을 잠가 둔다', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('view-fit')).toBeDisabled();
    await expect(page.getByTestId('view-top')).toBeDisabled();
  });

  test('표준 시점으로 옮긴 뒤에도 부재를 고를 수 있다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await openFixture(page);
    await expect(page.getByTestId('view-fit')).toBeEnabled();

    await page.getByTestId('view-top').click();
    await page.getByTestId('view-front').click();
    await page.getByTestId('view-iso').click();
    await page.getByTestId('view-fit').click();

    // 카메라가 실제로 모델을 향하고 있다면 부재가 계속 집힌다.
    await findPickPoint(page);
    expect(consoleErrors).toEqual([]);
  });
});
