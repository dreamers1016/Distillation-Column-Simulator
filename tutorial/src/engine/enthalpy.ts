// Stream enthalpies for the energy balance. All in kJ/kmol, T in K.
//
// Reference state: each pure component as LIQUID at T_REF = 298.15 K (h = 0).
//   hL,i(T) = cpL,i (T - T_REF)                      constant liquid cp
//   lambda_i(T) = lambda_i(Tb) ((1 - T/Tc)/(1 - Tb/Tc))^0.38   Watson (1943)
//   hV,i(T) = hL,i(T) + lambda_i(T)                  heat the liquid, vaporise at T
// (saturated vapour). Vapour superheated above its dew point adds cpV (T - Tdew).
// Mixtures mix ideally (mole-fraction weighted, no heat of mixing).
// Watson exponent 0.38: K. M. Watson, Ind. Eng. Chem. 35 (1943) 398; Poling,
// Prausnitz and O'Connell, "The Properties of Gases and Liquids", 5th ed., eq. 7-12.1.
// cpL, Tb, Tc, lambda(Tb) come from components.ts (Poling App. A / NIST WebBook).
// Note: cpL in J/(mol K) is numerically kJ/(kmol K); lambda kJ/mol x 1000 = kJ/kmol.
import { COMPONENTS } from './components';
import type { MixturePreset } from './mixtures';
import type { ComponentId } from './types';

export const T_REF_K = 298.15;
const WATSON_N = 0.38;

/** Liquid enthalpy of pure i, kJ/kmol. */
export function hL_i(id: ComponentId, T_K: number): number {
  return COMPONENTS[id].cpL_JmolK * (T_K - T_REF_K);
}

/** Latent heat of pure i by Watson, kJ/kmol. Zero at and above Tc (never NaN). */
export function lambda_i(id: ComponentId, T_K: number): number {
  const { Tb_K, Tc_K, lambdaTb_kJmol } = COMPONENTS[id];
  const ratio = Math.max(0, 1 - T_K / Tc_K) / (1 - Tb_K / Tc_K);
  return lambdaTb_kJmol * 1000 * ratio ** WATSON_N;
}

/** Vapour enthalpy of pure i, kJ/kmol. */
export function hV_i(id: ComponentId, T_K: number): number {
  return hL_i(id, T_K) + lambda_i(id, T_K);
}

const ideal =
  (f: (id: ComponentId, T: number) => number) =>
  (mix: MixturePreset, x1: number, T_K: number): number =>
    x1 * f(mix.light, T_K) + (1 - x1) * f(mix.heavy, T_K);

/** Liquid-mixture enthalpy at light-component mole fraction x1, kJ/kmol. */
export const hL = ideal(hL_i);
/** Vapour-mixture enthalpy at light-component mole fraction y1, kJ/kmol. */
export const hV = ideal(hV_i);
/** Mole-fraction-weighted latent heat at T, kJ/kmol. */
export const lambdaMix = ideal(lambda_i);

/**
 * Superheated vapour at T above its dew point T_dew: saturated vapour plus
 * constant vapour cp, kJ/kmol. Needed because hV(T) = hL(T) + lambda(T) with
 * constant cpL implies a vapour dh/dT of cpL + dlambda/dT, which the Watson
 * slope drives far below the real cpV (methanol about 1 J/(mol K) at 350 K vs
 * 44; propane negative), and would give a superheated feed q > 0.
 */
export function hVsuperheated(mix: MixturePreset, y1: number, Tdew_K: number, T_K: number): number {
  const cpV = y1 * COMPONENTS[mix.light].cpV_JmolK + (1 - y1) * COMPONENTS[mix.heavy].cpV_JmolK;
  return hV(mix, y1, Tdew_K) + cpV * (T_K - Tdew_K);
}
