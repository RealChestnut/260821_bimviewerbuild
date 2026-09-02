import type { ScheduleEdit } from '@bim4d/domain';
import type {
  AppComponent,
  AppContext,
  ModelRefBindingPort,
  ProductKey,
  TaskId,
  Unsubscribe,
} from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import '../simulation/simulationEvents.js';
import '../viewer/selection/selectionEvents.js';
import type {
  ScheduleAssignmentRow,
  ScheduleDependencyRow,
  ScheduleTaskRow,
} from '../scheduler/schedulerEvents.js';
import type { SelectedProduct } from '../viewer/selection/selectionEvents.js';

import { createAssignmentEditor } from './scheduleAssignmentEditing.js';
import {
  createDependencyEditor,
  createDraftRow,
  createEditableCell,
  createRowActions,
  formatDate,
} from './scheduleRowEditing.js';

export interface ScheduleTablePanelOptions {
  /** 표 전체. 그릴 기간이 없으면 통째로 감춘다. */
  readonly panelSelector: string;
  readonly axisSelector: string;
  readonly rowListSelector: string;
  readonly cursorSelector: string;
  readonly statusSelector: string;
  /** 새 Task 줄을 여는 버튼. 머리글에 둔다. */
  readonly addButtonSelector: string;
  /** 일정의 modelRef와 적재된 모델을 잇는 자리. 부재를 걸고 3D에서 찾을 때 쓴다. */
  readonly binding: ModelRefBindingPort;
}

const DAY = 86_400_000;

/**
 * 열 칸 전체의 폭을 담은 CSS 변수 이름.
 *
 * 커서는 막대 칸에만 겹쳐야 하므로 열 칸 폭만큼 밀어야 한다. 폭을 이 코드가 알 필요는
 * 없고, 알면 CSS와 두 곳에서 같은 값을 지켜야 한다. CSS에 맡기고 비율만 넘긴다.
 */
const COLUMNS_WIDTH = 'var(--schedule-columns-width)';

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`요소를 찾지 못했다: ${selector}`);
  return element;
};

const formatMonth = (time: number): string => new Date(time).toISOString().slice(0, 7);

/** 다음 달 1일 UTC 자정. 축 눈금을 달 경계에 놓는다. */
const nextMonthStart = (time: number): number => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};

const percent = (ratio: number): string => `${(ratio * 100).toFixed(4)}%`;

const cell = (testId: string, text: string): HTMLSpanElement => {
  const node = document.createElement('span');
  node.dataset['testid'] = testId;
  node.textContent = text;
  return node;
};

/** 빈 칸은 "값 없음"이다. 지우려는 뜻이므로 null로 보낸다 (ADR-0002 경계 규칙 4). */
const dateOrNull = (value: string): string | null => (value.trim().length === 0 ? null : value);

/**
 * 일정을 표와 막대 그림으로 함께 그리고 그 자리에서 고치는 화면 조각.
 *
 * 한 줄 안에 열과 막대가 같이 있다. 표와 막대를 두 컴포넌트로 나눠 그리면 두 칸의 줄
 * 높이와 머리 여백을 각각 맞춰야 하고, 어긋나도 testid를 세는 테스트는 통과한다. 실제로
 * 4.6px 어긋난 채로 있었다. 한 줄로 두면 어긋날 자리가 없다.
 *
 * 편집도 그 줄에서 한다. 값을 보는 자리와 고치는 자리가 갈라지면 CSV를 엑셀로 여는
 * 편이 빨라진다 (79da5ac). 무엇이 규칙에 맞는지는 판단하지 않고 도메인이 낸 이유만
 * 옮겨 적는다.
 *
 * `finish`는 그날까지 포함하므로 막대의 오른쪽 끝을 하루 뒤로 잡는다. 그러지 않으면
 * 하루짜리 Task의 폭이 0이 되어 보이지 않는다.
 *
 * 시간이 정해지지 않은 Task는 막대를 그리지 않고 날짜 칸을 비운다. 폭 0으로 두거나 오늘로
 * 옮기면 없는 일정을 있는 것처럼 보여 준다 (ADR-0002 경계 규칙 4).
 */
