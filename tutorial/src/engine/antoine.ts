// Antoine vapour pressure, NIST form: log10(P/bar) = A - B / (T/K + C).
// Constants and their validity ranges live in components.ts (NIST WebBook).
// Units: bar absolute, K. Never returns NaN or Infinity: degenerate inputs
// are clamped to finite values (callers should check antoineInRange()).
import { COMPONENTS } from './components';
import type { ComponentId } from './types';

const LOG10_MIN = -20; // floor for log10(P/bar) -> P >= 1e-20 bar
const LOG10_MAX = 20; // cap -> P <= 1e20 bar
const MIN_DENOM = 1e-6; // keeps T + C and A - log10(P) strictly positive
const MIN_P_BAR = 1e-20;
const MAX_P_BAR = 1e20;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Saturation pressure in bar at temperature T_K (K). */
export function psat_bar(id: ComponentId, T_K: number): number {
  const { A, B, C } = COMPONENTS[id].antoine;
  const T = Number.isFinite(T_K) ? T_K : 0;
  const denom = Math.max(T + C, MIN_DENOM);
  return 10 ** clamp(A - B / denom, LOG10_MIN, LOG10_MAX);
}

/** True when T_K lies inside the NIST validity range of the Antoine set. */
export function antoineInRange(id: ComponentId, T_K: number): boolean {
  const { Tmin_K, Tmax_K } = COMPONENTS[id].antoine;
  return Number.isFinite(T_K) && T_K >= Tmin_K && T_K <= Tmax_K;
}

/** Saturation temperature in K of the pure component at P_bar (analytic inverse). */
export function tsat_K(id: ComponentId, P_bar: number): number {
  const { A, B, C } = COMPONENTS[id].antoine;
  const P = Number.isFinite(P_bar) ? clamp(P_bar, MIN_P_BAR, MAX_P_BAR) : 1.01325;
  const denom = Math.max(A - Math.log10(P), MIN_DENOM);
  return B / denom - C;
}
