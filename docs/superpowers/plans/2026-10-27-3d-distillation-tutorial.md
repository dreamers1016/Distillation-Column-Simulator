# Learn Distillation 3D Tutorial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive 3D distillation-column tutorial with a Lecture/Explore UI and Simple (constant α) / Advanced (Antoine + NRTL) calculation engines that are validated against literature data.

**Architecture:**
- A pure TypeScript calculation engine (`src/engine`, no DOM) with Vitest tests pinned to independently computed reference values and published VLE data.
- A Three.js scene (`src/scene`) builds a procedural plant from the engine's `Results`.
- A thin DOM UI layer (`src/app`) holds state, controls, cards, charts and the lecture presenter. One `AppState` drives everything: `state → solve() → Results → scene + UI`.

**Tech Stack:**
- Vite 5, TypeScript 5 (strict), Three.js 0.160, KaTeX 0.16 and Vitest 1, all bundled (no runtime CDN).
- Node ≥ 20 (local machine has v25.6.1).

**Spec:** `docs/superpowers/specs/2026-10-27-3d-distillation-tutorial-design.md`. Read it before any task. §-references below point into it.

**Project root for all paths below:** `tutorial/` inside the repo `C:\Users\yeeho.chai\Distillation-Column-Simulator`, on branch `feature/3d-tutorial`. Run all commands from `tutorial/`.

## Global Constraints

- **Units:**
  - Pressures are **bar absolute** everywhere, except steam levels, which are labelled barg (barg + 1.01325 = bar abs).
  - Temperatures are in °C at the UI and K inside thermodynamic functions.
  - Flows are kmol/h internally; kg/h appear at the UI.
  - Duties are in kW.
- Compositions are **mole fractions of the light component**. Validation: 0 < xB < xF < xD < 1.
- The engine never returns NaN or Infinity. Every failure is `{ ok: false, error: { code, message } }`.
- **No hidden fudge factors.** Heat loss is an explicit input (default 0 %). The v1.1 `R_eff` and overhead-superheat terms are not ported.
- **Every physical constant cites its source in a code comment.** Sources: NIST WebBook, Poling *Properties of Gases and Liquids* 5th ed., IAPWS-IF97, Aspen Plus APV NRTL databank, or Perry's VLE tables.
- **Text always names the actual chemicals.** "Blue liquid" or "orange vapour" phrasing is forbidden.
- Primary display is **1920×1080 projection**. Lecture caption body text ≥ 19 px, and the caption never covers the column.
- `localStorage` access is wrapped in try/catch, and the app works without it.
- Animation is time-based (`dt` seconds), never per-frame constants.
- Theoretical trays = N_stages − 1, because the partial reboiler is a stage. Actual trays = ⌈(N_stages − 1)/E_o⌉. Actual feed tray = min(⌈feedStage/E_o⌉, actualTrays).
- Commit after every task with message prefix `feat:` / `test:` / `docs:` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Never push** without the owner's go-ahead.

## Review Focus

1. **Mid-drag invalid compositions** (e.g. dragging xD below xF). Expect a clear error banner. The 3D model keeps the last valid plant, greyed. No NaN appears anywhere. *Test: Task 7 `solve` invalid-input cases; Task 9 greyed-plant check.*
2. **R just above Rmin**, giving 100+ trays. Expect it to still render, with the tray count capped at 120 in 3D and the label "120+ trays (column shortened for display)". Results show the true number. *Test: Task 10 `layoutColumn` cap test.*
3. **Advanced, xD beyond the azeotrope** (ethanol–water xD = 0.95). Expect `ok: false`, code `AZEOTROPE`, and a message giving the azeotrope x and T. *Test: Task 5.*
4. **Switching to Simple while an Advanced-only mixture is selected.** Expect a fall back to methanol–water with a toast naming both mixtures. *Test: Task 8 state reducer test.*
5. **Feed T or pressure outside an Antoine validity range** (e.g. propane–butane at 1 atm in Advanced). Expect a non-blocking `ANTOINE_RANGE` warning naming the component and range. *Test: Task 3.*

---

## File structure

```
tutorial/
  package.json  tsconfig.json  vite.config.ts  index.html  vercel.json
  src/engine/
    types.ts         Inputs, Results, SolveResult, Stage, Warning, codes
    components.ts    pure-component property table (+ sources)
    antoine.ts       psat_bar(compId, T_K) + range check
    steam.ts         steamSat(P_bar_abs) → {Tsat_C, hfg_kJkg}
    activity.ts      NRTL gamma, ideal gamma
    mixtures.ts      MixturePreset table (8 presets, flags, Simple α)
    vle.ts           bubblePoint, dewPoint, yStar, xStar, findAzeotrope
    enthalpy.ts      lambda (Watson), hL, hV, mixture enthalpies
    curve.ts         EquilibriumCurve interface + constantAlphaCurve + vleCurve
    mccabe.ts        stepStages, rminPinch, nminTotalReflux, fenske
    balance.ts       materialBalance, internalFlows, trayMapping
    utilities.ts     selectCondenser, selectSteam, sizing
    simple.ts        solveSimple
    advanced.ts      solveAdvanced
    solve.ts         solve(inputs): validation + dispatch
  scripts/derive-simple-alpha.ts
  src/app/  state.ts  main.ts  progress.ts  format.ts
    ui/ topbar.ts panel.ts cards.ts componentsPage.ts toast.ts
    charts/ mccabe.ts profile.ts
    content/ components.ts   (card text templates)
    lecture/ scripts.ts presenter.ts
  src/scene/ scene.ts camera.ts picking.ts plant.ts flow.ts labels.ts
    geometry/ helpers.ts column.ts trays.ts exchangers.ts piping.ts
  src/styles/ tokens.css app.css
  tests/engine/*.test.ts  tests/app/*.test.ts  tests/scene/*.test.ts
FORYEEHO.md   (repo root, Task 16)
```

---

### Task 1: Scaffold, component data and Antoine

**Files:**
- Create: `tutorial/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts` (placeholder), `src/engine/components.ts`, `src/engine/antoine.ts`, `src/engine/types.ts` (only `ComponentId` for now)
- Test: `tests/engine/antoine.test.ts`

**Interfaces — Produces:**
- `type ComponentId = 'water'|'methanol'|'ethanol'|'isopropanol'|'acetone'|'benzene'|'toluene'|'propane'|'nButane'|'nHexane'|'nHeptane'`
- `COMPONENTS: Record<ComponentId, {name; MW; Tb_K; Tc_K; lambdaTb_kJmol; cpL_JmolK; cpV_JmolK; antoine:{A;B;C;Tmin_K;Tmax_K}; sources: string}>`
- `psat_bar(id: ComponentId, T_K: number): number`
- `antoineInRange(id, T_K): boolean`
- `tsat_K(id, P_bar): number`

