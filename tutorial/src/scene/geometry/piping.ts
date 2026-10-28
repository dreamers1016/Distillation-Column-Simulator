// Piping coloured by service: process vapour, process liquid, feed, cooling / chilled
// water and steam. Utility colours and labels follow the selected utility (spec §5.6).
import { Group, Mesh, TorusGeometry, Vector3 } from 'three';
import type { CondenserResult, ReboilerResult } from '../../engine/utilities';
import { COLUMN, type BuildCtx } from './column';
import { CHORD_X } from './trays';
import { box, cyl, nozzle, orient, pipe, shared, tag, v3, type PartMaterials } from './helpers';

export const PIPE_COLORS = {
  vapour: '#b5523b',
  liquid: '#3b6fb5',
  feed: '#7d5ba6',
  cw: '#3d8f5a',
  chw: '#2fa8c8',
  steam: '#8a6a2a',
  /** Infeasible utility (refrigeration / hot oil) or utility colours switched off. */
  neutral: '#8d949b',
} as const;

export interface LegendEntry {
  label: string;
  color: string;
}

/** Line colour for the condenser utility. */
export function coolantColor(c: CondenserResult, utilityColors: boolean): string {
  if (!utilityColors) return PIPE_COLORS.neutral;
  if (c.utility === 'CW') return PIPE_COLORS.cw;
  if (c.utility === 'ChW') return PIPE_COLORS.chw;
  return PIPE_COLORS.neutral;
}

export function steamColor(rb: ReboilerResult, utilityColors: boolean): string {
  return utilityColors && rb.level !== 'HOT_OIL' ? PIPE_COLORS.steam : PIPE_COLORS.neutral;
}

/** 30 → "30", 3.5 → "3.5" (no trailing ".0"). */
const trim1 = (v: number) => String(Math.round(v * 10) / 10);

/** "CW 30→40 °C" / "ChW 7→12 °C"; refrigeration is outside this tool. */
export function coolantLabel(c: CondenserResult): string {
  if (c.utility === 'REFRIGERATION') return 'Refrigeration needed — outside this tool';
  const base = `${c.utility} ${trim1(c.in_C)}→${trim1(c.out_C)} °C`;
  return c.feasible ? base : `${base} — infeasible`;
}

/** "LP steam 3.5 barg"; hot oil / fired heater is outside this tool. */
export function steamLabel(rb: ReboilerResult): string {
  if (rb.level === 'HOT_OIL') return 'Hot oil / fired heater needed — outside this tool';
  const base = `${rb.level} steam ${trim1(rb.P_barg)} barg`;
  return rb.feasible ? base : `${base} — infeasible`;
}

export function pipeLegend(c: CondenserResult, rb: ReboilerResult, utilityColors: boolean): LegendEntry[] {
  const coolant = c.utility === 'ChW' ? 'Chilled water' : c.utility === 'CW' ? 'Cooling water' : 'Refrigerant (outside tool)';
  return [
    { label: 'Process vapour', color: PIPE_COLORS.vapour },
    { label: 'Process liquid', color: PIPE_COLORS.liquid },
    { label: 'Feed', color: PIPE_COLORS.feed },
    { label: coolant, color: coolantColor(c, utilityColors) },
    { label: rb.level === 'HOT_OIL' ? 'Hot oil (outside tool)' : 'Steam / condensate', color: steamColor(rb, utilityColors) },
  ];
}

/** Every pipe mesh of a utility system is marked so tests and cards can find the line. */
function markUtility(g: Group): Group {
  g.traverse((o) => {
    if ((o as Mesh).isMesh) o.userData.utilityLine = true;
  });
  return g;
}

/** Blind flange closing a line that continues to a utility header / battery limit. */
function endFlange(mat: PartMaterials, r: number, at: Vector3, dir: Vector3): Mesh {
  const f = cyl(r * 1.8, r * 1.8, 0.06, mat.get('steel'), { seg: 24 });
  return orient(f, at, dir);
}

// ---------------------------------------------------------------------------------

