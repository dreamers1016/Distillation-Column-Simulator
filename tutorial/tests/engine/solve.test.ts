import { describe, it, expect } from 'vitest';
import { deriveSimpleAlpha, solve } from '../../src/engine/solve';
import { MIXTURES, type MixtureId } from '../../src/engine/mixtures';
import { constantAlphaCurve } from '../../src/engine/curve';
import { rminPinch } from '../../src/engine/mccabe';
import type { ErrorCode, Inputs, Results, SolveResult } from '../../src/engine/types';

const inputs = (mixtureId: MixtureId, over: Partial<Inputs> = {}): Inputs => {
  const d = MIXTURES[mixtureId].defaults;
  return {
    mode: 'advanced', mixtureId, F_kgh: 1000, xF: d.xF, xD: d.xD, xB: d.xB, R: d.R, q: d.q,
    feedT_C: d.feedT_C, P_bar: d.P_bar, Eo: 0.7, heatLossPct: 0,
    condenserUtility: 'auto', steamLevel: 'auto', cw: { in_C: 30, out_C: 40 }, chw: { in_C: 7, out_C: 12 },
    ...over,
  };
};
const simple = (mixtureId: MixtureId, over: Partial<Inputs> = {}): Inputs => inputs(mixtureId, { mode: 'simple', ...over });
const ok = (r: SolveResult): Results => {
  if (!r.ok) throw new Error(`expected ok result, got ${r.error.code}: ${r.error.message}`);
  return r;
};
const err = (r: SolveResult): { code: ErrorCode; message: string } => {
  if (r.ok) throw new Error('expected an error result, got ok');
  return r.error;
};
const ERROR_CODES: ErrorCode[] = ['INVALID_COMPOSITION', 'R_BELOW_MIN', 'AZEOTROPE', 'NOT_SIMPLE', 'UNVERIFIED', 'STAGE_LIMIT', 'OUT_OF_RANGE'];

describe('deriveSimpleAlpha (geometric mean of alpha(xD = 0.95) and alpha(xB = 0.05) at 1.01325 bar)', () => {
  // Expected values: the pre-computed reference run (spec / plan Task 7).
  const expected: [MixtureId, number][] = [
    ['benzene-toluene', 2.4744],
    ['hexane-heptane', 2.4746],
    ['methanol-ethanol', 1.7232],
    ['methanol-water', 4.3011],
  ];
  for (const [id, a] of expected) {
    it(`${id}: ${a} ±0.002`, () => {
      expect(Math.abs(deriveSimpleAlpha(MIXTURES[id]) - a)).toBeLessThanOrEqual(0.002);
    });
  }
  it('the frozen MIXTURES simpleAlpha values reproduce the derivation within 1e-4', () => {
    for (const m of Object.values(MIXTURES)) {
      if (m.simpleAlpha === undefined) continue;
      expect(Math.abs(m.simpleAlpha - deriveSimpleAlpha(m))).toBeLessThanOrEqual(1e-4);
    }
  });
  it('only the four Simple-allowed presets carry a Simple alpha', () => {
    const withAlpha = Object.values(MIXTURES).filter((m) => m.simpleAlpha !== undefined).map((m) => m.id).sort();
    expect(withAlpha).toEqual(['benzene-toluene', 'hexane-heptane', 'methanol-ethanol', 'methanol-water']);
  });
});

describe('solve(): happy paths', () => {
  it('Simple benzene-toluene default dispatches to the Simple solver', () => {
    const r = ok(solve(simple('benzene-toluene')));
    expect(r.mode).toBe('simple');
    expect(r.N).toBeGreaterThan(1);
  });
  it('Advanced methanol-water default dispatches to the Advanced solver', () => {
    const r = ok(solve(inputs('methanol-water')));
    expect(r.mode).toBe('advanced');
    expect(r.N).toBe(6);
  });
});

