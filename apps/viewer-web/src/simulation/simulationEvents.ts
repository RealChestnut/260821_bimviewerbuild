/**
 * 시뮬레이션 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 상태 자체는 Event로 옮기지 않는다. 부재별 상태는 수천 개가 될 수 있고 화면이 필요로 하는
 * 것은 요약이다. 실제 표현은 Port를 통해 Adapter로 간다.
 *
 * 일정을 싣고 검증하는 것은 Scheduler의 몫이다. 이 슬라이스는 보관소에서 읽기만 한다.
 */

declare module '@bim4d/contracts' {
  interface AppEventMap {
    /**
     * 시뮬레이션이 다룰 수 있는 타임라인이 생겼다.
     *
     * 일정을 싣는 것은 Scheduler의 몫이다. 여기서는 그 일정에서 만들어진 시간 구간만 알린다.
     * 시간이 확정된 Task가 하나도 없어 구간을 만들 수 없으면 발행하지 않는다.
     */
    'simulation/timeline-changed': {
      /** 타임라인 양 끝. epoch milliseconds. */
      readonly start: number;
      readonly finish: number;
    };
    'simulation/time-changed': { readonly time: number };
    'simulation/playback-changed': {
      readonly playing: boolean;
      /** 틱당 진행 일수. */
      readonly speed: number;
    };
    'simulation/states-changed': {
      readonly time: number;
      /** 이번 이동으로 표현이 바뀐 부재 수. 바뀌지 않은 부재는 세지 않는다. */
      readonly changedCount: number;
      readonly hiddenCount: number;
      readonly inProgressCount: number;
      readonly presentCount: number;
    };
  }

  interface AppCommandMap {
    'simulation/set-time': {
      input: { readonly time: number };
      output: { readonly time: number };
    };
    'simulation/play': {
      input: Record<string, never>;
      output: { readonly playing: boolean };
    };
    'simulation/pause': {
      input: Record<string, never>;
      output: { readonly playing: boolean };
    };
    'simulation/set-speed': {
      input: { readonly speed: number };
      output: { readonly speed: number };
    };
  }
}

export {};