**Pinned data.** Antoine is in NIST form, log10(P/bar) = A − B/(T/K + C). The implementer must confirm each Tmin/Tmax on NIST WebBook and record the URL in `sources`.

| id | MW | Tb K | Tc K | λ(Tb) kJ/mol | cpL | cpV | A | B | C |
|---|---|---|---|---|---|---|---|---|---|
| water | 18.015 | 373.15 | 647.1 | 40.66 | 75.3 | 33.6 | 5.08354 | 1663.125 | −45.622 |
| methanol | 32.042 | 337.8 | 512.6 | 35.21 | 81.1 | 44.1 | 5.20409 | 1581.341 | −33.50 |
| ethanol | 46.069 | 351.4 | 513.9 | 38.56 | 112.3 | 65.6 | 5.24677 | 1598.673 | −46.424 |
| isopropanol | 60.096 | 355.4 | 508.3 | 39.85 | 156.5 | 89.3 | 4.8610 | 1357.427 | −75.814 |
| acetone | 58.08 | 329.2 | 508.1 | 29.10 | 125.5 | 74.5 | 4.42448 | 1312.253 | −32.445 |
| benzene | 78.11 | 353.2 | 562.0 | 30.72 | 136.0 | 82.4 | 4.01814 | 1203.835 | −53.226 |
| toluene | 92.14 | 383.8 | 591.8 | 33.18 | 157.0 | 103.6 | 4.07827 | 1343.943 | −53.773 |
| propane | 44.10 | 231.1 | 369.8 | 19.04 | 98.0 | 73.6 | 4.53678 | 1149.36 | 24.906 |
| nButane | 58.12 | 272.7 | 425.1 | 22.44 | 132.0 | 98.5 | 4.35576 | 1175.581 | −2.071 |
| nHexane | 86.18 | 341.9 | 507.6 | 28.85 | 195.6 | 143.0 | 4.00266 | 1171.53 | −48.784 |
| nHeptane | 100.20 | 371.6 | 540.2 | 31.77 | 224.6 | 166.0 | 4.02832 | 1268.636 | −56.199 |

cp values are at 298 K in J/(mol·K), held constant (state this in the card).

- [ ] **Step 1: Scaffold.** `npm create vite@5 tutorial -- --template vanilla-ts`. Then add `three@0.160.0`, `@types/three@0.160.0`, `katex@0.16.9`, and dev deps `vitest@1` and `jsdom@24`. Add a `"test": "vitest run"` script. Set `"strict": true` in tsconfig. Set `base: './'` in `vite.config.ts`, and Vitest `environment: 'node'` (app tests opt into jsdom per file with `// @vitest-environment jsdom`).
- [ ] **Step 2: Write failing tests** `tests/engine/antoine.test.ts`:

```ts
const NBP: Record<string, number> = { water:100.0, methanol:64.7, ethanol:78.4, isopropanol:82.3, acetone:56.1,
  benzene:80.1, toluene:110.6, nButane:-0.5, nHexane:68.7, nHeptane:98.4 };
it.each(Object.entries(NBP))('%s normal boiling point within 0.5 °C', (id, tb) => {
  expect(tsat_K(id as ComponentId, 1.01325) - 273.15).toBeCloseTo(tb, 0); // |err| < 0.5
});
it('propane is evaluated inside its range: Psat(300 K) ≈ 9.97 bar (NIST) within 1 %', () => {
  expect(psat_bar('propane', 300)).toBeGreaterThan(9.87); expect(psat_bar('propane', 300)).toBeLessThan(10.07);
});
it('propane at its 1-atm boiling point is flagged out of range', () => {
  expect(antoineInRange('propane', 231.1)).toBe(false);
});
```

- [ ] **Step 3: Run** `npm test -- antoine`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `components.ts` (the table above) and `antoine.ts`. `tsat_K` inverts Antoine analytically: T = B/(A − log10 P) − C.
- [ ] **Step 5: Run** `npm test -- antoine`. Expected: PASS. If the propane check fails, correct the constant from NIST, not the test.
- [ ] **Step 6: Commit** `feat: scaffold tutorial app with component data and Antoine`.

---

### Task 2: Steam tables

**Files:** Create `src/engine/steam.ts`. Test `tests/engine/steam.test.ts`.

**Interfaces — Produces:**
- `steamSat(P_bar_abs: number): { Tsat_C: number; hfg_kJkg: number }`
- `STEAM_LEVELS = { LP:{barg:3.5}, MP:{barg:10}, HP:{barg:40} } as const`

**Pinned table** (IAPWS-IF97 saturation; P bar abs → Tsat °C, h_fg kJ/kg). Interpolate Tsat linearly in ln P, and h_fg linearly in P:

| P | 1.01325 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 15 | 20 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tsat | 100.00 | 120.21 | 133.52 | 143.61 | 151.83 | 158.83 | 170.41 | 179.88 | 187.96 | 198.29 | 212.38 | 233.85 | 250.35 | 263.94 |
| hfg | 2256.5 | 2201.6 | 2163.5 | 2133.4 | 2107.4 | 2085.8 | 2047.5 | 2013.6 | 1985.4 | 1946.4 | 1888.6 | 1794.9 | 1712.9 | 1639.6 |

