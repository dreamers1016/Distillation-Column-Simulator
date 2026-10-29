import { describe, it, expect } from 'vitest';
import { advancedQ, solveAdvanced } from '../../src/engine/advanced';
import { vleCurve } from '../../src/engine/curve';
import { MIXTURES, type MixtureId } from '../../src/engine/mixtures';
import type { Inputs, Results, SolveResult } from '../../src/engine/types';

// Expected values: independent Python implementation
// (docs/superpowers/plans/reference/en.py and adv.py), 2026-10-27.
const inputs = (mixtureId: MixtureId, over: Partial<Inputs> = {}): Inputs => {
  const d = MIXTURES[mixtureId].defaults;
  return {
    mode: 'advanced', mixtureId, F_kgh: 1000, xF: d.xF, xD: d.xD, xB: d.xB, R: d.R, q: 1,
    feedT_C: d.feedT_C, P_bar: d.P_bar, Eo: 0.7, heatLossPct: 0,
    condenserUtility: 'auto', steamLevel: 'auto', cw: { in_C: 30, out_C: 40 }, chw: { in_C: 7, out_C: 12 },
    ...over,
  };
};
const ok = (r: SolveResult): Results => {
  if (!r.ok) throw new Error(`expected ok result, got ${r.error.code}: ${r.error.message}`);
  return r;
};
const meoh = (over: Partial<Inputs> = {}) => ok(solveAdvanced(inputs('methanol-water', over)));

describe('Advanced solver, methanol-water default (xF .5 xD .95 xB .05 R 2.5, bubble feed, 1 atm)', () => {
  const r = meoh();
  it('Advanced: F 39.9545, D 19.9772, V 69.9203 kmol/h ±1e-3', () => {
    expect(Math.abs(r.F_kmolh - 39.9545)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(r.D_kmolh - 19.9772)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(r.V - 69.9203)).toBeLessThanOrEqual(1e-3);
  });
  it('Advanced: Ttop (bubble of xD) 65.31, top-vapour dew 66.48, Tbot 92.51 °C ±0.05', () => {
    expect(Math.abs(r.Ttop_C - 65.31)).toBeLessThanOrEqual(0.05);
    expect(Math.abs((r.TtopVapour_C as number) - 66.48)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(r.Tbot_C - 92.51)).toBeLessThanOrEqual(0.05);
    expect(r.TtopIsEstimate).toBe(false);
  });
  it('Advanced: Qc 690.16 kW, Qr 694.76 kW (±0.5 %), cmoGapPct −13.70 ±0.3, CMO_GAP warning present', () => {
    expect(Math.abs(r.Qc_kW / 690.16 - 1)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(r.Qr_kW / 694.76 - 1)).toBeLessThanOrEqual(0.005);
    expect(Math.abs((r.cmoGapPct as number) - -13.7)).toBeLessThanOrEqual(0.3);
    expect(r.warnings.some((w) => w.code === 'CMO_GAP')).toBe(true);
  });
  it('Advanced: heatLoss 5 % scales Qr only', () => {
    const h = meoh({ heatLossPct: 5 });
    expect(h.Qr_kW).toBeCloseTo(r.Qr_kW * 1.05, 9);
    expect(h.Qc_kW).toBeCloseTo(r.Qc_kW, 9);
  });
  it('Advanced: q = 1.000 ±1e-3 at bubble feed; q < 1 at feedT 80 °C; q > 1 at 40 °C; q < 0 above dew point', () => {
    expect(Math.abs(r.q - 1)).toBeLessThanOrEqual(1e-3);
    const twoPhase = meoh({ feedT_C: 80 }).q;
    expect(twoPhase).toBeLessThan(1);
    expect(twoPhase).toBeGreaterThan(0);
    expect(meoh({ feedT_C: 40 }).q).toBeGreaterThan(1);
    expect(meoh({ feedT_C: 100 }).q).toBeLessThan(0);
    // flash right at the edges of the two-phase bracket (dew of xF .5 = 84.995 °C)
    expect(meoh({ feedT_C: MIXTURES['methanol-water'].defaults.feedT_C + 1e-7 }).q).toBeCloseTo(1, 5);
    expect(meoh({ feedT_C: 84.99482081 }).q).toBeCloseTo(0, 3);
  });
  it('Advanced: stage temperatures increase monotonically down the column', () => {
    expect(r.N).toBe(6);
    expect(r.feedStage).toBe(4);
    expect(Math.abs(r.Nfrac - 5.314)).toBeLessThanOrEqual(2e-3);
    const T = r.stages.map((s) => s.T_C as number);
    for (let i = 1; i < T.length; i++) expect(T[i]).toBeGreaterThan(T[i - 1]);
    expect(Math.abs(T[0] - 66.48)).toBeLessThanOrEqual(0.05); // stage 1 liquid is at the top-vapour dew point
    expect(r.stages.every((s) => s.gamma !== null)).toBe(true);
    const prof = r.trayProfile!;
    expect(prof).toHaveLength(r.actualTrays);
    for (let i = 1; i < prof.length; i++) expect(prof[i].T_C).toBeGreaterThan(prof[i - 1].T_C);
    expect(r.NminMethod).toBe('total-reflux');
    expect(Math.abs(r.Nmin - 4.289)).toBeLessThanOrEqual(5e-3);
    expect(r.fenskeShortcut).not.toBeNull();
  });
});

