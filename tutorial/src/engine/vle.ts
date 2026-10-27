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
const ANTOINE_TOL_K = 15; // warn only when beyond the NIST range by more than this
const AZEO_POINTS = 999;
const DEW_INNER_ITER = 200;
const DEW_INNER_TOL = 1e-13;

const unit = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const pressure = (P: number): number => (Number.isFinite(P) && P > 0 ? P : 1.01325);

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
 * ANTOINE_RANGE warnings. Strict NIST ranges are too narrow for normal runs
 * (water starts at 344 K, ethanol ends at 366.6 K), so warn only when T is more
 * than ANTOINE_TOL_K outside the range; milder extrapolation is covered by the
 * measured bubble-point errors against experimental data.
 */
function rangeWarnings(mix: MixturePreset, T_K: number): Warning[] {
  const out: Warning[] = [];
  for (const id of [mix.light, mix.heavy] as ComponentId[]) {
    const { Tmin_K, Tmax_K } = COMPONENTS[id].antoine;
    if (T_K < Tmin_K - ANTOINE_TOL_K || T_K > Tmax_K + ANTOINE_TOL_K) {
      out.push({
        code: 'ANTOINE_RANGE',
        message: `${COMPONENTS[id].name} vapour pressure evaluated at ${T_K.toFixed(1)} K, outside its Antoine range ${Tmin_K}-${Tmax_K} K; treat results as approximate.`,
      });
    }
  }
  return out;
}

/** Root of an increasing function of T on [T_LO_K, T_HI_K] (clamps to an end if no sign change). */
function bisect(f: (T: number) => number): number {
  let lo = T_LO_K;
  let hi = T_HI_K;
  for (let i = 0; i < MAX_ITER && hi - lo > TOL_K; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/** Bubble point: liquid x1 at P_bar -> T, equilibrium vapour y1, gammas. */
export function bubblePoint(mix: MixturePreset, x1: number, P_bar: number): BubbleResult {
  const x = unit(x1);
  const P = pressure(P_bar);
  const f = (T: number): number => {
    const [g1, g2] = gammas(mix, x, T);
    return x * g1 * psat_bar(mix.light, T) + (1 - x) * g2 * psat_bar(mix.heavy, T) - P;
  };
  const T_K = bisect(f);
  const gamma = gammas(mix, x, T_K);
  const y1 = unit((x * gamma[0] * psat_bar(mix.light, T_K)) / P);
  return { T_K, y1, gamma, warnings: rangeWarnings(mix, T_K) };
}

/** Dew point: vapour y1 at P_bar -> T and equilibrium liquid x1. */
export function dewPoint(mix: MixturePreset, y1: number, P_bar: number): DewResult {
  const y = unit(y1);
  const P = pressure(P_bar);
  let xs = y; // warm start, carried between bisection steps
  // Inner fixed point on x: x_i = y_i P / (gamma_i Psat_i), gammas from the
  // current x. Returns sum of the unnormalised x_i, which falls as T rises.
  const inner = (T: number): number => {
    let x = xs;
    let sum = 1;
    for (let i = 0; i < DEW_INNER_ITER; i++) {
      const [g1, g2] = gammas(mix, x, T);
      const xa = (y * P) / (g1 * psat_bar(mix.light, T));
      const xb = ((1 - y) * P) / (g2 * psat_bar(mix.heavy, T));
      sum = xa + xb;
      const xn = sum > 0 && Number.isFinite(sum) ? unit(xa / sum) : x;
      const done = Math.abs(xn - x) < DEW_INNER_TOL;
      x = xn;
      if (done) break;
    }
    xs = x;
    return sum;
  };
  const T_K = bisect((T) => 1 - inner(T)); // increasing in T
  inner(T_K);
  return { T_K, x1: unit(xs), warnings: rangeWarnings(mix, T_K) };
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