describe('solve(): validation order and codes', () => {
  it('INVALID_COMPOSITION unless 0 < xB < xF < xD < 1', () => {
    const bad: Partial<Inputs>[] = [
      { xB: 0 }, { xB: 0.6 }, { xF: 0.04 }, { xF: 0.96 }, { xD: 1 }, { xD: 0.4 }, { xF: NaN }, { xD: Infinity }, { xB: -0.1 },
    ];
    for (const over of bad) expect(err(solve(inputs('methanol-water', over))).code).toBe('INVALID_COMPOSITION');
  });
  it('composition is checked before UNVERIFIED and NOT_SIMPLE', () => {
    expect(err(solve(inputs('acetone-water', { xB: 0.9 }))).code).toBe('INVALID_COMPOSITION');
    expect(err(solve(simple('ethanol-water', { xD: 0.99, xB: 0.995 }))).code).toBe('INVALID_COMPOSITION');
  });
  it('acetone-water and isopropanol-water give UNVERIFIED in both modes', () => {
    for (const id of ['acetone-water', 'isopropanol-water'] as const) {
      for (const mode of ['simple', 'advanced'] as const) {
        const e = err(solve(inputs(id, { mode })));
        expect(e.code).toBe('UNVERIFIED');
        expect(e.message).toContain(MIXTURES[id].name);
      }
    }
  });
  it('UNVERIFIED is checked before NOT_SIMPLE and input ranges', () => {
    expect(err(solve(simple('acetone-water', { Eo: 0 }))).code).toBe('UNVERIFIED');
  });
  it('ethanol-water and propane-butane in Simple mode give NOT_SIMPLE', () => {
    for (const id of ['ethanol-water', 'propane-butane'] as const) {
      expect(err(solve(simple(id))).code).toBe('NOT_SIMPLE');
    }
  });
  it('NOT_SIMPLE is checked before input ranges; ethanol-water in Advanced is not NOT_SIMPLE', () => {
    expect(err(solve(simple('ethanol-water', { Eo: 0 }))).code).toBe('NOT_SIMPLE');
    expect(ok(solve(inputs('ethanol-water'))).mode).toBe('advanced');
  });
  it('input ranges are checked before R_BELOW_MIN', () => {
    expect(err(solve(simple('benzene-toluene', { Eo: 0, R: 0.01 }))).code).toBe('OUT_OF_RANGE');
  });
  it('an unknown mixture id is OUT_OF_RANGE, not a thrown TypeError', () => {
    const e = err(solve(inputs('methanol-water', { mixtureId: 'nope' as MixtureId })));
    expect(e.code).toBe('OUT_OF_RANGE');
  });
});

describe('solve(): OUT_OF_RANGE input validation', () => {
  const cases: [string, Inputs, string][] = [
    ['Eo = 0', simple('benzene-toluene', { Eo: 0 }), 'E_o'],
    ['Eo > 1', simple('benzene-toluene', { Eo: 1.01 }), 'E_o'],
    ['Eo NaN', simple('benzene-toluene', { Eo: NaN }), 'E_o'],
    ['F_kgh = 0', simple('benzene-toluene', { F_kgh: 0 }), 'F'],
    ['F_kgh < 0', simple('benzene-toluene', { F_kgh: -3 }), 'F'],
    ['F_kgh Infinity', simple('benzene-toluene', { F_kgh: Infinity }), 'F'],
    ['P < 0.5 (Advanced)', inputs('methanol-water', { P_bar: 0.4 }), 'P'],
    ['P > 25 (Advanced)', inputs('methanol-water', { P_bar: 26 }), 'P'],
    ['heat loss < 0', simple('benzene-toluene', { heatLossPct: -1 }), 'heat loss'],
    ['heat loss > 15', simple('benzene-toluene', { heatLossPct: 15.5 }), 'heat loss'],
    ['R = 0', simple('benzene-toluene', { R: 0 }), 'R'],
    ['R < 0', simple('benzene-toluene', { R: -1 }), 'R'],
    ['R NaN', simple('benzene-toluene', { R: NaN }), 'R'],
    ['R Infinity', simple('benzene-toluene', { R: Infinity }), 'R'],
    ['q < -0.5 (Simple)', simple('benzene-toluene', { q: -0.6 }), 'q'],
    ['q > 1.5 (Simple)', simple('benzene-toluene', { q: 1.6 }), 'q'],
    ['q NaN (Simple)', simple('benzene-toluene', { q: NaN }), 'q'],
    ['feedT < -40 (Advanced)', inputs('methanol-water', { feedT_C: -41 }), 'feed'],
    ['feedT > 200 (Advanced)', inputs('methanol-water', { feedT_C: 201 }), 'feed'],
    ['feedT NaN (Advanced)', inputs('methanol-water', { feedT_C: NaN }), 'feed'],
    ['cw.out_C NaN', simple('benzene-toluene', { cw: { in_C: 30, out_C: NaN } }), 'cw'],
    ['chw.in_C -Infinity', simple('benzene-toluene', { chw: { in_C: -Infinity, out_C: 12 } }), 'chw'],
  ];
  for (const [name, inp, word] of cases) {
    it(name, () => {
      const e = err(solve(inp));
      expect(e.code).toBe('OUT_OF_RANGE');
      expect(e.message.toLowerCase()).toContain(word.toLowerCase());
    });
  }
  it('boundary values are accepted: E_o 1, heat loss 0 and 15, q -0.5 and 1.5, P 0.5 and 25 are not rejected as OUT_OF_RANGE by validation', () => {
    const edges: Inputs[] = [
      simple('benzene-toluene', { Eo: 1 }),
      simple('benzene-toluene', { heatLossPct: 0 }),
      simple('benzene-toluene', { heatLossPct: 15 }),
      simple('benzene-toluene', { q: -0.5, R: 5 }),
      simple('benzene-toluene', { q: 1.5 }),
      inputs('methanol-water', { P_bar: 0.5, feedT_C: 20 }),
      inputs('methanol-water', { P_bar: 25, feedT_C: 20 }),
      inputs('methanol-water', { feedT_C: -40 }),
      inputs('methanol-water', { feedT_C: 200, R: 8 }),
    ];
    for (const e of edges) {
      const r = solve(e);
      if (!r.ok) expect(r.error.message).not.toMatch(/must be (finite|between|in)/i);
    }
  });
  it('q is not range-checked in Advanced and feedT is not range-checked in Simple', () => {
    expect(ok(solve(inputs('methanol-water', { q: 99 }))).mode).toBe('advanced');
    expect(ok(solve(simple('benzene-toluene', { feedT_C: 9999 }))).mode).toBe('simple');
  });
});

