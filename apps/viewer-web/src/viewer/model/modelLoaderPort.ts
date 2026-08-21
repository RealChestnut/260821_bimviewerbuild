import type { ModelId } from '@bim4d/contracts';

/**
 * IFC 바이트를 화면에 올릴 수 있는 형태로 바꾸는 Port.
 *
 * Feature는 이 인터페이스만 본다. That Open IfcLoader와 Fragments는 Adapter 뒤에 있다.
 * Port를 넘나드는 것은 바이트와 식별자뿐이며, Mesh나 Fragment 객체는 넘기지 않는다.
 */
export interface ModelLoadRequest {
  readonly modelId: ModelId;
  /** 원본 IFC 바이트. 읽기 전용으로 다루며 Adapter가 수정하지 않는다. */
  readonly bytes: Uint8Array;
  /** 사용자에게 보여 주는 이름. 보통 파일명이다. */
  readonly displayName: string;
  /** 0에서 1 사이. Adapter가 진행률을 알 수 있을 때만 호출한다. */
  readonly onProgress?: (fraction: number) => void;
}

export interface ModelLoaderPort {
  load(request: ModelLoadRequest): Promise<void>;
  /** 없는 모델을 해제해도 오류가 아니다. 해제한 것이 있으면 true. */
  unload(modelId: ModelId): Promise<boolean>;
  /** 현재 Scene에 올라가 있는 모델. 해제 누락을 검증할 때 쓴다. */
  loadedModelIds(): readonly ModelId[];
}
