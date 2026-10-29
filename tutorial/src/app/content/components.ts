// Component-card content (spec §6): one builder per pickable part, each returning the
// six sections (what it is, how it works, key equations, live values, typical design
// values, what goes wrong). Text is templated with the mixture's real component names;
// live values come from the engine Results (never NaN: rows that need data the mode
// does not produce say "Advanced mode only" or are left out).
//
// Equations are KaTeX sources taken from the legacy index.html COMP_INFO and corrected
// per spec §5.7: no LMTD for the kettle reboiler (ΔT = Tsat − Treb), Rmin by pinch (no
// q = 1-only Underwood form), trays = N − 1 and ⌈(N − 1)/E_o⌉, no hidden ×1.08, no R_eff.
//
// Typical design values: Sinnott & Towler, Chemical Engineering Design (tray design,
// typical overall coefficients, typical pipe velocities); Kister, Distillation Design
// and Distillation Operation (tray operation and troubleshooting); NACE SP0198 (CUI).
import { ALPHA_XB, ALPHA_XD } from '../../engine/mixtures';
import { avgMW, K0, P_ATM_BAR } from '../../engine/balance';
import { bubblePoint } from '../../engine/vle';
import { STEAM_LEVELS, steamSat } from '../../engine/steam';
import type { CondenserResult, ReboilerResult } from '../../engine/utilities';
import type { Inputs, Results } from '../../engine/types';
import type { PartRef } from '../state';
import { componentName, fmtKgh, fmtKW, fmtNum, fmtRefluxOverMin, fmtTempC, mixtureLabel } from '../format';

export type CardKind = PartRef['kind'];

/** Tray sub-meshes that the tray card's hover words highlight in 3D. */
export type TraySub = 'deck' | 'weir' | 'downcomer';

export interface Card {
  title: string;
  tag: string;
  what: string;
  how: string;
  /** KaTeX sources (display mode). */
  equations: string[];
  live: [label: string, value: string][];
  typical: [string, string][];
  problems: string[];
  /** Part this card describes (the Components page and the renderer tag the element with it). */
  kind?: CardKind;
  /** Tray cards: the true tray number whose deck / weir / downcomer the hover words light. */
  tray?: number;
}

export interface CardCtx {
  r: Results;
  /** The inputs that produced `r` (purities, E_o, pressure and feed T are inputs). */
  inputs: Inputs;
  /** Tray cards: the true tray number (1 = top). Defaults to tray 1. */
  tray?: number;
}

/** Components-page order (spec §6). */
export const CARD_ORDER: CardKind[] = [
  'column', 'tray', 'feed', 'distributor', 'sump', 'condenser', 'cwSystem',
  'refluxDrum', 'reboiler', 'steamSystem', 'skirt', 'manway', 'platform', 'nozzle',
];

// ---- shared helpers -----------------------------------------------------------

/** Molar gas constant, J/(mol K) (CODATA 2018, exact). */
const R_GAS = 8.314462618;
/** Typical tray spacing used for the illustrative height estimate, m (Sinnott & Towler: 0.45–0.6 m). */
const TYPICAL_SPACING_M = 0.6;
/** Overhead vapour velocity used for the illustrative nozzle size, m/s (typical 15–30 m/s). */
const VAPOUR_U_MS = 20;
/** Illustrative manway cover diameter, m (typical 450–600 mm). */
const MANWAY_D_M = 0.5;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const kmol = (v: number) => `${fmtNum(v, 1)} kmol/h`;
const frac = (v: number) => fmtNum(v, 3);

interface Names {
  light: string;
  heavy: string;
  Light: string;
  Heavy: string;
  pair: string;
}

function names(r: Results): Names {
  const light = componentName(r.mixture.light);
  const heavy = componentName(r.mixture.heavy);
  return { light, heavy, Light: cap(light), Heavy: cap(heavy), pair: mixtureLabel(r.mixture.id) };
}

/** "mostly water" / "mostly methanol": an absolute description tied to an actual composition. */
const richIn = (n: Names, x: number) => (x >= 0.5 ? `mostly ${n.light}` : `mostly ${n.heavy}`);

const isEstimate = (r: Results) => r.mode === 'simple' || r.TtopIsEstimate;
const temp = (r: Results, T_C: number) => fmtTempC(T_C, isEstimate(r));
/** Column pressure, bar abs: Simple mode is fixed at 1 atm. */
const pressure = (c: CardCtx) => (c.r.mode === 'simple' ? P_ATM_BAR : c.inputs.P_bar);
const Rof = (r: Results) => r.L / r.D_kmolh;

/** Simple mode: the constant α in use (always set for Simple-allowed presets). */
const alphaOf = (r: Results) => r.mixture.simpleAlpha ?? 0;

/** Sentence stating the calculation model behind the numbers on this card. */
function modelSentence(r: Results, n: Names): string {
  if (r.mode === 'simple') {
    return `Simple mode models every theoretical stage with constant α = ${fmtNum(alphaOf(r), 2)} and constant molar overflow (CMO): L and V are the same on every tray of a section.`;
  }
  const gamma =
    r.mixture.model === 'nrtl'
      ? `NRTL activity coefficients for the non-ideal ${n.light}–${n.heavy} liquid`
      : `ideal-solution activity coefficients (γ = 1) for ${n.light}–${n.heavy}`;
  return `Advanced mode uses modified Raoult's law with ${gamma}, CMO operating lines, and tray temperatures equal to the bubble point of the tray liquid.`;
}

/** Spec §5.3: methanol–water in Simple mode must say constant α is only a textbook approximation. */
function alphaCaveat(r: Results, n: Names): string {
  if (r.mode !== 'simple' || r.mixture.id !== 'methanol-water') return '';
  return ` For ${n.pair}, which is moderately non-ideal, constant α is a textbook approximation; switch to Advanced (NRTL) to compare.`;
}

function alphaRow(r: Results): [string, string][] {
  if (r.mode !== 'simple') return [];
  return [[
    'Relative volatility α (constant)',
    `${fmtNum(alphaOf(r), 2)}: geometric mean of α at x = ${ALPHA_XD} and ${ALPHA_XB} from the Advanced VLE model at 1 atm, frozen`,
  ]];
}