- [ ] **Step 1: Failing tests.**
  - The table nodes are returned exactly.
  - Off-node values: `steamSat(4.51325).Tsat_C` ≈ 147.9 ± 0.3 (LP 3.5 barg); `steamSat(11.01325).Tsat_C` ≈ 184.1 ± 0.3 (MP); `steamSat(41.01325).Tsat_C` ≈ 251.8 ± 0.4 (HP).
  - `hfg` at 4.51325 bar ≈ 2120 ± 0.5 %.
  - `steamSat(0.5)` and `steamSat(60)` throw `RangeError`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: IAPWS-IF97 saturated steam table`.

---

### Task 3: Activity models, mixtures and VLE solver

**Files:** Create `src/engine/activity.ts`, `src/engine/mixtures.ts`, `src/engine/vle.ts`, and add warning types to `types.ts`. Test `tests/engine/vle.test.ts`.

**Interfaces — Consumes:** Task 1 `psat_bar`, `antoineInRange`, `COMPONENTS`.

**Interfaces — Produces:**
- `type MixtureId = 'methanol-water'|'ethanol-water'|'isopropanol-water'|'acetone-water'|'benzene-toluene'|'hexane-heptane'|'methanol-ethanol'|'propane-butane'`
- `MIXTURES: Record<MixtureId, MixturePreset>`, where `MixturePreset = { id; name; light: ComponentId; heavy: ComponentId; model: 'nrtl'|'ideal'; nrtl?: {a12;a21;b12;b21;c}; simpleAllowed: boolean; simpleAlpha?: number; verified: boolean; defaults: {xF;xD;xB;R;P_bar;feedT_C;q} }`. Index 1 = light, 2 = heavy.
- `gammas(mix, x1, T_K): [number, number]`
- `bubblePoint(mix, x1, P_bar): { T_K; y1; gamma: [number, number]; warnings: Warning[] }`
- `dewPoint(mix, y1, P_bar): { T_K; x1; warnings }`
- `findAzeotrope(mix, P_bar): { x: number; T_K: number } | null`
- `type Warning = { code: 'ANTOINE_RANGE'|'CMO_GAP'|'UTILITY'|'IDEAL_VAPOUR'|'DISPLAY_CAP'; message: string }`

**NRTL** (Aspen APV form): τ12 = a12 + b12/T, τ21 = a21 + b21/T, G = exp(−c·τ), with 1 = organic and 2 = water. The parameters below were checked on 2026-10-27 by an independent Python implementation (see the test values).

| mixture | a12 | a21 | b12 | b21 | c |
|---|---|---|---|---|---|
| methanol-water | −0.693 | 2.7322 | 172.987 | −617.269 | 0.3 |
| ethanol-water | −0.8009 | 3.4578 | 246.18 | −586.0809 | 0.3 |
| isopropanol-water | −1.3115 | 6.8284 | 426.398 | −1483.46 | 0.3 |
| acetone-water | 0.0544 | 6.3981 | 419.972 | −1808.99 | 0.3 |

**Flags and defaults.** `ideal` model for benzene-toluene, hexane-heptane, methanol-ethanol and propane-butane. `simpleAllowed` is true only for benzene-toluene, hexane-heptane, methanol-ethanol and methanol-water. `verified: false` for **acetone-water** and **isopropanol-water** until the owner supplies cited T-x-y data. Unverified presets are hidden from the picker (see the plan handoff note). Defaults for the four core presets:

| mixture | xF | xD | xB | R | P (bar abs) |
|---|---|---|---|---|---|
| methanol-water | 0.5 | 0.95 | 0.05 | 2.5 | 1.01325 |
| benzene-toluene | 0.5 | 0.95 | 0.05 | 2.0 | 1.01325 |
| ethanol-water | 0.1 | 0.80 | 0.02 | 2.5 | 1.01325 |
| propane-butane | 0.5 | 0.95 | 0.05 | 3.0 | 18 |

The other presets use xF 0.5, xD 0.95, xB 0.05, R 2.5 at 1 atm. feedT_C defaults to the feed bubble point (q = 1).

**Solver.** Bubble T by bisection on f(T) = ΣxᵢγᵢPᵢˢᵃᵗ − P over [150 K, 650 K], 100 iterations, tolerance 1e-9 K. Dew T by bisection with an inner fixed-point loop on x. `findAzeotrope` scans y* − x on 999 points over (0, 1), then refines the sign change by bisection. Return null if there is no sign change.

- [ ] **Step 1: Failing tests** (methanol and ethanol experimental data from Perry's VLE tables at 101.325 kPa; the ethanol set is Carey & Lewis):

```ts
const MEOH = [[0.1,87.7],[0.2,81.7],[0.3,78.0],[0.4,75.3],[0.5,73.1],[0.6,71.2],[0.7,69.3],[0.8,67.5],[0.9,66.0]];
const ETOH = [[0.0721,89.0],[0.1238,85.3],[0.2337,82.7],[0.3273,81.5],[0.5079,79.8],[0.6763,78.74],[0.7472,78.41],[0.8943,78.15]];
it('methanol-water bubble T MAE ≤ 0.3 °C (reference impl: 0.12)', ...);
it('ethanol-water bubble T MAE ≤ 0.4 °C (reference impl: 0.24)', ...);
it('methanol-water x=0.5 → T 73.16 ± 0.05 °C, y 0.789 ± 0.002', ...);
it('ethanol-water azeotrope x = 0.895 ± 0.01, T = 78.15 ± 0.3 °C', ...);
it('isopropanol-water azeotrope x = 0.668 ± 0.02 (lit. 0.68), T = 80.31 ± 0.5 °C', ...);
it('methanol-water has no azeotrope', () => expect(findAzeotrope(MIXTURES['methanol-water'], 1.01325)).toBeNull());
it('benzene-toluene ideal: bubble T at x=0.95 is 81.12 ± 0.05 °C, at x=0.05 is 108.32 ± 0.05 °C', ...);
it('dewPoint(y) inverts bubblePoint: bubble(x).y1 → dew → x within 1e-6', ...);
it('propane-butane at 1.01325 bar emits ANTOINE_RANGE warning naming propane', ...);
it('acetone-water and isopropanol-water are verified:false', ...);
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `activity.ts` (standard binary NRTL ln γ expressions), `mixtures.ts` and `vle.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: NRTL/ideal VLE with bubble, dew and azeotrope`.

---

### Task 4: Equilibrium curves, McCabe-Thiele, Rmin and Nmin

**Files:** Create `src/engine/curve.ts`, `src/engine/mccabe.ts`. Test `tests/engine/mccabe.test.ts`.

**Interfaces — Consumes:** Task 3 `bubblePoint`, `MixturePreset`.

**Interfaces — Produces:**
- `interface EquilibriumCurve { yStar(x: number): number; xStar(y: number): number }`
- `constantAlphaCurve(alpha: number): EquilibriumCurve`
- `vleCurve(mix: MixturePreset, P_bar: number): EquilibriumCurve`. `xStar` inverts by bisection. y* must be strictly increasing on (0, 1) for non-azeotropic ranges; tabulate 400 points and interpolate for speed. Accuracy against direct bubblePoint must stay within 1e-4.
- `stepStages(curve, op: {xF;xD;xB;R;q}): { Nfrac: number; N: number; feedStage: number; stages: {n;x;y}[] }`:
  - Step from the top: y₁ = xD, xₙ = xStar(yₙ).
  - Switch to the stripping line on the first stage with xₙ ≤ x_intersect, which is the feed stage.
  - Stop when xₙ ≤ xB.
  - Nfrac = (N − 1) + (x_{N−1} − xB)/(x_{N−1} − x_N).
  - If N reaches 300, throw `StageLimitError`.
