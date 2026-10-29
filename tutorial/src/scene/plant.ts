// The procedural distillation unit built from engine Results (spec §4): column with
// sieve trays, condenser, reflux drum, kettle reboiler, steel structure, piping and
// labels. Rebuilt on every result; geometry is shared across rebuilds (helpers.ts),
// materials are per part so highlight() never leaks.
//
// Plant layout (metres, y up, column axis at x = z = 0; cut plane z = 0, camera on +z):
//   feed line at -x, reboiler at x = 3.7 on grade, steel structure for the drum and
//   condenser at x = 7.4 (clear of the reboiler: its footprint starts at x = 5.8, the
//   kettle ends at x = 5.6). The drum sits above the reflux nozzle, so reflux flows
//   by gravity (no reflux pump is modelled).
import { Box3, Group, Material, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { componentName, fmtKgh, fmtTempC } from '../app/format';
import type { PartRef } from '../app/state';
import type { Results } from '../engine/types';
import {
  COLUMN,
  FEED_ABOVE_TRAY,
  REFLUX_BELOW_TOP,
  VAPOUR_RETURN_ABOVE_Y0,
  buildColumn,
  layoutColumn,
  type BuildCtx,
  type ColumnLayout,
} from './geometry/column';
import { buildCondenser, buildRefluxDrum, buildReboiler, buildStructure } from './geometry/exchangers';
import { PartMaterials, castShadows, disposeSharedGeometry, v3 } from './geometry/helpers';
import {
  buildCoolant,
  buildFeed,
  buildProcessPiping,
  buildSteam,
  coolantLabel,
  pipeLegend,
  steamLabel,
  type LegendEntry,
} from './geometry/piping';
import { buildTrays, downcomerSide, liquidPath } from './geometry/trays';
import { CAMERA_FOV_DEG, VIEW_DIRECTION } from './camera';
import { makeLabel } from './labels';

export { layoutColumn, MAX_DISPLAY_TRAYS, type ColumnLayout } from './geometry/column';
export { PIPE_COLORS, type LegendEntry } from './geometry/piping';

/** Teal emissive for the selected part (plan Task 10). */
export const HIGHLIGHT_EMISSIVE = 0x1d6b66;
/** Opacity factor while the current result is ok:false (Review Focus #1). */
export const GHOST_OPACITY = 0.5;

/**
 * Width / height of the region the stored anchor distances are fitted to: Lecture's
 * caption-safe area (right 62 % of 1920 x 1080 = 1.10). These distances are only the
 * fallback: fitted anchors also carry their box, and the CameraDirector refits that box
 * to the actual visible region (viewport minus the panel, caption, top bar or bottom
 * sheet; camera.ts fitPose) on every flight.
 */
export const FRAME_ASPECT = 1.1;
/** Breathing room around a fitted box. */
const FRAME_MARGIN = 1.1;

/**
 * Camera distance along VIEW_DIRECTION from `look` at which every corner of `box` lies
 * inside the view frustum (fov CAMERA_FOV_DEG, aspect FRAME_ASPECT), with a margin.
 * Per corner, in camera axes (right r, up u, toward-camera d): the corner at depth
 * dist - z must satisfy |y| <= (dist - z) tan(fov/2) and |x| <= (dist - z) tan(fov/2) aspect.
 */
export function fitDistance(box: Box3, look: Vector3, fovDeg = CAMERA_FOV_DEG, aspect = FRAME_ASPECT): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const d = VIEW_DIRECTION;
  const r = new Vector3(0, 1, 0).cross(d).normalize();
  const u = new Vector3().crossVectors(d, r);
  const v = new Vector3();
  let dist = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        v.set(x, y, z).sub(look);
        const depth = v.dot(d);
        dist = Math.max(dist, depth + (FRAME_MARGIN * Math.abs(v.dot(u))) / t, depth + (FRAME_MARGIN * Math.abs(v.dot(r))) / (t * aspect));
      }
  return dist;
}

/** Equipment placement (see the header comment). */
export const LAYOUT = {
  structureX: 7.4,
  reboilerX: 3.7,
  reboilerAxisY: 1.6,
  /** Drum axis above the top tangent line, and condenser axis above the drum axis. */
  drumAboveTop: 0.9,
  condenserAboveDrum: 2.6,
} as const;

