// Binary NRTL activity coefficients (Aspen Plus APV NRTL databank form):
//   tau12 = a12 + b12/T,  tau21 = a21 + b21/T,  Gij = exp(-c * tauij)
//   ln g1 = x2^2 [ tau21 (G21/(x1+x2 G21))^2 + tau12 G12/(x2+x1 G12)^2 ]
//   ln g2 = x1^2 [ tau12 (G12/(x2+x1 G12))^2 + tau21 G21/(x1+x2 G21)^2 ]
// Component 1 = light (organic), 2 = heavy (water). T in K. For the 'ideal'
// model both coefficients are exactly 1. Always finite.
import type { MixturePreset } from './mixtures';

const T_MIN_K = 1; // guards b/T; thermo callers stay far above this
const LN_G_MAX = 50; // finite cap on ln(gamma)

const unit = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Activity coefficients [gamma1, gamma2] at liquid mole fraction x1 (light) and T_K. */
export function gammas(mix: MixturePreset, x1: number, T_K: number): [number, number] {
  if (mix.model !== 'nrtl' || !mix.nrtl) return [1, 1];
  const { a12, a21, b12, b21, c } = mix.nrtl;
  const T = Number.isFinite(T_K) ? Math.max(T_K, T_MIN_K) : 350;
  const x = unit(x1);
  const x2 = 1 - x;
  const t12 = a12 + b12 / T;
  const t21 = a21 + b21 / T;
  const G12 = Math.exp(-c * t12);
  const G21 = Math.exp(-c * t21);
  const d1 = x + x2 * G21; // > 0 for any x in [0,1]
  const d2 = x2 + x * G12;
  const ln1 = x2 * x2 * (t21 * (G21 / d1) ** 2 + (t12 * G12) / (d2 * d2));
  const ln2 = x * x * (t12 * (G12 / d2) ** 2 + (t21 * G21) / (d1 * d1));
  const cap = (v: number): number => Math.min(LN_G_MAX, Math.max(-LN_G_MAX, v));
  return [Math.exp(cap(ln1)), Math.exp(cap(ln2))];
}
