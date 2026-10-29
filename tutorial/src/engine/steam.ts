// Saturated steam properties from the IAPWS-IF97 saturation tables
// (IAPWS R7-97(2012), Revised Release on the IAPWS Industrial Formulation 1997;
// the tabulated values below are the pinned Task 2 table, 1.01325 to 50 bar abs).
// Tsat is interpolated linearly in ln P between nodes; h_fg is interpolated
// linearly in P. Inputs outside [1.01325, 50] bar abs (and NaN) throw RangeError.
// Units: bar absolute in, °C and kJ/kg out.

const P_MIN_BAR = 1.01325;
const P_MAX_BAR = 50;

// Pinned table nodes (bar abs). Each index i describes the same state in all three arrays.
const P_NODES_BAR = [1.01325, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50] as const;
const TSAT_C = [100.0, 120.21, 133.52, 143.61, 151.83, 158.83, 170.41, 179.88, 187.96, 198.29, 212.38, 233.85, 250.35, 263.94] as const;
const HFG_KJKG = [2256.5, 2201.6, 2163.5, 2133.4, 2107.4, 2085.8, 2047.5, 2013.6, 1985.4, 1946.4, 1888.6, 1794.9, 1712.9, 1639.6] as const;

/** Steam header design levels: gauge pressures in bar (barg). */
export const STEAM_LEVELS = {
  LP: { barg: 3.5 },
  MP: { barg: 10 },
  HP: { barg: 40 },
} as const;

/** Index i of the table segment [P_i, P_{i+1}] that contains P (last segment for P at the top node). */
function segmentIndex(P_bar: number): number {
  let i = 0;
  while (i < P_NODES_BAR.length - 2 && P_bar > P_NODES_BAR[i + 1]) i++;
  return i;
}

/** Linear blend a -> b with fraction t in [0, 1]; exact at both endpoints. */
const blend = (a: number, b: number, t: number): number => (1 - t) * a + t * b;

/**
 * Saturated steam at absolute pressure P_bar_abs.
 * Returns the saturation temperature (°C) and latent heat of vaporisation (kJ/kg).
 */
export function steamSat(P_bar_abs: number): { Tsat_C: number; hfg_kJkg: number } {
  if (!(P_bar_abs >= P_MIN_BAR && P_bar_abs <= P_MAX_BAR)) {
    throw new RangeError(
      `steamSat: P = ${P_bar_abs} bar abs is outside the IAPWS-IF97 table range ${P_MIN_BAR}-${P_MAX_BAR} bar abs`,
    );
  }
  const i = segmentIndex(P_bar_abs);
  const p0 = P_NODES_BAR[i];
  const p1 = P_NODES_BAR[i + 1];
  const tLog = (Math.log(P_bar_abs) - Math.log(p0)) / (Math.log(p1) - Math.log(p0));
  const tLin = (P_bar_abs - p0) / (p1 - p0);
  return {
    Tsat_C: blend(TSAT_C[i], TSAT_C[i + 1], tLog),
    hfg_kJkg: blend(HFG_KJKG[i], HFG_KJKG[i + 1], tLin),
  };
}
