// Pure-math tests for the camera flights (no WebGL: Vector3 / PerspectiveCamera only).
import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Vector3 } from 'three';
import {
  bottomInsetFor,
  boundsFromPose,
  CameraDirector,
  CAMERA_FOV_DEG,
  CAPTION_SAFE_LEFT_FRACTION,
  FIT_MARGIN,
  fitPose,
  FLIGHT_TIME_CONSTANT_S,
  framingOffset,
  framingOffsetY,
  rightInsetFor,
  smoothFactor,
  visibleRegion,
  type FlightControls,
  type FramingOptions,
} from '../../src/scene/camera';
import { isClick, Picker, resolvePart } from '../../src/scene/picking';

/** Minimal event target counting its listeners (the controls' canvas). */
class FakeDom {
  private readonly map = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, fn: (e: Event) => void) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void) {
    this.map.get(type)?.delete(fn);
  }
  emit(type: string, props: Record<string, number> = {}) {
    this.emitWith(type, props);
  }
  /** Like emit, with non-numeric fields (isPrimary). Pointers are primary unless told otherwise. */
  emitWith(type: string, props: Record<string, number | boolean> = {}) {
    const e = Object.assign(new Event(type), { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: 0, clientY: 0, ...props });
    this.map.get(type)?.forEach((fn) => fn(e));
  }
  count() {
    let n = 0;
    this.map.forEach((s) => (n += s.size));
    return n;
  }
}

