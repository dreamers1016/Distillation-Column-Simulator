// @vitest-environment jsdom
// Flow particles: composition mapping, colours, time-based motion and section speeds.
import { describe, expect, it } from 'vitest';
import { BufferAttribute, Color } from 'three';
import { defaultInputs } from '../../src/app/state';
import { solve } from '../../src/engine/solve';
import type { Inputs, Results } from '../../src/engine/types';
import { CHORD_X } from '../../src/scene/geometry/trays';
import {
  HEAVY_COLOR,
  LIGHT_COLOR,
  LIQUID_PARTICLES,
  VAPOUR_PARTICLES,
  compositionAtHeight,
  compositionColor,
  createFlow,
} from '../../src/scene/flow';
import { buildPlant } from '../../src/scene/plant';

const solved = (patch: Partial<Inputs>): Results => {
  const r = solve({ ...defaultInputs(), ...patch });
  if (!r.ok) throw new Error(`must solve: ${r.error.message}`);
  return r;
};
const MW = { mixtureId: 'methanol-water' as const, xF: 0.5, xD: 0.95, xB: 0.05 };
const adv = solved({ ...MW, mode: 'advanced' });
const simple = solved({ ...MW, mode: 'simple' });

const plantOf = (r: Results) =>
  buildPlant(r, { cutaway: true, utilityColors: true, products: { xD: 0.95, xB: 0.05 } });

describe('compositionAtHeight', () => {
  for (const [name, r] of [
    ['Advanced', adv],
    ['Simple', simple],
  ] as const) {
    it(`${name}: light-rich at the top, heavy-rich at the bottom (methanol-water)`, () => {
      const L = plantOf(r).layout;
      // Reflux distributor / overhead (xD) down to the sump (xB).
      expect(compositionAtHeight(L, r, L.yTop, 'x')).toBeGreaterThanOrEqual(0.85);
      expect(compositionAtHeight(L, r, L.yTop, 'y')).toBeGreaterThanOrEqual(0.85);
      expect(compositionAtHeight(L, r, L.y0 + 0.3, 'x')).toBeLessThanOrEqual(0.1);
      // The decks themselves: the top tray is rich, the bottom tray lean (tray 1 is below xD).
      expect(compositionAtHeight(L, r, L.trayY[0], 'x')).toBeGreaterThanOrEqual(0.7);
      expect(compositionAtHeight(L, r, L.trayY[L.displayTrays - 1], 'x')).toBeLessThanOrEqual(0.1);
      expect(compositionAtHeight(L, r, L.trayY[L.displayTrays - 1], 'y')).toBeLessThanOrEqual(0.3);
    });
  }

  it('Advanced reads trayProfile exactly at a tray deck, and interpolates between decks', () => {
    const L = plantOf(adv).layout;
    const prof = adv.trayProfile!;
    const i = 2;
    expect(compositionAtHeight(L, adv, L.trayY[i], 'x')).toBeCloseTo(prof[L.trayNo[i] - 1].x, 9);
    const mid = (L.trayY[i] + L.trayY[i + 1]) / 2;
    const c = compositionAtHeight(L, adv, mid, 'x');
    expect(c).toBeCloseTo((prof[L.trayNo[i] - 1].x + prof[L.trayNo[i + 1] - 1].x) / 2, 9);
  });

  it('is clamped outside the column span and monotone (light at top, heavy at bottom)', () => {
    const L = plantOf(simple).layout;
    const xD = simple.stages[0].y;
    const xB = simple.stages[simple.stages.length - 1].x;
    expect(compositionAtHeight(L, simple, L.yTop + 5, 'x')).toBeCloseTo(xD, 9);
    expect(compositionAtHeight(L, simple, 0, 'x')).toBeCloseTo(xB, 9);
    let prev = Infinity;
    for (let k = 0; k < L.displayTrays; k++) {
      const x = compositionAtHeight(L, simple, L.trayY[k], 'x');
      expect(x).toBeLessThanOrEqual(prev + 1e-9);
      prev = x;
    }
  });
});

describe('compositionColor', () => {
  it('equals the light colour at 1 and the heavy colour at 0', () => {
    expect(compositionColor(1).getHex()).toBe(new Color(LIGHT_COLOR).getHex());
    expect(compositionColor(0).getHex()).toBe(new Color(HEAVY_COLOR).getHex());
    expect(LIGHT_COLOR).toBe('#e2873a');
    expect(HEAVY_COLOR).toBe('#2c6fbb');
  });
  it('clamps out-of-range compositions', () => {
    expect(compositionColor(1.4).getHex()).toBe(compositionColor(1).getHex());
    expect(compositionColor(-0.2).getHex()).toBe(compositionColor(0).getHex());
  });
});

