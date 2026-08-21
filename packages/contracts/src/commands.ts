/**
 * Command Dispatcher 계약.
 *
 * Command 하나의 Handler는 원칙적으로 하나다. 같은 이름에 두 번째 Handler를 등록하면 오류다.
 */

import type { AppError, TraceId } from './errors.js';

/**
 * 이 애플리케이션이 받는 모든 Command의 이름과 입력/출력 매핑.
 *
 * Feature 슬라이스가 선언 병합으로 항목을 추가한다.
 *
 * ```ts
 * declare module '@bim4d/contracts' {
 *   interface AppCommandMap {
 *     'viewer/load-model': { input: { path: string }; output: { modelId: ModelId } };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Feature 슬라이스가 선언 병합으로 채우는 확장 지점이다.
export interface AppCommandMap {}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 선언 병합 전에는 keyof가 never다.
export type AppCommandName = keyof AppCommandMap & string;

export type AppCommandInput<TName extends AppCommandName> = AppCommandMap[TName] extends {
  input: infer TInput;
}
  ? TInput
  : never;

export type AppCommandOutput<TName extends AppCommandName> = AppCommandMap[TName] extends {
  output: infer TOutput;
}
  ? TOutput
  : never;

export interface CommandContext {
  readonly traceId: TraceId;
}

export type CommandHandler<TName extends AppCommandName> = (
  input: AppCommandInput<TName>,
  context: CommandContext,
) => Promise<AppCommandOutput<TName>>;

/** 성공과 실패를 예외 대신 값으로 돌려준다. 호출부가 실패 처리를 빠뜨리지 않게 한다. */
export type CommandResult<TName extends AppCommandName> =
  | { readonly ok: true; readonly value: AppCommandOutput<TName> }
  | { readonly ok: false; readonly error: AppError };

export interface CommandDispatcherPort {
  register<TName extends AppCommandName>(name: TName, handler: CommandHandler<TName>): void;

  dispatch<TName extends AppCommandName>(
    name: TName,
    input: AppCommandInput<TName>,
    options?: { readonly traceId?: TraceId },
  ): Promise<CommandResult<TName>>;
}
