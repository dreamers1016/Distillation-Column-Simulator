// Pure-math tests for the camera flights (no WebGL: Vector3 / PerspectiveCamera only).
import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import {
  CameraDirector,
  CAPTION_SAFE_LEFT_FRACTION,
  FLIGHT_TIME_CONSTANT_S,
  framingOffset,
  rightInsetFor,
  smoothFactor,
  type FlightControls,
} from '../../src/scene/camera';
import { isClick, resolvePart } from '../../src/scene/picking';

/** Minimal OrbitControls stand-in: a target plus a 'start' (user drag) event. */
function fakeControls() {
  const listeners = new Set<() => void>();
  const controls: FlightControls = {
    target: new Vector3(),
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
  };
  return { controls, drag: () => listeners.forEach((fn) => fn()), listenerCount: () => listeners.size };
}

function simulate(seconds: number, hz: number, step: (dt: number) => void) {
  const dt = 1 / hz;
  for (let i = 0; i < Math.round(seconds * hz); i++) step(dt);
}

describe('smoothFactor', () => {
  it('equals 1 - e^-1 at dt = time constant (0.35 s)', () => {
    expect(FLIGHT_TIME_CONSTANT_S).toBe(0.35);
    expect(Math.abs(smoothFactor(0.35) - (1 - Math.exp(-1)))).toBeLessThan(1e-9);
  });
  it('is 0 for dt = 0 and approaches 1 for large dt', () => {
    expect(smoothFactor(0)).toBe(0);
    expect(smoothFactor(10)).toBeGreaterThan(0.999999);
  });
});

describe('frame-rate independence of the exponential approach', () => {
  const runTo = (hz: number) => {
    const pos = new Vector3(40, 30, -20);
    const goal = new Vector3(2, 7, 1);
    const start = pos.distanceTo(goal);
    simulate(3, hz, (dt) => pos.lerp(goal, smoothFactor(dt)));
    return { remaining: pos.distanceTo(goal), start, pos };
  };
  it('after 3 s the distance is < 1 % of the start at 60 Hz and at 15 Hz', () => {
    for (const hz of [60, 15]) {
      const { remaining, start } = runTo(hz);
      expect(remaining / start).toBeLessThan(0.01);
    }
  });
  it('60 Hz and 15 Hz end within 1 % of each other', () => {
    const a = runTo(60);
    const b = runTo(15);
    expect(a.pos.distanceTo(b.pos) / a.start).toBeLessThan(0.01);
  });
  it('a mixed frame-rate schedule matches the uniform one', () => {
    const goal = new Vector3(0, 5, 0);
    const a = new Vector3(30, 0, 30);
    const b = a.clone();
    const start = a.distanceTo(goal);
    simulate(1.5, 60, (dt) => a.lerp(goal, smoothFactor(dt)));
    simulate(1.5, 15, (dt) => a.lerp(goal, smoothFactor(dt)));
    simulate(3, 30, (dt) => b.lerp(goal, smoothFactor(dt)));
    expect(a.distanceTo(b) / start).toBeLessThan(0.01);
  });
});

describe('framingOffset', () => {
  const W = 1920;
  const H = 1080;
  const fov = 36;
  const d = 20;
  const worldPerPx = (2 * d * Math.tan((fov * Math.PI) / 360)) / H;

  it('is zero when nothing obstructs the view', () => {
    expect(framingOffset(W, H, fov, d, { captionSafe: false })).toBeCloseTo(0, 12);
    expect(framingOffset(W, H, fov, d)).toBeCloseTo(0, 12);
  });
  it('caption-safe centres the object in the right 62 % of the viewport', () => {
    expect(CAPTION_SAFE_LEFT_FRACTION).toBeCloseTo(0.38, 12);
    const offset = framingOffset(W, H, fov, d, { captionSafe: true });
    // Object must land at x = 0.38W + 0.31W = 0.69W, i.e. 0.19W right of centre.
    // Moving the look point left (negative along camera-right) pushes the object right.
    expect(offset).toBeCloseTo(-0.19 * W * worldPerPx, 9);
    expect(W / 2 - offset / worldPerPx).toBeCloseTo(0.38 * W + 0.31 * W, 6);
  });
  it('rightInsetPx centres the object in the region left of the panel', () => {
    const inset = 400;
    const offset = framingOffset(W, H, fov, d, { captionSafe: false, rightInsetPx: inset });
    expect(W / 2 - offset / worldPerPx).toBeCloseTo((W - inset) / 2, 6);
    expect(offset).toBeGreaterThan(0); // look point moves right, object appears left of centre
  });
  it('combines caption-safe and right inset (centre of [0.38W, W - inset])', () => {
    const inset = 400;
    const offset = framingOffset(W, H, fov, d, { captionSafe: true, rightInsetPx: inset });
    expect(W / 2 - offset / worldPerPx).toBeCloseTo((0.38 * W + W - inset) / 2, 6);
  });
  it('scales linearly with distance', () => {
    const a = framingOffset(W, H, fov, 10, { captionSafe: true });
    const b = framingOffset(W, H, fov, 30, { captionSafe: true });
    expect(b / a).toBeCloseTo(3, 9);
  });
});

