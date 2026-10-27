import { describe, it, expect } from 'vitest';
import { steamSat, STEAM_LEVELS } from '../../src/engine/steam';

// Pinned IAPWS-IF97 saturation table: P bar abs -> Tsat °C, h_fg kJ/kg.
const NODES: Array<{ P: number; Tsat: number; hfg: number }> = [
  { P: 1.01325, Tsat: 100.0, hfg: 2256.5 },
  { P: 2, Tsat: 120.21, hfg: 2201.6 },
  { P: 3, Tsat: 133.52, hfg: 2163.5 },
  { P: 4, Tsat: 143.61, hfg: 2133.4 },
  { P: 5, Tsat: 151.83, hfg: 2107.4 },
  { P: 6, Tsat: 158.83, hfg: 2085.8 },
  { P: 8, Tsat: 170.41, hfg: 2047.5 },
  { P: 10, Tsat: 179.88, hfg: 2013.6 },
  { P: 12, Tsat: 187.96, hfg: 1985.4 },
  { P: 15, Tsat: 198.29, hfg: 1946.4 },
  { P: 20, Tsat: 212.38, hfg: 1888.6 },
  { P: 30, Tsat: 233.85, hfg: 1794.9 },
  { P: 40, Tsat: 250.35, hfg: 1712.9 },
  { P: 50, Tsat: 263.94, hfg: 1639.6 },
];

describe('steamSat (IAPWS-IF97 saturated steam)', () => {
  it.each(NODES)('returns table node at P = $P bar exactly', ({ P, Tsat, hfg }) => {
    const r = steamSat(P);
    expect(r.Tsat_C).toBeCloseTo(Tsat, 6);
    expect(r.hfg_kJkg).toBeCloseTo(hfg, 6);
  });

  it('LP level (3.5 barg) gives Tsat ≈ 147.9 °C ± 0.3', () => {
    const { Tsat_C } = steamSat(STEAM_LEVELS.LP.barg + 1.01325);
    expect(Math.abs(Tsat_C - 147.9)).toBeLessThan(0.3);
  });

  it('MP level (10 barg) gives Tsat ≈ 184.1 °C ± 0.3', () => {
    const { Tsat_C } = steamSat(STEAM_LEVELS.MP.barg + 1.01325);
    expect(Math.abs(Tsat_C - 184.1)).toBeLessThan(0.3);
  });

  it('HP level (40 barg) gives Tsat ≈ 251.8 °C ± 0.4', () => {
    const { Tsat_C } = steamSat(STEAM_LEVELS.HP.barg + 1.01325);
    expect(Math.abs(Tsat_C - 251.8)).toBeLessThan(0.4);
  });

  it('h_fg at 4.51325 bar (LP) ≈ 2120 kJ/kg within 0.5 %', () => {
    const { hfg_kJkg } = steamSat(4.51325);
    expect(Math.abs(hfg_kJkg / 2120 - 1)).toBeLessThan(0.005);
  });

  it('accepts the range bounds 1.01325 and 50 bar inclusive', () => {
    expect(() => steamSat(1.01325)).not.toThrow();
    expect(() => steamSat(50)).not.toThrow();
  });

  it('throws RangeError below 1.01325 bar abs', () => {
    expect(() => steamSat(0.5)).toThrow(RangeError);
  });

  it('throws RangeError above 50 bar abs', () => {
    expect(() => steamSat(60)).toThrow(RangeError);
  });

  it('throws RangeError for NaN', () => {
    expect(() => steamSat(Number.NaN)).toThrow(RangeError);
  });
});