- `qLineIntersection(op): {x; y}`. For q = 1, x = xF.
- `rminPinch(curve, op): { Rmin: number; pinch: 'feed'|'tangent-rectifying'|'tangent-stripping' }`. Rmin is the smallest R for which **both** operating lines lie strictly below y* on 400 points spanning [xB, xD], and the q-line intersection lies below y*. Find it by bisection on R ∈ [0, 100] to 1e-6. Classify the pinch by where the minimum gap occurs.
- `nminTotalReflux(curve, xD, xB): number`. Stepping with y = x, fractional as above.
- `fenske(alpha, xD, xB): number`.

- [ ] **Step 1: Failing tests.** All reference values come from an independent Python implementation, 2026-10-27.

```ts
const c = constantAlphaCurve(2.5);
it.each([
  [{xF:.5,xD:.95,xB:.05,R:2,q:1},   10.3880, 11, 5],
  [{xF:.5,xD:.95,xB:.05,R:2,q:0.5}, 12.2192, 13, 7],
  [{xF:.5,xD:.95,xB:.05,R:2,q:1.2},  9.9309, 10, 5],
  [{xF:.4,xD:.98,xB:.02,R:3,q:1},   13.1159, 14, 7],
])('constant-alpha stepping %o', (op, Nfrac, N, feed) => {
  const r = stepStages(c, op); expect(r.Nfrac).toBeCloseTo(Nfrac, 3); expect(r.N).toBe(N); expect(r.feedStage).toBe(feed);
});
it('Rmin pinch q=1 equals Underwood/King 1.1000', () => expect(rminPinch(c,{xF:.5,xD:.95,xB:.05,R:0,q:1}).Rmin).toBeCloseTo(1.1, 3));
it('Rmin pinch q=0.5 → 1.4987; q=1.2 → 0.9888', ...);
it('Fenske a=2.5 xD .95 xB .05 → 6.4269 ±1e-4; nminTotalReflux on constantAlphaCurve within 0.5 stage of it (fractional-step convention differs from the analytic form)', ...);
// real VLE (methanol-water, 1 atm)
it('methanol-water xF.5 xD.95 xB.05 R2.5 q1 → Nfrac 5.314±0.01, N 6, feed 4', ...);
it('methanol-water stage-1 liquid x = 0.8759 ± 0.001; stage-6 x = 0.0100 ± 0.001', ...);
it('methanol-water Rmin = 0.5576 ± 0.002; Nmin(total reflux) = 4.289 ± 0.01', ...);
// tangent pinch
it('ethanol-water xF .1 xD .84 xB .01 q1: Rmin = 1.6141 ± 0.005 with pinch tangent-rectifying (q-line value would be 1.1372)', ...);
it('ethanol-water xF .1 xD .80 xB .02: Rmin = 1.0216 ± 0.002 with pinch feed', ...);
it('ethanol-water xD .8 xB .02 Nmin(total reflux) = 5.963 ± 0.02', ...);
it('R ≤ Rmin throws StageLimitError or returns a pinch error, never loops forever', ...);
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: McCabe-Thiele stepping, pinch Rmin, Nmin`.

---

### Task 5: Enthalpy, balances, Simple and Advanced solvers

**Files:** Create `src/engine/enthalpy.ts`, `balance.ts`, `simple.ts`, `advanced.ts`, and complete `types.ts`. Test `tests/engine/simple.test.ts` and `tests/engine/advanced.test.ts`.

**Interfaces — Consumes:** Tasks 1–4.

**Interfaces — Produces** (in `types.ts`):

```ts
type Mode = 'simple' | 'advanced';
interface Inputs { mode: Mode; mixtureId: MixtureId; F_kgh: number; xF: number; xD: number; xB: number; R: number;
  q: number /* simple */; feedT_C: number /* advanced */; P_bar: number; Eo: number; heatLossPct: number;
  condenserUtility: 'auto'|'CW'|'ChW'; steamLevel: 'auto'|'LP'|'MP'|'HP';
  cw: { in_C: number; out_C: number }; chw: { in_C: number; out_C: number }; }
interface StageRow { n: number; x: number; y: number; T_C: number | null; gamma: [number, number] | null }
interface Results { ok: true; mode: Mode; mixture: MixturePreset;
  F_kmolh; D_kmolh; B_kmolh; D_kgh; B_kgh; L; V; Lp; Vp;   // kmol/h
  q; Rmin; pinch; Nmin; NminMethod: 'fenske'|'total-reflux'; fenskeShortcut: number | null;
  Nfrac; N; theoreticalTrays; actualTrays; feedStage; feedTray;
  stages: StageRow[]; trayProfile: { tray: number; x: number; y: number; T_C: number }[] | null;
  Ttop_C; Tbot_C; TtopIsEstimate: boolean; Qc_kW; Qr_kW; cmoGapPct: number | null;
  condenser: CondenserResult; reboiler: ReboilerResult;   // Task 6
  warnings: Warning[]; assumptions: string[]; }
type ErrorCode = 'INVALID_COMPOSITION'|'R_BELOW_MIN'|'AZEOTROPE'|'NOT_SIMPLE'|'UNVERIFIED'|'STAGE_LIMIT'|'OUT_OF_RANGE';
type SolveResult = Results | { ok: false; error: { code: ErrorCode; message: string }; warnings: Warning[] };
```

**Enthalpy model** (pin exactly):
- Reference: pure liquid at 298.15 K.
- hL,i(T) = cpL,i·(T − 298.15)
- λi(T) = λi(Tb)·((1 − T/Tc)/(1 − Tb/Tc))^0.38 (Watson)
- hV,i(T) = hL,i(T) + λi(T)
- Mixtures mix ideally (mole-fraction weighted). All in kJ/kmol internally.

**Simple solver** (§5.3):
- Curve = `constantAlphaCurve(mix.simpleAlpha)`, P = 1.01325.
- λ = mean of λᵢ(Tb).
- Qc = V·λ and Qr = Vp·λ·(1 + heatLoss/100).
- Ttop and Tbot come from ideal Raoult bubble points at xD and xB (`TtopIsEstimate = true`). `trayProfile = null`.
- Nmin is Fenske.

**Advanced solver** (§5.4):
- Curve = `vleCurve(mix, P)`.
- If `findAzeotrope` is non-null and x_az lies within [xB, xD], return `AZEOTROPE`.
- Feed: q = (H_V,sat − H_F)/(H_V,sat − H_L,sat) with:
  - H_L,sat = hL(xF, T_bub);
  - H_V,sat = hV(xF, T_dew);
  - H_F = the enthalpy at feedT: subcooled liquid hL(xF, T); superheated hV(xF, T); two-phase via isothermal flash at column P.
