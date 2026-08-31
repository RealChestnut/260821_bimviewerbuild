// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { TaskId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import '../simulation/simulationEvents.js';
import type { ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

import { createGanttPanel } from './ganttPanel.js';

const markup = `
  <section data-testid="gantt" hidden>
    <div data-testid="gantt-axis"></div>
    <ol data-testid="gantt-rows"></ol>
    <div data-testid="gantt-cursor" hidden></div>
    <p data-testid="gantt-status"></p>
  </section>
`;

const element = (testId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`요소 없음: ${testId}`);
  return found;
};

const all = (testId: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];

const startPanel = async (context: TestContext) => {
  const panel = createGanttPanel({
    panelSelector: '[data-testid="gantt"]',
    axisSelector: '[data-testid="gantt-axis"]',
    rowListSelector: '[data-testid="gantt-rows"]',
    cursorSelector: '[data-testid="gantt-cursor"]',
    statusSelector: '[data-testid="gantt-status"]',
    labelWidth: '10rem',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const row = (taskId: string, overrides: Partial<ScheduleTaskRow> = {}): ScheduleTaskRow => ({
  taskId: taskId as TaskId,
  name: taskId,
  depth: 0,
  isSummary: false,
  assignedCount: 0,
  start: Date.UTC(2026, 2, 2),
  finish: Date.UTC(2026, 2, 6),
  ...overrides,
});

/** 3월 2일부터 3월 31일까지. 오른쪽 끝은 4월 1일이므로 폭이 30일이다. */
const publish = async (
  context: TestContext,
  tasks: readonly ScheduleTaskRow[],
  bounds: { start?: number; finish?: number } = {
    start: Date.UTC(2026, 2, 2),
    finish: Date.UTC(2026, 2, 31),
  },
): Promise<void> => {
  await context.events.publish('scheduler/schedule-changed', {
    scheduleId: 's1',
    name: '시험 일정',
    ...(bounds.start === undefined ? {} : { start: bounds.start }),
    ...(bounds.finish === undefined ? {} : { finish: bounds.finish }),
    tasks,
    dependencies: [],
    warnings: [],
  });
};

/** `left: 12.3456%` 같은 값에서 숫자만 꺼낸다. */
const ratioOf = (value: string): number => Number.parseFloat(value.replace('%', ''));

describe('createGanttPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('일정이 없으면 감춰 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(element('gantt').hidden).toBe(true);
  });

  it('일정이 실리면 Task마다 한 줄을 그린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    expect(element('gantt').hidden).toBe(false);
    expect(all('gantt-row').map((node) => node.dataset['taskId'])).toEqual(['W1', 'T001']);
  });

  it('목록과 같은 순서와 깊이로 그린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [
      row('W1', { isSummary: true }),
      row('T001', { depth: 1 }),
      row('T002', { depth: 2 }),
    ]);

    expect(all('gantt-row').map((node) => node.dataset['depth'])).toEqual(['0', '1', '2']);
  });

  it('막대를 기간 안의 자리에 놓는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    // 3월 2일부터 30일 폭. 3월 2일에 시작하는 5일짜리 Task다.
    await publish(context, [row('T001')]);

    const bar = element('gantt-bar');
    expect(ratioOf(bar.style.left)).toBeCloseTo(0, 4);
    // 3월 2일 ~ 3월 6일은 그날을 포함해 5일이다. 30일 중 5일이므로 1/6이다.
    expect(ratioOf(bar.style.width)).toBeCloseTo(100 / 6, 3);
  });

  it('하루짜리 Task도 폭을 가진다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [
      row('T001', { start: Date.UTC(2026, 2, 2), finish: Date.UTC(2026, 2, 2) }),
    ]);

    // finish는 그날까지 포함한다. 폭이 0이면 막대가 보이지 않는다.
    expect(ratioOf(element('gantt-bar').style.width)).toBeCloseTo(100 / 30, 3);
  });

  it('기간 뒤쪽 Task는 오른쪽에 놓는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [
      row('T001'),
      row('T002', { start: Date.UTC(2026, 2, 23), finish: Date.UTC(2026, 2, 27) }),
    ]);

    const [first, second] = all('gantt-bar');
    expect(ratioOf(second?.style.left ?? '0%')).toBeGreaterThan(ratioOf(first?.style.left ?? '0%'));
    expect(ratioOf(second?.style.left ?? '0%')).toBeCloseTo((21 / 30) * 100, 3);
  });

  it('시간이 정해지지 않은 Task는 막대를 그리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [
      row('T001'),
      { taskId: 'T002' as TaskId, name: 'T002', depth: 0, isSummary: false, assignedCount: 0 },
    ]);

    expect(all('gantt-bar')).toHaveLength(1);
    expect(all('gantt-row').map((node) => node.dataset['timed'])).toEqual(['true', 'false']);
  });

  it('요약 Task의 막대를 따로 표시한다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    expect(all('gantt-bar').map((node) => node.dataset['summary'])).toEqual(['true', 'false']);
  });

  it('축에 기간과 달 눈금을 적는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('T001')], {
      start: Date.UTC(2026, 2, 2),
      finish: Date.UTC(2026, 4, 10),
    });

    // 끝 날짜는 실제 완료일이다. 하루를 더한 것은 그림의 사정이다.
    expect(element('gantt-range').textContent).toBe('2026-03-02 ~ 2026-05-10');
    expect(all('gantt-tick').map((node) => node.textContent)).toEqual(['2026-04', '2026-05']);
  });

  it('기간이 정해진 Task가 없으면 이유를 적고 막대를 그리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(
      context,
      [{ taskId: 'T001' as TaskId, name: 'T001', depth: 0, isSummary: false, assignedCount: 0 }],
      {},
    );

    expect(all('gantt-row')).toHaveLength(0);
    expect(element('gantt-status').textContent).toContain('기간이 정해진 Task가 없다');
  });
});

