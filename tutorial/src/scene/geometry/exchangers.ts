// Overhead condenser (shell-and-tube), reflux drum, kettle reboiler and the steel
// structure that carries the condenser and drum. Each builder works in the
// equipment's local frame (axis along x, centre at the origin) and returns local
// port positions for the piping; plant.ts places the group.
import { ExtrudeGeometry, Group, Mesh, Shape, TorusGeometry, Vector3 } from 'three';
import type { BuildCtx } from './column';
import {
  TAU,
  box,
  cyl,
  nozzle,
  orient,
  saddle,
  shared,
  tag,
  v3,
  vesselV,
  type PartMaterials,
} from './helpers';

const X = v3(1, 0, 0);
const UPV = v3(0, 1, 0);
const DOWN = v3(0, -1, 0);

/** Group whose local +y is world +x: build vessel internals along y, see them along x. */
function axial(): Group {
  const g = new Group();
  g.rotation.z = -Math.PI / 2; // (x, y, z) → (y, -x, z)
  return g;
}

/**
 * Circular segment below `level` (radius r) extruded `len` along x, centred: liquid in a
 * horizontal drum (flat free surface) or, when thin, a plate that fits inside the shell.
 */
function segmentSlab(r: number, level: number, len: number): ExtrudeGeometry {
  return shared(`liqSeg:${r}:${level}:${len}`, () => {
    const a = Math.asin(Math.max(-0.99, Math.min(0.99, level / r)));
    const s = new Shape();
    s.absarc(0, 0, r, Math.PI - a, TAU + a, false);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 40 });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2); // extrusion z → x
    return g;
  });
}

export interface ExchangerBuild {
  group: Group;
  /** Local-frame connection points (flange faces). */
  ports: Record<string, Vector3>;
}

// ---------------------------------------------------------------------------------
// Condenser: shell r 0.55 with body flanges, tubesheets, 19-tube bundle, channel heads
// at both ends (pass partition in the utility-side channel) and saddles.

export const CONDENSER = { r: 0.55, len: 3.0 } as const;

export function buildCondenser(ctx: BuildCtx, floorY: number): ExchangerBuild {
  const ms = ctx.mats({ kind: 'condenser' });
  const g = tag(new Group(), { kind: 'condenser' });
  const ax = axial();
  ax.add(vesselV(CONDENSER.r, CONDENSER.len, ms, ctx.cut, { headK: 0.45 }));
  for (const s of [1, -1]) {
    const flange = cyl(0.66, 0.66, 0.08, ms.get('steel'), { cut: ctx.cut, seg: 48 });
    flange.position.y = s * 1.05;
    const sheet = cyl(0.5, 0.5, 0.04, ms.get('face'), { cut: ctx.cut, seg: 48 });
    sheet.position.y = s * 1.0;
    ax.add(flange, sheet);
  }
  // 1 + 6 + 12 tubes on two rings
  for (let k = 0; k < 19; k++) {
    const a = k < 1 ? 0 : k < 7 ? ((k - 1) / 6) * TAU : ((k - 7) / 12) * TAU + 0.26;
    const rr = k < 1 ? 0 : k < 7 ? 0.17 : 0.34;
    const tube = cyl(0.035, 0.035, 2.0, ms.get('tube'), { seg: 8 });
    tube.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    ax.add(tube);
  }
  // Pass partition in the -x channel: water in below it, out above it (two tube passes).
  const partition = box(0.02, 0.42, 1.0, ms.get('face'));
  partition.position.set(0, -1.27, 0);
  ax.add(partition);
  g.add(ax);

  const top = CONDENSER.r - 0.02;
  g.add(
    nozzle(ms, 0.2, 0.35, v3(0.3, top, 0), UPV), // vapour in
    nozzle(ms, 0.14, 0.3, v3(0.3, -top, 0), DOWN), // condensate out
    nozzle(ms, 0.1, 0.3, v3(-1.3, top, 0), UPV), // cooling water out
    nozzle(ms, 0.1, 0.3, v3(-1.3, -top, 0), DOWN), // cooling water in
  );
  for (const x of [-0.6, 0.6]) g.add(saddle(ms, x, CONDENSER.r, 0, floorY));
  return {
    group: g,
    ports: {
      vapourIn: v3(0.3, top + 0.385, 0),
      condensateOut: v3(0.3, -top - 0.335, 0),
      utilityOut: v3(-1.3, top + 0.335, 0),
      utilityIn: v3(-1.3, -top - 0.335, 0),
    },
  };
}

// ---------------------------------------------------------------------------------
// Reflux drum: horizontal, on saddles, liquid inventory, level glass on the end.

export const DRUM = { r: 0.5, len: 2.2 } as const;

