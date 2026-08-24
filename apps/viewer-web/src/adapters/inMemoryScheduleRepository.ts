import type { Schedule, ScheduleRepositoryPort } from '@bim4d/contracts';

/**
 * 메모리 기반 ScheduleRepository.
 *
 * 한 번에 한 일정만 열린다. Project 저장이 붙는 단계에서 SQLite Adapter로 교체하며,
 * 그때 Port 계약은 그대로 둔다.
 */
export const createInMemoryScheduleRepository = (): ScheduleRepositoryPort => {
  let current: Schedule | null = null;

  return {
    get: () => Promise.resolve(current),

    save: (schedule) => {
      current = schedule;
      return Promise.resolve();
    },

    clear: () => {
      current = null;
      return Promise.resolve();
    },
  };
};
