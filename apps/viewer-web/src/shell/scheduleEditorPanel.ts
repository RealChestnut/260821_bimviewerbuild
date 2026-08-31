import type { ScheduleEdit } from '@bim4d/domain';
import type { AppComponent, AppContext, DependencyType, Unsubscribe } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleDependencyRow, ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

export interface ScheduleEditorPanelOptions {
  /** 편집 영역 전체. 일정이 없으면 통째로 감춘다. */
  readonly panelSelector: string;
  readonly taskListSelector: string;
  readonly taskIdSelector: string;
  readonly taskNameSelector: string;
  readonly taskParentSelector: string;
  readonly taskStartSelector: string;
  readonly taskFinishSelector: string;
  readonly taskAddSelector: string;
  readonly taskSaveSelector: string;
  readonly taskRemoveSelector: string;
  readonly taskRaiseSelector: string;
  readonly dependencyListSelector: string;
  readonly dependencyPredecessorSelector: string;
  readonly dependencySuccessorSelector: string;
  readonly dependencyTypeSelector: string;
  readonly dependencyLagSelector: string;
  readonly dependencyAddSelector: string;
  readonly statusSelector: string;
}

/** ADR-0006이 확정한 네 값. `IfcRelSequence`의 SequenceType에 1:1로 대응한다. */
const DEPENDENCY_TYPES: readonly DependencyType[] = [
  'FINISH_START',
  'START_START',
  'FINISH_FINISH',
  'START_FINISH',
];

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`요소를 찾지 못했다: ${selector}`);
  return element;
};

const requireInput = (selector: string): HTMLInputElement => {
  const element = requireElement(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`input 요소가 아니다: ${selector}`);
  return element;
};

const requireSelect = (selector: string): HTMLSelectElement => {
  const element = requireElement(selector);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`select 요소가 아니다: ${selector}`);
  return element;
};

/** 일정의 시각은 UTC 자정 기준이다. 지역 시간대로 바꾸면 하루 어긋나 보인다. */
const formatDate = (time: number | undefined): string =>
  time === undefined ? '' : new Date(time).toISOString().slice(0, 10);

/** 빈 칸은 "값 없음"이다. 지우려는 뜻이므로 null로 보낸다 (ADR-0002 경계 규칙 4). */
const dateOrNull = (value: string): string | null => (value.trim().length === 0 ? null : value);

/**
 * 일정을 고치는 화면 조각.
 *
 * 목록을 그리는 일은 `schedulerPanel`이 하고, 여기는 고치는 일만 한다. 편집 결과의 검증은
 * 도메인이 하므로 이 화면은 무엇이 규칙에 맞는지 판단하지 않는다. 실패 이유만 옮겨 적는다.
 */