/** Minimal OrbitControls stand-in: target, distance limits and the canvas the user drags on. */
function fakeControls(minDistance = 2, maxDistance = 90) {
  const dom = new FakeDom();
  const controls: FlightControls = { target: new Vector3(), minDistance, maxDistance, domElement: dom };
  /** A press, a move of `px` pixels and a release. */
  const drag = (px = 40) => {
    dom.emit('pointerdown', { clientX: 100, clientY: 100 });
    dom.emit('pointermove', { clientX: 100 + px, clientY: 100 });
    dom.emit('pointerup', { clientX: 100 + px, clientY: 100 });
  };
  return { controls, dom, drag, listenerCount: () => dom.count() };
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
  const make = (minDistance = 2, maxDistance = 90) => {
    const camera = new PerspectiveCamera(36, 16 / 9, 0.1, 300);
    camera.position.set(18, 14, 26);
    const { controls, dom, drag, listenerCount } = fakeControls(minDistance, maxDistance);
    controls.target.set(0, 7, 0);
    const director = new CameraDirector(camera, controls, () => ({ width: 1920, height: 1080 }));
    return { camera, controls, dom, director, drag, listenerCount };
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

  it('a bare click (press and release without moving) does not cancel the flight', () => {
    const { dom, director } = make();
    director.flyTo(new Vector3(0, 30, 0), 6);
    simulate(0.2, 60, (dt) => director.update(dt));
    dom.emit('pointerdown', { clientX: 300, clientY: 300 });
    dom.emit('pointermove', { clientX: 303, clientY: 302 }); // under 5 px: still a click
    dom.emit('pointerup', { clientX: 303, clientY: 302 });
    expect(director.flying).toBe(true);
    simulate(4, 60, (dt) => director.update(dt));
    expect(director.flying).toBe(false); // and it still settles
  });

  it('a lost pointerup leaves no stale press: a later move with no button held does not cancel', () => {
    const { dom, director } = make();
    dom.emit('pointerdown', { clientX: 100, clientY: 100 });
    // the pointerup never arrives (released outside the window)
    director.flyTo(new Vector3(0, 30, 0), 6);
    dom.emit('pointermove', { clientX: 400, clientY: 100, buttons: 0 });
    expect(director.flying).toBe(true);
    dom.emit('pointermove', { clientX: 600, clientY: 100 }); // the stale entry is gone
    expect(director.flying).toBe(true);
  });

  it('moving without a pressed pointer (hover) does not cancel; a wheel zoom does', () => {
    const { dom, director } = make();
    director.flyTo(new Vector3(0, 30, 0), 6);
    dom.emit('pointermove', { clientX: 10, clientY: 10 });
    dom.emit('pointermove', { clientX: 400, clientY: 400 });
    expect(director.flying).toBe(true);
    dom.emit('wheel');
    expect(director.flying).toBe(false);
  });

  it('clamps the flight distance to the controls limits, so the flight settles', () => {
    for (const [want, got] of [[200, 40], [0.5, 3]] as const) {
      const { camera, controls, director } = make(3, 40);
      const target = new Vector3(0, 10, 0);
      director.flyTo(target, want);
      simulate(5, 60, (dt) => director.update(dt));
      expect(director.flying).toBe(false);
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(got, 2);
    }
  });

  it('dispose detaches the canvas listeners', () => {
    const { director, listenerCount } = make();
    expect(listenerCount()).toBeGreaterThan(0);
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

describe('bottomInsetFor (narrow-layout bottom sheet)', () => {
  it('a full-width sheet in the lower part of the viewport covers from its top edge down', () => {
    expect(bottomInsetFor({ top: 461, width: 768, height: 563 }, 768, 1024)).toBe(563);
    expect(bottomInsetFor({ top: 365, width: 375, height: 447 }, 375, 812)).toBe(447);
  });
  it('a side panel, or a hidden panel, covers no bottom edge', () => {
    expect(bottomInsetFor({ top: 60, width: 460, height: 1006 }, 1920, 1080)).toBe(0);
    expect(bottomInsetFor({ top: 0, width: 0, height: 0 }, 768, 1024)).toBe(0);
  });
});

describe('visible region and vertical framing', () => {
  it('subtracts the caption, panel, top bar and bottom sheet', () => {
    expect(visibleRegion(1920, 1080, { captionSafe: true, topInsetPx: 60 })).toEqual({ left: 0.38 * 1920, right: 1920, top: 60, bottom: 1080 });
    expect(visibleRegion(1024, 768, { rightInsetPx: 374, topInsetPx: 60 })).toEqual({ left: 0, right: 650, top: 60, bottom: 768 });
    expect(visibleRegion(768, 1024, { topInsetPx: 92, bottomInsetPx: 563 })).toEqual({ left: 0, right: 768, top: 92, bottom: 461 });
  });
  it('ignores insets that would leave (almost) nothing visible', () => {
    expect(visibleRegion(800, 600, { topInsetPx: 300, bottomInsetPx: 290 })).toEqual({ left: 0, right: 800, top: 0, bottom: 600 });
  });
  it('a top inset pushes the object down by half the inset', () => {
    const W = 1920;
    const H = 1080;
    const d = 20;
    expect(framingOffsetY(W, H, 36, d, {})).toBeCloseTo(0, 12);
    const worldPerPx = (2 * d * Math.tan((36 * Math.PI) / 360)) / H;
    expect(framingOffsetY(W, H, 36, d, { topInsetPx: 60 })).toBeCloseTo(30 * worldPerPx, 9);
  });
});

describe('fitPose: a box framed into the actual visible region (items 5-7)', () => {
  // A tall column-like plant: 40 m high, with equipment off to one side; and a short one.
  const tall = new Box3(new Vector3(-2, 0, -1.5), new Vector3(9, 40, 1.5));
  const short = new Box3(new Vector3(-2, 0, -1.5), new Vector3(9, 14, 1.5));
  const cases: [string, number, number, FramingOptions][] = [
    ['1920x1080 Lecture (caption-safe, top bar)', 1920, 1080, { captionSafe: true, topInsetPx: 60 }],
    ['1920x1080 Explore (panel)', 1920, 1080, { rightInsetPx: 474, topInsetPx: 60 }],
    ['1366x768 Lecture', 1366, 768, { captionSafe: true, topInsetPx: 60 }],
    ['1024x768 Explore (region aspect ~0.9)', 1024, 768, { rightInsetPx: 374, topInsetPx: 60 }],
    ['1024x768 Lecture (4:3)', 1024, 768, { captionSafe: true, topInsetPx: 60 }],
    ['768x1024 Explore (bottom sheet)', 768, 1024, { topInsetPx: 92, bottomInsetPx: 563 }],
    ['375x812 Lecture (caption band)', 375, 812, { topInsetPx: 128, bottomInsetPx: 300 }],
  ];
  it.each(cases)('%s: every corner projects inside the region, centred, margin used', (_n, W, H, o) => {
    for (const box of [tall, short]) {
      const pose = fitPose(box, CAMERA_FOV_DEG, W, H, o);
      const reg = visibleRegion(W, H, o);
      const b = boundsFromPose(box, pose.position, CAMERA_FOV_DEG, W, H);
      expect(b.minX).toBeGreaterThanOrEqual(reg.left);
      expect(b.maxX).toBeLessThanOrEqual(reg.right);
      expect(b.minY).toBeGreaterThanOrEqual(reg.top);
      expect(b.maxY).toBeLessThanOrEqual(reg.bottom);
      // centred on the region (to a few px: the lateral shift adds a little parallax)
      expect(Math.abs((b.minX + b.maxX) / 2 - (reg.left + reg.right) / 2)).toBeLessThan(0.03 * (reg.right - reg.left));
      expect(Math.abs((b.minY + b.maxY) / 2 - (reg.top + reg.bottom) / 2)).toBeLessThan(0.03 * (reg.bottom - reg.top));
      // tight: one axis fills ~1/FIT_MARGIN of the region (neither under- nor over-framed)
      const fill = Math.max((b.maxX - b.minX) / (reg.right - reg.left), (b.maxY - b.minY) / (reg.bottom - reg.top));
      expect(fill).toBeGreaterThan(0.85 / FIT_MARGIN);
      expect(fill).toBeLessThanOrEqual(1 / FIT_MARGIN + 0.02);
    }
  });
  it('a narrower region needs a larger distance (the old fixed 1.1 aspect under-framed it)', () => {
    const wide = fitPose(short, CAMERA_FOV_DEG, 1920, 1080, { captionSafe: true, topInsetPx: 60 }).distance;
    const narrow = fitPose(short, CAMERA_FOV_DEG, 1024, 768, { rightInsetPx: 374, topInsetPx: 60 }).distance;
    expect(narrow).toBeGreaterThan(wide);
  });
  it('scale multiplies the fitted distance (a lecture step zoomOut)', () => {
    const a = fitPose(short, CAMERA_FOV_DEG, 1920, 1080, {});
    const b = fitPose(short, CAMERA_FOV_DEG, 1920, 1080, {}, 1.5);
    expect(b.distance).toBeCloseTo(1.5 * a.distance, 9);
  });
  it('the top bar: the box top stays below the bar', () => {
    const pose = fitPose(tall, CAMERA_FOV_DEG, 1920, 1080, { captionSafe: true, topInsetPx: 60 });
    expect(boundsFromPose(tall, pose.position, CAMERA_FOV_DEG, 1920, 1080).minY).toBeGreaterThan(60);
  });
});

describe('CameraDirector fit flights and userMoved', () => {
  function make(W = 1024, H = 768) {
    const camera = new PerspectiveCamera(CAMERA_FOV_DEG, W / H, 0.1, 2000);
    const { controls, drag, dom } = fakeControls(2, 1000);
    const director = new CameraDirector(camera, controls, () => ({ width: W, height: H }));
    return { camera, controls, director, drag, dom };
  }
  it('flyTo with fit lands on the fitted pose', () => {
    const { camera, controls, director } = make();
    const box = new Box3(new Vector3(-2, 0, -1.5), new Vector3(9, 30, 1.5));
    const o: FramingOptions = { rightInsetPx: 374, topInsetPx: 60 };
    director.flyTo(new Vector3(), 10, { ...o, fit: { box } });
    simulate(6, 60, (dt) => director.update(dt));
    const pose = fitPose(box, CAMERA_FOV_DEG, 1024, 768, o);
    expect(camera.position.distanceTo(pose.position)).toBeLessThan(0.05);
    expect(controls.target.distanceTo(pose.look)).toBeLessThan(0.05);
    expect(director.fitDistance(box, o)).toBeCloseTo(pose.distance, 9);
  });
  it('userMoved: set by a drag or a wheel, cleared by the next flight', () => {
    const { director, drag, dom } = make();
    expect(director.userMoved).toBe(false);
    drag();
    expect(director.userMoved).toBe(true);
    director.flyTo(new Vector3(), 10);
    expect(director.userMoved).toBe(false);
    dom.emit('wheel');
    expect(director.userMoved).toBe(true);
  });
});

describe('Picker pointer handling (item 11)', () => {
  /** A 200 x 200 canvas stand-in and a unit box in front of the camera at its centre. */
  function make() {
    const dom = Object.assign(new FakeDom(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) });
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.userData.part = { kind: 'column' };
    mesh.updateMatrixWorld(true);
    const picker = new Picker(camera, dom as unknown as HTMLElement);
    picker.setRoots([mesh]);
    const picks: unknown[] = [];
    picker.onPick((p) => picks.push(p));
    const at = { clientX: 100, clientY: 100 };
    return { dom, picker, picks, at };
  }
  const primary = (id: number, extra: Record<string, number> = {}) => ({ clientX: 100, clientY: 100, pointerId: id, ...extra });
  it('a primary click on the part picks it', () => {
    const { dom, picks } = make();
    dom.emit('pointerdown', primary(1));
    dom.emit('pointerup', primary(1));
    expect(picks).toEqual([{ kind: 'column' }]);
  });
  it('ignores a non-primary pointer, and a second finger cancels the first press', () => {
    const { dom, picks } = make();
    dom.emitWith('pointerdown', { ...primary(2), isPrimary: false });
    dom.emitWith('pointerup', { ...primary(2), isPrimary: false });
    expect(picks).toEqual([]);
    dom.emit('pointerdown', primary(1));
    dom.emitWith('pointerdown', { ...primary(2), isPrimary: false }); // a pinch starts
    dom.emit('pointerup', primary(1));
    expect(picks).toEqual([]);
  });
  it('a release from another pointer id does not complete the press', () => {
    const { dom, picks } = make();
    dom.emit('pointerdown', primary(1));
    dom.emit('pointerup', primary(7));
    expect(picks).toEqual([]);
    dom.emit('pointerup', primary(1));
    expect(picks).toEqual([{ kind: 'column' }]);
  });
  it('pointercancel clears the press', () => {
    const { dom, picks } = make();
    dom.emit('pointerdown', primary(1));
    dom.emit('pointercancel', primary(1));
    dom.emit('pointerup', primary(1));
    expect(picks).toEqual([]);
  });
  it('dispose removes every listener', () => {
    const { dom, picker } = make();
    expect(dom.count()).toBe(3);
    picker.dispose();
    expect(dom.count()).toBe(0);
  });
});
