// Equilibrium curves y*(x) for McCabe-Thiele work. Mole fractions of the light
// component. A curve is either analytic (constant relative volatility) or a
// 400-interval table of the real bubble-point y*(x), linearly interpolated.
import type { MixturePreset } from './mixtures';
import { bubblePoint, VleModelError } from './vle';

export interface EquilibriumCurve {
  yStar(x: number): number;
  xStar(y: number): number;
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

/**
 * Real-VLE equilibrium curve at P_bar: y*(x) tabulated on 400 intervals from
 * bubblePoint and linearly interpolated; xStar inverts the table by binary
 * search (the exact inverse of the interpolant, so xStar(yStar(x)) = x).
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
  const ys = new Array<number>(n + 1);
  for (let i = 0; i <= n; i++) {
    ys[i] = i === 0 ? 0 : i === n ? 1 : bubblePoint(mix, i / n, P).y1; // pure end points exact
  }
  for (let i = 0; i < n; i++) {
    if (!(ys[i + 1] > ys[i] - MONOTONE_TOL)) {
      throw new VleModelError(
        `${mix.name} at ${P} bar: the activity model predicts a liquid phase split (non-monotone y*(x)) near x = ${(i / n).toFixed(3)}; no equilibrium curve can be built, outside the model's validity.`,
      );
    }
  }
  const curve: EquilibriumCurve = {
    yStar: (x) => {
      const t = unit(x) * n;
      const i = Math.min(n - 1, Math.floor(t));
      return ys[i] + (t - i) * (ys[i + 1] - ys[i]);
    },
    xStar: (y) => {
      const v = unit(y);
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ys[mid] <= v) lo = mid;
        else hi = mid;
      }
      const dy = ys[lo + 1] - ys[lo];
      return (lo + (dy > 0 ? (v - ys[lo]) / dy : 0)) / n;
    },
  };
  if (byP.size >= CACHE_MAX_PER_MIXTURE) byP.delete(byP.keys().next().value as number);
  byP.set(key, curve);
  return curve;
}
