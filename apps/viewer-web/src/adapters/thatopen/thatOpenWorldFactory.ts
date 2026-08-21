import * as OBC from '@thatopen/components';

import type { ViewerWorld, ViewerWorldFactory } from '../../viewer/viewerWorldPort.js';

export interface ThatOpenWorldFactoryOptions {
  /** 카메라 초기 위치와 바라보는 지점. 단위는 미터다. */
  readonly initialCamera?: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
  };
}

const DEFAULT_CAMERA = {
  position: [12, 8, 12],
  target: [0, 0, 0],
} as const;

/**
 * That Open Components로 Viewer World를 만드는 Adapter.
 *
 * 이 파일이 `@thatopen/components`를 직접 참조하는 유일한 Viewer 경로다.
 * Feature는 `ViewerWorldPort`만 본다.
 *
 * `components.dispose()`는 World와 SimpleRenderer를 함께 해제한다. SimpleRenderer는 캔버스를
 * DOM에서 제거하고 `forceContextLoss()`까지 호출하므로, 해제 후 컨테이너에 캔버스가 남지 않는다.
 */
export const createThatOpenWorldFactory = (
  options: ThatOpenWorldFactoryOptions = {},
): ViewerWorldFactory => ({
  create: (container: HTMLElement): ViewerWorld => {
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();

    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera = new OBC.SimpleCamera(components);

    components.init();
    world.scene.setup();

    const camera = options.initialCamera ?? DEFAULT_CAMERA;
    const [px, py, pz] = camera.position;
    const [tx, ty, tz] = camera.target;
    void world.camera.controls.setLookAt(px, py, pz, tx, ty, tz);

    let disposed = false;

    return {
      id: world.uuid,

      setEnabled: (enabled: boolean): void => {
        if (disposed) return;
        world.enabled = enabled;
      },

      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        components.dispose();
      },
    };
  },
});