export function buildRefluxDrum(ctx: BuildCtx, floorY: number): ExchangerBuild {
  const ms = ctx.mats({ kind: 'refluxDrum' });
  const g = tag(new Group(), { kind: 'refluxDrum' });
  const ax = axial();
  ax.add(vesselV(DRUM.r, DRUM.len, ms, ctx.cut));
  g.add(ax);
  const level = -0.08;
  g.add(new Mesh(segmentSlab(DRUM.r - 0.04, level, DRUM.len), ms.get('liquid')));

  const top = DRUM.r - 0.02;
  g.add(
    nozzle(ms, 0.14, 0.3, v3(0.3, top, 0), UPV), // condensate in
    nozzle(ms, 0.12, 0.3, v3(-0.6, -top, 0), DOWN), // reflux out
    nozzle(ms, 0.1, 0.3, v3(0.8, -top, 0), DOWN), // distillate out
  );
  // Level glass on the +x head: two small nozzles and a sight tube showing the level.
  const glassX = 1.56;
  for (const y of [0.3, -0.3]) {
    g.add(nozzle(ms, 0.04, 0.2, v3(1.27, y, 0), X));
  }
  const sight = cyl(0.035, 0.035, 0.75, ms.get('face'), { open: true, seg: 10 });
  sight.position.set(glassX, 0, 0);
  const sightLiquid = cyl(0.028, 0.028, level + 0.3, ms.get('liquid'), { seg: 10 });
  sightLiquid.position.set(glassX, (-0.3 + level) / 2, 0);
  for (const y of [0.39, -0.39]) {
    const cap = cyl(0.05, 0.05, 0.04, ms.get('steel'), { seg: 10 });
    cap.position.set(glassX, y, 0);
    g.add(cap);
  }
  g.add(sight, sightLiquid);
  for (const x of [-0.7, 0.7]) g.add(saddle(ms, x, DRUM.r, 0, floorY));
  return {
    group: g,
    ports: {
      condensateIn: v3(0.3, top + 0.335, 0),
      refluxOut: v3(-0.6, -top - 0.335, 0),
      distillateOut: v3(0.8, -top - 0.335, 0),
    },
  };
}

// ---------------------------------------------------------------------------------
// Kettle reboiler: large shell (r 0.85) with a reducer to the channel (r 0.5),
// U-tube bundle submerged in the boiling pool, overflow weir, steam in / condensate out
// on the channel, on saddles at grade.

export const KETTLE = { r: 0.85, rChannel: 0.5 } as const;

export function buildReboiler(ctx: BuildCtx, axisY: number): ExchangerBuild {
  const ms = ctx.mats({ kind: 'reboiler' });
  const g = tag(new Group(), { kind: 'reboiler' });
  const ax = axial();
  const { cut } = ctx;
  // Kettle shell from x = -0.7 to 1.5 with a head on +x.
  const shell = vesselV(KETTLE.r, 2.2, ms, cut, { heads: [true, false] });
  shell.position.y = 0.4;
  // Reducer (cone) from the channel to the kettle.
  const reducer = cyl(KETTLE.r, KETTLE.rChannel, 0.5, ms.get('steel'), { open: true, cut, seg: 48 });
  const reducerIn = cyl(KETTLE.r - 0.04, KETTLE.rChannel - 0.04, 0.5, ms.get('inner'), { open: true, cut, seg: 48 });
  reducer.position.y = reducerIn.position.y = -0.95;
  // Channel from x = -1.9 to -1.25 with its head on -x.
  const channel = vesselV(KETTLE.rChannel, 0.65, ms, cut, { heads: [false, true] });
  channel.position.y = -1.575;
  const flange = cyl(0.6, 0.6, 0.08, ms.get('steel'), { cut, seg: 48 });
  flange.position.y = -1.22;
  const sheet = cyl(0.47, 0.47, 0.04, ms.get('face'), { cut, seg: 48 });
  sheet.position.y = -1.2;
  const partition = box(0.02, 0.6, 0.9, ms.get('face'));
  partition.position.set(0, -1.55, 0); // steam above, condensate below
  ax.add(shell, reducer, reducerIn, channel, flange, sheet, partition);

  // U-tube bundle: 5 columns across z, two nested U's each, low in the shell.
  // In the axial frame local x = -world y, so world y = -0.42 is local x = 0.42.
  const tubeLen = 2.35;
  const tubeEnd = -1.2 + tubeLen;
  for (const z of [-0.36, -0.18, 0, 0.18, 0.36]) {
    for (const [lo, hi] of [
      [-0.42, -0.06],
      [-0.3, -0.18],
    ] as const) {
      for (const wy of [lo, hi]) {
        const t = cyl(0.035, 0.035, tubeLen, ms.get('tube'), { seg: 8 });
        t.position.set(-wy, -1.2 + tubeLen / 2, z);
        ax.add(t);
      }
      const rb = (hi - lo) / 2;
      const bend = new Mesh(shared(`ubend:${rb}`, () => new TorusGeometry(rb, 0.035, 6, 12, Math.PI)), ms.get('tube'));
      bend.position.set(-(lo + hi) / 2, tubeEnd, z); // arc u ∈ [0, π] bulges toward +y (world +x)
      ax.add(bend);
    }
  }
  g.add(ax);

  // Boiling pool up to the weir crest, and the low overflow compartment behind the weir.
  const poolLevel = 0.15;
  const pool = new Mesh(segmentSlab(KETTLE.r - 0.05, poolLevel, 2.2), ms.get('liquid'));
  pool.position.x = 0.4;
  const weirX = 1.5;
  const weir = new Mesh(segmentSlab(KETTLE.r - 0.03, poolLevel + 0.03, 0.04), ms.get('face'));
  weir.position.x = weirX;
  const overflow = new Mesh(segmentSlab(0.5, -0.3, 0.25), ms.get('liquid'));
  overflow.position.x = weirX + 0.14;
  g.add(pool, weir, overflow);

  const top = KETTLE.r - 0.02;
  g.add(
    nozzle(ms, 0.22, 0.35, v3(0.3, top, 0), UPV), // vapour to column
    nozzle(ms, 0.14, 0.3, v3(0.0, -top, 0), DOWN), // liquid from column sump
    nozzle(ms, 0.12, 0.3, v3(1.75, -0.66, 0), DOWN), // bottoms product (overflow side)
    nozzle(ms, 0.1, 0.3, v3(-1.6, KETTLE.rChannel - 0.02, 0), UPV), // steam in
    nozzle(ms, 0.08, 0.3, v3(-1.6, -(KETTLE.rChannel - 0.02), 0), DOWN), // condensate out
  );
  for (const x of [-0.45, 1.25]) g.add(saddle(ms, x, KETTLE.r, 0, -axisY));
  return {
    group: g,
    ports: {
      vapourOut: v3(0.3, top + 0.385, 0),
      liquidIn: v3(0.0, -top - 0.335, 0),
      bottomsOut: v3(1.75, -0.66 - 0.335, 0),
      steamIn: v3(-1.6, KETTLE.rChannel - 0.02 + 0.335, 0),
      condensateOut: v3(-1.6, -(KETTLE.rChannel - 0.02) - 0.335, 0),
    },
  };
}

