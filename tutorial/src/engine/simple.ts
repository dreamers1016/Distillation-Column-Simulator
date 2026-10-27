// Simple mode (spec section 5.3): constant relative volatility, constant molar
// overflow, 1 atm. Energy uses the one self-consistent CMO convention: one
// molar latent heat lambda for the system, saturated liquid h = 0 and feed
// h_F = (1 - q) lambda, so Qc = V lambda and Qr = V' lambda close the overall
// energy balance identically. Heat loss is an explicit % on the reboiler only.
// Throws StageLimitError (from stepping / Rmin); the solve() facade maps it.
import { avgMW, internalFlows, K0, materialBalance, P_ATM_BAR, S_PER_H, trayCounts, uniqueWarnings } from './balance';
import { COMPONENTS } from './components';
import { constantAlphaCurve } from './curve';
import { fenske, rminPinch, stepStages } from './mccabe';
import { MIXTURES, type MixturePreset } from './mixtures';
import type { Inputs, Results } from './types';
import { bubblePoint } from './vle';

export interface SimpleOptions {
  /** Test-only: replace the preset's frozen simpleAlpha. */
  alphaOverride?: number;
}

export function solveSimple(inputs: Inputs, options: SimpleOptions = {}): Results {
  const mix = MIXTURES[inputs.mixtureId];
  const alpha = options.alphaOverride ?? mix.simpleAlpha;
  if (alpha === undefined) throw new Error(`${mix.name} has no Simple-mode alpha (Advanced only).`);
  const { xF, xD, xB, R, q, Eo } = inputs;

  const F = inputs.F_kgh / avgMW(mix, xF);
  const { D, B } = materialBalance(F, xF, xD, xB);
  const flows = internalFlows(R, D, F, q);

  const curve = constantAlphaCurve(alpha);
  const op = { xF, xD, xB, R, q };
  const { Rmin, pinch } = rminPinch(curve, op);
  const st = stepStages(curve, op);
  const trays = trayCounts(st.N, st.feedStage, Eo);

  // Constant molar latent heat: mean of the pure-component values at their
  // normal boiling points (kJ/mol -> kJ/kmol), the CMO assumption.
  const lam = ((COMPONENTS[mix.light].lambdaTb_kJmol + COMPONENTS[mix.heavy].lambdaTb_kJmol) / 2) * 1000;
  const Qc_kW = (flows.V * lam) / S_PER_H;
  const Qr_kW = ((flows.Vp * lam) / S_PER_H) * (1 + inputs.heatLossPct / 100);

  // Temperatures: ideal Raoult + Antoine bubble points (gamma = 1), labelled estimates.
  const idealMix: MixturePreset = { ...mix, model: 'ideal' };
  const top = bubblePoint(idealMix, xD, P_ATM_BAR);
  const bot = bubblePoint(idealMix, xB, P_ATM_BAR);

  return {
    ok: true,
    mode: 'simple',
    mixture: mix,
    F_kmolh: F,
    D_kmolh: D,
    B_kmolh: B,
    D_kgh: D * avgMW(mix, xD),
    B_kgh: B * avgMW(mix, xB),
    ...flows,
    q,
    Rmin,
    pinch,
    Nmin: fenske(alpha, xD, xB),
    NminMethod: 'fenske',
    fenskeShortcut: null,
    Nfrac: st.Nfrac,
    N: st.N,
    ...trays,
    feedStage: st.feedStage,
    stages: st.stages.map((s) => ({ ...s, T_C: null, gamma: null })),
    trayProfile: null,
    Ttop_C: top.T_K - K0,
    TtopVapour_C: null,
    Tbot_C: bot.T_K - K0,
    TtopIsEstimate: true,
    Qc_kW,
    Qr_kW,
    cmoGapPct: null,
    warnings: uniqueWarnings([...top.warnings, ...bot.warnings]),
    assumptions: [
      `Constant relative volatility α = ${alpha.toFixed(4)} (geometric mean at xD and xB)`,
      'Constant molar overflow',
      'Ideal (equilibrium) stages; overall efficiency E_o converts to actual trays',
      '1 atm, saturated-liquid reflux, total condenser',
    ],
  };
}