function qLabel(q: number): string {
  const tol = 1e-3;
  if (q > 1 + tol) return 'subcooled liquid';
  if (q >= 1 - tol) return 'saturated liquid';
  if (q > tol) return 'two-phase (part vapour)';
  if (q >= -tol) return 'saturated vapour';
  return 'superheated vapour';
}

const PINCH_LABEL: Record<Results['pinch'], string> = {
  feed: 'feed pinch: the operating lines meet on the equilibrium curve at the q-line',
  'tangent-rectifying': 'tangent pinch: the rectifying line touches the equilibrium curve',
  'tangent-stripping': 'tangent pinch: the stripping line touches the equilibrium curve',
};

const COOLANT_NAME: Record<CondenserResult['utility'], string> = {
  CW: 'cooling water',
  ChW: 'chilled water',
  REFRIGERATION: 'refrigeration',
};
const STEAM_NAME: Record<ReboilerResult['level'], string> = {
  LP: 'LP steam',
  MP: 'MP steam',
  HP: 'HP steam',
  HOT_OIL: 'hot oil',
};

const auto = (a: boolean) => (a ? ' (auto)' : ' (override)');

/** "LP 3.5 barg ≈ 148 °C, h_fg 2,120 kJ/kg" from the steam table. */
function steamLevelRow(level: keyof typeof STEAM_LEVELS): [string, string] {
  const { barg } = STEAM_LEVELS[level];
  const s = steamSat(barg + P_ATM_BAR);
  return [`${level} steam`, `${fmtNum(barg, 1)} barg ≈ ${fmtNum(s.Tsat_C, 0)} °C, h_fg ≈ ${fmtNum(s.hfg_kJkg, 0)} kJ/kg`];
}

/** Clamp a tray number to the column (tray refs carry the true number, 1 = top). */
function trayNo(c: CardCtx): number {
  const n = Math.round(c.tray ?? 1);
  return Number.isFinite(n) ? Math.min(Math.max(1, n), Math.max(1, c.r.actualTrays)) : 1;
}

// ---- cards --------------------------------------------------------------------

function column(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  const simple = r.mode === 'simple';
  return {
    title: 'Column shell',
    tag: 'Separation vessel',
    what: `The vertical pressure vessel that holds the ${r.actualTrays} sieve trays where ${n.light} and ${n.heavy} are separated by repeated vapour–liquid contact.`,
    how:
      `Vapour rises from the reboiler and liquid flows down from the reflux. On every tray the vapour arriving from below is richer in ${n.light} than the liquid it meets, and the two move towards equilibrium: the vapour grows richer in ${n.light} as it climbs and the liquid richer in ${n.heavy} as it falls, from reflux at x_D = ${frac(inputs.xD)} down to bottoms at x_B = ${frac(inputs.xB)}. ` +
      `The top runs coldest (${temp(r, r.Ttop_C)}) and the bottom hottest (${temp(r, r.Tbot_C)}). Above the feed tray is the rectifying section, below it the stripping section. ` +
      `${modelSentence(r, n)} The column diameter drawn here is illustrative only: this tool does no hydraulic (flooding) sizing.` +
      alphaCaveat(r, n),
    equations: [
      String.raw`F = D + B \qquad F\,x_F = D\,x_D + B\,x_B`,
      simple
        ? String.raw`N_{min} = \dfrac{\ln\!\left[\dfrac{x_D}{1-x_D}\cdot\dfrac{1-x_B}{x_B}\right]}{\ln\alpha}`
        : String.raw`N_{min}:\ \text{step at total reflux, } y_{n+1} = x_n,\ \text{on the real curve}`,
      String.raw`N_{\text{trays}} = N - 1 \qquad N_{\text{actual}} = \left\lceil \dfrac{N-1}{E_o} \right\rceil`,
    ],
    live: [
      ['Theoretical stages N', `${r.N} (${fmtNum(r.Nfrac, 1)} fractional), including the reboiler`],
      ['Theoretical trays N − 1', String(r.theoreticalTrays)],
      ['Actual trays', `${r.actualTrays} at E_o = ${fmtNum(inputs.Eo, 2)}`],
      ['Feed tray', `${r.feedTray}, counted from the top`],
      ['Minimum stages Nmin', `${fmtNum(r.Nmin, 1)} (${r.NminMethod === 'fenske' ? 'Fenske, constant α' : 'total-reflux stepping'})`],
      ...(r.fenskeShortcut !== null
        ? ([['Fenske shortcut (geometric-mean α)', `${fmtNum(r.fenskeShortcut, 1)}, for comparison only`]] as [string, string][])
        : []),
      ['Top / bottom temperature', `${temp(r, r.Ttop_C)} / ${temp(r, r.Tbot_C)}`],
      ['Distillate / bottoms', `${fmtKgh(r.D_kgh)} / ${fmtKgh(r.B_kgh)}`],
      ...alphaRow(r),
    ],
    typical: [
      ['Tray spacing', '0.45–0.6 m'],
      ['Overall efficiency E_o', '0.5–0.8; lower for viscous or high-α systems (O’Connell)'],
      ['Operating reflux', 'R = 1.2–1.5 × Rmin'],
      ['Diameter', 'set by flooding: about 80–85 % of flood vapour velocity (not calculated here)'],
    ],
    problems: [
      'Flooding: too much vapour or liquid; pressure drop climbs, separation collapses and liquid is carried overhead.',
      'Pressure surges (e.g. water flashing to steam in a hot column) can lift and damage tray panels.',
      'Corrosion under insulation (CUI): water trapped under the cladding corrodes a carbon-steel shell unseen, at risk between about −4 °C and 175 °C.',
      'Too optimistic an E_o leaves the column short of trays, so the products go off-spec.',
    ],
  };
}

