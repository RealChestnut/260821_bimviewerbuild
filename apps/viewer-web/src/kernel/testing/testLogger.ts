import type { Logger } from '@bim4d/contracts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TestLogger extends Logger {
  readonly entries: readonly LogEntry[];
}

/** 테스트에서 로그 호출을 검사하기 위한 Logger. 출력하지 않고 기록만 한다. */
export const createTestLogger = (): TestLogger => {
  const entries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, details?: Readonly<Record<string, unknown>>): void => {
      entries.push(details === undefined ? { level, message } : { level, message, details });
    };

  return {
    entries,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
};
