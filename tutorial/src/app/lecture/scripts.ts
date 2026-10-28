// Lecture scripts (spec §3.2): data, one entry per lesson. Each step says what the scene
// shows (camera focus, cutaway, an optional card) and which inputs it sets; the caption
// is a template over the live engine results, so every number on screen comes from the
// engine and the text names the actual chemicals. Captions are plain text (textContent).
import { MIXTURES, type MixtureId } from '../../engine/mixtures';
import { solve } from '../../engine/solve';
import type { Inputs, Mode, Results } from '../../engine/types';
import { DT_MIN_CONDENSER_C, DT_MIN_REBOILER_C } from '../../engine/utilities';
import { componentName, fmtKgh, fmtKW, fmtNum, fmtTempC } from '../format';
import { defaultInputs, type PartRef } from '../state';

/** What a step sets. R may be 'nearRmin': round(1.2 Rmin + 0.05, 1) for the step's other inputs. */
export type StepSettings = Omit<Partial<Inputs>, 'R' | 'mode'> & { mode?: Mode; R?: number | 'nearRmin' };

export interface LectureStep {
  title: string;
  focus: PartRef['kind'] | 'overview';
  /**
   * Multiplier on the focus anchor's distance (default 1). A close-up whose neighbour
   * would slide under the caption pulls back until the neighbour clears it.
   */
  zoomOut?: number;
  set?: StepSettings;
  /** Cutaway state for this step (default off). */
  cutaway?: boolean;
  /** Open this part's card as the Lecture overlay. */
  openCard?: PartRef['kind'];
  caption: (r: Results, i: Inputs) => string;
}

export interface Lecture {
  id: string;
  title: string;
  /** Every step starts from this preset's default operating point. */
  mixtureId: MixtureId;
  steps: LectureStep[];
}

/** 'nearRmin': 1.2 Rmin plus a 0.05 margin, rounded to 1 dp (a low but workable reflux). */
export function nearRmin(Rmin: number): number {
  return Math.round((1.2 * Rmin + 0.05) * 10) / 10;
}

/** Inputs every step of `lecture` starts from: app defaults with the lesson's mixture preset. */
export function lectureBase(lecture: Lecture): Inputs {
  return { ...defaultInputs(), mixtureId: lecture.mixtureId, ...MIXTURES[lecture.mixtureId].defaults };
}

/**
 * The full inputs of step k, derived from the script alone (never from earlier steps),
 * so going back to a step re-applies exactly that step.
 */
export function lectureInputs(lecture: Lecture, k: number): Inputs {
  const { R, ...rest } = lecture.steps[k].set ?? {};
  const inputs: Inputs = { ...lectureBase(lecture), ...rest };
  if (typeof R === 'number') inputs.R = R;
  if (R === 'nearRmin') {
    // Rmin does not depend on R: solve these inputs at the preset R to read it.
    const r = solve(inputs);
    if (r.ok) inputs.R = nearRmin(r.Rmin);
  }
  return inputs;
}

// ---- caption helpers ---------------------------------------------------------

/** Mole fraction as a percentage: whole numbers without decimals ("95"), else 1 dp. */
const pct = (x: number): string => {
  const v = x * 100;
  return fmtNum(v, Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 1);
};
/** A reflux ratio or q as typed: 2.5, 0.6, 4 (at most 2 dp, no trailing zeros). */
const plain = (v: number): string => String(Number(v.toFixed(2)));
const pair = (id: MixtureId) => `${componentName(MIXTURES[id].light)}–${componentName(MIXTURES[id].heavy)}`;
const names = (r: Results) => ({ light: componentName(r.mixture.light), heavy: componentName(r.mixture.heavy) });
/** Temperatures are estimates (≈) in Simple mode: ideal Raoult bubble points. */
const temp = (r: Results, T_C: number) => fmtTempC(T_C, r.mode === 'simple');
const pressure = (r: Results, i: Inputs) =>
  r.mode === 'simple' || Math.abs(i.P_bar - 1.01325) < 1e-6 ? '1 atm' : `${fmtNum(i.P_bar, 2)} bar`;
const trays = (r: Results) => `${r.actualTrays} actual tray${r.actualTrays === 1 ? '' : 's'}`;