const TRAY_TYPICAL: [string, string][] = [
  ['Tray spacing', '0.45–0.6 m'],
  ['Hole diameter', '2.5–12 mm (5 mm common)'],
  ['Hole area', 'typically 5–15 % of the active area'],
  ['Weir height', '40–90 mm (40–50 mm recommended)'],
  ['Downcomer area', 'about 10–15 % of the column cross-section'],
];
const TRAY_PROBLEMS = [
  'Jet flooding: at high vapour rates froth and spray reach the tray above, and liquid is carried up the column.',
  'Downcomer flooding: liquid backs up in the downcomer to the tray above (high liquid load or tray pressure drop).',
  'Weeping: at low vapour rates liquid drips through the holes and bypasses the contact; dumping is the extreme case, where the tray stops working.',
  'Entrainment: droplets carried upward dilute the purer liquid above and cut efficiency.',
  'Foaming: stable froth fills the tray spacing and floods early, so foaming systems need derated design loads.',
];
const TRAY_WHAT = 'A perforated steel plate on which rising vapour bubbles through a layer of liquid, bringing the two phases close to equilibrium.';
const EQ_RECT = String.raw`y_{n+1} = \dfrac{L}{V}\,x_n + \dfrac{D}{V}\,x_D`;
const EQ_STRIP = String.raw`y_{m+1} = \dfrac{L'}{V'}\,x_m - \dfrac{B}{V'}\,x_B`;
const EQ_MURPHREE = String.raw`E_{MV} = \dfrac{y_n - y_{n+1}}{y_n^{*} - y_{n+1}}`;
const eqEquilibrium = (r: Results) =>
  r.mode === 'simple' ? String.raw`y^{*} = \dfrac{\alpha\,x}{1 + (\alpha - 1)\,x}` : String.raw`y_i\,P = x_i\,\gamma_i\,P_i^{sat}(T)`;

/**
 * What happens on a tray, in relative terms. The vapour arriving from below is richer in
 * the light component than the liquid on the tray; it is NOT light-rich in absolute terms
 * (the reboiler vapour is mostly the heavy component, the reflux mostly the light one).
 */
function trayStory(n: Names, inlet: string): string {
  return (
    `${inlet} The vapour rising from below through the deck holes is richer in ${n.light} than the liquid on the tray; as it bubbles through the froth, ${n.light} moves into the vapour and ${n.heavy} into the liquid. ` +
    `So the vapour leaves richer in ${n.light} than it arrived, and the liquid leaves leaner in ${n.light}. ` +
    'The outlet weir holds the liquid depth on the deck; the liquid spills over it into the downcomer, where trapped vapour separates before the liquid reaches the tray below. Downcomers alternate sides from tray to tray.'
  );
}

/** Tray card with no tray chosen (Components page): describes both sections. */
function trayGeneric(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  return {
    title: 'Sieve tray',
    tag: 'Column internals',
    kind: 'tray',
    what: TRAY_WHAT,
    how:
      trayStory(n, 'Liquid flows across each deck: on tray 1 it comes from the reflux distributor, on every other tray from the downcomer of the tray above.') +
      ` Between trays the streams follow the rectifying operating line above the feed tray and the stripping line from the feed tray down. ${modelSentence(r, n)} ` +
      `Real trays fall short of equilibrium: at E_o = ${fmtNum(inputs.Eo, 2)}, ${r.actualTrays} actual trays do the work of ${r.theoreticalTrays} theoretical ones.` +
      alphaCaveat(r, n),
    equations: [eqEquilibrium(r), EQ_RECT, EQ_STRIP, EQ_MURPHREE],
    live: [
      ['Trays', `${r.actualTrays} actual, feed on tray ${r.feedTray}`],
      ['Rectifying flows (CMO)', `L = ${kmol(r.L)} · V = ${kmol(r.V)}`],
      ['Stripping flows (CMO)', `L′ = ${kmol(r.Lp)} · V′ = ${kmol(r.Vp)}`],
      ['Tray x, y, T and γ', r.trayProfile ? 'pick a tray in 3D to see its values' : 'Advanced mode only'],
    ],
    typical: TRAY_TYPICAL,
    problems: TRAY_PROBLEMS,
  };
}

function tray(c: CardCtx): Card {
  if (c.tray === undefined) return trayGeneric(c);
  const { r, inputs } = c;
  const n = names(r);
  const k = trayNo(c);
  const rect = k < r.feedTray;
  const section = k === r.feedTray ? 'Feed tray' : rect ? 'Rectifying section' : 'Stripping section';
  const p = r.trayProfile?.[k - 1];

  const profile: [string, string][] = [];
  if (p) {
    // T and gamma are evaluated exactly at the displayed tray liquid x (bubble point at column
    // pressure). Interpolating the stage temperatures instead differs by up to about 1.4 °C.
    const bub = bubblePoint(r.mixture, p.x, inputs.P_bar);
    const [g1, g2] = bub.gamma;
    profile.push(
      [`Liquid leaving (mole fraction ${n.light})`, `x = ${frac(p.x)}`],
      [`Vapour leaving (mole fraction ${n.light})`, `y = ${frac(p.y)}`],
      ['Tray temperature', `${fmtNum(bub.T_K - K0, 1)} °C (bubble point of x)`],
      r.mixture.model === 'nrtl'
        ? ['Activity coefficients (NRTL)', `γ ${n.light} = ${fmtNum(g1, 2)} · γ ${n.heavy} = ${fmtNum(g2, 2)}`]
        : ['Activity coefficients', 'γ = 1 (ideal solution)'],
      ['Profile', 'x, y ≈ interpolated between theoretical stages'],
    );
  } else {
    profile.push(['Tray x, y, T and γ', 'Advanced mode only']);
  }
  const inlet =
    k === 1
      ? 'Reflux from the distributor, at the distillate composition, flows across the deck of this top tray.'
      : 'Liquid leaves the downcomer of the tray above and flows across the deck.';

  return {
    title: `Tray ${k} of ${r.actualTrays} · sieve tray`,
    tag: section,
    kind: 'tray',
    tray: k,
    what: TRAY_WHAT,
    how:
      trayStory(n, inlet) +
      ` ${modelSentence(r, n)} Real trays fall short of equilibrium: at E_o = ${fmtNum(inputs.Eo, 2)}, ${r.actualTrays} actual trays do the work of ${r.theoreticalTrays} theoretical ones.` +
      alphaCaveat(r, n),
    equations: [eqEquilibrium(r), rect ? EQ_RECT : EQ_STRIP, EQ_MURPHREE],
    live: [
      ['Position', `tray ${k} of ${r.actualTrays} from the top; feed on tray ${r.feedTray}`],
      ...profile,
      rect
        ? ['Section flows (CMO)', `L = ${kmol(r.L)} · V = ${kmol(r.V)}`]
        : [k === r.feedTray ? 'Liquid leaving / vapour entering' : 'Section flows (CMO)', `L′ = ${kmol(r.Lp)} · V′ = ${kmol(r.Vp)}`],
    ],
    typical: TRAY_TYPICAL,
    problems: TRAY_PROBLEMS,
  };
}

