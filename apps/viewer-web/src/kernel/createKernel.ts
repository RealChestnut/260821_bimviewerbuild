import type { AppComponent, AppContext, Logger } from '@bim4d/contracts';

import { createCommandDispatcher } from './commandDispatcher.js';
import { createComponentRegistry } from './componentRegistry.js';
import type { ComponentRegistry } from './componentRegistry.js';
import { createEventBus } from './eventBus.js';
import { createConsoleLogger } from './logger.js';
import { createTraceIdFactory } from './traceId.js';

export interface KernelOptions {
  /** 주입하지 않으면 콘솔 Logger를 쓴다. */
  readonly logger?: Logger;
}

export interface Kernel {
  readonly context: AppContext;
  readonly registry: ComponentRegistry;
  register(component: AppComponent): void;
  /** Component를 모두 initialize한 뒤 start한다. */
  start(): Promise<void>;
  /** start의 역순으로 stop하고 dispose한다. 실패해도 남은 Component를 계속 해제한다. */
  shutdown(): Promise<void>;
}

/** Event Bus, Command Dispatcher, Component Registry를 묶어 애플리케이션 Kernel을 만든다. */
export const createKernel = (options: KernelOptions = {}): Kernel => {
  const logger = options.logger ?? createConsoleLogger({ scope: 'kernel' });
  const newTraceId = createTraceIdFactory();

  const context: AppContext = {
    logger,
    newTraceId,
    events: createEventBus({ logger }),
    commands: createCommandDispatcher({ logger, newTraceId }),
  };

  const registry = createComponentRegistry({ context });

  const start = async (): Promise<void> => {
    await registry.initializeAll();
    await registry.startAll();
  };

  const shutdown = async (): Promise<void> => {
    try {
      await registry.stopAll();
    } finally {
      await registry.disposeAll();
    }
  };

  return {
    context,
    registry,
    register: (component) => {
      registry.register(component);
    },
    start,
    shutdown,
  };
};