- Stage temperatures are the bubble T of each xₙ.
- trayProfile maps actual tray k → stage index s = 1 + (k − 0.5)·(N − 1)/actualTrays, with linear interpolation of x, y and T.
- Qc = V·(hV(xD, T_dew(xD)) − hL(xD, T_bub(xD))).
- Qr = Qc + D·hD + B·hB − F·hF, then × (1 + heatLoss/100) on the reboiler side only.
- cmoGapPct = (Qr − Vp·λ_mix(xB, T_bot))/Qr·100. Emit `CMO_GAP` if |gap| > 5 %.
- Nmin uses total reflux, with Fenske at the geometric-mean α of the ends as `fenskeShortcut`.
- Emit an `IDEAL_VAPOUR` warning when P > 10 bar.

- [ ] **Step 1: Failing tests.** All reference values come from an independent Python implementation, 2026-10-27.

```ts
// Simple, benzene-toluene, alpha fixed at 2.5 for this test via an override, F=1000 kg/h, xF .5 xD .95 xB .05 R 2 q 1
it('material balance', () => { /* F 11.7474, D 5.8737, B 5.8737 kmol/h ±1e-4; D 462.916 kg/h, B 537.084 kg/h ±1e-3 */ });
it('F = D + B and F·xF = D·xD + B·xB to 1e-9 relative', ...);
it('Simple energy: Qc = Qr = 156.388 kW ±0.01 with q=1, heatLoss 0', ...);
it('Simple: heatLoss 5 % → Qr = 164.207 kW, Qc unchanged', ...);
it('Simple: theoreticalTrays = N-1 = 10, actualTrays = ceil(10/0.7) = 15, feedTray = ceil(5/0.7) = 8', ...);
// Advanced, methanol-water, F=1000, xF .5 xD .95 xB .05 R 2.5, feedT = bubble (73.16 °C), 1 atm
it('Advanced: F 39.9545, D 19.9772, V 69.9203 kmol/h ±1e-3', ...);
it('Advanced: Ttop (bubble of xD) 65.31, top-vapour dew 66.48, Tbot 92.51 °C ±0.05', ...);
it('Advanced: Qc 690.16 kW, Qr 694.76 kW (±0.5 %), cmoGapPct −13.70 ±0.3, CMO_GAP warning present', ...);
it('Advanced: q = 1.000 ±1e-3 at bubble feed; q < 1 at feedT 80 °C; q > 1 at 40 °C; q < 0 above dew point', ...);
it('Advanced: stage temperatures increase monotonically down the column', ...);
it('Advanced: ethanol-water xD .95 → ok:false code AZEOTROPE, message contains "0.89" and "78."', ...);
it('Advanced: propane-butane at 18 bar → Ttop between 50 and 56 °C, warnings include IDEAL_VAPOUR', ...);
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Add a test-only `alphaOverride` option on `solveSimple`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: Simple and Advanced solvers with energy balance`.

---

### Task 6: Utilities selection and sizing

**Files:** Create `src/engine/utilities.ts`, and wire it into `simple.ts` and `advanced.ts`. Test `tests/engine/utilities.test.ts`.

**Interfaces — Produces:**
- `CondenserResult = { utility: 'CW'|'ChW'|'REFRIGERATION'; auto: boolean; feasible: boolean; reason: string; in_C; out_C; flow_kgh; LMTD; U_Wm2K: 800; area_m2 }`
- `ReboilerResult = { level: 'LP'|'MP'|'HP'|'HOT_OIL'; auto: boolean; feasible: boolean; reason: string; P_barg; Tsat_C; dT; hfg_kJkg; steam_kgh; U_Wm2K: 1000; area_m2 }`
- `selectCondenser(Tcond_C, Qc_kW, inputs)` and `selectReboiler(Treb_C, Qr_kW, inputs)`

**Rules** (§5.6):
- ΔT_min is 10 °C for the condenser.
- Auto picks CW (30 → 40 °C) if Tcond ≥ 50 °C. Otherwise ChW (7 → 12 °C) if Tcond ≥ 22 °C. Otherwise `REFRIGERATION`, which is infeasible with the message "needs refrigeration — outside this tool".
- LMTD uses an isothermal condensing side: (ΔT1 − ΔT2)/ln(ΔT1/ΔT2), with ΔT1 = Tcond − in and ΔT2 = Tcond − out.
- Reboiler: the first of LP 3.5, MP 10, HP 40 barg with Tsat − Treb ≥ 20 °C. Otherwise `HOT_OIL`, infeasible.
- Reboiler ΔT = Tsat − Treb (not LMTD). Steam flow = Qr·3600/hfg.
- An override that is infeasible sets `feasible: false`, with flows and areas set to 0 and a reason that names both temperatures.
- `reason` text must include the numbers. Example: "Tbot 92.5 °C → LP steam at 147.9 °C gives ΔT 55.4 °C ≥ 20 °C".