function feed(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  const P = pressure(c);
  return {
    title: 'Feed tray and nozzle',
    tag: `Feed · tray ${r.feedTray}`,
    what: `Where the ${n.light}–${n.heavy} feed enters the column: a nozzle and internal pipe deliver it onto tray ${r.feedTray}.`,
    how:
      'The feed condition q is the fraction of the feed that joins the downflowing liquid. A saturated-liquid feed (q = 1) adds all of F to the liquid; a saturated-vapour feed (q = 0) adds it all to the vapour. Outside that range, q > 1: a subcooled feed also condenses some rising vapour; q < 0: a superheated feed vaporises some downflowing liquid. ' +
      `The best feed point is the stage where McCabe-Thiele stepping crosses the q-line: theoretical stage ${r.feedStage}, which maps to actual tray ${r.feedTray} by dividing by E_o and rounding up (capped at the tray count). ` +
      (r.mode === 'simple'
        ? 'In Simple mode q is set directly.'
        : `In Advanced mode q comes from the feed temperature and the saturated enthalpies of the ${n.light}–${n.heavy} feed at column pressure.`),
    equations: [
      String.raw`q = \dfrac{H_V - H_F}{H_V - H_L}`,
      String.raw`y = \dfrac{q}{q-1}\,x - \dfrac{x_F}{q-1}`,
      String.raw`L' = L + q\,F \qquad V' = V - (1-q)\,F`,
      String.raw`N_{\text{feed}} = \min\!\left(\left\lceil \dfrac{n_{\text{feed}}}{E_o} \right\rceil,\ N_{\text{actual}}\right)`,
    ],
    live: [
      ['Feed F', `${fmtKgh(inputs.F_kgh)} = ${kmol(r.F_kmolh)} at x_F = ${frac(inputs.xF)} ${n.light}`],
      ['Feed condition', `q = ${fmtNum(r.q, 2)} (${qLabel(r.q)})`],
      ...(r.mode === 'advanced'
        ? ([['Feed temperature', `${fmtNum(inputs.feedT_C, 1)} °C at ${fmtNum(P, 2)} bar abs`]] as [string, string][])
        : []),
      ['Feed stage → tray', `stage ${r.feedStage} → tray ${r.feedTray} of ${r.actualTrays}`],
      ['Stripping-section flows', `L′ = ${kmol(r.Lp)} · V′ = ${kmol(r.Vp)}`],
    ],
    typical: [
      ['Feed condition', 'often near q = 1; preheating (lower q) cuts reboiler duty at fixed R but needs more stages'],
      ['Feed nozzles', '2–3 alternative feed points so the feed tray can be moved in operation'],
      ['Liquid feed line velocity', '1–3 m/s'],
    ],
    problems: [
      'Wrong feed tray location: a misplaced feed wastes stages; steps bunch up near the operating-line intersection and do little separation, so more reflux or more trays are needed for the same purity.',
      'Flashing feed: a feed above its bubble point at column pressure flashes in the nozzle, causing vapour slugs, erosion and poor distribution (needs a flash-feed gallery).',
      'Feed composition or temperature swings shift q and the internal flows, and the products drift off-spec.',
    ],
  };
}

function distributor(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  const R = Rof(r);
  return {
    title: 'Reflux distributor',
    tag: 'Column internals · top',
    what: `A perforated pipe header above tray 1 that spreads the returning reflux (${richIn(n, inputs.xD)}, at the distillate composition) over the top tray.`,
    how:
      'Reflux arrives from the reflux drum as saturated liquid with the distillate composition, and is spread over the inlet area of tray 1. ' +
      'Its rate L = R·D is the only liquid source for the rectifying section, so with CMO every tray above the feed carries the same liquid flow L. ' +
      'The vapour leaving tray 1 goes to the total condenser, so it has the distillate composition too.',
    equations: [
      String.raw`L = R\,D \qquad \dfrac{L}{V} = \dfrac{R}{R+1}`,
      String.raw`x_0 = x_D \qquad y_1 = x_D \quad (\text{total condenser})`,
    ],
    live: [
      ['Reflux L', `${kmol(r.L)} ≈ ${fmtKgh(r.L * avgMW(r.mixture, inputs.xD))}`],
      ['Reflux ratio', `R = ${fmtNum(R, 2)} · ${fmtRefluxOverMin(R, r.Rmin)}`],
      ['Reflux composition', `x_D = ${frac(inputs.xD)} ${n.light}`],
      ['Reflux temperature', `${temp(r, r.Ttop_C)} (saturated liquid)`],
    ],
    typical: [
      ['Tray columns', 'a pipe to the top-tray inlet area is usually enough'],
      ['Packed columns', 'precise distributors are critical (many drip points per m²)'],
      ['Reflux condition', 'saturated here; subcooled reflux raises the internal reflux above R'],
    ],
    problems: [
      'Plugged or corroded holes cause maldistribution: poor top-tray efficiency and off-spec distillate.',
      'Subcooled reflux condenses vapour on tray 1, so the internal reflux and the duties differ from the design.',
      `Loss of reflux (empty drum, pump trip) makes the top temperature climb and ${n.heavy} break through into the distillate.`,
    ],
  };
}

