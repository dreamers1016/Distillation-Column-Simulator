// Composition-coloured flow particles (spec §4 "Flow visualisation").
//
// Two THREE.Points, one per phase, each with a single BufferGeometry whose position and
// colour attributes are rewritten in place every frame (no per-frame allocation):
//   - liquid: 420 particles (more on taller columns, see particleCounts) on the
//     arclength-parametrised plant.liquidPath (across a deck, over the weir, down the
//     downcomer, ...), spread sideways so it reads as a sheet;
//   - vapour: 320 particles (likewise scaled) rising through the active area of the vapour box.
// Particles never shrink below MIN_PARTICLE_PX on screen (overview of a tall column).
// Speeds are time-based (dt seconds): liquid 0.9 m/s x L/L_ref above the feed tray and
// 0.9 x L'/L_ref from the feed tray down; vapour 1.4 m/s x V/V_ref above the feed tray and
// 1.4 x V'/V_ref below it. L_ref and V_ref come from the first solve after a mixture
// change (createFlow(..., prev) keeps them while the mixture stays the same).
//
// Colour = lerp(heavy, light, composition): liquid uses x, vapour uses y, read at the
// particle's height. Advanced: per-actual-tray trayProfile. Simple (trayProfile null): the
// actual trays span the theoretical trays (stages 1...N-1) with the engine's own formula
// s = 1 + (k - 1)(N - 2)/(actualTrays - 1) and linear interpolation of x and y in s
// (engine/profile.ts; at E_o = 1 tray k is stage k), with stage N's node replaced by the reboiler
// state x = xB, y = y*(xB): the stepped last stage overshoots below xB and the bottom of the
// column must end at the bottoms composition.
// Between two drawn decks the composition is linear in height; the ends are anchored at the
// real stream compositions (reflux / overhead vapour = xD, sump liquid = xB).
import { BufferAttribute, BufferGeometry, Color, DataTexture, LinearFilter, Points, PointsMaterial, RGBAFormat } from 'three';
import { COMPONENTS } from '../engine/components';
import { interpolateTray, profileNodes, type ProfileNode } from '../engine/profile';
import type { Results } from '../engine/types';
import { REFLUX_BELOW_TOP, SUMP_LEVEL, VAPOUR_RETURN_ABOVE_Y0, type ColumnLayout } from './geometry/column';
import { CHORD_X, TRAY_R } from './geometry/trays';
import type { Plant } from './plant';

/** Particle counts for a short column (up to 12 drawn trays); taller columns get more, see particleCounts. */
export const LIQUID_PARTICLES = 420;
export const VAPOUR_PARTICLES = 320;
/** Particles per drawn tray on taller columns, and the caps (per-frame cost stays bounded). */
const LIQUID_PER_TRAY = 35;
const VAPOUR_PER_TRAY = 27;
export const MAX_LIQUID_PARTICLES = 3000;
export const MAX_VAPOUR_PARTICLES = 2400;
/** Smallest on-screen particle diameter, CSS px (overview of a 120-tray column). */
export const MIN_PARTICLE_PX = 3.5;

/**
 * Particle counts for a column with `displayTrays` drawn trays: the short-column counts up
 * to 12 trays, then proportional to the tray count (the same density per tray), capped.
 */
export function particleCounts(displayTrays: number): { liquid: number; vapour: number } {
  const n = Math.max(0, Math.round(displayTrays));
  return {
    liquid: Math.min(MAX_LIQUID_PARTICLES, Math.max(LIQUID_PARTICLES, n * LIQUID_PER_TRAY)),
    vapour: Math.min(MAX_VAPOUR_PARTICLES, Math.max(VAPOUR_PARTICLES, n * VAPOUR_PER_TRAY)),
  };
}
export const LIGHT_COLOR = '#e2873a';
export const HEAVY_COLOR = '#2c6fbb';
/** Base particle speeds, m/s, at the reference flow. */
export const LIQUID_SPEED = 0.9;
export const VAPOUR_SPEED = 1.4;
export const PARTICLE_SIZE_M = 0.1;
export const PARTICLE_OPACITY = 0.9;
export const GHOST_PARTICLE_OPACITY = 0.25;

