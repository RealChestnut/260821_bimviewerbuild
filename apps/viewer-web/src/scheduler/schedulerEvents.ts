/**
 * Scheduler 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 일정의 주인은 Scheduler다. 다른 모듈은 `ScheduleRepositoryPort`로 읽고, 바뀌었다는
 * 사실만 Event로 받는다 (마스터 계획 5.4절).
 *
 * Event에는 화면이 그릴 값만 싣는다. 부재 GlobalId 목록처럼 시뮬레이션이 쓰는 것은
 * 보관소에서 읽는다.
 */

import type { TaskId } from '@bim4d/contracts';

/** 화면에 한 줄로 그릴 Task. */
export interface ScheduleTaskRow {
  readonly taskId: TaskId;
  readonly name: string;
  /** 들여쓰기 깊이. 최상위가 0이다. */
  readonly depth: number;
  readonly isSummary: boolean;
  /** 계산된 시간. epoch milliseconds. 알 수 없으면 없다. */
  readonly start?: number;
  readonly finish?: number;
  readonly assignedCount: number;
}

export interface ScheduleWarningRow {
  readonly code: string;
  readonly message: string;
  readonly taskId?: TaskId;
}

declare module '@bim4d/contracts' {
  interface AppEventMap {
    'scheduler/schedule-changed': {
      readonly scheduleId: string;
      readonly name: string;
      /** 시간이 확정된 Task 전체를 덮는 구간. 하나도 없으면 없다. */
      readonly start?: number;
      readonly finish?: number;
      readonly tasks: readonly ScheduleTaskRow[];
      readonly warnings: readonly ScheduleWarningRow[];
    };
    'scheduler/load-failed': {
      readonly reason: string;
      /** 기계가 분기할 수 있는 안정된 코드. */
      readonly code: string;
    };
  }

  interface AppCommandMap {
    'scheduler/load-schedule': {
      /** JSON.parse를 끝낸 값. 검증은 도메인이 한다. */
      input: { readonly source: unknown };
      output: { readonly scheduleId: string; readonly taskCount: number };
    };
  }
}

export {};
