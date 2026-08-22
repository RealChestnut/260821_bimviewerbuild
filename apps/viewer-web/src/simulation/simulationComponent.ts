import { bindSchedule, computeDisplayStates, parseSchedule, scheduleBounds } from '@bim4d/domain';
import type { ProductDisplayState, ScheduleBounds, SimulationAssignment } from '@bim4d/domain';
import type {
  AppComponent,
  AppContext,
  ModelId,
  ProductKey,
  Schedule,
  Unsubscribe,
} from '@bim4d/contracts';

import '../viewer/model/modelEvents.js';
import './simulationEvents.js';

import type { DisplayStateChange, SimulationViewPort } from './simulationPort.js';

/** 재생 틱 하나를 예약하고, 취소 함수를 돌려준다. */
export type ScheduleTick = (onTick: () => void) => () => void;

export interface SimulationComponentOptions {
  readonly port: SimulationViewPort;
  /** 재생 틱. 테스트는 직접 돌릴 수 있는 구현을 넣는다. */
  readonly scheduleTick?: ScheduleTick;
}

const ONE_DAY = 86_400_000;
/** 재생 시 화면 갱신 간격. 배속은 이 간격당 진행 일수다. */
const TICK_MS = 250;

const defaultScheduleTick: ScheduleTick = (onTick) => {
  const id = globalThis.setInterval(onTick, TICK_MS);
  return () => {
    globalThis.clearInterval(id);
  };
};

const clamp = (value: number, bounds: ScheduleBounds): number =>
  Math.min(bounds.finish, Math.max(bounds.start, value));

/**
 * Mock 4D 시뮬레이션 Component.
 *
 * 상태는 저장하지 않는다. 시각 `t`가 바뀌면 도메인 순수 함수로 전체를 다시 계산하고,
 * 직전에 적용한 것과 달라진 부재만 Port로 보낸다. 이 구조라서 타임라인을 임의 지점으로
 * 건너뛰어도 되고, 앞뒤로 오가도 상태가 누적되지 않는다 (ADR-0002).
 *
 * 일정에 없는 부재는 건드리지 않는다. 미연결 부재는 모든 `t`에서 `PRESENT`이기 때문이며
 * (ADR-0002 경계 규칙 1), 덕분에 모델 전체를 열거할 필요가 없다.
 */
