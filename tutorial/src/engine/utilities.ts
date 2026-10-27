// Utility selection and exchanger sizing (spec section 5.6).
// Condenser: cooling water (CW) or chilled water (ChW) against an isothermal
// condensing side, sized with the log-mean temperature difference.
// Reboiler: saturated steam at a header level (LP / MP / HP), sized with
// dT = Tsat - Treb (isothermal on both sides, so no LMTD).
// An infeasible choice (auto or override) returns feasible: false with flows and
// areas set to 0, so nothing downstream is ever NaN or Infinity.
// Units: T in °C, duties kW, flows kg/h, areas m², bar gauge for steam levels.
import { P_ATM_BAR } from './balance';
import { steamSat, STEAM_LEVELS } from './steam';
import type { Inputs } from './types';

/** Liquid water cp, kJ/(kg K): standard value near 25 °C (NIST Chemistry WebBook, water). */
const CP_WATER_KJKGK = 4.18;
/** Minimum approach at the condenser coolant outlet, °C (spec 5.6; common design practice, Sinnott & Towler, Chemical Engineering Design). */
const DT_MIN_CONDENSER_C = 10;
/** Minimum steam-to-process temperature difference at the reboiler, °C (spec 5.6; Sinnott & Towler guidance for steam heating). */
const DT_MIN_REBOILER_C = 20;
/** Overall U for organic condensers against water, W/(m² K): design value inside the typical range in Sinnott & Towler (Chemical Engineering Design, typical overall coefficients table). */
const U_CONDENSER_WM2K = 800;
/** Overall U for steam reboilers on light organics/aqueous liquids, W/(m² K): design value inside the typical range in Sinnott & Towler. */
const U_REBOILER_WM2K = 1000;
/** Steam levels tried in order by the auto selection (lowest pressure first). */
const LEVELS = ['LP', 'MP', 'HP'] as const;

export type CondenserUtility = 'CW' | 'ChW' | 'REFRIGERATION';
export type ReboilerLevel = 'LP' | 'MP' | 'HP' | 'HOT_OIL';

export interface CondenserResult {
  utility: CondenserUtility;
  auto: boolean;
  feasible: boolean;
  reason: string;
  in_C: number;
  out_C: number;
  flow_kgh: number;
  LMTD: number;
  U_Wm2K: number;
  area_m2: number;
}

export interface ReboilerResult {
  level: ReboilerLevel;
  auto: boolean;
  feasible: boolean;
  reason: string;
  P_barg: number;
  Tsat_C: number;
  dT: number;
  hfg_kJkg: number;
  steam_kgh: number;
  U_Wm2K: number;
  area_m2: number;
}

const f1 = (v: number): string => v.toFixed(1);

/** LMTD for an isothermal hot side; equal terminal differences give that difference (limit of the formula). */
function lmtd(dT1: number, dT2: number): number {
  if (!(dT1 > 0 && dT2 > 0)) return 0;
  return dT1 === dT2 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
}

function condenserFor(utility: 'CW' | 'ChW', auto: boolean, Tcond_C: number, Qc_kW: number, inp: Inputs): CondenserResult {
  const { in_C, out_C } = utility === 'CW' ? inp.cw : inp.chw;
  const dT2 = Tcond_C - out_C;
  const base = { utility, auto, in_C, out_C, U_Wm2K: U_CONDENSER_WM2K };
  const fail = (reason: string): CondenserResult => ({ ...base, feasible: false, reason, flow_kgh: 0, LMTD: 0, area_m2: 0 });
  // Guards are written so that NaN fails them (never feasible).
  if (!Number.isFinite(Tcond_C) || !Number.isFinite(Qc_kW)) {
    return fail(`Tcond (${Tcond_C} °C) and duty (${Qc_kW} kW) must be finite numbers`);
  }
  if (!(out_C > in_C)) {
    return fail(`${utility} outlet ${f1(out_C)} °C must exceed inlet ${f1(in_C)} °C (Tcond ${f1(Tcond_C)} °C)`);
  }
  if (!(dT2 >= DT_MIN_CONDENSER_C)) {
    return fail(
      `Tcond ${f1(Tcond_C)} °C vs ${utility} outlet ${f1(out_C)} °C gives ΔT ${f1(dT2)} °C < ${DT_MIN_CONDENSER_C} °C minimum`,
    );
  }
  const LMTD = lmtd(Tcond_C - in_C, dT2);
  const Q = Math.max(0, Qc_kW);
  return {
    ...base,
    feasible: true,
    reason: `Tcond ${f1(Tcond_C)} °C → ${utility} ${f1(in_C)} → ${f1(out_C)} °C gives outlet ΔT ${f1(dT2)} °C ≥ ${DT_MIN_CONDENSER_C} °C`,
    flow_kgh: (Q * 3600) / (CP_WATER_KJKGK * (out_C - in_C)),
    LMTD,
    area_m2: (Q * 1000) / (U_CONDENSER_WM2K * LMTD),
  };
}

