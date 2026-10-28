// Shared building blocks for the procedural plant.
//
// Performance model (the plant is rebuilt on every slider move):
// - Every BufferGeometry comes from one module-level cache keyed by its parameters.
//   Variable lengths use unit-height geometry scaled along the axis, so a rebuild
//   creates Object3Ds and materials only, never new geometry. Cached geometry is
//   kept across rebuilds and freed only by disposeSharedGeometry() (HMR / teardown).
// - Materials are per part (PartMaterials), so highlighting one part never lights
//   another; they are created lazily and pooled across rebuilds by plant.ts.
//
// Section cut convention: the cutaway keeps the back half (z <= 0) of every shell,
// so a camera on the +z side looks into the opened vessels.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  BackSide,
  ExtrudeGeometry,
  Group,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { PartRef } from '../../app/state';

export const TAU = Math.PI * 2;
export const UP = new Vector3(0, 1, 0);
/** CylinderGeometry thetaStart / thetaLength that keep the z <= 0 half (x = r sin θ, z = r cos θ). */
export const CUT_THETA_START = Math.PI / 2;
export const CUT_THETA_LENGTH = Math.PI;

export const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---- geometry cache --------------------------------------------------------

const geometryCache = new Map<string, BufferGeometry>();

/** Geometry shared by every mesh (and every rebuild) that asks for the same key. */
export function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g as T;
}

/** Free every cached geometry (call only when the whole scene is torn down). */
export function disposeSharedGeometry(): void {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
}

// ---- materials ---------------------------------------------------------------

export type MatKind = 'steel' | 'inner' | 'face' | 'dark' | 'grate' | 'tube' | 'liquid' | 'paintedSteel';

function makeMaterial(kind: MatKind): Material {
  switch (kind) {
    case 'steel':
      return new MeshStandardMaterial({ color: '#c3c8cd', metalness: 0.85, roughness: 0.3 });
    case 'inner': // inside surface of a shell, seen through the cut
      return new MeshStandardMaterial({ color: '#9aa1a8', metalness: 0.6, roughness: 0.5, side: BackSide });
    case 'face': // section faces, tubesheets, plates seen from both sides
      return new MeshStandardMaterial({ color: '#6f767d', metalness: 0.4, roughness: 0.6, side: DoubleSide });
    case 'dark': // bolts, nuts, valve bodies
      return new MeshStandardMaterial({ color: '#3a3f44', metalness: 0.6, roughness: 0.45 });
    case 'grate': // platform and structure gratings
      return new MeshStandardMaterial({ color: '#2f3337', metalness: 0.5, roughness: 0.7 });
    case 'tube': // copper-alloy exchanger tubes
      return new MeshStandardMaterial({ color: '#d8b48a', metalness: 0.8, roughness: 0.3 });
    case 'paintedSteel': // structural steel
      return new MeshStandardMaterial({ color: '#5d6f80', metalness: 0.45, roughness: 0.55 });
    case 'liquid': // no transmission: it would add a full extra render pass every frame
      return new MeshPhysicalMaterial({
        color: '#7fb2e0',
        roughness: 0.08,
        clearcoat: 1,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
  }
}

/**
 * One part's materials, created on first use. Sets are pooled across rebuilds by the
 * plant (see plant.ts): disposing and recreating materials on every slider move would
 * release their shader programs and force a recompile on the next frame.
 */
export class PartMaterials {
  private readonly byKind = new Map<string, Material>();

  constructor(readonly part: PartRef | null) {}

  get(kind: MatKind): Material {
    let m = this.byKind.get(kind);
    if (!m) {
      m = makeMaterial(kind);
      this.track(kind, m);
    }
    return m;
  }

  /** A pipe-paint material in this part's set (one per colour). */
  paint(color: string): Material {
    const key = `paint:${color}`;
    let m = this.byKind.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
      this.track(key, m);
    }
    return m;
  }

  /** A steel variant with a tint (tray decks are tinted by height); colour and base glow are (re)applied on every call. */
  tinted(key: string, color: Color, emissive = 0x000000): Material {
    let m = this.byKind.get(key) as MeshStandardMaterial | undefined;
    if (!m) {
      m = new MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.32, emissive });
      this.track(key, m);
    }
    m.color.copy(color);
    m.emissive.setHex(emissive);
    m.userData.baseEmissive = emissive;
    return m;
  }

  all(): Material[] {
    return [...this.byKind.values()];
  }

  /** The material stored under `key` (e.g. a tray's 'deck', 'weir' or 'downcomer'), if any. */
  find(key: string): Material | undefined {
    return this.byKind.get(key);
  }

  /** Back to the baseline look: no highlight, no ghosting. */
  reset(): void {
    for (const m of this.byKind.values()) {
      (m as MeshStandardMaterial).emissive?.setHex(m.userData.baseEmissive as number);
      if (m.transparent !== m.userData.baseTransparent) m.needsUpdate = true;
      m.transparent = m.userData.baseTransparent as boolean;
      m.opacity = m.userData.baseOpacity as number;
    }
  }

  dispose(): void {
    for (const m of this.byKind.values()) m.dispose();
    this.byKind.clear();
  }

  private track(key: string, m: Material): void {
    // Baselines used by highlight() and the ok:false ghosting.
    m.userData.baseEmissive = (m as MeshStandardMaterial).emissive?.getHex() ?? 0;
    m.userData.baseOpacity = m.opacity;
    m.userData.baseTransparent = m.transparent;
    this.byKind.set(key, m);
  }
}

