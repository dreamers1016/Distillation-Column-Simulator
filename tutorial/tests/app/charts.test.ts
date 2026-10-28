// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderMcCabe, MT } from '../../src/app/charts/mccabe';
import { renderProfile } from '../../src/app/charts/profile';
import { curveFor } from '../../src/app/charts/curveFor';
import { mountCharts } from '../../src/app/charts/mount';
import { constantAlphaCurve, vleCurve } from '../../src/engine/curve';
import { createStore, defaultState, setMixture, setMode } from '../../src/app/state';
import { mountPanel } from '../../src/app/ui/panel';
import { MIXTURES } from '../../src/engine/mixtures';
import { solve } from '../../src/engine/solve';
import type { Inputs, Results } from '../../src/engine/types';

const NS = 'http://www.w3.org/2000/svg';
const mk = () => document.createElementNS(NS, 'svg') as SVGSVGElement;

function solved(patch: Partial<Inputs> = {}): { r: Results; inputs: Inputs } {
  const inputs = { ...defaultState().inputs, ...patch };
  const r = solve(inputs);
  if (!r.ok) throw new Error('fixture must solve: ' + r.error.message);
  return { r, inputs };
}
const ethanolAdv = (): Partial<Inputs> => ({ mode: 'advanced', mixtureId: 'ethanol-water', ...MIXTURES['ethanol-water'].defaults });

const parsePts = (el: Element): [number, number][] =>
  (el.getAttribute('points') as string).trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]);
// plot coordinates back to data coordinates
const back = ([px, py]: [number, number]): [number, number] => [(px - MT.left) / MT.size, 1 - (py - MT.top) / MT.size];

describe.each([
  ['methanol-water Simple', {}],
  ['ethanol-water Advanced', ethanolAdv()],
])('McCabe-Thiele chart, %s', (_name, patch) => {
  let svg: SVGSVGElement;
  let r: Results;
  let inputs: Inputs;
  beforeEach(() => {
    ({ r, inputs } = solved(patch));
    svg = mk();
    renderMcCabe(svg, r, curveFor(r, inputs), inputs);
  });

  it('draws one step polyline per theoretical stage', () => {
    expect(svg.querySelectorAll('polyline.mt-step').length).toBe(r.N);
  });

  it('highlights exactly the feed stage in the feed colour', () => {
    const feed = svg.querySelectorAll('polyline.mt-step.feed');
    expect(feed.length).toBe(1);
    expect(feed[0].getAttribute('data-stage')).toBe(String(r.feedStage));
    expect(feed[0].getAttribute('stroke')).toBe('#7b4fbf');
  });

  it('draws the equilibrium curve from (0,0) to (1,1)', () => {
    const p = parsePts(svg.querySelector('polyline.mt-curve') as Element).map(back);
    expect(p[0][0]).toBeCloseTo(0, 6);
    expect(p[0][1]).toBeCloseTo(0, 6);
    expect(p[p.length - 1][0]).toBeCloseTo(1, 6);
    expect(p[p.length - 1][1]).toBeCloseTo(1, 6);
    expect(p.length).toBeGreaterThanOrEqual(200);
  });

  it('draws the engine curve: 10 sample points match yStar within 1e-6', () => {
    const curve = curveFor(r, inputs);
    const p = parsePts(svg.querySelector('polyline.mt-curve') as Element).map(back);
    for (let k = 0; k <= 9; k++) {
      const [x, y] = p[Math.round(((p.length - 1) * k) / 9)];
      expect(Math.abs(y - curve.yStar(x))).toBeLessThan(1e-6);
    }
  });

  it('puts the steps on the curve, starting at xD and ending the last step at xB', () => {
    const steps = Array.from(svg.querySelectorAll('polyline.mt-step')).map((e) => parsePts(e).map(back));
    const curve = curveFor(r, inputs);
    expect(steps[0][0][0]).toBeCloseTo(inputs.xD, 6);
    expect(steps[0][0][1]).toBeCloseTo(inputs.xD, 6);
    for (const s of steps.slice(0, -1)) expect(Math.abs(s[1][1] - curve.yStar(s[1][0]))).toBeLessThan(1e-6);
    const last = steps[steps.length - 1];
    expect(last[last.length - 1][0]).toBeCloseTo(inputs.xB, 6);
    expect(last).toHaveLength(2);
  });

  it('draws the q-line, both operating lines and the diagonal', () => {
    for (const c of ['mt-q', 'mt-rect', 'mt-strip', 'mt-diag']) expect(svg.querySelector(`line.${c}`)).not.toBeNull();
  });

  it('marks xB, xF and xD on the diagonal', () => {
    for (const [id, v] of [['xB', inputs.xB], ['xF', inputs.xF], ['xD', inputs.xD]] as const) {
      const m = svg.querySelector(`circle[data-marker="${id}"]`) as Element;
      expect(m).not.toBeNull();
      const [x, y] = back([Number(m.getAttribute('cx')), Number(m.getAttribute('cy'))]);
      expect(x).toBeCloseTo(v, 6);
      expect(y).toBeCloseTo(v, 6);
    }
  });

  it('labels the axes with the light component and sets an informative aria-label', () => {
    const light = r.mixture.light === 'methanol' ? 'methanol' : 'ethanol';
    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain(`x, liquid mole fraction ${light}`);
    expect(texts).toContain(`y, vapour mole fraction ${light}`);
    expect(svg.getAttribute('role')).toBe('img');
    const aria = svg.getAttribute('aria-label') as string;
    expect(aria).toContain('McCabe-Thiele diagram');
    expect(aria).toContain(`${r.N} theoretical stages`);
    expect(aria).toContain(`feed on stage ${r.feedStage}`);
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
  });

  it('has a mode-aware equilibrium legend entry', () => {
    const legend = Array.from(svg.querySelectorAll('text.mt-legend')).map((t) => t.textContent ?? '');
    const eq = legend.find((t) => t.startsWith('Equilibrium')) as string;
    if (r.mode === 'simple') expect(eq).toContain(`constant α = ${(r.mixture.simpleAlpha as number).toFixed(2)}`);
    else expect(eq).toMatch(/NRTL VLE at 1\.01 bar/);
  });

  it('redraws in place (no accumulation)', () => {
    renderMcCabe(svg, r, curveFor(r, inputs), inputs);
    expect(svg.querySelectorAll('polyline.mt-curve').length).toBe(1);
    expect(svg.querySelectorAll('polyline.mt-step').length).toBe(r.N);
  });
});