export interface ProcessPorts {
  columnOverhead: Vector3;
  columnBottoms: Vector3;
  columnReflux: Vector3;
  columnVapourReturn: Vector3;
  condVapourIn: Vector3;
  condCondensateOut: Vector3;
  drumCondensateIn: Vector3;
  drumRefluxOut: Vector3;
  drumDistillateOut: Vector3;
  rebLiquidIn: Vector3;
  rebVapourOut: Vector3;
  rebBottomsOut: Vector3;
  /** Elevation of the horizontal overhead vapour run. */
  overheadRunY: number;
}

export interface ProcessPiping {
  group: Group;
  /** Ends of the product lines (for the product labels). */
  distillateEnd: Vector3;
  bottomsEnd: Vector3;
}

/** Process lines (not pickable: no PartRef kind for them). */
export function buildProcessPiping(misc: PartMaterials, p: ProcessPorts): ProcessPiping {
  const g = new Group();
  const vap = misc.paint(PIPE_COLORS.vapour);
  const liq = misc.paint(PIPE_COLORS.liquid);
  // Overhead vapour: column top → up → across → down into the condenser.
  g.add(
    pipe(
      [p.columnOverhead, v3(p.columnOverhead.x, p.overheadRunY, 0), v3(p.condVapourIn.x, p.overheadRunY, 0), p.condVapourIn],
      vap,
      0.13,
    ),
  );
  // Condensate drops straight into the drum.
  g.add(pipe([p.condCondensateOut, p.drumCondensateIn], liq, 0.1));
  // Gravity reflux: the drum outlet is above the reflux nozzle.
  g.add(pipe([p.drumRefluxOut, v3(p.drumRefluxOut.x, p.columnReflux.y, 0), p.columnReflux], liq, 0.07));
  const distillateEnd = v3(p.drumDistillateOut.x + 2.2, p.columnReflux.y, 0);
  g.add(pipe([p.drumDistillateOut, v3(p.drumDistillateOut.x, p.columnReflux.y, 0), distillateEnd], liq, 0.07));
  g.add(endFlange(misc, 0.07, distillateEnd, v3(1, 0, 0)));
  // Sump liquid down through the skirt to the reboiler.
  const lowRun = 0.3;
  g.add(pipe([p.columnBottoms, v3(p.columnBottoms.x, lowRun, 0), v3(p.rebLiquidIn.x, lowRun, 0), p.rebLiquidIn], liq, 0.1));
  // Reboiler vapour back to the column below the bottom tray (nozzle on the back, -z).
  const vr = p.columnVapourReturn;
  g.add(pipe([p.rebVapourOut, v3(p.rebVapourOut.x, vr.y, 0), v3(p.rebVapourOut.x, vr.y, vr.z), vr], vap, 0.15));
  // Bottoms product from the overflow compartment, under the structure, to battery limit.
  const bottomsEnd = v3(p.rebBottomsOut.x + 4.8, 0.2, 0);
  g.add(pipe([p.rebBottomsOut, v3(p.rebBottomsOut.x, 0.2, 0), bottomsEnd], liq, 0.08));
  g.add(endFlange(misc, 0.08, bottomsEnd, v3(1, 0, 0)));
  return { group: g, distillateEnd, bottomsEnd };
}

// ---------------------------------------------------------------------------------

/**
 * Feed: nozzle on -x, internal feed pipe, external line with a control valve. The feed
 * lands on the feed tray's inlet area (the side opposite its downcomer):
 * - inlet on -x, the nozzle side (odd drawn tray): a short stub ending in the gap between
 *   the shell and the downcomer apron of the tray above, i.e. a downcomer feed (tray 1 has
 *   no tray above, so the stub ends over its inlet area);
 * - inlet on +x (even drawn tray): a pipe across the active area that ends short of the
 *   apron of the tray above, which hangs over that inlet area.
 * Either way the pipe clears every apron, weir and deck.
 */
