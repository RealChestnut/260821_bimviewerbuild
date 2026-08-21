/** 적재된 모델의 메타데이터와 보관소 Port. */

import type { ModelFingerprint, ModelId } from './identity.js';

/**
 * Header의 `FILE_SCHEMA`에서 판별한 Schema 버전.
 * 파일명이나 확장자로 추정하지 않는다.
 */
export type IfcSchemaVersion = 'IFC2X3' | 'IFC4' | 'IFC4X3';

export interface ModelRecord {
  readonly modelId: ModelId;
  /** 사용자에게 보여 주는 이름. 보통 파일명이다. */
  readonly displayName: string;
  /** 원본 IFC 내용의 SHA-256. 모델 버전 식별과 파생물 캐시 무효화에 쓴다. */
  readonly fingerprint: ModelFingerprint;
  /** 판별에 실패했으면 생략한다. 추정값을 넣지 않는다. */
  readonly schema?: IfcSchemaVersion;
  /** epoch milliseconds. */
  readonly loadedAt: number;
}

/**
 * 적재된 모델의 메타데이터 보관소.
 *
 * 형상 데이터나 Three.js 객체는 담지 않는다. 모듈 사이를 오가는 것은 식별자와 메타데이터뿐이다.
 * Phase 1은 메모리 구현을 쓰고, Project 저장이 붙는 단계에서 SQLite Adapter로 교체한다.
 */
export interface ModelRepositoryPort {
  add(record: ModelRecord): Promise<void>;
  get(modelId: ModelId): Promise<ModelRecord | undefined>;
  list(): Promise<readonly ModelRecord[]>;
  /** 없는 modelId를 지워도 오류가 아니다. 지운 것이 있으면 true. */
  remove(modelId: ModelId): Promise<boolean>;
  clear(): Promise<void>;
}
