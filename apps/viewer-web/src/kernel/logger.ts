import type { Logger } from '@bim4d/contracts';

export interface ConsoleLoggerOptions {
  /** 로그 앞에 붙는 이름. 모듈을 구분한다. */
  readonly scope: string;
  readonly minLevel?: 'debug' | 'info' | 'warn' | 'error';
}

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;

/** 개발 중 사용하는 콘솔 Logger. 배포 빌드에서는 Adapter로 교체한다. */
export const createConsoleLogger = (options: ConsoleLoggerOptions): Logger => {
  const threshold = LEVEL_ORDER[options.minLevel ?? 'info'];

  const write =
    (level: keyof typeof LEVEL_ORDER) =>
    (message: string, details?: Readonly<Record<string, unknown>>): void => {
      if (LEVEL_ORDER[level] < threshold) return;
      const line = `[${options.scope}] ${message}`;
      if (details === undefined) {
        console[level](line);
        return;
      }
      console[level](line, details);
    };

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
};