/** Liquid spreads over this fraction of the local chord half-width, and +-XJIT m across a downcomer. */
const Z_SPREAD = 0.75;
const X_JITTER = 0.07;
/** Vapour keeps this fraction of the shell chord in z, and stays this far inside the weir chord. */
const VAPOUR_Z_SPREAD = 0.85;
const VAPOUR_X_MARGIN = 0.03;
/** Points per tray in plant.liquidPath (see liquidPath() in geometry/trays.ts). */
const PATH_POINTS_PER_TRAY = 5;

export interface FlowLegend {
  light: { name: string; color: string };
  heavy: { name: string; color: string };
}

export interface FlowSpeeds {
  liquidAbove: number;
  liquidBelow: number;
  vaporAbove: number;
  vaporBelow: number;
}

export interface Flow {
  /** [liquid, vapour]. Add to the scene; not part of the pickable plant. */
  points: Points[];
  update(dt: number): void;
  legend: FlowLegend;
  /** Dim and freeze while the shown result is stale (error state). */
  setGhost(on: boolean): void;
  dispose(): void;
  // Read-only state: carry-over between rebuilds and tests.
  readonly mixtureId: string;
  readonly refs: { L: number; V: number };
  readonly speeds: FlowSpeeds;
  readonly pathLength: number;
  readonly liquidS: Float64Array;
  readonly vaporY: Float64Array;
  readonly vaporMinY: number;
  readonly vaporSpan: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const HEAVY = new Color(HEAVY_COLOR);
const LIGHT = new Color(LIGHT_COLOR);

/** Heavy-component colour at composition 0, light-component colour at 1 (clamped). */
export function compositionColor(c: number, out: Color = new Color()): Color {
  return out.copy(HEAVY).lerp(LIGHT, clamp01(c));
}

/** Liquid x and vapour y on true tray k (1 = top). */
function trayComposition(r: Results, k: number): { x: number; y: number } {
  const prof = r.trayProfile;
  if (prof && prof.length) {
    const p = prof[Math.min(Math.max(k, 1), prof.length) - 1];
    return { x: p.x, y: p.y };
  }
  // Simple mode: the engine's own tray <-> stage mapping and interpolation, with stage N's
  // node replaced by the reboiler state (x = xB, y = y*(xB)) exactly as Advanced does.
  const p = interpolateTray(reboilerNodes(r), k, r.actualTrays);
  return { x: p.x, y: p.y };
}

/** Stages 1...N-1 as stepped plus the reboiler state as stage N (the stepped x_N overshoots below xB). */
function reboilerNodes(r: Results): ProfileNode[] {
  return profileNodes(r.stages, { x: r.xB, y: r.yB, T_C: null });
}

/**
 * Composition (mole fraction of the light component) of the liquid (`'x'`) or vapour (`'y'`)
 * at elevation y. Piecewise linear in height through the drawn decks, with end anchors that
 * are the real stream compositions: reflux enters the top at x = xD (= y of stage 1) and the
 * overhead vapour is y = xD; the sump liquid is x = xB and the
 * reboiler vapour is y*(xB). Beyond the anchors the value is held.
 */
export function compositionAtHeight(L: ColumnLayout, r: Results, y: number, which: 'x' | 'y'): number {
  const n = L.displayTrays;
  const st = r.stages;
  const first = st[0];
  const top = which === 'x' ? [L.yTop - REFLUX_BELOW_TOP, first.y] : [L.yTop, first.y];
  // sump liquid = the bottoms product xB; reboiler vapour = y*(xB) (not the overshooting stepped stage N)
  const bottom = which === 'x' ? [L.y0 + SUMP_LEVEL, r.xB] : [L.y0 + VAPOUR_RETURN_ABOVE_Y0, r.yB];
  // knot 0 = top anchor, 1..n = drawn trays (top first), n + 1 = bottom anchor
  const kY = (i: number) => (i === 0 ? top[0] : i > n ? bottom[0] : L.trayY[i - 1]);
  const kV = (i: number) => (i === 0 ? top[1] : i > n ? bottom[1] : trayComposition(r, L.trayNo[i - 1])[which]);
  if (y >= kY(0)) return kV(0);
  if (y <= kY(n + 1)) return kV(n + 1);
  let i = 0;
  while (i + 1 < n + 1 && kY(i + 1) >= y) i++; // kY(i) >= y > kY(i + 1)
  const t = (kY(i) - y) / (kY(i) - kY(i + 1));
  const a = kV(i);
  return a + t * (kV(i + 1) - a);
}

/** Soft round sprite, generated in code (no assets, no canvas): white with a feathered alpha edge. */
let sprite: DataTexture | null = null;
function spriteTexture(): DataTexture {
  if (sprite) return sprite;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const d = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2) / (size / 2);
      const a = clamp01((1 - d) / 0.3);
      data.set([255, 255, 255, Math.round(255 * a)], (j * size + i) * 4);
    }
  }
  sprite = new DataTexture(data, size, size, RGBAFormat);
  sprite.magFilter = LinearFilter;
  sprite.minFilter = LinearFilter;
  sprite.needsUpdate = true;
  return sprite;
}

