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