- [ ] **Step 1: Failing tests.**
  - Methanol–water Advanced default: CW auto, because Tcond 65.31 ≥ 50.
  - LMTD = (35.31 − 25.31)/ln(35.31/25.31) = 30.04 ± 0.05.
  - CW flow = 690.16·3600/(4.18·10) = 59,440 ± 60 kg/h.
  - Reboiler LP, ΔT = 147.9 − 92.51 = 55.4 ± 0.4. Steam = Qr·3600/hfg(4.51325 bar) ≈ 1,180 ± 10 kg/h.
  - A Tcond of 30 °C picks ChW. A Tcond of 10 °C gives REFRIGERATION, infeasible.
  - Forcing CW at Tcond 30 °C gives feasible: false, flow 0.
  - Treb 240 °C picks HOT_OIL, infeasible.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: utility selection and exchanger sizing`.

---

### Task 7: `solve()` facade, validation, and Simple-α derivation

**Files:** Create `src/engine/solve.ts` and `scripts/derive-simple-alpha.ts`. Modify `mixtures.ts` to freeze `simpleAlpha`. Test `tests/engine/solve.test.ts`.

**Interfaces — Produces:**
- `solve(inputs: Inputs): SolveResult`. It never throws. It catches `StageLimitError` and `RangeError` and maps them to `STAGE_LIMIT` and `OUT_OF_RANGE`.
- `deriveSimpleAlpha(mix): number`. This is √(α(xD = 0.95)·α(xB = 0.05)) at 1.01325 bar, where α = (y/x)/((1 − y)/(1 − x)) from `bubblePoint`.

**Validation order:**
1. Composition (`INVALID_COMPOSITION` unless 0 < xB < xF < xD < 1).
2. `UNVERIFIED`.
3. `NOT_SIMPLE` in Simple mode.
4. R ≤ Rmin·1.0001 gives `R_BELOW_MIN`, with a message that includes Rmin to 2 decimals.

- [ ] **Step 1: Failing tests.**
  - `deriveSimpleAlpha` returns 2.4744 ± 0.002 for benzene-toluene, 2.4746 for hexane-heptane, 1.7232 for methanol-ethanol and 4.3011 for methanol-water.
  - `MIXTURES[*].simpleAlpha` equals `deriveSimpleAlpha` within 1e-4, which proves the frozen values reproduce.
  - Invalid compositions give each error code.
  - Fuzz: 2,000 random inputs within the slider ranges never produce NaN or Infinity in any numeric field of an ok result, checked by walking the object.
  - Ethanol-water in Simple gives `NOT_SIMPLE`. Acetone-water gives `UNVERIFIED`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the facade. Run the script `npx tsx scripts/derive-simple-alpha.ts` and paste the printed values into `mixtures.ts` with a comment naming the script.
- [ ] **Step 4: Run** `npm test`. Expected: the whole engine suite passes.
- [ ] **Step 5: Commit** `feat: solve facade, validation, derived Simple alpha`.

---

### Task 8: App state, top bar and Explore panel

**Files:** Create `src/app/state.ts`, `src/app/format.ts`, `src/app/ui/topbar.ts`, `src/app/ui/panel.ts`, `src/app/ui/toast.ts`, `src/styles/tokens.css` and `src/styles/app.css`. Modify `src/main.ts` and `index.html`. Test `tests/app/state.test.ts` (jsdom).

**Interfaces — Produces:**
- `AppState = { view: 'lecture'|'explore'; inputs: Inputs; cutaway: boolean; selected: PartRef | null; lectureId: string; step: number }`
- `type PartRef = { kind: 'column'|'tray'|'feed'|'condenser'|'refluxDrum'|'reboiler'|'sump'|'distributor'|'skirt'|'manway'|'platform'|'nozzle'|'cwSystem'|'steamSystem'; tray?: number }`
- `createStore(initial): { get(): AppState; set(patch: Partial<AppState> | ((s) => Partial<AppState>)): void; subscribe(fn: (s, r: SolveResult) => void): () => void }`. The store memoises `solve(inputs)` on the inputs reference.
- `setMode(store, mode)` implements Review Focus #4. If the mixture is not `simpleAllowed`, switch to methanol-water defaults and show the toast "Ethanol–Water is Advanced only — switched to Methanol–Water".
- `setMixture(store, id)` loads that preset's defaults.

**Style tokens** (from the Arduino reference, §3.1): `--paper #f4ecdc`, `--grid #e5dccb`, `--ink #1f2a36`, `--teal #14a3a0`, `--card #fffdf8`, `--line #d8ccb4`, `--muted #6b7580`, `--warn-bg #fff1d6`, `--err-bg #fde3e1`.

**Panel contents** (§3.3, §5.1):
- Mixture select: unverified presets are hidden; Advanced-only ones are greyed in Simple with "(Advanced only)".
- Sliders: R 0.3–10; xD 0.80–0.995; xB 0.005–0.2; F 100–10,000 kg/h; E_o 0.4–1.0; heat loss 0–15 %.
- Simple shows a q slider from −0.5 to 1.5, with tick labels "superheated | sat. vapour | two-phase | sat. liquid | subcooled". Advanced shows feed T, from −40 to 200 °C, plus pressure from 0.5 to 25 bar abs.
- Utility overrides and CW/ChW temperature inputs.
- Results grid: N, theoretical trays, actual trays, feed tray, Rmin with R/Rmin, Nmin, Qc, Qr, D and B in kg/h, Ttop and Tbot (with "≈" in Simple).
- In Advanced, for a `simpleAllowed` mixture, a "Simple vs Advanced" row shows both stage counts for the same inputs, from a second `solve` with `mode: 'simple'` and q taken from the Advanced result (spec §5.4).
- Warnings list; the error banner.
- Assumptions box (Simple: always visible).
- A selected-part card slot (Task 12) and a chart slot (Task 13).

- [ ] **Step 1: Failing tests.**
  - The store recomputes on an inputs change and not on a `cutaway` change.
  - `setMode('simple')` with ethanol-water falls back to methanol-water and emits a toast.
  - `setMixture('propane-butane')` sets P = 18.
  - The panel renders the "≈" prefix on temperatures in Simple and none in Advanced.
  - The error banner shows the `R_BELOW_MIN` message when R is set to 0.4 for methanol-water Simple.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Run `npm run dev` and check in the browser that sliders update the results live.
- [ ] **Step 5: Commit** `feat: app state, top bar and explore panel`.

---

### Task 9: 3D scene foundation (renderer, camera flights, picking)

**Files:** Create `src/scene/scene.ts`, `src/scene/camera.ts`, `src/scene/picking.ts` and `src/scene/labels.ts`. Test `tests/scene/camera.test.ts`.

**Interfaces — Produces:**
- `createScene(container: HTMLElement): { scene; camera; renderer; controls; labelRenderer; onFrame(fn: (dt: number) => void): void; dispose(): void }`
  - ACES tone mapping and a RoomEnvironment PMREM.
  - Soft shadows, a cream background, and a 120 m grid with a shadow floor.
  - The frame loop passes `dt` in seconds, clamped to ≤ 0.05.
- `CameraDirector`: `flyTo(target: Vector3, distance: number, opts?: { captionSafe: boolean }): void` and `update(dt): void`.
  - Use exponential smoothing with a time constant of 0.35 s: `k = 1 − exp(−dt/0.35)`.
  - Cancel on user drag.
  - When `captionSafe`, shift the look target so the framed object sits in the right 62 % of the viewport.
- `Picker(camera, dom)`: `onPick((ref: PartRef) => void)`. A click with movement under 5 px raycasts `userData.part` up the parent chain. Points are ignored.
- `makeLabel(text, onClick?): CSS2DObject`. Font is 11 px in Explore and 14 px in Lecture via a body class.

- [ ] **Step 1: Failing tests** (pure math, no WebGL):
  - `smoothFactor(dt=0.35)` = 1 − e⁻¹ ± 1e-9.
  - After a simulated 3 s with any frame-rate mix (60 Hz vs 15 Hz), the distance to the target is < 1 % of the start.
  - The two frame rates end within 1 % of each other.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Mount it in `main.ts` and check in the browser that the grid floor renders and orbit, zoom and pan work.
- [ ] **Step 5: Commit** `feat: 3D scene foundation with time-based camera flights`.

---

### Task 10: Procedural plant geometry

