// McCabe-Thiele stage stepping, minimum reflux (pinch) and minimum stages.
// Compositions are mole fractions of the light component; the operating lines
// assume constant molar overflow. Conventions (matched to the independent
// Python reference, docs/superpowers/plans/reference/ref.py and adv.py):
//  * step from the top, y1 = xD, x_n = xStar(y_n);
//  * the feed stage is the first stage with x_n <= x of the q-line / operating
//    line intersection; the rectifying line is used while x > x_intersect;
//  * fractional stages Nfrac = (N-1) + (x_{N-1} - xB)/(x_{N-1} - x_N), x_0 = xD.
import type { EquilibriumCurve } from './curve';

export interface ColumnOp {
  xF: number;
  xD: number;
  xB: number;
  R: number;
  q: number;
}
export interface Stage {
  n: number;
  x: number;
  y: number;
}
export interface StageResult {
  Nfrac: number;
  N: number;
  feedStage: number;
  stages: Stage[];
}

export const MAX_STAGES = 300;

/** Stage stepping cannot finish: more than 300 stages, a pinch, or an unreachable composition. */
export class StageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageLimitError';
  }
}

const Q_ONE_TOL = 1e-12;
const GAP_MARGIN = 1e-9; // an operating line must clear y* by more than this
const PINCH_POINTS = 400;
const R_MAX = 100;
const R_TOL = 1e-6;

/** Intersection of the q-line and the rectifying operating line. For q = 1, x = xF. */
export function qLineIntersection(op: ColumnOp): { x: number; y: number } {
  const rs = op.R / (op.R + 1);
  const ri = op.xD / (op.R + 1);
  let x: number;
  if (Math.abs(op.q - 1) < Q_ONE_TOL) x = op.xF;
  else {
    const qs = op.q / (op.q - 1);
    const qi = -op.xF / (op.q - 1);
    x = (qi - ri) / (rs - qs);
  }
  return { x, y: rs * x + ri };
}

function checkOp(op: ColumnOp): void {
  const { xF, xD, xB, R, q } = op;
  if (![xF, xD, xB, R, q].every(Number.isFinite) || R < 0) {
    throw new StageLimitError('McCabe-Thiele: non-finite or negative input (xF, xD, xB, R, q must be finite and R >= 0).');
  }
}

/**
 * Shared stepping loop. `opLine(x)` gives the next vapour composition from the
 * liquid leaving a stage; `xFeed` is the q-line intersection x (the first stage
 * with x <= xFeed is the feed stage; pass -Infinity when there is no feed).
 */
function stepFrom(
  curve: EquilibriumCurve,
  xD: number,
  xB: number,
  xFeed: number,
  opLine: (x: number) => number,
  what: string,
): StageResult {
  const stages: Stage[] = [];
  let y = xD;
  let xPrev = xD;
  let feedStage = 0;
  for (let n = 1; n <= MAX_STAGES; n++) {
    const x = curve.xStar(y);
    stages.push({ n, x, y });
    if (!(x < xPrev)) {
      throw new StageLimitError(
        `${what}: stage ${n} makes no progress (x = ${x.toFixed(5)} vs ${xPrev.toFixed(5)}); the operating line meets the equilibrium curve (reflux at or below the minimum) or the composition is beyond the azeotrope.`,
      );
    }
    if (feedStage === 0 && x <= xFeed) feedStage = n;
    if (x <= xB) {
      return { Nfrac: n - 1 + (xPrev - xB) / (xPrev - x), N: n, feedStage, stages };
    }
    y = opLine(x);
    xPrev = x;
  }
  throw new StageLimitError(`${what}: more than ${MAX_STAGES} stages needed (reflux at or near the minimum, or the separation is not achievable).`);
}