describe('solve(): R_BELOW_MIN', () => {
  const op = { xF: 0.5, xD: 0.95, xB: 0.05, q: 1 };
  const rmin = rminPinch(constantAlphaCurve(MIXTURES['benzene-toluene'].simpleAlpha as number), { ...op, R: 1 }).Rmin;
  it('R = Rmin gives R_BELOW_MIN with Rmin to 2 decimals in the message (Simple)', () => {
    const e = err(solve(simple('benzene-toluene', { R: rmin })));
    expect(e.code).toBe('R_BELOW_MIN');
    expect(e.message).toContain(rmin.toFixed(2));
  });
  it('R just above Rmin but within the 1.0001 tolerance is still R_BELOW_MIN', () => {
    expect(err(solve(simple('benzene-toluene', { R: rmin * 1.00005 }))).code).toBe('R_BELOW_MIN');
  });
  it('R clearly above Rmin solves', () => {
    const r = ok(solve(simple('benzene-toluene', { R: rmin * 1.3 })));
    expect(r.L / r.D_kmolh).toBeCloseTo(rmin * 1.3, 12);
  });
  it('Advanced: Rmin uses the q implied by the feed temperature (cold feed lowers Rmin, here 0.52 vs 0.56)', () => {
    const e = err(solve(inputs('methanol-water', { R: 0.3 })));
    expect(e.code).toBe('R_BELOW_MIN');
    expect(e.message).toContain('Rmin = 0.56');
    // R = 0.54 is below Rmin for the bubble-point feed but above it for a -20 °C feed
    expect(err(solve(inputs('methanol-water', { R: 0.54 }))).code).toBe('R_BELOW_MIN');
    expect(solve(inputs('methanol-water', { R: 0.54, feedT_C: -20 })).ok).toBe(true);
  });
});

describe('solve(): domain errors from the solvers', () => {
  it('Advanced ethanol-water with xD above the azeotrope returns AZEOTROPE (before the Rmin check)', () => {
    const e = err(solve(inputs('ethanol-water', { xD: 0.95, xB: 0.02, xF: 0.1, R: 0.2 })));
    expect(e.code).toBe('AZEOTROPE');
    expect(e.message).toContain('0.89');
  });
  it('Advanced ethanol-water below the azeotrope solves', () => {
    expect(ok(solve(inputs('ethanol-water'))).mode).toBe('advanced');
  });
});

