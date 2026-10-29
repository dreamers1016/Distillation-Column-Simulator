import { describe, it, expect } from 'vitest';
import { psat_bar, antoineInRange, tsat_K } from '../../src/engine/antoine';
import type { ComponentId } from '../../src/engine/types';

const NBP: Record<string, number> = {
  water: 100.0, methanol: 64.7, ethanol: 78.4, isopropanol: 82.3, acetone: 56.1,
  benzene: 80.1, toluene: 110.6, nButane: -0.5, nHexane: 68.7, nHeptane: 98.4,
};

describe('Antoine', () => {
  it.each(Object.entries(NBP))('%s normal boiling point within 0.5 °C', (id, tb) => {
    const err = tsat_K(id as ComponentId, 1.01325) - 273.15 - tb;
    expect(Math.abs(err)).toBeLessThan(0.5);
  });

  it('propane is evaluated inside its range: Psat(300 K) ≈ 9.97 bar (NIST) within 1 %', () => {
    expect(psat_bar('propane', 300)).toBeGreaterThan(9.87);
    expect(psat_bar('propane', 300)).toBeLessThan(10.07);
  });

  it('propane at its 1-atm boiling point is flagged out of range', () => {
    expect(antoineInRange('propane', 231.1)).toBe(false);
  });

  it('propane at 300 K is flagged in range', () => {
    expect(antoineInRange('propane', 300)).toBe(true);
  });

  it('tsat_K inverts psat_bar', () => {
    expect(tsat_K('toluene', psat_bar('toluene', 350))).toBeCloseTo(350, 6);
  });
});
