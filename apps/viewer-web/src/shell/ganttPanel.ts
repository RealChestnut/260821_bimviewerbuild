import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import '../simulation/simulationEvents.js';
import type { ScheduleTaskRow } from '../scheduler/schedulerEvents.js';

export interface GanttPanelOptions {
  /** 막대 그림 전체. 그릴 기간이 없으면 통째로 감춘다. */
  readonly panelSelector: string;
  readonly axisSelector: string;
  readonly rowListSelector: string;
  readonly cursorSelector: string;
  readonly statusSelector: string;
  /** 이름 칸의 너비. 커서를 막대 칸에만 겹치려면 이 값이 필요하다. */
  readonly labelWidth?: string;
}

const DAY = 86_400_000;
const DEFAULT_LABEL_WIDTH = '12rem';

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`요소를 찾지 못했다: ${selector}`);
  return element;
};

/** 일정의 시각은 UTC 자정 기준이다. 지역 시간대로 바꾸면 하루 어긋나 보인다. */
const formatDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

const formatMonth = (time: number): string => new Date(time).toISOString().slice(0, 7);

/** 다음 달 1일 UTC 자정. 축 눈금을 달 경계에 놓는다. */
const nextMonthStart = (time: number): number => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};

const percent = (ratio: number): string => `${(ratio * 100).toFixed(4)}%`;

/**
 * 일정을 막대 그림으로 그리는 화면 조각.
 *
 * 목록과 같은 순서로 한 줄씩 그린다. `finish`는 그날까지 포함하므로 오른쪽 끝을 하루 뒤로
 * 잡는다. 그러지 않으면 하루짜리 Task의 막대 폭이 0이 되어 보이지 않는다.
 *
 * 시간이 정해지지 않은 Task는 막대를 그리지 않는다. 폭 0으로 두거나 오늘로 옮기면 없는
 * 일정을 있는 것처럼 보여 준다 (ADR-0002 경계 규칙 4).
 */
export const createGanttPanel = (options: GanttPanelOptions): AppComponent => {
  const labelWidth = options.labelWidth ?? DEFAULT_LABEL_WIDTH;

  let context: AppContext | null = null;
  let subscriptions: Unsubscribe[] = [];

  let panel: HTMLElement | null = null;
  let axis: HTMLElement | null = null;
  let rowList: HTMLElement | null = null;
  let cursor: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;

  /** 지금 그리고 있는 기간. 커서를 놓을 때 다시 쓴다. */
  let span: { readonly start: number; readonly end: number } | null = null;

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

  const createRow = (row: ScheduleTaskRow): HTMLLIElement => {
    const item = document.createElement('li');
    item.dataset['testid'] = 'gantt-row';
    item.dataset['taskId'] = row.taskId;
    item.dataset['depth'] = String(row.depth);
    item.dataset['summary'] = String(row.isSummary);

    const label = document.createElement('span');
    label.dataset['testid'] = 'gantt-label';
    label.textContent = row.name;
    label.style.paddingInlineStart = `${String(row.depth)}rem`;
    label.style.width = labelWidth;

    const track = document.createElement('span');
    track.dataset['testid'] = 'gantt-track';

    if (row.start === undefined || row.finish === undefined) {
      item.dataset['timed'] = 'false';
    } else {
      item.dataset['timed'] = 'true';
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

    item.append(label, track);
    return item;
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

    axis.style.marginInlineStart = labelWidth;
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
    // 커서는 막대 칸에만 겹쳐야 한다. 이름 칸 너비만큼 밀고 남은 폭에서 비율을 잡는다.
    cursor.style.left = `calc(${labelWidth} + (100% - ${labelWidth}) * ${ratio.toFixed(6)})`;
  };

  const detach = (): void => {
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
  };

  return {
    id: 'shell.gantt-panel',

    initialize: (appContext: AppContext) => {
      try {
        panel = requireElement(options.panelSelector);
        axis = requireElement(options.axisSelector);
        rowList = requireElement(options.rowListSelector);
        cursor = requireElement(options.cursorSelector);
        statusText = requireElement(options.statusSelector);
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

      subscriptions = [
        context.events.subscribe('scheduler/schedule-changed', ({ payload }) => {
          if (panel !== null) panel.hidden = false;

          if (payload.start === undefined || payload.finish === undefined) {
            // 시간이 확정된 Task가 하나도 없으면 그릴 기간이 없다.
            span = null;
            rowList?.replaceChildren();
            axis?.replaceChildren();
            moveCursor(null);
            write('기간이 정해진 Task가 없다.');
            return;
          }

          span = { start: payload.start, end: payload.finish + DAY };
          write('');
          drawAxis();
          rowList?.replaceChildren(...payload.tasks.map(createRow));
          moveCursor(null);
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
      panel = null;
      axis = null;
      rowList = null;
      cursor = null;
      statusText = null;
      context = null;
      return Promise.resolve();
    },
  };
};
