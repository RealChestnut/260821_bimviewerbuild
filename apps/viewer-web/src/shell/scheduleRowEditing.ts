import type { ScheduleEdit } from '@bim4d/domain';
import type { DependencyType, TaskId } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleDependencyRow, ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

/**
 * 일정 표 한 줄을 고치는 조각들.
 *
 * 표를 그리는 일은 `scheduleTablePanel`이 하고, 여기는 그 줄에 편집을 붙이는 일만 한다.
 * 무엇이 규칙에 맞는지는 판단하지 않는다. 편집을 만들어 넘기고, 실패 이유는 도메인이
 * 낸 것을 그대로 옮겨 적는다.
 *
 * 폼을 따로 두지 않는 이유는 79da5ac에 적혀 있다. 값을 보는 자리와 고치는 자리가
 * 갈라지면 CSV를 엑셀로 여는 편이 빨라진다. 칸을 그 자리에서 연다.
 */

/** ADR-0006이 확정한 네 값. `IfcRelSequence`의 SequenceType에 1:1로 대응한다. */
const DEPENDENCY_TYPES: readonly DependencyType[] = [
  'FINISH_START',
  'START_START',
  'FINISH_FINISH',
  'START_FINISH',
];

/** 칩에 적는 짧은 이름. 표 한 줄 안에 여럿이 들어가야 한다. */
const DEPENDENCY_LABELS: Readonly<Record<DependencyType, string>> = {
  FINISH_START: 'FS',
  START_START: 'SS',
  FINISH_FINISH: 'FF',
  START_FINISH: 'SF',
};

/** 편집 하나를 Scheduler에 보낸다. 성공했을 때만 `onDone`을 부른다. */
export type EditSubmit = (edits: readonly ScheduleEdit[], onDone?: () => void) => void;

const parentOf = (rows: readonly ScheduleTaskRow[], row: ScheduleTaskRow): ScheduleTaskRow | null =>
  rows.find((candidate) => candidate.taskId === row.parentTaskId) ?? null;

/** 같은 부모를 둔 바로 앞 줄. 들여쓰기가 부모로 삼을 대상이다. */
const siblingBefore = (
  rows: readonly ScheduleTaskRow[],
  row: ScheduleTaskRow,
): ScheduleTaskRow | null => {
  const index = rows.indexOf(row);
  if (index < 0) return null;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = rows[cursor];
    if (candidate !== undefined && candidate.parentTaskId === row.parentTaskId) return candidate;
  }
  return null;
};

/**
 * 들여쓰기. 바로 위 형제를 부모로 삼는다.
 *
 * 앞 형제가 없으면 할 수 없다. 부모 없이 깊이만 늘리면 계층이 아니라 여백이 된다.
 */
export const indentEdit = (
  rows: readonly ScheduleTaskRow[],
  row: ScheduleTaskRow,
): ScheduleEdit | null => {
  const sibling = siblingBefore(rows, row);
  if (sibling === null) return null;

  return { kind: 'update-task', taskId: row.taskId, parentTaskId: sibling.taskId };
};

/**
 * 내어쓰기. 부모의 부모로 올린다.
 *
 * 부모가 최상위였다면 자기도 최상위가 된다. 생략이 아니라 `null`을 보내야 지운다는
 * 뜻이 된다.
 */
export const outdentEdit = (
  rows: readonly ScheduleTaskRow[],
  row: ScheduleTaskRow,
): ScheduleEdit | null => {
  const parent = parentOf(rows, row);
  if (parent === null) return null;

  return {
    kind: 'update-task',
    taskId: row.taskId,
    parentTaskId: parent.parentTaskId ?? null,
  };
};

/** 일정의 시각은 UTC 자정 기준이다. 지역 시간대로 바꾸면 하루 어긋나 보인다. */
export const formatDate = (time: number | undefined): string =>
  time === undefined ? '' : new Date(time).toISOString().slice(0, 10);

const button = (testId: string, label: string, title: string): HTMLButtonElement => {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset['testid'] = testId;
  node.textContent = label;
  node.title = title;
  return node;
};

export interface EditableCellOptions {
  readonly testId: string;
  readonly text: string;
  /** 잠긴 칸은 눌러도 열리지 않는다. ID와 요약 Task의 날짜가 그렇다. */
  readonly editable: boolean;
  readonly inputType?: 'text' | 'date';
  /** 값이 실제로 바뀌었을 때만 부른다. */
  readonly onCommit: (value: string) => void;
  /** 칸이 열릴 때 알린다. 다시 그릴 때 같은 칸으로 돌아오기 위한 것이다. */
  readonly onOpen?: () => void;
}

