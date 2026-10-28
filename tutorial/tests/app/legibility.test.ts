// Projector legibility guards (Task 15 carried item 1): WCAG AA contrast of the secondary
// text colour, and >= 14 px secondary text at projector widths (>= 1700 px).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CARD, MUTED } from '../../src/app/charts/svg';

// Read the stylesheets as text (Vitest stubs CSS imports, even ?raw).
const css = (f: string) => readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), 'utf8');
const tokens = css('tokens.css');
const app = css('app.css');

const token = (name: string): string => {
  const m = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} missing`);
  return m[1];
};

/** WCAG 2.x relative luminance and contrast ratio. */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

/** selector -> font-size px declared inside `@media (min-width: 1700px)` blocks. */
function projectorSizes(): Map<string, number> {
  const out = new Map<string, number>();
  const re = /@media \(min-width: 1700px\) \{([\s\S]*?)\n\}/g;
  for (const block of app.matchAll(re)) {
    for (const rule of block[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const size = rule[2].match(/font-size:\s*(\d+)px/);
      if (!size) continue;
      for (const sel of rule[1].split(',')) out.set(sel.trim(), Number(size[1]));
    }
  }
  return out;
}

describe('secondary text contrast (WCAG AA 4.5:1)', () => {
  it('--muted on --paper and on --card', () => {
    expect(contrast(token('muted'), token('paper'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('muted'), token('card'))).toBeGreaterThanOrEqual(4.5);
  });
  it('chart muted text on the card', () => {
    expect(contrast(MUTED, CARD)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(MUTED, token('paper'))).toBeGreaterThanOrEqual(4.5);
  });
  it('the contrast helper matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('projector widths (>= 1700 px): secondary text >= 14 px', () => {
  const sizes = projectorSizes();
  it.each([
    '.sl-ticks',
    '.kpi small',
    '.kpi em',
    '.util-status',
    '.assumptions',
    '.compare small',
    '.pipe-legend',
    '.pipe-legend .legend-note',
    '.sec h3',
  ])('%s', (sel) => {
    expect(sizes.get(sel), `${sel} has no projector font-size`).toBeGreaterThanOrEqual(14);
  });
});
