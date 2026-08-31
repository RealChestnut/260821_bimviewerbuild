import type { ScheduleCsvBundle, ScheduleCsvFile } from '@bim4d/domain';
import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleTaskRow, ScheduleWarningRow } from '../scheduler/schedulerEvents.js';

/** 파일 하나를 사용자에게 넘긴다. 저장 위치는 브라우저가 정한다. */
export type SaveFile = (file: ScheduleCsvFile) => void;

export interface SchedulerPanelOptions {
  readonly fileInputSelector: string;
  /** 일정이 없을 때 통째로 감출 영역. */
  readonly panelSelector: string;
  readonly nameSelector: string;
  readonly taskListSelector: string;
  readonly warningListSelector: string;
  readonly statusSelector: string;
  readonly exportJsonSelector: string;
  readonly exportCsvSelector: string;
  /** 파일을 실제로 내려받는 방법. 기본은 브라우저 다운로드다. 테스트가 갈아 끼운다. */
  readonly saveFile?: SaveFile;
}

/**
 * CSV 묶음의 파일 이름과 역할.
 *
 * 이름이 곧 역할이다 (ADR-0007). `dependencies.csv`만 없어도 된다. 선후행이 없는 일정이
 * 정상이기 때문이다.
 */
const CSV_ROLES: ReadonlyMap<string, keyof ScheduleCsvBundle> = new Map([
  ['schedule.csv', 'schedule'],
  ['tasks.csv', 'tasks'],
  ['assignments.csv', 'assignments'],
  ['dependencies.csv', 'dependencies'],
]);

const REQUIRED_CSV_ROLES = ['schedule', 'tasks', 'assignments'] as const;

/** 브라우저 기본 저장. `<a download>`을 만들어 누른 뒤 objectURL을 돌려준다. */
const downloadFile: SaveFile = (file) => {
  const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

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
  const saveFile = options.saveFile ?? downloadFile;

  let context: AppContext | null = null;
  let fileInput: HTMLInputElement | null = null;
  let panel: HTMLElement | null = null;
  let nameText: HTMLElement | null = null;
  let taskList: HTMLElement | null = null;
  let warningList: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let exportJsonButton: HTMLElement | null = null;
  let exportCsvButton: HTMLElement | null = null;
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

  /** 고른 파일들을 CSV 묶음으로 모은다. 역할은 파일 이름으로 가른다 (ADR-0007). */
  const toCsvBundle = async (files: readonly File[]): Promise<ScheduleCsvBundle> => {
    const collected = new Map<keyof ScheduleCsvBundle, string>();

    for (const file of files) {
      const role = CSV_ROLES.get(file.name.toLowerCase());
      if (role === undefined) {
        // 모르는 이름을 넘기면 그 파일의 내용이 조용히 사라진다. 이름을 알려 주고 멈춘다.
        throw new Error(
          `${file.name}은 일정 CSV가 아니다. 쓸 수 있는 이름은 ${[...CSV_ROLES.keys()].join(', ')}뿐이다.`,
        );
      }
      if (collected.has(role)) {
        throw new Error(`${file.name}을 두 번 골랐다.`);
      }
      collected.set(role, await file.text());
    }

    for (const role of REQUIRED_CSV_ROLES) {
      if (!collected.has(role)) throw new Error(`${role}.csv가 없다.`);
    }

    const dependencies = collected.get('dependencies');
    return {
      schedule: collected.get('schedule') ?? '',
      tasks: collected.get('tasks') ?? '',
      assignments: collected.get('assignments') ?? '',
      // 없으면 필드를 만들지 않는다. 빈 문자열은 "헤더가 없는 파일"이라 거부당한다.
      ...(dependencies === undefined ? {} : { dependencies }),
    };
  };

  const onFileChosen = (): void => {
    const files = [...(fileInput?.files ?? [])];
    if (files.length === 0 || context === null) return;
    const app = context;

    void (async () => {
      try {
        // 확장자로 경로를 가른다. CSV는 묶음이라 여러 개, JSON은 한 파일이다.
        if (files.every((file) => file.name.toLowerCase().endsWith('.csv'))) {
          await app.commands.dispatch('scheduler/load-schedule-csv', {
            bundle: await toCsvBundle(files),
          });
        } else if (files.length === 1 && files[0] !== undefined) {
          await app.commands.dispatch('scheduler/load-schedule', {
            source: JSON.parse(await files[0].text()),
          });
        } else {
          throw new Error('CSV 묶음이거나 JSON 한 파일이어야 한다.');
        }
      } catch (cause) {
        // 명령까지 가지 못한 실패는 여기서 알린다. 검증 실패는 scheduler/load-failed로 나온다.
        const reason = cause instanceof Error ? cause.message : String(cause);
        write(statusText, `일정 열기 실패: ${reason}`);
      } finally {
        // 같은 파일을 다시 고를 수 있도록 값을 비운다.
        if (fileInput !== null) fileInput.value = '';
      }
    })();
  };

  const onExport = (format: 'json' | 'csv'): void => {
    if (context === null) return;
    const app = context;

    void (async () => {
      const result = await app.commands.dispatch('scheduler/export-schedule', { format });
      if (!result.ok) {
        write(statusText, `일정 내보내기 실패: ${result.error.message}`);
        return;
      }

      const { files } = result.value;
      for (const file of files) saveFile(file);
      write(statusText, `${String(files.length)}개 파일을 내보냈다.`);
    })();
  };

  const onExportJson = (): void => {
    onExport('json');
  };

  const onExportCsv = (): void => {
    onExport('csv');
  };

  const detach = (): void => {
    fileInput?.removeEventListener('change', onFileChosen);
    exportJsonButton?.removeEventListener('click', onExportJson);
    exportCsvButton?.removeEventListener('click', onExportCsv);
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
        exportJsonButton = requireElement(options.exportJsonSelector);
        exportCsvButton = requireElement(options.exportCsvSelector);
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
      exportJsonButton?.addEventListener('click', onExportJson);
      exportCsvButton?.addEventListener('click', onExportCsv);

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
      exportJsonButton = null;
      exportCsvButton = null;
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
