// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { ScheduleEdit } from '@bim4d/domain';
import type { TaskId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import type { ScheduleDependencyRow, ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

import { createScheduleEditorPanel } from './scheduleEditorPanel.js';

const markup = `
  <ol data-testid="task-list"></ol>
  <section data-testid="schedule-editor" hidden>
    <input data-testid="task-form-id" />
    <input data-testid="task-form-name" />
    <select data-testid="task-form-parent"></select>
    <input type="date" data-testid="task-form-start" />
    <input type="date" data-testid="task-form-finish" />
    <button type="button" data-testid="task-add"></button>
    <button type="button" data-testid="task-save" disabled></button>
    <button type="button" data-testid="task-remove" disabled></button>
    <button type="button" data-testid="task-raise"></button>
    <select data-testid="dependency-predecessor"></select>
    <select data-testid="dependency-successor"></select>
    <select data-testid="dependency-type"></select>
    <input type="number" data-testid="dependency-lag" />
    <button type="button" data-testid="dependency-add"></button>
    <ul data-testid="dependency-list"></ul>
    <p data-testid="editor-status"></p>
  </section>
`;

const element = (testId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`요소 없음: ${testId}`);
  return found;
};

const input = (testId: string): HTMLInputElement => element(testId) as HTMLInputElement;
const select = (testId: string): HTMLSelectElement => element(testId) as HTMLSelectElement;

/** 편집 명령이 실제로 무엇을 받았는지 본다. 검증은 도메인의 몫이라 여기서는 받기만 한다. */
let received: ScheduleEdit[][] = [];
let rejectWith: string | null = null;

const startPanel = async (context: TestContext) => {
  context.commands.register('scheduler/edit-schedule', ({ edits }) => {
    if (rejectWith !== null) return Promise.reject(new Error(rejectWith));
    received.push([...edits]);
    return Promise.resolve({ taskCount: 1 });
  });

  const panel = createScheduleEditorPanel({
    panelSelector: '[data-testid="schedule-editor"]',
    taskListSelector: '[data-testid="task-list"]',
    taskIdSelector: '[data-testid="task-form-id"]',
    taskNameSelector: '[data-testid="task-form-name"]',
    taskParentSelector: '[data-testid="task-form-parent"]',
    taskStartSelector: '[data-testid="task-form-start"]',
    taskFinishSelector: '[data-testid="task-form-finish"]',
    taskAddSelector: '[data-testid="task-add"]',
    taskSaveSelector: '[data-testid="task-save"]',
    taskRemoveSelector: '[data-testid="task-remove"]',
    taskRaiseSelector: '[data-testid="task-raise"]',
    dependencyListSelector: '[data-testid="dependency-list"]',
    dependencyPredecessorSelector: '[data-testid="dependency-predecessor"]',
    dependencySuccessorSelector: '[data-testid="dependency-successor"]',
    dependencyTypeSelector: '[data-testid="dependency-type"]',
    dependencyLagSelector: '[data-testid="dependency-lag"]',
    dependencyAddSelector: '[data-testid="dependency-add"]',
    statusSelector: '[data-testid="editor-status"]',
  });
  await panel.initialize(context);
  await panel.start();
  return panel;
};

const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

/** `schedulerPanel`이 그리는 줄을 흉내 낸다. 편집 패널은 이 줄을 눌러 대상을 고른다. */
const drawTaskRows = (tasks: readonly ScheduleTaskRow[]): void => {
  element('task-list').replaceChildren(
    ...tasks.map((task) => {
      const item = document.createElement('li');
      item.dataset['testid'] = 'task-row';
      item.dataset['taskId'] = task.taskId;
      item.textContent = task.name;
      return item;
    }),
  );
};

const publish = async (
  context: TestContext,
  tasks: readonly ScheduleTaskRow[],
  dependencies: readonly ScheduleDependencyRow[] = [],
): Promise<void> => {
  drawTaskRows(tasks);
  await context.events.publish('scheduler/schedule-changed', {
    scheduleId: 's1',
    name: '시험 일정',
    tasks,
    dependencies,
    warnings: [],
  });
};

const clickRow = (taskId: string): void => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')].find(
    (node) => node.dataset['taskId'] === taskId,
  );
  if (found === undefined) throw new Error(`줄 없음: ${taskId}`);
  found.click();
};

describe('createScheduleEditorPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    received = [];
    rejectWith = null;
  });

  it('일정이 없으면 편집 영역을 감춰 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(element('schedule-editor').hidden).toBe(true);
  });

  it('일정이 실리면 편집 영역을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('T001')]);

    expect(element('schedule-editor').hidden).toBe(false);
  });

  it('선후행 유형은 ADR-0006의 네 값만 고를 수 있다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect([...select('dependency-type').options].map((option) => option.value)).toEqual([
      'FINISH_START',
      'START_START',
      'FINISH_FINISH',
      'START_FINISH',
    ]);
  });

  it('상위 Task 목록에 지금 있는 Task를 채운다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    // 첫 항목은 "최상위"를 뜻하는 빈 값이다.
    expect([...select('task-form-parent').options].map((option) => option.value)).toEqual([
      '',
      'W1',
      'T001',
    ]);
  });
});

