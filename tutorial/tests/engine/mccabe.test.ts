import { describe, it, expect } from 'vitest';
import { MIXTURES } from '../../src/engine/mixtures';
import { bubblePoint, VleModelError } from '../../src/engine/vle';
import { constantAlphaCurve, vleCurve } from '../../src/engine/curve';
import { fenske, nminTotalReflux, qLineIntersection, rminPinch, stepStages, StageLimitError } from '../../src/engine/mccabe';

const P = 1.01325;
const c = constantAlphaCurve(2.5);
const meoh = vleCurve(MIXTURES['methanol-water'], P);
const etoh = vleCurve(MIXTURES['ethanol-water'], P);

// Expected values: independent Python implementation (ref.py / adv.py), 2026-10-27.
describe('curves', () => {
  it('constant-alpha xStar inverts yStar', () => {
    for (const x of [0, 0.05, 0.3, 0.77, 1]) expect(c.xStar(c.yStar(x))).toBeCloseTo(x, 12);
  });
  it('vleCurve matches bubblePoint within 1e-4 at the true midpoint of EVERY node interval (incl. x < 0.0025)', () => {
    for (const id of ['methanol-water', 'ethanol-water', 'acetone-water', 'isopropanol-water', 'benzene-toluene'] as const) {
      const curve = vleCurve(MIXTURES[id], P);
      const nodes = curve.nodes!;
      expect(nodes.length).toBeGreaterThan(100);
      let worst = 0;
      let worstX = 0;
      for (let i = 0; i + 1 < nodes.length; i++) {
        const x = 0.5 * (nodes[i] + nodes[i + 1]);
        const err = Math.abs(curve.yStar(x) - bubblePoint(MIXTURES[id], x, P).y1);
        if (err > worst) {
          worst = err;
          worstX = x;
        }
        expect(curve.xStar(curve.yStar(x))).toBeCloseTo(x, 9);
      }
      expect(nodes.some((x) => x > 0 && x < 0.0025)).toBe(true); // the low-x region is sampled
      expect(worst, `${id}: worst error ${worst} at x = ${worstX}`).toBeLessThanOrEqual(1e-4);
    }
  });
  it('vleCurve is cached per mixture and P rounded to 1e-4 bar', () => {
    const m = MIXTURES['methanol-water'];
    expect(vleCurve(m, P)).toBe(meoh);
    expect(vleCurve(m, P + 3e-5)).toBe(meoh);
    expect(vleCurve(m, 2)).not.toBe(meoh);
  });
  it('vleCurve throws VleModelError on a spurious phase split', () => {
    expect(() => vleCurve(MIXTURES['isopropanol-water'], 5)).toThrow(VleModelError);
  });
});