describe('Advanced solver, other presets', () => {
  it('Advanced: ethanol-water xD .95 → ok:false code AZEOTROPE, message contains "0.89" and "78."', () => {
    const r = solveAdvanced(inputs('ethanol-water', { xD: 0.95 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('AZEOTROPE');
    expect(r.error.message).toContain('0.89');
    expect(r.error.message).toContain('78.');
  });
  it('Advanced: superheated feed uses vapour cp above the dew point, so q < 0 (propane-butane too)', () => {
    // Watson-implied dh/dT of propane vapour near Tc is negative; cpV must be used instead.
    const pb = ok(solveAdvanced(inputs('propane-butane', { feedT_C: 120 })));
    expect(pb.q).toBeLessThan(0);
    // methanol-water xF .5: dew 84.99 °C; q = -cpV,mix (T - Tdew) / (HVsat - HLsat)
    const r = meoh({ feedT_C: 100 });
    const cpV = 0.5 * 44.1 + 0.5 * 33.6;
    expect(r.q).toBeLessThan(-0.01);
    expect(r.q).toBeGreaterThan((-cpV * 15.5) / 30000);
  });
  it('Advanced: propane-butane at 18 bar → Ttop between 50 and 56 °C, warnings include IDEAL_VAPOUR', () => {
    const r = ok(solveAdvanced(inputs('propane-butane')));
    expect(r.Ttop_C).toBeGreaterThan(50);
    expect(r.Ttop_C).toBeLessThan(56);
    expect(r.warnings.some((w) => w.code === 'IDEAL_VAPOUR')).toBe(true);
  });
  it('Advanced: q matches the independent reference (docs/superpowers/plans/reference/q.py) ±1e-4 at feedT 40, 80, 90, 110 °C', () => {
    // methanol-water, xF 0.5, 1.01325 bar
    const ref: [number, number][] = [
      [40, 1.067402],
      [80, 0.348937],
      [90, -0.005055],
      [110, -0.025253],
    ];
    for (const [T, q] of ref) expect(Math.abs(meoh({ feedT_C: T }).q - q)).toBeLessThanOrEqual(1e-4);
  });
  it('Advanced: advancedQ (used by solve() before solving) equals the solver q', () => {
    for (const T of [40, 80, 90, 110]) {
      const inp = inputs('methanol-water', { feedT_C: T });
      expect(advancedQ(inp)).toBe(ok(solveAdvanced(inp)).q);
    }
  });
});

// Task 14b (spec 5.2/5.4): the partial reboiler is equilibrium stage N and its liquid IS the
// bottoms product, so the tray profile must end at xB (interpolation input only; `stages`
// stays as stepped so the McCabe-Thiele chart still draws the last step past xB).
describe('Advanced tray profile ends at the bottoms composition (no overshoot)', () => {
  const EPS = 1e-9;
  const cases: [MixtureId, Partial<Inputs>][] = [
    ['methanol-water', {}],
    ['ethanol-water', {}],
    ['benzene-toluene', {}],
  ];
  for (const [id, over] of cases) {
    const r = ok(solveAdvanced(inputs(id, over)));
    const { xB, xD, P_bar } = inputs(id, over);
    const prof = r.trayProfile!;
    const yB = vleCurve(MIXTURES[id], P_bar).yStar(xB);

    it(`${id}: every tray x in [xB, xD] and y in [y*(xB), xD]`, () => {
      expect(prof).toHaveLength(r.actualTrays);
      for (const p of prof) {
        expect(p.x).toBeGreaterThanOrEqual(xB - EPS);
        expect(p.x).toBeLessThanOrEqual(xD + EPS);
        expect(p.y).toBeGreaterThanOrEqual(yB - EPS);
        expect(p.y).toBeLessThanOrEqual(xD + EPS);
      }
    });
    it(`${id}: T non-decreasing down the column and the last tray is not hotter than Tbot`, () => {
      for (let i = 1; i < prof.length; i++) expect(prof[i].T_C).toBeGreaterThanOrEqual(prof[i - 1].T_C - EPS);
      expect(prof[prof.length - 1].T_C).toBeLessThanOrEqual(r.Tbot_C + 1e-6);
    });
  }

  it('methanol-water: the last tray is the last theoretical tray, stage N-1, richer than xB (never the overshoot)', () => {
    const r = meoh();
    const last = r.trayProfile![r.trayProfile!.length - 1];
    expect(last.x).toBeGreaterThan(0.05);
    expect(last.x).toBeCloseTo(r.stages[r.N - 2].x, 12);
    expect(last.T_C).toBeCloseTo(r.stages[r.N - 2].T_C as number, 12);
    expect(last.T_C).toBeLessThan(r.Tbot_C);
  });
  it('methanol-water: `stages` is unchanged (last stepped x ≈ 0.0100, past xB) and Tbot is the bubble T of xB', () => {
    const r = meoh();
    expect(Math.abs(r.stages[r.N - 1].x - 0.01)).toBeLessThanOrEqual(0.001);
    expect(r.stages[r.N - 1].x).toBeLessThan(0.05);
    expect(Math.abs(r.Tbot_C - 92.51)).toBeLessThanOrEqual(0.05);
  });
});