describe('createScheduleEditorPanel — Task 추가', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    received = [];
    rejectWith = null;
  });

  it('입력한 값으로 add-task를 보낸다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('W1', { isSummary: true })]);

    input('task-form-id').value = 'T001';
    input('task-form-name').value = '슬래브';
    select('task-form-parent').value = 'W1';
    input('task-form-start').value = '2026-03-02';
    input('task-form-finish').value = '2026-03-06';
    element('task-add').click();
    await flush();

    expect(received[0]).toEqual([
      {
        kind: 'add-task',
        taskId: 'T001',
        name: '슬래브',
        parentTaskId: 'W1',
        start: '2026-03-02',
        finish: '2026-03-06',
      },
    ]);
  });

  it('빈 칸은 필드를 만들지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, []);

    input('task-form-id').value = 'T001';
    input('task-form-name').value = '슬래브';
    element('task-add').click();
    await flush();

    expect(received[0]).toEqual([{ kind: 'add-task', taskId: 'T001', name: '슬래브' }]);
  });

  it('ID나 이름이 비면 명령을 보내지 않고 알린다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, []);

    input('task-form-id').value = '';
    input('task-form-name').value = '슬래브';
    element('task-add').click();
    await flush();

    expect(received).toEqual([]);
    expect(element('editor-status').textContent).toContain('Task ID와 이름');
  });
});

describe('createScheduleEditorPanel — Task 고르기와 수정', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    received = [];
    rejectWith = null;
  });

  it('줄을 누르면 그 Task를 편집 칸에 옮긴다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001', { name: '슬래브' })]);

    clickRow('T001');

    expect(input('task-form-id').value).toBe('T001');
    expect(input('task-form-name').value).toBe('슬래브');
    expect(input('task-form-start').value).toBe('2026-03-02');
  });

  it('고르면 추가는 막고 저장과 지우기를 연다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    clickRow('T001');

    expect((element('task-add') as HTMLButtonElement).disabled).toBe(true);
    expect((element('task-save') as HTMLButtonElement).disabled).toBe(false);
    expect((element('task-remove') as HTMLButtonElement).disabled).toBe(false);
  });

  it('고른 줄을 다시 누르면 선택을 푼다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    clickRow('T001');
    clickRow('T001');

    expect(input('task-form-id').value).toBe('');
    expect((element('task-add') as HTMLButtonElement).disabled).toBe(false);
  });

  it('taskId는 고른 뒤 고칠 수 없다', async () => {
    // taskId는 부재 연결과 선후행의 키다. 바꾸면 연결이 끊긴다.
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    clickRow('T001');

    expect(input('task-form-id').disabled).toBe(true);
  });

  it('요약 Task를 고르면 시간 칸을 잠근다', async () => {
    // 요약 Task의 시간은 자손에서 계산한다 (ADR-0006).
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('W1', { isSummary: true })]);

    clickRow('W1');

    expect(input('task-form-start').disabled).toBe(true);
    expect(input('task-form-finish').disabled).toBe(true);
  });

  it('저장은 고친 값으로 update-task를 보낸다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    clickRow('T001');
    input('task-form-name').value = '슬래브 타설';
    input('task-form-finish').value = '2026-03-10';
    element('task-save').click();
    await flush();

    expect(received[0]).toEqual([
      {
        kind: 'update-task',
        taskId: 'T001',
        name: '슬래브 타설',
        start: '2026-03-02',
        finish: '2026-03-10',
      },
    ]);
  });

  it('시간 칸을 비우면 null로 보내 값을 지운다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    clickRow('T001');
    input('task-form-start').value = '';
    input('task-form-finish').value = '';
    element('task-save').click();
    await flush();

    expect(received[0]?.[0]).toMatchObject({ start: null, finish: null });
  });

  it('요약 Task를 저장할 때는 시간을 보내지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('W1', { isSummary: true })]);

    clickRow('W1');
    input('task-form-name').value = '1층 골조';
    element('task-save').click();
    await flush();

    expect(received[0]).toEqual([{ kind: 'update-task', taskId: 'W1', name: '1층 골조' }]);
  });

  it('최상위로는 parentTaskId를 null로 보낸다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    clickRow('T001');
    element('task-raise').click();
    await flush();

    expect(received[0]).toEqual([{ kind: 'update-task', taskId: 'T001', parentTaskId: null }]);
  });

  it('지우기는 remove-task를 보내고 함께 지운 부재 연결을 알린다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001', { assignedCount: 2 })]);

    clickRow('T001');
    element('task-remove').click();
    await flush();

    expect(received[0]).toEqual([{ kind: 'remove-task', taskId: 'T001' }]);
    expect(element('editor-status').textContent).toContain('부재 연결 2개');
  });

  it('편집 실패 Event의 이유를 그대로 보여 준다', async () => {
    // 실패 이유는 도메인이 만든다. 화면은 옮겨 적기만 한다.
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    await context.events.publish('scheduler/edit-failed', {
      reason: '자식이 있는 Task는 지울 수 없다: W1',
      code: 'schedule.edit.task-has-children',
    });

    expect(element('editor-status').textContent).toContain('자식이 있는 Task');
  });

  it('명령이 실패하면 성공한 척하지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001', { assignedCount: 2 })]);
    rejectWith = '열려 있는 일정이 없다.';

    clickRow('T001');
    element('task-remove').click();
    await flush();

    // 지운 뒤에만 나오는 안내가 나오면 안 된다.
    expect(element('editor-status').textContent).toContain('편집 실패');
    expect(element('editor-status').textContent).not.toContain('부재 연결 2개');
  });

  it('고르던 Task가 사라지면 선택을 푼다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);
    clickRow('T001');

    await publish(context, [row('T002')]);

    expect(input('task-form-id').value).toBe('');
  });
});