describe('solve(): never throws', () => {
  it('extreme in-range inputs do not throw', () => {
    expect(() => solve(simple('benzene-toluene', { R: 1000, Eo: 0.01 }))).not.toThrow();
    expect(() => solve(simple('benzene-toluene', { xF: 0.5, xD: 0.5001, xB: 0.4999 }))).not.toThrow();
    expect(() => solve(inputs('methanol-water', { P_bar: 25, feedT_C: 200 }))).not.toThrow();
  });
  it('garbage (missing fields) returns an error result instead of throwing', () => {
    const garbage = { mode: 'advanced', mixtureId: 'methanol-water' } as unknown as Inputs;
    expect(solve(garbage).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fuzz. Seeded PRNG (mulberry32) so the run is deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paths of every non-finite number inside a value (numbers, arrays, nested objects). */
function nonFinitePaths(v: unknown, path = '$', out: string[] = []): string[] {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(`${path}=${v}`);
  } else if (Array.isArray(v)) {
    v.forEach((e, i) => nonFinitePaths(e, `${path}[${i}]`, out));
  } else if (v !== null && typeof v === 'object') {
    for (const [k, e] of Object.entries(v)) nonFinitePaths(e, `${path}.${k}`, out);
  }
  return out;
}

describe('nonFinitePaths (fuzz helper self-check)', () => {
  it('finds NaN and Infinity at any depth', () => {
    expect(nonFinitePaths({ a: 1, b: [2, { c: NaN }], d: { e: -Infinity }, f: null })).toEqual(['$.b[1].c=NaN', '$.d.e=-Infinity']);
  });
});

describe('fuzz: 2,000 random in-slider-range inputs', () => {
  it('solve never throws, ok results are fully finite, error results carry a known code', () => {
    const rnd = mulberry32(20261027);
    const between = (lo: number, hi: number): number => lo + (hi - lo) * rnd();
    const ids = Object.keys(MIXTURES) as MixtureId[];
    const counts: Record<string, number> = { ok: 0 };
    for (const c of ERROR_CODES) counts[c] = 0;
    const stageLimitMessages: string[] = [];
    const t0 = Date.now();
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const xB = between(0.005, 0.2);
      const xD = between(0.8, 0.995);
      const xF = between(xB + 0.01, xD - 0.01);
      const mode = rnd() < 0.5 ? 'simple' : 'advanced';
      const mixtureId = ids[Math.floor(rnd() * ids.length)];
      const inp: Inputs = {
        mode, mixtureId, F_kgh: between(100, 10000), xF, xD, xB, R: between(0.3, 10),
        q: between(-0.5, 1.5), feedT_C: between(-40, 200), P_bar: between(0.5, 25),
        Eo: between(0.4, 1), heatLossPct: between(0, 15),
        condenserUtility: (['auto', 'CW', 'ChW'] as const)[Math.floor(rnd() * 3)],
        steamLevel: (['auto', 'LP', 'MP', 'HP'] as const)[Math.floor(rnd() * 4)],
        cw: { in_C: 30, out_C: 40 }, chw: { in_C: 7, out_C: 12 },
      };
      let r: SolveResult;
      try {
        r = solve(inp);
      } catch (e) {
        throw new Error(`solve threw for ${JSON.stringify(inp)}: ${String(e)}`);
      }
      if (r.ok) {
        counts.ok++;
        const bad = nonFinitePaths(r);
        if (bad.length) throw new Error(`non-finite ${bad.slice(0, 5).join(', ')} for ${JSON.stringify(inp)}`);
      } else {
        expect(ERROR_CODES, JSON.stringify(inp)).toContain(r.error.code);
        expect(r.error.message.length).toBeGreaterThan(0);
        expect(r.error.message, JSON.stringify(inp)).not.toMatch(/Unexpected solver failure/);
        expect(nonFinitePaths(r)).toEqual([]);
        counts[r.error.code]++;
        if (r.error.code === 'STAGE_LIMIT') stageLimitMessages.push(r.error.message);
      }
    }
    console.log(`fuzz ${N} inputs in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(counts), stageLimitMessages);
    // the fuzz must exercise the success path, not just the validators
    expect(counts.ok).toBeGreaterThan(200);
    // 240 s, not 120 s: measured 20-48 s (48 s under the full parallel suite, 21 files sharing
    // the CPU), so 120 s left only 2.5x headroom on a busy or slower machine. N stays at 2,000
    // so the coverage of the input space does not shrink; only the wall-clock bound grows.
  }, 240_000);
});
