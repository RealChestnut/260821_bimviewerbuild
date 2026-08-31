/**
 * Scheduler 슬라이스가 발행하는 Event와 받는 Command.
 *
 * 일정의 주인은 Scheduler다. 다른 모듈은 `ScheduleRepositoryPort`로 읽고, 바뀌었다는
 * 사실만 Event로 받는다 (마스터 계획 5.4절).
 *
 * Event에는 화면이 그릴 값만 싣는다. 부재 GlobalId 목록처럼 시뮬레이션이 쓰는 것은
 * 보관소에서 읽는다.
 */

import type { ScheduleCsvBundle, ScheduleCsvFile } from '@bim4d/domain';
import type { TaskId } from '@bim4d/contracts';

/**
 * 일정을 내보낼 형식.
 *
 * 어느 쪽이든 결과는 파일 목록 하나다. JSON은 한 개, CSV는 네 개다 (ADR-0007). 받는
 * 쪽이 개수로 분기하지 않게 형식을 맞춘다.
 */
export type ScheduleExportFormat = 'json' | 'csv';

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
    'scheduler/load-schedule-csv': {
      /** 파일 내용만 담은 묶음. 파일 이름으로 역할을 가르는 일은 Adapter가 끝내 둔다. */
      input: { readonly bundle: ScheduleCsvBundle };
      output: { readonly scheduleId: string; readonly taskCount: number };
    };
    'scheduler/export-schedule': {
      input: { readonly format: ScheduleExportFormat };
      /** 파일 이름까지 정해서 준다. 저장 위치와 방법은 Adapter가 정한다. */
      output: { readonly files: readonly ScheduleCsvFile[] };
    };
  }
}

export {};
