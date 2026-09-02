/**
 * 일정의 `modelRef`와 적재된 모델을 잇는 자리.
 *
 * 일정 파일에는 `ModelId`를 적을 수 없다. `ModelId`는 모델을 적재할 때 만들어지는 런타임
 * 값이고 일정 파일은 모델보다 오래 살기 때문이다 (ADR-0005 맥락절). 그래서 파일에는 논리
 * 이름을 적고 적재된 모델과 맞춘다.
 *
 * 지금의 맞춤 규칙은 파일명 대조이며 ADR-0005가 잠정으로 표시했다. Phase 6에서 fingerprint
 * 기반으로 교체할 때 바뀌는 것은 이 Port의 구현 하나다. 부재를 Task에 걸 때도, 걸린 부재를
 * 3D에서 찾을 때도 모두 이 Port를 지나므로 변환 규칙이 한 자리에 남는다.
 */

import type { ModelId } from './identity.js';

export interface ModelRefBindingPort {
  /** 일정이 적어 둔 이름으로 적재된 모델을 찾는다. 열려 있지 않으면 `null`이다. */
  idOf(modelRef: string): ModelId | null;

  /** 적재된 모델을 일정에 적을 이름으로 바꾼다. 묶여 있지 않으면 `null`이다. */
  refOf(modelId: ModelId): string | null;

  /** 지금 묶여 있는 짝 전부. 일정 전체를 한 번에 묶을 때 쓴다. */
  entries(): ReadonlyMap<string, ModelId>;
}
