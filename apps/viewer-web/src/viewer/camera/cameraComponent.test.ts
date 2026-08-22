import { describe, expect, it } from 'vitest';

import { createTestContext } from '../../kernel/testing/testContext.js';
import type { TestContext } from '../../kernel/testing/testContext.js';

import { createCameraComponent } from './cameraComponent.js';
import type { CameraPort, CameraView } from './cameraPort.js';

const view: CameraView = { position: [12, 8, 12], target: [0, 0, 0] };

interface FakePort extends CameraPort {
  readonly calls: string[];
  /** 맞출 모델이 없는 상황을 만든다. */
  fittable: boolean;
}

const createFakePort = (): FakePort => {
  const port: FakePort = {
    calls: [],
    fittable: true,
    getView: () => Promise.resolve(view),
    setView: () => {
      port.calls.push('setView');
      return Promise.resolve();
    },
    fitToModels: () => {
      port.calls.push('fit');
      return Promise.resolve(port.fittable);
    },
  };
  return port;
};

const setup = async (): Promise<{ context: TestContext; port: FakePort }> => {
  const context = createTestContext();
  const port = createFakePort();

  const component = createCameraComponent({ port });
  await component.initialize(context);
  await component.start();

  return { context, port };
};

describe('createCameraComponent', () => {
  it('맞춤 Command가 Port에 그대로 전달된다', async () => {
    const { context, port } = await setup();

    const result = await context.commands.dispatch('viewer/fit-camera', {});

    expect(result).toEqual({ ok: true, value: { fitted: true } });
    expect(port.calls).toEqual(['fit']);
  });

  it('맞출 모델이 없으면 맞추지 못했다고 알린다', async () => {
    const { context, port } = await setup();
    port.fittable = false;

    const result = await context.commands.dispatch('viewer/fit-camera', {});

    expect(result).toEqual({ ok: true, value: { fitted: false } });
  });
});
