// Display formatting helpers. All numbers use en-US grouping so the
// projected slides read the same on every machine.
import { COMPONENTS } from '../engine/components';
import { MIXTURES, type MixtureId } from '../engine/mixtures';
import type { ComponentId } from '../engine/types';

const grouped = (dp: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: true });
const FMT = [grouped(0), grouped(1), grouped(2), grouped(3)];

/**
 * Plain number to `dp` decimals (0..3) with thousands separators. A value that rounds to
 * zero at that precision (a tiny negative, or -0) prints as "0", never "-0" or "-0.00".
 */
export function fmtNum(v: number, dp = 0): string {
  if (Math.abs(v) < 0.5 * 10 ** -dp) v = 0; // also turns -0 into +0
  return (FMT[dp] ?? grouped(dp)).format(v);
}

/** Duty in kW: whole kW from 100 up, one decimal below, thousands separators. */
export function fmtKW(kW: number): string {
  return `${fmtNum(kW, Math.abs(kW) >= 100 ? 0 : 1)} kW`;
}

/** Mass flow in kg/h, whole numbers with thousands separators. */
export function fmtKgh(kgh: number): string {
  return `${fmtNum(kgh, 0)} kg/h`;
}

/** Temperature in °C to 1 dp, prefixed "≈ " when it is only an estimate (Simple mode). */
export function fmtTempC(T_C: number, isEstimate: boolean): string {
  return `${isEstimate ? '≈ ' : ''}${fmtNum(T_C, 1)} °C`;
}

/** Mixture name with an en dash: "Ethanol–Water". */
export function mixtureLabel(id: MixtureId): string {
  return MIXTURES[id].name.replace(' - ', '–');
}

/** Lower-case component name for use mid-sentence: "methanol", "n-hexane". */
export function componentName(id: ComponentId): string {
  return COMPONENTS[id].name.toLowerCase();
}
