import {
  effectiveTaskTimes,
  flattenTasks,
  parseSchedule,
  parseScheduleCsv,
  serializeScheduleCsv,
  serializeScheduleJson,
  validateSchedule,
} from '@bim4d/domain';
import type { Parsed, ScheduleCsvBundle, ScheduleCsvFile } from '@bim4d/domain';
import type {
  AppComponent,
  AppContext,
  Schedule,
  ScheduleRepositoryPort,
  TaskId,
} from '@bim4d/contracts';

import './schedulerEvents.js';
import type {
  ScheduleExportFormat,
  ScheduleTaskRow,
  ScheduleWarningRow,
} from './schedulerEvents.js';

/** JSON 내보내기의 파일 이름. CSV 네 파일과 마찬가지로 고정한다. */
const JSON_FILE_NAME = 'schedule.json';

export interface SchedulerComponentOptions {
  readonly repository: ScheduleRepositoryPort;
}

/**
 * 일정을 소유하는 Component.
 *
 * 파일에서 읽어 검증하고 보관소에 넣는다. 다른 모듈은 보관소에서 읽고, 바뀌었다는
 * 사실만 Event로 받는다. 일정을 직접 고치는 곳은 여기뿐이다 (마스터 계획 5.4절).
 */
export const createSchedulerComponent = (options: SchedulerComponentOptions): AppComponent => {
  const { repository } = options;

  let context: AppContext | null = null;
  let registered = false;

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  /** 화면이 그릴 줄로 옮긴다. 시간은 요약 Task까지 계산된 값을 쓴다. */
  const toRows = (schedule: Schedule): readonly ScheduleTaskRow[] => {
    const times = effectiveTaskTimes(schedule);

    const assignedCounts = new Map<TaskId, number>();
    for (const assignment of schedule.assignments) {
      assignedCounts.set(assignment.taskId, (assignedCounts.get(assignment.taskId) ?? 0) + 1);
    }

    return flattenTasks(schedule).map((row) => {
      const time = times.get(row.task.taskId);
      return {
        taskId: row.task.taskId,
        name: row.task.name,
        depth: row.depth,
        isSummary: row.isSummary,
        ...(time === undefined ? {} : { start: time.start, finish: time.finish }),
        assignedCount: assignedCounts.get(row.task.taskId) ?? 0,
      };
    });
  };

  const toWarnings = (schedule: Schedule): readonly ScheduleWarningRow[] =>
    validateSchedule(schedule).map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.taskId === undefined ? {} : { taskId: warning.taskId }),
    }));

  const publishSchedule = async (schedule: Schedule): Promise<void> => {
    const times = effectiveTaskTimes(schedule);

    let start: number | undefined;
    let finish: number | undefined;
    for (const time of times.values()) {
      if (start === undefined || time.start < start) start = time.start;
      if (finish === undefined || time.finish > finish) finish = time.finish;
    }

    await requireContext().events.publish('scheduler/schedule-changed', {
      scheduleId: schedule.scheduleId,
      name: schedule.name,
      ...(start === undefined ? {} : { start }),
      ...(finish === undefined ? {} : { finish }),
      tasks: toRows(schedule),
      warnings: toWarnings(schedule),
    });
  };

  /**
   * 읽기 결과를 보관소와 화면에 반영한다.
   *
   * JSON과 CSV는 들어오는 모양만 다르고 그 뒤는 같다. 실패 처리도 같은 자리에 둔다.
   * 오류 코드가 `schedule.parse.*`인지 `schedule.csv.*`인지만 다르게 나온다 (ADR-0007).
   */
  const commit = async (
    parsed: Parsed<Schedule>,
  ): Promise<{ readonly scheduleId: string; readonly taskCount: number }> => {
    const app = requireContext();

    if (!parsed.ok) {
      // 실패하면 앞서 실린 일정을 그대로 둔다. 읽지 못한 파일 때문에 쓰던 것을 잃지 않는다.
      await app.events.publish('scheduler/load-failed', {
        reason: parsed.error.message,
        code: parsed.error.code,
      });
      throw new Error(parsed.error.message);
    }

    await repository.save(parsed.value);
    await publishSchedule(parsed.value);

    return { scheduleId: parsed.value.scheduleId, taskCount: parsed.value.tasks.length };
  };

  const loadSchedule = (
    source: unknown,
  ): Promise<{ readonly scheduleId: string; readonly taskCount: number }> =>
    commit(parseSchedule(source));

  const loadScheduleCsv = (
    bundle: ScheduleCsvBundle,
  ): Promise<{ readonly scheduleId: string; readonly taskCount: number }> =>
    commit(parseScheduleCsv(bundle));

  /**
   * 지금 열려 있는 일정을 파일로 쓴다.
   *
   * 읽어 들인 파일이 v1이었어도 v2로 나간다. 내부 표현이 v2 하나이기 때문이다 (ADR-0006).
   */
  const exportSchedule = async (
    format: ScheduleExportFormat,
  ): Promise<{ readonly files: readonly ScheduleCsvFile[] }> => {
    const schedule = await repository.get();
    if (schedule === null) {
      throw new Error('열려 있는 일정이 없다.');
    }

    return {
      files:
        format === 'csv'
          ? serializeScheduleCsv(schedule)
          : [{ fileName: JSON_FILE_NAME, content: serializeScheduleJson(schedule) }],
    };
  };

  return {
    id: 'scheduler',

    initialize: (appContext: AppContext) => {
      context = appContext;
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();
      if (registered) return Promise.resolve();

      app.commands.register('scheduler/load-schedule', ({ source }) => loadSchedule(source));
      app.commands.register('scheduler/load-schedule-csv', ({ bundle }) => loadScheduleCsv(bundle));
      app.commands.register('scheduler/export-schedule', ({ format }) => exportSchedule(format));
      registered = true;
      return Promise.resolve();
    },

    stop: () => Promise.resolve(),

    dispose: async () => {
      await repository.clear();
      context = null;
    },
  };
};
