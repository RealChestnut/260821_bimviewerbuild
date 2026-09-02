// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { TaskId } from '@bim4d/contracts';

import { createTestContext } from '../kernel/testing/testContext.js';
import type { TestContext } from '../kernel/testing/testContext.js';
import '../scheduler/schedulerEvents.js';
import '../simulation/simulationEvents.js';
import type { ScheduleDependencyRow, ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

import { createScheduleTablePanel } from './scheduleTablePanel.js';

const markup = `
  <section data-testid="schedule-table" hidden>
    <div>
      <button type="button" data-testid="task-add">+</button>
      <div data-testid="gantt-axis"></div>
    </div>
    <ol data-testid="task-rows"></ol>
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

const panelOptions = {
  panelSelector: '[data-testid="schedule-table"]',
  axisSelector: '[data-testid="gantt-axis"]',
  rowListSelector: '[data-testid="task-rows"]',
  cursorSelector: '[data-testid="gantt-cursor"]',
  statusSelector: '[data-testid="gantt-status"]',
  addButtonSelector: '[data-testid="task-add"]',
};

const startPanel = async (context: TestContext) => {
  const panel = createScheduleTablePanel(panelOptions);
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

describe('createScheduleTablePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('일정이 없으면 감춰 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);

    expect(element('schedule-table').hidden).toBe(true);
  });

  it('일정이 실리면 Task마다 한 줄을 그린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    expect(element('schedule-table').hidden).toBe(false);
    expect(all('task-row').map((node) => node.dataset['taskId'])).toEqual(['W1', 'T001']);
  });

  it('계층 순서와 깊이를 그대로 그린다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [
      row('W1', { isSummary: true }),
      row('T001', { depth: 1 }),
      row('T002', { depth: 2 }),
    ]);

    expect(all('task-row').map((node) => node.dataset['depth'])).toEqual(['0', '1', '2']);
  });

  it('한 줄에 ID·이름·시작·종료·부재 수를 함께 적는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('T001', { name: '슬래브 타설', assignedCount: 3 })]);

    const cell = (testId: string): string => element(testId).textContent;
    expect(cell('task-id')).toBe('T001');
    expect(cell('task-name')).toBe('슬래브 타설');
    expect(cell('task-start')).toBe('2026-03-02');
    expect(cell('task-finish')).toBe('2026-03-06');
    expect(cell('task-assigned')).toBe('3');
  });

  it('한 줄 안에서 열과 막대가 같은 Task를 가리킨다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('T001'), row('T002', { start: Date.UTC(2026, 2, 23) })]);

    // 표와 막대를 따로 그리면 줄이 어긋날 수 있다. 한 줄 안에 둬서 어긋날 자리를 없앤다.
    const second = all('task-row')[1];
    expect(second?.querySelector('[data-testid="task-id"]')?.textContent).toBe('T002');
    expect(second?.querySelector('[data-testid="gantt-bar"]')).not.toBeNull();
  });

  it('시간이 정해지지 않은 Task의 날짜 칸을 비운다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [
      { taskId: 'T001' as TaskId, name: 'T001', depth: 0, isSummary: false, assignedCount: 0 },
      row('T002'),
    ]);

    // 빈 칸은 "값 없음"이며 0이나 오늘로 대체하지 않는다 (ADR-0002 경계 규칙 4).
    expect(all('task-start').map((node) => node.textContent)).toEqual(['', '2026-03-02']);
    expect(all('task-finish').map((node) => node.textContent)).toEqual(['', '2026-03-06']);
  });

  it('이름 칸만 깊이만큼 들여쓴다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 2 })]);

    // ID와 날짜 열은 자리가 고정이라야 읽힌다. 계층은 이름 칸에서만 드러낸다.
    expect(all('task-name').map((node) => node.style.paddingInlineStart)).toEqual(['0rem', '2rem']);
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
    expect(all('task-row').map((node) => node.dataset['timed'])).toEqual(['true', 'false']);
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

    expect(all('task-row')).toHaveLength(0);
    expect(element('gantt-status').textContent).toContain('기간이 정해진 Task가 없다');
  });
});

describe('createScheduleTablePanel — 시뮬레이션 커서', () => {
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
    // 열 칸을 뺀 나머지 폭에서 비율을 잡는다. 3월 2일부터 15일째이므로 30일 중 0.5다.
    expect(cursor.dataset['ratio']).toBe('0.500000');
    expect(cursor.style.left).toContain('var(--schedule-columns-width)');
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

describe('createScheduleTablePanel — 정리', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('dispose 후에는 Event를 받아도 화면을 바꾸지 않는다', async () => {
    const context = createTestContext();
    const panel = await startPanel(context);

    await panel.stop();
    await panel.dispose();
    await publish(context, [row('T001')]);

    expect(element('schedule-table').hidden).toBe(true);
    expect(all('task-row')).toHaveLength(0);
  });

  it('필요한 요소가 없으면 initialize에서 실패한다', async () => {
    document.body.innerHTML = '';
    const context = createTestContext();
    const panel = createScheduleTablePanel(panelOptions);

    await expect(panel.initialize(context)).rejects.toThrow(/schedule-table/u);
  });
});

/** 편집 명령을 가로채 인자를 모은다. Scheduler 없이 화면만 시험한다. */
const captureEdits = (context: TestContext): unknown[][] => {
  const seen: unknown[][] = [];
  context.commands.register('scheduler/edit-schedule', (input) => {
    seen.push([...input.edits]);
    return Promise.resolve({ taskCount: 1 });
  });
  return seen;
};

/** 명령이 오갈 틈을 준다. 편집은 비동기로 나간다. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const publishWith = async (
  context: TestContext,
  tasks: readonly ScheduleTaskRow[],
  dependencies: readonly ScheduleDependencyRow[],
): Promise<void> => {
  await context.events.publish('scheduler/schedule-changed', {
    scheduleId: 's1',
    name: '시험 일정',
    start: Date.UTC(2026, 2, 2),
    finish: Date.UTC(2026, 2, 31),
    tasks,
    dependencies,
    warnings: [],
  });
};

const openCell = (testId: string, index = 0): HTMLInputElement => {
  all(testId)[index]?.click();
  const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}-input"]`);
  if (input === null) throw new Error(`입력칸이 열리지 않았다: ${testId}`);
  return input;
};