// ---------------------------------------------------------------------------------
// Steel structure: four columns, beams and gratings at the drum and condenser decks,
// X-bracing on the back and side faces. Not pickable (no PartRef kind for it).

export const STRUCTURE = { halfX: 1.6, halfZ: 0.9 } as const;

export function buildStructure(ms: PartMaterials, cx: number, deckTops: number[]): Group {
  const g = new Group();
  const { halfX, halfZ } = STRUCTURE;
  const steel = ms.get('paintedSteel');
  const height = Math.max(...deckTops);
  const corners: [number, number][] = [
    [cx - halfX, -halfZ],
    [cx + halfX, -halfZ],
    [cx - halfX, halfZ],
    [cx + halfX, halfZ],
  ];
  for (const [x, z] of corners) {
    const c = box(0.14, height, 0.14, steel);
    c.position.set(x, height / 2, z);
    const plate = box(0.34, 0.03, 0.34, ms.get('dark'));
    plate.position.set(x, 0.015, z);
    g.add(c, plate);
  }
  for (const top of deckTops) {
    const beamY = top - 0.11;
    for (const z of [-halfZ, halfZ]) {
      const b = box(2 * halfX + 0.14, 0.14, 0.14, steel);
      b.position.set(cx, beamY, z);
      g.add(b);
    }
    for (const x of [cx - halfX, cx + halfX]) {
      const b = box(0.14, 0.14, 2 * halfZ, steel);
      b.position.set(x, beamY, 0);
      g.add(b);
    }
    const grating = box(2 * halfX - 0.04, 0.04, 2 * halfZ + 0.1, ms.get('grate'));
    grating.position.set(cx, top - 0.02, 0);
    g.add(grating);
  }
  // X-bracing in bays of about 4 m up to the lower deck, on the back face and both sides.
  const braceTop = Math.min(...deckTops) - 0.2;
  const bays = Math.max(1, Math.round(braceTop / 4));
  const bayH = braceTop / bays;
  const brace = (a: Vector3, b: Vector3) => {
    const len = a.distanceTo(b);
    const m = box(0.05, len, 0.05, steel);
    orient(m, a.clone().add(b).multiplyScalar(0.5), b.clone().sub(a));
    m.scale.set(0.05, len, 0.05);
    g.add(m);
  };
  for (let k = 0; k < bays; k++) {
    const y1 = k * bayH + 0.15;
    const y2 = (k + 1) * bayH;
    brace(v3(cx - halfX, y1, -halfZ), v3(cx + halfX, y2, -halfZ));
    brace(v3(cx + halfX, y1, -halfZ), v3(cx - halfX, y2, -halfZ));
    for (const x of [cx - halfX, cx + halfX]) {
      brace(v3(x, y1, -halfZ), v3(x, y2, halfZ));
      brace(v3(x, y1, halfZ), v3(x, y2, -halfZ));
    }
  }
  return g;
}
