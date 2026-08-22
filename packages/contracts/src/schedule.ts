/**
 * 4D 일정과 Task–Element 연결 계약.
 *
 * 어휘의 정본은 `docs/adr/0002-4d-operation-vocabulary.md`, 필드 스키마의 정본은
 * `docs/adr/0006-schedule-schema.md`다. 기준서 17절의 `appear`/`temporary`와
 * 19.2절의 `SHOW`/`HIDE`/`REMOVE`는 폐기된 표기이므로 쓰지 않는다.
 */

import type { GlobalId } from './identity.js';

declare const taskIdBrand: unique symbol;

/** 일정 안에서 작업 하나를 가리키는 식별자. */
export type TaskId = string & { readonly [taskIdBrand]: 'TaskId' };

/** Task가 부재에 무엇을 하는지. 사용자가 지정하고 프로젝트에 저장한다. */
export type TaskOperation = 'CONSTRUCT' | 'DEMOLISH' | 'TEMPORARY' | 'MODIFY';

/** 특정 시각에 Viewer가 부재를 어떻게 그리는지. 저장하지 않고 항상 계산한다. */
export type ElementDisplayState = 'HIDDEN' | 'IN_PROGRESS' | 'PRESENT';

export interface ScheduleTask {
  readonly taskId: TaskId;
  readonly name: string;
  /**
   * 계획 시작. epoch milliseconds.
   *
   * 시간이 정해지지 않은 Task가 있다. 0으로 대체하지 않고 생략한다 (ADR-0002 경계 규칙 4).
   */
  readonly start?: number;
  /** 계획 완료. epoch milliseconds. */
  readonly finish?: number;
}

export interface ScheduleAssignment {
  readonly taskId: TaskId;
  /**
   * 어느 모델의 부재인가.
   *
   * `ModelId`는 적재할 때 만들어지므로 파일에 적을 수 없다. 파일에는 논리 이름을 적고
   * 적재된 모델의 `displayName`과 맞춰 `ModelId`로 바인딩한다.
   */
  readonly modelRef: string;
  readonly productGlobalId: GlobalId;
  readonly operation: TaskOperation;
}

export interface Schedule {
  readonly scheduleId: string;
  readonly name: string;
  /** 스키마가 바뀌면 올린다. 읽는 쪽이 모르는 버전이면 실패로 처리한다. */
  readonly schemaVersion: 1;
  readonly tasks: readonly ScheduleTask[];
  readonly assignments: readonly ScheduleAssignment[];
}