const press = (input: HTMLElement, key: string): void => {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const button = (testId: string, index = 0): HTMLButtonElement => {
  const node = all(testId)[index];
  if (!(node instanceof HTMLButtonElement)) throw new Error(`버튼 없음: ${testId}`);
  return node;
};

describe('createScheduleTablePanel — 칸 편집', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('이름 칸을 누르면 그 자리에서 입력칸이 열린다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001', { name: '슬래브' })]);

    const input = openCell('task-name');

    // 폼을 따로 두지 않는다. 보는 자리와 고치는 자리가 같아야 한다 (79da5ac).
    expect(input.value).toBe('슬래브');
    expect(element('task-name').contains(input)).toBe(true);
  });

  it('Enter로 확정하면 이름 변경을 보낸다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001', { name: '슬래브' })]);

    const input = openCell('task-name');
    input.value = '슬래브 타설';
    press(input, 'Enter');
    await flush();

    expect(edits).toEqual([[{ kind: 'update-task', taskId: 'T001', name: '슬래브 타설' }]]);
  });

  it('값이 그대로면 아무것도 보내지 않는다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001', { name: '슬래브' })]);

    press(openCell('task-name'), 'Enter');
    await flush();

    expect(edits).toEqual([]);
  });

  it('Esc는 고친 값을 버린다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001', { name: '슬래브' })]);

    const input = openCell('task-name');
    input.value = '지울 값';
    press(input, 'Escape');
    await flush();

    expect(edits).toEqual([]);
    expect(element('task-name').textContent).toBe('슬래브');
  });

  it('날짜 칸을 고치면 그 날짜만 보낸다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001')]);

    const input = openCell('task-start');
    expect(input.type).toBe('date');
    input.value = '2026-03-03';
    press(input, 'Enter');
    await flush();

    expect(edits).toEqual([[{ kind: 'update-task', taskId: 'T001', start: '2026-03-03' }]]);
  });

  it('날짜를 비우면 지운다는 뜻으로 null을 보낸다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001')]);

    const input = openCell('task-finish');
    input.value = '';
    press(input, 'Enter');
    await flush();

    // 빈 칸은 "값 없음"이다. 생략은 "그대로 둔다"라 뜻이 다르다 (ADR-0002 경계 규칙 4).
    expect(edits).toEqual([[{ kind: 'update-task', taskId: 'T001', finish: null }]]);
  });

  it('ID 칸은 열리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    element('task-id').click();

    // ID는 부재 연결과 선후행의 키다. 바꾸면 연결이 끊긴다.
    expect(element('task-id').dataset['editable']).toBe('false');
    expect(document.querySelector('[data-testid="task-id-input"]')).toBeNull();
  });

  it('요약 Task의 날짜 칸은 열리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('W1', { isSummary: true }), row('T001', { depth: 1 })]);

    all('task-start')[0]?.click();

    // 화면에 보이는 값은 자손에서 계산한 값이라 그 Task의 것이 아니다 (ADR-0006).
    expect(all('task-start').map((node) => node.dataset['editable'])).toEqual(['false', 'true']);
    expect(document.querySelector('[data-testid="task-start-input"]')).toBeNull();
  });

  it('요약 Task의 이름은 고칠 수 있다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('W1', { isSummary: true })]);

    expect(element('task-name').dataset['editable']).toBe('true');
  });

  it('편집이 실패하면 도메인이 낸 이유를 적는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    await context.events.publish('scheduler/edit-failed', {
      reason: '요약 Task는 시간을 가질 수 없다.',
      code: 'schedule.parse.summary-task-has-time',
    });

    expect(element('gantt-status').textContent).toContain('요약 Task는 시간을 가질 수 없다');
  });
});