// ---- primitives ----------------------------------------------------------------

export interface CylOpts {
  open?: boolean;
  cut?: boolean;
  seg?: number;
}

/** Cylinder or frustum of height h (unit geometry scaled in y), axis along local y, centred. */
export function cyl(rt: number, rb: number, h: number, mat: Material, { open = false, cut = false, seg = 32 }: CylOpts = {}): Mesh {
  const key = `cyl:${rt}:${rb}:${seg}:${open}:${cut}`;
  const geo = shared(
    key,
    () => new CylinderGeometry(rt, rb, 1, seg, 1, open, cut ? CUT_THETA_START : 0, cut ? CUT_THETA_LENGTH : TAU),
  );
  const m = new Mesh(geo, mat);
  m.scale.y = h;
  return m;
}

/** Axis-aligned box w × h × d (unit geometry scaled). */
export function box(w: number, h: number, d: number, mat: Material): Mesh {
  const m = new Mesh(
    shared('box', () => new BoxGeometry(1, 1, 1)),
    mat,
  );
  m.scale.set(w, h, d);
  return m;
}

/** Torus ring of radius r in the horizontal plane; `cut` keeps the z <= 0 half. */
export function ring(r: number, tube: number, mat: Material, cut: boolean, seg = 48): Mesh {
  const geo = shared(`ring:${r}:${tube}:${seg}:${cut}`, () => {
    const g = new TorusGeometry(r, tube, 6, seg, cut ? Math.PI : TAU);
    g.rotateX(-Math.PI / 2); // XY arc → XZ plane; u ∈ [0, π] maps to z <= 0
    return g;
  });
  return new Mesh(geo, mat);
}

/** Place `o` at `pos` with its local +y along `dir`. */
export function orient<T extends Object3D>(o: T, pos: Vector3, dir: Vector3): T {
  o.position.copy(pos);
  o.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  return o;
}

export function tag<T extends Object3D>(o: T, part: PartRef): T {
  o.userData.part = part;
  return o;
}

// ---- vessels ---------------------------------------------------------------------

export interface VesselOpts {
  /** Head height / radius: 0.5 for a 2:1 ellipsoidal head. */
  headK?: number;
  wall?: number;
  /** Which ends get a head: [top (+y), bottom (-y)]. */
  heads?: [boolean, boolean];
  /** Name for the cylindrical shell mesh (tests find the column shell by name). */
  shellName?: string;
}

