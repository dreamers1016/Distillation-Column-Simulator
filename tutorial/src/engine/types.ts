// Shared engine types. Units convention for all thermo functions:
// pressure in bar (absolute), temperature in K.
import type { MixtureId, MixturePreset } from './mixtures';

export type ComponentId =
  | 'water'
  | 'methanol'
  | 'ethanol'
  | 'isopropanol'
  | 'acetone'
  | 'benzene'
  | 'toluene'
  | 'propane'
  | 'nButane'
  | 'nHexane'
  | 'nHeptane';

export type WarningCode =
  | 'ANTOINE_RANGE'
  | 'CMO_GAP'
  | 'UTILITY'
  | 'IDEAL_VAPOUR'
  | 'DISPLAY_CAP';

export interface Warning {
  code: WarningCode;
  message: string;
}

// ---- Solver inputs and results (shared by Simple and Advanced modes) ----
// Units: flows kmol/h unless suffixed _kgh; duties kW; P bar abs; T in °C
// where suffixed _C. condenser/reboiler sizing is added by the utilities task.

export type Mode = 'simple' | 'advanced';

export interface Inputs {
  mode: Mode;
  mixtureId: MixtureId;
  F_kgh: number;
  xF: number;
  xD: number;
  xB: number;
  R: number;
  q: number; // Simple mode only (Advanced derives q from feedT_C)
  feedT_C: number; // Advanced mode only
  P_bar: number; // Advanced mode only (Simple is fixed at 1 atm)
  Eo: number; // overall tray efficiency, 0..1
  heatLossPct: number; // % of the reboiler duty, applied to the reboiler only
  condenserUtility: 'auto' | 'CW' | 'ChW';
  steamLevel: 'auto' | 'LP' | 'MP' | 'HP';
  cw: { in_C: number; out_C: number };
  chw: { in_C: number; out_C: number };
}

export interface StageRow {
  n: number;
  x: number;
  y: number;
  T_C: number | null; // bubble T of x (Advanced); null in Simple
  gamma: [number, number] | null; // activity coefficients at (x, T) (Advanced); null in Simple
}

export interface Results {
  ok: true;
  mode: Mode;
  mixture: MixturePreset;
  F_kmolh: number;
  D_kmolh: number;
  B_kmolh: number;
  D_kgh: number;
  B_kgh: number;
  L: number;
  V: number;
  Lp: number;
  Vp: number;
  q: number;
  Rmin: number;
  pinch: 'feed' | 'tangent-rectifying' | 'tangent-stripping';
  Nmin: number;
  NminMethod: 'fenske' | 'total-reflux';
  fenskeShortcut: number | null;
  Nfrac: number;
  N: number;
  theoreticalTrays: number;
  actualTrays: number;
  feedStage: number;
  feedTray: number;
  stages: StageRow[];
  trayProfile: { tray: number; x: number; y: number; T_C: number }[] | null;
  Ttop_C: number; // bubble T of xD: the condensate / reflux temperature
  TtopVapour_C: number | null; // dew T of the top vapour (y = xD), Advanced only
  Tbot_C: number; // bubble T of xB: the reboiler temperature
  TtopIsEstimate: boolean;
  Qc_kW: number;
  Qr_kW: number;
  cmoGapPct: number | null;
  warnings: Warning[];
  assumptions: string[];
}

export type ErrorCode =
  | 'INVALID_COMPOSITION'
  | 'R_BELOW_MIN'
  | 'AZEOTROPE'
  | 'NOT_SIMPLE'
  | 'UNVERIFIED'
  | 'STAGE_LIMIT'
  | 'OUT_OF_RANGE';

export type SolveResult = Results | { ok: false; error: { code: ErrorCode; message: string }; warnings: Warning[] };
