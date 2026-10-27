// Column vessel: layout from Results, shell with 2:1 heads and girth seams, flared skirt
// with base ring and anchor bolts, flanged process nozzles, bolted manways, instrument
// taps, platforms with railings, ladder, sump liquid and the reflux distributor.
import { Group, LatheGeometry, Mesh, SphereGeometry, Vector2, Vector3 } from 'three';
import type { PartRef } from '../../app/state';
import type { Results } from '../../engine/types';
import {
  TAU,
  cyl,
  ladder,
  nozzle,
  platform,
  ring,
  shared,
  tag,
  v3,
  vesselV,
  type PartMaterials,
} from './helpers';

/** Pinned column geometry, metres (plan Task 10). */
export const COLUMN = {
  radius: 1.0,
  wall: 0.05,
  traySpacing: 0.62,
  /** Bottom tangent line to the bottom tray. */
  sump: 1.3,
  /** Top tray to the top tangent line. */
  topSpace: 0.9,
  /** Skirt height = elevation of the bottom tangent line, y0. */
  skirtHeight: 2.6,
} as const;

/** Review Focus #2: more actual trays than this are drawn as this many. */
export const MAX_DISPLAY_TRAYS = 120;
/** Sump liquid surface above the bottom tangent line. */
export const SUMP_LEVEL = 0.35;
/** Reflux inlet / distributor header elevation below the top tangent line. */
export const REFLUX_BELOW_TOP = 0.45;
/** Overhead vapour, reboiler vapour return: heights relative to the tangent lines. */
export const VAPOUR_RETURN_ABOVE_Y0 = 0.6;
/** Feed nozzle sits this far above its tray deck (between the feed tray and the tray above). */
export const FEED_ABOVE_TRAY = 0.22;

export interface ColumnLayout {
  /** Actual trays from the calculation. */
  trays: number;
  /** Trays drawn: min(trays, 120). */
  displayTrays: number;
  capped: boolean;
  /** Deck elevation of each drawn tray, tray 1 (top) first; strictly decreasing. */
  trayY: number[];
  /** Index into trayY of the feed tray. */
  feedTrayIndex: number;
  /** Bottom tangent line (top of the skirt). */
  y0: number;
  /** Top tangent line. */
  yTop: number;
}

export function layoutColumn(r: Pick<Results, 'actualTrays' | 'feedTray'>): ColumnLayout {
  const trays = Math.max(1, Math.round(r.actualTrays));
  const displayTrays = Math.min(trays, MAX_DISPLAY_TRAYS);
  const capped = trays > MAX_DISPLAY_TRAYS;
  const y0 = COLUMN.skirtHeight;
  const trayY = Array.from({ length: displayTrays }, (_, i) => y0 + COLUMN.sump + (displayTrays - 1 - i) * COLUMN.traySpacing);
  const feedIdx = Math.min(Math.max(1, Math.round(r.feedTray)), trays) - 1;
  // A shortened column keeps the feed at the same fraction of the height.
  const feedTrayIndex = capped ? Math.round((feedIdx * (displayTrays - 1)) / Math.max(1, trays - 1)) : feedIdx;
  return { trays, displayTrays, capped, trayY, feedTrayIndex, y0, yTop: trayY[0] + COLUMN.topSpace };
}

export interface BuildCtx {
  cut: boolean;
  /** Material set for a pickable part (shared by all groups of the same PartRef). */
  mats(part: PartRef): PartMaterials;
}

export interface ColumnBuild {
  group: Group;
  /** Distributor drip-tip point where the reflux liquid leaves the header. */
  dripStart: Vector3;
  /** World-space connection points for the piping (flange faces). */
  ports: {
    overhead: Vector3;
    bottoms: Vector3;
    reflux: Vector3;
    vapourReturn: Vector3;
  };
  manwayY: number[];
  platformY: number[];
}

// Platform / ladder / tap / manway angles (from +x toward +z); all on the back half
// (z < 0) so they stay visible in the cutaway, and clear of the feed nozzle at angle π.
const PLATFORM_MID = -2.3;
const PLATFORM_HALF_SPAN = 0.75;
const LADDER_ANGLE = PLATFORM_MID + 0.5;
const MANWAY_ANGLE = -0.6;
const TAP_ANGLE = -1.25;
const PLATFORM_EVERY_M = 6;
const MANWAY_EVERY_TRAYS = 7;
const TAP_EVERY_TRAYS = 5;

