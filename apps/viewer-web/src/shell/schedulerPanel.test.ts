// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleCsvBundle, ScheduleCsvFile } from '@bim4d/domain';
import type { TaskId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import type { ScheduleTaskRow, ScheduleWarningRow } from '../scheduler/schedulerEvents.js';

import { createSchedulerPanel } from './schedulerPanel.js';

const markup = `
  <input type="file" data-testid="schedule-file" multiple />
  <aside data-testid="schedule-panel" hidden>
    <p data-testid="schedule-name"></p>
    <ol data-testid="task-list"></ol>
    <ul data-testid="schedule-warnings"></ul>
  </aside>
  <button type="button" data-testid="schedule-export-json"></button>
  <button type="button" data-testid="schedule-export-csv"></button>
  <p data-testid="schedule-status"></p>
`;

const element = (testId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`요소 없음: ${testId}`);
  return found;
};

const textsOf = (testId: string): string[] =>
  [...document.querySelectorAll(`[data-testid="${testId}"]`)].map((node) => node.textContent);

/** 내보낸 파일을 화면 대신 여기로 받는다. 브라우저 다운로드는 jsdom에 없다. */
let saved: ScheduleCsvFile[] = [];

const startPanel = async (context: TestContext) => {
  const panel = createSchedulerPanel({
    fileInputSelector: '[data-testid="schedule-file"]',
    panelSelector: '[data-testid="schedule-panel"]',
    nameSelector: '[data-testid="schedule-name"]',
    taskListSelector: '[data-testid="task-list"]',
    warningListSelector: '[data-testid="schedule-warnings"]',
    statusSelector: '[data-testid="schedule-status"]',
    exportJsonSelector: '[data-testid="schedule-export-json"]',
    exportCsvSelector: '[data-testid="schedule-export-csv"]',
    saveFile: (file) => saved.push(file),
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
  assignedCount: 1,
  start: Date.UTC(2026, 2, 2),
  finish: Date.UTC(2026, 2, 6),
  ...overrides,
});

const publishSchedule = (
  context: TestContext,
  tasks: readonly ScheduleTaskRow[],
  warnings: readonly ScheduleWarningRow[] = [],
): Promise<void> =>
  context.events.publish('scheduler/schedule-changed', {
    scheduleId: 's1',
    name: '시험 일정',
    start: Date.UTC(2026, 2, 2),
    finish: Date.UTC(2026, 2, 13),
    tasks,
    warnings,
  });

const file = (name: string, content: string): File => new File([content], name);

/** 파일 읽기와 명령 전달이 끝날 때까지 대기열을 비운다. */
const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** jsdom에는 DataTransfer가 없다. files를 직접 심고 change를 쏜다. */
const chooseFiles = async (files: readonly File[]): Promise<void> => {
  const input = element('schedule-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
};

describe('createSchedulerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    saved = [];
  });

  it('일정이 없으면 목록을 감춰 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(element('schedule-panel').hidden).toBe(true);
  });

  it('일정을 실으면 이름과 Task 줄을 그린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    expect(element('schedule-panel').hidden).toBe(false);
    expect(element('schedule-name').textContent).toBe('시험 일정');
    expect(textsOf('task-name')).toEqual(['W1', 'T001']);
  });

  it('깊이를 들여쓰기로 나타낸다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [row('W1', { isSummary: true }), row('T001', { depth: 2 })]);

    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')];
    expect(rows.map((node) => node.dataset['depth'])).toEqual(['0', '2']);
  });

  it('요약 Task를 표시로 구분한다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')];
    expect(rows.map((node) => node.dataset['summary'])).toEqual(['true', 'false']);
  });

  it('기간을 날짜 구간으로 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [row('T001')]);

    expect(textsOf('task-dates')).toEqual(['2026-03-02 ~ 2026-03-06']);
  });

  it('시간이 정해지지 않은 Task는 기간 자리를 비운다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [
      { taskId: 'T001' as TaskId, name: 'T001', depth: 0, isSummary: false, assignedCount: 0 },
    ]);

    expect(textsOf('task-dates')).toEqual(['일정 미정']);
  });

  it('연결된 부재 수를 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [row('T001', { assignedCount: 3 })]);

    expect(textsOf('task-assigned')).toEqual(['부재 3']);
  });

  it('경고를 목록으로 보여 준다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(
      context,
      [row('T001')],
      [{ code: 'schedule.warn.task-without-time', message: '시간이 정해지지 않았다: T002' }],
    );

    expect(textsOf('schedule-warning')).toEqual(['시간이 정해지지 않았다: T002']);
  });

  it('경고가 없으면 목록을 비운다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishSchedule(context, [row('T001')], [{ code: 'x', message: '경고' }]);

    await publishSchedule(context, [row('T001')]);

    expect(textsOf('schedule-warning')).toEqual([]);
  });

  it('파일을 고르면 load-schedule Command를 보낸다', async () => {
    const context = createTestContext();
    const handler = vi.fn((input: { source: unknown }) => {
      void input;
      return Promise.resolve({ scheduleId: 's1', taskCount: 1 });
    });
    context.commands.register('scheduler/load-schedule', handler);
    await startPanel(context);

    const input = element('schedule-file');
    const file = new File(['{"scheduleId":"s1"}'], 'a.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler.mock.calls[0]?.[0]).toEqual({ source: { scheduleId: 's1' } });
  });

  it('읽을 수 없는 JSON은 Command를 보내지 않고 이유를 표시한다', async () => {
    const context = createTestContext();
    const handler = vi.fn(() => Promise.resolve({ scheduleId: 's1', taskCount: 1 }));
    context.commands.register('scheduler/load-schedule', handler);
    await startPanel(context);

    const input = element('schedule-file');
    Object.defineProperty(input, 'files', {
      value: [new File(['{ 망가진'], 'broken.json')],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(element('schedule-status').textContent).toContain('일정 열기 실패');
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('적재 실패 Event의 이유를 표시한다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await context.events.publish('scheduler/load-failed', {
      reason: '읽을 수 있는 schemaVersion은 1, 2뿐이다: 99',
      code: 'schedule.parse.unsupported-version',
    });

    expect(element('schedule-status').textContent).toContain('일정 열기 실패');
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await publishSchedule(context, [row('T001')]);

    expect(textsOf('task-name')).toEqual([]);
    expect(element('schedule-panel').hidden).toBe(true);
  });

  it('CSV 파일 넷을 고르면 묶음으로 명령에 넘긴다', async () => {
    const context = createTestContext();
    const received: ScheduleCsvBundle[] = [];
    context.commands.register('scheduler/load-schedule-csv', ({ bundle }) => {
      received.push(bundle);
      return Promise.resolve({ scheduleId: 'mock', taskCount: 1 });
    });
    await startPanel(context);

    await chooseFiles([
      file('tasks.csv', 'T'),
      file('schedule.csv', 'S'),
      file('assignments.csv', 'A'),
      file('dependencies.csv', 'D'),
    ]);

    // 이름으로 역할을 가른다. 고른 순서는 상관없다.
    expect(received[0]).toEqual({ schedule: 'S', tasks: 'T', assignments: 'A', dependencies: 'D' });
  });

  it('dependencies.csv가 없어도 묶음을 만든다', async () => {
    const context = createTestContext();
    const received: ScheduleCsvBundle[] = [];
    context.commands.register('scheduler/load-schedule-csv', ({ bundle }) => {
      received.push(bundle);
      return Promise.resolve({ scheduleId: 'mock', taskCount: 1 });
    });
    await startPanel(context);

    await chooseFiles([
      file('schedule.csv', 'S'),
      file('tasks.csv', 'T'),
      file('assignments.csv', 'A'),
    ]);

    // 선후행이 없는 일정이 정상이므로 필드를 만들지 않고 넘긴다.
    expect(received[0]).toEqual({ schedule: 'S', tasks: 'T', assignments: 'A' });
  });

  it('모르는 이름의 CSV는 조용히 버리지 않고 알린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await chooseFiles([file('일정.csv', 'S')]);

    expect(element('schedule-status').textContent).toContain('일정.csv');
  });

  it('CSV 묶음에 필수 파일이 빠지면 알린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await chooseFiles([file('schedule.csv', 'S'), file('tasks.csv', 'T')]);

    expect(element('schedule-status').textContent).toContain('assignments.csv가 없다');
  });

  it('JSON 한 파일은 JSON 경로로 보낸다', async () => {
    const context = createTestContext();
    const received: unknown[] = [];
    context.commands.register('scheduler/load-schedule', ({ source }) => {
      received.push(source);
      return Promise.resolve({ scheduleId: 'mock', taskCount: 1 });
    });
    await startPanel(context);

    await chooseFiles([file('schedule.json', '{"scheduleId":"mock"}')]);

    expect(received[0]).toEqual({ scheduleId: 'mock' });
  });

  it('JSON으로 읽히지 않는 파일은 명령을 보내지 않고 알린다', async () => {
    const context = createTestContext();
    const received: unknown[] = [];
    context.commands.register('scheduler/load-schedule', ({ source }) => {
      received.push(source);
      return Promise.resolve({ scheduleId: 'mock', taskCount: 1 });
    });
    await startPanel(context);

    await chooseFiles([file('schedule.json', '{ 깨진')]);

    expect(received).toEqual([]);
    expect(element('schedule-status').textContent).toContain('일정 열기 실패');
  });

  it('CSV 내보내기는 받은 파일을 모두 저장한다', async () => {
    const context = createTestContext();
    context.commands.register('scheduler/export-schedule', ({ format }) =>
      Promise.resolve({
        files:
          format === 'csv'
            ? [
                { fileName: 'schedule.csv', content: 'S' },
                { fileName: 'tasks.csv', content: 'T' },
                { fileName: 'dependencies.csv', content: 'D' },
                { fileName: 'assignments.csv', content: 'A' },
              ]
            : [{ fileName: 'schedule.json', content: '{}' }],
      }),
    );
    await startPanel(context);

    element('schedule-export-csv').click();
    await flush();

    expect(saved.map((file) => file.fileName)).toEqual([
      'schedule.csv',
      'tasks.csv',
      'dependencies.csv',
      'assignments.csv',
    ]);
    expect(element('schedule-status').textContent).toContain('4개');
  });

  it('JSON 내보내기는 파일 하나를 저장한다', async () => {
    const context = createTestContext();
    context.commands.register('scheduler/export-schedule', () =>
      Promise.resolve({ files: [{ fileName: 'schedule.json', content: '{}' }] }),
    );
    await startPanel(context);

    element('schedule-export-json').click();
    await flush();

    expect(saved.map((file) => file.fileName)).toEqual(['schedule.json']);
  });

  it('내보낼 일정이 없으면 이유를 보여 주고 아무것도 저장하지 않는다', async () => {
    const context = createTestContext();
    context.commands.register('scheduler/export-schedule', () =>
      Promise.reject(new Error('열려 있는 일정이 없다.')),
    );
    await startPanel(context);

    element('schedule-export-csv').click();
    await flush();

    expect(saved).toEqual([]);
    expect(element('schedule-status').textContent).toContain('내보내기 실패');
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createSchedulerPanel({
      fileInputSelector: '[data-testid="schedule-file"]',
      panelSelector: '[data-testid="schedule-panel"]',
      nameSelector: '[data-testid="schedule-name"]',
      taskListSelector: '[data-testid="task-list"]',
      warningListSelector: '[data-testid="schedule-warnings"]',
      statusSelector: '[data-testid="schedule-status"]',
      exportJsonSelector: '[data-testid="schedule-export-json"]',
      exportCsvSelector: '[data-testid="schedule-export-csv"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/schedule-file/u);
  });
});
