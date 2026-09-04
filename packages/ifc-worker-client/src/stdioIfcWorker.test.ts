import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { IfcWorkerPort } from '@bim4d/contracts';

import { createStdioIfcWorker, IfcWorkerError } from './stdioIfcWorker.js';

const workerDir = fileURLToPath(new URL('../../../services/ifc-worker', import.meta.url));
const fixture = fileURLToPath(
  new URL('../../../packages/test-fixtures/ifc/three-elements-ifc4.ifc', import.meta.url),
);

/** 로컬과 CI가 부르는 이름이 다를 수 있다. */
const python = process.env['PYTHON'] ?? 'python';

const workers: IfcWorkerPort[] = [];

const track = (worker: IfcWorkerPort): IfcWorkerPort => {
  workers.push(worker);
  return worker;
};

const realWorker = (timeoutMs = 120_000): IfcWorkerPort =>
  track(
    createStdioIfcWorker({
      command: python,
      args: ['-m', 'ifc_worker'],
      cwd: workerDir,
      timeoutMs,
    }),
  );

/** 규약을 흉내 내는 가짜 워커. 수명과 실패를 시험할 때 쓴다. */
const fakeWorker = (script: string, timeoutMs = 500): IfcWorkerPort => {
  const dir = mkdtempSync(join(tmpdir(), 'ifc-worker-'));
  const path = join(dir, 'fake.mjs');
  writeFileSync(path, script, 'utf8');

  return track(
    createStdioIfcWorker({
      command: process.execPath,
      args: [path],
      timeoutMs,
      maxConsecutiveFailures: 2,
    }),
  );
};

const READY = `process.stdout.write(JSON.stringify({ event: 'ready', protocol: 1 }) + '\\n');`;

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (cause) {
    if (cause instanceof IfcWorkerError) return cause.code;
    throw cause;
  }
  throw new Error('실패하지 않았다.');
};

const outputPath = (): string => join(mkdtempSync(join(tmpdir(), 'ifc-out-')), 'out.ifc');

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.dispose();
});

describe('createStdioIfcWorker — 실제 Worker', () => {
  it('띄우고 ping에 답한다', async () => {
    await expect(realWorker().ping()).resolves.toBeUndefined();
  });

  it('IFC를 점검한다', async () => {
    const metadata = await realWorker().inspect(fixture);

    expect(metadata.schema).toBe('IFC4');
    expect(metadata.productCount).toBe(3);
    expect(metadata.hasWorkSchedule).toBe(false);
  });

  it('워커가 낸 오류 코드를 그대로 옮긴다', async () => {
    const worker = realWorker();

    expect(await codeOf(() => worker.inspect(join(workerDir, '없다.ifc')))).toBe(
      'worker.file.not-found',
    );
  });

  it('한 프로세스로 여러 요청을 이어서 처리한다', async () => {
    const worker = realWorker();

    // 요청은 줄을 선다. 앞의 응답과 뒤의 응답이 섞이지 않는다.
    const [first, second] = await Promise.all([worker.inspect(fixture), worker.inspect(fixture)]);

    expect(first.productCount).toBe(3);
    expect(second.productCount).toBe(3);
  });

  it('일정을 IFC로 쓰고 다시 읽는다', async () => {
    const worker = realWorker();
    const schedule = {
      scheduleId: 'mock',
      name: '왕복',
      schemaVersion: 3,
      models: [{ modelRef: 'three-elements-ifc4.ifc' }],
      tasks: [{ taskId: 'T001', name: '슬래브', start: '2026-03-02', finish: '2026-03-06' }],
      dependencies: [],
      assignments: [
        {
          taskId: 'T001',
          modelRef: 'three-elements-ifc4.ifc',
          productGlobalId: '2YsHnV6bk3PgZdL9uCxWtM',
          operation: 'CONSTRUCT',
        },
      ],
    };
    const target = outputPath();

    const written = await worker.exportSchedule({
      sourcePath: fixture,
      outputPath: target,
      schedule,
    });
    const read = (await worker.importSchedule(target)) as typeof schedule;

    expect(written.taskCount).toBe(1);
    expect(written.skippedAssignments).toBe(0);
    expect(read.tasks[0]).toMatchObject({ taskId: 'T001', start: '2026-03-02' });
    expect(read.assignments[0]).toMatchObject({ taskId: 'T001', operation: 'CONSTRUCT' });
  });

  it('일정이 없는 모델을 읽으면 코드로 알린다', async () => {
    const worker = realWorker();

    expect(await codeOf(() => worker.importSchedule(fixture))).toBe('worker.schedule.not-found');
  });
});

