import { describe, it, expect } from 'vitest';
import { selectCondenser, selectReboiler } from '../../src/engine/utilities';
import { solveAdvanced } from '../../src/engine/advanced';
import { solveSimple } from '../../src/engine/simple';
import { MIXTURES } from '../../src/engine/mixtures';
import type { Inputs } from '../../src/engine/types';

// Expected values: hand calculation from the brief / spec 5.6, methanol-water
// Advanced default (Tcond 65.31 °C, Qc 690.16 kW, Tbot 92.51 °C, Qr 694.76 kW).
const inputs = (over: Partial<Inputs> = {}): Inputs => {
  const d = MIXTURES['methanol-water'].defaults;
  return {
    mode: 'advanced', mixtureId: 'methanol-water', F_kgh: 1000, xF: d.xF, xD: d.xD, xB: d.xB, R: d.R, q: 1,
    feedT_C: d.feedT_C, P_bar: d.P_bar, Eo: 0.7, heatLossPct: 0,
    condenserUtility: 'auto', steamLevel: 'auto', cw: { in_C: 30, out_C: 40 }, chw: { in_C: 7, out_C: 12 },
    ...over,
  };
};

describe('selectCondenser', () => {
  const c = selectCondenser(65.31, 690.16, inputs());
  it('auto picks CW at Tcond 65.31 °C', () => {
    expect(c.utility).toBe('CW');
    expect(c.auto).toBe(true);
    expect(c.feasible).toBe(true);
    expect(c.in_C).toBe(30);
    expect(c.out_C).toBe(40);
    expect(c.U_Wm2K).toBe(800);
  });
  it('LMTD = 30.04 ±0.05 K', () => {
    expect(Math.abs(c.LMTD - 30.04)).toBeLessThanOrEqual(0.05);
  });
  it('CW flow = 59,440 ±60 kg/h and area = Q/(U LMTD)', () => {
    expect(Math.abs(c.flow_kgh - 59440)).toBeLessThanOrEqual(60);
    expect(c.area_m2).toBeCloseTo((690.16 * 1000) / (800 * c.LMTD), 9);
  });
  it('reason contains the numbers', () => {
    expect(c.reason).toContain('65.3');
    expect(c.reason).toContain('CW');
  });
  it('Tcond 30 °C auto picks ChW', () => {
    const r = selectCondenser(30, 100, inputs());
    expect(r.utility).toBe('ChW');
    expect(r.feasible).toBe(true);
    expect(r.in_C).toBe(7);
    expect(r.out_C).toBe(12);
    expect(r.flow_kgh).toBeCloseTo((100 * 3600) / (4.18 * 5), 6);
    expect(r.area_m2).toBeGreaterThan(0);
  });
  it('Tcond 10 °C auto gives REFRIGERATION, infeasible, zero flow and area', () => {
    const r = selectCondenser(10, 100, inputs());
    expect(r.utility).toBe('REFRIGERATION');
    expect(r.feasible).toBe(false);
    expect(r.flow_kgh).toBe(0);
    expect(r.area_m2).toBe(0);
    expect(r.reason).toContain('needs refrigeration — outside this tool');
    expect(r.reason).toContain('10.0');
  });
  it('forcing CW at Tcond 30 °C is infeasible: flow 0, reason names both temperatures', () => {
    const r = selectCondenser(30, 100, inputs({ condenserUtility: 'CW' }));
    expect(r.utility).toBe('CW');
    expect(r.auto).toBe(false);
    expect(r.feasible).toBe(false);
    expect(r.flow_kgh).toBe(0);
    expect(r.area_m2).toBe(0);
    expect(r.reason).toContain('30.0');
    expect(r.reason).toContain('40.0');
  });
  it('forcing ChW at Tcond 65 °C is feasible', () => {
    const r = selectCondenser(65, 100, inputs({ condenserUtility: 'ChW' }));
    expect(r.utility).toBe('ChW');
    expect(r.auto).toBe(false);
    expect(r.feasible).toBe(true);
  });
  it('never returns NaN or Infinity (zero duty, inverted water range)', () => {
    for (const r of [
      selectCondenser(65, 0, inputs()),
      selectCondenser(65, 100, inputs({ cw: { in_C: 40, out_C: 40 } })),
      selectCondenser(65, 100, inputs({ condenserUtility: 'CW', cw: { in_C: 45, out_C: 35 } })),
    ]) {
      for (const v of [r.flow_kgh, r.LMTD, r.area_m2]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('selectReboiler', () => {
  const r = selectReboiler(92.51, 694.76, inputs());
  it('auto picks LP at Tbot 92.51 °C', () => {
    expect(r.level).toBe('LP');
    expect(r.auto).toBe(true);
    expect(r.feasible).toBe(true);
    expect(r.P_barg).toBe(3.5);
    expect(r.U_Wm2K).toBe(1000);
  });
  it('dT = Tsat − Tbot = 55.4 ±0.4', () => {
    expect(Math.abs(r.dT - 55.4)).toBeLessThanOrEqual(0.4);
    expect(r.dT).toBeCloseTo(r.Tsat_C - 92.51, 9);
  });
  it('steam = Qr·3600/hfg ≈ 1,180 ±10 kg/h; area = Q/(U dT)', () => {
    expect(Math.abs(r.steam_kgh - 1180)).toBeLessThanOrEqual(10);
    expect(r.steam_kgh).toBeCloseTo((694.76 * 3600) / r.hfg_kJkg, 9);
    expect(r.area_m2).toBeCloseTo((694.76 * 1000) / (1000 * r.dT), 9);
  });
  it('reason contains the numbers', () => {
    expect(r.reason).toContain('92.5');
    expect(r.reason).toContain('LP');
    expect(r.reason).toContain('≥ 20');
  });
  it('Treb 150 °C skips LP (Tsat 148) and picks MP', () => {
    expect(selectReboiler(150, 100, inputs()).level).toBe('MP');
  });
  it('Treb 170 °C skips MP (Tsat 184) and picks HP', () => {
    expect(selectReboiler(170, 100, inputs()).level).toBe('HP');
  });
  it('Treb 240 °C picks HOT_OIL, infeasible, steam and area 0', () => {
    const h = selectReboiler(240, 100, inputs());
    expect(h.level).toBe('HOT_OIL');
    expect(h.feasible).toBe(false);
    expect(h.steam_kgh).toBe(0);
    expect(h.area_m2).toBe(0);
    expect(h.reason).toContain('240.0');
  });
  it('infeasible override: forcing LP at Treb 140 °C', () => {
    const o = selectReboiler(140, 100, inputs({ steamLevel: 'LP' }));
    expect(o.level).toBe('LP');
    expect(o.auto).toBe(false);
    expect(o.feasible).toBe(false);
    expect(o.steam_kgh).toBe(0);
    expect(o.area_m2).toBe(0);
    expect(o.reason).toContain('140.0');
    expect(o.reason).toContain('148.1');
  });
  it('feasible override: forcing HP at Treb 92.51 °C', () => {
    const o = selectReboiler(92.51, 100, inputs({ steamLevel: 'HP' }));
    expect(o.level).toBe('HP');
    expect(o.feasible).toBe(true);
    expect(o.steam_kgh).toBeGreaterThan(0);
  });
});

describe('solver wiring', () => {
  it('Advanced default carries condenser CW and reboiler LP, no UTILITY warning', () => {
    const r = solveAdvanced(inputs());
    if (!r.ok) throw new Error('expected ok');
    expect(r.condenser.utility).toBe('CW');
    expect(r.reboiler.level).toBe('LP');
    expect(r.warnings.some((w) => w.code === 'UTILITY')).toBe(false);
  });
  it('propane-butane at 1 atm needs refrigeration: infeasible condenser adds a UTILITY warning', () => {
    const d = MIXTURES['propane-butane'].defaults;
    const r = solveAdvanced(inputs({ mixtureId: 'propane-butane', xF: d.xF, xD: d.xD, xB: d.xB, R: d.R, feedT_C: d.feedT_C, P_bar: 1.01325 }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.condenser.feasible).toBe(false);
    expect(r.condenser.utility).toBe('REFRIGERATION');
    expect(r.warnings.some((w) => w.code === 'UTILITY' && w.message.includes('refrigeration'))).toBe(true);
  });
  it('Simple mode carries both results', () => {
    const r = solveSimple(
      { ...inputs(), mode: 'simple', mixtureId: 'benzene-toluene', xF: 0.5, xD: 0.95, xB: 0.05, R: 2, P_bar: 1.01325 },
      { alphaOverride: 2.5 },
    );
    expect(r.condenser.feasible).toBe(true);
    expect(r.condenser.utility).toBe('CW');
    expect(r.reboiler.feasible).toBe(true);
    expect(r.reboiler.level).toBe('LP');
  });
});