describe('createGanttPanel — 시뮬레이션 커서', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('일정만 실렸을 때는 커서를 감춘다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('T001')]);

    expect(element('gantt-cursor').hidden).toBe(true);
  });

  it('시뮬레이션 시각을 받으면 커서를 그 자리에 놓는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    await context.events.publish('simulation/time-changed', { time: Date.UTC(2026, 2, 17) });

    const cursor = element('gantt-cursor');
    expect(cursor.hidden).toBe(false);
    expect(cursor.dataset['time']).toBe('2026-03-17');
    // 이름 칸을 뺀 나머지 폭에서 비율을 잡는다. 3월 2일부터 15일째이므로 30일 중 0.5다.
    expect(cursor.dataset['ratio']).toBe('0.500000');
    expect(cursor.style.left).toContain('10rem');
  });

  it('기간을 넘는 시각은 끝에 붙인다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    await context.events.publish('simulation/time-changed', { time: Date.UTC(2026, 11, 31) });

    expect(element('gantt-cursor').dataset['ratio']).toBe('1.000000');
  });

  it('새 일정을 실으면 커서를 다시 감춘다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);
    await context.events.publish('simulation/time-changed', { time: Date.UTC(2026, 2, 17) });

    await publish(context, [row('T001')]);

    expect(element('gantt-cursor').hidden).toBe(true);
  });
});

describe('createGanttPanel — 정리', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await publish(context, [row('T001')]);

    expect(element('gantt').hidden).toBe(true);
    expect(all('gantt-row')).toHaveLength(0);
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createGanttPanel({
      panelSelector: '[data-testid="gantt"]',
      axisSelector: '[data-testid="gantt-axis"]',
      rowListSelector: '[data-testid="gantt-rows"]',
      cursorSelector: '[data-testid="gantt-cursor"]',
      statusSelector: '[data-testid="gantt-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/gantt/u);
  });
});