/**
 * 눌러서 고치는 칸.
 *
 * 확정은 Enter와 blur, 취소는 Esc다. 값이 그대로면 아무것도 보내지 않는다. 편집을
 * 보내면 일정이 다시 실려 표가 통째로 다시 그려지므로, 확정 시점에만 보낸다.
 */
export const createEditableCell = (options: EditableCellOptions): HTMLElement => {
  const cell = document.createElement('span');
  cell.dataset['testid'] = options.testId;
  cell.dataset['editable'] = String(options.editable);
  cell.textContent = options.text;

  if (!options.editable) return cell;

  cell.tabIndex = 0;

  const open = (): void => {
    if (cell.querySelector('input') !== null) return;

    const input = document.createElement('input');
    input.type = options.inputType ?? 'text';
    input.dataset['testid'] = `${options.testId}-input`;
    input.value = options.text;

    let settled = false;
    const close = (commit: boolean): void => {
      if (settled) return;
      settled = true;

      const next = input.value;
      cell.replaceChildren(options.text);
      if (commit && next !== options.text) options.onCommit(next);
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
    });
    input.addEventListener('blur', () => {
      close(true);
    });

    cell.replaceChildren(input);
    input.focus();
    options.onOpen?.();
  };

  cell.addEventListener('click', open);
  cell.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      open();
    }
  });

  return cell;
};

export interface RowActionsOptions {
  readonly row: ScheduleTaskRow;
  readonly rows: readonly ScheduleTaskRow[];
  readonly submit: EditSubmit;
  /** 선후행 줄을 펼치거나 접는다. */
  readonly onToggleLinks: () => void;
  readonly linksOpen: boolean;
  /** 삭제처럼 결과를 알려야 하는 편집이 쓴다. */
  readonly write: (message: string) => void;
}

/** 줄 끝 버튼들. 들여쓰기·내어쓰기·선후행·삭제. */
export const createRowActions = (options: RowActionsOptions): HTMLElement => {
  const { row, rows, submit } = options;

  const actions = document.createElement('span');
  actions.dataset['testid'] = 'row-actions';

  const indent = button('task-indent', '⇥', '들여쓰기');
  const indentTarget = indentEdit(rows, row);
  indent.disabled = indentTarget === null;
  indent.addEventListener('click', () => {
    if (indentTarget !== null) submit([indentTarget]);
  });

  const outdent = button('task-outdent', '⇤', '내어쓰기');
  const outdentTarget = outdentEdit(rows, row);
  outdent.disabled = outdentTarget === null;
  outdent.addEventListener('click', () => {
    if (outdentTarget !== null) submit([outdentTarget]);
  });

  const links = button('task-links', '↔', '선후행');
  links.dataset['open'] = String(options.linksOpen);
  links.addEventListener('click', options.onToggleLinks);

  const remove = button('task-remove', '×', '삭제');
  remove.addEventListener('click', () => {
    const assigned = row.assignedCount;
    submit([{ kind: 'remove-task', taskId: row.taskId }], () => {
      // 함께 사라진 것을 알린다. 조용히 지우면 사용자가 잃은 것을 모른다.
      if (assigned > 0) {
        options.write(`${row.taskId}과 걸려 있던 부재 연결 ${String(assigned)}개를 지웠다.`);
      }
    });
  });

  actions.append(indent, outdent, links, remove);
  return actions;
};

export interface DependencyEditorOptions {
  /** 이 Task로 들어오는 선행을 다룬다. */
  readonly taskId: TaskId;
  readonly rows: readonly ScheduleTaskRow[];
  readonly dependencies: readonly ScheduleDependencyRow[];
  readonly submit: EditSubmit;
  readonly write: (message: string) => void;
}

/**
 * 고른 줄 아래에 펼치는 선후행 줄.
 *
 * 들어오는 선행을 칩으로 늘어놓고 끝에 더하는 칸을 둔다. 선후행을 더해도 막대는
 * 움직이지 않는다. ADR-0006이 선후행을 저장·검증만 하기로 했고, 화면이 날짜를 밀면
 * CPM을 도입한 것처럼 보인다.
 */
