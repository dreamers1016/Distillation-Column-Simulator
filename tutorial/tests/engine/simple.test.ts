import { describe, it, expect } from 'vitest';
import { solveSimple } from '../../src/engine/simple';
import type { Inputs } from '../../src/engine/types';

// Expected values: independent Python implementation
// (docs/superpowers/plans/reference/en.py), 2026-10-27.
const base: Inputs = {
  mode: 'simple', mixtureId: 'benzene-toluene', F_kgh: 1000, xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 1,
  feedT_C: 0, P_bar: 1.01325, Eo: 0.7, heatLossPct: 0,
  condenserUtility: 'auto', steamLevel: 'auto', cw: { in_C: 30, out_C: 40 }, chw: { in_C: 7, out_C: 12 },
};
const run = (over: Partial<Inputs> = {}) => solveSimple({ ...base, ...over }, { alphaOverride: 2.5 });

describe('Simple solver, benzene-toluene, alpha 2.5', () => {
  it('material balance', () => {
    const r = run();
    expect(r.F_kmolh).toBeCloseTo(11.7474, 4);
    expect(r.D_kmolh).toBeCloseTo(5.8737, 4);
    expect(r.B_kmolh).toBeCloseTo(5.8737, 4);
    expect(Math.abs(r.D_kgh - 462.916)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(r.B_kgh - 537.084)).toBeLessThanOrEqual(1e-3);
  });
  it('F = D + B and F·xF = D·xD + B·xB to 1e-9 relative', () => {
    const r = run({ xF: 0.37, xD: 0.91, xB: 0.08 });
    expect(Math.abs(r.D_kmolh + r.B_kmolh - r.F_kmolh) / r.F_kmolh).toBeLessThanOrEqual(1e-9);
    const light = r.D_kmolh * 0.91 + r.B_kmolh * 0.08;
    expect(Math.abs(light - r.F_kmolh * 0.37) / (r.F_kmolh * 0.37)).toBeLessThanOrEqual(1e-9);
  });
  it('Simple energy: Qc = Qr = 156.388 kW ±0.01 with q=1, heatLoss 0', () => {
    const r = run();
    expect(Math.abs(r.Qc_kW - 156.388)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(r.Qr_kW - 156.388)).toBeLessThanOrEqual(0.01);
    expect(r.cmoGapPct).toBeNull();
  });
  it('Simple: heatLoss 5 % → Qr = 164.207 kW, Qc unchanged', () => {
    const r = run({ heatLossPct: 5 });
    expect(Math.abs(r.Qr_kW - 164.207)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(r.Qc_kW - 156.388)).toBeLessThanOrEqual(0.01);
  });
  it('Simple: theoreticalTrays = N-1 = 10, actualTrays = ceil(10/0.7) = 15, feedTray = ceil(5/0.7) = 8', () => {
    const r = run();
    expect(r.N).toBe(11);
    expect(r.theoreticalTrays).toBe(10);
    expect(r.actualTrays).toBe(15);
    expect(r.feedStage).toBe(5);
    expect(r.feedTray).toBe(8);
    expect(r.NminMethod).toBe('fenske');
    expect(r.Nmin).toBeCloseTo(Math.log((0.95 / 0.05) * (0.95 / 0.05)) / Math.log(2.5), 10);
    expect(r.trayProfile).toBeNull();
    expect(r.TtopIsEstimate).toBe(true);
    expect(r.stages.every((s) => s.T_C === null && s.gamma === null)).toBe(true);
  });
  it('assumptions state the alpha basis: geometric mean at the preset default xD, xB; frozen', () => {
    const r = run();
    expect(r.assumptions).toContain('Constant relative volatility α = 2.5000 (geometric mean at the preset default xD = 0.95, xB = 0.05; frozen)');
  });
});