export const createSimulationComponent = (options: SimulationComponentOptions): AppComponent => {
  const { port } = options;
  const scheduleTick = options.scheduleTick ?? defaultScheduleTick;

  let context: AppContext | null = null;
  let registered = false;
  let subscriptions: Unsubscribe[] = [];

  let schedule: Schedule | null = null;
  let timeline: ScheduleBounds | null = null;
  let assignments: readonly SimulationAssignment[] = [];
  let time = 0;

  /** 적재된 모델. 일정의 modelRef는 파일명이므로 displayName으로 찾는다. */
  const modelIdByRef = new Map<string, ModelId>();
  /** 지금 화면에 적용돼 있는 상태. 다음 이동에서 무엇이 바뀌었는지 가릴 기준이다. */
  const applied = new Map<string, ProductDisplayState>();

  let playing = false;
  let speed = 1;
  let stopTicking: (() => void) | null = null;

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const requireSchedule = (): { readonly bounds: ScheduleBounds } => {
    if (timeline === null) throw new Error('일정을 먼저 실어야 한다.');
    return { bounds: timeline };
  };

  /** 일정의 Task 중 시간이 확정된 것만으로 타임라인 양 끝을 잡는다. */
  const timelineOf = (value: Schedule): ScheduleBounds | null => {
    const intervals: { start: number; finish: number }[] = [];
    for (const task of value.tasks) {
      if (task.start === undefined || task.finish === undefined) continue;
      intervals.push({ start: task.start, finish: task.finish });
    }
    return scheduleBounds(intervals);
  };

  /** 계산한 상태와 지금 적용된 상태를 비교해 달라진 것만 화면에 보낸다. */
  const applyStatesAt = async (moment: number): Promise<void> => {
    const app = requireContext();
    const next = computeDisplayStates(assignments, moment);

    const changes: DisplayStateChange[] = [];
    for (const [key, entry] of next) {
      if (applied.get(key)?.state === entry.state) continue;
      changes.push({ product: entry.product, state: entry.state });
      applied.set(key, entry);
    }

    if (changes.length > 0) await port.apply(changes);

    let hiddenCount = 0;
    let inProgressCount = 0;
    let presentCount = 0;
    for (const entry of next.values()) {
      if (entry.state === 'HIDDEN') hiddenCount += 1;
      else if (entry.state === 'IN_PROGRESS') inProgressCount += 1;
      else presentCount += 1;
    }

    await app.events.publish('simulation/states-changed', {
      time: moment,
      changedCount: changes.length,
      hiddenCount,
      inProgressCount,
      presentCount,
    });
  };

  /** 모델이 열리거나 닫히면 할당을 다시 묶고 현재 시각의 상태를 맞춘다. */
  const rebind = async (): Promise<void> => {
    if (schedule === null) return;
    assignments = bindSchedule(schedule, modelIdByRef);
    await applyStatesAt(time);
  };

  const setTime = async (requested: number): Promise<number> => {
    const app = requireContext();
    const { bounds } = requireSchedule();

    time = clamp(requested, bounds);
    // 요청에는 항상 응답한다. 잘린 결과가 제자리여도 화면이 슬라이더를 되돌릴 수 있어야 한다.
    await app.events.publish('simulation/time-changed', { time });
    await applyStatesAt(time);
    return time;
  };

  const setPlaying = async (next: boolean): Promise<boolean> => {
    const app = requireContext();
    if (playing === next) return playing;

    playing = next;
    if (playing) {
      stopTicking = scheduleTick(() => {
        void onTick();
      });
    } else {
      stopTicking?.();
      stopTicking = null;
    }
    await app.events.publish('simulation/playback-changed', { playing, speed });
    return playing;
  };

  const onTick = async (): Promise<void> => {
    if (timeline === null) return;
    // 끝에 닿으면 스스로 멈춘다. 계속 돌면서 같은 시각을 다시 계산할 이유가 없다.
    if (time >= timeline.finish) {
      await setPlaying(false);
      return;
    }
    await setTime(time + speed * ONE_DAY);
  };

  const loadSchedule = async (
    source: unknown,
  ): Promise<{
    readonly scheduleId: string;
    readonly start: number;
    readonly finish: number;
  }> => {
    const app = requireContext();

    const parsed = parseSchedule(source);
    if (!parsed.ok) {
      await app.events.publish('simulation/schedule-load-failed', {
        reason: parsed.error.message,
        code: parsed.error.code,
      });
      throw new Error(parsed.error.message);
    }

    const bounds = timelineOf(parsed.value);
    if (bounds === null) {
      const reason = '시간이 확정된 Task가 하나도 없어 타임라인을 만들 수 없다.';
      await app.events.publish('simulation/schedule-load-failed', {
        reason,
        code: 'simulation.schedule.no-timeline',
      });
      throw new Error(reason);
    }

    await setPlaying(false);
    // 앞서 실린 일정이 걸어 둔 표현을 먼저 되돌린다. 새 일정이 그 부재를 다루지 않을 수 있다.
    await resetApplied();

    schedule = parsed.value;
    timeline = bounds;
    time = bounds.start;
    assignments = bindSchedule(schedule, modelIdByRef);

    const products = new Set(
      schedule.assignments.map((item) => `${item.modelRef}::${item.productGlobalId}`),
    );

    await app.events.publish('simulation/schedule-loaded', {
      scheduleId: schedule.scheduleId,
      name: schedule.name,
      taskCount: schedule.tasks.length,
      assignedProductCount: products.size,
      start: bounds.start,
      finish: bounds.finish,
    });
    await app.events.publish('simulation/time-changed', { time });
    await applyStatesAt(time);

    return { scheduleId: schedule.scheduleId, start: bounds.start, finish: bounds.finish };
  };

  const resetApplied = async (): Promise<void> => {
    if (applied.size === 0) return;
    const products: ProductKey[] = [...applied.values()].map((entry) => entry.product);
    applied.clear();
    await port.reset(products);
  };

  const forgetModel = (modelId: ModelId): void => {
    for (const [ref, id] of modelIdByRef) {
      if (id === modelId) modelIdByRef.delete(ref);
    }
    // 해제된 모델의 부재는 이미 화면에서 사라졌다. 되돌릴 것도, 비교할 기준도 남기지 않는다.
    for (const [key, entry] of applied) {
      if (entry.product.modelId === modelId) applied.delete(key);
    }
  };

  return {
    id: 'simulation',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();

      subscriptions = [
        app.events.subscribe('model/loaded', ({ payload }) => {
          modelIdByRef.set(payload.displayName, payload.modelId);
          void rebind();
        }),
        app.events.subscribe('model/unloaded', ({ payload }) => {
          forgetModel(payload.modelId);
          if (schedule !== null) assignments = bindSchedule(schedule, modelIdByRef);
        }),
      ];

      if (!registered) {
        app.commands.register('simulation/load-schedule', ({ source }) => loadSchedule(source));
        app.commands.register('simulation/set-time', async ({ time: requested }) => ({
          time: await setTime(requested),
        }));
        app.commands.register('simulation/play', async () => {
          requireSchedule();
          return { playing: await setPlaying(true) };
        });
        app.commands.register('simulation/pause', async () => ({
          playing: await setPlaying(false),
        }));
        app.commands.register('simulation/set-speed', async ({ speed: requested }) => {
          if (!Number.isFinite(requested) || requested <= 0) {
            throw new Error(`배속은 0보다 커야 한다: ${String(requested)}`);
          }
          speed = requested;
          await requireContext().events.publish('simulation/playback-changed', { playing, speed });
          return { speed };
        });
        registered = true;
      }
      return Promise.resolve();
    },

    stop: async () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      await setPlaying(false);
    },

    dispose: async () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      stopTicking?.();
      stopTicking = null;
      playing = false;

      await resetApplied();
      modelIdByRef.clear();
      schedule = null;
      timeline = null;
      assignments = [];
      context = null;
    },
  };
};