function sump(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  return {
    title: 'Column sump',
    tag: 'Bottom head',
    what: `The liquid pool in the bottom head that collects the liquid leaving the bottom tray and feeds the kettle reboiler.`,
    how:
      'Liquid from the bottom tray (L′) falls into the sump and flows to the kettle reboiler. The reboiler boils part of it and returns the vapour (V′) under the bottom tray; the rest overflows the kettle weir as bottoms product (B). ' +
      'The sump hold-up keeps the reboiler and the bottoms line fed through upsets, and its level must stay below the vapour-return nozzle.',
    equations: [
      String.raw`L' = V' + B`,
      String.raw`L'\,x_{N-1} = V'\,y_N + B\,x_B \quad (\text{stage } N = \text{reboiler})`,
      String.raw`B = F - D`,
    ],
    live: [
      ['Liquid to reboiler L′', kmol(r.Lp)],
      ['Vapour return V′', kmol(r.Vp)],
      ['Bottoms B', `${kmol(r.B_kmolh)} = ${fmtKgh(r.B_kgh)} at x_B = ${frac(inputs.xB)} ${n.light}`],
      ['Bottoms temperature', temp(r, r.Tbot_C)],
    ],
    typical: [
      ['Hold-up', 'about 5–10 min of surge on the outflow'],
      ['Normal level', 'well below the vapour-return nozzle'],
      ['Outlet', 'vortex breaker on the bottoms nozzle'],
    ],
    problems: [
      'High level reaching the vapour-return nozzle: the returning vapour churns the liquid, entrains it and floods the bottom tray.',
      'Low level starves the reboiler and the bottoms pump, so the pump cavitates.',
      'Vortexing at the outlet draws vapour into the bottoms line without a vortex breaker.',
      'Foam in the sump gives false level readings.',
    ],
  };
}

function condenser(c: CardCtx): Card {
  const { r } = c;
  const n = names(r);
  const k = r.condenser;
  const coolant = COOLANT_NAME[k.utility];
  const sized: [string, string][] = k.feasible
    ? [
        ['Coolant', `${fmtNum(k.in_C, 1)} → ${fmtNum(k.out_C, 1)} °C, ${fmtKgh(k.flow_kgh)}`],
        ['Log-mean ΔT', `${fmtNum(k.LMTD, 1)} °C`],
        ['Area', `${fmtNum(k.area_m2, 1)} m² at U = ${fmtNum(k.U_Wm2K, 0)} W/m²K`],
      ]
    : [['Sizing', 'not sized: this utility choice is infeasible']];
  const vapourT = r.TtopVapour_C ?? r.Ttop_C;
  return {
    title: 'Overhead condenser',
    tag: `Shell-and-tube · total condenser · ${cap(coolant)}`,
    what: `A shell-and-tube exchanger that condenses all of the overhead vapour (${richIn(n, c.inputs.xD)}, y = x_D) to saturated liquid (a total condenser).`,
    how:
      `Overhead vapour (${temp(r, vapourT)}) enters the shell and condenses on the outside of the tubes, while the coolant flows through the tubes and warms up. ` +
      `The condensing side stays near one temperature, the distillate bubble point Tcond = ${temp(r, r.Ttop_C)}, so the driving force is the log-mean of the two end temperature differences. The condensate drains to the reflux drum. ` +
      'Selection: cooling water if Tcond is at least 10 °C above the cooling-water return, otherwise chilled water, otherwise refrigeration (outside this tool).',
    equations: [
      r.mode === 'simple' ? String.raw`Q_c = V\,\lambda` : String.raw`Q_c = V\,(H_V - h_L)`,
      String.raw`Q_c = \dot m_w\,c_{p,w}\,(T_{w,\text{out}} - T_{w,\text{in}})`,
      String.raw`Q_c = U A\,\Delta T_{lm}, \quad \Delta T_{lm} = \dfrac{(T_{\text{cond}} - T_{w,\text{in}}) - (T_{\text{cond}} - T_{w,\text{out}})}{\ln\dfrac{T_{\text{cond}} - T_{w,\text{in}}}{T_{\text{cond}} - T_{w,\text{out}}}}`,
    ],
    live: [
      ['Condenser duty Qc', fmtKW(r.Qc_kW)],
      ['Utility', `${cap(coolant)}${auto(k.auto)}`],
      ['Why', k.reason],
      ...sized,
    ],
    typical: [
      ['U, organic vapour vs water', '700–1,000 W/m²K (this tool: 800)'],
      ['U, aqueous vapour vs water', '1,000–1,500 W/m²K'],
      ['Cooling water', '30 → 40 °C here; return kept below about 45–50 °C to limit scaling'],
      ['Approach', 'at least 10 °C between Tcond and the coolant outlet'],
    ],
    problems: [
      'Fouling (scale or biofilm on the water side) lowers U, so the column pressure rises.',
      'Non-condensables (air leaks, dissolved gas) blanket the tubes and cut condensing; they must be vented.',
      'Loss of cooling: vapour stops condensing, column pressure rises quickly and the relief valve may lift.',
    ],
  };
}

function cwSystem(c: CardCtx): Card {
  const { r, inputs } = c;
  const k = r.condenser;
  const coolant = COOLANT_NAME[k.utility];
  const flow: [string, string][] = k.feasible
    ? [['Coolant flow', `${fmtKgh(k.flow_kgh)} ≈ ${fmtNum(k.flow_kgh / 1000, 1)} m³/h, ${fmtNum(k.in_C, 1)} → ${fmtNum(k.out_C, 1)} °C`]]
    : [['Coolant flow', 'none: this utility choice is infeasible']];
  return {
    title: 'Cooling / chilled water system',
    tag: `Utility circuit · ${cap(coolant)}`,
    what: "The utility loop that carries the condenser's heat away: cooling water from a cooling tower, or chilled water from a chiller when the overhead is too cold for cooling water.",
    how:
      'Water is pumped from the supply header through the condenser tubes and returns warmer. A cooling tower rejects that heat to the air, mostly by evaporating a little of the water; chilled water needs a compressor-driven chiller and costs far more per kW removed. ' +
      `The condenser needs Tcond at least 10 °C above the coolant return; here Tcond = ${temp(r, r.Ttop_C)}.`,
    equations: [
      String.raw`\dot m_w = \dfrac{Q_c}{c_{p,w}\,(T_{w,\text{out}} - T_{w,\text{in}})}`,
      String.raw`T_{\text{cond}} \ge T_{w,\text{out}} + \Delta T_{min}, \quad \Delta T_{min} = 10\ \text{K}`,
    ],
    live: [
      ['Selected', `${cap(coolant)}${auto(k.auto)}`],
      ['Why', k.reason],
      ...flow,
      ['Cooling water works if', `Tcond ≥ ${fmtNum(inputs.cw.out_C + 10, 1)} °C`],
      ['Chilled water works if', `Tcond ≥ ${fmtNum(inputs.chw.out_C + 10, 1)} °C`],
    ],
    typical: [
      ['Cooling water', '30 → 40 °C (tool default)'],
      ['Chilled water', '7 → 12 °C'],
      ['c_p of water', '4.18 kJ/(kg K)'],
      ['Cost', 'chilled water costs many times more than cooling water per kW'],
    ],
    problems: [
      'Cooling-water supply temperature rises in summer or with a fouled tower: less ΔT, more flow, and the condenser can run out of capacity.',
      'Without water treatment the circuit scales, corrodes and grows biofilm (and Legionella in the tower).',
      'Using chilled water where cooling water would do wastes money: chiller power is the main operating cost.',
      'A tripped cooling-water pump means loss of condensing within seconds.',
    ],
  };
}

