/**
 * 4D 일정과 Task–Element 연결 계약.
 *
 * 어휘의 정본은 `docs/adr/0002-4d-operation-vocabulary.md`, 필드 스키마의 정본은
 * `docs/adr/0006-schedule-schema.md`와 `docs/adr/0007-schedule-schema-v2.md`다. 기준서 17절의 `appear`/`temporary`와
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

/**
 * 선후행 유형. `IfcRelSequence`의 SequenceType에 1:1로 대응한다 (ADR-0007).
 *
 * 이름이 IFC와 같지만 우리 타입이다. Adapter가 표대로 옮기며, IFC의 `USERDEFINED`와
 * `NOTDEFINED`는 받지 않는다.
 */
export type DependencyType = 'FINISH_START' | 'START_START' | 'FINISH_FINISH' | 'START_FINISH';

export interface TaskDependency {
  readonly predecessorId: TaskId;
  readonly successorId: TaskId;
  readonly type: DependencyType;
  /** 지연 일수. 음수는 선행(lead)이다. */
  readonly lagDays: number;
}

export interface ScheduleTask {
  readonly taskId: TaskId;
  readonly name: string;
  /**
   * 상위 Task. 없으면 최상위다.
   *
   * 자식이 있는 Task(요약 Task)는 자기 시간과 할당을 갖지 않는다. 시간은 자손에서
   * 계산한다 (ADR-0007).
   */
  readonly parentTaskId?: TaskId;
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
  /**
   * 내부 표현의 스키마 버전.
   *
   * 파일은 1도 2도 될 수 있으나 읽고 나면 항상 2다. v1은 `parentTaskId` 없음,
   * `dependencies` 빈 배열로 승격된다. 소비자는 버전을 분기하지 않는다 (ADR-0007).
   */
  readonly schemaVersion: 2;
  readonly tasks: readonly ScheduleTask[];
  readonly dependencies: readonly TaskDependency[];
  readonly assignments: readonly ScheduleAssignment[];
}

/**
 * 지금 열려 있는 일정 하나의 보관소.
 *
 * 일정의 주인은 Scheduler다. 다른 모듈은 이 Port로 읽기만 하고 직접 바꾸지 않는다
 * (마스터 계획 5.4절). Phase 4~5는 메모리 구현을 쓰고, Project 저장이 붙는 단계에서
 * SQLite Adapter로 교체한다.
 */
export interface ScheduleRepositoryPort {
  get(): Promise<Schedule | null>;
  save(schedule: Schedule): Promise<void>;
  clear(): Promise<void>;
}