/** What the feed condition q does to the column flows. */
function qMeaning(q: number): string {
  const v = Math.round(q * 100) / 100;
  const qs = `q = ${plain(v)}`;
  if (v === 1) return `${qs}: saturated liquid at its bubble point, so the whole feed joins the liquid flowing down (L′ = L + F).`;
  if (v > 1) return `${qs}: subcooled liquid; it condenses some rising vapour as it heats up, so L′ > L + F.`;
  if (v === 0) return `${qs}: saturated vapour, so the whole feed joins the vapour rising up (V = V′ + F).`;
  if (v > 0) return `${qs}: partly vaporised; the liquid fraction q joins the downflow, the vapour 1 − q rises.`;
  return `${qs}: superheated vapour; it evaporates some liquid as it cools, so V > V′ + F.`;
}

function steamSentence(r: Results): string {
  const s = r.reboiler;
  if (!s.feasible) return `No steam level works: ${s.reason}.`;
  const at = `${s.level} steam (${fmtNum(s.P_barg, 1)} barg, ${fmtNum(s.Tsat_C, 1)} °C)`;
  const dT = `ΔT = ${fmtNum(s.dT, 1)} °C (≥ ${DT_MIN_REBOILER_C} °C needed)`;
  return s.auto
    ? `${at} is the cheapest level that still gives ${dT}.`
    : `${at} was chosen by hand; it gives ${dT}.`;
}

function coolantSentence(r: Results): string {
  const c = r.condenser;
  if (!c.feasible) return `No cooling water works: ${c.reason}.`;
  const water = c.utility === 'CW' ? 'Cooling water' : 'Chilled water';
  const approach = fmtNum(r.Ttop_C - c.out_C, 1);
  const why = `its outlet stays ${approach} °C below the condensing temperature (≥ ${DT_MIN_CONDENSER_C} °C needed)`;
  if (c.utility === 'ChW' && c.auto) return `Cooling water would come out too warm, so chilled water at ${fmtNum(c.in_C, 0)} → ${fmtNum(c.out_C, 0)} °C is used: ${why}.`;
  return `${water} at ${fmtNum(c.in_C, 0)} → ${fmtNum(c.out_C, 0)} °C works: ${why}.`;
}

/** Solve the same inputs at another R or mode (comparison captions); null if that fails. */
function solveAt(i: Inputs, patch: Partial<Inputs>): Results | null {
  const r = solve({ ...i, ...patch });
  return r.ok ? r : null;
}

// ---- the v1 lesson -----------------------------------------------------------

