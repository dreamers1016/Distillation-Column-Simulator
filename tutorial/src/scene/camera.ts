// Camera flights: exponential smoothing toward a goal pose, driven by dt (seconds),
// so a flight takes the same wall-clock time at 15 Hz as at 144 Hz.
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { isClick } from './picking';

/** Time constant of the flight: the remaining distance shrinks by 1/e every 0.35 s. */
export const FLIGHT_TIME_CONSTANT_S = 0.35;

/** Lecture caption occupies the left 38 %, so the framed object sits in the right 62 %. */
export const CAPTION_SAFE_LEFT_FRACTION = 0.38;

/** Vertical field of view of the scene camera, degrees (anchors are fitted to it). */
export const CAMERA_FOV_DEG = 36;

/** Direction from the look target to the camera for every flight (unit vector). */
export const VIEW_DIRECTION = new Vector3(0.5, 0.32, 0.9).normalize();

/** Flight ends (and snaps) once pose and target are this close to the goal, in metres. */
const SETTLE_EPSILON = 0.01;

/** Frame-rate independent lerp factor: k = 1 - exp(-dt / tau). */
export function smoothFactor(dt: number, tau: number = FLIGHT_TIME_CONSTANT_S): number {
  return 1 - Math.exp(-dt / tau);
}

export interface FramingOptions {
  /** Lecture caption on the left: frame the object in the right 62 % of the viewport. */
  captionSafe?: boolean;
  /** Width in px of UI covering the right edge (the Explore panel). Default 0. */
  rightInsetPx?: number;
  /** Height in px of UI covering the top edge (the top bar). Default 0. */
  topInsetPx?: number;
  /** Height in px of UI covering the bottom edge (narrow layout: bottom sheet or caption band). Default 0. */
  bottomInsetPx?: number;
  /**
   * Fit this world box inside the visible region (viewport minus the insets) instead of
   * using the given distance; `scale` multiplies the fitted distance (a lecture step's zoomOut).
   */
  fit?: { box: Box3; scale?: number };
}

/** Breathing room around a fitted box: its projection fills at most 1/1.1 of the region. */
export const FIT_MARGIN = 1.1;

/** The part of the viewport not covered by UI, in px from the top-left corner. */
export interface Region {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function visibleRegion(
  viewportW: number,
  viewportH: number,
  { captionSafe = false, rightInsetPx = 0, topInsetPx = 0, bottomInsetPx = 0 }: FramingOptions = {},
): Region {
  const left = captionSafe ? CAPTION_SAFE_LEFT_FRACTION * viewportW : 0;
  let right = viewportW - Math.max(0, rightInsetPx);
  let top = Math.max(0, topInsetPx);
  let bottom = viewportH - Math.max(0, bottomInsetPx);
  // Degenerate insets (UI covering nearly everything): ignore them on that axis.
  if (right - left < 40) right = viewportW;
  if (bottom - top < 40) [top, bottom] = [0, viewportH];
  return { left, right, top, bottom };
}

/**
 * Horizontal shift, in world units along the camera's right vector, to add to the look
 * target so the framed object appears at the centre of the visible region
 * [captionSafe ? 0.38 W : 0, W - rightInsetPx]. A negative value moves the look point
 * left, which pushes the object to the right of screen centre.
 */
export function framingOffset(viewportW: number, viewportH: number, fovDeg: number, distance: number, opts: FramingOptions = {}): number {
  const { left, right } = visibleRegion(viewportW, viewportH, opts);
  const objectPx = (left + right) / 2; // where the object should appear, in px from the left
  const worldPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewportH; // vertical FOV
  return -(objectPx - viewportW / 2) * worldPerPx;
}

/**
 * Vertical counterpart of framingOffset, along the camera's up vector: the object appears
 * at the vertical centre of [topInsetPx, H - bottomInsetPx]. Positive moves the look point
 * up, which pushes the object down the screen (clear of a top bar).
 */
export function framingOffsetY(viewportW: number, viewportH: number, fovDeg: number, distance: number, opts: FramingOptions = {}): number {
  const { top, bottom } = visibleRegion(viewportW, viewportH, opts);
  const objectPy = (top + bottom) / 2;
  const worldPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewportH;
  return (objectPy - viewportH / 2) * worldPerPx;
}

/** Look target and camera position for an object at `target` seen from `distance`, shifted into the visible region. */
export function framedPose(target: Vector3, distance: number, fovDeg: number, W: number, H: number, opts: FramingOptions = {}) {
  const look = target
    .clone()
    .addScaledVector(cameraRight(VIEW_DIRECTION), framingOffset(W, H, fovDeg, distance, opts))
    .addScaledVector(cameraUp(VIEW_DIRECTION), framingOffsetY(W, H, fovDeg, distance, opts));
  return { look, position: look.clone().addScaledVector(VIEW_DIRECTION, distance) };
}

/** Pixel bounds of the projected corners of `box` for a camera at `position` looking along -VIEW_DIRECTION. */
function projectedBounds(corners: Vector3[], position: Vector3, t: number, W: number, H: number) {
  const d = VIEW_DIRECTION;
  const r = cameraRight(d);
  const u = cameraUp(d);
  const v = new Vector3();
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, behind: false };
  for (const c of corners) {
    v.copy(c).sub(position);
    const depth = -v.dot(d);
    if (depth <= 0.1) b.behind = true;
    const px = ((v.dot(r) / (depth * t * (W / H)) + 1) / 2) * W;
    const py = ((1 - v.dot(u) / (depth * t)) / 2) * H;
    b.minX = Math.min(b.minX, px);
    b.maxX = Math.max(b.maxX, px);
    b.minY = Math.min(b.minY, py);
    b.maxY = Math.max(b.maxY, py);
  }
  return b;
}

