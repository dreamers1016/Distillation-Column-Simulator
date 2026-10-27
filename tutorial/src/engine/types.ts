// Shared engine types. Units convention for all thermo functions:
// pressure in bar (absolute), temperature in K.

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