/**
 * Condenser utility for a total condenser at Tcond_C with duty Qc_kW.
 * Auto: CW if the CW outlet leaves at least the minimum approach below Tcond
 * (Tcond ≥ 50 °C with the default 30 → 40 °C), else ChW (Tcond ≥ 22 °C with the
 * default 7 → 12 °C), else REFRIGERATION (infeasible).
 */
export function selectCondenser(Tcond_C: number, Qc_kW: number, inputs: Inputs): CondenserResult {
  if (inputs.condenserUtility !== 'auto') return condenserFor(inputs.condenserUtility, false, Tcond_C, Qc_kW, inputs);
  for (const u of ['CW', 'ChW'] as const) {
    const c = condenserFor(u, true, Tcond_C, Qc_kW, inputs);
    if (c.feasible) return c;
  }
  const chwLimit = inputs.chw.out_C + DT_MIN_CONDENSER_C;
  // Say why ChW was rejected: an invalid range is not a temperature problem.
  const reason = !Number.isFinite(Tcond_C) || !Number.isFinite(Qc_kW)
    ? `Tcond (${Tcond_C} °C) and duty (${Qc_kW} kW) must be finite numbers`
    : !(inputs.chw.out_C > inputs.chw.in_C)
      ? `ChW range is invalid (outlet ${f1(inputs.chw.out_C)} °C must exceed inlet ${f1(inputs.chw.in_C)} °C) and CW is not feasible at Tcond ${f1(Tcond_C)} °C: needs refrigeration — outside this tool`
      : `Tcond ${f1(Tcond_C)} °C is below ${f1(chwLimit)} °C (ChW outlet ${f1(inputs.chw.out_C)} °C + ${DT_MIN_CONDENSER_C} °C): needs refrigeration — outside this tool`;
  return {
    utility: 'REFRIGERATION',
    auto: true,
    feasible: false,
    reason,
    in_C: 0,
    out_C: 0,
    flow_kgh: 0,
    LMTD: 0,
    U_Wm2K: U_CONDENSER_WM2K,
    area_m2: 0,
  };
}

function reboilerFor(level: 'LP' | 'MP' | 'HP', auto: boolean, Treb_C: number, Qr_kW: number): ReboilerResult {
  const P_barg = STEAM_LEVELS[level].barg;
  const { Tsat_C, hfg_kJkg } = steamSat(P_barg + P_ATM_BAR);
  const dT = Tsat_C - Treb_C;
  const base = { level, auto, P_barg, Tsat_C, dT: Number.isFinite(dT) ? dT : 0, hfg_kJkg, U_Wm2K: U_REBOILER_WM2K };
  // Guards are written so that NaN fails them (never feasible).
  if (!Number.isFinite(Treb_C) || !Number.isFinite(Qr_kW)) {
    return { ...base, feasible: false, reason: `Tbot (${Treb_C} °C) and duty (${Qr_kW} kW) must be finite numbers`, steam_kgh: 0, area_m2: 0 };
  }
  if (!(dT >= DT_MIN_REBOILER_C)) {
    return {
      ...base,
      feasible: false,
      reason: `Tbot ${f1(Treb_C)} °C → ${level} steam at ${f1(Tsat_C)} °C gives ΔT ${f1(dT)} °C < ${DT_MIN_REBOILER_C} °C minimum`,
      steam_kgh: 0,
      area_m2: 0,
    };
  }
  const Q = Math.max(0, Qr_kW);
  return {
    ...base,
    feasible: true,
    reason: `Tbot ${f1(Treb_C)} °C → ${level} steam at ${f1(Tsat_C)} °C gives ΔT ${f1(dT)} °C ≥ ${DT_MIN_REBOILER_C} °C`,
    steam_kgh: (Q * 3600) / hfg_kJkg,
    area_m2: (Q * 1000) / (U_REBOILER_WM2K * dT),
  };
}

/**
 * Reboiler steam level for a bottoms temperature Treb_C and duty Qr_kW (which
 * already includes heat loss). Auto: first of LP, MP, HP with Tsat − Treb ≥ 20 °C,
 * else HOT_OIL (infeasible: beyond the highest steam level).
 */
export function selectReboiler(Treb_C: number, Qr_kW: number, inputs: Inputs): ReboilerResult {
  if (inputs.steamLevel !== 'auto') return reboilerFor(inputs.steamLevel, false, Treb_C, Qr_kW);
  for (const l of LEVELS) {
    const r = reboilerFor(l, true, Treb_C, Qr_kW);
    if (r.feasible) return r;
  }
  const hp = steamSat(STEAM_LEVELS.HP.barg + P_ATM_BAR).Tsat_C;
  return {
    level: 'HOT_OIL',
    auto: true,
    feasible: false,
    reason: `Tbot ${f1(Treb_C)} °C is not at least ${DT_MIN_REBOILER_C} °C below HP steam at ${f1(hp)} °C: needs hot oil — outside this tool`,
    P_barg: 0,
    Tsat_C: 0,
    dT: 0,
    hfg_kJkg: 0,
    steam_kgh: 0,
    U_Wm2K: U_REBOILER_WM2K,
    area_m2: 0,
  };
}