describe('createScheduleTablePanel — WBS와 삭제', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  const tree = [
    row('W1', { isSummary: true }),
    row('T001', { depth: 1, parentTaskId: 'W1' as TaskId }),
    row('T002', { depth: 1, parentTaskId: 'W1' as TaskId }),
  ];

  it('들여쓰기는 바로 위 형제를 부모로 삼는다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, tree);

    button('task-indent', 2).click();
    await flush();

    expect(edits).toEqual([[{ kind: 'update-task', taskId: 'T002', parentTaskId: 'T001' }]]);
  });

  it('형제 중 첫 줄의 들여쓰기 버튼은 눌리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, tree);

    expect([0, 1, 2].map((index) => button('task-indent', index).disabled)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('내어쓰기는 부모의 부모로 올린다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, tree);

    button('task-outdent', 1).click();
    await flush();

    // 부모가 최상위였으므로 자기도 최상위가 된다. 생략이 아니라 null이라야 지운다.
    expect(edits).toEqual([[{ kind: 'update-task', taskId: 'T001', parentTaskId: null }]]);
  });

  it('최상위 줄의 내어쓰기 버튼은 눌리지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, tree);

    expect(button('task-outdent', 0).disabled).toBe(true);
  });

  it('삭제는 Task를 지우고 함께 사라진 부재 연결 수를 알린다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001', { assignedCount: 3 })]);

    button('task-remove').click();
    await flush();

    expect(edits).toEqual([[{ kind: 'remove-task', taskId: 'T001' }]]);
    // 조용히 지우면 사용자가 무엇을 잃었는지 모른다.
    expect(element('gantt-status').textContent).toContain('부재 연결 3개');
  });
});

describe('createScheduleTablePanel — Task 추가', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('추가 버튼이 빈 줄을 연다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    element('task-add').click();

    expect(all('task-draft')).toHaveLength(1);
    expect(all('task-draft-id')).toHaveLength(1);
  });

  it('ID와 이름을 적으면 Task를 더한다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001')]);

    element('task-add').click();
    (element('task-draft-id') as HTMLInputElement).value = 'T002';
    (element('task-draft-name') as HTMLInputElement).value = '마감';
    (element('task-draft-start') as HTMLInputElement).value = '2026-03-10';
    button('task-draft-add').click();
    await flush();

    expect(edits).toEqual([
      [{ kind: 'add-task', taskId: 'T002', name: '마감', start: '2026-03-10' }],
    ]);
  });

  it('ID나 이름이 없으면 보내지 않고 이유를 적는다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001')]);

    element('task-add').click();
    button('task-draft-add').click();
    await flush();

    expect(edits).toEqual([]);
    expect(element('gantt-status').textContent).toContain('Task ID와 이름');
  });

  it('선후행 줄을 펼쳐 둔 Task의 형제로 넣는다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publish(context, [
      row('W1', { isSummary: true }),
      row('T001', { depth: 1, parentTaskId: 'W1' as TaskId }),
    ]);

    button('task-links', 1).click();
    element('task-add').click();
    (element('task-draft-id') as HTMLInputElement).value = 'T002';
    (element('task-draft-name') as HTMLInputElement).value = '마감';
    button('task-draft-add').click();
    await flush();

    expect(edits).toEqual([
      [{ kind: 'add-task', taskId: 'T002', name: '마감', parentTaskId: 'W1' }],
    ]);
  });

  it('취소하면 빈 줄을 걷는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publish(context, [row('T001')]);

    element('task-add').click();
    button('task-draft-cancel').click();

    expect(all('task-draft')).toHaveLength(0);
  });
});

