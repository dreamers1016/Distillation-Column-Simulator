// Camera flights: exponential smoothing toward a goal pose, driven by dt (seconds),
// so a flight takes the same wall-clock time at 15 Hz as at 144 Hz.
import { PerspectiveCamera, Vector3 } from 'three';

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
}

/**
 * Horizontal shift, in world units along the camera's right vector, to add to the look
 * target so the framed object appears at the centre of the visible region
 * [captionSafe ? 0.38 W : 0, W - rightInsetPx]. A negative value moves the look point
 * left, which pushes the object to the right of screen centre.
 */
export function framingOffset(
  viewportW: number,
  viewportH: number,
  fovDeg: number,
  distance: number,
  { captionSafe = false, rightInsetPx = 0 }: FramingOptions = {},
): number {
  const left = captionSafe ? CAPTION_SAFE_LEFT_FRACTION * viewportW : 0;
  const right = viewportW - Math.max(0, rightInsetPx);
  const objectPx = (left + right) / 2; // where the object should appear, in px from the left
  const worldPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewportH; // vertical FOV
  return -(objectPx - viewportW / 2) * worldPerPx;
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

/** The part of OrbitControls the director needs (also satisfied by a test double). */
export interface FlightControls {
  target: Vector3;
  addEventListener(type: 'start', listener: () => void): void;
  removeEventListener(type: 'start', listener: () => void): void;
}

export class CameraDirector {
  private goalPos = new Vector3();
  private goalTarget = new Vector3();
  private active = false;
  private readonly cancel = () => {
    this.active = false;
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: FlightControls,
    private readonly getViewport: () => { width: number; height: number },
  ) {
    controls.addEventListener('start', this.cancel); // any user drag/zoom/pan cancels the flight
  }

  get flying(): boolean {
    return this.active;
  }

  flyTo(target: Vector3, distance: number, opts: FramingOptions = {}): void {
    const { width, height } = this.getViewport();
    const shift = framingOffset(width, height, this.camera.fov, distance, opts);
    this.goalTarget.copy(target).addScaledVector(cameraRight(VIEW_DIRECTION), shift);
    this.goalPos.copy(this.goalTarget).addScaledVector(VIEW_DIRECTION, distance);
    this.active = true;
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
    this.controls.removeEventListener('start', this.cancel);
  }
}
