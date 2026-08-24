import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleTaskRow, ScheduleWarningRow } from '../scheduler/schedulerEvents.js';

export interface SchedulerPanelOptions {
  readonly fileInputSelector: string;
  /** 일정이 없을 때 통째로 감출 영역. */
  readonly panelSelector: string;
  readonly nameSelector: string;
  readonly taskListSelector: string;
  readonly warningListSelector: string;
  readonly statusSelector: string;
}

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

const requireInput = (selector: string): HTMLInputElement => {
  const element = requireElement(selector);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`input 요소가 아니다: ${selector}`);
  }
  return element;
};

/** 일정의 시각은 UTC 자정 기준이다. 지역 시간대로 바꾸면 하루 어긋나 보인다. */
const formatDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

const formatSpan = (row: ScheduleTaskRow): string =>
  row.start === undefined || row.finish === undefined
    ? '일정 미정'
    : `${formatDate(row.start)} ~ ${formatDate(row.finish)}`;

/**
 * 일정을 열고 내용을 보여 주는 화면 조각.
 *
 * 일정이 없으면 영역을 통째로 감춘다. 보여 줄 것이 없는데 자리를 차지하면 Viewer만 좁아진다.
 */
export const createSchedulerPanel = (options: SchedulerPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let fileInput: HTMLInputElement | null = null;
  let panel: HTMLElement | null = null;
  let nameText: HTMLElement | null = null;
  let taskList: HTMLElement | null = null;
  let warningList: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  const write = (target: HTMLElement | null, value: string): void => {
    if (target !== null) target.textContent = value;
  };

  const createTaskRow = (row: ScheduleTaskRow): HTMLLIElement => {
    const item = document.createElement('li');
    item.dataset['testid'] = 'task-row';
    item.dataset['taskId'] = row.taskId;
    item.dataset['depth'] = String(row.depth);
    item.dataset['summary'] = String(row.isSummary);
    // 깊이는 데이터로도 남긴다. 들여쓰기 폭이 바뀌어도 계층을 읽을 수 있어야 한다.
    item.style.paddingInlineStart = `${String(row.depth)}rem`;

    const name = document.createElement('span');
    name.dataset['testid'] = 'task-name';
    name.textContent = row.name;

    const dates = document.createElement('span');
    dates.dataset['testid'] = 'task-dates';
    dates.textContent = formatSpan(row);

    const assigned = document.createElement('span');
    assigned.dataset['testid'] = 'task-assigned';
    assigned.textContent = `부재 ${String(row.assignedCount)}`;

    item.append(name, dates, assigned);
    return item;
  };

  const createWarningRow = (warning: ScheduleWarningRow): HTMLLIElement => {
    const item = document.createElement('li');
    item.dataset['testid'] = 'schedule-warning';
    item.dataset['code'] = warning.code;
    item.textContent = warning.message;
    return item;
  };

  const onFileChosen = (): void => {
    const file = fileInput?.files?.[0];
    if (file === undefined || context === null) return;
    const app = context;

    void (async () => {
      let source: unknown;
      try {
        source = JSON.parse(await file.text());
      } catch (cause) {
        // JSON으로 읽히지도 않으면 보낼 것이 없다. 여기서 알린다.
        const reason = cause instanceof Error ? cause.message : String(cause);
        write(statusText, `일정 열기 실패: ${reason}`);
        if (fileInput !== null) fileInput.value = '';
        return;
      }

      await app.commands.dispatch('scheduler/load-schedule', { source });
      // 같은 파일을 다시 고를 수 있도록 값을 비운다.
      if (fileInput !== null) fileInput.value = '';
    })();
    // 검증 실패 이유는 scheduler/load-failed로 화면에 나온다.
  };

  const detach = (): void => {
    fileInput?.removeEventListener('change', onFileChosen);
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.scheduler-panel',

    initialize: (appContext: AppContext) => {
      try {
        fileInput = requireInput(options.fileInputSelector);
        panel = requireElement(options.panelSelector);
        nameText = requireElement(options.nameSelector);
        taskList = requireElement(options.taskListSelector);
        warningList = requireElement(options.warningListSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      panel.hidden = true;
      write(statusText, '');
      return Promise.resolve();
    },

    start: () => {
      if (context === null || fileInput === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      fileInput.addEventListener('change', onFileChosen);

      subscriptions = [
        context.events.subscribe('scheduler/schedule-changed', ({ payload }) => {
          if (panel !== null) panel.hidden = false;
          write(nameText, payload.name);
          write(statusText, '');

          taskList?.replaceChildren(...payload.tasks.map(createTaskRow));
          warningList?.replaceChildren(...payload.warnings.map(createWarningRow));
        }),
        context.events.subscribe('scheduler/load-failed', ({ payload }) => {
          // 앞서 실린 일정은 그대로 둔다. 읽지 못한 파일 때문에 쓰던 것을 지우지 않는다.
          write(statusText, `일정 열기 실패: ${payload.reason}`);
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
      fileInput = null;
      panel = null;
      nameText = null;
      taskList = null;
      warningList = null;
      statusText = null;
      context = null;
      return Promise.resolve();
    },
  };
};