const boxCorners = (box: Box3): Vector3[] => {
  const out: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z));
  return out;
};

/**
 * Camera pose that frames all of `box` in the visible region (viewport minus the insets in
 * `opts`), looking along -VIEW_DIRECTION with the real viewport aspect:
 *  1. distance: the smallest at which the box's projected extent (exact perspective, camera
 *     aimed at the box centre) fits the region shrunk by FIT_MARGIN (bisection: the extent
 *     shrinks monotonically as the camera backs away), times `scale`;
 *  2. look point: shifted along the camera's right and up vectors so the centre of the
 *     projected extent (not the box centre: a deep box projects off-centre) lands on the
 *     region's centre.
 */
export function fitPose(box: Box3, fovDeg: number, W: number, H: number, opts: FramingOptions = {}, scale = 1) {
  const reg = visibleRegion(W, H, opts);
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const d = VIEW_DIRECTION;
  const centre = box.getCenter(new Vector3());
  const corners = boxCorners(box);
  const maxW = (reg.right - reg.left) / FIT_MARGIN;
  const maxH = (reg.bottom - reg.top) / FIT_MARGIN;
  const at = (dist: number) => projectedBounds(corners, centre.clone().addScaledVector(d, dist), t, W, H);
  const fits = (dist: number) => {
    const b = at(dist);
    return !b.behind && b.maxX - b.minX <= maxW && b.maxY - b.minY <= maxH;
  };
  let lo = 0.1;
  let hi = Math.max(1, box.getSize(new Vector3()).length());
  for (let i = 0; i < 60 && !fits(hi); i++) hi *= 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const distance = hi * scale;
  const b = at(distance);
  const worldPerPx = (2 * distance * t) / H;
  const dx = (reg.left + reg.right) / 2 - (b.minX + b.maxX) / 2; // move the image right by dx px
  const dy = (reg.top + reg.bottom) / 2 - (b.minY + b.maxY) / 2; // ... and down by dy px
  const look = centre
    .clone()
    .addScaledVector(cameraRight(d), -dx * worldPerPx)
    .addScaledVector(cameraUp(d), dy * worldPerPx);
  return { look, position: look.clone().addScaledVector(d, distance), distance };
}

/** Pixel bounds of `box` seen from a pose (for tests and checks). */
export function boundsFromPose(box: Box3, position: Vector3, fovDeg: number, W: number, H: number) {
  return projectedBounds(boxCorners(box), position, Math.tan((fovDeg * Math.PI) / 360), W, H);
}

/**
 * Height in px of the narrow-layout bottom sheet's cover over the bottom of the stage, for
 * FramingOptions.bottomInsetPx: a panel wider than half the viewport whose top lies below
 * the top quarter. A side panel or a hidden (0 x 0) panel covers nothing.
 */
export function bottomInsetFor(rect: { top: number; width: number; height: number }, viewportW: number, viewportH: number): number {
  if (!(rect.width > 0) || !(rect.height > 0) || !(viewportH > 0)) return 0;
  if (rect.width <= viewportW / 2 || rect.top < viewportH / 4) return 0;
  return Math.max(0, viewportH - rect.top);
}

/**
 * Width in px of the Explore panel's cover over the right edge of the stage, for
 * FramingOptions.rightInsetPx: from the panel's left edge to the viewport edge (panel
 * width + its right margin). A panel spanning more than half the viewport is a bottom
 * sheet (narrow layout), and a hidden panel has a 0 x 0 rect: neither covers the right edge.
 */
export function rightInsetFor(rect: { left: number; width: number }, viewportW: number): number {
  if (!(rect.width > 0) || !(viewportW > 0)) return 0;
  const covered = viewportW - rect.left;
  return covered > viewportW / 2 ? 0 : Math.max(0, covered);
}

/** Camera-right unit vector for a camera looking along -dir (dir points target -> camera), world up +Y. */
export function cameraRight(dir: Vector3): Vector3 {
  return new Vector3(0, 1, 0).cross(dir).normalize();
}

