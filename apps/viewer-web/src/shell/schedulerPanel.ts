import type { ScheduleCsvBundle, ScheduleCsvFile } from '@bim4d/domain';
import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleWarningRow } from '../scheduler/schedulerEvents.js';

/** 파일 하나를 사용자에게 넘긴다. 저장 위치는 브라우저가 정한다. */
export type SaveFile = (file: ScheduleCsvFile) => void;

export interface SchedulerPanelOptions {
  readonly fileInputSelector: string;
  /** 일정이 없을 때 통째로 감출 영역. */
  readonly panelSelector: string;
  readonly nameSelector: string;
  readonly warningListSelector: string;
  /** 모델이 바뀌었다는 알림을 그릴 자리. */
  readonly replacementListSelector: string;
  readonly statusSelector: string;
  readonly exportJsonSelector: string;
  readonly exportCsvSelector: string;
  /** 파일을 실제로 내려받는 방법. 기본은 브라우저 다운로드다. 테스트가 갈아 끼운다. */
  readonly saveFile?: SaveFile;
}

/**
 * CSV 묶음의 파일 이름과 역할.
 *
 * 이름이 곧 역할이다 (ADR-0007). `dependencies.csv`와 `models.csv`는 없어도 된다. 선후행이
 * 없는 일정도, 아는 fingerprint가 없는 일정도 정상이기 때문이다 (ADR-0008).
 */
const CSV_ROLES: ReadonlyMap<string, keyof ScheduleCsvBundle> = new Map([
  ['schedule.csv', 'schedule'],
  ['tasks.csv', 'tasks'],
  ['assignments.csv', 'assignments'],
  ['dependencies.csv', 'dependencies'],
  ['models.csv', 'models'],
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

/**
 * 일정을 열고 닫고 내보내는 화면 조각.
 *
 * 일정의 이름과 경고만 그린다. Task 줄은 표와 막대를 함께 그리는 scheduleTablePanel이
 * 맡는다. 여는 일과 그리는 일은 서로 다른 이유로 바뀐다.
 *
 * 일정이 없으면 영역을 통째로 감춘다. 보여 줄 것이 없는데 자리를 차지하면 Viewer만 좁아진다.
 */
export const createSchedulerPanel = (options: SchedulerPanelOptions): AppComponent => {
  const saveFile = options.saveFile ?? downloadFile;

  let context: AppContext | null = null;
  let fileInput: HTMLInputElement | null = null;
  let panel: HTMLElement | null = null;
  let nameText: HTMLElement | null = null;
  let warningList: HTMLElement | null = null;
  let replacementList: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let exportJsonButton: HTMLElement | null = null;
  let exportCsvButton: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  const write = (target: HTMLElement | null, value: string): void => {
    if (target !== null) target.textContent = value;
  };

  /**
   * 모델이 바뀌었다는 알림 한 줄.
   *
   * 묶기는 이미 됐다. 여기서 묻는 것은 "이 파일을 이 이름의 정본으로 삼을까"이며,
   * fingerprint를 자동으로 갱신하지 않기로 했으므로 사용자가 고른다 (ADR-0008).
   */
  const createReplacementRow = (modelRef: string): HTMLLIElement => {
    const item = document.createElement('li');
    item.dataset['testid'] = 'model-replaced';
    item.dataset['modelRef'] = modelRef;

    const label = document.createElement('span');
    label.textContent = `${modelRef}의 파일 내용이 일정이 아는 것과 다르다.`;

    const adopt = document.createElement('button');
    adopt.type = 'button';
    adopt.dataset['testid'] = 'model-adopt';
    adopt.textContent = '이 모델로 교체';
    adopt.addEventListener('click', () => {
      onAdopt(modelRef);
    });

    item.append(label, adopt);
    return item;
  };

  const onAdopt = (modelRef: string): void => {
    if (context === null) return;
    const app = context;

    void (async () => {
      const result = await app.commands.dispatch('scheduler/adopt-model', { modelRef });
      if (!result.ok) {
        write(statusText, `모델 교체 실패: ${result.error.message}`);
        return;
      }

      const missing = result.value.missing.length;
      // 사라진 부재의 연결은 지우지 않는다. 무엇을 잃을지 알려 주고 결정은 사용자가 한다.
      write(
        statusText,
        missing === 0
          ? `${modelRef}를 새 파일로 바꿨다. 사라진 부재는 없다.`
          : `${modelRef}를 새 파일로 바꿨다. 새 모델에 없는 부재 ${String(missing)}개의 연결이 남아 있다.`,
      );
    })();
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
    const models = collected.get('models');
    return {
      schedule: collected.get('schedule') ?? '',
      tasks: collected.get('tasks') ?? '',
      assignments: collected.get('assignments') ?? '',
      // 없으면 필드를 만들지 않는다. 빈 문자열은 "헤더가 없는 파일"이라 거부당한다.
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(models === undefined ? {} : { models }),
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
        warningList = requireElement(options.warningListSelector);
        replacementList = requireElement(options.replacementListSelector);
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

          warningList?.replaceChildren(...payload.warnings.map(createWarningRow));
        }),
        context.events.subscribe('scheduler/model-binding-changed', ({ payload }) => {
          replacementList?.replaceChildren(...payload.replacedRefs.map(createReplacementRow));
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
      warningList = null;
      replacementList = null;
      statusText = null;
      context = null;
      return Promise.resolve();
    },
  };
};
