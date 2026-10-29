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
  it('never prints a negative zero: tiny negatives and -0 read as 0 at the shown precision', () => {
    expect(fmtNum(-0)).toBe('0');
    expect(fmtNum(-0, 2)).toBe('0.00');
    expect(fmtNum(-0.004, 2)).toBe('0.00');
    expect(fmtNum(-0.0004, 3)).toBe('0.000');
    expect(fmtNum(-0.4)).toBe('0');
    expect(fmtNum(-1e-12, 1)).toBe('0.0');
    expect(fmtKW(-0.01)).toBe('0.0 kW');
    expect(fmtTempC(-0.04, false)).toBe('0.0 °C');
    // real negatives keep their sign
    expect(fmtNum(-0.006, 2)).toBe('-0.01');
    expect(fmtNum(-0.5)).toBe('-1');
    expect(fmtTempC(-12.34, false)).toBe('-12.3 °C');
    expect(fmtNum(-1234.5, 1)).toBe('-1,234.5');
  });
  it('shows mixture names with an en dash', () => {
    expect(mixtureLabel('ethanol-water')).toBe('Ethanol–Water');
    expect(mixtureLabel('hexane-heptane')).toBe('n-Hexane–n-Heptane');
  });
});
