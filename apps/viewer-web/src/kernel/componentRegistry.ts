import type {
  AppComponent,
  AppContext,
  ComponentId,
  ComponentLifecycleState,
} from '@bim4d/contracts';

export interface ComponentRegistryOptions {
  /** Component가 initialize에서 받는 Context. Kernel이 만들어 넘긴다. */
  readonly context: AppContext;
}

export interface ComponentRegistry {
  register(component: AppComponent): void;
  stateOf(id: ComponentId): ComponentLifecycleState | undefined;
  initializeAll(): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  disposeAll(): Promise<void>;
}

interface Entry {
  readonly component: AppComponent;
  state: ComponentLifecycleState;
}

const requireState = (entry: Entry, allowed: ComponentLifecycleState[], action: string): void => {
  if (!allowed.includes(entry.state)) {
    throw new Error(
      `Component "${entry.component.id}"의 상태가 ${entry.state}이므로 ${action}할 수 없다. ` +
        `허용 상태: ${allowed.join(', ')}`,
    );
  }
};

/**
 * Component Registry.
 *
 * 생명주기는 `initialize` → `start` → `stop` → `dispose` 순서로만 진행한다.
 * 종료 경로(`stop`, `dispose`)는 등록 역순으로 실행하고, 하나가 실패해도 나머지를 계속 해제한다.
 * 해제를 중간에 멈추면 Viewer 자원(GPU 메모리, Worker)이 남기 때문이다.
 */
export const createComponentRegistry = (options: ComponentRegistryOptions): ComponentRegistry => {
  const { context } = options;
  const { logger } = context;
  const entries: Entry[] = [];
  const ids = new Set<ComponentId>();

  const register = (component: AppComponent): void => {
    if (ids.has(component.id)) {
      throw new Error(`Component id already registered: ${component.id}`);
    }
    ids.add(component.id);
    entries.push({ component, state: 'created' });
  };

  const stateOf = (id: ComponentId): ComponentLifecycleState | undefined =>
    entries.find((entry) => entry.component.id === id)?.state;

  const runForward = async (
    action: string,
    allowed: ComponentLifecycleState[],
    next: ComponentLifecycleState,
    run: (entry: Entry) => Promise<void>,
  ): Promise<void> => {
    for (const entry of entries) {
      requireState(entry, allowed, action);
      await run(entry);
      entry.state = next;
    }
  };

  /** 종료 경로는 실패를 모아서 마지막에 던진다. 중간에 멈추면 자원이 남는다. */
  const runReverse = async (
    action: string,
    allowed: ComponentLifecycleState[],
    next: ComponentLifecycleState,
    run: (entry: Entry) => Promise<void>,
  ): Promise<void> => {
    const failures: Error[] = [];
    const failedIds: ComponentId[] = [];
    for (const entry of [...entries].reverse()) {
      if (!allowed.includes(entry.state)) continue;
      try {
        await run(entry);
      } catch (cause) {
        logger.error(`component ${action} failed`, { component: entry.component.id, cause });
        failures.push(new Error(`Component "${entry.component.id}" ${action} 실패`, { cause }));
        failedIds.push(entry.component.id);
      }
      entry.state = next;
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${action} 실패: ${failedIds.join(', ')}`);
    }
  };

  const initializeAll = (): Promise<void> =>
    runForward('initialize', ['created'], 'initialized', (entry) =>
      entry.component.initialize(context),
    );

  const startAll = (): Promise<void> =>
    runForward('start', ['initialized', 'stopped'], 'started', (entry) => entry.component.start());

  const stopAll = (): Promise<void> =>
    runReverse('stop', ['started'], 'stopped', (entry) => entry.component.stop());

  const disposeAll = (): Promise<void> =>
    runReverse('dispose', ['created', 'initialized', 'stopped'], 'disposed', (entry) =>
      entry.component.dispose(),
    );

  return { register, stateOf, initializeAll, startAll, stopAll, disposeAll };
};
