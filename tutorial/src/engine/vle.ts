// Binary VLE: modified Raoult's law  y_i P = x_i gamma_i Psat_i(T)  (ideal
// vapour). Bubble/dew temperatures by bisection; azeotrope by scanning
// y* - x. Units: bar absolute, K, mole fractions of the light component (1).
import { psat_bar } from './antoine';
import { COMPONENTS } from './components';
import { gammas } from './activity';
import type { MixturePreset } from './mixtures';
import type { ComponentId, Warning } from './types';

const T_LO_K = 150;
const T_HI_K = 650;
const MAX_ITER = 100;
const TOL_K = 1e-9;
const ANTOINE_TOL_K = 30; // warn only when beyond the NIST range by more than this
const AZEO_POINTS = 999;
const DEW_GRID = 100; // coarse y*(x) scan used to bracket and validate the dew point
const DEW_X_TOL = 1e-13;
const SPLIT_PAD = 2e-3; // grid peaks undershoot true peaks; pad the ambiguous y window
const DEW_Y_TOL = 1e-6; // required |bubble(x).y1 - y1| of a returned dew state

const unit = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const pressure = (P: number): number => (Number.isFinite(P) && P > 0 ? P : 1.01325);

/**
 * Thrown when the activity model cannot give a trustworthy equilibrium state:
 * a predicted liquid phase split (non-monotone y*(x)) or no bubble-point root
 * in the solver bracket. A later task maps this to an OUT_OF_RANGE result.
 */
export class VleModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VleModelError';
  }
}

export interface BubbleResult {
  T_K: number;
  y1: number;
  gamma: [number, number];
  warnings: Warning[];
}
export interface DewResult {
  T_K: number;
  x1: number;
  warnings: Warning[];
}

/**
 * ANTOINE_RANGE warnings, at most one per component. Strict NIST ranges are too
 * narrow for normal runs (water starts at 344 K, ethanol ends at 366.6 K), and
 * mild extrapolation is accurate (benzene at 381.5 K: 2.24 bar vs about 2.26
 * bar real), so warn only when T is more than ANTOINE_TOL_K outside the range,
 * or at/above the component's critical temperature (no liquid-vapour
 * equilibrium exists there; the Antoine value is a pure extrapolation).
 */
function rangeWarnings(mix: MixturePreset, T_K: number): Warning[] {
  const out: Warning[] = [];
  for (const id of [mix.light, mix.heavy] as ComponentId[]) {
    const { name, Tc_K, antoine } = COMPONENTS[id];
    if (T_K >= Tc_K) {
      out.push({
        code: 'ANTOINE_RANGE',
        message: `${name} above its critical temperature (Tc = ${Tc_K} K) — vapour pressure extrapolated, results approximate`,
      });
    } else if (T_K < antoine.Tmin_K - ANTOINE_TOL_K || T_K > antoine.Tmax_K + ANTOINE_TOL_K) {
      out.push({
        code: 'ANTOINE_RANGE',
        message: `${name} vapour pressure evaluated at ${T_K.toFixed(1)} K, outside its Antoine range ${antoine.Tmin_K}-${antoine.Tmax_K} K; treat results as approximate.`,
      });
    }
  }
  return out;
}

/**
 * Root of an increasing function of T on [T_LO_K, T_HI_K]. The bracket was
 * verified (probe over every preset, P = 0.5, 1.01325, 5, 10 and 25 bar,
 * x = 0, 0.001, 0.5, 0.999, 1) to change sign every time and f was single-
 * rooted on a 1 K scan; if it ever does not, throw rather than return an edge.
 */
