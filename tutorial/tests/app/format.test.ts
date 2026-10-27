import { describe, it, expect } from 'vitest';
import { fmtKW, fmtKgh, fmtTempC, fmtNum, mixtureLabel } from '../../src/app/format';

describe('format', () => {
  it('formats kW with thousands separators', () => {
    expect(fmtKW(12345.6)).toBe('12,346 kW');
    expect(fmtKW(42.84)).toBe('42.8 kW');
  });
  it('formats kg/h with thousands separators', () => {
    expect(fmtKgh(1234.4)).toBe('1,234 kg/h');
  });
  it('formats temperatures to 1 dp and prefixes estimates with ≈', () => {
    expect(fmtTempC(64.74, false)).toBe('64.7 °C');
    expect(fmtTempC(64.74, true)).toBe('≈ 64.7 °C');
  });
  it('formats plain numbers to the requested decimals', () => {
    expect(fmtNum(2.456, 2)).toBe('2.46');
  });
  it('shows mixture names with an en dash', () => {
    expect(mixtureLabel('ethanol-water')).toBe('Ethanol–Water');
    expect(mixtureLabel('hexane-heptane')).toBe('n-Hexane–n-Heptane');
  });
});
