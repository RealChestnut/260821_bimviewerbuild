import type { AppComponent, AppContext, Unsubscribe } from '@bim4d/contracts';

import '../simulation/simulationEvents.js';

export interface SimulationPanelOptions {
  readonly fileInputSelector: string;
  readonly timeSliderSelector: string;
  readonly playButtonSelector: string;
  readonly speedSelectSelector: string;
  readonly dateSelector: string;
  readonly statusSelector: string;
}

const IDLE_TEXT = '일정 없음';
const ONE_DAY = 86_400_000;

const requireElement = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`요소를 찾지 못했다: ${selector}`);
  }
  return element;
};

const requireOf = <TElement extends HTMLElement>(
  selector: string,
  constructor: new () => TElement,
  label: string,
): TElement => {
  const element = requireElement(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`${label} 요소가 아니다: ${selector}`);
  }
  return element;
};

/**
 * 달력 날짜로 표시한다.
 *
 * 일정의 시각은 UTC 자정 기준이다. 지역 시간대로 바꿔 쓰면 같은 파일이 보는 사람에 따라
 * 하루 어긋나 보인다.
 */
const formatDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

/**
 * 4D 시뮬레이션 조작을 다루는 화면 조각.
 *
 * 상태는 Event로만 받는다. 슬라이더를 움직여도 스스로 값을 확정하지 않고 Command를 보낸 뒤
 * `simulation/time-changed`를 받아 반영한다. 그래야 구간 밖 값이 잘렸을 때 화면이 따라간다.
 */
export const createSimulationPanel = (options: SimulationPanelOptions): AppComponent => {
  let context: AppContext | null = null;
  let fileInput: HTMLInputElement | null = null;
  let slider: HTMLInputElement | null = null;
  let playButton: HTMLButtonElement | null = null;
  let speedSelect: HTMLSelectElement | null = null;
  let dateText: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let subscriptions: Unsubscribe[] = [];

  let playing = false;
  let hasSchedule = false;

  const write = (target: HTMLElement | null, value: string): void => {
    if (target !== null) target.textContent = value;
  };

  const setControlsEnabled = (enabled: boolean): void => {
    if (slider !== null) slider.disabled = !enabled;
    if (playButton !== null) playButton.disabled = !enabled;
    if (speedSelect !== null) speedSelect.disabled = !enabled;
  };

  const onSliderInput = (): void => {
    if (context === null || slider === null) return;
    const time = Number(slider.value);
    if (!Number.isFinite(time)) return;
    void context.commands.dispatch('simulation/set-time', { time });
  };

  const onPlayClicked = (): void => {
    if (context === null) return;
    // 지금 재생 중인지는 playback-changed로만 안다. 버튼이 자기 상태를 지어내지 않는다.
    void context.commands.dispatch(playing ? 'simulation/pause' : 'simulation/play', {});
  };

  const onSpeedChanged = (): void => {
    if (context === null || speedSelect === null) return;
    const speed = Number(speedSelect.value);
    if (!Number.isFinite(speed) || speed <= 0) return;
    void context.commands.dispatch('simulation/set-speed', { speed });
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
        // JSON으로 읽히지도 않으면 Command를 보낼 것이 없다. 여기서 알린다.
        const reason = cause instanceof Error ? cause.message : String(cause);
        write(statusText, `일정 열기 실패: ${reason}`);
        if (fileInput !== null) fileInput.value = '';
        return;
      }

      await app.commands.dispatch('simulation/load-schedule', { source });
      // 같은 파일을 다시 고를 수 있도록 값을 비운다.
      if (fileInput !== null) fileInput.value = '';
    })();
    // 적재 실패 이유는 simulation/schedule-load-failed로 화면에 나온다.
  };

  return {
    id: 'shell.simulation-panel',

    initialize: (appContext: AppContext) => {
      try {
        fileInput = requireOf(options.fileInputSelector, HTMLInputElement, 'input');
        slider = requireOf(options.timeSliderSelector, HTMLInputElement, 'input');
        playButton = requireOf(options.playButtonSelector, HTMLButtonElement, 'button');
        speedSelect = requireOf(options.speedSelectSelector, HTMLSelectElement, 'select');
        dateText = requireElement(options.dateSelector);
        statusText = requireElement(options.statusSelector);
      } catch (cause) {
        return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
      }

      context = appContext;
      setControlsEnabled(false);
      write(dateText, IDLE_TEXT);
      write(statusText, '');
      return Promise.resolve();
    },

    start: () => {
      if (context === null || fileInput === null || slider === null) {
        throw new Error('initialize를 먼저 호출해야 한다.');
      }
      if (subscriptions.length > 0) return Promise.resolve();

      fileInput.addEventListener('change', onFileChosen);
      slider.addEventListener('input', onSliderInput);
      playButton?.addEventListener('click', onPlayClicked);
      speedSelect?.addEventListener('change', onSpeedChanged);

      subscriptions = [
        context.events.subscribe('simulation/schedule-loaded', ({ payload }) => {
          hasSchedule = true;
          if (slider !== null) {
            slider.min = String(payload.start);
            slider.max = String(payload.finish);
            slider.step = String(ONE_DAY);
            slider.value = String(payload.start);
          }
          setControlsEnabled(true);
          write(dateText, formatDate(payload.start));
          write(statusText, `${payload.name} · Task ${String(payload.taskCount)}개`);
        }),
        context.events.subscribe('simulation/schedule-load-failed', ({ payload }) => {
          if (!hasSchedule) setControlsEnabled(false);
          write(statusText, `일정 열기 실패: ${payload.reason}`);
        }),
        context.events.subscribe('simulation/time-changed', ({ payload }) => {
          if (slider !== null) slider.value = String(payload.time);
          write(dateText, formatDate(payload.time));
        }),
        context.events.subscribe('simulation/playback-changed', ({ payload }) => {
          playing = payload.playing;
          write(playButton, playing ? '정지' : '재생');
        }),
        context.events.subscribe('simulation/states-changed', ({ payload }) => {
          write(
            statusText,
            `진행 ${String(payload.inProgressCount)} · 표시 ${String(payload.presentCount)} · 숨김 ${String(payload.hiddenCount)}`,
          );
        }),
      ];

      return Promise.resolve();
    },

    stop: () => {
      fileInput?.removeEventListener('change', onFileChosen);
      slider?.removeEventListener('input', onSliderInput);
      playButton?.removeEventListener('click', onPlayClicked);
      speedSelect?.removeEventListener('change', onSpeedChanged);
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      return Promise.resolve();
    },

    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      fileInput?.removeEventListener('change', onFileChosen);
      slider?.removeEventListener('input', onSliderInput);
      playButton?.removeEventListener('click', onPlayClicked);
      speedSelect?.removeEventListener('change', onSpeedChanged);

      fileInput = null;
      slider = null;
      playButton = null;
      speedSelect = null;
      dateText = null;
      statusText = null;
      hasSchedule = false;
      playing = false;
      context = null;
      return Promise.resolve();
    },
  };
};