export function buildColumn(ctx: BuildCtx, L: ColumnLayout): ColumnBuild {
  const { cut } = ctx;
  const R = COLUMN.radius;
  const len = L.yTop - L.y0;
  const yMid = (L.y0 + L.yTop) / 2;
  const root = new Group();

  // ---- shell, heads, girth seams ----
  const shellMs = ctx.mats({ kind: 'column' });
  const column = tag(new Group(), { kind: 'column' });
  const shell = vesselV(R, len, shellMs, cut, { wall: COLUMN.wall, shellName: 'shell' });
  shell.position.y = yMid;
  column.add(shell);
  for (let y = L.y0 + 1.6; y < L.yTop - 0.3; y += 1.8) {
    const seam = ring(R + 0.004, 0.014, shellMs.get('steel'), cut, 64);
    seam.position.y = y;
    column.add(seam);
  }
  root.add(column);

  // ---- skirt, base ring, anchor bolts ----
  const skMs = ctx.mats({ kind: 'skirt' });
  const skirt = tag(new Group(), { kind: 'skirt' });
  const sk = cyl(R * 0.99, R * 1.28, L.y0, skMs.get('steel'), { open: true, cut, seg: 64 });
  const skIn = cyl(R * 0.95, R * 1.24, L.y0, skMs.get('inner'), { open: true, cut, seg: 64 });
  sk.position.y = skIn.position.y = L.y0 / 2;
  skirt.add(sk, skIn);
  const baseRing = new Mesh(
    shared('baseRing', () =>
      new LatheGeometry([new Vector2(1.05, 0), new Vector2(1.6, 0), new Vector2(1.6, 0.09), new Vector2(1.05, 0.09), new Vector2(1.05, 0)], 64),
    ),
    skMs.get('steel'),
  );
  skirt.add(baseRing);
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * TAU; // half a pitch off 0 so the bottoms line clears them
    const bolt = cyl(0.045, 0.045, 0.28, skMs.get('dark'), { seg: 8 });
    const nut = cyl(0.08, 0.08, 0.07, skMs.get('dark'), { seg: 6 });
    bolt.position.set(Math.cos(a) * 1.42, 0.14, Math.sin(a) * 1.42);
    nut.position.set(Math.cos(a) * 1.42, 0.125, Math.sin(a) * 1.42);
    skirt.add(bolt, nut);
  }
  root.add(skirt);

  // ---- process nozzles and instrument taps ----
  const nzMs = ctx.mats({ kind: 'nozzle' });
  const nozzles = tag(new Group(), { kind: 'nozzle' });
  const headTop = L.yTop + R * 0.5;
  const headBottom = L.y0 - R * 0.5;
  const refluxY = L.yTop - REFLUX_BELOW_TOP;
  const vapRetY = L.y0 + VAPOUR_RETURN_ABOVE_Y0;
  const nzLen = 0.45;
  nozzles.add(
    nozzle(nzMs, 0.24, nzLen, v3(0, headTop - 0.05, 0), v3(0, 1, 0)), // overhead vapour
    nozzle(nzMs, 0.16, nzLen, v3(0, headBottom + 0.05, 0), v3(0, -1, 0)), // bottoms
    nozzle(nzMs, 0.12, 0.4, v3(R - 0.02, refluxY, 0), v3(1, 0, 0)), // reflux inlet
    nozzle(nzMs, 0.2, 0.4, v3(R - 0.02, vapRetY, 0), v3(1, 0, 0)), // reboiler vapour return
  );
  const tapDir = v3(Math.cos(TAP_ANGLE), 0, Math.sin(TAP_ANGLE));
  for (let t = Math.min(2, L.displayTrays - 1); t < L.displayTrays; t += TAP_EVERY_TRAYS) {
    // pressure / temperature taps midway between trays
    const y = L.trayY[t] + COLUMN.traySpacing / 2;
    nozzles.add(nozzle(nzMs, 0.06, 0.25, tapDir.clone().multiplyScalar(R - 0.02).setY(y), tapDir));
  }
  root.add(nozzles);

  // ---- manways (bolted blind flanges), midway between trays ----
  const mwMs = ctx.mats({ kind: 'manway' });
  const mwDir = v3(Math.cos(MANWAY_ANGLE), 0, Math.sin(MANWAY_ANGLE));
  const manwayY: number[] = [L.y0 + 1.0]; // below the bottom tray, above the sump liquid
  for (let t = L.displayTrays - 1 - MANWAY_EVERY_TRAYS; t >= 1; t -= MANWAY_EVERY_TRAYS) {
    manwayY.push(L.trayY[t] + COLUMN.traySpacing / 2);
  }
  for (const y of manwayY) {
    root.add(tag(nozzle(mwMs, 0.3, 0.28, mwDir.clone().multiplyScalar(R - 0.02).setY(y), mwDir, true), { kind: 'manway' }));
  }

  // ---- platforms with railings, and the ladder ----
  const plMs = ctx.mats({ kind: 'platform' });
  const platforms = tag(new Group(), { kind: 'platform' });
  const a0 = PLATFORM_MID - PLATFORM_HALF_SPAN;
  const a1 = PLATFORM_MID + PLATFORM_HALF_SPAN;
  const platformY: number[] = [];
  for (let y = L.yTop - 0.55; y > L.y0 + 2; y -= PLATFORM_EVERY_M) platformY.push(y);
  if (platformY.length === 0) platformY.push(L.yTop - 0.55);
  for (const y of platformY) platforms.add(platform(plMs, R + 0.05, R + 0.85, y, a0, a1));
  platforms.add(ladder(plMs, R + 0.6, LADDER_ANGLE, 0, platformY[0] + 1.0));
  root.add(platforms);

  // ---- sump liquid in the bottom head ----
  const sumpMs = ctx.mats({ kind: 'sump' });
  const sump = tag(new Group(), { kind: 'sump' });
  const rl = R - COLUMN.wall - 0.01;
  const bowl = new Mesh(
    shared(`sumpBowl:${rl}`, () => new SphereGeometry(rl, 40, 12, 0, TAU, Math.PI / 2, Math.PI / 2)),
    sumpMs.get('liquid'),
  );
  bowl.scale.y = 0.5;
  bowl.position.y = L.y0;
  const pool = cyl(rl, rl, SUMP_LEVEL, sumpMs.get('liquid'), { seg: 40 });
  pool.position.y = L.y0 + SUMP_LEVEL / 2;
  sump.add(bowl, pool);
  root.add(sump);

  // ---- reflux distributor: header from the reflux nozzle, lateral over tray 1's inlet, drip pipes ----
  const dMs = ctx.mats({ kind: 'distributor' });
  const dist = tag(new Group(), { kind: 'distributor' });
  const lateralX = -0.55; // over the inlet area of tray 1 (its downcomer is on +x)
  const hdrLen = R - COLUMN.wall - lateralX;
  const header = cyl(0.07, 0.07, hdrLen, dMs.get('steel'), { seg: 16 });
  header.rotation.z = Math.PI / 2;
  header.position.set(lateralX + hdrLen / 2, refluxY, 0);
  const lateral = cyl(0.06, 0.06, 1.0, dMs.get('steel'), { seg: 16 });
  lateral.rotation.x = Math.PI / 2;
  lateral.position.set(lateralX, refluxY, 0);
  dist.add(header, lateral);
  const dripLen = 0.18;
  for (const z of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const drip = cyl(0.03, 0.03, dripLen, dMs.get('steel'), { seg: 8 });
    drip.position.set(lateralX, refluxY - 0.06 - dripLen / 2, z);
    dist.add(drip);
  }
  root.add(dist);

  return {
    group: root,
    dripStart: v3(lateralX, refluxY - 0.06 - dripLen + 0.005, 0),
    ports: {
      overhead: v3(0, headTop - 0.05 + nzLen + 0.035, 0),
      bottoms: v3(0, headBottom + 0.05 - nzLen - 0.035, 0),
      reflux: v3(R - 0.02 + 0.4 + 0.035, refluxY, 0),
      vapourReturn: v3(R - 0.02 + 0.4 + 0.035, vapRetY, 0),
    },
    manwayY,
    platformY,
  };
}