describe('createScheduleEditorPanel — 선후행', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    received = [];
    rejectWith = null;
  });

  it('고른 값으로 add-dependency를 보낸다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001'), row('T002')]);

    select('dependency-predecessor').value = 'T001';
    select('dependency-successor').value = 'T002';
    select('dependency-type').value = 'START_START';
    input('dependency-lag').value = '3';
    element('dependency-add').click();
    await flush();

    expect(received[0]).toEqual([
      {
        kind: 'add-dependency',
        predecessorId: 'T001',
        successorId: 'T002',
        type: 'START_START',
        lagDays: 3,
      },
    ]);
  });

  it('지연 칸이 비면 0으로 보낸다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001'), row('T002')]);

    select('dependency-predecessor').value = 'T001';
    select('dependency-successor').value = 'T002';
    select('dependency-type').value = 'FINISH_START';
    element('dependency-add').click();
    await flush();

    expect(received[0]?.[0]).toMatchObject({ lagDays: 0 });
  });

  it('Task를 고르지 않으면 보내지 않고 알린다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001'), row('T002')]);

    element('dependency-add').click();
    await flush();

    expect(received).toEqual([]);
    expect(element('editor-status').textContent).toContain('선행과 후행');
  });

  it('선후행 목록을 그리고 지우기를 붙인다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(
      context,
      [row('T001'), row('T002')],
      [
        {
          predecessorId: 'T001' as TaskId,
          successorId: 'T002' as TaskId,
          type: 'FINISH_START',
          lagDays: 2,
        },
      ],
    );

    expect(document.querySelectorAll('[data-testid="dependency-row"]')).toHaveLength(1);
    expect(element('dependency-label').textContent).toContain('T001 → T002');
    expect(element('dependency-label').textContent).toContain('2일');
  });

  it('선후행 지우기는 remove-dependency를 보낸다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(
      context,
      [row('T001'), row('T002')],
      [
        {
          predecessorId: 'T001' as TaskId,
          successorId: 'T002' as TaskId,
          type: 'FINISH_START',
          lagDays: 0,
        },
      ],
    );

    element('dependency-remove').click();
    await flush();

    expect(received[0]).toEqual([
      {
        kind: 'remove-dependency',
        predecessorId: 'T001',
        successorId: 'T002',
        type: 'FINISH_START',
      },
    ]);
  });
});

describe('createScheduleEditorPanel — 정리', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    received = [];
    rejectWith = null;
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await publish(context, [row('T001')]);

    expect(element('schedule-editor').hidden).toBe(true);
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createScheduleEditorPanel({
      panelSelector: '[data-testid="schedule-editor"]',
      taskListSelector: '[data-testid="task-list"]',
      taskIdSelector: '[data-testid="task-form-id"]',
      taskNameSelector: '[data-testid="task-form-name"]',
      taskParentSelector: '[data-testid="task-form-parent"]',
      taskStartSelector: '[data-testid="task-form-start"]',
      taskFinishSelector: '[data-testid="task-form-finish"]',
      taskAddSelector: '[data-testid="task-add"]',
      taskSaveSelector: '[data-testid="task-save"]',
      taskRemoveSelector: '[data-testid="task-remove"]',
      taskRaiseSelector: '[data-testid="task-raise"]',
      dependencyListSelector: '[data-testid="dependency-list"]',
      dependencyPredecessorSelector: '[data-testid="dependency-predecessor"]',
      dependencySuccessorSelector: '[data-testid="dependency-successor"]',
      dependencyTypeSelector: '[data-testid="dependency-type"]',
      dependencyLagSelector: '[data-testid="dependency-lag"]',
      dependencyAddSelector: '[data-testid="dependency-add"]',
      statusSelector: '[data-testid="editor-status"]',
    });

    await expect(panel.initialize(context)).rejects.toThrow(/schedule-editor/u);
  });
});
