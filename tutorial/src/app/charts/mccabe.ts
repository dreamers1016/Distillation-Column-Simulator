// McCabe-Thiele diagram as plain SVG: equilibrium curve, y = x, q-line,
// both operating lines, the theoretical-stage steps (feed stage highlighted)
// and the xB / xF / xD markers. Drawn from the engine's own stages, so what the
// student sees is exactly what the solver stepped off.
import type { EquilibriumCurve } from '../../engine/curve';
import { qLineIntersection } from '../../engine/mccabe';
import type { Inputs, Results } from '../../engine/types';
import { componentName, fmtNum, mixtureLabel } from '../format';
import { CARD, FEED, GRID, INK, MUTED, label, num, pts, svgEl } from './svg';

/** Plot geometry in viewBox units: a square plot area with room for axis labels. */
export const MT = { W: 520, H: 590, left: 64, top: 14, size: 440 } as const;
const px = (x: number): number => MT.left + x * MT.size;
const py = (y: number): number => MT.top + (1 - y) * MT.size;

const C_EQ = '#1d4e89';
const C_RECT = '#0d7c79';
const C_STRIP = '#c2410c';
const C_Q = '#4b5563';
const C_DIAG = '#8a929b';
const CURVE_INTERVALS = 200;

export type McCabeOp = Pick<Inputs, 'xF' | 'xD' | 'xB' | 'R'>;

function equilibriumLabel(r: Results, P_bar: number | null): string {
  if (r.mode === 'simple') return `Equilibrium: constant α = ${fmtNum(r.mixture.simpleAlpha as number, 2)}`;
  return `Equilibrium: ${r.mixture.model === 'nrtl' ? 'NRTL' : 'ideal'} VLE at ${fmtNum(P_bar ?? 1.01325, 2)} bar`;
}

/**
 * Draw the diagram into `svg` (replacing its contents). `op` holds the
 * compositions and reflux ratio the result was solved with; `r.q` is the
 * feed condition actually used (Advanced derives it from the feed temperature).
 */
