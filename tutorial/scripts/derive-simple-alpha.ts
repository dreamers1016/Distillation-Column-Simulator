// Derives the Simple-mode constant relative volatility of every Simple-allowed
// preset: alpha = sqrt(alpha(xD = 0.95) * alpha(xB = 0.05)) at 1.01325 bar, with
// alpha = (y/x)/((1-y)/(1-x)) from bubblePoint (the same VLE the Advanced mode
// uses). Paste the printed 4-decimal values into src/engine/mixtures.ts.
//
// Run from tutorial/:   npx vite-node scripts/derive-simple-alpha.ts
// (vite-node ships with vitest, so no extra dependency is needed.)
import { MIXTURES } from '../src/engine/mixtures';
import { deriveSimpleAlpha } from '../src/engine/solve';

let drift = false;
for (const m of Object.values(MIXTURES)) {
  if (!m.simpleAllowed) continue;
  const a = deriveSimpleAlpha(m);
  const frozen = m.simpleAlpha;
  const flag = frozen === undefined || Math.abs(frozen - a) > 1e-4 ? '  <-- DRIFT: update mixtures.ts' : '';
  if (flag) drift = true;
  console.log(`${m.id.padEnd(18)} derived ${a.toFixed(4)} (${a.toPrecision(8)})  frozen ${frozen}${flag}`);
}
if (drift) throw new Error('A frozen simpleAlpha differs from its derivation by more than 1e-4.');