const MW_INTRO: Lecture = {
  id: 'mw-intro',
  title: 'Methanol–water: meet the column',
  mixtureId: 'methanol-water',
  steps: [
    {
      title: 'The column at a glance',
      focus: 'overview',
      caption: (r, i) => {
        const { light, heavy } = names(r);
        const model = r.mode === 'simple'
          ? 'Simple model: constant relative volatility and constant molar overflow.'
          : 'Advanced model: NRTL vapour–liquid equilibrium.';
        return `This column splits ${fmtKgh(i.F_kgh)} of ${light}–${heavy} feed (${pct(i.xF)} mol % ${light}) at ${pressure(r, i)} into a distillate of ${pct(i.xD)} mol % ${light} (${fmtKgh(r.D_kgh)}) and bottoms of ${pct(1 - i.xB)} mol % ${heavy} (${fmtKgh(r.B_kgh)}). ${model}`;
      },
    },
    {
      title: 'Feed and the feed condition q',
      focus: 'feed',
      cutaway: true,
      caption: (r) => {
        const { light, heavy } = names(r);
        return `The ${light}–${heavy} feed enters on tray ${r.feedTray} of ${r.actualTrays}, counted from the top: theoretical stage ${r.feedStage}, where McCabe–Thiele stepping crosses the q-line. ${qMeaning(r.q)}`;
      },
    },
    {
      title: 'Reboiler and the steam level',
      focus: 'reboiler',
      zoomOut: 1.8, // the column stands just left of the reboiler: keep it right of the caption
      caption: (r, i) => {
        const { heavy } = names(r);
        return `The kettle reboiler boils part of the bottom-tray liquid into the vapour that drives the separation (Qr = ${fmtKW(r.Qr_kW)}); the rest leaves as bottoms: ${pct(1 - i.xB)} mol % ${heavy} at ${temp(r, r.Tbot_C)}. ${steamSentence(r)}`;
      },
    },
    {
      title: 'Inside a tray',
      focus: 'tray',
      cutaway: true,
      caption: (r, i) => {
        const { light } = names(r);
        return `Liquid crosses the perforated deck, spills over the weir and falls down the downcomer to the tray below; vapour rises through the holes and bubbles through it. Each tray up is richer in ${light}: from ${pct(i.xB)} mol % in the bottoms to ${pct(i.xD)} mol % in the distillate (particle colours, bottom left).`;
      },
    },
    {
      title: 'Condenser, reflux drum and R',
      focus: 'condenser',
      caption: (r, i) =>
        `The total condenser liquefies all the top vapour at ${temp(r, r.Ttop_C)}: Qc = ${fmtKW(r.Qc_kW)}. ${coolantSentence(r)} The reflux drum returns L to the column and sends D on as product: R = L/D = ${plain(i.R)}.`,
    },
    {
      title: 'Low reflux, near Rmin',
      focus: 'column',
      set: { R: 'nearRmin' },
      cutaway: true,
      caption: (r, i) => {
        const { light, heavy } = names(r);
        return `For ${light}–${heavy}, R = ${plain(i.R)} is only ${fmtNum(i.R / r.Rmin, 2)} × Rmin (Rmin = ${fmtNum(r.Rmin, 2)}). The operating lines crowd the equilibrium curve, so the column needs ${r.N} theoretical stages (${trays(r)}), but the reboiler duty falls to ${fmtKW(r.Qr_kW)}. At Rmin itself the stage count would be infinite.`;
      },
    },
    {
      title: 'High reflux',
      focus: 'column',
      set: { R: 4 },
      cutaway: true,
      caption: (r, i) => {
        const lowR = nearRmin(r.Rmin);
        const low = solveAt(i, { R: lowR });
        const vs = low ? ` (vs ${low.actualTrays} at R = ${plain(lowR)})` : '';
        const from = low ? `, up from ${fmtKW(low.Qr_kW)}` : '';
        const { light, heavy } = names(r);
        return `At R = ${plain(i.R)} (${fmtNum(i.R / r.Rmin, 1)} × Rmin) the operating lines sit far from the ${light}–${heavy} equilibrium curve: ${r.N} theoretical stages, ${trays(r)}${vs}. But more reflux means more vapour, V = (R + 1)D, so Qr = ${fmtKW(r.Qr_kW)}${from}. Fewer trays save capital; more reflux costs energy.`;
      },
    },
    {
      title: 'Advanced mode: real equilibrium',
      focus: 'column',
      set: { mode: 'advanced' },
      cutaway: true,
      caption: (r, i) => {
        const s = solveAt(i, { mode: 'simple' });
        const a = solveAt(i, { mode: 'advanced' });
        const counts = `At R = ${plain(i.R)}: Simple N = ${s ? s.N : 'n/a'}, Advanced N = ${a ? a.N : 'n/a'} theoretical stages.`;
        const top = r.trayProfile?.[0];
        if (r.mode !== 'advanced' || !top) {
          return `Advanced mode replaces the constant relative volatility with NRTL ${componentName(r.mixture.light)}–${componentName(r.mixture.heavy)} equilibrium and gives each tray its bubble-point temperature. ${counts}`;
        }
        const { light, heavy } = names(r);
        return `Advanced mode uses NRTL ${light}–${heavy} equilibrium, and each tray temperature is the bubble point of its liquid: ${temp(r, top.T_C)} on tray 1, rising to ${temp(r, r.Tbot_C)} in the reboiler. ${counts} Simple's constant α misses how α changes with composition.`;
      },
    },
    {
      title: 'Your turn',
      focus: 'overview',
      set: { mode: 'advanced' },
      caption: (r) => {
        const { light, heavy } = names(r);
        return `Your turn: open Explore and change R, q, the purities or the tray efficiency. The ${light}–${heavy} column (${trays(r)} now) and its McCabe–Thiele diagram update live. Then try another mixture, such as ${pair('benzene-toluene')} or ${pair('ethanol-water')} (Advanced only).`;
      },
    },
  ],
};

export const LECTURES: Lecture[] = [MW_INTRO];