describe('CameraDirector', () => {
  const make = () => {
    const camera = new PerspectiveCamera(36, 16 / 9, 0.1, 300);
    camera.position.set(18, 14, 26);
    const { controls, drag, listenerCount } = fakeControls();
    controls.target.set(0, 7, 0);
    const director = new CameraDirector(camera, controls, () => ({ width: 1920, height: 1080 }));
    return { camera, controls, director, drag, listenerCount };
  };

  it('converges on the goal at the requested distance within 3 s', () => {
    const { camera, controls, director } = make();
    const target = new Vector3(3, 12, -2);
    director.flyTo(target, 8);
    simulate(3, 60, (dt) => director.update(dt));
    expect(controls.target.distanceTo(target)).toBeLessThan(0.01);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(8, 1);
    expect(director.flying).toBe(false);
  });

  it('60 Hz and 15 Hz flights finish at the same pose', () => {
    const poses = [60, 15].map((hz) => {
      const { camera, controls, director } = make();
      director.flyTo(new Vector3(0, 20, 0), 12);
      simulate(3, hz, (dt) => director.update(dt));
      return { p: camera.position.clone(), t: controls.target.clone() };
    });
    expect(poses[0].p.distanceTo(poses[1].p)).toBeLessThan(0.3);
    expect(poses[0].t.distanceTo(poses[1].t)).toBeLessThan(0.3);
  });

  it('caption-safe flight puts the object in the right 62 % of the viewport', () => {
    const { camera, director } = make();
    const target = new Vector3(0, 10, 0);
    director.flyTo(target, 15, { captionSafe: true });
    simulate(4, 60, (dt) => director.update(dt));
    camera.updateMatrixWorld();
    const ndc = target.clone().project(camera);
    const px = ((ndc.x + 1) / 2) * 1920;
    expect(px).toBeGreaterThan(0.38 * 1920);
    expect(px).toBeCloseTo(0.69 * 1920, -1);
  });

  it('rightInsetPx keeps the object left of the panel', () => {
    const { camera, director } = make();
    const target = new Vector3(0, 10, 0);
    director.flyTo(target, 15, { rightInsetPx: 460 });
    simulate(4, 60, (dt) => director.update(dt));
    camera.updateMatrixWorld();
    const ndc = target.clone().project(camera);
    expect(((ndc.x + 1) / 2) * 1920).toBeCloseTo((1920 - 460) / 2, -1);
  });

  it('cancels the flight when the user drags', () => {
    const { camera, controls, director, drag } = make();
    director.flyTo(new Vector3(0, 30, 0), 6);
    simulate(0.2, 60, (dt) => director.update(dt));
    expect(director.flying).toBe(true);
    drag();
    expect(director.flying).toBe(false);
    const frozen = camera.position.clone();
    const frozenT = controls.target.clone();
    simulate(1, 60, (dt) => director.update(dt));
    expect(camera.position.equals(frozen)).toBe(true);
    expect(controls.target.equals(frozenT)).toBe(true);
  });

  it('dispose detaches the drag listener', () => {
    const { director, listenerCount } = make();
    expect(listenerCount()).toBe(1);
    director.dispose();
    expect(listenerCount()).toBe(0);
  });
});

describe('picking helpers', () => {
  it('isClick: under 5 px of movement is a click, 5 px or more is a drag', () => {
    expect(isClick([100, 100], [103, 103])).toBe(true);
    expect(isClick([100, 100], [100, 105])).toBe(false);
    expect(isClick([100, 100], [110, 100])).toBe(false);
  });
  it('resolvePart walks up the parent chain to the nearest userData.part', () => {
    const root = new Object3D();
    root.userData.part = { kind: 'column' };
    const tray = new Object3D();
    tray.userData.part = { kind: 'tray', tray: 4 };
    const mesh = new Object3D();
    root.add(tray);
    tray.add(mesh);
    expect(resolvePart(mesh)).toEqual({ kind: 'tray', tray: 4 });
    expect(resolvePart(root)).toEqual({ kind: 'column' });
    expect(resolvePart(new Object3D())).toBeNull();
  });
});

describe('rightInsetFor (Explore panel covering the right edge)', () => {
  it('side panel: covered width from its left edge to the viewport edge', () => {
    // 460 px panel with a 14 px right margin on a 1920 px viewport
    expect(rightInsetFor({ left: 1446, width: 460 }, 1920)).toBe(474);
  });
  it('bottom sheet (<= 900 px layout: full width) covers no right edge: 0', () => {
    expect(rightInsetFor({ left: 0, width: 900 }, 900)).toBe(0);
    expect(rightInsetFor({ left: 0, width: 375 }, 375)).toBe(0);
  });
  it('hidden panel (Lecture view, 0 × 0 rect): 0', () => {
    expect(rightInsetFor({ left: 0, width: 0 }, 1920)).toBe(0);
  });
});
