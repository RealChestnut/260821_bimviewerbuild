// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../simulation/simulationEvents.js';

import { createSimulationPanel } from './simulationPanel.js';

const markup = `
  <input type="file" data-testid="schedule-file" />
  <input type="range" data-testid="simulation-time" disabled />
  <button type="button" data-testid="simulation-play" disabled>재생</button>
  <select data-testid="simulation-speed" disabled>
    <option value="1">1×</option>
    <option value="4">4×</option>
  </select>
  <p data-testid="simulation-date"></p>
  <p data-testid="simulation-status"></p>
`;

const START = Date.UTC(2026, 2, 2);
const FINISH = Date.UTC(2026, 3, 1);

const element = (testId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`요소 없음: ${testId}`);
  return found;
};

const inputAt = (testId: string): HTMLInputElement => {
  const found = element(testId);
  if (!(found instanceof HTMLInputElement)) throw new Error(`input이 아니다: ${testId}`);
  return found;
};

const slider = (): HTMLInputElement => inputAt('simulation-time');

const playButton = (): HTMLButtonElement => {
  const found = element('simulation-play');
  if (!(found instanceof HTMLButtonElement)) throw new Error('button이 아니다');
  return found;
};

const speedSelect = (): HTMLSelectElement => {
  const found = element('simulation-speed');
  if (!(found instanceof HTMLSelectElement)) throw new Error('select가 아니다');
  return found;
};

const text = (testId: string): string => element(testId).textContent;

const startPanel = async (context: TestContext) => {
  const panel = createSimulationPanel({
    fileInputSelector: '[data-testid="schedule-file"]',
    timeSliderSelector: '[data-testid="simulation-time"]',
    playButtonSelector: '[data-testid="simulation-play"]',
    speedSelectSelector: '[data-testid="simulation-speed"]',
    dateSelector: '[data-testid="simulation-date"]',
    statusSelector: '[data-testid="simulation-status"]',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const publishLoaded = (context: TestContext): Promise<void> =>
  context.events.publish('simulation/schedule-loaded', {
    scheduleId: 'mock',
    name: '시험 일정',
    taskCount: 4,
    assignedProductCount: 3,
    start: START,
    finish: FINISH,
  });

describe('createSimulationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('일정을 싣기 전에는 조작을 잠가 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(slider().disabled).toBe(true);
    expect(playButton().disabled).toBe(true);
    expect(speedSelect().disabled).toBe(true);
    expect(text('simulation-date')).toBe('일정 없음');
  });

  it('일정을 실으면 슬라이더 구간을 맞추고 조작을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishLoaded(context);

    expect(slider().min).toBe(String(START));
    expect(slider().max).toBe(String(FINISH));
    expect(slider().value).toBe(String(START));
    expect(slider().disabled).toBe(false);
    expect(playButton().disabled).toBe(false);
    expect(text('simulation-date')).toBe('2026-03-02');
  });

  it('시간이 바뀌면 슬라이더와 날짜를 함께 옮긴다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishLoaded(context);

    await context.events.publish('simulation/time-changed', { time: Date.UTC(2026, 2, 10) });

    expect(slider().value).toBe(String(Date.UTC(2026, 2, 10)));
    expect(text('simulation-date')).toBe('2026-03-10');
  });

  it('슬라이더를 움직이면 set-time Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { time: number }) => Promise.resolve({ time: input.time }));
    context.commands.register('simulation/set-time', handler);
    await startPanel(context);
    await publishLoaded(context);

    slider().value = String(Date.UTC(2026, 2, 15));
    slider().dispatchEvent(new Event('input'));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ time: Date.UTC(2026, 2, 15) });
  });

  it('재생 버튼은 상태에 따라 play와 pause를 번갈아 보낸다', async () => {
    const context = createTestContext();
    const play = vi.fn(() => Promise.resolve({ playing: true }));
    const pause = vi.fn(() => Promise.resolve({ playing: false }));
    context.commands.register('simulation/play', play);
    context.commands.register('simulation/pause', pause);
    await startPanel(context);
    await publishLoaded(context);

    playButton().click();
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });

    await context.events.publish('simulation/playback-changed', { playing: true, speed: 1 });
    expect(playButton().textContent).toBe('정지');

    playButton().click();
    await vi.waitFor(() => {
      expect(pause).toHaveBeenCalledTimes(1);
    });
  });

  it('배속을 고르면 set-speed Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { speed: number }) => Promise.resolve({ speed: input.speed }));
    context.commands.register('simulation/set-speed', handler);
    await startPanel(context);
    await publishLoaded(context);

    speedSelect().value = '4';
    speedSelect().dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ speed: 4 });
  });

  it('부재 상태 요약을 표시한다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishLoaded(context);

    await context.events.publish('simulation/states-changed', {
      time: START,
      changedCount: 2,
      hiddenCount: 2,
      inProgressCount: 1,
      presentCount: 0,
    });

    expect(text('simulation-status')).toBe('진행 1 · 표시 0 · 숨김 2');
  });

  it('일정 적재 실패는 이유를 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('simulation/schedule-load-failed', {
      reason: '읽을 수 있는 schemaVersion은 1뿐이다: 99',
      code: 'schedule.parse.unsupported-version',
    });

    expect(text('simulation-status')).toContain('일정 열기 실패');
    expect(slider().disabled).toBe(true);
  });

  it('JSON 파일을 고르면 load-schedule Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { source: unknown }) => {
      void input;
      return Promise.resolve({ scheduleId: 'mock', start: START, finish: FINISH });
    });
    context.commands.register('simulation/load-schedule', handler);
    await startPanel(context);

    const input = inputAt('schedule-file');
    const file = new File(['{"scheduleId":"mock"}'], 'mock.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ source: { scheduleId: 'mock' } });
  });

  it('읽을 수 없는 JSON은 Command를 보내지 않고 이유를 표시한다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() =>
      Promise.resolve({ scheduleId: 'mock', start: START, finish: FINISH }),
    );
    context.commands.register('simulation/load-schedule', handler);
    await startPanel(context);

    const input = inputAt('schedule-file');
    Object.defineProperty(input, 'files', {
      value: [new File(['{ 망가진'], 'broken.json')],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(text('simulation-status')).toContain('일정 열기 실패');
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    element('simulation-date').textContent = 'untouched';
    await publishLoaded(context);

    expect(text('simulation-date')).toBe('untouched');
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createSimulationPanel({
      fileInputSelector: '[data-testid="schedule-file"]',
      timeSliderSelector: '[data-testid="simulation-time"]',
      playButtonSelector: '[data-testid="simulation-play"]',
      speedSelectSelector: '[data-testid="simulation-speed"]',
      dateSelector: '[data-testid="simulation-date"]',
      statusSelector: '[data-testid="simulation-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/schedule-file/);
  });
});
