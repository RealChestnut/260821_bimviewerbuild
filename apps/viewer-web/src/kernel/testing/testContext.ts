import type { AppContext } from '@bim4d/contracts';

import { createCommandDispatcher } from '../commandDispatcher.js';
import { createEventBus } from '../eventBus.js';

import { createTestLogger } from './testLogger.js';
import type { TestLogger } from './testLogger.js';

export interface TestContext extends AppContext {
  readonly logger: TestLogger;
}

/** 테스트용 Context. 실제 Event Bus와 Command Dispatcher를 쓰고 Logger만 기록형으로 바꾼다. */
export const createTestContext = (): TestContext => {
  const logger = createTestLogger();
  let counter = 0;
  const newTraceId = (): string => `trace-${String(++counter)}`;

  return {
    logger,
    newTraceId,
    events: createEventBus({ logger }),
    commands: createCommandDispatcher({ logger, newTraceId }),
  };
};
