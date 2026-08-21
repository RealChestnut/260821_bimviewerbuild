/** Kernel 공통 오류 모델. 모든 모듈이 같은 형태로 실패를 보고한다. */

/** 하나의 작업 흐름을 로그에서 잇기 위한 추적 ID. */
export type TraceId = string;

/** 오류 분류. 처리 정책이 달라지는 축으로만 나눈다. */
export type AppErrorKind =
  /** 입력이 계약을 위반했다. 재시도해도 같은 결과다. */
  | 'invalid-input'
  /** 요청한 대상이 없다. */
  | 'not-found'
  /** 현재 상태에서 허용되지 않는 요청이다. */
  | 'invalid-state'
  /** 외부 자원(파일, Worker, 저장소)에서 실패했다. */
  | 'external'
  /** 예상하지 못한 내부 오류다. */
  | 'internal';

export interface AppError {
  readonly kind: AppErrorKind;
  /** 기계가 분기할 수 있는 안정된 코드. 예: `model.load.unsupported-schema` */
  readonly code: string;
  /** 사람이 읽는 설명. 사용자 문구가 아니라 개발자 문구다. */
  readonly message: string;
  readonly traceId?: TraceId;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}
