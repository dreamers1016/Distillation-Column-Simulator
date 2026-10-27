// solve(): the single entry point of the calculation engine (plan Task 7).
// Validates the inputs, dispatches to the Simple or Advanced solver, and turns
// every failure into an { ok: false, error } result. It never throws.
//
// Validation order: composition -> UNVERIFIED -> NOT_SIMPLE -> input ranges ->
// AZEOTROPE (Advanced) -> R_BELOW_MIN. After a successful solve a non-positive
// stripping vapour V' is rejected.
import { azeotropeError, advancedQ, solveAdvanced } from './advanced';
import { constantAlphaCurve, vleCurve } from './curve';
import { rminPinch, StageLimitError } from './mccabe';
import { ALPHA_XB, ALPHA_XD, MIXTURES, type MixturePreset } from './mixtures';
import { solveSimple } from './simple';
import type { ErrorCode, Inputs, SolveResult } from './types';
import { bubblePoint, VleModelError } from './vle';

/** Pressure at which Simple-mode alpha is derived: 1 atm (ISO 2533 / BIPM: 101 325 Pa). */
const P_ALPHA_BAR = 1.01325;
/** R at or below Rmin times this is rejected as R_BELOW_MIN (tolerance on the 1e-9 bisection and the grid). */
const R_MIN_TOL = 1.0001;
/** A StageLimitError with R this close above Rmin is reported as a near-pinch case (real physics: stages -> infinity at Rmin). */
const R_NEAR_MIN = 1.05;

/** Relative volatility alpha = (y/x)/((1-y)/(1-x)) at liquid light-component fraction x, from bubblePoint. */
function alphaAt(mix: MixturePreset, x: number, P_bar: number): number {
  const y = bubblePoint(mix, x, P_bar).y1;
  return y / x / ((1 - y) / (1 - x));
}

/** Simple-mode alpha: sqrt(alpha(xD = 0.95) alpha(xB = 0.05)) at 1.01325 bar. Used by scripts/derive-simple-alpha.ts to freeze MIXTURES[*].simpleAlpha. */
export function deriveSimpleAlpha(mix: MixturePreset): number {
  return Math.sqrt(alphaAt(mix, ALPHA_XD, P_ALPHA_BAR) * alphaAt(mix, ALPHA_XB, P_ALPHA_BAR));
}

const fail = (code: ErrorCode, message: string): SolveResult => ({ ok: false, error: { code, message }, warnings: [] });

/** Numeric Inputs fields that must be finite, with a label for the message. */
function numericFields(i: Inputs): [string, unknown][] {
  return [
    ['F', i.F_kgh], ['R', i.R], ['q', i.q], ['feed temperature', i.feedT_C], ['P', i.P_bar], ['E_o', i.Eo],
    ['heat loss', i.heatLossPct], ['CW inlet', i.cw?.in_C], ['CW outlet', i.cw?.out_C], ['ChW inlet', i.chw?.in_C], ['ChW outlet', i.chw?.out_C],
  ];
}