describe('curveFor', () => {
  it('uses the constant-alpha curve in Simple', () => {
    const { r, inputs } = solved();
    const ref = constantAlphaCurve(r.mixture.simpleAlpha as number);
    for (const x of [0.05, 0.3, 0.8]) expect(curveFor(r, inputs).yStar(x)).toBe(ref.yStar(x));
  });
  it('uses the real-VLE curve at the solved pressure in Advanced', () => {
    const { r, inputs } = solved({ ...ethanolAdv(), P_bar: 2 });
    const ref = vleCurve(r.mixture, 2);
    for (const x of [0.05, 0.3, 0.8]) expect(curveFor(r, inputs).yStar(x)).toBe(ref.yStar(x));
  });
});

describe('profile chart', () => {
  it('has one point per actual tray in each series, tray 1 at the top', () => {
    const { r } = solved(ethanolAdv());
    const svg = mk();
    renderProfile(svg, r);
    const prof = r.trayProfile as NonNullable<Results['trayProfile']>;
    for (const cls of ['pf-T', 'pf-x', 'pf-y']) {
      expect(parsePts(svg.querySelector(`polyline.${cls}`) as Element)).toHaveLength(prof.length);
    }
    const p = parsePts(svg.querySelector('polyline.pf-T') as Element);
    expect(p[0][1]).toBeLessThan(p[p.length - 1][1]); // tray 1 is higher on screen
    expect(p[0][0]).toBeLessThan(p[p.length - 1][0]); // the top is cooler
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('line.pf-feed')).not.toBeNull();
    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toContain('Temperature, °C');
  });
});

describe('mountCharts', () => {
  let slot: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="slot"></div>';
    slot = document.getElementById('slot') as HTMLElement;
  });

  it('Simple: McCabe-Thiele plus a note instead of the profile', () => {
    const store = createStore(defaultState());
    mountCharts(slot, store);
    expect(slot.querySelector('svg.mt-chart')).not.toBeNull();
    expect(slot.querySelector('svg.pf-chart')).toBeNull();
    expect(slot.textContent).toContain('Temperature profile available in Advanced mode');
  });

  it('Advanced: both charts, updating with the store', () => {
    const store = createStore(defaultState());
    mountCharts(slot, store);
    setMode(store, 'advanced');
    expect(slot.querySelector('svg.pf-chart')).not.toBeNull();
    expect(slot.textContent).not.toContain('Temperature profile available in Advanced mode');
    setMixture(store, 'ethanol-water');
    const r = store.result() as Results;
    expect(r.ok).toBe(true);
    expect(slot.querySelectorAll('polyline.mt-step').length).toBe(r.N);
  });

  it('keeps the last valid chart, greyed, when the inputs become infeasible', () => {
    const store = createStore(defaultState());
    mountCharts(slot, store);
    const n = slot.querySelectorAll('polyline.mt-step').length;
    expect(n).toBeGreaterThan(0);
    store.set((s) => ({ inputs: { ...s.inputs, R: 0.3, xD: 0.995, xB: 0.005 } }));
    expect(store.result().ok).toBe(false);
    expect(slot.querySelector('.charts')?.classList.contains('stale')).toBe(true);
    expect(slot.querySelectorAll('polyline.mt-step').length).toBe(n);
    store.set((s) => ({ inputs: { ...s.inputs, R: 3 } }));
    expect(slot.querySelector('.charts')?.classList.contains('stale')).toBe(false);
  });

  it('does not redraw on view-only changes', () => {
    const store = createStore(defaultState());
    mountCharts(slot, store);
    const curve = slot.querySelector('polyline.mt-curve');
    store.set({ cutaway: false });
    expect(slot.querySelector('polyline.mt-curve')).toBe(curve);
  });

  it('is mounted in the Explore panel chart slot', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const store = createStore(defaultState());
    mountPanel(document.getElementById('root') as HTMLElement, store, { schedule: (f) => f() });
    expect(document.querySelector('[data-slot="chart"] svg.mt-chart')).not.toBeNull();
  });
});