export interface PlantOptions {
  cutaway: boolean;
  /** Colour utility lines by service (CW / ChW / steam); false draws them neutral grey. */
  utilityColors: boolean;
  /** Product purities (mole fractions of the light component) — they are inputs, not in Results. */
  products: { xD: number; xB: number };
  /** Called when a clickable label is clicked. */
  onSelect?: (part: PartRef) => void;
}

export interface Anchor {
  look: Vector3;
  dist: number;
  /** The framed object's world box (fitted anchors only): flights refit it to the visible region. */
  box?: Box3;
}
export type AnchorKey = PartRef['kind'] | 'overview';

export interface Plant {
  group: Group;
  layout: ColumnLayout;
  anchors: Record<AnchorKey, Anchor>;
  /** Liquid route for the flow particles: distributor → trays → downcomers → sump. */
  liquidPath: Vector3[];
  /** Region inside the column where vapour rises. */
  vaporBox: Box3;
  legend: LegendEntry[];
  /** Light the part's materials with the teal emissive; null clears. */
  highlight(part: PartRef | null): void;
  /**
   * Light one sub-mesh of a tray (its deck, weir or downcomer) with the teal emissive,
   * for the tray card's hover words; null restores the tray to its normal or selected look.
   */
  highlightSub(tray: number, sub: TraySub | null): void;
  /** 50 % opacity on every material (the last valid plant shown under an error). */
  setGhost(on: boolean): void;
  /** Remove from the scene and remove label elements. Materials (pooled) and geometry (shared) stay. */
  dispose(): void;
}

/** Tray sub-meshes tagged in geometry/trays.ts (`userData.sub`; also their material keys). */
export type TraySub = 'deck' | 'weir' | 'downcomer';

const partKey = (p: PartRef) => (p.kind === 'tray' ? `tray:${p.tray ?? 0}` : p.kind);

/** Shortest decimal form of a mol% value: 95 → "95", 99.5 → "99.5" (never rounds up to 100). */
function pct(fraction: number): string {
  const v = fraction * 100;
  for (let dp = 0; dp < 3; dp++) {
    const s = v.toFixed(dp);
    if (Math.abs(Number(s) - v) < 1e-6) return s;
  }
  return (Math.floor(v * 100) / 100).toFixed(2);
}

export function trayCountLabel(L: ColumnLayout): string {
  if (L.capped) return `${L.displayTrays}+ trays (column shortened for display)`;
  return `${L.trays} sieve tray${L.trays === 1 ? '' : 's'}`;
}

// Material sets live across rebuilds, keyed by part. Only one plant is shown at a time,
// so the pool is module-level; disposePlantResources() frees it on teardown.
const materialPool = new Map<string, PartMaterials>();
const MISC_KEY = '__misc'; // structure and process piping (not pickable)

function pooledSet(key: string, part: PartRef | null): PartMaterials {
  let s = materialPool.get(key);
  if (!s) materialPool.set(key, (s = new PartMaterials(part)));
  return s;
}

/** Free pooled materials and shared geometry (HMR / app teardown only). */
export function disposePlantResources(): void {
  for (const s of materialPool.values()) s.dispose();
  materialPool.clear();
  disposeSharedGeometry();
}