**Files:** Create `src/scene/geometry/helpers.ts`, `column.ts`, `trays.ts`, `exchangers.ts`, `piping.ts` and `src/scene/plant.ts`. Test `tests/scene/layout.test.ts`.

**Port the geometry ideas from the spike** `spike-3d-column-v2.html` (copied into `tutorial/reference/spike-3d-column-v2.html` in Step 0 of this task). Do not paste its code. Rebuild it in modules.

**Interfaces — Produces:**
- `layoutColumn(r: Results): { trays: number; displayTrays: number; capped: boolean; trayY: number[]; feedTrayIndex: number; y0: number; yTop: number }`.
  - Pinned geometry: column radius 1.0, wall 0.05, tray spacing 0.62, sump 1.3, top space 0.9, skirt height y0 = 2.6.
  - `displayTrays = min(actualTrays, 120)`, which implements Review Focus #2.
- `buildPlant(r: Results, opts: { cutaway: boolean; utilityColors: boolean }): { group: Group; anchors: Record<PartRef['kind'], { look: Vector3; dist: number }>; liquidPath: Vector3[]; vaporBox: Box3; dispose(): void }`
- Geometry contents follow spec §4 exactly. Each pickable group sets `userData.part: PartRef`; each tray group sets `{ kind: 'tray', tray: n }`. Each pickable part gets its own material set, so a highlight never leaks to another part.
- `highlight(part: PartRef | null)` uses the teal emissive `0x1d6b66`.
- Utility appearance:
  - Condenser utility lines are green `#3d8f5a` for CW and cyan `#2fa8c8` for ChW, with a label of "CW 30→40 °C" or "ChW 7→12 °C".
  - The steam line is brown `#8a6a2a` and labelled "LP steam 3.5 barg" (or MP/HP).
- When the result is `ok: false`, the previous plant stays visible with materials set to 50 % opacity, which implements Review Focus #1.
- Labels (via `makeLabel`) show:
  - the tray count ("15 sieve trays", or "120+ trays (column shortened for display)" when capped);
  - "Feed → tray n";
  - Ttop and Tbot, prefixed "≈" in Simple;
  - product labels "Distillate: 95 mol% methanol · 463 kg/h" and "Bottoms: 95 mol% water · 537 kg/h", from `Results`.
- Tray sub-meshes are tagged `userData.sub = 'deck'|'weir'|'downcomer'`, so the tray card (Task 12) can highlight each one as it is named.

- [ ] **Step 0:** Copy the spike from the scratchpad into `tutorial/reference/`, for reference only.
- [ ] **Step 1: Failing tests.**
  - `layoutColumn` with actualTrays 15 gives 15 trays, with trayY strictly decreasing and spacing 0.62.
  - Feed tray index = feedTray − 1.
  - Actual trays 300 gives displayTrays 120 and capped true.
  - `buildPlant` (Three.js objects without a renderer) contains exactly `displayTrays` groups with `kind === 'tray'`.
  - Tray n has downcomer side `n % 2 ? +x : −x`.
  - `liquidPath` starts at the distributor and ends in the sump.
  - The cutaway changes shell `thetaLength` to π.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** In the browser, check that the plant matches the spike's level of detail, the cutaway toggles, and clicking a tray selects it.
- [ ] **Step 5: Commit** `feat: procedural plant geometry from results`.

---

### Task 11: Composition-coloured flow particles

**Files:** Create `src/scene/flow.ts`. Test `tests/scene/flow.test.ts`.

**Interfaces — Consumes:** `buildPlant().liquidPath` and `vaporBox`; `Results.stages` and `trayProfile`.

**Interfaces — Produces:** `createFlow(plant, r: Results): { points: Points[]; update(dt: number): void; legend: { light: { name; color }; heavy: { name; color } } }`.

**Rules:**
- 420 liquid particles follow the arclength-parametrised `liquidPath`. 320 vapour particles rise inside `vaporBox`.
- Speeds: liquid 0.9·(L/L_ref) above the feed tray and 0.9·(Lp/L_ref) below it. Vapour 1.4·(V/V_ref) and 1.4·(Vp/V_ref). The reference values are from the first solve after a mixture change.
- Colour = lerp(heavyColor `#2c6fbb`, lightColor `#e2873a`, composition). Liquid uses x at the particle's height and vapour uses y, interpolated from `trayProfile` in Advanced, or from `stages` mapped to height in Simple.
- The legend names come from `mixture.light` and `mixture.heavy`.

- [ ] **Step 1: Failing tests.**
  - `compositionAtHeight` returns xD-ish (≥ 0.85) at the top tray and ≤ 0.1 at the bottom for methanol-water Advanced.
  - The colour at composition 1 equals the light colour.
  - Particle advance over 1 s at 60 Hz equals that at 20 Hz within 1 %.
  - Speed below the feed is greater than above it when q = 1 (L′ > L).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Check visually that the colour shifts from the light-component colour at the top to the heavy-component colour at the bottom.
- [ ] **Step 5: Commit** `feat: composition-coloured liquid and vapour flow`.

---

### Task 12: Component cards and Components page

**Files:** Create `src/app/content/components.ts`, `src/app/ui/cards.ts` and `src/app/ui/componentsPage.ts`. Test `tests/app/cards.test.ts`.

**Interfaces — Produces:**
- `CARD_CONTENT: Record<PartRef['kind'], (ctx: { r: Results; inputs: Inputs; tray?: number }) => Card>`
- `Card = { title; tag; what: string; how: string; equations: string[] /* KaTeX */; live: [label: string, value: string][]; typical: [string, string][]; problems: string[] }` (spec §6, all six sections required)
- `renderCard(card, el, { size: 'panel'|'overlay' })` renders KaTeX with `throwOnError: false`. The overlay variant is ≥ 22 px body text.
- `renderComponentsPage(el, ctx)` lists all cards in order: column, tray, feed, distributor, sump, condenser, cwSystem, refluxDrum, reboiler, steamSystem, skirt, manway, platform, nozzle.

**Content rules:**
- Text interpolates `r.mixture` component names ("methanol-rich vapour…").
- The tray card for tray n shows x, y and T (Advanced, from `trayProfile`) and γ₁ and γ₂ where present, plus "≈ interpolated between theoretical stages".
- The condenser and reboiler cards show `reason` from Task 6.
- Equations are taken from `index.html` `COMP_INFO`, with the §5.7 corrections:
  - no LMTD for the reboiler (ΔT = Tsat − Treb);
  - Rmin by pinch;
  - trays = (N − 1)/E_o.
- The column card states the diameter is illustrative.
- The Simple card for methanol-water notes that constant α is an approximation.
- In the tray card, hovering the words "deck", "weir" or "downcomer" highlights the matching `userData.sub` meshes in 3D (spec §6).