/** Deterministic PRNG so particles start in the same place for the same column. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePoints(count: number): { points: Points; pos: Float32Array; col: Float32Array } {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  const m = new PointsMaterial({
    size: PARTICLE_SIZE_M,
    sizeAttenuation: true,
    vertexColors: true,
    map: spriteTexture(),
    transparent: true,
    opacity: PARTICLE_OPACITY,
    depthWrite: false,
    toneMapped: false, // keep the legend colours true (no ACES shift)
  });
  // Keep a minimum on-screen size: the 'size' uniform is PARTICLE_SIZE_M x pixelRatio, so
  // size / PARTICLE_SIZE_M recovers the pixel ratio and the floor is MIN_PARTICLE_PX CSS px.
  m.onBeforeCompile = (shader) => {
    const attenuate = 'if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );';
    shader.vertexShader = shader.vertexShader.replace(
      attenuate,
      `${attenuate}\n\t\tgl_PointSize = max( gl_PointSize, ${MIN_PARTICLE_PX.toFixed(2)} * size / ${PARTICLE_SIZE_M.toFixed(4)} );`,
    );
  };
  m.customProgramCacheKey = () => `flow-min-${MIN_PARTICLE_PX}`;
  const points = new Points(g, m);
  points.frustumCulled = false; // positions change every frame; the bounding sphere is not maintained
  return { points, pos, col };
}

/**
 * Build the particle systems for a plant. `prev` is the flow of the previous rebuild: while the
 * mixture is unchanged its reference flows and particle phases carry over, so dragging a slider
 * changes speeds without restarting the animation. The caller disposes `prev` afterwards.
 */