export function buildFeed(ctx: BuildCtx, fY: number, inletSide: 1 | -1): { group: Group; labelAt: Vector3 } {
  const ms = ctx.mats({ kind: 'feed' });
  const g = tag(new Group(), { kind: 'feed' });
  const R = COLUMN.radius;
  const nzLen = 0.45;
  g.add(nozzle(ms, 0.15, nzLen, v3(-R + 0.02, fY, 0), v3(-1, 0, 0)));
  const x0 = -(R - COLUMN.wall);
  const x1 = inletSide < 0 ? -(CHORD_X + 0.1) : CHORD_X - 0.15;
  const internal = cyl(0.06, 0.06, x1 - x0, ms.get('steel'), { seg: 12 });
  internal.name = 'feedPipe';
  internal.rotation.z = Math.PI / 2;
  internal.position.set((x0 + x1) / 2, fY, 0);
  g.add(internal);
  const flangeX = -R + 0.02 - nzLen - 0.035;
  const riserX = -6;
  const line = ms.paint(PIPE_COLORS.feed);
  g.add(pipe([v3(flangeX, fY, 0), v3(riserX, fY, 0), v3(riserX, 0.35, 0)], line, 0.11));
  g.add(endFlange(ms, 0.11, v3(riserX, 0.35, 0), v3(0, -1, 0)));
  // Control valve body and handwheel on the horizontal run.
  const valveX = -4;
  const body = box(0.36, 0.36, 0.36, ms.get('dark'));
  body.position.set(valveX, fY, 0);
  const stem = cyl(0.025, 0.025, 0.35, ms.get('steel'), { seg: 8 });
  stem.position.set(valveX, fY + 0.35, 0);
  const wheel = new Mesh(shared('handwheel', () => new TorusGeometry(0.16, 0.02, 6, 24)), ms.get('steel'));
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(valveX, fY + 0.52, 0);
  g.add(body, stem, wheel);
  return { group: g, labelAt: v3(-4.5, fY + 0.75, 0) };
}

// ---------------------------------------------------------------------------------

const HEADER_Z = -2.4;

/** Coolant supply and return on the condenser channel, running back to the utility header. */
export function buildCoolant(
  ctx: BuildCtx,
  c: CondenserResult,
  utilityColors: boolean,
  ports: { utilityIn: Vector3; utilityOut: Vector3; returnRunY: number; supplyRunY: number },
): { group: Group; labelAt: Vector3 } {
  const ms = ctx.mats({ kind: 'cwSystem' });
  const g = tag(new Group(), { kind: 'cwSystem' });
  const mat = ms.paint(coolantColor(c, utilityColors));
  const r = 0.07;
  const ret = v3(ports.utilityOut.x, ports.returnRunY, HEADER_Z);
  const sup = v3(ports.utilityIn.x, ports.supplyRunY, HEADER_Z);
  const lines = new Group();
  lines.add(pipe([ports.utilityOut, v3(ret.x, ret.y, 0), ret], mat, r));
  lines.add(pipe([ports.utilityIn, v3(sup.x, sup.y, 0), sup], mat, r));
  g.add(markUtility(lines));
  g.add(endFlange(ms, r, ret, v3(0, 0, -1)), endFlange(ms, r, sup, v3(0, 0, -1)));
  return { group: g, labelAt: v3(ret.x, (ret.y + sup.y) / 2, HEADER_Z - 0.2) };
}

/** Steam to the reboiler channel and condensate back, to the steam header / condensate return. */
export function buildSteam(
  ctx: BuildCtx,
  rb: ReboilerResult,
  utilityColors: boolean,
  ports: { steamIn: Vector3; condensateOut: Vector3; steamRunY: number; condensateRunY: number },
): { group: Group; labelAt: Vector3 } {
  const ms = ctx.mats({ kind: 'steamSystem' });
  const g = tag(new Group(), { kind: 'steamSystem' });
  const mat = ms.paint(steamColor(rb, utilityColors));
  const st = v3(ports.steamIn.x, ports.steamRunY, HEADER_Z);
  const cd = v3(ports.condensateOut.x, ports.condensateRunY, HEADER_Z);
  const lines = new Group();
  lines.add(pipe([ports.steamIn, v3(st.x, st.y, 0), st], mat, 0.07));
  lines.add(pipe([ports.condensateOut, v3(cd.x, cd.y, 0), cd], mat, 0.05));
  g.add(markUtility(lines));
  g.add(endFlange(ms, 0.07, st, v3(0, 0, -1)), endFlange(ms, 0.05, cd, v3(0, 0, -1)));
  return { group: g, labelAt: v3(st.x, st.y + 0.4, HEADER_Z) };
}
