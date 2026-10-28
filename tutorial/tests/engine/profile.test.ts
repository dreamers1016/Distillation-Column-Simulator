// Tray profile helpers (src/engine/profile.ts): the stage -> actual-tray mapping shared by the
// Advanced trayProfile and the Simple-mode flow colours. Hand-built nodes, no solver.
import { describe, it, expect } from 'vitest';
import { interpolateTray, profileNodes, type ProfileNode } from '../../src/engine/profile';

const xD = 0.95;
const xB = 0.05;

/** Reboiler state: liquid = bottoms product xB, vapour in equilibrium with it. */
const reboiler: ProfileNode = { x: xB, y: 0.21, T_C: 99.1 };

/** Stepped stages, top first (y1 = xD for a total condenser); the last one overshoots below xB. */
const cases: Record<string, ProfileNode[]> = {
  'N = 2': [
    { x: 0.62, y: xD, T_C: 70.2 },
    { x: 0.031, y: 0.15, T_C: 99.8 },
  ],
  'N = 3': [
    { x: 0.84, y: xD, T_C: 66.4 },
    { x: 0.35, y: 0.71, T_C: 78.0 },
    { x: 0.012, y: 0.07, T_C: 100.1 },
  ],
  'N = 3, tiny final step': [
    { x: 0.6, y: xD, T_C: 71.0 },
    { x: 0.0501, y: 0.2102, T_C: 99.09 },
    { x: 0.0499, y: 0.2095, T_C: 99.11 },
  ],
  'N = 6': [
    { x: 0.9, y: xD, T_C: 65.9 },
    { x: 0.78, y: 0.92, T_C: 67.5 },
    { x: 0.55, y: 0.83, T_C: 71.8 },
    { x: 0.27, y: 0.62, T_C: 80.3 },
    { x: 0.09, y: 0.33, T_C: 92.0 },
    { x: 0.021, y: 0.11, T_C: 99.9 },
  ],
};

/** Actual trays for N stages at efficiency Eo: ceil((N - 1) / Eo), at least 1. */
const traysAt = (N: number, Eo: number) => Math.max(1, Math.ceil((N - 1) / Eo - 1e-9));

describe('profileNodes', () => {
  it('keeps stages 1..N-1 as stepped and replaces stage N with the reboiler state', () => {
    for (const stages of Object.values(cases)) {
      const nodes = profileNodes(stages, reboiler);
      expect(nodes).toHaveLength(stages.length);
      stages.slice(0, -1).forEach((s, i) => expect(nodes[i]).toEqual({ x: s.x, y: s.y, T_C: s.T_C }));
      expect(nodes[nodes.length - 1]).toEqual(reboiler);
    }
  });
  it('a single stage is returned unchanged (nothing to interpolate)', () => {
    expect(profileNodes([{ x: 0.5, y: 0.7, T_C: null }], reboiler)).toEqual([{ x: 0.5, y: 0.7, T_C: null }]);
  });
});

describe.each(Object.entries(cases))('interpolateTray, %s', (_name, stages) => {
  const nodes = profileNodes(stages, reboiler);
  it.each([1, 0.7, 0.4])('E_o = %s: monotone down the column, bounded in [xB, xD], finite', (Eo) => {
    const trays = traysAt(stages.length, Eo);
    const prof = Array.from({ length: trays }, (_, i) => interpolateTray(nodes, i + 1, trays));
    for (const p of prof) {
      for (const v of [p.x, p.y, p.T_C as number]) expect(Number.isFinite(v)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(xB);
      expect(p.x).toBeLessThanOrEqual(xD);
      expect(p.y).toBeGreaterThanOrEqual(xB);
      expect(p.y).toBeLessThanOrEqual(xD);
    }
    for (let k = 1; k < prof.length; k++) {
      expect(prof[k].x).toBeLessThanOrEqual(prof[k - 1].x); // leaner going down
      expect(prof[k].y).toBeLessThanOrEqual(prof[k - 1].y);
      expect(prof[k].T_C as number).toBeGreaterThanOrEqual(prof[k - 1].T_C as number); // hotter going down
    }
    // the bottom tray never goes leaner than the bottoms product (the stepped overshoot is not used)
    expect(prof[prof.length - 1].x).toBeGreaterThanOrEqual(xB);
  });

  it('E_o = 1: tray k sits at stage k + 1/2 (midway between the bracketing nodes)', () => {
    const trays = stages.length - 1;
    for (let k = 1; k <= trays; k++) {
      const p = interpolateTray(nodes, k, trays);
      expect(p.x).toBeCloseTo((nodes[k - 1].x + nodes[k].x) / 2, 12);
    }
  });
});

describe('interpolateTray edge cases', () => {
  it('T_C is null when a bracketing node has none (Simple mode)', () => {
    const nodes = profileNodes(cases['N = 3'].map((s) => ({ ...s, T_C: null })), { ...reboiler, T_C: null });
    expect(interpolateTray(nodes, 1, 4).T_C).toBeNull();
  });
  it('clamps out-of-range tray numbers and a fractional tray count to the column', () => {
    const nodes = profileNodes(cases['N = 6'], reboiler);
    const top = interpolateTray(nodes, -3, 8);
    const bottom = interpolateTray(nodes, 99, 8);
    expect(top.x).toBeCloseTo(nodes[0].x, 12);
    expect(bottom.x).toBeCloseTo(xB, 12);
    for (const p of [top, bottom, interpolateTray(nodes, 2, 7.6), interpolateTray(nodes, 1, 0)]) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
  it('a single node or none gives that node (or zeros), never NaN', () => {
    expect(interpolateTray([{ x: 0.4, y: 0.6, T_C: 80 }], 3, 5)).toEqual({ x: 0.4, y: 0.6, T_C: 80 });
    expect(interpolateTray([], 1, 1)).toEqual({ x: 0, y: 0, T_C: null });
  });
});