function bisect(f: (T: number) => number, context: string): number {
  let lo = T_LO_K;
  let hi = T_HI_K;
  if (!(f(lo) <= 0 && f(hi) >= 0)) {
    throw new VleModelError(`${context}: no bubble-point root in ${T_LO_K}-${T_HI_K} K; the vapour-pressure/activity model is outside its validity.`);
  }
  for (let i = 0; i < MAX_ITER && hi - lo > TOL_K; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

const ctx = (mix: MixturePreset, P: number): string => `${mix.name} at ${P} bar`;

/** Bubble point: liquid x1 at P_bar -> T, equilibrium vapour y1, gammas. */
export function bubblePoint(mix: MixturePreset, x1: number, P_bar: number): BubbleResult {
  const x = unit(x1);
  const P = pressure(P_bar);
  const f = (T: number): number => {
    const [g1, g2] = gammas(mix, x, T);
    return x * g1 * psat_bar(mix.light, T) + (1 - x) * g2 * psat_bar(mix.heavy, T) - P;
  };
  const T_K = bisect(f, ctx(mix, P));
  const gamma = gammas(mix, x, T_K);
  const y1 = unit((x * gamma[0] * psat_bar(mix.light, T_K)) / P);
  return { T_K, y1, gamma, warnings: rangeWarnings(mix, T_K) };
}

// y*(x) on a DEW_GRID grid plus the y-windows spanned by its decreasing runs
// (model-predicted phase splits), cached per mixture object and pressure.
interface Curve {
  ys: number[];
  splits: [number, number][]; // [lowest y, highest y] of each non-monotone run, padded by SPLIT_PAD
}
const curveCache = new WeakMap<MixturePreset, Map<number, Curve>>();
function yCurve(mix: MixturePreset, P: number): Curve {
  let byP = curveCache.get(mix);
  if (!byP) curveCache.set(mix, (byP = new Map()));
  let c = byP.get(P);
  if (!c) {
    const ys: number[] = [];
    for (let i = 0; i <= DEW_GRID; i++) {
      // pure-component end points are exact by definition
      ys.push(i === 0 ? 0 : i === DEW_GRID ? 1 : bubblePoint(mix, i / DEW_GRID, P).y1);
    }
    const splits: [number, number][] = [];
    for (let i = 0; i < DEW_GRID; i++) {
      if (ys[i + 1] < ys[i] - 1e-12) {
        let j = i;
        while (j < DEW_GRID && ys[j + 1] < ys[j] - 1e-12) j++;
        splits.push([ys[j] - SPLIT_PAD, ys[i] + SPLIT_PAD]);
        i = j;
      }
    }
    byP.set(P, (c = { ys, splits }));
  }
  return c;
}

/**
 * Dew point: vapour y1 at P_bar -> T and equilibrium liquid x1.
 * Solved as a root of g(x) = y*(x) - y1 by bisection on x. A coarse scan of
 * y*(x) must show exactly one crossing and y1 must lie outside every
 * decreasing stretch of the curve; otherwise the activity model predicts a
 * liquid phase split (spurious for the extrapolated IPA- and
 * acetone-water parameters at elevated pressure) and a VleModelError is thrown.
 * The returned state is verified against the bubble point.
 */
export function dewPoint(mix: MixturePreset, y1: number, P_bar: number): DewResult {
  const y = unit(y1);
  const P = pressure(P_bar);
  if (y <= 0 || y >= 1) {
    const x = y <= 0 ? 0 : 1;
    const b = bubblePoint(mix, x, P);
    return { T_K: b.T_K, x1: x, warnings: b.warnings };
  }
  const { ys, splits } = yCurve(mix, P);
  const ambiguous = splits.some(([lo, hi]) => y >= lo && y <= hi);
  let cell = -1;
  let crossings = 0;
  for (let i = 0; i < DEW_GRID; i++) {
    if (ys[i] - y <= 0 && ys[i + 1] - y > 0) {
      crossings++;
      cell = i;
    } else if (ys[i] - y > 0 && ys[i + 1] - y <= 0) {
      crossings++;
    }
  }
  if (ambiguous || crossings !== 1) {
    throw new VleModelError(
      `${ctx(mix, P)}: the activity model predicts a liquid phase split (non-monotone y*(x)) near y = ${y}; dew point is not defined, outside the model's validity.`,
    );
  }
  let lo = cell / DEW_GRID;
  let hi = (cell + 1) / DEW_GRID;
  for (let k = 0; k < MAX_ITER && hi - lo > DEW_X_TOL; k++) {
    const mid = 0.5 * (lo + hi);
    if (bubblePoint(mix, mid, P).y1 - y > 0) hi = mid;
    else lo = mid;
  }
  const x = 0.5 * (lo + hi);
  const b = bubblePoint(mix, x, P);
  if (!(Math.abs(b.y1 - y) <= DEW_Y_TOL)) {
    throw new VleModelError(`${ctx(mix, P)}: dew point for y = ${y} could not be verified against the bubble point (|dy| = ${Math.abs(b.y1 - y)}).`);
  }
  return { T_K: b.T_K, x1: x, warnings: b.warnings };
}

/** Azeotrope at P_bar: composition x (light) and T_K, or null if none. */
export function findAzeotrope(mix: MixturePreset, P_bar: number): { x: number; T_K: number } | null {
  const d = (x: number): number => bubblePoint(mix, x, P_bar).y1 - x;
  let prevX = 1 / (AZEO_POINTS + 1);
  let prevD = d(prevX);
  for (let i = 2; i <= AZEO_POINTS; i++) {
    const x = i / (AZEO_POINTS + 1);
    const cur = d(x);
    if (prevD === 0 || prevD * cur < 0) {
      let lo = prevX;
      let hi = x;
      let dlo = prevD;
      for (let k = 0; k < MAX_ITER && hi - lo > 1e-12; k++) {
        const mid = 0.5 * (lo + hi);
        const dm = d(mid);
        if (dlo * dm <= 0) hi = mid;
        else {
          lo = mid;
          dlo = dm;
        }
      }
      const xa = 0.5 * (lo + hi);
      return { x: xa, T_K: bubblePoint(mix, xa, P_bar).T_K };
    }
    prevX = x;
    prevD = cur;
  }
  return null;
}
