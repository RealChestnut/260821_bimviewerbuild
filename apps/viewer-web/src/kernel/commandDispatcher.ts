import type {
  AppCommandInput,
  AppCommandName,
  CommandDispatcherPort,
  CommandHandler,
  CommandResult,
  Logger,
  TraceId,
} from '@bim4d/contracts';

export interface CommandDispatcherOptions {
  readonly logger: Logger;
  readonly newTraceId: () => TraceId;
}

type AnyHandler = CommandHandler<AppCommandName>;

/**
 * Command Dispatcher.
 *
 * - Command 하나의 Handler는 하나다. 중복 등록은 즉시 실패한다(구성 오류이므로 예외).
 * - 실행 실패는 예외가 아니라 `CommandResult`로 돌려준다. 호출부가 실패 처리를 빠뜨리지 않게 한다.
 */
export const createCommandDispatcher = (
  options: CommandDispatcherOptions,
): CommandDispatcherPort => {
  const { logger, newTraceId } = options;
  const handlers = new Map<AppCommandName, AnyHandler>();

  const register = <TName extends AppCommandName>(
    name: TName,
    handler: CommandHandler<TName>,
  ): void => {
    if (handlers.has(name)) {
      throw new Error(`Command handler already registered: ${name}`);
    }
    // TName별 handler를 이름 하나로 좁힌 Map에 담기 위한 변환. dispatch에서 같은 이름으로 되돌린다.
    handlers.set(name, handler as unknown as AnyHandler);
  };

  const dispatch = async <TName extends AppCommandName>(
    name: TName,
    input: AppCommandInput<TName>,
    dispatchOptions?: { readonly traceId?: TraceId },
  ): Promise<CommandResult<TName>> => {
    const traceId = dispatchOptions?.traceId ?? newTraceId();
    const handler = handlers.get(name) as CommandHandler<TName> | undefined;

    if (handler === undefined) {
      logger.error('command handler not found', { command: name, traceId });
      return {
        ok: false,
        error: {
          kind: 'not-found',
          code: 'kernel.command.handler-not-found',
          message: `등록된 Command handler가 없다: ${name}`,
          traceId,
        },
      };
    }

    try {
      const value = await handler(input, { traceId });
      return { ok: true, value };
    } catch (cause) {
      logger.error('command handler failed', { command: name, traceId, cause });
      return {
        ok: false,
        error: {
          kind: 'internal',
          code: 'kernel.command.handler-failed',
          message: `Command 실행이 실패했다: ${name}`,
          traceId,
          cause,
        },
      };
    }
  };

  return { register, dispatch };
};