function headGeometry(r: number, cut: boolean): SphereGeometry {
  // Upper hemisphere; phi ∈ [π, 2π] keeps z <= 0 (z = r sin φ sin θ).
  return shared(`head:${r}:${cut}`, () => new SphereGeometry(r, 48, 14, cut ? Math.PI : 0, cut ? Math.PI : TAU, 0, Math.PI / 2));
}

/**
 * Vertical pressure vessel centred on the origin, axis y, straight length `len`
 * between tangent lines, with 2:1 ellipsoidal heads. With `cut`, only the back half
 * is drawn plus the section faces of the wall, like an engineering cutaway.
 */
export function vesselV(r: number, len: number, ms: PartMaterials, cut: boolean, o: VesselOpts = {}): Group {
  const { headK = 0.5, wall = 0.05, heads = [true, true], shellName } = o;
  const g = new Group();
  const outer = cyl(r, r, len, ms.get('steel'), { open: true, cut, seg: 64 });
  if (shellName) outer.name = shellName;
  g.add(outer, cyl(r - wall, r - wall, len, ms.get('inner'), { open: true, cut, seg: 64 }));
  [1, -1].forEach((s, i) => {
    if (!heads[i]) return;
    for (const [rr, mat] of [
      [r, ms.get('steel')],
      [r - wall, ms.get('inner')],
    ] as const) {
      const h = new Mesh(headGeometry(rr, cut), mat);
      h.scale.y = headK;
      h.position.y = (s * len) / 2;
      if (s < 0) h.rotation.z = Math.PI; // flip about z: (x, y, z) → (-x, -y, z) keeps the back half
      g.add(h);
    }
  });
  if (cut) {
    for (const sx of [1, -1]) {
      const f = box(wall, len, 0.004, ms.get('face'));
      f.position.x = sx * (r - wall / 2);
      g.add(f);
    }
  }
  return g;
}

/** Nozzle: neck + weld-neck flange, along `dir` from `pos`. `blind` adds a bolted blind (manway). */
export function nozzle(ms: PartMaterials, r: number, len: number, pos: Vector3, dir: Vector3, blind = false): Group {
  const g = new Group();
  const neck = cyl(r, r, len, ms.get('steel'), { seg: 24 });
  neck.position.y = len / 2;
  const flange = cyl(r * 1.75, r * 1.75, 0.07, ms.get('steel'), { seg: 32 });
  flange.position.y = len;
  g.add(neck, flange);
  if (blind) {
    const cover = cyl(r * 1.75, r * 1.75, 0.07, ms.get('steel'), { seg: 32 });
    cover.position.y = len + 0.07;
    g.add(cover);
    const n = Math.max(8, Math.round(r * 40));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const bolt = cyl(0.022, 0.022, 0.2, ms.get('dark'), { seg: 6 });
      bolt.position.set(Math.cos(a) * r * 1.45, len + 0.04, Math.sin(a) * r * 1.45);
      g.add(bolt);
    }
  }
  return orient(g, pos, dir);
}

/** Saddle support under a horizontal vessel of radius r whose axis is at height `axisY` above `floorY`. */
export function saddle(ms: PartMaterials, x: number, r: number, axisY: number, floorY = 0): Group {
  const g = new Group();
  const h = axisY - floorY - r * 0.75; // web reaches up to wrap the lower shell
  const web = box(0.16, h, r * 1.6, ms.get('steel'));
  web.position.set(x, floorY + h / 2, 0);
  const wear = box(0.22, 0.04, r * 1.7, ms.get('steel'));
  wear.position.set(x, floorY + h, 0);
  const basePlate = box(0.46, 0.05, r * 1.9, ms.get('dark'));
  basePlate.position.set(x, floorY + 0.025, 0);
  g.add(web, wear, basePlate);
  return g;
}

