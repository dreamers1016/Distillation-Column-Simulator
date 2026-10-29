// Renderer, lighting, floor, orbit controls and the frame loop. No plant geometry here.
import {
  ACESFilmicToneMapping,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Matrix4,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CAMERA_FOV_DEG } from './camera';

export const BACKGROUND = '#f4ecdc';
export const FLOOR_SIZE_M = 120;
/** Longest frame step handed to animations, so a stalled tab does not teleport everything. */
export const MAX_FRAME_DT_S = 0.05;
/** Device pixel ratio cap (projectors and 4K laptops gain nothing visible above 2). */
export const MAX_PIXEL_RATIO = 2;
/** Shadow frustum padding around the fitted bounds, metres. */
const SHADOW_PAD_M = 1.5;

/** Where the sun sits relative to its target (the origin): high, to the front right. */
export const SUN_OFFSET = new Vector3(10, 30, 16);

/**
 * The sun keeps its direction (SUN_OFFSET) but backs away along it until it is clear of
 * the plant: a 120-tray column is taller than the default sun height, and the shadow
 * camera sits at the light's position.
 */
export function sunPositionFor(box: Box3): Vector3 {
  let reach = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, Math.hypot(x, y, z));
  return SUN_OFFSET.clone().setLength(Math.max(SUN_OFFSET.length(), reach + 20));
}

export interface ShadowBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/**
 * Orthographic shadow-camera bounds (in the sun's view space) that cover `box` and the
 * shadow it throws on the floor (y = 0): each top corner is projected down the light
 * direction onto the floor and included. The sun looks from `sunPos` at `sunTarget`.
 */
export function shadowBoundsFor(box: Box3, sunPos: Vector3, sunTarget: Vector3 = new Vector3()): ShadowBounds {
  const view = new Matrix4().lookAt(sunPos, sunTarget, new Vector3(0, 1, 0)).setPosition(sunPos).invert();
  const toSun = sunPos.clone().sub(sunTarget).normalize();
  const pts: Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new Vector3(x, y, z);
        pts.push(p);
        if (y > 0 && toSun.y > 1e-6) pts.push(p.clone().addScaledVector(toSun, -y / toSun.y)); // its floor shadow
      }
  const b = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity, zMin: Infinity, zMax: -Infinity };
  for (const p of pts) {
    p.applyMatrix4(view);
    b.left = Math.min(b.left, p.x);
    b.right = Math.max(b.right, p.x);
    b.bottom = Math.min(b.bottom, p.y);
    b.top = Math.max(b.top, p.y);
    b.zMin = Math.min(b.zMin, p.z);
    b.zMax = Math.max(b.zMax, p.z);
  }
  // The shadow camera looks down -z: depth = -z.
  return {
    left: b.left - SHADOW_PAD_M,
    right: b.right + SHADOW_PAD_M,
    bottom: b.bottom - SHADOW_PAD_M,
    top: b.top + SHADOW_PAD_M,
    near: Math.max(0.1, -b.zMax - SHADOW_PAD_M),
    far: -b.zMin + SHADOW_PAD_M,
  };
}

export interface SceneHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  labelRenderer: CSS2DRenderer;
  /** Register a per-frame callback; dt is in seconds, clamped to <= 0.05. */
  onFrame(fn: (dt: number) => void): void;
  /** Called after the stage has been resized (ResizeObserver on the container, or window resize). */
  onResize(fn: () => void): () => void;
  /**
   * Fit the sun's shadow frustum to `box` (the plant) and its floor shadow, and keep the
   * camera's far plane beyond it: call on every plant rebuild (tall columns outgrow the default).
   */
  fitToBounds(box: Box3, maxViewDistance: number): void;
  dispose(): void;
}

export function createScene(container: HTMLElement): SceneHandle {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);

  // Labels live in their own overlay; only the pins themselves take pointer events.
  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.append(labelRenderer.domElement);

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const roomEnv = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  pmrem.dispose();
  roomEnv.dispose();

  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 300);
  camera.position.set(18, 14, 26);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 7, 0);
  controls.minDistance = 2;
  controls.maxDistance = 90;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // keep the camera above the floor
  controls.update();

  scene.add(new HemisphereLight('#fff8ec', '#b9a98a', 0.5));
  const sun = new DirectionalLight('#ffffff', 2.2);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 36, bottom: -6, far: 80 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const floor = new Mesh(new PlaneGeometry(FLOOR_SIZE_M, FLOOR_SIZE_M), new ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new GridHelper(FLOOR_SIZE_M, FLOOR_SIZE_M, '#d6cab2', '#e5dccb');
  grid.position.y = 0.001; // above the shadow plane to avoid z-fighting
  scene.add(grid);

  // Resize: a ResizeObserver on the container catches projector fullscreen, browser zoom
  // and layout changes that fire no window resize; window resize stays as a fallback.
  // devicePixelRatio is re-read each time (zoom and moving between monitors change it).
  const resizeCallbacks = new Set<() => void>();
  let shown = { w: 0, h: 0, dpr: 0 };
  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (w === shown.w && h === shown.h && dpr === shown.dpr) return;
    shown = { w, h, dpr };
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of [...resizeCallbacks]) fn();
  };
  resize();
  window.addEventListener('resize', resize);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(container);

  const frameCallbacks: Array<(dt: number) => void> = [];
  const clock = new Clock();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), MAX_FRAME_DT_S);
    for (const fn of frameCallbacks) fn(dt);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  loop();

  let disposed = false;
  return {
    scene,
    camera,
    renderer,
    controls,
    labelRenderer,
    onFrame: (fn) => void frameCallbacks.push(fn),
    onResize(fn) {
      resizeCallbacks.add(fn);
      return () => void resizeCallbacks.delete(fn);
    },
    fitToBounds(box, maxViewDistance) {
      sun.position.copy(sunPositionFor(box)); // the target stays at the origin
      const sb = shadowBoundsFor(box, sun.position, sun.target.position);
      Object.assign(sun.shadow.camera, sb);
      sun.shadow.camera.updateProjectionMatrix();
      const far = Math.max(300, maxViewDistance + box.getSize(new Vector3()).length() * 1.5);
      if (camera.far !== far) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      observer?.disconnect();
      resizeCallbacks.clear();
      frameCallbacks.length = 0;
      controls.dispose();
      floor.geometry.dispose();
      (floor.material as ShadowMaterial).dispose();
      grid.geometry.dispose();
      (grid.material as { dispose(): void }).dispose();
      sun.shadow.map?.dispose();
      envTarget.dispose();
      scene.environment = null;
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}
