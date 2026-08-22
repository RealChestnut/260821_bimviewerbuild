/**
 * 시뮬레이션 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 상태 자체는 Event로 옮기지 않는다. 부재별 상태는 수천 개가 될 수 있고 화면이 필요로 하는
 * 것은 요약이다. 실제 표현은 Port를 통해 Adapter로 간다.
 */

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'simulation/schedule-loaded': {
      readonly scheduleId: string;
      readonly name: string;
      readonly taskCount: number;
      /** 일정이 가리키는 서로 다른 부재 수. 모델이 열렸는지와 무관하다. */
      readonly assignedProductCount: number;
      /** 타임라인 양 끝. epoch milliseconds. */
      readonly start: number;
      readonly finish: number;
    };
    'simulation/schedule-load-failed': {
      readonly reason: string;
      /** 기계가 분기할 수 있는 안정된 코드. */
      readonly code: string;
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
    'simulation/load-schedule': {
      /** JSON.parse를 끝낸 값. 검증은 도메인이 한다. */
      input: { readonly source: unknown };
      output: { readonly scheduleId: string; readonly start: number; readonly finish: number };
    };
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
