// Column profile (Advanced only): temperature, liquid x and vapour y down the
// column, tray 1 at the top. One plot with two horizontal axes: temperature on
// the bottom (red), mole fraction of the light component on the top (blue/teal).
// The values are the solver's interpolated per-tray profile.
import type { Results } from '../../engine/types';
import { componentName, fmtNum, mixtureLabel } from '../format';
import { FEED, GRID, INK, MUTED, label, niceStep, num, pts, svgEl } from './svg';

export const PF = { W: 520, H: 580, left: 56, right: 22, top: 80, height: 380 } as const;
const PLOT_W = PF.W - PF.left - PF.right;
const PAD = 10; // vertical room above tray 1 and below the last tray

const C_T = '#b4331f';
const C_X = '#1d4e89';
const C_Y = '#0d7c79';

type TrayPoint = NonNullable<Results['trayProfile']>[number];

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

  // tray ticks: tray 1, then multiples of a round step, then the last tray
  const step = M <= 12 ? 1 : niceStep(M - 1, 8);
  const ticks = [1];
  for (let t = step; t <= M; t += step) if (t > 1) ticks.push(t);
  if (ticks[ticks.length - 1] !== M && M - ticks[ticks.length - 1] >= step / 2) ticks.push(M);
  for (const t of ticks) {
    kids.push(svgEl('line', { x1: X(0), y1: num(Y(t)), x2: X(1), y2: num(Y(t)), stroke: GRID, 'stroke-width': 1 }));
    kids.push(label(PF.left - 9, Y(t) + 5, String(t), { anchor: 'end', fill: MUTED }));
  }
  kids.push(label(18, PF.top + PF.height / 2, 'Tray (1 = top)', { anchor: 'middle', rotate: -90 }));

  // bottom axis: temperature
  for (let T = tLo; T <= tHi + 1e-9; T += tStep) {
    kids.push(svgEl('line', { x1: num(XT(T)), y1: bottom, x2: num(XT(T)), y2: bottom + 6, stroke: C_T, 'stroke-width': 1.5 }));
    kids.push(label(XT(T), bottom + 25, fmtNum(T), { anchor: 'middle', fill: C_T }));
  }
  kids.push(label(X(0.5), bottom + 52, 'Temperature, °C', { anchor: 'middle', fill: C_T, weight: 'bold' }));

  // top axis: mole fraction
  for (let k = 0; k <= 5; k++) {
    const v = k / 5;
    kids.push(svgEl('line', { x1: num(X(v)), y1: PF.top - 6, x2: num(X(v)), y2: PF.top, stroke: C_X, 'stroke-width': 1.5 }));
    kids.push(label(X(v), PF.top - 12, k === 0 ? '0' : k === 5 ? '1' : v.toFixed(1), { anchor: 'middle', fill: C_X }));
  }
  kids.push(label(X(0.5), PF.top - 38, `Mole fraction of ${light}`, { anchor: 'middle', fill: C_X, weight: 'bold' }));

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

  // legend
  const ly = bottom + 84;
  const entries: [number, number, string, string, string | undefined][] = [
    [0, 0, 'Temperature (bottom axis)', C_T, undefined],
    [0, 1, 'x, liquid (top axis)', C_X, undefined],
    [1, 0, 'y, vapour (top axis)', C_Y, '7 4'],
    [1, 1, `Feed tray ${feed}`, FEED, '8 5'],
  ];
  for (const [col, row, text, stroke, dash] of entries) {
    const x = PF.left + (col === 0 ? 0 : 252);
    const y = ly + row * 22;
    kids.push(svgEl('line', { x1: x, y1: y - 5, x2: x + 26, y2: y - 5, stroke, 'stroke-width': 3, 'stroke-dasharray': dash }));
    kids.push(label(x + 34, y, text, { class: 'pf-legend' }));
  }

  svg.replaceChildren(...kids);
}