- [ ] **Step 1: Failing tests.**
  - Every kind has a card with all six sections non-empty.
  - For each of the four Simple mixtures, no card text matches `/blue liquid|orange vapou?r/i`, and the reboiler card contains the heavy component name.
  - Tray card 3 for methanol-water Advanced contains "x =", "y =" and "°C".
  - The reboiler card does not contain "LMTD".
  - The Components page renders 14 cards.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Wire picking (Task 9) → `store.set({ selected })` → card render. In Explore the card goes in the panel; in Lecture it opens as an overlay.
- [ ] **Step 4: Run, expect PASS.** Click through every part in the browser.
- [ ] **Step 5: Commit** `feat: component cards and components page`.

---

### Task 13: McCabe-Thiele and profile charts

**Files:** Create `src/app/charts/mccabe.ts` and `src/app/charts/profile.ts`. Test `tests/app/charts.test.ts`.

**Interfaces — Produces:**
- `renderMcCabe(svg: SVGSVGElement, r: Results, curve: EquilibriumCurve)` draws:
  - the equilibrium curve (200 points);
  - y = x;
  - the q-line;
  - both operating lines;
  - the stage steps;
  - markers at xB, xF and xD;
  - the feed stage highlighted;
  - axis labels using the light-component name.
- `renderProfile(svg, r)` (Advanced only) plots T (°C) against tray and x and y against tray, tray 1 at the top. It is hidden in Simple, with the text "Temperature profile available in Advanced mode".
- Both are plain SVG, sized by viewBox, with no chart library.

- [ ] **Step 1: Failing tests.**
  - The number of step polylines equals `r.N`.
  - The curve endpoints are at (0, 0) and (1, 1).
  - The drawn equilibrium curve matches the engine's `curve.yStar` at 10 sample x values within 1e-6 (in plot coordinates mapped back).
  - The profile has `trayProfile.length` points.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat: McCabe-Thiele and column profile charts`.

---

### Task 14: Lecture mode, lessons and progress

**Files:** Create `src/app/lecture/scripts.ts`, `src/app/lecture/presenter.ts` and `src/app/progress.ts`. Test `tests/app/lecture.test.ts`.

**Interfaces — Produces:**
- `LectureStep = { title: string; focus: PartRef['kind'] | 'overview'; set?: Partial<Inputs> & { mode?: Mode; R?: number | 'nearRmin' }; cutaway?: boolean; openCard?: PartRef['kind']; caption: (r: Results, i: Inputs) => string }`
- `LECTURES: { id: 'mw-intro'; title: 'Methanol–water: meet the column'; steps: LectureStep[] }[]`
- `Presenter(store, director)`: `next()`, `prev()` and `go(i)`.
  - Keys: ArrowRight, PageDown and Space go forward; ArrowLeft and PageUp go back. They are active only in the Lecture view.
- `'nearRmin'` resolves to round(1.2·Rmin + 0.05, 1).
- `progress`: `markStep(lectureId, i)`, `markCard(kind)` and `getProgress()`. Every `localStorage` call is wrapped in try/catch with an in-memory fallback.

**v1 script** (spec §3.2, 9 steps, methanol-water, 1 atm, Simple until step 8). Captions are templates with live numbers and real component names:
1. overview
2. feed (q)
3. reboiler (with the steam-level reason)
4. tray (cutaway on, flow legend)
5. condenser and drum (with the CW reason)
6. low R `'nearRmin'`
7. high R = 4
8. switch to Advanced (tray temperature profile; caption compares Simple N vs Advanced N from two solves)
9. your turn

**Lesson strip:** the Arduino-style lesson list shows `LECTURES` with progress ticks.

- [ ] **Step 1: Failing tests.**
  - The script has 9 steps.
  - Step 6 sets R to 1.2·Rmin + 0.05 rounded to 1 dp.
  - Step 8 sets mode `advanced`, and its caption contains both stage counts.
  - No caption matches `/blue liquid|orange/i`.
  - PageDown advances and PageUp goes back.
  - Keys do nothing in Explore.
  - `progress` works when `localStorage.setItem` throws.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** The caption card is ≥ 19 px body text at 1080p. Use `flyTo(..., { captionSafe: true })`.
- [ ] **Step 4: Run, expect PASS.** Resize the browser to 1920×1080, step through all 9 steps, and confirm the caption never overlaps the column.
- [ ] **Step 5: Commit** `feat: lecture mode, lessons and progress`.

---

### Task 15: Responsive layout and end-to-end verification

**Files:** Modify `src/styles/app.css` and `src/main.ts`.

- [ ] **Step 1:** Check the layout at 1920×1080, 1366×768 and 768×1024 (tablet), plus 375×812 (phone usable but not optimised: the panel becomes a bottom sheet). There must be no horizontal scroll.
- [ ] **Step 2:** Run `npm test` (all pass), then `npm run build`. The build must succeed with zero TypeScript errors, and `grep -rE "cdn\.|jsdelivr|unpkg|googleapis" dist` must print nothing, so there are no runtime CDN dependencies.
- [ ] **Step 3:** Run `npm run preview`, then walk the full lecture, every mixture in both modes, the cutaway, every card, and the four Review Focus scenarios. Take screenshots as evidence.
- [ ] **Step 4: Commit** `feat: responsive layout and verification pass`.

---

### Task 16: Vercel config, README and FORYEEHO.md

**Files:** Create `tutorial/vercel.json` (`{ "buildCommand": "npm run build", "outputDirectory": "dist" }`), `tutorial/README.md` (run, test and build commands; data sources) and `FORYEEHO.md` at the repo root.

**`FORYEEHO.md` contents** (owner's standing instruction, plain language):
- the architecture and data flow (state → solve → scene/UI);
- the codebase map;
- why Vite, TypeScript, Three.js and KaTeX, and why the geometry is procedural;
- the thermodynamics explained (Antoine, NRTL, modified Raoult, CMO, pinch, Watson);
- **bugs found and fixed**: the 8 items of spec §5.7, the false acetone–water azeotrope, propane's Antoine range, and the 16 vs 18 bar CW issue;
- pitfalls (frame-rate-dependent animation, NaN propagation, shared materials leaking highlights);
- how good engineers verify numerics: independent reference implementations and literature data.

- [ ] **Step 1:** Write the files.
- [ ] **Step 2:** Run `npm run build` once more. Expected: success.
- [ ] **Step 3: Commit** `docs: Vercel config, README and FORYEEHO guide`.
- [ ] **Step 4:** Ask the owner before pushing the branch or linking the Vercel project. Vercel's Root Directory must be set to `tutorial`.
