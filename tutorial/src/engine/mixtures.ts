// Binary mixture presets. Index 1 = light component, 2 = heavy.
//
// NRTL parameters: Aspen Plus APV NRTL databank (form in activity.ts), 1 =
// organic, 2 = water. Checked 2026-10-27 against experimental T-x data at
// 101.325 kPa (methanol-water: Perry's Chemical Engineers' Handbook VLE
// tables; ethanol-water: Carey and Lewis 1932) by an independent Python
// implementation (docs/superpowers/plans/reference/nrtl.py).
// Acetone-water and isopropanol-water are verified:false until the owner
// supplies cited T-x-y data; the picker hides unverified presets.
import type { ComponentId } from './types';
import { bubblePoint } from './vle';

export type MixtureId =
  | 'methanol-water'
  | 'ethanol-water'
  | 'isopropanol-water'
  | 'acetone-water'
  | 'benzene-toluene'
  | 'hexane-heptane'
  | 'methanol-ethanol'
  | 'propane-butane';

export interface NrtlParams {
  a12: number;
  a21: number;
  b12: number;
  b21: number;
  c: number;
}

export interface MixtureDefaults {
  xF: number;
  xD: number;
  xB: number;
  R: number;
  P_bar: number;
  feedT_C: number; // feed bubble point at xF, P_bar (q = 1)
  q: number;
}

export interface MixturePreset {
  id: MixtureId;
  name: string;
  light: ComponentId;
  heavy: ComponentId;
  model: 'nrtl' | 'ideal';
  nrtl?: NrtlParams;
  simpleAllowed: boolean;
  simpleAlpha?: number;
  verified: boolean;
  defaults: MixtureDefaults;
}

type Def = Partial<Omit<MixtureDefaults, 'feedT_C' | 'q'>>;
type Base = Omit<MixturePreset, 'defaults' | 'simpleAllowed' | 'verified'> &
  Partial<Pick<MixturePreset, 'simpleAllowed' | 'verified'>>;

function make(p: Base, d: Def = {}): MixturePreset {
  const preset: MixturePreset = {
    simpleAllowed: false,
    verified: true,
    ...p,
    defaults: { xF: 0.5, xD: 0.95, xB: 0.05, R: 2.5, P_bar: 1.01325, feedT_C: 0, q: 1, ...d },
  };
  // Feed enters as saturated liquid by default: feed T = bubble point.
  preset.defaults.feedT_C = bubblePoint(preset, preset.defaults.xF, preset.defaults.P_bar).T_K - 273.15;
  return preset;
}

/**
 * Compositions (mole fraction of the light component) at which the Simple-mode
 * alpha is evaluated: the preset default product purities xD = 0.95, xB = 0.05
 * (spec 5.3: alpha is a frozen geometric mean at the preset defaults).
 */
export const ALPHA_XD = 0.95;
export const ALPHA_XB = 0.05;

// simpleAlpha values: derived by scripts/derive-simple-alpha.ts (run:
// npx vite-node scripts/derive-simple-alpha.ts), the geometric mean of
// alpha(ALPHA_XD) and alpha(ALPHA_XB) from bubblePoint at 1.01325 bar, rounded to
// 4 decimals and frozen here. tests/engine/solve.test.ts re-derives them and
// fails if a frozen value drifts by more than 1e-4.
export const MIXTURES: Record<MixtureId, MixturePreset> = {
  'methanol-water': make({
    id: 'methanol-water', name: 'Methanol - Water', light: 'methanol', heavy: 'water', model: 'nrtl',
    nrtl: { a12: -0.693, a21: 2.7322, b12: 172.987, b21: -617.269, c: 0.3 },
    simpleAllowed: true, simpleAlpha: 4.3011,
  }),
  'ethanol-water': make({
    id: 'ethanol-water', name: 'Ethanol - Water', light: 'ethanol', heavy: 'water', model: 'nrtl',
    nrtl: { a12: -0.8009, a21: 3.4578, b12: 246.18, b21: -586.0809, c: 0.3 },
  }, { xF: 0.1, xD: 0.8, xB: 0.02 }),
  'isopropanol-water': make({
    id: 'isopropanol-water', name: 'Isopropanol - Water', light: 'isopropanol', heavy: 'water', model: 'nrtl',
    nrtl: { a12: -1.3115, a21: 6.8284, b12: 426.398, b21: -1483.46, c: 0.3 },
    verified: false,
  }),
  'acetone-water': make({
    id: 'acetone-water', name: 'Acetone - Water', light: 'acetone', heavy: 'water', model: 'nrtl',
    nrtl: { a12: 0.0544, a21: 6.3981, b12: 419.972, b21: -1808.99, c: 0.3 },
    verified: false,
  }),
  'benzene-toluene': make({
    id: 'benzene-toluene', name: 'Benzene - Toluene', light: 'benzene', heavy: 'toluene', model: 'ideal',
    simpleAllowed: true, simpleAlpha: 2.4744,
  }, { R: 2.0 }),
  'hexane-heptane': make({
    id: 'hexane-heptane', name: 'n-Hexane - n-Heptane', light: 'nHexane', heavy: 'nHeptane', model: 'ideal',
    simpleAllowed: true, simpleAlpha: 2.4746,
  }),
  'methanol-ethanol': make({
    id: 'methanol-ethanol', name: 'Methanol - Ethanol', light: 'methanol', heavy: 'ethanol', model: 'ideal',
    simpleAllowed: true, simpleAlpha: 1.7232,
  }),
  'propane-butane': make({
    id: 'propane-butane', name: 'Propane - n-Butane', light: 'propane', heavy: 'nButane', model: 'ideal',
  }, { R: 3.0, P_bar: 18 }),
};
