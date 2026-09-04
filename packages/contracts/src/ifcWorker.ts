/**
 * IFC Worker 계약.
 *
 * 전송 방식이 여기 등장하지 않는다. 지금 구현은 자식 프로세스 stdio지만(ADR-0009),
 * Named Pipe나 HTTP로 바뀌어도 이 파일은 그대로다.
 *
 * 그래서 **어느 전송으로도 지킬 수 있는 것만** 넣는다. 진행률 콜백이나 취소처럼 전송마다
 * 뜻이 달라지는 것은 넣지 않는다. 넣는 순간 이 Port가 전송을 전제하게 되고 결정을
 * 되돌릴 수 없게 된다.
 *
 * 큰 파일은 값이 아니라 경로로 오간다. 수백 MB를 메시지에 실으면 어느 전송이든 무너진다.
 */

/** 수령 파일 점검 결과. 사실만 담는다. 받아들일지는 부르는 쪽이 정한다 (ADR-0009). */
export interface IfcMetadata {
  /** Header의 FILE_SCHEMA에서 읽은 값. 파일명으로 추정하지 않는다. */
  readonly schema: string;
  readonly productCount: number;
  /** Entity 이름별 개수. */
  readonly products: Readonly<Record<string, number>>;
  readonly duplicateGlobalIds: readonly string[];
  readonly missingGlobalIdCount: number;
  readonly hasWorkSchedule: boolean;
  readonly units: { readonly length: string | null };
}

export interface IfcScheduleExportInput {
  /** 읽기만 하는 원본. */
  readonly sourcePath: string;
  /** 쓸 자리. 워커가 저장 위치를 정하지 않는다. */
  readonly outputPath: string;
  /** 일정 v3 JSON. 검증은 도메인의 `parseSchedule`이 한다. */
  readonly schedule: unknown;
}

export interface IfcScheduleExportResult {
  readonly outputPath: string;
  readonly taskCount: number;
  /** 그 파일에 옮길 수 없어 건너뛴 부재 연결 수. 조용히 버리지 않는다. */
  readonly skippedAssignments: number;
}

export interface IfcWorkerPort {
  /** 워커가 살아 있는지 본다. */
  ping(): Promise<void>;

  inspect(path: string): Promise<IfcMetadata>;

  /**
   * IFC에 든 일정을 읽는다.
   *
   * 결과는 검증하지 않은 v3 JSON이다. 해석 지점을 하나로 두기 위해 `parseSchedule`에
   * 넘기는 일은 부르는 쪽이 한다 (ADR-0005 결과절).
   */
  importSchedule(path: string): Promise<unknown>;

  exportSchedule(input: IfcScheduleExportInput): Promise<IfcScheduleExportResult>;

  /** 워커를 끝낸다. 이후의 호출은 실패한다. */
  dispose(): Promise<void>;
}