/** A pipe through points: straight runs (unit cylinders scaled) with ball elbows. */
export function pipe(points: Vector3[], mat: Material, r = 0.08): Group {
  const g = new Group();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    const run = cyl(r, r, len, mat, { seg: 16 });
    orient(run, a.clone().add(b).multiplyScalar(0.5), b.clone().sub(a));
    run.scale.y = len;
    g.add(run);
  }
  const elbow = shared(`elbow:${r}`, () => new SphereGeometry(r * 1.02, 16, 10));
  for (const p of points.slice(1, -1)) {
    const s = new Mesh(elbow, mat);
    s.position.copy(p);
    g.add(s);
  }
  return g;
}

/** Arc-shaped platform (grating + toe plate posts + two rails) around a vertical vessel. */
export function platform(ms: PartMaterials, rIn: number, rOut: number, y: number, a0: number, a1: number): Group {
  const g = new Group();
  const span = a1 - a0;
  const deckKey = `platDeck:${rIn}:${rOut}:${a0}:${a1}`;
  const deck = new Mesh(
    shared(deckKey, () => annularSector(rIn, rOut, 0.06, a0, a1)),
    ms.get('grate'),
  );
  deck.position.y = y;
  g.add(deck);
  const nPosts = Math.ceil(span / 0.32);
  const rr = rOut - 0.04;
  for (let k = 0; k <= nPosts; k++) {
    const a = a0 + (k / nPosts) * span;
    const post = cyl(0.018, 0.018, 1.0, ms.get('steel'), { seg: 8 });
    post.position.set(Math.cos(a) * rr, y + 0.5, Math.sin(a) * rr);
    g.add(post);
  }
  for (const h of [0.55, 1.0]) {
    const rail = new Mesh(
      shared(`rail:${rr}:${span}`, () => {
        const t = new TorusGeometry(rr, 0.018, 6, 48, span);
        t.rotateX(Math.PI / 2); // (cos u, sin u, 0) → (cos u, 0, sin u)
        return t;
      }),
      ms.get('steel'),
    );
    rail.rotation.y = -a0; // start the arc at a0 (rotation about y by -a0 maps angle u → u + a0)
    rail.position.y = y + h;
    g.add(rail);
  }
  return g;
}

/** Flat annular sector, thickness t below y = 0; angles from +x toward +z (matches cos a, sin a placement). */
function annularSector(rIn: number, rOut: number, t: number, a0: number, a1: number): BufferGeometry {
  const s = new Shape();
  // Shape is drawn in XY and mapped y → z below, so use the same angle sense.
  s.absarc(0, 0, rOut, a0, a1, false);
  s.absarc(0, 0, rIn, a1, a0, true);
  const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 32 });
  g.rotateX(Math.PI / 2); // shape (x, y) → (x, ·, y); extrusion +z → -y
  return g;
}

/** Caged-less vertical ladder (two side rails, rungs every 0.3 m) at angle a, radius rr. */
export function ladder(ms: PartMaterials, rr: number, a: number, y0: number, y1: number): Group {
  const g = new Group();
  const h = y1 - y0;
  for (const sx of [-0.2, 0.2]) {
    const rail = box(0.04, h, 0.06, ms.get('steel'));
    rail.position.set(sx, h / 2, 0);
    g.add(rail);
  }
  for (let y = 0.3; y < h; y += 0.3) {
    const rung = cyl(0.016, 0.016, 0.4, ms.get('steel'), { seg: 6 });
    rung.rotation.z = Math.PI / 2;
    rung.position.y = y;
    g.add(rung);
  }
  g.position.set(Math.cos(a) * rr, y0, Math.sin(a) * rr);
  g.rotation.y = -(a + Math.PI / 2); // rungs tangent to the shell
  return g;
}

/** Enable shadows on every opaque mesh under `o`. */
export function castShadows(o: Object3D): void {
  o.traverse((c) => {
    const m = c as Mesh;
    if (m.isMesh && !(m.material as Material).transparent) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}
