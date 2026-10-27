// Shared material balances, CMO internal flows and stage-to-tray mapping
// (spec section 5.2). Flows in kmol/h, compositions = light-component mole fraction.
import { COMPONENTS } from './components';
import type { MixturePreset } from './mixtures';
import type { Warning } from './types';

/** Seconds per hour: converts kJ/h to kW. */
export const S_PER_H = 3600;
/** 0 °C in K (SI definition of the Celsius scale). */
export const K0 = 273.15;
/** 1 standard atmosphere in bar (ISO 2533 / BIPM: 101 325 Pa). */
export const P_ATM_BAR = 1.01325;

/** Average molar mass of a stream, kg/kmol. */
export function avgMW(mix: MixturePreset, x1: number): number {
  return x1 * COMPONENTS[mix.light].MW + (1 - x1) * COMPONENTS[mix.heavy].MW;
}

/** F = D + B and F xF = D xD + B xB, solved for D and B. */
export function materialBalance(F: number, xF: number, xD: number, xB: number): { D: number; B: number } {
  const D = (F * (xF - xB)) / (xD - xB);
  return { D, B: F - D };
}

/** Constant-molar-overflow flows: L = R D, V = (R+1) D, L' = L + qF, V' = V - (1-q) F. */
export function internalFlows(R: number, D: number, F: number, q: number): { L: number; V: number; Lp: number; Vp: number } {
  const L = R * D;
  const V = (R + 1) * D;
  return { L, V, Lp: L + q * F, Vp: V - (1 - q) * F };
}

// (N-1)/Eo is often an integer in exact arithmetic (e.g. 7/0.7) but lands a
// few ulps above it in floating point; ceil must not round that up.
const CEIL_TOL = 1e-9;
const ceil = (v: number): number => Math.ceil(v - CEIL_TOL);

/**
 * Stages -> trays. The partial reboiler is an equilibrium stage, the total
 * condenser is not: theoretical trays = N - 1, actual = ceil((N-1)/Eo),
 * feed tray = min(ceil(feedStage/Eo), actual trays).
 */
export function trayCounts(N: number, feedStage: number, Eo: number): { theoreticalTrays: number; actualTrays: number; feedTray: number } {
  const theoreticalTrays = N - 1;
  const actualTrays = ceil(theoreticalTrays / Eo);
  return { theoreticalTrays, actualTrays, feedTray: Math.min(ceil(feedStage / Eo), actualTrays) };
}

/** Drop exact duplicate warnings (same code and message), keeping the first. */
export function uniqueWarnings(ws: Warning[]): Warning[] {
  const seen = new Set<string>();
  return ws.filter((w) => {
    const k = `${w.code}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
