// Renderer, lighting, floor, orbit controls and the frame loop. No plant geometry here.
import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export const BACKGROUND = '#f4ecdc';
export const FLOOR_SIZE_M = 120;
/** Longest frame step handed to animations, so a stalled tab does not teleport everything. */
export const MAX_FRAME_DT_S = 0.05;

export interface SceneHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  labelRenderer: CSS2DRenderer;
  /** Register a per-frame callback; dt is in seconds, clamped to <= 0.05. */
  onFrame(fn: (dt: number) => void): void;
  dispose(): void;
}

export function createScene(container: HTMLElement): SceneHandle {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  const camera = new PerspectiveCamera(36, 1, 0.1, 300);
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
  sun.position.set(10, 30, 16);
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

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

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
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
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