function refluxDrum(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  const R = Rof(r);
  return {
    title: 'Reflux drum',
    tag: 'Accumulator',
    what: `A horizontal vessel that collects the condensed overhead liquid (${richIn(n, inputs.xD)}) and splits it into reflux and distillate product.`,
    how:
      'Condensate drains in from the condenser and the drum inventory buffers the flows. The reflux ratio sets the split: L = R·D returns to the top of the column (by gravity in this layout) and D leaves as product. ' +
      'Raising R moves the operating lines away from the equilibrium curve: fewer stages, but more vapour V = (R + 1)D and so higher condenser and reboiler duties. ' +
      'At the minimum reflux R_min an operating line touches the equilibrium curve (a pinch) and no number of stages gives the separation. (x_p, y_p) is where the two operating lines meet on the q-line at R_min; for a feed pinch that point lies on the equilibrium curve. For a tangent pinch the touching point is elsewhere: where an operating line is tangent to the equilibrium curve, not the q-line intersection.',
    equations: [
      String.raw`R = \dfrac{L}{D} \qquad V = L + D = (R+1)\,D`,
      String.raw`\dfrac{R_{min}}{R_{min}+1} = \dfrac{x_D - y_p}{x_D - x_p}`,
    ],
    live: [
      ['Reflux ratio', `R = ${fmtNum(R, 2)} · ${fmtRefluxOverMin(R, r.Rmin)}`],
      ['Minimum reflux Rmin', r.Rmin > 0 ? `${fmtNum(r.Rmin, 2)}: ${PINCH_LABEL[r.pinch]}` : 'none: the operating lines clear the equilibrium curve even at R → 0'],
      ['Reflux L / distillate D', `${kmol(r.L)} / ${kmol(r.D_kmolh)}`],
      ['Distillate', `${fmtKgh(r.D_kgh)} at x_D = ${frac(inputs.xD)} ${n.light}`],
      ['Vapour to condenser V', kmol(r.V)],
    ],
    typical: [
      ['R / Rmin', '1.2–1.5'],
      ['Hold-up', 'about 5–10 min of total outflow, drum about half full'],
      ['Shape', 'horizontal, length/diameter about 3 (2–5)'],
    ],
    problems: [
      'High level backs liquid into the condenser: lost condensing area and rising column pressure.',
      'Low level starves the reflux pump (where one is used): cavitation and loss of reflux.',
      'Poor level control swings the reflux rate, and the top temperature and distillate purity swing with it.',
      'Non-condensables collect in the drum and must be vented.',
    ],
  };
}

function reboiler(c: CardCtx): Card {
  const { r, inputs } = c;
  const n = names(r);
  const b = r.reboiler;
  const steam = STEAM_NAME[b.level];
  const steamRow: [string, string] =
    b.level === 'HOT_OIL'
      ? ['Heating medium', `none of LP, MP or HP steam is hot enough${auto(b.auto)}`]
      : ['Steam', `${steam}${auto(b.auto)}: ${fmtNum(b.P_barg, 1)} barg, Tsat ${fmtNum(b.Tsat_C, 1)} °C`];
  const sized: [string, string][] = b.feasible
    ? [
        ['ΔT = Tsat − Treb', `${fmtNum(b.Tsat_C, 1)} − ${fmtNum(r.Tbot_C, 1)} = ${fmtNum(b.dT, 1)} °C`],
        ['Steam flow', `${fmtKgh(b.steam_kgh)} (h_fg = ${fmtNum(b.hfg_kJkg, 0)} kJ/kg)`],
        ['Area', `${fmtNum(b.area_m2, 1)} m² at U = ${fmtNum(b.U_Wm2K, 0)} W/m²K`],
      ]
    : [['Sizing', 'not sized: this heating choice is infeasible']];
  const loss = String.raw`\,(1 + f_{\text{loss}})`;
  return {
    title: 'Kettle reboiler',
    tag: `Kettle · ${b.level === 'HOT_OIL' ? 'needs hot oil' : steam}`,
    what: `A kettle-type exchanger that boils part of the bottoms liquid (${richIn(n, inputs.xB)}) to make the vapour that drives the column.`,
    how:
      `Liquid from the sump fills the shell and covers the U-tube bundle. Steam condenses inside the tubes and the liquid boils on the outside at ${temp(r, r.Tbot_C)}. ` +
      'The vapour (V′) returns to the column under the bottom tray; the liquid that overflows the weir leaves as bottoms product. ' +
      'Both sides change phase at constant temperature, so the driving force is simply ΔT = Tsat − Treb, not a log-mean. ' +
      'The kettle is a partial reboiler: its vapour and liquid leave in equilibrium, so it counts as theoretical stage N. Auto selection picks the cheapest steam level with ΔT ≥ 20 °C.',
    equations: [
      r.mode === 'simple'
        ? String.raw`Q_r = V'\,\lambda` + loss
        : String.raw`Q_r = \left(Q_c + D\,h_D + B\,h_B - F\,h_F\right)` + loss,
      String.raw`\dot m_s = \dfrac{Q_r}{h_{fg}(P_s)}`,
      String.raw`Q_r = U A\,\Delta T, \quad \Delta T = T_{\text{sat}} - T_{\text{reb}}`,
    ],
    live: [
      ['Reboiler duty Qr', `${fmtKW(r.Qr_kW)} (heat loss ${fmtNum(inputs.heatLossPct, 1)} %)`],
      steamRow,
      ['Why', b.reason],
      ...sized,
      ...(r.cmoGapPct !== null
        ? ([['CMO consistency', `energy-balance Qr differs from V′·λ(bottom) by ${fmtNum(r.cmoGapPct, 1)} %`]] as [string, string][])
        : []),
    ],
    typical: [
      ['U, steam vs aqueous liquid', '1,000–1,500 W/m²K (this tool: 1,000)'],
      ['U, steam vs light organics', '900–1,200 W/m²K'],
      steamLevelRow('LP'),
      steamLevelRow('MP'),
      steamLevelRow('HP'),
      ['ΔT', 'at least 20 °C; designers limit the heat flux rather than add more ΔT'],
    ],
    problems: [
      'Fouling on the boiling side (scale, polymer, solids) lowers U and the duty falls.',
      'Excessive ΔT pushes boiling past the critical heat flux into film boiling: a vapour blanket insulates the tubes and the duty drops.',
      'Steam trap failure: stuck shut, condensate floods the tubes and the duty falls; stuck open, live steam blows into the condensate system.',
      'Low level uncovers the tube bundle: dry tubes foul quickly and less vapour is produced.',
    ],
  };
}

