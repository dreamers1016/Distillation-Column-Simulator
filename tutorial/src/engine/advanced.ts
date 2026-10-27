// Advanced mode (spec section 5.4): real VLE (modified Raoult's law, NRTL or
// ideal liquid, ideal vapour) at constant column pressure; stages stepped with
// CMO operating lines; q from the feed enthalpy; Qc from real enthalpies and
// Qr from the overall energy balance. Conventions match the independent
// Python reference (docs/superpowers/plans/reference/en.py, adv.py).
// Throws StageLimitError / VleModelError; the solve() facade maps them. The
// one domain error returned here is AZEOTROPE.
import { gammas } from './activity';
import { psat_bar } from './antoine';
import { avgMW, internalFlows, K0, materialBalance, S_PER_H, trayCounts, uniqueWarnings } from './balance';
import { vleCurve } from './curve';
import { hL, hV, hVsuperheated, lambdaMix } from './enthalpy';
import { fenske, nminTotalReflux, rminPinch, stepStages } from './mccabe';
import { MIXTURES, type MixturePreset } from './mixtures';
import type { Inputs, SolveResult, StageRow, Warning } from './types';
import { selectCondenser, selectReboiler } from './utilities';
import { bubblePoint, dewPoint, findAzeotrope, VleModelError } from './vle';

/** Above this pressure the ideal-vapour assumption is flagged (spec 5.4: "fine below about 10 bar"). */
const IDEAL_VAPOUR_P_BAR = 10;
/** |CMO gap| above this is flagged as a teaching point (spec 5.2). */
const CMO_GAP_WARN_PCT = 5;
const FLASH_MAX_ITER = 200;
const FLASH_TOL = 1e-12;
const FLASH_BETA_TOL = 1e-6;

/**
 * Isothermal flash of a binary feed z at T_K, P_bar between its bubble and dew
 * points. Rachford-Rice with K_i = gamma_i(x, T) Psat_i(T) / P (modified
 * Raoult, ideal vapour), gamma re-evaluated on the liquid composition by
 * successive substitution. For a binary at fixed K the RR root gives the phase
 * compositions in closed form, independent of z:
 *   x1 = (1 - K2) / (K1 - K2),  y1 = K1 x1,  beta = (z - x1) / (y1 - x1).
 * beta is clamped to [0, 1] only within rounding (feed T a hair inside the
 * bubble/dew bracket); anything else throws VleModelError.
 */
function flash(mix: MixturePreset, z: number, T_K: number, P_bar: number): { beta: number; x: number; y: number } {
  const p1 = psat_bar(mix.light, T_K) / P_bar;
  const p2 = psat_bar(mix.heavy, T_K) / P_bar;
  let x = z;
  for (let it = 0; it < FLASH_MAX_ITER; it++) {
    const [g1, g2] = gammas(mix, x, T_K);
    const K1 = g1 * p1;
    const K2 = g2 * p2;
    const xNew = Math.min(1, Math.max(0, (1 - K2) / (K1 - K2)));
    if (Math.abs(xNew - x) < FLASH_TOL) {
      const y = K1 * xNew;
      const beta = (z - xNew) / (y - xNew);
      if (Number.isFinite(beta) && beta > -FLASH_BETA_TOL && beta < 1 + FLASH_BETA_TOL) {
        return { beta: Math.min(1, Math.max(0, beta)), x: xNew, y };
      }
      break;
    }
    x = xNew;
  }
  throw new VleModelError(`${mix.name}: feed flash at ${(T_K - K0).toFixed(2)} °C, ${P_bar} bar did not converge to a two-phase state.`);
}

/** Feed enthalpy H_F (kJ/kmol) at feed T and column P, and q from saturated enthalpies. */
function feedCondition(mix: MixturePreset, xF: number, T_K: number, P: number) {
  const bub = bubblePoint(mix, xF, P);
  const dew = dewPoint(mix, xF, P);
  const HLsat = hL(mix, xF, bub.T_K);
  const HVsat = hV(mix, xF, dew.T_K);
  let HF: number;
  if (T_K <= bub.T_K) HF = hL(mix, xF, T_K); // subcooled (or saturated) liquid
  else if (T_K >= dew.T_K) HF = hVsuperheated(mix, xF, dew.T_K, T_K); // superheated (or saturated) vapour, vapour cp
  else {
    const f = flash(mix, xF, T_K, P);
    HF = (1 - f.beta) * hL(mix, f.x, T_K) + f.beta * hV(mix, f.y, T_K);
  }
  return { HF, q: (HVsat - HF) / (HVsat - HLsat) };
}

/** Relative volatility at liquid x1 from the bubble point. */
function alphaAt(mix: MixturePreset, x1: number, P: number): number {
  const y = bubblePoint(mix, x1, P).y1;
  return (y / x1) / ((1 - y) / (1 - x1));
}

