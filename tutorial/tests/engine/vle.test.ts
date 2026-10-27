import { describe, it, expect } from 'vitest';
import { MIXTURES } from '../../src/engine/mixtures';
import { bubblePoint, dewPoint, findAzeotrope } from '../../src/engine/vle';
import { gammas } from '../../src/engine/activity';

const P = 1.01325;
// Experimental T-x data at 101.325 kPa. Methanol-water: Perry's Chemical
// Engineers' Handbook VLE tables. Ethanol-water: Carey and Lewis 1932 (as
// tabulated in Perry's). Pairs are [x_light, T_celsius].
const MEOH = [[0.1,87.7],[0.2,81.7],[0.3,78.0],[0.4,75.3],[0.5,73.1],[0.6,71.2],[0.7,69.3],[0.8,67.5],[0.9,66.0]];
const ETOH = [[0.0721,89.0],[0.1238,85.3],[0.2337,82.7],[0.3273,81.5],[0.5079,79.8],[0.6763,78.74],[0.7472,78.41],[0.8943,78.15]];

const mae = (mix: keyof typeof MIXTURES, data: number[][]): number =>
  data.reduce((s, [x, T]) => s + Math.abs(bubblePoint(MIXTURES[mix], x, P).T_K - 273.15 - T), 0) / data.length;

describe('VLE', () => {
  it('methanol-water bubble T MAE ≤ 0.3 °C (reference impl: 0.12)', () => {
    expect(mae('methanol-water', MEOH)).toBeLessThanOrEqual(0.3);
  });
  it('ethanol-water bubble T MAE ≤ 0.4 °C (reference impl: 0.24)', () => {
    expect(mae('ethanol-water', ETOH)).toBeLessThanOrEqual(0.4);
  });
  it('methanol-water x=0.5 → T 73.16 ± 0.05 °C, y 0.789 ± 0.002', () => {
    const r = bubblePoint(MIXTURES['methanol-water'], 0.5, P);
    expect(r.T_K - 273.15).toBeCloseTo(73.16, 1);
    expect(Math.abs(r.T_K - 273.15 - 73.16)).toBeLessThan(0.05);
    expect(Math.abs(r.y1 - 0.789)).toBeLessThan(0.002);
  });
  it('ethanol-water azeotrope x = 0.895 ± 0.01, T = 78.15 ± 0.3 °C', () => {
    const az = findAzeotrope(MIXTURES['ethanol-water'], P);
    expect(az).not.toBeNull();
    expect(Math.abs(az!.x - 0.895)).toBeLessThan(0.01);
    expect(Math.abs(az!.T_K - 273.15 - 78.15)).toBeLessThan(0.3);
  });
  it('isopropanol-water azeotrope x = 0.668 ± 0.02 (lit. 0.68), T = 80.31 ± 0.5 °C', () => {
    const az = findAzeotrope(MIXTURES['isopropanol-water'], P);
    expect(az).not.toBeNull();
    expect(Math.abs(az!.x - 0.668)).toBeLessThan(0.02);
    expect(Math.abs(az!.T_K - 273.15 - 80.31)).toBeLessThan(0.5);
  });
  it('methanol-water has no azeotrope', () => expect(findAzeotrope(MIXTURES['methanol-water'], P)).toBeNull());
  it('benzene-toluene ideal: bubble T at x=0.95 is 81.12 ± 0.05 °C, at x=0.05 is 108.32 ± 0.05 °C', () => {
    const bt = MIXTURES['benzene-toluene'];
    expect(Math.abs(bubblePoint(bt, 0.95, P).T_K - 273.15 - 81.12)).toBeLessThan(0.05);
    expect(Math.abs(bubblePoint(bt, 0.05, P).T_K - 273.15 - 108.32)).toBeLessThan(0.05);
  });
  it('dewPoint(y) inverts bubblePoint: bubble(x).y1 → dew → x within 1e-6', () => {
    for (const id of ['methanol-water', 'ethanol-water', 'benzene-toluene', 'acetone-water'] as const) {
      for (const x of [0.05, 0.3, 0.6, 0.85]) {
        const b = bubblePoint(MIXTURES[id], x, P);
        const d = dewPoint(MIXTURES[id], b.y1, P);
        expect(Math.abs(d.x1 - x)).toBeLessThan(1e-6);
        expect(Math.abs(d.T_K - b.T_K)).toBeLessThan(1e-4);
      }
    }
  });
  it('propane-butane at 1.01325 bar emits ANTOINE_RANGE warning naming propane', () => {
    const r = bubblePoint(MIXTURES['propane-butane'], 0.5, P);
    const w = r.warnings.find((q) => q.code === 'ANTOINE_RANGE');
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/propane/i);
  });
  it('methanol-water at x=0.95, 1 atm emits NO ANTOINE_RANGE warning (mild extrapolation tolerated)', () => {
    const r = bubblePoint(MIXTURES['methanol-water'], 0.95, P);
    expect(r.warnings.filter((q) => q.code === 'ANTOINE_RANGE')).toHaveLength(0);
  });
  it('acetone-water and isopropanol-water are verified:false', () => {
    expect(MIXTURES['acetone-water'].verified).toBe(false);
    expect(MIXTURES['isopropanol-water'].verified).toBe(false);
  });
});

describe('mixture presets', () => {
  it('flags, simpleAlpha and defaults follow the brief', () => {
    expect(MIXTURES['methanol-water'].defaults).toMatchObject({ xF: 0.5, xD: 0.95, xB: 0.05, R: 2.5, P_bar: 1.01325, q: 1 });
    expect(MIXTURES['ethanol-water'].defaults).toMatchObject({ xF: 0.1, xD: 0.8, xB: 0.02, R: 2.5 });
    expect(MIXTURES['benzene-toluene'].defaults).toMatchObject({ R: 2.0 });
    expect(MIXTURES['propane-butane'].defaults).toMatchObject({ R: 3.0, P_bar: 18 });
    expect(MIXTURES['benzene-toluene'].model).toBe('ideal');
    expect(MIXTURES['methanol-water'].model).toBe('nrtl');
    expect(MIXTURES['ethanol-water'].simpleAllowed).toBe(false);
    expect(MIXTURES['methanol-water'].simpleAlpha).toBe(4.3011);
    expect(MIXTURES['acetone-water'].simpleAlpha).toBeUndefined();
  });
  it('feedT_C is the feed bubble point', () => {
    for (const m of Object.values(MIXTURES)) {
      const T = bubblePoint(m, m.defaults.xF, m.defaults.P_bar).T_K - 273.15;
      expect(Math.abs(m.defaults.feedT_C - T)).toBeLessThan(1e-6);
    }
  });
  it('ideal gammas are 1; NRTL gammas > 1 for methanol-water at 350 K', () => {
    expect(gammas(MIXTURES['benzene-toluene'], 0.4, 350)).toEqual([1, 1]);
    const [g1, g2] = gammas(MIXTURES['methanol-water'], 0.5, 350);
    expect(g1).toBeGreaterThan(1);
    expect(g2).toBeGreaterThan(1);
  });
  it('never returns NaN/Infinity on edge inputs', () => {
    for (const m of Object.values(MIXTURES)) {
      for (const x of [0, 1, -0.2, 1.3, NaN]) {
        const b = bubblePoint(m, x, m.defaults.P_bar);
        const d = dewPoint(m, x, m.defaults.P_bar);
        for (const v of [b.T_K, b.y1, d.T_K, d.x1, ...b.gamma]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
