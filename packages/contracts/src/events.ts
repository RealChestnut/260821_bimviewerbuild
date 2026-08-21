/**
 * Typed Event Bus 계약.
 *
 * 규칙:
 * - 이벤트 이름을 코드 여러 곳에 문자열로 직접 쓰지 않는다. 이름은 `AppEventMap`의 키로만 등장한다.
 * - Event Bus로 IFC 전체 바이트, Mesh, Fragment 데이터를 전달하지 않는다. 식별자와 요약만 싣는다.
 * - 조회 응답을 Event로 구현하지 않는다. 조회는 Port/Repository를 직접 호출한다.
 */

import type { TraceId } from './errors.js';

/**
 * 이 애플리케이션이 발행하는 모든 Event의 이름과 payload 매핑.
 *
 * 각 Feature는 자기 슬라이스 안에서 선언 병합으로 항목을 추가한다.
 *
 * ```ts
 * declare module '@bim4d/contracts' {
 *   interface AppEventMap {
 *     'viewer/model-loaded': { modelId: ModelId };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Feature 슬라이스가 선언 병합으로 채우는 확장 지점이다.
export interface AppEventMap {}

/** `AppEventMap`에 등록된 Event 이름. */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 선언 병합 전에는 keyof가 never다.
export type AppEventName = keyof AppEventMap & string;

/** Event 이름 하나에 대응하는 payload 타입. */
export type AppEventPayload<TName extends AppEventName> = AppEventMap[TName];

/** 발행된 Event 하나. payload와 함께 추적 정보를 싣는다. */
export interface AppEvent<TName extends AppEventName = AppEventName> {
  readonly name: TName;
  readonly payload: AppEventPayload<TName>;
  /** epoch milliseconds. */
  readonly publishedAt: number;
  readonly traceId?: TraceId;
}

export type EventHandler<TName extends AppEventName> = (
  event: AppEvent<TName>,
) => void | Promise<void>;

/** 구독 해지 함수. 호출은 멱등이다. */
export type Unsubscribe = () => void;

export interface EventBusPort {
  publish<TName extends AppEventName>(
    name: TName,
    payload: AppEventPayload<TName>,
    options?: { readonly traceId?: TraceId },
  ): Promise<void>;

  subscribe<TName extends AppEventName>(name: TName, handler: EventHandler<TName>): Unsubscribe;
}