export function solveAdvanced(inputs: Inputs): SolveResult {
  const mix = MIXTURES[inputs.mixtureId];
  const P = inputs.P_bar;
  const { xF, xD, xB, R, Eo } = inputs;

  const az = findAzeotrope(mix, P);
  if (az && az.x >= xB && az.x <= xD) {
    // x to 3 decimals: the NRTL azeotrope of ethanol-water is x = 0.8954, which
    // 2 decimals would print as 0.90 against the literature 0.89.
    const xa = az.x.toFixed(3);
    return {
      ok: false,
      error: {
        code: 'AZEOTROPE',
        message:
          `${mix.name} forms an azeotrope at x = ${xa}, ${(az.T_K - K0).toFixed(1)} °C at ${P} bar, ` +
          `inside the column range xB = ${xB} to xD = ${xD}. Ordinary distillation cannot cross it; set xD below ${xa}.`,
      },
      warnings: [],
    };
  }

  const curve = vleCurve(mix, P);
  const { HF, q } = feedCondition(mix, xF, inputs.feedT_C + K0, P);

  const F = inputs.F_kgh / avgMW(mix, xF);
  const { D, B } = materialBalance(F, xF, xD, xB);
  const flows = internalFlows(R, D, F, q);

  const op = { xF, xD, xB, R, q };
  const { Rmin, pinch } = rminPinch(curve, op);
  const st = stepStages(curve, op);
  const trays = trayCounts(st.N, st.feedStage, Eo);

  const stages: StageRow[] = st.stages.map((s) => {
    const b = bubblePoint(mix, s.x, P);
    return { ...s, T_C: b.T_K - K0, gamma: b.gamma };
  });

  // Tray profile: actual tray k sits at stage index s = 1 + (k - 0.5)(N - 1)/actualTrays,
  // linearly interpolated in stage index (the card states it is interpolated).
  const trayProfile = Array.from({ length: trays.actualTrays }, (_, i) => {
    const k = i + 1;
    const s = 1 + ((k - 0.5) * (st.N - 1)) / trays.actualTrays;
    const j = Math.min(Math.floor(s), st.N - 1); // lower stage, 1-based
    const t = s - j;
    const a = stages[j - 1];
    const b = stages[j];
    const lerp = (u: number, v: number): number => u + t * (v - u);
    return { tray: k, x: lerp(a.x, b.x), y: lerp(a.y, b.y), T_C: lerp(a.T_C as number, b.T_C as number) };
  });

  const top = bubblePoint(mix, xD, P); // condensate / reflux temperature
  const topVapour = dewPoint(mix, xD, P); // top vapour (y = xD) at its dew point
  const bot = bubblePoint(mix, xB, P);

  // Energy (kJ/kmol x kmol/h = kJ/h; / 3600 -> kW). Total condenser:
  // saturated top vapour -> saturated liquid distillate and reflux.
  const hD = hL(mix, xD, top.T_K);
  const hB = hL(mix, xB, bot.T_K);
  const Qc_kW = (flows.V * (hV(mix, xD, topVapour.T_K) - hD)) / S_PER_H;
  // Duty the column needs, from the overall balance F hF + Qr = D hD + B hB + Qc.
  const QrColumn_kW = Qc_kW + (D * hD + B * hB - F * HF) / S_PER_H;
  // Heat loss is lost from the reboiler, so it adds to the supplied duty only.
  const Qr_kW = QrColumn_kW * (1 + inputs.heatLossPct / 100);
  // CMO consistency: column duty vs what V' lambda_mix(bottom) implies.
  const cmoGapPct =
    Math.abs(QrColumn_kW) > 1e-9 ? ((QrColumn_kW - (flows.Vp * lambdaMix(mix, xB, bot.T_K)) / S_PER_H) / QrColumn_kW) * 100 : null;

  const alphaGM = Math.sqrt(alphaAt(mix, xD, P) * alphaAt(mix, xB, P));
  // Labelled shortcut only (invalid near an azeotrope); null when alpha <= 1.
  const fenskeShortcut = Number.isFinite(alphaGM) && alphaGM > 1 ? fenske(alphaGM, xD, xB) : null;

  const warnings: Warning[] = [...top.warnings, ...topVapour.warnings, ...bot.warnings];
  if (P > IDEAL_VAPOUR_P_BAR) {
    warnings.push({
      code: 'IDEAL_VAPOUR',
      message: `Vapour treated as ideal at ${P} bar (above ${IDEAL_VAPOUR_P_BAR} bar); no fugacity correction, so K-values are approximate.`,
    });
  }
  if (cmoGapPct !== null && Math.abs(cmoGapPct) > CMO_GAP_WARN_PCT) {
    warnings.push({
      code: 'CMO_GAP',
      message: `CMO consistency: the energy-balance reboiler duty differs from V′·λ(bottom) by ${cmoGapPct.toFixed(1)} %, mainly because the components' molar latent heats differ; the operating lines still assume constant molar overflow.`,
    });
  }

  const condenser = selectCondenser(top.T_K - K0, Qc_kW, inputs);
  const reboiler = selectReboiler(bot.T_K - K0, Qr_kW, inputs);
  for (const u of [condenser, reboiler]) if (!u.feasible) warnings.push({ code: 'UTILITY', message: u.reason });

  return {
    ok: true,
    mode: 'advanced',
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
    Nmin: nminTotalReflux(curve, xD, xB),
    NminMethod: 'total-reflux',
    fenskeShortcut,
    Nfrac: st.Nfrac,
    N: st.N,
    ...trays,
    feedStage: st.feedStage,
    stages,
    trayProfile,
    Ttop_C: top.T_K - K0,
    TtopVapour_C: topVapour.T_K - K0,
    Tbot_C: bot.T_K - K0,
    TtopIsEstimate: false,
    Qc_kW,
    Qr_kW,
    condenser,
    reboiler,
    cmoGapPct,
    warnings: uniqueWarnings(warnings),
    assumptions: [
      `Modified Raoult's law (${mix.model === 'nrtl' ? 'NRTL' : 'ideal liquid'}), ideal vapour`,
      'Constant molar overflow for the operating lines',
      'Constant column pressure (no pressure drop)',
      'Constant cp; latent heat by Watson correlation',
    ],
  };
}
