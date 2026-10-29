// Equilibrium curves y*(x) for McCabe-Thiele work. Mole fractions of the light
// component. A curve is either analytic (constant relative volatility) or a
// table of the real bubble-point y*(x) at 401 end-packed (Chebyshev) nodes,
// x_i = (1 - cos(pi i / 400)) / 2, linearly interpolated (see vleCurve).
import type { MixturePreset } from './mixtures';
import { bubblePoint, VleModelError } from './vle';

export interface EquilibriumCurve {
  yStar(x: number): number;
  xStar(y: number): number;
  /** Breakpoints of a piecewise-linear curve, ascending from 0 to 1; absent for analytic curves. */
  readonly nodes?: readonly number[];
}

const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function constantAlphaCurve(alpha: number): EquilibriumCurve {
  return {
    yStar: (x) => {
      const u = unit(x);
      return (alpha * u) / (1 + (alpha - 1) * u);
    },
    xStar: (y) => {
      const u = unit(y);
      return u / (alpha - (alpha - 1) * u);
    },
  };
}

const TABLE_INTERVALS = 400;
const P_KEY_STEP = 1e4; // cache key: P rounded to 1e-4 bar
const CACHE_MAX_PER_MIXTURE = 32;
const MONOTONE_TOL = 1e-12;

const cache = new WeakMap<MixturePreset, Map<number, EquilibriumCurve>>();

// Last index i in [0, n-1] with a[i] <= v (binary search on an ascending array).
function bracket(a: readonly number[], v: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Real-VLE equilibrium curve at P_bar: y*(x) tabulated from bubblePoint at 401
 * end-packed nodes x_i = (1 - cos(pi i / 400)) / 2 and linearly interpolated.
 * Packing the nodes toward x = 0 and 1 matters: y*(x) of the aqueous mixtures
 * bends sharply at very low x (a uniform grid misses 1e-4 by up to 2.5e-3 in
 * the first interval); measured at every interval midpoint the error is
 * <= 1e-4 for all presets. xStar is the exact inverse of the interpolant
 * (binary search on the table), so xStar(yStar(x)) = x. `nodes` exposes the
 * breakpoints for exact feasibility checks.
 * Throws VleModelError when the tabulated y*(x) is not increasing, i.e. the
 * activity model predicts a spurious liquid phase split. Past an azeotrope
 * y*(x) < x but still increases, so azeotropic systems are accepted here
 * (whether xD is reachable is checked by the caller).
 * Curves are cached per mixture and P rounded to 1e-4 bar (and the rounded P
 * is what is tabulated, so a cached curve never depends on call order); at
 * most 32 pressures are kept per mixture, oldest evicted first.
 */
export function vleCurve(mix: MixturePreset, P_bar: number): EquilibriumCurve {
  const key = Math.round(P_bar * P_KEY_STEP);
  let byP = cache.get(mix);
  if (!byP) cache.set(mix, (byP = new Map()));
  const hit = byP.get(key);
  if (hit) return hit;

  const P = key / P_KEY_STEP;
  const n = TABLE_INTERVALS;
  const xs = new Array<number>(n + 1);
  const ys = new Array<number>(n + 1);
  for (let i = 0; i <= n; i++) {
    xs[i] = i === 0 ? 0 : i === n ? 1 : (1 - Math.cos((Math.PI * i) / n)) / 2;
    ys[i] = i === 0 ? 0 : i === n ? 1 : bubblePoint(mix, xs[i], P).y1; // pure end points exact
  }
  for (let i = 0; i < n; i++) {
    if (!(ys[i + 1] > ys[i] - MONOTONE_TOL)) {
      throw new VleModelError(
        `${mix.name} at ${P} bar: the activity model predicts a liquid phase split (non-monotone y*(x)) near x = ${xs[i].toFixed(3)}; no equilibrium curve can be built, outside the model's validity.`,
      );
    }
  }
  const curve: EquilibriumCurve = {
    nodes: xs,
    yStar: (x) => {
      const u = unit(x);
      const i = bracket(xs, u);
      return ys[i] + ((u - xs[i]) / (xs[i + 1] - xs[i])) * (ys[i + 1] - ys[i]);
    },
    xStar: (y) => {
      const v = unit(y);
      const i = bracket(ys, v);
      const dy = ys[i + 1] - ys[i];
      return xs[i] + (dy > 0 ? ((v - ys[i]) / dy) * (xs[i + 1] - xs[i]) : 0);
    },
  };
  if (byP.size >= CACHE_MAX_PER_MIXTURE) byP.delete(byP.keys().next().value as number);
  byP.set(key, curve);
  return curve;
}
