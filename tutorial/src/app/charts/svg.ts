// Minimal SVG helpers for the hand-drawn charts (no chart library).
// Text always goes in through textContent, never as markup.
const NS = 'http://www.w3.org/2000/svg';

export const INK = '#1f2a36';
export const MUTED = '#5b6570'; // 5.9:1 on the cream card
export const GRID = '#e5dccb';
export const CARD = '#fffdf8';
export const FEED = '#7b4fbf'; // matches the 3D feed pipe
export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
/**
 * Chart text size in viewBox units (charts are CHART_W = 520 units wide, drawn at the panel's
 * content width). Narrowest panel: 360 px - 32 px padding - 2 px border - a 15 px classic
 * scrollbar = 311 px, so 21 units = 12.6 px; at 1920 wide (460 px panel, 411 px content)
 * it is 16.6 px. Keep >= 12 px at every supported width (see --panel-w in tokens.css).
 */
export const FONT_SIZE = 21;
/** Width of both charts' viewBox. */
export const CHART_W = 520;
/** Rough advance width of one character at FONT_SIZE (bold system-ui), for fit checks. */
export const CHAR_W = 0.6 * FONT_SIZE;

type Attrs = Record<string, string | number | undefined>;
type Child = Node | string | null | undefined | false;

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

/** Coordinate rounded to 4 dp: 1e-4 of a viewBox unit is ~2e-7 of an axis. */
export const num = (v: number): string => String(Number(v.toFixed(4)));

export const pts = (p: readonly (readonly [number, number])[]): string => p.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');

export interface TextOpts {
  anchor?: 'start' | 'middle' | 'end';
  fill?: string;
  weight?: 'normal' | '600' | 'bold';
  rotate?: number;
  /** Card-coloured outline so a label stays legible over lines. */
  halo?: boolean;
  class?: string;
}

export function label(x: number, y: number, str: string, o: TextOpts = {}): SVGTextElement {
  return svgEl(
    'text',
    {
      x: o.rotate ? 0 : num(x),
      y: o.rotate ? 0 : num(y),
      transform: o.rotate ? `translate(${num(x)} ${num(y)}) rotate(${o.rotate})` : undefined,
      'text-anchor': o.anchor ?? 'start',
      'font-family': FONT,
      'font-size': FONT_SIZE,
      'font-weight': o.weight === 'normal' ? undefined : o.weight,
      fill: o.fill ?? INK,
      stroke: o.halo ? CARD : undefined,
      'stroke-width': o.halo ? 4 : undefined,
      'stroke-linejoin': o.halo ? 'round' : undefined,
      'paint-order': o.halo ? 'stroke' : undefined,
      class: o.class,
    },
    str,
  );
}

/** Round tick step (1, 2, 5 x 10^k) giving about `target` intervals over `range`. */
export function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}