describe('createFlow', () => {
  it('builds one Points per phase with the specified particle counts and the legend names', () => {
    const f = createFlow(plantOf(adv), adv);
    expect(f.points).toHaveLength(2);
    expect(f.points[0].geometry.getAttribute('position').count).toBe(LIQUID_PARTICLES);
    expect(f.points[1].geometry.getAttribute('position').count).toBe(VAPOUR_PARTICLES);
    expect(LIQUID_PARTICLES).toBe(420);
    expect(VAPOUR_PARTICLES).toBe(320);
    expect(f.legend.light).toEqual({ name: 'Methanol', color: LIGHT_COLOR });
    expect(f.legend.heavy).toEqual({ name: 'Water', color: HEAVY_COLOR });
    f.dispose();
  });

  it('advances the same distance over 1 s at 60 Hz and at 20 Hz (within 1 %)', () => {
    const run = (hz: number) => {
      const f = createFlow(plantOf(adv), adv);
      const before = Array.from(f.liquidS);
      const total = f.pathLength;
      for (let k = 0; k < hz; k++) f.update(1 / hz);
      // unwrapped distance travelled, mean over particles
      let sum = 0;
      f.liquidS.forEach((s, i) => (sum += (((s - before[i]) % total) + total) % total));
      const vap = Array.from(f.vaporY);
      f.dispose();
      return { mean: sum / before.length, vap };
    };
    const a = run(60);
    const b = run(20);
    expect(a.mean).toBeGreaterThan(0.5);
    expect(Math.abs(a.mean - b.mean) / a.mean).toBeLessThan(0.01);
    const f0 = createFlow(plantOf(adv), adv);
    const v0 = Array.from(f0.vaporY);
    const span = f0.vaporSpan;
    f0.dispose();
    const dv = (v: number[]) => v.reduce((s, y, i) => s + ((((y - v0[i]) % span) + span) % span), 0) / v.length;
    expect(dv(a.vap)).toBeGreaterThan(0.5);
    expect(Math.abs(dv(a.vap) - dv(b.vap)) / dv(a.vap)).toBeLessThan(0.01);
  });

  it("liquid below the feed is faster than above it when q = 1 (L' > L); vapour follows V, V'", () => {
    const r = solved({ ...MW, mode: 'advanced', q: 1 });
    expect(r.Lp).toBeGreaterThan(r.L);
    const f = createFlow(plantOf(r), r);
    expect(f.speeds.liquidBelow).toBeGreaterThan(f.speeds.liquidAbove);
    expect(f.speeds.liquidAbove).toBeCloseTo(0.9, 9); // reference = this solve's L
    expect(f.speeds.liquidBelow).toBeCloseTo(0.9 * (r.Lp / r.L), 9);
    expect(f.speeds.vaporAbove).toBeCloseTo(1.4, 9);
    expect(f.speeds.vaporBelow).toBeCloseTo(1.4 * (r.Vp / r.V), 9);
    f.dispose();
  });

  it('keeps reference speeds across solves of the same mixture and resets them on a mixture change', () => {
    const a = createFlow(plantOf(adv), adv);
    const more = solved({ ...MW, mode: 'advanced', R: 4 });
    const b = createFlow(plantOf(more), more, a);
    expect(b.speeds.liquidAbove).toBeCloseTo(0.9 * (more.L / adv.L), 9);
    expect(b.speeds.liquidAbove).toBeGreaterThan(0.9);
    const other = solved({ mixtureId: 'benzene-toluene', mode: 'advanced' });
    const c = createFlow(plantOf(other), other, b);
    expect(c.speeds.liquidAbove).toBeCloseTo(0.9, 9);
    [a, b, c].forEach((f) => f.dispose());
  });

  it('keeps every particle inside the column: liquid on the path, vapour in the active area', () => {
    const plant = plantOf(adv);
    const f = createFlow(plant, adv);
    for (let k = 0; k < 400; k++) f.update(0.05);
    const lp = f.points[0].geometry.getAttribute('position') as BufferAttribute;
    const vp = f.points[1].geometry.getAttribute('position') as BufferAttribute;
    const box = plant.vaporBox;
    for (let i = 0; i < lp.count; i++) {
      expect(Math.hypot(lp.getX(i), lp.getZ(i))).toBeLessThan(1.0 - 0.05);
      expect(lp.getY(i)).toBeGreaterThan(plant.layout.y0);
      expect(lp.getY(i)).toBeLessThan(plant.layout.yTop);
    }
    for (let i = 0; i < vp.count; i++) {
      expect(Math.abs(vp.getX(i))).toBeLessThan(CHORD_X);
      expect(Math.abs(vp.getZ(i))).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(vp.getY(i)).toBeGreaterThanOrEqual(box.min.y - 1e-9);
      expect(vp.getY(i)).toBeLessThanOrEqual(box.max.y + 1e-9);
    }
    f.dispose();
  });

  it('colours liquid particles by x at their height: top is orange-ish, bottom blue-ish', () => {
    const plant = plantOf(adv);
    const f = createFlow(plant, adv);
    const pos = f.points[0].geometry.getAttribute('position') as BufferAttribute;
    const col = f.points[0].geometry.getAttribute('color') as BufferAttribute;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const redness = col.getX(i) - col.getZ(i);
      if (y > plant.layout.yTop - 3) hi = Math.max(hi, redness);
      if (y < plant.layout.y0 + 4.5) lo = Math.min(lo, redness);
    }
    expect(hi).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0);
    f.dispose();
  });

  it('freezes and dims when ghosted, and resumes on recovery', () => {
    const f = createFlow(plantOf(adv), adv);
    const mat = f.points[0].material as { opacity: number };
    const full = mat.opacity;
    f.setGhost(true);
    const s0 = Array.from(f.liquidS);
    f.update(0.05);
    expect(Array.from(f.liquidS)).toEqual(s0);
    expect(mat.opacity).toBeLessThan(full);
    f.setGhost(false);
    f.update(0.05);
    expect(Array.from(f.liquidS)).not.toEqual(s0);
    expect(mat.opacity).toBe(full);
    f.dispose();
  });
});
