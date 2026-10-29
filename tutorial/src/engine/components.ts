// Pure-component data for the tutorial.
//
// Units: MW g/mol; Tb_K, Tc_K in K; lambdaTb_kJmol in kJ/mol (enthalpy of
// vaporisation at the normal boiling point); cpL_JmolK / cpV_JmolK in
// J/(mol*K), evaluated at 298 K and HELD CONSTANT in the model.
//
// Sources:
//  - MW, Tb, Tc, lambda(Tb), cp: Poling, Prausnitz and O'Connell, "The
//    Properties of Gases and Liquids", 5th ed., Appendix A; NIST Chemistry
//    WebBook (https://webbook.nist.gov/chemistry/).
//  - Antoine: NIST WebBook phase-change data, form
//    log10(P/bar) = A - B / (T/K + C), valid only for Tmin_K..Tmax_K (the
//    temperature range of the NIST row quoted). Per-component URLs are in
//    `sources`; Tmin/Tmax were read from those pages.
import type { ComponentId } from './types';

export interface AntoineParams {
  A: number;
  B: number;
  C: number;
  Tmin_K: number;
  Tmax_K: number;
}

export interface ComponentData {
  name: string;
  MW: number;
  Tb_K: number;
  Tc_K: number;
  lambdaTb_kJmol: number;
  cpL_JmolK: number;
  cpV_JmolK: number;
  antoine: AntoineParams;
  sources: string;
}

const NIST = 'https://webbook.nist.gov/cgi/cbook.cgi?Mask=4&Type=ANTOINE&Plot=on&ID=';
const OTHER = 'other: Poling 5th ed. App. A / NIST WebBook';