function steamSystem(c: CardCtx): Card {
  const { r } = c;
  const b = r.reboiler;
  const steam = STEAM_NAME[b.level];
  const live: [string, string][] =
    b.level === 'HOT_OIL'
      ? [['Selected', 'none: hot oil or a fired heater is needed (outside this tool)']]
      : [
          ['Selected', `${steam}${auto(b.auto)}`],
          ['Header', `${fmtNum(b.P_barg, 1)} barg = ${fmtNum(b.P_barg + P_ATM_BAR, 2)} bar abs`],
          ['Tsat / h_fg', `${fmtNum(b.Tsat_C, 1)} °C / ${fmtNum(b.hfg_kJkg, 0)} kJ/kg`],
          ['Steam flow', b.feasible ? fmtKgh(b.steam_kgh) : 'none: this level is not hot enough'],
        ];
  return {
    title: 'Steam system',
    tag: 'Utility circuit',
    what: 'The plant steam headers and condensate return that supply heat to the reboiler.',
    how:
      'Saturated steam from the selected header enters the reboiler tubes, gives up its latent heat h_fg as it condenses at Tsat, and leaves as condensate through a steam trap back to the boiler house. ' +
      'Higher-pressure steam is hotter but costs more and carries less latent heat per kg, so the lowest level that gives ΔT ≥ 20 °C is chosen. Steam properties come from IAPWS-IF97 steam tables.',
    equations: [
      String.raw`\dot m_s = \dfrac{Q_r}{h_{fg}(P_s)}`,
      String.raw`T_{\text{sat}}(P_s) - T_{\text{reb}} \ge 20\ \text{K}`,
    ],
    live: [...live, ['Why', b.reason]],
    typical: [steamLevelRow('LP'), steamLevelRow('MP'), steamLevelRow('HP'), ['Choice', 'cheapest (lowest) level with ΔT ≥ 20 °C']],
    problems: [
      'Steam trap failure: blowing traps waste steam; blocked traps waterlog the reboiler.',
      'Water hammer when condensate collects in steam or return lines and is slammed by steam.',
      'Header pressure dips when other users draw steam: Tsat falls and the reboiler duty drops.',
      'Tube leak: steam is normally at the higher pressure, so steam and water leak into the process side. Process fluid contaminates the condensate only if the process pressure is higher (e.g. propane–butane at 18 bar abs against MP steam) or the steam is throttled at turndown; that condensate must be dumped, not returned as boiler feed.',
    ],
  };
}

function skirt(c: CardCtx): Card {
  const { r } = c;
  const n = names(r);
  return {
    title: 'Skirt',
    tag: 'Mechanical · support',
    what: "The cylindrical steel support welded to the bottom head that carries the column's weight and wind load down to the foundation.",
    how:
      'The skirt stands on a base ring held to the concrete by anchor bolts. It also lifts the column so the bottoms line gets static head: ' +
      `the bottoms (${richIn(n, c.inputs.xB)}) are liquid at their bubble point (${temp(r, r.Tbot_C)}), so the pump's net positive suction head comes almost entirely from elevation. Access openings and vents allow inspection and stop flammable vapour collecting inside.`,
    equations: [
      String.raw`\text{NPSH}_A = \dfrac{P - P^{sat}}{\rho\,g} + h_s - h_f \;\approx\; h_s - h_f \quad (P = P^{sat})`,
      String.raw`\sigma = \dfrac{W}{\pi D t}`,
    ],
    live: [
      ['Bottoms', `${fmtKgh(r.B_kgh)} at ${temp(r, r.Tbot_C)} (saturated liquid)`],
      ['Trays carried', String(r.actualTrays)],
    ],
    typical: [
      ['Skirt thickness', 'at least 6 mm'],
      ['Height', 'set by bottoms-pump NPSH and reboiler piping (several metres)'],
      ['Anchor bolts', 'in multiples of 4 on a base ring'],
    ],
    problems: [
      'Corrosion at the skirt-to-head weld and under cracked fireproofing that traps water.',
      'Anchor-bolt corrosion or loss of preload.',
      'Thermal fatigue where the hot bottom head meets the cooler skirt.',
      'Too few vents let flammable vapour collect inside the skirt.',
    ],
  };
}