export function createFlow(plant: Plant, r: Results, prev?: Flow): Flow {
  const mixtureId = r.mixture.id;
  const keep = prev && prev.mixtureId === mixtureId ? prev : undefined;
  const refs = keep ? { ...keep.refs } : { L: r.L, V: r.V };
  const ratio = (v: number, ref: number) => (ref > 1e-12 ? v / ref : 1);
  const speeds: FlowSpeeds = {
    liquidAbove: LIQUID_SPEED * ratio(r.L, refs.L),
    liquidBelow: LIQUID_SPEED * ratio(r.Lp, refs.L),
    vaporAbove: VAPOUR_SPEED * ratio(r.V, refs.V),
    vaporBelow: VAPOUR_SPEED * ratio(r.Vp, refs.V),
  };
  const layout = plant.layout;
  const rand = mulberry32(0x5eed + layout.displayTrays);
  const { liquid: NL, vapour: NV } = particleCounts(layout.displayTrays);
  // Phases carry over only between equal particle counts (same drawn tray band).
  const keepL = keep && keep.liquidS.length === NL ? keep : undefined;
  const keepV = keep && keep.vaporY.length === NV ? keep : undefined;

  // ---- colour look-up tables over the column height (composition depends on height only) ----
  const yMin = layout.y0;
  const yMax = layout.yTop;
  const bins = Math.min(1024, Math.max(256, layout.displayTrays * 8));
  const invDy = bins / (yMax - yMin);
  const lutX = new Float32Array((bins + 1) * 3);
  const lutY = new Float32Array((bins + 1) * 3);
  const tmp = new Color();
  for (let b = 0; b <= bins; b++) {
    const y = yMin + (b / bins) * (yMax - yMin);
    compositionColor(compositionAtHeight(layout, r, y, 'x'), tmp).toArray(lutX, b * 3);
    compositionColor(compositionAtHeight(layout, r, y, 'y'), tmp).toArray(lutY, b * 3);
  }
  const binOf = (y: number) => {
    const b = ((y - yMin) * invDy) | 0;
    return (b < 0 ? 0 : b > bins ? bins : b) * 3;
  };

  // ---- liquid: arclength-parametrised path ----
  const P = plant.liquidPath;
  const nSeg = P.length - 1;
  const cum = new Float64Array(nSeg + 1);
  const segLen = new Float64Array(nSeg);
  for (let i = 0; i < nSeg; i++) {
    segLen[i] = Math.max(P[i].distanceTo(P[i + 1]), 1e-9);
    cum[i + 1] = cum[i] + segLen[i];
  }
  const pathLength = cum[nSeg];
  // Per segment: below the feed tray (L') or above (L), and how much sideways spread across the
  // downcomer gap applies at its start / end (ramped so particles do not jump).
  const below = new Uint8Array(nSeg);
  const xjStart = new Float32Array(nSeg);
  const xjEnd = new Float32Array(nSeg);
  for (let p = 1; p < nSeg; p++) {
    below[p] = Math.floor((p - 1) / PATH_POINTS_PER_TRAY) >= layout.feedTrayIndex ? 1 : 0;
    const local = (p - 1) % PATH_POINTS_PER_TRAY; // 0 deck, 1 to weir crest, 2 over weir, 3 downcomer, 4 under apron
    if (local === 2) [xjStart[p], xjEnd[p]] = [0, 1];
    else if (local === 3) [xjStart[p], xjEnd[p]] = [1, 1];
    else if (local === 4) [xjStart[p], xjEnd[p]] = [1, 0];
  }
  const L = makePoints(NL);
  const liquidS = new Float64Array(NL);
  const liquidSeg = new Int32Array(NL);
  const lz = new Float32Array(NL);
  const lx = new Float32Array(NL);
  for (let i = 0; i < NL; i++) {
    const frac = keepL ? keepL.liquidS[i] / keepL.pathLength : (i + rand()) / NL;
    liquidS[i] = frac * pathLength;
    lz[i] = rand() * 2 - 1;
    lx[i] = rand() * 2 - 1;
    let seg = 0;
    while (seg < nSeg - 1 && liquidS[i] >= cum[seg + 1]) seg++;
    liquidSeg[i] = seg;
  }

  // ---- vapour: rises through the active area of the vapour box ----
  const box = plant.vaporBox;
  const vaporMinY = box.min.y;
  const vaporSpan = box.max.y - box.min.y;
  const feedDeckY = layout.trayY[layout.feedTrayIndex];
  const xHalf = Math.min(box.max.x, CHORD_X - VAPOUR_X_MARGIN);
  const V = makePoints(NV);
  const vaporY = new Float64Array(NV);
  const vx = new Float32Array(NV);
  const vz = new Float32Array(NV);
  for (let i = 0; i < NV; i++) {
    const frac = keepV ? (keepV.vaporY[i] - keepV.vaporMinY) / keepV.vaporSpan : (i + rand()) / NV;
    vaporY[i] = vaporMinY + clamp01(frac) * vaporSpan;
    vx[i] = (rand() * 2 - 1) * xHalf;
    const zHalf = Math.min(box.max.z, VAPOUR_Z_SPREAD * Math.sqrt(Math.max(0, TRAY_R * TRAY_R - vx[i] * vx[i])));
    vz[i] = (rand() * 2 - 1) * zHalf;
  }

  const attrs = (pts: Points) => ({
    position: pts.geometry.getAttribute('position') as BufferAttribute,
    color: pts.geometry.getAttribute('color') as BufferAttribute,
  });
  const lAttr = attrs(L.points);
  const vAttr = attrs(V.points);
  const write = () => {
    const lp = L.pos;
    const lc = L.col;
    for (let i = 0; i < NL; i++) {
      const seg = liquidSeg[i];
      const t = (liquidS[i] - cum[seg]) / segLen[seg];
      const a = P[seg];
      const b = P[seg + 1];
      const w = xjStart[seg] + (xjEnd[seg] - xjStart[seg]) * t;
      const x = a.x + (b.x - a.x) * t + lx[i] * X_JITTER * w;
      const y = a.y + (b.y - a.y) * t;
      const zHalf = Z_SPREAD * Math.sqrt(Math.max(0, TRAY_R * TRAY_R - x * x));
      const o = i * 3;
      lp[o] = x;
      lp[o + 1] = y;
      lp[o + 2] = lz[i] * zHalf;
      const c = binOf(y);
      lc[o] = lutX[c];
      lc[o + 1] = lutX[c + 1];
      lc[o + 2] = lutX[c + 2];
    }
    const vp = V.pos;
    const vc = V.col;
    for (let i = 0; i < NV; i++) {
      const o = i * 3;
      vp[o] = vx[i];
      vp[o + 1] = vaporY[i];
      vp[o + 2] = vz[i];
      const c = binOf(vaporY[i]);
      vc[o] = lutY[c];
      vc[o + 1] = lutY[c + 1];
      vc[o + 2] = lutY[c + 2];
    }
    lAttr.position.needsUpdate = lAttr.color.needsUpdate = true;
    vAttr.position.needsUpdate = vAttr.color.needsUpdate = true;
  };
  write();

  const mats = [L.points.material as PointsMaterial, V.points.material as PointsMaterial];
  let ghost = false;
  let disposed = false;
  return {
    points: [L.points, V.points],
    legend: {
      light: { name: COMPONENTS[r.mixture.light].name, color: LIGHT_COLOR },
      heavy: { name: COMPONENTS[r.mixture.heavy].name, color: HEAVY_COLOR },
    },
    mixtureId,
    refs,
    speeds,
    pathLength,
    liquidS,
    vaporY,
    vaporMinY,
    vaporSpan,
    update(dt) {
      if (ghost || !(dt > 0)) return;
      const dAbove = speeds.liquidAbove * dt;
      const dBelow = speeds.liquidBelow * dt;
      for (let i = 0; i < NL; i++) {
        let seg = liquidSeg[i];
        let s = liquidS[i] + (below[seg] ? dBelow : dAbove);
        if (s >= pathLength) {
          s %= pathLength;
          seg = 0;
        }
        while (s >= cum[seg + 1]) seg++;
        liquidS[i] = s;
        liquidSeg[i] = seg;
      }
      const upAbove = speeds.vaporAbove * dt;
      const upBelow = speeds.vaporBelow * dt;
      for (let i = 0; i < NV; i++) {
        let y = vaporY[i];
        y += y > feedDeckY ? upAbove : upBelow;
        if (y > vaporMinY + vaporSpan) y = vaporMinY + ((y - vaporMinY) % vaporSpan);
        vaporY[i] = y;
      }
      write();
    },
    setGhost(on) {
      ghost = on;
      for (const m of mats) m.opacity = on ? GHOST_PARTICLE_OPACITY : PARTICLE_OPACITY;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pts of [L.points, V.points]) {
        pts.removeFromParent();
        pts.geometry.dispose();
        (pts.material as PointsMaterial).dispose(); // the shared sprite texture stays
      }
    },
  };
}