export function renderMcCabe(svg: SVGSVGElement, r: Results, curve: EquilibriumCurve, op: McCabeOp & Partial<Pick<Inputs, 'P_bar'>>): void {
  const { xF, xD, xB, R } = op;
  const light = componentName(r.mixture.light);
  const inter = qLineIntersection({ xF, xD, xB, R, q: r.q });

  svg.setAttribute('viewBox', `0 0 ${MT.W} ${MT.H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `McCabe-Thiele diagram for ${mixtureLabel(r.mixture.id)}: ${r.N} theoretical stages, feed on stage ${r.feedStage}`,
  );
  svg.classList.add('chart-svg', 'mt-chart');

  const kids: SVGElement[] = [];

  // grid, frame and ticks at 0.2 intervals
  for (let k = 0; k <= 5; k++) {
    const v = k / 5;
    const t = k === 0 ? '0' : k === 5 ? '1' : v.toFixed(1);
    kids.push(svgEl('line', { x1: num(px(v)), y1: num(py(0)), x2: num(px(v)), y2: num(py(1)), stroke: GRID, 'stroke-width': 1 }));
    kids.push(svgEl('line', { x1: num(px(0)), y1: num(py(v)), x2: num(px(1)), y2: num(py(v)), stroke: GRID, 'stroke-width': 1 }));
    kids.push(label(px(v), py(0) + 21, t, { anchor: 'middle', fill: MUTED }));
    kids.push(label(px(0) - 9, py(v) + 5, t, { anchor: 'end', fill: MUTED }));
  }
  kids.push(svgEl('rect', { x: px(0), y: py(1), width: MT.size, height: MT.size, fill: 'none', stroke: INK, 'stroke-width': 1.5 }));
  kids.push(label(px(0.5), py(0) + 50, `x, liquid mole fraction ${light}`, { anchor: 'middle' }));
  kids.push(label(18, py(0.5), `y, vapour mole fraction ${light}`, { anchor: 'middle', rotate: -90 }));

  // y = x
  kids.push(svgEl('line', { class: 'mt-diag', x1: num(px(0)), y1: num(py(0)), x2: num(px(1)), y2: num(py(1)), stroke: C_DIAG, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }));

  // equilibrium curve: 200 intervals, endpoints exactly (0,0) and (1,1)
  const curvePts: [number, number][] = [];
  for (let i = 0; i <= CURVE_INTERVALS; i++) {
    const x = i / CURVE_INTERVALS;
    curvePts.push([px(x), py(curve.yStar(x))]);
  }
  kids.push(svgEl('polyline', { class: 'mt-curve', points: pts(curvePts), fill: 'none', stroke: C_EQ, 'stroke-width': 3, 'stroke-linejoin': 'round' }));

  // operating lines and q-line
  const seg = (cls: string, a: [number, number], b: [number, number], stroke: string, extra: Record<string, string | number> = {}) =>
    svgEl('line', { class: cls, x1: num(px(a[0])), y1: num(py(a[1])), x2: num(px(b[0])), y2: num(py(b[1])), stroke, 'stroke-width': 2.5, ...extra });
  const I: [number, number] = [inter.x, inter.y];
  kids.push(seg('mt-rect', [xD, xD], I, C_RECT));
  kids.push(seg('mt-strip', I, [xB, xB], C_STRIP));
  kids.push(seg('mt-q', [xF, xF], I, C_Q, { 'stroke-dasharray': '7 4' }));

  // stage steps: horizontal to the curve, then vertical to the operating line
  const stages = r.stages;
  const N = stages.length;
  const every = N <= 15 ? 1 : N <= 40 ? 5 : 10;
  const labels: SVGElement[] = [];
  stages.forEach((s, i) => {
    const feed = s.n === r.feedStage;
    const x0 = i === 0 ? xD : stages[i - 1].x;
    const last = i === N - 1;
    const path: [number, number][] = [[px(x0), py(s.y)], [px(last ? xB : s.x), py(s.y)]];
    if (!last) path.push([px(s.x), py(stages[i + 1].y)]);
    kids.push(
      svgEl('polyline', {
        class: feed ? 'mt-step feed' : 'mt-step',
        'data-stage': s.n,
        points: pts(path),
        fill: 'none',
        stroke: feed ? FEED : INK,
        'stroke-width': feed ? 3.5 : 1.6,
        'stroke-linejoin': 'miter',
      }),
    );
    if (feed || last || s.n % every === 0) {
      // upper left of the corner on the curve; when the curve hugs the y axis, to its right instead
      const left = px(s.x) - 5 - 12 >= MT.left;
      labels.push(label(left ? px(s.x) - 5 : px(s.x) + 6, py(s.y) - 6, String(s.n), { anchor: left ? 'end' : 'start', weight: 'bold', fill: feed ? FEED : INK, halo: true, class: 'mt-stage-no' }));
    }
  });
  kids.push(...labels);

  // xB, xF, xD: a marker on the diagonal with a dotted drop to the x axis. Labels sit
  // just above the axis, where the plot is empty (everything drawn lies on or above
  // y = x); xF takes the second row so it cannot run into a nearby xB.
  const marks: [string, number, number][] = [['xB', xB, 10], ['xF', xF, 34], ['xD', xD, 10]];
  for (const [, v] of marks) {
    kids.push(svgEl('line', { x1: num(px(v)), y1: num(py(v)), x2: num(px(v)), y2: num(py(0)), stroke: MUTED, 'stroke-width': 1.5, 'stroke-dasharray': '2 3' }));
  }
  for (const [id, v, rise] of marks) {
    kids.push(svgEl('circle', { 'data-marker': id, cx: num(px(v)), cy: num(py(v)), r: 5, fill: INK, stroke: CARD, 'stroke-width': 1.5 }));
    const text = `${id} = ${fmtNum(v, id === 'xF' ? 2 : 3)}`;
    const fitsRight = px(v) + 6 + text.length * 8.6 <= MT.W - 4;
    kids.push(
      fitsRight
        ? label(px(v) + 6, py(0) - rise, text, { weight: 'bold', halo: true })
        : label(px(v) - 6, py(0) - rise, text, { anchor: 'end', weight: 'bold', halo: true }),
    );
  }

  // legend below the plot: two columns of three
  const ly = MT.top + MT.size + 74;
  const line = (stroke: string, w: number, dash?: string) => (x: number, y: number) =>
    svgEl('line', { x1: x, y1: y, x2: x + 26, y2: y, stroke, 'stroke-width': w, 'stroke-dasharray': dash });
  const entries: [0 | 1, number, string, (x: number, y: number) => SVGElement][] = [
    [0, 0, equilibriumLabel(r, op.P_bar ?? null), line(C_EQ, 3)],
    [0, 1, 'Theoretical stages', line(INK, 1.6)],
    [0, 2, `Feed stage ${r.feedStage}`, line(FEED, 3.5)],
    [1, 0, 'Rectifying line', line(C_RECT, 2.5)],
    [1, 1, 'Stripping line', line(C_STRIP, 2.5)],
    [1, 2, `q-line (q = ${fmtNum(r.q, 2)})`, line(C_Q, 2.5, '7 4')],
  ];
  for (const [col, row, text, sw] of entries) {
    const x = MT.left + (col === 0 ? 0 : 296);
    const y = ly + row * 22;
    kids.push(sw(x, y - 5));
    kids.push(label(x + 34, y, text, { class: 'mt-legend' }));
  }

  svg.replaceChildren(...kids);
}