export const createScheduleEditorPanel = (options: ScheduleEditorPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let subscriptions: Unsubscribe[] = [];

  let panel: HTMLElement | null = null;
  let taskList: HTMLElement | null = null;
  let taskId: HTMLInputElement | null = null;
  let taskName: HTMLInputElement | null = null;
  let taskParent: HTMLSelectElement | null = null;
  let taskStart: HTMLInputElement | null = null;
  let taskFinish: HTMLInputElement | null = null;
  let taskAdd: HTMLElement | null = null;
  let taskSave: HTMLElement | null = null;
  let taskRemove: HTMLElement | null = null;
  let taskRaise: HTMLElement | null = null;
  let dependencyList: HTMLElement | null = null;
  let dependencyPredecessor: HTMLSelectElement | null = null;
  let dependencySuccessor: HTMLSelectElement | null = null;
  let dependencyType: HTMLSelectElement | null = null;
  let dependencyLag: HTMLInputElement | null = null;
  let dependencyAdd: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;

  let rows: readonly ScheduleTaskRow[] = [];
  let selected: ScheduleTaskRow | null = null;
  /** 실패 Event를 몇 번 받았는지. 도메인이 낸 이유를 일반 문구로 덮지 않으려고 센다. */
  let failureCount = 0;

  const write = (value: string): void => {
    if (statusText !== null) statusText.textContent = value;
  };

  const setDisabled = (element: HTMLElement | null, disabled: boolean): void => {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.disabled = disabled;
    }
  };

  const fillTaskOptions = (select: HTMLSelectElement | null, emptyLabel: string): void => {
    if (select === null) return;
    const previous = select.value;

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = emptyLabel;

    select.replaceChildren(
      empty,
      ...rows.map((row) => {
        const option = document.createElement('option');
        option.value = row.taskId;
        option.textContent = `${'· '.repeat(row.depth)}${row.name}`;
        return option;
      }),
    );
    // 목록이 다시 그려져도 고르던 값을 지키려 한다. 사라진 Task라면 빈 값으로 돌아간다.
    select.value = rows.some((row) => row.taskId === previous) ? previous : '';
  };

  /** 고른 Task를 편집 칸에 옮긴다. 아무것도 고르지 않았으면 칸을 비운다. */
  const showSelection = (): void => {
    const isEditing = selected !== null;

    if (taskId !== null) {
      taskId.value = selected?.taskId ?? '';
      // taskId는 연결의 키다. 고친 Task의 키를 바꾸면 부재 연결과 선후행이 끊긴다.
      taskId.disabled = isEditing;
    }
    if (taskName !== null) taskName.value = selected?.name ?? '';
    if (taskParent !== null) taskParent.value = '';

    // 요약 Task의 시간은 자손에서 계산한다. 화면에 보이는 값은 제 것이 아니다 (ADR-0006).
    const isSummary = selected?.isSummary === true;
    if (taskStart !== null) {
      taskStart.value = isSummary ? '' : formatDate(selected?.start);
      taskStart.disabled = isSummary;
    }
    if (taskFinish !== null) {
      taskFinish.value = isSummary ? '' : formatDate(selected?.finish);
      taskFinish.disabled = isSummary;
    }

    setDisabled(taskAdd, isEditing);
    setDisabled(taskSave, !isEditing);
    setDisabled(taskRemove, !isEditing);

    for (const node of document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')) {
      node.dataset['selected'] = String(node.dataset['taskId'] === selected?.taskId);
    }
  };

  const select = (id: string | null): void => {
    selected = id === null ? null : (rows.find((row) => row.taskId === id) ?? null);
    write('');
    showSelection();
  };

  const dispatch = (edits: readonly ScheduleEdit[], onDone?: () => void): void => {
    if (context === null) return;
    const app = context;

    const before = failureCount;
    void (async () => {
      const result = await app.commands.dispatch('scheduler/edit-schedule', { edits });
      if (!result.ok) {
        // 도메인이 이미 이유를 적었으면 그대로 둔다. 명령 앞에서 막힌 경우만 여기서 적는다.
        if (failureCount === before) write(`편집 실패: ${result.error.message}`);
        return;
      }
      onDone?.();
    })();
  };

  const createTaskEdit = (): void => {
    const id = taskId?.value.trim() ?? '';
    const name = taskName?.value.trim() ?? '';
    if (id.length === 0 || name.length === 0) {
      write('편집 실패: Task ID와 이름이 있어야 한다.');
      return;
    }

    const parent = taskParent?.value ?? '';
    const start = taskStart?.value ?? '';
    const finish = taskFinish?.value ?? '';

    dispatch(
      [
        {
          kind: 'add-task',
          taskId: id,
          name,
          ...(parent.length === 0 ? {} : { parentTaskId: parent }),
          ...(start.length === 0 ? {} : { start }),
          ...(finish.length === 0 ? {} : { finish }),
        },
      ],
      () => {
        select(null);
      },
    );
  };

  const saveTaskEdit = (): void => {
    if (selected === null) return;
    const name = taskName?.value.trim() ?? '';
    if (name.length === 0) {
      write('편집 실패: 이름이 있어야 한다.');
      return;
    }

    const parent = taskParent?.value ?? '';
    const isSummary = selected.isSummary;

    dispatch([
      {
        kind: 'update-task',
        taskId: selected.taskId,
        name,
        // 부모 칸을 비워 둔 것은 "그대로 둔다"는 뜻이다. 최상위로 올리려면 목록에서 고른다.
        ...(parent.length === 0 ? {} : { parentTaskId: parent }),
        // 요약 Task의 시간은 손대지 않는다. 자손에서 계산하기 때문이다.
        ...(isSummary
          ? {}
          : {
              start: dateOrNull(taskStart?.value ?? ''),
              finish: dateOrNull(taskFinish?.value ?? ''),
            }),
      },
    ]);
  };

  const removeTaskEdit = (): void => {
    if (selected === null) return;
    const target = selected.taskId;
    const assigned = selected.assignedCount;

    dispatch([{ kind: 'remove-task', taskId: target }], () => {
      select(null);
      // 함께 사라진 것을 알린다. 조용히 지우면 사용자가 잃은 것을 모른다.
      if (assigned > 0) write(`${target}과 걸려 있던 부재 연결 ${String(assigned)}개를 지웠다.`);
    });
  };

  const raiseToTop = (): void => {
    if (selected === null) return;
    dispatch([{ kind: 'update-task', taskId: selected.taskId, parentTaskId: null }]);
  };

  const addDependency = (): void => {
    const predecessorId = dependencyPredecessor?.value ?? '';
    const successorId = dependencySuccessor?.value ?? '';
    if (predecessorId.length === 0 || successorId.length === 0) {
      write('편집 실패: 선행과 후행 Task를 골라야 한다.');
      return;
    }

    const rawType = dependencyType?.value ?? '';
    const type = DEPENDENCY_TYPES.find((candidate) => candidate === rawType);
    if (type === undefined) {
      write('편집 실패: 선후행 유형을 골라야 한다.');
      return;
    }

    const rawLag = dependencyLag?.value.trim() ?? '';
    const lagDays = rawLag.length === 0 ? 0 : Number(rawLag);
    if (!Number.isInteger(lagDays)) {
      write('편집 실패: 지연 일수는 정수여야 한다.');
      return;
    }

    dispatch([{ kind: 'add-dependency', predecessorId, successorId, type, lagDays }]);
  };

  const createDependencyRow = (row: ScheduleDependencyRow): HTMLLIElement => {
    const item = document.createElement('li');
    item.dataset['testid'] = 'dependency-row';

    const label = document.createElement('span');
    label.dataset['testid'] = 'dependency-label';
    const lag = row.lagDays === 0 ? '' : ` (${String(row.lagDays)}일)`;
    label.textContent = `${row.predecessorId} → ${row.successorId} · ${row.type}${lag}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset['testid'] = 'dependency-remove';
    remove.textContent = '지우기';
    remove.addEventListener('click', () => {
      dispatch([
        {
          kind: 'remove-dependency',
          predecessorId: row.predecessorId,
          successorId: row.successorId,
          type: row.type,
        },
      ]);
    });

    item.append(label, remove);
    return item;
  };

  const onTaskListClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const row = target.closest<HTMLElement>('[data-testid="task-row"]');
    const id = row?.dataset['taskId'];
    // 고른 줄을 다시 누르면 선택을 푼다. 새 Task를 더하려면 선택이 없어야 한다.
    select(id === undefined || id === selected?.taskId ? null : id);
  };

  const detach = (): void => {
    taskList?.removeEventListener('click', onTaskListClick);
    taskAdd?.removeEventListener('click', createTaskEdit);
    taskSave?.removeEventListener('click', saveTaskEdit);
    taskRemove?.removeEventListener('click', removeTaskEdit);
    taskRaise?.removeEventListener('click', raiseToTop);
    dependencyAdd?.removeEventListener('click', addDependency);
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.schedule-editor-panel',

    initialize: (appContext: AppContext) => {
      try {
        panel = requireElement(options.panelSelector);
        taskList = requireElement(options.taskListSelector);
        taskId = requireInput(options.taskIdSelector);
        taskName = requireInput(options.taskNameSelector);
        taskParent = requireSelect(options.taskParentSelector);
        taskStart = requireInput(options.taskStartSelector);
        taskFinish = requireInput(options.taskFinishSelector);
        taskAdd = requireElement(options.taskAddSelector);
        taskSave = requireElement(options.taskSaveSelector);
        taskRemove = requireElement(options.taskRemoveSelector);
        taskRaise = requireElement(options.taskRaiseSelector);
        dependencyList = requireElement(options.dependencyListSelector);
        dependencyPredecessor = requireSelect(options.dependencyPredecessorSelector);
        dependencySuccessor = requireSelect(options.dependencySuccessorSelector);
        dependencyType = requireSelect(options.dependencyTypeSelector);
        dependencyLag = requireInput(options.dependencyLagSelector);
        dependencyAdd = requireElement(options.dependencyAddSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      panel.hidden = true;

      dependencyType.replaceChildren(
        ...DEPENDENCY_TYPES.map((type) => {
          const option = document.createElement('option');
          option.value = type;
          option.textContent = type;
          return option;
        }),
      );

      showSelection();
      write('');
      return Promise.resolve();
    },

    start: () => {
      if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
      if (subscriptions.length > 0) return Promise.resolve();

      taskList?.addEventListener('click', onTaskListClick);
      taskAdd?.addEventListener('click', createTaskEdit);
      taskSave?.addEventListener('click', saveTaskEdit);
      taskRemove?.addEventListener('click', removeTaskEdit);
      taskRaise?.addEventListener('click', raiseToTop);
      dependencyAdd?.addEventListener('click', addDependency);

      subscriptions = [
        context.events.subscribe('scheduler/schedule-changed', ({ payload }) => {
          if (panel !== null) panel.hidden = false;
          rows = payload.tasks;

          fillTaskOptions(taskParent, '(최상위)');
          fillTaskOptions(dependencyPredecessor, '(선행 Task)');
          fillTaskOptions(dependencySuccessor, '(후행 Task)');
          dependencyList?.replaceChildren(...payload.dependencies.map(createDependencyRow));

          // 고르고 있던 Task가 사라졌으면 선택을 푼다.
          const stillThere = rows.find((row) => row.taskId === selected?.taskId) ?? null;
          selected = stillThere;
          showSelection();
        }),
        context.events.subscribe('scheduler/edit-failed', ({ payload }) => {
          failureCount += 1;
          write(`편집 실패: ${payload.reason}`);
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
      rows = [];
      selected = null;
      panel = null;
      taskList = null;
      taskId = null;
      taskName = null;
      taskParent = null;
      taskStart = null;
      taskFinish = null;
      taskAdd = null;
      taskSave = null;
      taskRemove = null;
      taskRaise = null;
      dependencyList = null;
      dependencyPredecessor = null;
      dependencySuccessor = null;
      dependencyType = null;
      dependencyLag = null;
      dependencyAdd = null;
      statusText = null;
      context = null;
      return Promise.resolve();
    },
  };
};
