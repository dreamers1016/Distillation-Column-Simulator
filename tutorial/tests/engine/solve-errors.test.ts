import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ErrorCode, Inputs, Results, SolveResult } from '../../src/engine/types';
import { MIXTURES } from '../../src/engine/mixtures';
import { constantAlphaCurve } from '../../src/engine/curve';
import { rminPinch, StageLimitError } from '../../src/engine/mccabe';
import { VleModelError } from '../../src/engine/vle';

// Thrown-error mapping and the post-solve V' check, driven by replacing the
// Simple solver with a stub for the duration of each test.
const hooks = vi.hoisted(() => ({ impl: null as null | ((i: Inputs) => unknown) }));
vi.mock('../../src/engine/simple', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/simple')>();
  return { ...actual, solveSimple: (i: Inputs, o?: unknown) => (hooks.impl ? hooks.impl(i) : actual.solveSimple(i, o as never)) };
});
import { solve } from '../../src/engine/solve';
import { solveSimple } from '../../src/engine/simple';

const base: Inputs = {
  mode: 'simple', mixtureId: 'benzene-toluene', F_kgh: 1000, xF: 0.5, xD: 0.95, xB: 0.05, R: 2, q: 1,
  feedT_C: 0, P_bar: 1.01325, Eo: 0.7, heatLossPct: 0,
  condenserUtility: 'auto', steamLevel: 'auto', cw: { in_C: 30, out_C: 40 }, chw: { in_C: 7, out_C: 12 },
};
const rmin = rminPinch(constantAlphaCurve(MIXTURES['benzene-toluene'].simpleAlpha as number), { xF: 0.5, xD: 0.95, xB: 0.05, q: 1, R: 1 }).Rmin;
const err = (r: SolveResult): { code: ErrorCode; message: string } => {
  if (r.ok) throw new Error('expected error');
  return r.error;
};
const throwing = (e: unknown) => () => {
  throw e;
};

beforeEach(() => {
  hooks.impl = null;
});

describe('solve(): mapping of thrown solver errors', () => {
  it('StageLimitError far from Rmin → STAGE_LIMIT with the original message', () => {
    hooks.impl = throwing(new StageLimitError('more than 300 stages'));
    const e = err(solve({ ...base, R: rmin * 2 }));
    expect(e.code).toBe('STAGE_LIMIT');
    expect(e.message).toBe('more than 300 stages');
  });
  it('StageLimitError with R within 5 % above Rmin → the "very close to the minimum reflux" message', () => {
    hooks.impl = throwing(new StageLimitError('more than 300 stages'));
    const R = rmin * 1.03;
    const e = err(solve({ ...base, R }));
    expect(e.code).toBe('STAGE_LIMIT');
    expect(e.message).toBe(
      `R = ${R.toFixed(2)} is very close to the minimum reflux (Rmin = ${rmin.toFixed(2)}) — the column would need more than 300 stages; increase R`,
    );
  });
  it('the 5 % boundary: 4.9 % above uses the close-to-Rmin message, 5.1 % above does not', () => {
    hooks.impl = throwing(new StageLimitError('x'));
    expect(err(solve({ ...base, R: rmin * 1.049 })).message).toContain('very close to the minimum reflux');
    expect(err(solve({ ...base, R: rmin * 1.051 })).message).toBe('x');
  });
  it('VleModelError → OUT_OF_RANGE with the original message', () => {
    hooks.impl = throwing(new VleModelError('liquid phase split'));
    const e = err(solve({ ...base, R: rmin * 2 }));
    expect(e.code).toBe('OUT_OF_RANGE');
    expect(e.message).toBe('liquid phase split');
  });
  it('RangeError → OUT_OF_RANGE', () => {
    hooks.impl = throwing(new RangeError('steamSat: P outside table'));
    const e = err(solve({ ...base, R: rmin * 2 }));
    expect(e.code).toBe('OUT_OF_RANGE');
    expect(e.message).toContain('steamSat');
  });
  it('an unexpected Error is still returned, never thrown, and labelled as unexpected', () => {
    hooks.impl = throwing(new Error('boom'));
    const e = err(solve({ ...base, R: rmin * 2 }));
    expect(e.code).toBe('OUT_OF_RANGE');
    expect(e.message).toContain('Unexpected solver failure');
    expect(e.message).toContain('boom');
  });
  it('a non-Error throw is still returned, never thrown', () => {
    hooks.impl = throwing('just a string');
    expect(err(solve({ ...base, R: rmin * 2 })).code).toBe('OUT_OF_RANGE');
  });
});

describe('solve(): V′ ≤ 0 after a successful solve', () => {
  const real = (): Results => {
    hooks.impl = null;
    return solveSimple({ ...base, R: rmin * 2 }) as Results;
  };
  it('Vp = 0 and Vp < 0 → OUT_OF_RANGE with the superheated-feed message', () => {
    for (const Vp of [0, -3]) {
      const r = { ...real(), Vp };
      hooks.impl = () => r;
      const e = err(solve({ ...base, R: rmin * 2 }));
      expect(e.code).toBe('OUT_OF_RANGE');
      expect(e.message).toBe('Feed too superheated for this reflux — no stripping vapour (V′ ≤ 0); lower the feed temperature or raise R');
    }
  });
  it('a small positive Vp passes through', () => {
    const r = { ...real(), Vp: 1e-6 };
    hooks.impl = () => r;
    expect(solve({ ...base, R: rmin * 2 }).ok).toBe(true);
  });
});
