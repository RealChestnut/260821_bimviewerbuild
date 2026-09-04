import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  IfcMetadata,
  IfcScheduleExportInput,
  IfcScheduleExportResult,
  IfcWorkerPort,
} from '@bim4d/contracts';

/**
 * 자식 프로세스와 줄 단위 JSON으로 말하는 IFC Worker 클라이언트.
 *
 * 규약의 정본은 `docs/adr/0009-ifc-worker-ipc.md`다. 이 파일이 전송을 아는 유일한
 * 자리이며, Named Pipe나 HTTP로 바뀌면 여기만 갈아 끼운다.
 */

/** 부모가 아는 규약 버전. 워커가 다른 값을 말하면 계속 말하지 않는다. */
export const PROTOCOL_VERSION = 1;

/** 기계가 분기할 수 있는 코드를 가진 실패. 워커가 낸 코드를 그대로 옮긴다. */
export class IfcWorkerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IfcWorkerError';
    this.code = code;
  }
}

export interface StdioIfcWorkerOptions {
  /** 실행 파일. 보통 `python`이다. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** 요청 하나의 마감. 넘기면 프로세스를 죽인다. */
  readonly timeoutMs?: number;
  /**
   * 이어서 이만큼 죽으면 더 띄우지 않는다.
   *
   * 크래시 직후 다시 죽는 워커를 계속 살리면 부팅 루프가 된다.
   */
  readonly maxConsecutiveFailures?: number;
}

interface Pending {
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: IfcWorkerError) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_FAILURES = 3;