export const createDependencyEditor = (options: DependencyEditorOptions): HTMLLIElement => {
  const { taskId, rows, submit } = options;

  const item = document.createElement('li');
  item.dataset['testid'] = 'dependency-editor';
  item.dataset['taskId'] = taskId;

  const chips = document.createElement('span');
  chips.dataset['testid'] = 'dependency-chips';

  const incoming = options.dependencies.filter((link) => link.successorId === taskId);
  for (const link of incoming) {
    const chip = document.createElement('span');
    chip.dataset['testid'] = 'dependency-chip';
    chip.dataset['predecessorId'] = link.predecessorId;

    const lag =
      link.lagDays === 0 ? '' : ` ${link.lagDays > 0 ? '+' : ''}${String(link.lagDays)}일`;
    const label = document.createElement('span');
    label.dataset['testid'] = 'dependency-label';
    label.textContent = `${link.predecessorId} ${DEPENDENCY_LABELS[link.type]}${lag}`;

    const remove = button('dependency-remove', '×', '선후행 지우기');
    remove.addEventListener('click', () => {
      submit([
        {
          kind: 'remove-dependency',
          predecessorId: link.predecessorId,
          successorId: link.successorId,
          type: link.type,
        },
      ]);
    });

    chip.append(label, remove);
    chips.append(chip);
  }

  if (incoming.length === 0) {
    const empty = document.createElement('span');
    empty.dataset['testid'] = 'dependency-empty';
    empty.textContent = '선행 없음';
    chips.append(empty);
  }

  const predecessor = document.createElement('select');
  predecessor.dataset['testid'] = 'dependency-predecessor';
  predecessor.setAttribute('aria-label', '선행 Task');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '선행 고르기';
  predecessor.append(
    empty,
    // 자기 자신은 고를 수 없다. 나머지 규칙(순환 등)은 도메인이 본다.
    ...rows
      .filter((candidate) => candidate.taskId !== taskId)
      .map((candidate) => {
        const option = document.createElement('option');
        option.value = candidate.taskId;
        option.textContent = `${candidate.taskId} ${candidate.name}`;
        return option;
      }),
  );

  const type = document.createElement('select');
  type.dataset['testid'] = 'dependency-type';
  type.setAttribute('aria-label', '선후행 유형');
  type.append(
    ...DEPENDENCY_TYPES.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = DEPENDENCY_LABELS[value];
      return option;
    }),
  );

  const lag = document.createElement('input');
  lag.type = 'number';
  lag.dataset['testid'] = 'dependency-lag';
  lag.setAttribute('aria-label', '지연 일수');
  lag.value = '0';

  const add = button('dependency-add', '+', '선후행 더하기');
  add.addEventListener('click', () => {
    const predecessorId = predecessor.value;
    if (predecessorId.length === 0) {
      options.write('편집 실패: 선행 Task를 골라야 한다.');
      return;
    }

    const chosen = DEPENDENCY_TYPES.find((candidate) => candidate === type.value);
    if (chosen === undefined) {
      options.write('편집 실패: 선후행 유형을 골라야 한다.');
      return;
    }

    const lagDays = lag.value.trim().length === 0 ? 0 : Number(lag.value);
    if (!Number.isInteger(lagDays)) {
      options.write('편집 실패: 지연 일수는 정수여야 한다.');
      return;
    }

    submit([{ kind: 'add-dependency', predecessorId, successorId: taskId, type: chosen, lagDays }]);
  });

  item.append(chips, predecessor, type, lag, add);
  return item;
};

export interface DraftRowOptions {
  /** 고른 줄의 형제로 넣는다. 고른 줄이 없으면 최상위다. */
  readonly parentTaskId?: TaskId;
  readonly submit: EditSubmit;
  readonly onCancel: () => void;
  readonly write: (message: string) => void;
}

/**
 * 새 Task를 적어 넣는 줄.
 *
 * taskId를 앱이 지어내지 않는다. ID는 외부 공정표와 대조할 때 사람이 읽는 값이라
 * `task-7` 같은 것을 만들면 CSV 왕복에서 맞춰 볼 수 없다.
 */
export const createDraftRow = (options: DraftRowOptions): HTMLLIElement => {
  const item = document.createElement('li');
  item.dataset['testid'] = 'task-draft';

  const field = (testId: string, type: 'text' | 'date', label: string): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = type;
    input.dataset['testid'] = testId;
    input.setAttribute('aria-label', label);
    return input;
  };

  const id = field('task-draft-id', 'text', '새 Task ID');
  const name = field('task-draft-name', 'text', '새 Task 이름');
  const start = field('task-draft-start', 'date', '새 Task 시작');
  const finish = field('task-draft-finish', 'date', '새 Task 종료');

  const add = button('task-draft-add', '추가', 'Task 추가');
  add.addEventListener('click', () => {
    const taskId = id.value.trim();
    const taskName = name.value.trim();
    if (taskId.length === 0 || taskName.length === 0) {
      options.write('편집 실패: Task ID와 이름이 있어야 한다.');
      return;
    }

    options.submit(
      [
        {
          kind: 'add-task',
          taskId,
          name: taskName,
          ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
          ...(start.value.length === 0 ? {} : { start: start.value }),
          ...(finish.value.length === 0 ? {} : { finish: finish.value }),
        },
      ],
      options.onCancel,
    );
  });

  const cancel = button('task-draft-cancel', '취소', '추가 취소');
  cancel.addEventListener('click', options.onCancel);

  item.append(id, name, start, finish, add, cancel);
  return item;
};