/** Step off stages from the top for the given operating conditions. */
export function stepStages(curve: EquilibriumCurve, op: ColumnOp): StageResult {
  checkOp(op);
  const { xD, xB, R } = op;
  const rs = R / (R + 1);
  const ri = xD / (R + 1);
  const { x: xi, y: yi } = qLineIntersection(op);
  if (!(xi > xB && xi < xD)) {
    throw new StageLimitError(`McCabe-Thiele: the feed/q-line intersection x = ${xi.toFixed(4)} lies outside (xB, xD) = (${xB}, ${xD}).`);
  }
  const ss = (yi - xB) / (xi - xB);
  return stepFrom(curve, xD, xB, xi, (x) => (x > xi ? rs * x + ri : ss * (x - xB) + xB), `McCabe-Thiele (R = ${R})`);
}

/**
 * Minimum reflux by pinch search: the smallest R for which both operating
 * lines stay strictly below y* on 399 interior points of [xB, xD] and the
 * q-line intersection is below y*; bisection on R in [0, 100] to 1e-6. The
 * pinch is classified by where the smallest y* - y gap sits at that R.
 */
export function rminPinch(
  curve: EquilibriumCurve,
  op: ColumnOp,
): { Rmin: number; pinch: 'feed' | 'tangent-rectifying' | 'tangent-stripping' } {
  const { xF, xD, xB, q } = op;
  if (![xF, xD, xB, q].every(Number.isFinite)) throw new StageLimitError('Rmin: non-finite input.');

  // Smallest gap y* - y_op and where it is, or null if R is infeasible (the
  // intersection is outside (xB, xD) or an operating line reaches y*).
  const evaluate = (R: number): { gap: number; pinch: 'feed' | 'tangent-rectifying' | 'tangent-stripping' } | null => {
    const o = { xF, xD, xB, R, q };
    const rs = R / (R + 1);
    const ri = xD / (R + 1);
    const { x: xi, y: yi } = qLineIntersection(o);
    if (!(xi > xB && xi < xD)) return null;
    const ss = (yi - xB) / (xi - xB);
    let gap = curve.yStar(xi) - yi;
    let pinch: 'feed' | 'tangent-rectifying' | 'tangent-stripping' = 'feed';
    if (gap <= GAP_MARGIN) return null;
    for (let i = 1; i < PINCH_POINTS; i++) {
      const x = xB + ((xD - xB) * i) / PINCH_POINTS;
      if (Math.abs(x - xi) < 1e-9) continue; // the intersection itself, already measured as 'feed'
      const rect = x > xi;
      const g = curve.yStar(x) - (rect ? rs * x + ri : ss * (x - xB) + xB);
      if (g <= GAP_MARGIN) return null;
      if (g < gap) {
        gap = g;
        pinch = rect ? 'tangent-rectifying' : 'tangent-stripping';
      }
    }
    return { gap, pinch };
  };

  if (!evaluate(R_MAX)) {
    throw new StageLimitError(
      'Rmin: no finite minimum reflux; xD is at or beyond the azeotrope / equilibrium curve, or the feed is outside (xB, xD).',
    );
  }
  let lo = 0;
  let hi = R_MAX;
  while (hi - lo > R_TOL) {
    const mid = 0.5 * (lo + hi);
    if (evaluate(mid)) hi = mid;
    else lo = mid;
  }
  return { Rmin: hi, pinch: (evaluate(hi) as NonNullable<ReturnType<typeof evaluate>>).pinch };
}

/** Minimum stages at total reflux (y = x operating line), same fractional convention. */
export function nminTotalReflux(curve: EquilibriumCurve, xD: number, xB: number): number {
  if (!(Number.isFinite(xD) && Number.isFinite(xB) && xB < xD)) {
    throw new StageLimitError('Nmin: need finite xB < xD.');
  }
  return stepFrom(curve, xD, xB, -Infinity, (x) => x, 'Nmin (total reflux)').Nfrac;
}

/** Fenske equation, analytic minimum stages for constant relative volatility. */
export function fenske(alpha: number, xD: number, xB: number): number {
  return Math.log(((xD / (1 - xD)) * (1 - xB)) / xB) / Math.log(alpha);
}