describe('createStdioIfcWorker — 수명', () => {
  it('마감을 넘기면 프로세스를 죽이고 알린다', async () => {
    // 준비만 알리고 아무 답도 하지 않는 워커.
    const worker = fakeWorker(`${READY}\nprocess.stdin.resume();`);

    expect(await codeOf(() => worker.ping())).toBe('worker.timeout');
  });

  it('마감으로 죽인 뒤에도 다음 요청은 새 프로세스로 처리한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ifc-worker-'));
    const flag = join(dir, 'flag');
    const script = `
      import { existsSync, writeFileSync } from 'node:fs';
      ${READY}
      const answered = existsSync(${JSON.stringify(flag)});
      writeFileSync(${JSON.stringify(flag)}, 'x');
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf('\\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\\n');
          const { id } = JSON.parse(line);
          // 처음 뜬 프로세스는 답하지 않는다. 두 번째부터 답한다.
          if (answered) process.stdout.write(JSON.stringify({ id, ok: true, result: {} }) + '\\n');
        }
      });
    `;
    const path = join(dir, 'fake.mjs');
    writeFileSync(path, script, 'utf8');
    const worker = track(
      createStdioIfcWorker({ command: process.execPath, args: [path], timeoutMs: 400 }),
    );

    expect(await codeOf(() => worker.ping())).toBe('worker.timeout');
    await expect(worker.ping()).resolves.toBeUndefined();
  });

  it('워커가 죽으면 크래시로 알린다', async () => {
    const worker = fakeWorker(`${READY}\nprocess.stdin.on('data', () => process.exit(9));`);

    expect(await codeOf(() => worker.ping())).toBe('worker.crashed');
  });

  it('이어서 죽으면 더 띄우지 않는다', async () => {
    const worker = fakeWorker(`${READY}\nprocess.stdin.on('data', () => process.exit(9));`);

    await codeOf(() => worker.ping());
    await codeOf(() => worker.ping());

    // 부팅 루프를 만들지 않는다. 사람이 볼 수 있게 멈춘다.
    expect(await codeOf(() => worker.ping())).toBe('worker.unavailable');
  });

  it('규약 버전이 다르면 말하지 않는다', async () => {
    const worker = fakeWorker(
      `process.stdout.write(JSON.stringify({ event: 'ready', protocol: 999 }) + '\\n');\nprocess.stdin.resume();`,
    );

    expect(await codeOf(() => worker.ping())).toBe('worker.protocol.mismatch');
  });

  it('stdout에 JSON이 아닌 줄이 섞이면 놓는다', async () => {
    const worker = fakeWorker(
      `process.stdout.write('사람이 읽는 줄\\n');\nprocess.stdin.resume();`,
    );

    expect(await codeOf(() => worker.ping())).toBe('worker.protocol.broken');
  });

  it('실행 파일이 없으면 알린다', async () => {
    const worker = track(
      createStdioIfcWorker({ command: 'this-command-does-not-exist', args: [], timeoutMs: 2000 }),
    );

    expect(['worker.spawn-failed', 'worker.crashed']).toContain(await codeOf(() => worker.ping()));
  });

  it('끝낸 뒤에는 부르지 않는다', async () => {
    const worker = realWorker();
    await worker.ping();

    await worker.dispose();

    expect(await codeOf(() => worker.ping())).toBe('worker.disposed');
  });
});