describe('createScheduleTablePanel — 선후행', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  const pair = [row('T001'), row('T002')];

  const link = (lagDays = 0): ScheduleDependencyRow => ({
    predecessorId: 'T001' as TaskId,
    successorId: 'T002' as TaskId,
    type: 'FINISH_START',
    lagDays,
  });

  it('선후행 버튼이 줄을 펼치고 다시 누르면 접는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishWith(context, pair, []);

    button('task-links', 1).click();
    expect(all('dependency-editor')).toHaveLength(1);
    expect(element('dependency-editor').dataset['taskId']).toBe('T002');

    button('task-links', 1).click();
    expect(all('dependency-editor')).toHaveLength(0);
  });

  it('들어오는 선행만 칩으로 늘어놓는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishWith(context, pair, [link(2)]);

    button('task-links', 1).click();

    expect(all('dependency-chip')).toHaveLength(1);
    expect(element('dependency-label').textContent).toBe('T001 FS +2일');
  });

  it('선행이 없는 Task는 없다고 적는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishWith(context, pair, [link()]);

    // T001은 선행이 아니라 후행 쪽이다. 칩은 들어오는 것만 센다.
    button('task-links', 0).click();

    expect(all('dependency-chip')).toHaveLength(0);
    expect(element('dependency-empty').textContent).toBe('선행 없음');
  });

  it('칩을 지우면 선후행을 지운다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publishWith(context, pair, [link()]);

    button('task-links', 1).click();
    button('dependency-remove').click();
    await flush();

    expect(edits).toEqual([
      [
        {
          kind: 'remove-dependency',
          predecessorId: 'T001',
          successorId: 'T002',
          type: 'FINISH_START',
        },
      ],
    ]);
  });

  it('선행을 골라 더한다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publishWith(context, pair, []);

    button('task-links', 1).click();
    (element('dependency-predecessor') as HTMLSelectElement).value = 'T001';
    (element('dependency-type') as HTMLSelectElement).value = 'START_START';
    (element('dependency-lag') as HTMLInputElement).value = '3';
    button('dependency-add').click();
    await flush();

    expect(edits).toEqual([
      [
        {
          kind: 'add-dependency',
          predecessorId: 'T001',
          successorId: 'T002',
          type: 'START_START',
          lagDays: 3,
        },
      ],
    ]);
  });

  it('선행 목록에 자기 자신은 없다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishWith(context, pair, []);

    button('task-links', 1).click();

    const values = [...(element('dependency-predecessor') as HTMLSelectElement).options].map(
      (option) => option.value,
    );
    expect(values).toEqual(['', 'T001']);
  });

  it('선행을 고르지 않으면 보내지 않고 이유를 적는다', async () => {
    const context = createTestContext();
    const edits = captureEdits(context);
    await startPanel(context);
    await publishWith(context, pair, []);

    button('task-links', 1).click();
    button('dependency-add').click();
    await flush();

    expect(edits).toEqual([]);
    expect(element('gantt-status').textContent).toContain('선행 Task');
  });

  it('일정이 다시 실려도 펼친 선후행 줄은 그대로 둔다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishWith(context, pair, []);
    button('task-links', 1).click();

    await publishWith(context, pair, [link()]);

    // 고치자마자 줄이 접히면 이어서 둘째를 더할 수 없다.
    expect(all('dependency-editor')).toHaveLength(1);
    expect(all('dependency-chip')).toHaveLength(1);
  });

  it('사라진 Task의 선후행 줄은 걷는다', async () => {
    const context = createTestContext();
    await startPanel(context);
    await publishWith(context, pair, []);
    button('task-links', 1).click();

    await publishWith(context, [row('T001')], []);

    expect(all('dependency-editor')).toHaveLength(0);
  });
});

describe('createScheduleTablePanel — 초점', () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
  });

  it('고친 뒤 표를 다시 그려도 그 칸으로 초점이 돌아온다', async () => {
    const context = createTestContext();
    captureEdits(context);
    await startPanel(context);
    await publish(context, [row('T001'), row('T002')]);

    const input = openCell('task-name', 1);
    input.value = '벽 세우기';
    press(input, 'Enter');
    await flush();
    // 편집이 끝나면 Scheduler가 새 일정을 알린다. 표가 통째로 다시 그려진다.
    await publish(context, [row('T001'), row('T002', { name: '벽 세우기' })]);

    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.dataset['testid']).toBe('task-name');
    expect(focused?.closest('[data-testid="task-row"]')?.getAttribute('data-task-id')).toBe('T002');
  });

  it('연 칸이 없으면 초점을 옮기지 않는다', async () => {
    const context = createTestContext();
    await startPanel(context);

    await publish(context, [row('T001')]);

    expect(document.activeElement).toBe(document.body);
  });
});