describe('McCabe-Thiele, constant alpha', () => {
  it.each([
    [{ xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 1 }, 10.388, 11, 5],
    [{ xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 0.5 }, 12.2192, 13, 7],
    [{ xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 1.2 }, 9.9309, 10, 5],
    [{ xF: 0.4, xD: 0.98, xB: 0.02, R: 3, q: 1 }, 13.1159, 14, 7],
  ])('stepping %o', (op, Nfrac, N, feed) => {
    const r = stepStages(c, op);
    expect(r.Nfrac).toBeCloseTo(Nfrac, 3);
    expect(r.N).toBe(N);
    expect(r.feedStage).toBe(feed);
    expect(r.stages).toHaveLength(N);
    expect(r.stages[0].y).toBe(op.xD);
  });
  it('qLineIntersection: q=1 gives xF; q=0.5 lies on both lines', () => {
    expect(qLineIntersection({ xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 1 }).x).toBe(0.5);
    const { x, y } = qLineIntersection({ xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 0.5 });
    expect(y).toBeCloseTo((2 / 3) * x + 0.95 / 3, 12);
    expect(y).toBeCloseTo((0.5 / -0.5) * x + 0.5 / 0.5, 12);
  });
  it('Rmin pinch q=1 equals Underwood/King 1.1000', () => {
    const r = rminPinch(c, { xF: 0.5, xD: 0.95, xB: 0.05, R: 0, q: 1 });
    expect(r.Rmin).toBeCloseTo(1.1, 3);
    expect(r.pinch).toBe('feed');
  });
  it('Rmin pinch q=0.5 -> 1.4987; q=1.2 -> 0.9888', () => {
    expect(rminPinch(c, { xF: 0.5, xD: 0.95, xB: 0.05, R: 0, q: 0.5 }).Rmin).toBeCloseTo(1.4987, 3);
    expect(rminPinch(c, { xF: 0.5, xD: 0.95, xB: 0.05, R: 0, q: 1.2 }).Rmin).toBeCloseTo(0.9888, 3);
  });
  it('Rmin for q outside [0,1]: q=-0.5 -> 2.85767, q=0 -> 2.1, q=1.5 -> 0.85767, q=3 -> 0.49182', () => {
    for (const [q, want] of [[-0.5, 2.85767], [0, 2.1], [1.5, 0.85767], [3, 0.49182]]) {
      const got = rminPinch(c, { xF: 0.5, xD: 0.95, xB: 0.05, R: 0, q }).Rmin;
      expect(Math.abs(got - want), `q=${q}: ${got}`).toBeLessThan(1e-4);
    }
  });
  it('q = 1 +/- 1e-9 still gives Rmin 1.1', () => {
    for (const q of [1 - 1e-9, 1 + 1e-9]) {
      expect(Math.abs(rminPinch(c, { xF: 0.5, xD: 0.95, xB: 0.05, R: 0, q }).Rmin - 1.1)).toBeLessThan(1e-3);
    }
  });
  it('Rmin is exactly 0 when R = 0 is already feasible', () => {
    // very volatile pair, xD barely above xF: the flat R = 0 rectifying line clears y*
    expect(rminPinch(constantAlphaCurve(50), { xF: 0.5, xD: 0.5001, xB: 0.01, R: 0, q: 1 }).Rmin).toBe(0);
  });
  it('Fenske a=2.5 xD .95 xB .05 -> 6.4269; nminTotalReflux within 0.5 stage of it', () => {
    expect(Math.abs(fenske(2.5, 0.95, 0.05) - 6.4269)).toBeLessThan(1e-4);
    expect(Math.abs(nminTotalReflux(c, 0.95, 0.05) - fenske(2.5, 0.95, 0.05))).toBeLessThan(0.5);
  });
});

describe('McCabe-Thiele, real VLE', () => {
  const op = { xF: 0.5, xD: 0.95, xB: 0.05, R: 2.5, q: 1 };
  it('methanol-water xF.5 xD.95 xB.05 R2.5 q1 -> Nfrac 5.314, N 6, feed 4', () => {
    const r = stepStages(meoh, op);
    expect(Math.abs(r.Nfrac - 5.314)).toBeLessThan(0.01);
    expect(r.N).toBe(6);
    expect(r.feedStage).toBe(4);
  });
  it('methanol-water stage-1 liquid x = 0.8759; stage-6 x = 0.0100', () => {
    const r = stepStages(meoh, op);
    expect(Math.abs(r.stages[0].x - 0.8759)).toBeLessThan(0.001);
    expect(Math.abs(r.stages[5].x - 0.01)).toBeLessThan(0.001);
  });
  it('methanol-water Rmin = 0.5576; Nmin = 4.289', () => {
    expect(Math.abs(rminPinch(meoh, { ...op, R: 0 }).Rmin - 0.5576)).toBeLessThan(0.002);
    expect(Math.abs(nminTotalReflux(meoh, 0.95, 0.05) - 4.289)).toBeLessThan(0.01);
  });
  it('ethanol-water xF .1 xD .84 xB .01: Rmin 1.6141, tangent-rectifying (q-line value would be 1.1372)', () => {
    const r = rminPinch(etoh, { xF: 0.1, xD: 0.84, xB: 0.01, R: 0, q: 1 });
    expect(Math.abs(r.Rmin - 1.6141)).toBeLessThan(0.005);
    expect(r.pinch).toBe('tangent-rectifying');
    const yi = etoh.yStar(0.1);
    const s = (0.84 - yi) / (0.84 - 0.1);
    expect(Math.abs(s / (1 - s) - 1.1372)).toBeLessThan(0.005);
  });
  it('ethanol-water xF .1 xD .80 xB .02: Rmin 1.0216, feed pinch', () => {
    const r = rminPinch(etoh, { xF: 0.1, xD: 0.8, xB: 0.02, R: 0, q: 1 });
    expect(Math.abs(r.Rmin - 1.0216)).toBeLessThan(0.002);
    expect(r.pinch).toBe('feed');
  });
  it('ethanol-water xD .8 xB .02 Nmin = 5.963', () => {
    expect(Math.abs(nminTotalReflux(etoh, 0.8, 0.02) - 5.963)).toBeLessThan(0.02);
  });
});