export function buildPlant(r: Results, opts: PlantOptions): Plant {
  const L = layoutColumn(r);
  // The previous plant may have left a highlight or ghosting on pooled materials.
  for (const s of materialPool.values()) s.reset();
  const sets = new Map<string, PartMaterials>(); // the sets this plant uses
  const ctx: BuildCtx = {
    cut: opts.cutaway,
    mats(part) {
      const k = partKey(part);
      let s = sets.get(k);
      if (!s) sets.set(k, (s = pooledSet(k, part)));
      return s;
    },
  };
  const misc = pooledSet(MISC_KEY, null);
  const group = new Group();
  group.name = 'plant';

  // ---- column, trays ----
  const col = buildColumn(ctx, L);
  group.add(col.group, buildTrays(ctx, L));
  const fY = L.trayY[L.feedTrayIndex] + FEED_ABOVE_TRAY;
  const feed = buildFeed(ctx, fY, (-downcomerSide(L.feedTrayIndex + 1)) as 1 | -1);
  group.add(feed.group);

  // ---- structure, condenser, drum, reboiler ----
  const sx = LAYOUT.structureX;
  const dY = L.yTop + LAYOUT.drumAboveTop;
  const cY = dY + LAYOUT.condenserAboveDrum;
  const drumDeckTop = dY - 0.85;
  const condDeckTop = cY - 0.95;
  group.add(buildStructure(misc, sx, [drumDeckTop, condDeckTop]));

  const cond = buildCondenser(ctx, condDeckTop - cY);
  cond.group.position.set(sx, cY, 0);
  const drum = buildRefluxDrum(ctx, drumDeckTop - dY);
  drum.group.position.set(sx, dY, 0);
  const rx = LAYOUT.reboilerX;
  const rY = LAYOUT.reboilerAxisY;
  const reb = buildReboiler(ctx, rY);
  reb.group.position.set(rx, rY, 0);
  group.add(cond.group, drum.group, reb.group);

  const at = (g: Object3D, p: Vector3) => p.clone().add(g.position);
  const cp = (k: string) => at(cond.group, cond.ports[k]);
  const dp = (k: string) => at(drum.group, drum.ports[k]);
  const rp = (k: string) => at(reb.group, reb.ports[k]);

  // ---- piping ----
  const proc = buildProcessPiping(misc, {
    columnOverhead: col.ports.overhead,
    columnBottoms: col.ports.bottoms,
    columnReflux: col.ports.reflux,
    columnVapourReturn: col.ports.vapourReturn,
    condVapourIn: cp('vapourIn'),
    condCondensateOut: cp('condensateOut'),
    drumCondensateIn: dp('condensateIn'),
    drumRefluxOut: dp('refluxOut'),
    drumDistillateOut: dp('distillateOut'),
    rebLiquidIn: rp('liquidIn'),
    rebVapourOut: rp('vapourOut'),
    rebBottomsOut: rp('bottomsOut'),
    overheadRunY: cY + 1.4,
  });
  group.add(proc.group);
  const coolant = buildCoolant(ctx, r.condenser, opts.utilityColors, {
    utilityIn: cp('utilityIn'),
    utilityOut: cp('utilityOut'),
    returnRunY: cY + 1.0,
    supplyRunY: cY - 1.35,
  });
  const steam = buildSteam(ctx, r.reboiler, opts.utilityColors, {
    steamIn: rp('steamIn'),
    condensateOut: rp('condensateOut'),
    steamRunY: rY + 1.05,
    condensateRunY: 0.6,
  });
  group.add(coolant.group, steam.group);
  castShadows(group);
  for (const [k, s] of materialPool) {
    if (k.startsWith('tray:') && !sets.has(k)) {
      s.dispose();
      materialPool.delete(k);
    }
  }

  // ---- labels ----
  const select = (part: PartRef) => () => opts.onSelect?.(part);
  const pin = (text: string, pos: Vector3, part?: PartRef) => {
    const l = makeLabel(text, part ? select(part) : undefined);
    l.position.copy(pos);
    group.add(l);
    return l;
  };
  const estimate = r.mode === 'simple' || r.TtopIsEstimate;
  const light = componentName(r.mixture.light);
  const heavy = componentName(r.mixture.heavy);
  const lastTrayY = L.trayY[L.displayTrays - 1];
  pin(trayCountLabel(L), v3(-1.9, L.yTop - 0.2, 0), { kind: 'column' });
  // The condensate (reflux and distillate) bubble point, so it sits on the condensate line from
  // the condenser to the reflux drum; beside tray 1 it read as the tray 1 temperature, which is
  // hotter (tray 1's liquid is leaner than xD).
  const condOut = cp('condensateOut');
  const drumIn = dp('condensateIn');
  pin(`Condensate ${fmtTempC(r.Ttop_C, estimate)}`, v3(condOut.x + 1.25, (condOut.y + drumIn.y) / 2, 0));
  pin(`Bottom ${fmtTempC(r.Tbot_C, estimate)}`, v3(-1.75, Math.min(lastTrayY - 0.6, L.y0 + 0.2), 0));
  pin(`Feed → tray ${r.feedTray}`, feed.labelAt, { kind: 'feed' });
  pin('Condenser', v3(sx, cY + 0.9, 0.7), { kind: 'condenser' });
  pin('Reflux drum', v3(sx + 1.9, dY + 0.45, 0), { kind: 'refluxDrum' });
  pin('Reboiler', v3(rx + 0.4, rY + 1.3, 0.7), { kind: 'reboiler' });
  pin(coolantLabel(r.condenser), coolant.labelAt, { kind: 'cwSystem' });
  pin(steamLabel(r.reboiler), steam.labelAt, { kind: 'steamSystem' });
  pin(
    `Distillate: ${pct(opts.products.xD)} mol% ${light} · ${fmtKgh(r.D_kgh)}`,
    proc.distillateEnd.clone().add(v3(-1.6, 0.45, 0)),
  );
  pin(`Bottoms: ${pct(1 - opts.products.xB)} mol% ${heavy} · ${fmtKgh(r.B_kgh)}`, proc.bottomsEnd.clone().add(v3(-2.2, 0.45, 0)));

  // ---- camera anchors ----
  const R = COLUMN.radius;
  const refluxY = L.yTop - REFLUX_BELOW_TOP;
  const midTray = L.trayY[Math.floor((L.displayTrays - 1) / 2)];
  const a = (x: number, y: number, z: number, dist: number): Anchor => ({ look: v3(x, y, z), dist });
  /** Anchor at the centre of an object's bounding box, at the distance that frames all of it. */
  const fitted = (o: Object3D): Anchor => {
    const box = new Box3().setFromObject(o); // pins (CSS2DObject) have no geometry: ignored
    const look = box.getCenter(new Vector3());
    return { look, dist: fitDistance(box, look), box };
  };
  const anchors: Record<AnchorKey, Anchor> = {
    overview: fitted(group),
    column: fitted(col.group),
    tray: a(0, midTray, 0, 5),
    feed: a(-1.2, fY, 0, 7),
    condenser: a(sx - 0.4, (cY + dY) / 2, 0, 10),
    refluxDrum: a(sx, dY, 0, 6.5),
    reboiler: a(rx + 0.1, rY + 0.6, 0, 8.5),
    sump: a(0, L.y0 + 0.1, 0, 5),
    distributor: a(0, refluxY, 0, 4.5),
    skirt: a(0, L.y0 / 2, 0, 7),
    manway: a(R * 0.8, col.manwayY[0], -R * 0.6, 4.5),
    platform: a(-R, col.platformY[0], -R * 1.2, 6),
    nozzle: a(0, L.yTop + 0.8, 0, 5),
    cwSystem: a(sx - 1.3, cY, -1.2, 7),
    steamSystem: a(rx - 1.6, rY + 0.6, -1.0, 6),
  };

  const vaporBox = new Box3(v3(-0.5, L.y0 + VAPOUR_RETURN_ABOVE_Y0, -0.6), v3(0.5, L.yTop, 0.6));
  const allSets = () => [...sets.values(), misc];

  let lit: string | null = null;
  const setEmissive = (key: string, on: boolean) => {
    for (const m of sets.get(key)?.all() ?? []) {
      const sm = m as MeshStandardMaterial;
      sm.emissive?.setHex(on ? HIGHLIGHT_EMISSIVE : (m.userData.baseEmissive as number));
    }
  };

  let disposed = false;
  return {
    group,
    layout: L,
    anchors,
    liquidPath: liquidPath(L, col.dripStart),
    vaporBox,
    legend: pipeLegend(r.condenser, r.reboiler, opts.utilityColors),
    highlight(part) {
      if (lit) setEmissive(lit, false);
      lit = part ? partKey(part) : null;
      if (lit) setEmissive(lit, true);
    },
    highlightSub(tray, sub) {
      const key = partKey({ kind: 'tray', tray });
      // Restore the tray first: teal if it is the selected part, its base look otherwise.
      setEmissive(key, lit === key);
      if (!sub) return;
      setEmissive(key, false);
      const m = sets.get(key)?.find(sub) as MeshStandardMaterial | undefined;
      m?.emissive?.setHex(HIGHLIGHT_EMISSIVE);
    },
    setGhost(on) {
      for (const s of allSets()) {
        for (const m of s.all() as Material[]) {
          const base = m.userData.baseOpacity as number;
          const transparent = on || (m.userData.baseTransparent as boolean);
          if (m.transparent !== transparent) m.needsUpdate = true; // shader variant changes
          m.transparent = transparent;
          m.opacity = on ? base * GHOST_OPACITY : base;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
      });
      for (const s of allSets()) s.reset();
    },
  };
}
