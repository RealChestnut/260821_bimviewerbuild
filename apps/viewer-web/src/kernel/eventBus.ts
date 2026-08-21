import type {
  AppEvent,
  AppEventName,
  AppEventPayload,
  EventBusPort,
  EventHandler,
  Logger,
  TraceId,
  Unsubscribe,
} from '@bim4d/contracts';

export interface EventBusOptions {
  readonly logger: Logger;
  /** 테스트에서 시간을 고정하기 위한 주입 지점. */
  readonly now?: () => number;
}

type AnyHandler = EventHandler<AppEventName>;

/**
 * Typed Event Bus.
 *
 * - handler 하나가 실패해도 나머지 handler는 계속 호출한다. 실패는 로그로 남긴다.
 * - 발행 시점의 구독자 목록을 복사해서 호출한다. 발행 도중 추가된 구독자는 다음 Event부터 받는다.
 * - payload에는 식별자와 요약만 싣는다. Mesh, Fragment, 파일 바이트는 넣지 않는다.
 */
export const createEventBus = (options: EventBusOptions): EventBusPort => {
  const { logger } = options;
  const now = options.now ?? (() => Date.now());
  const handlers = new Map<AppEventName, Set<AnyHandler>>();

  const publish = async <TName extends AppEventName>(
    name: TName,
    payload: AppEventPayload<TName>,
    publishOptions?: { readonly traceId?: TraceId },
  ): Promise<void> => {
    const subscribers = handlers.get(name);
    if (subscribers === undefined || subscribers.size === 0) return;

    const traceId = publishOptions?.traceId;
    const event: AppEvent<TName> = {
      name,
      payload,
      publishedAt: now(),
      ...(traceId === undefined ? {} : { traceId }),
    };

    // 발행 도중 구독이 바뀌어도 이번 Event의 대상은 고정한다.
    const snapshot = [...subscribers];
    for (const handler of snapshot) {
      try {
        await (handler as EventHandler<TName>)(event);
      } catch (cause) {
        logger.error('event handler failed', {
          event: name,
          ...(traceId === undefined ? {} : { traceId }),
          cause,
        });
      }
    }
  };

  const subscribe = <TName extends AppEventName>(
    name: TName,
    handler: EventHandler<TName>,
  ): Unsubscribe => {
    const existing = handlers.get(name) ?? new Set<AnyHandler>();
    existing.add(handler as AnyHandler);
    handlers.set(name, existing);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = handlers.get(name);
      if (current === undefined) return;
      current.delete(handler as AnyHandler);
      if (current.size === 0) handlers.delete(name);
    };
  };

  return { publish, subscribe };
};