export const COMPONENTS: Record<ComponentId, ComponentData> = {
  water: {
    name: 'Water', MW: 18.015, Tb_K: 373.15, Tc_K: 647.1, lambdaTb_kJmol: 40.66,
    cpL_JmolK: 75.3, cpV_JmolK: 33.6,
    // NIST: Bridgeman and Aldrich 1964, 344-373 K (note: 1-atm Tb of 373.15 K
    // sits 0.15 K above the quoted Tmax)
    antoine: { A: 5.08354, B: 1663.125, C: -45.622, Tmin_K: 344, Tmax_K: 373 },
    sources: `Antoine: ${NIST}C7732185 (Bridgeman and Aldrich 1964); ${OTHER}`,
  },
  methanol: {
    name: 'Methanol', MW: 32.042, Tb_K: 337.8, Tc_K: 512.6, lambdaTb_kJmol: 35.21,
    cpL_JmolK: 81.1, cpV_JmolK: 44.1,
    // NIST: Ambrose and Sprake 1970, 288.1-356.83 K
    antoine: { A: 5.20409, B: 1581.341, C: -33.5, Tmin_K: 288.1, Tmax_K: 356.83 },
    sources: `Antoine: ${NIST}C67561 (Ambrose and Sprake 1970); ${OTHER}`,
  },
  ethanol: {
    name: 'Ethanol', MW: 46.069, Tb_K: 351.4, Tc_K: 513.9, lambdaTb_kJmol: 38.56,
    cpL_JmolK: 112.3, cpV_JmolK: 65.6,
    // NIST: Ambrose and Sprake 1970, 292.77-366.63 K
    antoine: { A: 5.24677, B: 1598.673, C: -46.424, Tmin_K: 292.77, Tmax_K: 366.63 },
    sources: `Antoine: ${NIST}C64175 (Ambrose and Sprake 1970); ${OTHER}`,
  },
  isopropanol: {
    name: 'Isopropanol', MW: 60.096, Tb_K: 355.4, Tc_K: 508.3, lambdaTb_kJmol: 39.85,
    cpL_JmolK: 156.5, cpV_JmolK: 89.3,
    // NIST: Biddiscombe, Collerson et al. 1963, 329.92-362.41 K
    antoine: { A: 4.861, B: 1357.427, C: -75.814, Tmin_K: 329.92, Tmax_K: 362.41 },
    sources: `Antoine: ${NIST}C67630 (Biddiscombe et al. 1963); ${OTHER}`,
  },
  acetone: {
    name: 'Acetone', MW: 58.08, Tb_K: 329.2, Tc_K: 508.1, lambdaTb_kJmol: 29.1,
    cpL_JmolK: 125.5, cpV_JmolK: 74.5,
    // NIST: Ambrose, Sprake et al. 1974, 259.16-507.60 K
    antoine: { A: 4.42448, B: 1312.253, C: -32.445, Tmin_K: 259.16, Tmax_K: 507.6 },
    sources: `Antoine: ${NIST}C67641 (Ambrose, Sprake et al. 1974); ${OTHER}`,
  },
  benzene: {
    name: 'Benzene', MW: 78.11, Tb_K: 353.2, Tc_K: 562.0, lambdaTb_kJmol: 30.72,
    cpL_JmolK: 136.0, cpV_JmolK: 82.4,
    // NIST: Willingham, Taylor et al. 1945, 287.70-354.07 K
    antoine: { A: 4.01814, B: 1203.835, C: -53.226, Tmin_K: 287.7, Tmax_K: 354.07 },
    sources: `Antoine: ${NIST}C71432 (Willingham et al. 1945); ${OTHER}`,
  },
  toluene: {
    name: 'Toluene', MW: 92.14, Tb_K: 383.8, Tc_K: 591.8, lambdaTb_kJmol: 33.18,
    cpL_JmolK: 157.0, cpV_JmolK: 103.6,
    // NIST: Willingham, Taylor et al. 1945, 308.52-384.66 K
    antoine: { A: 4.07827, B: 1343.943, C: -53.773, Tmin_K: 308.52, Tmax_K: 384.66 },
    sources: `Antoine: ${NIST}C108883 (Willingham et al. 1945); ${OTHER}`,
  },
  propane: {
    name: 'Propane', MW: 44.1, Tb_K: 231.1, Tc_K: 369.8, lambdaTb_kJmol: 19.04,
    cpL_JmolK: 98.0, cpV_JmolK: 73.6,
    // NIST: Helgeson and Sage 1967, 277.6-360.8 K. The 1-atm boiling point
    // (231.1 K) lies OUTSIDE this range, so propane is meant for pressurised
    // columns. Use antoineInRange() to flag extrapolation.
    antoine: { A: 4.53678, B: 1149.36, C: 24.906, Tmin_K: 277.6, Tmax_K: 360.8 },
    sources: `Antoine: ${NIST}C74986 (Helgeson and Sage 1967); ${OTHER}`,
  },
  nButane: {
    name: 'n-Butane', MW: 58.12, Tb_K: 272.7, Tc_K: 425.1, lambdaTb_kJmol: 22.44,
    cpL_JmolK: 132.0, cpV_JmolK: 98.5,
    // NIST: Das, Reed et al. 1973, 272.66-425 K
    antoine: { A: 4.35576, B: 1175.581, C: -2.071, Tmin_K: 272.66, Tmax_K: 425 },
    sources: `Antoine: ${NIST}C106978 (Das, Reed et al. 1973); ${OTHER}`,
  },
  nHexane: {
    name: 'n-Hexane', MW: 86.18, Tb_K: 341.9, Tc_K: 507.6, lambdaTb_kJmol: 28.85,
    cpL_JmolK: 195.6, cpV_JmolK: 143.0,
    // NIST: Willingham, Taylor et al. 1945, 286.18-342.69 K
    antoine: { A: 4.00266, B: 1171.53, C: -48.784, Tmin_K: 286.18, Tmax_K: 342.69 },
    sources: `Antoine: ${NIST}C110543 (Willingham et al. 1945); ${OTHER}`,
  },
  nHeptane: {
    name: 'n-Heptane', MW: 100.2, Tb_K: 371.6, Tc_K: 540.2, lambdaTb_kJmol: 31.77,
    cpL_JmolK: 224.6, cpV_JmolK: 166.0,
    // NIST: Willingham, Taylor et al. 1945, 299.07-372.43 K
    antoine: { A: 4.02832, B: 1268.636, C: -56.199, Tmin_K: 299.07, Tmax_K: 372.43 },
    sources: `Antoine: ${NIST}C142825 (Willingham et al. 1945); ${OTHER}`,
  },
};