/** stderr는 사람이 읽는 곳이다. 마지막 몇 줄만 들고 있다가 실패 메시지에 붙인다. */
const STDERR_KEEP = 4000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const createStdioIfcWorker = (options: StdioIfcWorkerOptions): IfcWorkerPort => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_FAILURES;

  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  let stdoutBuffer = '';
  let stderrTail = '';
  let consecutiveFailures = 0;
  let disposed = false;
  let nextId = 0;

  const pending = new Map<string, Pending>();
  /** 한 번에 하나만 보낸다. 워커 안에서 IfcOpenShell을 동시에 굴리면 메모리가 배로 든다. */
  let queue: Promise<unknown> = Promise.resolve();

  const failAllPending = (error: IfcWorkerError): void => {
    for (const [, entry] of pending) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  /**
   * 프로세스를 놓는다. 다음 요청에서 다시 띄운다.
   *
   * 놓는 즉시 `child`를 비운다. 그래야 이 프로세스의 뒤늦은 이벤트가 새 프로세스를
   * 건드리지 않는다.
   */
  const dropChild = (error: IfcWorkerError): void => {
    const dying = child;
    child = null;
    ready = null;
    stdoutBuffer = '';
    failAllPending(error);
    dying?.kill();
  };

  const onLine = (line: string): void => {
    const parsed: unknown = JSON.parse(line);
    const message = asRecord(parsed);
    if (message === null) return;

    const id = message['id'];
    if (typeof id !== 'string') return;

    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    if (entry.timer !== null) clearTimeout(entry.timer);

    /*
     * 답을 하나 받았다는 것이 성한 워커라는 증거다. 뜨는 데 성공한 것만으로 세지 않는다.
     * 요청마다 뜨고 죽는 워커는 매번 새로 떠서 실패 횟수가 늘지 않는다.
     */
    consecutiveFailures = 0;

    if (message['ok'] === true) {
      entry.resolve(asRecord(message['result']) ?? {});
      return;
    }

    const error = asRecord(message['error']);
    const code = error?.['code'];
    const reason = error?.['message'];
    entry.reject(
      new IfcWorkerError(
        typeof code === 'string' ? code : 'worker.internal',
        typeof reason === 'string' ? reason : '알 수 없는 실패',
      ),
    );
  };

  /** 워커를 띄우고 준비 줄을 기다린다. */
  const start = (): Promise<void> => {
    if (ready !== null) return ready;

    if (consecutiveFailures >= maxFailures) {
      return Promise.reject(
        new IfcWorkerError(
          'worker.unavailable',
          `Worker가 이어서 ${String(consecutiveFailures)}번 죽었다. 마지막 기록: ${stderrTail.trim()}`,
        ),
      );
    }

    const spawned = spawn(options.command, [...options.args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child = spawned;
    spawned.stdout.setEncoding('utf8');
    spawned.stderr.setEncoding('utf8');

    ready = new Promise<void>((resolve, reject) => {
      const settleReady = (error: IfcWorkerError | null): void => {
        if (error === null) {
          resolve();
          return;
        }
        reject(error);
      };

      /*
       * 놓은 프로세스의 이벤트는 무시한다. 마감을 넘겨 죽인 워커의 exit이 뒤늦게 와서
       * 방금 띄운 새 워커를 죽이는 일이 있었다.
       */
      const isCurrent = (): boolean => child === spawned;

      spawned.stdout.on('data', (chunk: string) => {
        if (!isCurrent()) return;
        stdoutBuffer += chunk;

        let newline = stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline).trim();
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          newline = stdoutBuffer.indexOf('\n');
          if (line === '') continue;

          let message: Record<string, unknown> | null;
          try {
            message = asRecord(JSON.parse(line));
          } catch {
            // stdout은 프로토콜 전용이다. 섞인 줄은 규약 위반이므로 프로세스를 놓는다.
            const broken = new IfcWorkerError(
              'worker.protocol.broken',
              `stdout에 JSON이 아닌 줄이 섞였다: ${line.slice(0, 200)}`,
            );
            settleReady(broken);
            dropChild(broken);
            return;
          }

          if (message?.['event'] === 'ready') {
            if (message['protocol'] !== PROTOCOL_VERSION) {
              const mismatch = new IfcWorkerError(
                'worker.protocol.mismatch',
                `규약 버전이 다르다: ${String(message['protocol'])}`,
              );
              settleReady(mismatch);
              dropChild(mismatch);
              return;
            }
            settleReady(null);
            continue;
          }

          onLine(line);
        }
      });

      spawned.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_KEEP);
      });

      spawned.on('error', (cause: Error) => {
        if (!isCurrent()) return;
        const failure = new IfcWorkerError('worker.spawn-failed', cause.message);
        consecutiveFailures += 1;
        settleReady(failure);
        dropChild(failure);
      });

      spawned.on('exit', (code) => {
        // 살아 있어야 할 때 죽었다. 남은 요청은 전부 실패로 돌려준다.
        if (disposed || !isCurrent()) return;
        consecutiveFailures += 1;
        const failure = new IfcWorkerError(
          'worker.crashed',
          `Worker가 종료됐다 (code ${String(code)}). 마지막 기록: ${stderrTail.trim()}`,
        );
        settleReady(failure);
        dropChild(failure);
      });
    });

    return ready;
  };

  const send = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    if (disposed) throw new IfcWorkerError('worker.disposed', '이미 끝낸 Worker다.');

    await start();
    const spawned = child;
    if (spawned === null) throw new IfcWorkerError('worker.unavailable', 'Worker가 없다.');

    nextId += 1;
    const id = String(nextId);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        timer: setTimeout(() => {
          pending.delete(id);
          // 마감을 넘긴 워커는 자기 시계를 못 본다. 부모가 죽인다 (ADR-0009).
          const timedOut = new IfcWorkerError(
            'worker.timeout',
            `${method}이 ${String(timeoutMs)}ms 안에 끝나지 않았다.`,
          );
          reject(timedOut);
          dropChild(timedOut);
        }, timeoutMs),
      };
      pending.set(id, entry);

      spawned.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (cause) => {
        if (cause === null || cause === undefined) return;
        pending.delete(id);
        if (entry.timer !== null) clearTimeout(entry.timer);
        reject(new IfcWorkerError('worker.write-failed', cause.message));
      });
    });
  };

  /** 요청을 줄 세운다. 앞의 것이 실패해도 뒤의 것은 제 차례에 나간다. */
  const request = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const turn = queue.then(
      () => send(method, params),
      () => send(method, params),
    );
    queue = turn.catch(() => undefined);
    return await turn;
  };

  return {
    ping: async () => {
      await request('ping', {});
    },

    inspect: async (path) => (await request('inspect', { path })) as unknown as IfcMetadata,

    importSchedule: async (path) => (await request('import-schedule', { path }))['schedule'],

    exportSchedule: async (input: IfcScheduleExportInput) =>
      (await request('export-schedule', {
        sourcePath: input.sourcePath,
        outputPath: input.outputPath,
        schedule: input.schedule,
      })) as unknown as IfcScheduleExportResult,

    dispose: () => {
      disposed = true;
      const dying = child;
      child = null;
      ready = null;
      failAllPending(new IfcWorkerError('worker.disposed', 'Worker를 끝냈다.'));
      // stdin을 닫으면 워커가 EOF를 보고 스스로 끝낸다. 그래도 남으면 죽인다.
      dying?.stdin.end();
      dying?.kill();
      return Promise.resolve();
    },
  };
};