function manway(c: CardCtx): Card {
  const P = pressure(c);
  const dP = P - P_ATM_BAR;
  const kN = (dP * 1e5 * Math.PI * MANWAY_D_M ** 2) / 4 / 1000;
  const load =
    Math.abs(dP) < 0.005
      ? '≈ 0 kN (atmospheric column)'
      : `${fmtNum(Math.abs(kN), 1)} kN ${dP > 0 ? 'outward' : 'inward (vacuum)'}`;
  return {
    title: 'Manways',
    tag: 'Mechanical · access',
    what: 'Bolted, gasketed openings in the shell, with removable tray manways inside, that let people enter for inspection and maintenance.',
    how:
      'Each manway is a flanged nozzle closed by a blind cover on a davit or hinge; inside, removable tray panels make a path down through the trays. ' +
      `Manways sit every several trays, usually beside a platform, and every cover must hold the column pressure: here ${fmtNum(P, 2)} bar abs.`,
    equations: [String.raw`F_{\text{cover}} = (P - P_{\text{atm}})\,\dfrac{\pi d^2}{4}`],
    live: [
      ['Column pressure', `${fmtNum(P, 2)} bar abs = ${fmtNum(dP, 2)} barg`],
      [`Pressure load on a ${fmtNum(MANWAY_D_M * 1000, 0)} mm cover`, load],
    ],
    typical: [
      ['Shell manway', '450–600 mm (18–24 in) nominal'],
      ['Spacing', 'often every 10–20 trays, plus at the top, bottom and feed'],
    ],
    problems: [
      'Gasket leaks after reassembly: wrong gasket, uneven bolt torque or damaged flange faces.',
      'Tray manways left unbolted after a turnaround let vapour bypass the trays.',
      'Confined-space entry: the column must be isolated (blinded), purged and gas-tested before anyone goes in.',
    ],
  };
}

function platform(c: CardCtx): Card {
  const { r } = c;
  const H = Math.max(0, r.actualTrays - 1) * TYPICAL_SPACING_M;
  return {
    title: 'Platforms and ladder',
    tag: 'Mechanical · access',
    what: 'Steel walkways with handrails, clipped to the shell, and the ladder that links them, giving access to manways, valves and instruments.',
    how:
      'Platforms sit at the manways, at nozzles and valves that need operating, and at the top for the relief valve and davit. ' +
      `How many are needed grows with column height, which is set by the actual tray count: ${r.actualTrays} trays here.`,
    equations: [String.raw`H \approx (N_{\text{actual}} - 1)\,S + H_{\text{top}} + H_{\text{bottom}}`],
    live: [
      ['Actual trays', String(r.actualTrays)],
      ['Tray-section height', `≈ ${fmtNum(H, 1)} m at S = ${fmtNum(TYPICAL_SPACING_M, 1)} m (illustrative)`],
    ],
    typical: [
      ['Handrail', 'about 1.1 m high (42 in) with a toe board'],
      ['Ladder', 'cage or fall-arrest system, with rest platforms at intervals'],
    ],
    problems: [
      'Corrosion at the platform clips welded to the shell, where water enters the insulation (CUI).',
      'Missing toe boards or loose grating: dropped objects and falls.',
      'No access to a valve or instrument that needs regular operation.',
    ],
  };
}

function nozzle(c: CardCtx): Card {
  const { r } = c;
  const n = names(r);
  const P = pressure(c);
  const T = r.TtopVapour_C ?? r.Ttop_C;
  const Q = ((r.V * 1000) / 3600) * R_GAS * (T + K0) / (P * 1e5); // m³/s, ideal gas
  const d_mm = Math.sqrt((4 * Q) / (Math.PI * VAPOUR_U_MS)) * 1000;
  return {
    title: 'Nozzles',
    tag: 'Mechanical · connections',
    what: 'Flanged pipe connections through the shell: overhead vapour, reflux, feed, reboiler vapour return and bottoms.',
    how:
      'Each nozzle is sized for its stream: vapour lines run fast and are large, liquid lines run slow. ' +
      `The overhead nozzle carries V = ${kmol(r.V)} of overhead vapour (${richIn(n, c.inputs.xD)}); its volume flow follows from the ideal-gas law at the top temperature and column pressure.`,
    equations: [String.raw`Q_V = \dfrac{V\,R_g\,T}{P}`, String.raw`d = \sqrt{\dfrac{4\,Q_V}{\pi\,u}}`],
    live: [
      ['Overhead vapour', `${kmol(r.V)} ≈ ${fmtNum(Q, 3)} m³/s at ${temp(r, T)}, ${fmtNum(P, 2)} bar abs`],
      [`Overhead nozzle at u = ${VAPOUR_U_MS} m/s`, `d ≈ ${fmtNum(d_mm, 0)} mm`],
      ['Bottoms nozzle', fmtKgh(r.B_kgh)],
    ],
    typical: [
      ['Vapour lines', '15–30 m/s'],
      ['Pumped liquid', '1–3 m/s'],
      ['Gravity liquid (e.g. reflux)', 'about 0.5 m/s'],
    ],
    problems: [
      'Piping loads from thermal expansion overstress a nozzle: flange leaks or cracking at the shell.',
      'Erosion at the feed nozzle from a flashing feed.',
      'Vortexing at the bottoms nozzle without a vortex breaker.',
      'Flange gasket leaks: re-check bolt torque after the first heat-up.',
    ],
  };
}

const withKind = (kind: CardKind, build: (c: CardCtx) => Card) => (c: CardCtx): Card => ({ ...build(c), kind });

export const CARD_CONTENT: Record<CardKind, (ctx: CardCtx) => Card> = {
  column: withKind('column', column),
  tray: withKind('tray', tray),
  feed: withKind('feed', feed),
  distributor: withKind('distributor', distributor),
  sump: withKind('sump', sump),
  condenser: withKind('condenser', condenser),
  cwSystem: withKind('cwSystem', cwSystem),
  refluxDrum: withKind('refluxDrum', refluxDrum),
  reboiler: withKind('reboiler', reboiler),
  steamSystem: withKind('steamSystem', steamSystem),
  skirt: withKind('skirt', skirt),
  manway: withKind('manway', manway),
  platform: withKind('platform', platform),
  nozzle: withKind('nozzle', nozzle),
};

/** The card for a picked part. */
export function cardFor(part: PartRef, ctx: Omit<CardCtx, 'tray'>): Card {
  return CARD_CONTENT[part.kind]({ ...ctx, tray: part.tray });
}

