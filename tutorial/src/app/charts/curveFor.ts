// The equilibrium curve a result was solved with, rebuilt exactly as solve() does.
import { constantAlphaCurve, vleCurve, type EquilibriumCurve } from '../../engine/curve';
import type { Inputs, Results } from '../../engine/types';

/**
 * Simple: constant-alpha curve of the mixture; Advanced: the real-VLE table at
 * the pressure the result was solved at. Call it only for an ok result, with
 * the inputs that produced it (vleCurve is cached per mixture and pressure).
 */
export function curveFor(result: Results, inputs: Pick<Inputs, 'P_bar'>): EquilibriumCurve {
  return result.mode === 'simple'
    ? constantAlphaCurve(result.mixture.simpleAlpha as number)
    : vleCurve(result.mixture, inputs.P_bar);
}
