/**
 * 장기 실행 기능의 생명주기 계약.
 *
 * 모든 Feature Component는 이 계약을 구현한다.
 * Viewer 기능은 `dispose()`가 자원을 실제로 해제하는지 검증해야 완료로 본다.
 */

import type { CommandDispatcherPort } from './commands.js';
import type { EventBusPort } from './events.js';
import type { TraceId } from './errors.js';

export type ComponentId = string;

export interface Logger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/** Component가 Kernel에서 받는 것. Component끼리 직접 참조하지 않는다. */
export interface AppContext {
  readonly events: EventBusPort;
  readonly commands: CommandDispatcherPort;
  readonly logger: Logger;
  newTraceId(): TraceId;
}

/** `initialize` → `start` → `stop` → `dispose` 순서로만 진행한다. */
export type ComponentLifecycleState =
  'created' | 'initialized' | 'started' | 'stopped' | 'disposed';

export interface AppComponent {
  readonly id: ComponentId;
  initialize(context: AppContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
