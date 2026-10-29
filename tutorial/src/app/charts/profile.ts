// Column profile (Advanced only): temperature, liquid x and vapour y down the
// column, tray 1 at the top. One plot with two horizontal axes: temperature on
// the bottom (red), mole fraction of the light component on the top (blue/teal).
// The values are the solver's interpolated per-tray profile.
import type { Results } from '../../engine/types';
import { componentName, fmtNum, mixtureLabel } from '../format';
import { CHART_W, FEED, FONT_SIZE, GRID, INK, MUTED, label, niceStep, num, pts, svgEl } from './svg';

const LEGEND_ROW = Math.round(FONT_SIZE * 1.4);
export const PF = { W: CHART_W, H: 84 + 380 + 96 + 3 * LEGEND_ROW + 14, left: 76, right: 24, top: 84, height: 380 } as const;
const PLOT_W = PF.W - PF.left - PF.right;
const PAD = 10; // vertical room above tray 1 and below the last tray

const C_T = '#b4331f';
const C_X = '#1d4e89';
const C_Y = '#0d7c79';

type TrayPoint = NonNullable<Results['trayProfile']>[number];

/** Decimals that make every tick of a `step`-spaced axis distinct: 1 → 0, 0.5 → 1, 0.2 → 1, 0.05 → 2. */
export function tickDecimals(step: number): number {
  if (!(step > 0) || step >= 1) return 0;
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

/**
 * Tray-axis ticks for M trays: tray 1, round multiples, and the last tray. A tick closer than
 * `minGap` (in units of tray index) to the one kept before it is dropped, so labels never
 * overlap (e.g. trays 1 and 2 at 26-29 trays); the last tray replaces a crowding neighbour.
 */
export function trayTicks(M: number, minGap: number): number[] {
  const step = M <= 12 ? 1 : niceStep(M - 1, 8);
  const ticks = [1];
  for (let t = step; t < M; t += step) if (t > 1 && t - ticks[ticks.length - 1] >= minGap) ticks.push(t);
  if (M > 1) {
    while (ticks.length > 1 && M - ticks[ticks.length - 1] < minGap) ticks.pop();
    if (M - ticks[ticks.length - 1] >= minGap) ticks.push(M);
  }
  return ticks;
}

export function renderProfile(svg: SVGSVGElement, r: Results): void {
  const prof = r.trayProfile;
  if (!prof || prof.length === 0) {
    svg.replaceChildren();
    return;
  }
  const M = prof.length;
  const light = componentName(r.mixture.light);

  // temperature axis: round limits around the data
  const Ts = prof.map((p) => p.T_C);
  const tMin = Math.min(...Ts);
  const tMax = Math.max(...Ts);
  const tStep = niceStep(Math.max(tMax - tMin, 1), 4);
  const tLo = Math.floor(tMin / tStep) * tStep;
  const tHi = Math.max(Math.ceil(tMax / tStep) * tStep, tLo + tStep);

  const X = (v: number) => PF.left + v * PLOT_W; // fraction axis, 0..1
  const XT = (T: number) => PF.left + ((T - tLo) / (tHi - tLo)) * PLOT_W;
  const Y = (tray: number) => PF.top + PAD + (M === 1 ? (PF.height - 2 * PAD) / 2 : ((tray - 1) / (M - 1)) * (PF.height - 2 * PAD));
  const bottom = PF.top + PF.height;

  svg.setAttribute('viewBox', `0 0 ${PF.W} ${PF.H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Column profile for ${mixtureLabel(r.mixture.id)}: ${M} trays, temperature from ${fmtNum(prof[0].T_C, 1)} °C at tray 1 (top) to ${fmtNum(prof[M - 1].T_C, 1)} °C at tray ${M} (bottom)`,
  );
  svg.classList.add('chart-svg', 'pf-chart');

  const kids: SVGElement[] = [];

  // tray ticks: tray 1, then multiples of a round step, then the last tray, never closer
  // than 1.15 text heights on screen
  const perTray = M > 1 ? (PF.height - 2 * PAD) / (M - 1) : Infinity;
  for (const t of trayTicks(M, (1.15 * FONT_SIZE) / perTray)) {
    kids.push(svgEl('line', { class: 'pf-tray-tick', 'data-tray': t, x1: X(0), y1: num(Y(t)), x2: X(1), y2: num(Y(t)), stroke: GRID, 'stroke-width': 1 }));
    kids.push(label(PF.left - 9, Y(t) + 7, String(t), { anchor: 'end', fill: MUTED }));
  }
  kids.push(label(22, PF.top + PF.height / 2, 'Tray (1 = top)', { anchor: 'middle', rotate: -90 }));

  // bottom axis: temperature, with enough decimals that no two ticks read the same
  const tDp = tickDecimals(tStep);
  const nT = Math.round((tHi - tLo) / tStep);
  for (let k = 0; k <= nT; k++) {
    const T = tLo + k * tStep; // by index: no accumulated float error
    kids.push(svgEl('line', { x1: num(XT(T)), y1: bottom, x2: num(XT(T)), y2: bottom + 6, stroke: C_T, 'stroke-width': 1.5 }));
    kids.push(label(XT(T), bottom + 27, fmtNum(T, tDp), { anchor: 'middle', fill: C_T, class: 'pf-t-tick' }));
  }
  kids.push(label(X(0.5), bottom + 58, 'Temperature, °C', { anchor: 'middle', fill: C_T, weight: 'bold' }));

  // top axis: mole fraction
  for (let k = 0; k <= 5; k++) {
    const v = k / 5;
    kids.push(svgEl('line', { x1: num(X(v)), y1: PF.top - 6, x2: num(X(v)), y2: PF.top, stroke: C_X, 'stroke-width': 1.5 }));
    kids.push(label(X(v), PF.top - 12, k === 0 ? '0' : k === 5 ? '1' : v.toFixed(1), { anchor: 'middle', fill: C_X }));
  }
  kids.push(label(X(0.5), PF.top - 44, `Mole fraction of ${light}`, { anchor: 'middle', fill: C_X, weight: 'bold' }));

  kids.push(svgEl('rect', { x: X(0), y: PF.top, width: PLOT_W, height: PF.height, fill: 'none', stroke: INK, 'stroke-width': 1.5 }));

  // feed tray marker
  const feed = Math.min(Math.max(r.feedTray, 1), M);
  kids.push(svgEl('line', { class: 'pf-feed', x1: X(0), y1: num(Y(feed)), x2: X(1), y2: num(Y(feed)), stroke: FEED, 'stroke-width': 2.5, 'stroke-dasharray': '8 5' }));
  kids.push(label(X(0) + 8, Y(feed) - 7, `Feed tray ${feed}`, { fill: FEED, weight: 'bold', halo: true }));

  // series
  const series = (cls: string, stroke: string, f: (p: TrayPoint) => number, dash?: string) => {
    const pp = prof.map((p): [number, number] => [f(p), Y(p.tray)]);
    kids.push(svgEl('polyline', { class: cls, points: pts(pp), fill: 'none', stroke, 'stroke-width': 3, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }));
    if (M <= 30) for (const [x, y] of pp) kids.push(svgEl('circle', { cx: num(x), cy: num(y), r: 3.5, fill: stroke }));
  };
  series('pf-x', C_X, (p) => X(p.x));
  series('pf-y', C_Y, (p) => X(p.y), '7 4');
  series('pf-T', C_T, (p) => XT(p.T_C));

  // legend: one column
  const ly = bottom + 96;
  const entries: [string, string, string | undefined][] = [
    ['Temperature (bottom axis)', C_T, undefined],
    ['x, liquid (top axis)', C_X, undefined],
    ['y, vapour (top axis)', C_Y, '7 4'],
    [`Feed tray ${feed}`, FEED, '8 5'],
  ];
  entries.forEach(([text, stroke, dash], row) => {
    const x = PF.left;
    const y = ly + row * LEGEND_ROW;
    kids.push(svgEl('line', { x1: x, y1: y - 7, x2: x + 26, y2: y - 7, stroke, 'stroke-width': 3, 'stroke-dasharray': dash }));
    kids.push(label(x + 36, y, text, { class: 'pf-legend' }));
  });

  svg.replaceChildren(...kids);
}