/** Input range checks (after the composition / mixture checks). Returns a message or null. */
function rangeProblem(i: Inputs): string | null {
  for (const [name, v] of numericFields(i)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${name} must be a finite number.`;
  }
  if (!(i.Eo > 0 && i.Eo <= 1)) return `Overall tray efficiency E_o = ${i.Eo} must be greater than 0 and at most 1.`;
  if (!(i.F_kgh > 0)) return `Feed rate F = ${i.F_kgh} kg/h must be greater than 0.`;
  if (!(i.heatLossPct >= 0 && i.heatLossPct <= 15)) return `Heat loss = ${i.heatLossPct} % must be between 0 and 15 %.`;
  if (!(i.R > 0)) return `Reflux ratio R = ${i.R} must be greater than 0.`;
  if (i.mode === 'simple' && !(i.q >= -0.5 && i.q <= 1.5)) return `Feed quality q = ${i.q} must be between -0.5 and 1.5.`;
  if (i.mode === 'advanced') {
    if (!(i.P_bar >= 0.5 && i.P_bar <= 25)) return `Column pressure P = ${i.P_bar} bar must be between 0.5 and 25 bar.`;
    if (!(i.feedT_C >= -40 && i.feedT_C <= 200)) return `Feed temperature = ${i.feedT_C} °C must be between -40 and 200 °C.`;
  }
  return null;
}

function solveChecked(inputs: Inputs, state: { Rmin: number | null }): SolveResult {
  const { xB, xF, xD } = inputs;
  if (![xB, xF, xD].every((v) => typeof v === 'number') || !(xB > 0 && xB < xF && xF < xD && xD < 1)) {
    return fail('INVALID_COMPOSITION', `Compositions must satisfy 0 < xB < xF < xD < 1 (xB = ${xB}, xF = ${xF}, xD = ${xD}).`);
  }
  const mix = MIXTURES[inputs.mixtureId];
  if (!mix) return fail('OUT_OF_RANGE', `Unknown mixture "${String(inputs.mixtureId)}".`);
  if (!mix.verified) {
    return fail('UNVERIFIED', `${mix.name} is not available yet: its equilibrium data has not been verified against cited T-x-y measurements.`);
  }
  if (inputs.mode === 'simple' && !mix.simpleAllowed) {
    return fail('NOT_SIMPLE', `${mix.name} cannot be modelled with constant relative volatility; use Advanced mode.`);
  }
  const problem = rangeProblem(inputs);
  if (problem) return fail('OUT_OF_RANGE', problem);

  if (inputs.mode === 'advanced') {
    const azeo = azeotropeError(inputs);
    if (azeo) return azeo;
  }

  // Rmin before solving, with the q the solver will use.
  const curve = inputs.mode === 'simple' ? constantAlphaCurve(mix.simpleAlpha as number) : vleCurve(mix, inputs.P_bar);
  const q = inputs.mode === 'simple' ? inputs.q : advancedQ(inputs);
  const { Rmin } = rminPinch(curve, { xF, xD, xB, R: inputs.R, q });
  state.Rmin = Rmin;
  if (inputs.R <= Rmin * R_MIN_TOL) {
    return fail(
      'R_BELOW_MIN',
      `Reflux ratio R = ${inputs.R.toFixed(2)} is at or below the minimum reflux (Rmin = ${Rmin.toFixed(2)}); the separation is impossible with a finite column. Increase R above ${Rmin.toFixed(2)}.`,
    );
  }

  const result = inputs.mode === 'simple' ? solveSimple(inputs) : solveAdvanced(inputs, { azeotropeChecked: true });
  if (result.ok && !(result.Vp > 0)) {
    return fail('OUT_OF_RANGE', 'Feed too superheated for this reflux — no stripping vapour (V′ ≤ 0); lower the feed temperature or raise R');
  }
  return result;
}

/** The engine entry point. Never throws: every failure is an { ok: false } result. */
export function solve(inputs: Inputs): SolveResult {
  const state: { Rmin: number | null } = { Rmin: null };
  try {
    return solveChecked(inputs, state);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof StageLimitError) {
      if (state.Rmin !== null && inputs.R <= state.Rmin * R_NEAR_MIN) {
        return fail(
          'STAGE_LIMIT',
          `R = ${inputs.R.toFixed(2)} is very close to the minimum reflux (Rmin = ${state.Rmin.toFixed(2)}) — the column would need more than 300 stages; increase R`,
        );
      }
      return fail('STAGE_LIMIT', message);
    }
    if (e instanceof VleModelError || e instanceof RangeError) return fail('OUT_OF_RANGE', message);
    // Not an expected solver failure: still never throw, but say so plainly.
    return fail('OUT_OF_RANGE', `Unexpected solver failure: ${message}`);
  }
}
