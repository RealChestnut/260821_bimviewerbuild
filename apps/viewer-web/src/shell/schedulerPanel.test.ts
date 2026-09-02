// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleCsvBundle, ScheduleCsvFile } from '@bim4d/domain';
import type { GlobalId, TaskId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import type { ScheduleTaskRow, ScheduleWarningRow } from '../scheduler/schedulerEvents.js';

import { createSchedulerPanel } from './schedulerPanel.js';

const markup = `
  <input type="file" data-testid="schedule-file" multiple />
  <aside data-testid="schedule-panel" hidden>
    <p data-testid="schedule-name"></p>
    <ul data-testid="model-replacements"></ul>
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
    warningListSelector: '[data-testid="schedule-warnings"]',
    replacementListSelector: '[data-testid="model-replacements"]',
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
    dependencies: [],
    assignments: [],
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

  it('일정을 실으면 이름을 적고 영역을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publishSchedule(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    expect(element('schedule-panel').hidden).toBe(false);
    expect(element('schedule-name').textContent).toBe('시험 일정');
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

    // dispose 뒤에는 이름조차 쓰지 않는다. 처음 상태 그대로다.
    expect(element('schedule-name').textContent).toBe('');
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
      warningListSelector: '[data-testid="schedule-warnings"]',
      replacementListSelector: '[data-testid="model-replacements"]',
      statusSelector: '[data-testid="schedule-status"]',
      exportJsonSelector: '[data-testid="schedule-export-json"]',
      exportCsvSelector: '[data-testid="schedule-export-csv"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/schedule-file/u);
  });
});

const all = (testId: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];

describe('createSchedulerPanel — 모델 교체', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  const announce = async (context: TestContext, replacedRefs: readonly string[]): Promise<void> => {
    await context.events.publish('scheduler/model-binding-changed', {
      boundCount: replacedRefs.length,
      replacedRefs,
    });
  };

  /** 교체 명령을 가로채 사라진 부재를 정한다. */
  const captureAdopt = (
    context: TestContext,
    missing: readonly string[] = [],
  ): { modelRef: string }[] => {
    const seen: { modelRef: string }[] = [];
    context.commands.register('scheduler/adopt-model', (input) => {
      seen.push({ modelRef: input.modelRef });
      return Promise.resolve({ missing: missing as readonly GlobalId[] });
    });
    return seen;
  };

  it('파일 내용이 달라진 모델을 알린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await announce(context, ['a.ifc']);

    expect(all('model-replaced')).toHaveLength(1);
    expect(element('model-replaced').dataset['modelRef']).toBe('a.ifc');
  });

  it('교체가 없으면 알림을 걷는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await announce(context, ['a.ifc']);

    await announce(context, []);

    expect(all('model-replaced')).toHaveLength(0);
  });

  it('승인하면 그 이름으로 교체 명령을 보낸다', async () => {
    const context = createTestContext();
    const adopted = captureAdopt(context);
    await startPanel(context);
    await announce(context, ['a.ifc']);

    element('model-adopt').click();
    await flush();

    expect(adopted).toEqual([{ modelRef: 'a.ifc' }]);
  });

  it('새 모델에 없는 부재 수를 알린다', async () => {
    const context = createTestContext();
    captureAdopt(context, ['0BnKdW4tq7SfUcM3vHxZgR', '1MjTgR8dp5NkXbC2wFyQsA']);
    await startPanel(context);
    await announce(context, ['a.ifc']);

    element('model-adopt').click();
    await flush();

    // 연결은 지우지 않는다. 무엇을 잃을지 알려 주고 결정은 사용자가 한다 (ADR-0008).
    expect(element('schedule-status').textContent).toContain('2개');
  });

  it('사라진 부재가 없으면 없다고 알린다', async () => {
    const context = createTestContext();
    captureAdopt(context);
    await startPanel(context);
    await announce(context, ['a.ifc']);

    element('model-adopt').click();
    await flush();

    expect(element('schedule-status').textContent).toContain('사라진 부재는 없다');
  });

  it('교체가 실패하면 이유를 적는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await announce(context, ['a.ifc']);

    element('model-adopt').click();
    await flush();

    // 명령이 등록되지 않은 상태다. 조용히 넘어가지 않는다.
    expect(element('schedule-status').textContent).toContain('모델 교체 실패');
  });
});