/** Camera-up unit vector for the same camera (right x up = dir). */
export function cameraUp(dir: Vector3): Vector3 {
  return new Vector3().crossVectors(dir, cameraRight(dir));
}

/** Event source the user drags and wheels on (the controls' canvas). */
export interface DragSurface {
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
}

/** The part of OrbitControls the director needs (also satisfied by a test double). */
export interface FlightControls {
  target: Vector3;
  /** Orbit distance limits: OrbitControls clamps to them every frame, so flights must too. */
  minDistance: number;
  maxDistance: number;
  domElement?: DragSurface | null;
}

const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel'] as const;

export class CameraDirector {
  private goalPos = new Vector3();
  private goalTarget = new Vector3();
  private active = false;
  /** The user dragged or wheel-zoomed since the last programmatic flight. */
  private moved = false;
  /** Pressed pointers and where they went down (CSS px). */
  private readonly down = new Map<number, [number, number]>();
  private readonly dom: DragSurface | null;

  /**
   * A real drag (a pressed pointer moving as far as the picker's click limit) or a wheel
   * zoom cancels the flight. A bare press, such as clicking a part or a label while the
   * camera is flying, does not.
   */
  private readonly onPointer = (ev: Event) => {
    const e = ev as PointerEvent;
    if (e.type === 'wheel') {
      this.active = false;
      this.moved = true;
      return;
    }
    if (e.type === 'pointerdown') {
      this.down.set(e.pointerId, [e.clientX, e.clientY]);
    } else if (e.type === 'pointermove') {
      // No button held: the pointerup was lost (released outside the window, etc.).
      if (e.buttons === 0) {
        this.down.delete(e.pointerId);
        return;
      }
      const at = this.down.get(e.pointerId);
      if (at && !isClick(at, [e.clientX, e.clientY])) {
        this.active = false;
        this.moved = true;
      }
    } else {
      this.down.delete(e.pointerId);
    }
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: FlightControls,
    private readonly getViewport: () => { width: number; height: number },
  ) {
    this.dom = controls.domElement ?? null;
    for (const t of POINTER_EVENTS) this.dom?.addEventListener(t, this.onPointer);
  }

  get flying(): boolean {
    return this.active;
  }

  /** True once the user has dragged or wheel-zoomed since the last flyTo (they own the view). */
  get userMoved(): boolean {
    return this.moved;
  }

  /** Distance at which `box` fits the visible region for `opts` (no flight). */
  fitDistance(box: Box3, opts: FramingOptions = {}): number {
    const { width, height } = this.getViewport();
    return fitPose(box, this.camera.fov, width, height, opts).distance;
  }

  /** Camera-to-target distance: the flight's goal while flying, the current one otherwise. */
  get distance(): number {
    return this.active ? this.goalPos.distanceTo(this.goalTarget) : this.camera.position.distanceTo(this.controls.target);
  }

  /**
   * Fly to look at `target` from `distance` (clamped to the controls' distance limits),
   * framed into the visible region. With opts.fit the pose is fitted to that box instead
   * (fitPose: distance and centring from the box's projection; `target` is then unused).
   */
  flyTo(target: Vector3, distance: number, opts: FramingOptions = {}): void {
    const { minDistance, maxDistance } = this.controls;
    const { width, height } = this.getViewport();
    let pose: { look: Vector3; position: Vector3 };
    if (opts.fit && width > 0 && height > 0) {
      const fit = fitPose(opts.fit.box, this.camera.fov, width, height, opts, opts.fit.scale ?? 1);
      const clamped = Math.min(Math.max(fit.distance, minDistance), maxDistance);
      pose = { look: fit.look, position: fit.look.clone().addScaledVector(VIEW_DIRECTION, clamped) };
    } else {
      distance = Math.min(Math.max(distance, minDistance), maxDistance);
      pose = framedPose(target, distance, this.camera.fov, width, height, opts);
    }
    this.goalTarget.copy(pose.look);
    this.goalPos.copy(pose.position);
    this.active = true;
    this.moved = false;
  }

  /** Advance the flight by dt seconds. Call before OrbitControls.update(). */
  update(dt: number): void {
    if (!this.active) return;
    const k = smoothFactor(dt);
    this.camera.position.lerp(this.goalPos, k);
    this.controls.target.lerp(this.goalTarget, k);
    if (
      this.camera.position.distanceTo(this.goalPos) < SETTLE_EPSILON &&
      this.controls.target.distanceTo(this.goalTarget) < SETTLE_EPSILON
    ) {
      this.camera.position.copy(this.goalPos);
      this.controls.target.copy(this.goalTarget);
      this.active = false;
    }
    this.camera.lookAt(this.controls.target);
  }

  dispose(): void {
    this.active = false;
    for (const t of POINTER_EVENTS) this.dom?.removeEventListener(t, this.onPointer);
    this.down.clear();
  }
}