// Brute-force Rmin on the same curve: bisection with a 20,000-point uniform check.
function bruteRmin(curve: ReturnType<typeof vleCurve>, o: { xF: number; xD: number; xB: number; q: number }): number {
  const ok = (R: number): boolean => {
    const op = { ...o, R };
    const { x: xi, y: yi } = qLineIntersection(op);
    if (!(xi > o.xB && xi < o.xD) || yi >= curve.yStar(xi)) return false;
    const rs = R / (R + 1);
    const ri = o.xD / (R + 1);
    const ss = (yi - o.xB) / (xi - o.xB);
    const M = 20000;
    for (let i = 0; i <= M; i++) {
      const x = o.xB + ((o.xD - o.xB) * i) / M;
      const y = x > xi ? rs * x + ri : ss * (x - o.xB) + o.xB;
      if (y >= curve.yStar(x)) return false;
    }
    return true;
  };
  let lo = 0;
  let hi = 100;
  for (let k = 0; k < 60; k++) {
    const m = 0.5 * (lo + hi);
    if (ok(m)) hi = m;
    else lo = m;
  }
  return hi;
}

describe('rminPinch is breakpoint-aware (tangent pinch on a piecewise curve)', () => {
  it.each([
    [{ xF: 0.1, xD: 0.84, xB: 0.01, q: 1 }],
    [{ xF: 0.05, xD: 0.884, xB: 0.005, q: 1 }],
  ])('ethanol-water %o: never below, and within 1e-5 relative of, a 20,000-point brute force', (o) => {
    const got = rminPinch(etoh, { ...o, R: 0 }).Rmin;
    const bf = bruteRmin(etoh, o);
    expect(got).toBeGreaterThanOrEqual(bf * (1 - 1e-9));
    expect(Math.abs(got - bf) / bf).toBeLessThan(1e-5);
  });
});

describe('rminPinch on an analytic curve (no nodes) uses golden-section refinement', () => {
  it('ethanol-water curve with nodes hidden gives the same Rmin to 1e-5 relative', () => {
    const smooth = { yStar: etoh.yStar, xStar: etoh.xStar };
    for (const o of [{ xF: 0.1, xD: 0.84, xB: 0.01, q: 1 }, { xF: 0.05, xD: 0.884, xB: 0.005, q: 1 }]) {
      const a = rminPinch(smooth, { ...o, R: 0 });
      const b = rminPinch(etoh, { ...o, R: 0 });
      expect(Math.abs(a.Rmin - b.Rmin) / b.Rmin).toBeLessThan(1e-5);
      expect(a.pinch).toBe(b.pinch);
    }
  });
});

describe('failure modes never hang or return NaN', () => {
  const op = { xF: 0.5, xD: 0.95, xB: 0.05, R: 0, q: 1 };
  it('R below Rmin throws StageLimitError (feed pinch and tangent pinch)', () => {
    for (const R of [0, 0.5, 1.0, 1.09]) expect(() => stepStages(c, { ...op, R })).toThrow(StageLimitError);
    const tangent = { xF: 0.1, xD: 0.84, xB: 0.01, q: 1 };
    for (const R of [0.5, 1.2, 1.5, 1.6]) expect(() => stepStages(etoh, { ...tangent, R })).toThrow(StageLimitError);
  });
  it('more than 300 stages throws StageLimitError', () => {
    expect(() => nminTotalReflux(constantAlphaCurve(1.01), 0.95, 0.05)).toThrow(/300 stages/);
    expect(() => stepStages(constantAlphaCurve(1.01), { ...op, R: 100 })).toThrow(StageLimitError);
  });
  it('xD beyond the ethanol-water azeotrope throws StageLimitError', () => {
    expect(() => stepStages(etoh, { xF: 0.1, xD: 0.92, xB: 0.01, R: 5, q: 1 })).toThrow(StageLimitError);
    expect(() => nminTotalReflux(etoh, 0.92, 0.01)).toThrow(StageLimitError);
    expect(() => rminPinch(etoh, { xF: 0.1, xD: 0.92, xB: 0.01, R: 0, q: 1 })).toThrow(StageLimitError);
  });
  it('degenerate inputs throw rather than produce NaN', () => {
    expect(() => stepStages(c, { ...op, xF: 0.99 })).toThrow(StageLimitError);
    expect(() => stepStages(c, { ...op, R: NaN })).toThrow(StageLimitError);
    expect(() => stepStages(c, { ...op, R: -1 })).toThrow(StageLimitError);
    expect(() => nminTotalReflux(c, 0.05, 0.95)).toThrow(StageLimitError);
  });
});