export const createScheduleTablePanel = (options: ScheduleTablePanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let subscriptions: Unsubscribe[] = [];

  let panel: HTMLElement | null = null;
  let axis: HTMLElement | null = null;
  let rowList: HTMLElement | null = null;
  let cursor: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let addButton: HTMLElement | null = null;

  /** 지금 그리고 있는 기간. 커서를 놓을 때 다시 쓴다. */
  let span: { readonly start: number; readonly end: number } | null = null;
  let rows: readonly ScheduleTaskRow[] = [];
  let dependencies: readonly ScheduleDependencyRow[] = [];

  /** 선후행 줄을 펼쳐 둔 Task. 다시 그려도 유지한다. */
  let linksTaskId: TaskId | null = null;
  /** 부재 연결 줄을 펼쳐 둔 Task. */
  let assignTaskId: TaskId | null = null;
  let assignments: readonly ScheduleAssignmentRow[] = [];
  /** 지금 뷰어에서 고른 부재. 걸기 버튼이 무엇을 걸지가 여기서 정해진다. */
  let selection: readonly SelectedProduct[] = [];
  /** 새 Task 줄을 열어 두었는가. */
  let drafting = false;
  /** 방금 연 칸. 편집 뒤 표를 다시 그려도 같은 자리로 돌아가려고 기억한다. */
  let openCell: { readonly taskId: TaskId; readonly testId: string } | null = null;
  /**
   * 편집 실패 Event를 몇 번 받았는지.
   *
   * 도메인이 이미 이유를 적었으면 명령 실패 문구로 덮지 않는다.
   */
  let failureCount = 0;

  const write = (value: string): void => {
    if (statusText !== null) statusText.textContent = value;
  };

  const ratioOf = (time: number): number => {
    if (span === null) return 0;
    const width = span.end - span.start;
    if (width <= 0) return 0;
    // 기간 밖으로 나가지 않게 자른다. 커서는 재생 중에 끝을 넘길 수 있다.
    return Math.min(1, Math.max(0, (time - span.start) / width));
  };

  const submit = (edits: readonly ScheduleEdit[], onDone?: () => void): void => {
    if (context === null) return;
    const app = context;

    const before = failureCount;
    void (async () => {
      const result = await app.commands.dispatch('scheduler/edit-schedule', { edits });
      if (!result.ok) {
        // 도메인이 낸 이유가 이미 적혔으면 그대로 둔다. 명령 앞에서 막힌 경우만 여기서 적는다.
        if (failureCount === before) write(`편집 실패: ${result.error.message}`);
        return;
      }
      onDone?.();
    })();
  };

  /** 부재를 3D에서 고르게 한다. 고르는 일의 주인은 Viewer다. */
  const showInViewer = (products: readonly ProductKey[]): void => {
    if (context === null || products.length === 0) return;
    void context.commands.dispatch('viewer/select-products', { products });
  };

  const remember = (row: ScheduleTaskRow, testId: string): void => {
    openCell = { taskId: row.taskId, testId };
  };

  const createRow = (row: ScheduleTaskRow): HTMLLIElement => {
    const item = document.createElement('li');
    item.dataset['testid'] = 'task-row';
    item.dataset['taskId'] = row.taskId;
    item.dataset['depth'] = String(row.depth);
    item.dataset['summary'] = String(row.isSummary);
    item.dataset['selected'] = String(linksTaskId === row.taskId);

    const name = createEditableCell({
      testId: 'task-name',
      text: row.name,
      editable: true,
      onCommit: (value) => {
        submit([{ kind: 'update-task', taskId: row.taskId, name: value }]);
      },
      onOpen: () => {
        remember(row, 'task-name');
      },
    });
    // 계층은 이름 칸에서만 드러낸다. ID와 날짜 열은 자리가 고정이라야 읽힌다.
    name.style.paddingInlineStart = `${String(row.depth)}rem`;

    // 요약 Task의 시간은 자손에서 계산한 값이다. 그 Task의 것이 아니므로 잠근다 (ADR-0006).
    const timeEditable = !row.isSummary;
    const start = createEditableCell({
      testId: 'task-start',
      text: formatDate(row.start),
      editable: timeEditable,
      inputType: 'date',
      onCommit: (value) => {
        submit([{ kind: 'update-task', taskId: row.taskId, start: dateOrNull(value) }]);
      },
      onOpen: () => {
        remember(row, 'task-start');
      },
    });
    const finish = createEditableCell({
      testId: 'task-finish',
      text: formatDate(row.finish),
      editable: timeEditable,
      inputType: 'date',
      onCommit: (value) => {
        submit([{ kind: 'update-task', taskId: row.taskId, finish: dateOrNull(value) }]);
      },
      onOpen: () => {
        remember(row, 'task-finish');
      },
    });

    const track = document.createElement('span');
    track.dataset['testid'] = 'gantt-track';

    item.dataset['timed'] = String(row.start !== undefined && row.finish !== undefined);

    if (row.start !== undefined && row.finish !== undefined) {
      const left = ratioOf(row.start);
      // finish는 그날까지 포함한다. 오른쪽 끝을 하루 뒤로 잡아야 폭이 생긴다.
      const right = ratioOf(row.finish + DAY);

      const bar = document.createElement('span');
      bar.dataset['testid'] = 'gantt-bar';
      bar.dataset['summary'] = String(row.isSummary);
      bar.style.left = percent(left);
      bar.style.width = percent(Math.max(0, right - left));
      bar.title = `${formatDate(row.start)} ~ ${formatDate(row.finish)}`;
      track.append(bar);
    }

    item.append(
      // ID는 부재 연결과 선후행의 키다. 바꾸면 연결이 끊기므로 잠근다.
      createEditableCell({
        testId: 'task-id',
        text: row.taskId,
        editable: false,
        onCommit: () => undefined,
      }),
      name,
      start,
      finish,
      assignedCell(row),
      createRowActions({
        row,
        rows,
        submit,
        linksOpen: linksTaskId === row.taskId,
        onToggleLinks: () => {
          linksTaskId = linksTaskId === row.taskId ? null : row.taskId;
          drawRows();
        },
        write,
      }),
      track,
    );
    return item;
  };

  /** 부재 수 칸. 누르면 그 Task의 연결 줄을 펼친다. */
  const assignedCell = (row: ScheduleTaskRow): HTMLElement => {
    const node = cell('task-assigned', String(row.assignedCount));
    node.dataset['expandable'] = 'true';
    node.tabIndex = 0;

    const toggle = (): void => {
      assignTaskId = assignTaskId === row.taskId ? null : row.taskId;
      drawRows();
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      toggle();
    });
    return node;
  };

  /** 방금 열었던 칸으로 초점을 되돌린다. 다시 그리면 열려 있던 입력칸이 사라진다. */
  const restoreFocus = (): void => {
    if (openCell === null || rowList === null) return;

    const line = rowList.querySelector<HTMLElement>(
      `[data-testid="task-row"][data-task-id="${openCell.taskId}"]`,
    );
    const target = line?.querySelector<HTMLElement>(`[data-testid="${openCell.testId}"]`);
    openCell = null;
    target?.focus();
  };

  const drawRows = (): void => {
    if (rowList === null) return;

    // 사라진 Task의 줄은 붙일 자리가 없다.
    if (linksTaskId !== null && !rows.some((row) => row.taskId === linksTaskId)) {
      linksTaskId = null;
    }
    if (assignTaskId !== null && !rows.some((row) => row.taskId === assignTaskId)) {
      assignTaskId = null;
    }

    const items: HTMLLIElement[] = [];
    for (const row of rows) {
      items.push(createRow(row));
      if (linksTaskId === row.taskId) {
        items.push(
          createDependencyEditor({
            taskId: row.taskId,
            rows,
            dependencies,
            submit,
            write,
          }),
        );
      }
      if (assignTaskId === row.taskId) {
        items.push(
          createAssignmentEditor({
            taskId: row.taskId,
            assignments,
            selection,
            binding: options.binding,
            submit,
            write,
            showInViewer,
          }),
        );
      }
    }

    if (drafting) {
      const sibling = rows.find((row) => row.taskId === linksTaskId);
      items.push(
        createDraftRow({
          // 고른 줄이 있으면 그 형제로 넣는다. 없으면 최상위다.
          ...(sibling?.parentTaskId === undefined ? {} : { parentTaskId: sibling.parentTaskId }),
          submit,
          onCancel: () => {
            drafting = false;
            drawRows();
          },
          write,
        }),
      );
    }

    rowList.replaceChildren(...items);
    restoreFocus();
  };

  /** 달 경계마다 눈금을 놓는다. 눈금이 하나도 없으면 양 끝 날짜만 적는다. */
  const drawAxis = (): void => {
    if (axis === null || span === null) return;

    const ticks: HTMLElement[] = [];
    for (let time = nextMonthStart(span.start); time < span.end; time = nextMonthStart(time)) {
      const tick = document.createElement('span');
      tick.dataset['testid'] = 'gantt-tick';
      tick.textContent = formatMonth(time);
      tick.style.left = percent(ratioOf(time));
      ticks.push(tick);
    }

    const range = document.createElement('span');
    range.dataset['testid'] = 'gantt-range';
    // 끝 날짜는 실제 완료일을 적는다. 하루를 더한 것은 그림의 사정이다.
    range.textContent = `${formatDate(span.start)} ~ ${formatDate(span.end - DAY)}`;

    axis.replaceChildren(range, ...ticks);
  };

  const moveCursor = (time: number | null): void => {
    if (cursor === null) return;

    if (span === null || time === null) {
      cursor.hidden = true;
      return;
    }
    const ratio = ratioOf(time);
    cursor.hidden = false;
    cursor.dataset['time'] = formatDate(time);
    // 자리는 데이터로도 남긴다. 브라우저마다 calc 표기를 다르게 정규화한다.
    cursor.dataset['ratio'] = ratio.toFixed(6);
    // 커서는 막대 칸에만 겹쳐야 한다. 열 칸 폭만큼 밀고 남은 폭에서 비율을 잡는다.
    cursor.style.left = `calc(${COLUMNS_WIDTH} + (100% - ${COLUMNS_WIDTH}) * ${ratio.toFixed(6)})`;
  };

  const onAdd = (): void => {
    drafting = true;
    drawRows();
  };

  const detach = (): void => {
    addButton?.removeEventListener('click', onAdd);
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.schedule-table-panel',

    initialize: (appContext: AppContext) => {
      try {
        panel = requireElement(options.panelSelector);
        axis = requireElement(options.axisSelector);
        rowList = requireElement(options.rowListSelector);
        cursor = requireElement(options.cursorSelector);
        statusText = requireElement(options.statusSelector);
        addButton = requireElement(options.addButtonSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      panel.hidden = true;
      cursor.hidden = true;
      write('');
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      if (subscriptions.length > 0) return Promise.resolve();

      addButton?.addEventListener('click', onAdd);

      subscriptions = [
        context.events.subscribe('scheduler/schedule-changed', ({ payload }) => {
          if (panel !== null) panel.hidden = false;

          rows = payload.tasks;
          dependencies = payload.dependencies;
          assignments = payload.assignments;

          if (payload.start === undefined || payload.finish === undefined) {
            // 시간이 확정된 Task가 하나도 없으면 그릴 기간이 없다.
            span = null;
            rows = [];
            rowList?.replaceChildren();
            axis?.replaceChildren();
            moveCursor(null);
            write('기간이 정해진 Task가 없다.');
            return;
          }

          span = { start: payload.start, end: payload.finish + DAY };
          write('');
          drawAxis();
          drawRows();
          moveCursor(null);
        }),
        context.events.subscribe('scheduler/edit-failed', ({ payload }) => {
          failureCount += 1;
          write(`편집 실패: ${payload.reason}`);
        }),
        context.events.subscribe('selection/changed', ({ payload }) => {
          selection = payload.selected;
          // 연결 줄을 펼쳐 두지 않았으면 그릴 것이 없다. 편집 중인 칸을 헛되이 닫지 않는다.
          if (assignTaskId !== null) drawRows();
        }),
        context.events.subscribe('simulation/time-changed', ({ payload }) => {
          moveCursor(payload.time);
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      detach();
      return Promise.resolve();
    },

    dispose: () => {
      detach();
      span = null;
      rows = [];
      dependencies = [];
      linksTaskId = null;
      assignTaskId = null;
      assignments = [];
      selection = [];
      drafting = false;
      openCell = null;
      panel = null;
      axis = null;
      rowList = null;
      cursor = null;
      statusText = null;
      addButton = null;
      context = null;
      return Promise.resolve();
    },
  };
};
