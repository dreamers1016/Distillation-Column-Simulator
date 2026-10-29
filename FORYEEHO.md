# FORYEEHO: the Learn Distillation 3D tutorial, explained

Dr. Chai, this is your plain-language guide to the interactive 3D distillation tutorial in
the `tutorial/` folder. It covers what the tool is, how it is built and why, the
thermodynamics inside it, every significant bug we found and how it was fixed, and
the engineering habits that kept the numbers honest.

Read it in order the first time. Later, sections 6 (bugs) and 10 (open items) are the
ones to come back to.

Everything here comes from the repository: the design spec, the plan, the build
ledger (`.superpowers/sdd/2026-10-27-3d-distillation-tutorial/progress.md`), the task
reports, the commit history and the code. Where the record is thin, this guide says so.
I computed a few illustrative numbers fresh from the engine while writing it (marked
"computed for this guide").

---

## Contents

1. What it is, who it is for, how it is used
2. Architecture and data flow
3. Codebase map
4. Technologies, and why each was chosen
5. The thermodynamics, explained
6. Bugs found and fixed
7. How the numbers were verified
8. Pitfalls, and how to avoid them
9. How good engineers think and work
10. Open items for you
11. Appendix: commit history

---

## 1. What it is, who it is for, how it is used

### The product

It is a web page. When it opens you see a realistic 3D distillation unit:

- a column with sieve trays;
- an overhead shell-and-tube condenser;
- a reflux drum on saddles;
- a kettle reboiler;
- a steel structure, platforms, a ladder and colour-coded piping.

You can orbit, zoom and click any part. The plant is not a fixed model. It is rebuilt
from the calculation every time an input changes. If the McCabe-Thiele stepping says
8 actual trays, the 3D column has 8 trays, with the feed tray marked where the
stepping put it.

It replaces nothing. The original 2D simulator (`index.html` at the repo root, "v1.1")
stays as the legacy tool. The new tutorial lives entirely in `tutorial/`.

### Who it is for

There are two real users, and every design decision serves one of them:

1. **You, lecturing.** You project the tutorial and walk a class through a worked
   example step by step.
2. **Your students, studying alone.** They reopen the link later, replay the example,
   try other mixtures and explore freely.

Your bar, from the spec: *all thermodynamic models, calculations, and mass and energy
balances must be correct*, because a wrong number in front of a class is a
credibility failure. That bar shaped the whole build: a large share of the work went into
proving the numbers, not only drawing the plant.

### Two independent switches

The top bar has two switches. They are independent of each other.

**Lecture | Explore** (how you interact):

- **Lecture** is full-screen 3D plus a large caption card ("Step n of N · Title") and a
  presenter bar (Prev, step dots, Next). The keys are → / PageDown / Space to go
  forward and ← / PageUp to go back, so a presentation clicker works. Each step can
  fly the camera, set inputs, switch mode and toggle the cutaway.
  - The v1 script is methanol–water at 1 atm, in 9 steps: the column at a glance; feed
    and q; reboiler and steam level; inside a tray; condenser, reflux drum and R; low
    reflux near Rmin; high reflux; Advanced mode; your turn.
  - Every number in a caption is computed live by the engine, never typed into the
    script.
- **Explore** is a docked side panel with:
  - the mixture picker and sliders;
  - utility overrides;
  - a results grid, warnings and an always-visible assumptions box;
  - the selected component's card;
  - a live McCabe-Thiele diagram;
  - in Advanced mode, the column temperature and composition profile.

**Simple | Advanced** (how the engine calculates):

- **Simple:** constant relative volatility α, constant molar overflow (CMO), 1 atm, q
  typed in directly. It offers four mixtures: benzene–toluene, hexane–heptane,
  methanol–ethanol and methanol–water. Its temperatures are labelled "≈ estimate".
- **Advanced:** real vapour–liquid equilibrium (Antoine vapour pressures, NRTL or
  ideal liquid, modified Raoult's law) at a chosen column pressure. It takes a feed
  temperature (q is computed from enthalpies), steps a tray temperature profile and
  computes the reboiler duty from an energy balance. It adds ethanol–water and
  propane–butane.

There is also a **Components** page (every component card, for revision) and a
**Cutaway** toggle that opens the shell in half-section. Each component card has six
sections: what it is, how it works, key equations (KaTeX), live values, typical design
values, and what goes wrong.

### Default numbers to anchor the rest of this guide

Methanol–water, F = 1,000 kg/h, xF 0.50, xD 0.95, xB 0.05, R 2.5, saturated-liquid feed,
E_o 0.70 (computed for this guide):

| | Simple | Advanced |
|---|---|---|
| Theoretical stages N (fractional) | 5 (4.95) | 6 (5.31) |
| Actual trays | 6 | 8 |
| Rmin | 0.445 | 0.558 |
| Top / bottom temperature | ≈ 65.5 / ≈ 96.7 °C | 65.3 / 92.5 °C |
| Qc / Qr | 737 / 737 kW | 690 / 695 kW |
| CMO consistency gap | n/a | −13.7 % |
| Utilities chosen | CW, LP steam | CW, LP steam (ΔT 55.5 °C) |

The difference between the two columns is itself a lesson: constant α does not capture
how methanol–water's α changes with composition. The lecture's step 8 makes exactly
that point.

---

## 2. Architecture and data flow

### The one-sentence version

One piece of **state** goes into one function, **`solve()`**. That function returns one
**`Results`** object, and everything you see (the 3D plant, the flow particles, the
panel, the cards, the charts and the lecture captions) is drawn from that `Results`.

```
   user input (slider, switch, lecture step, clicker key)
                    |
                    v
   +-------------------------------------------+
   |  AppState (src/app/state.ts)              |
   |  view, inputs, cutaway, selected part,    |
   |  lecture id, step                         |
   +-------------------------------------------+
                    |  inputs only (memoised: a view-only
                    |  change never re-runs the engine)
                    v
   +-------------------------------------------+
   |  solve(inputs)   src/engine/solve.ts      |
   |   validate -> solveSimple | solveAdvanced |
   |   never throws; never returns NaN         |
   +-------------------------------------------+
            |                         |
     ok: Results               ok: false + error code
            |                  (UI shows a banner and keeps the
            |                   last good plant, greyed)
            v
   +---------------+---------------+--------------------------+
   | 3D scene      | Explore panel | cards / charts / lecture |
   | plant.ts      | panel.ts      | cards.ts, mccabe.ts,     |
   | flow.ts       | results grid, | profile.ts, presenter.ts |
   | labels, pins  | warnings      | (captions use live r)    |
   +---------------+---------------+--------------------------+
```

### A process-engineering analogy

Think of it as a control room:

- **`AppState`** is the set of setpoints on the panel.
- **`solve()`** is the process simulator. You change a setpoint, it re-converges and
  publishes one consistent snapshot.
- **The scene, panel, cards and charts** are the displays. They read the snapshot and
  never calculate anything themselves.

Because all the displays read the same snapshot, they cannot disagree. The tray count
in the 3D model, the steps in the McCabe-Thiele diagram and the number in the caption
all come from one stepping calculation.

### Three layers with strict boundaries

1. **Engine (`src/engine/`):** pure TypeScript with no access to the page (no DOM) and no
   3D. It takes inputs and returns numbers. This is why it can be tested on its own,
   thousands of times, in seconds.
2. **App (`src/app/`):** the state store and all the HTML parts: the top bar, panel,
   cards, Components page, charts, lecture presenter and progress tracking.
3. **Scene (`src/scene/`):** Three.js. It builds the plant from `Results` and animates
   the camera and particles.

`src/main.ts` wires the three together. It creates the store, mounts the UI pieces,
creates the scene, and subscribes `syncPlant`, which rebuilds the plant and flow
whenever a new successful result arrives.

### Important design details

- **Memoised solve.** The store re-runs `solve()` only when the inputs object changes.
  Clicking a tray, toggling the cutaway or moving to the next lecture step that does
  not change inputs costs nothing in the engine.
- **"Last good result."** If you drag xD below xF mid-slide, `solve()` returns
  `{ ok: false, error: { code: 'INVALID_COMPOSITION', ... } }`. The banner explains it,
  and the 3D plant stays at the last valid design, drawn at half opacity. Nothing
  shows NaN, and nothing crashes. `store.lastOk()` and `store.lastOkInputs()` exist
  for this.
- **Error codes, not exceptions.** Inside the engine, deep functions do throw typed
  errors: `StageLimitError` (stepping cannot finish) and `VleModelError` (the activity
  model has left its valid region). `solve()` catches every one and turns it into a
  coded result: `R_BELOW_MIN`, `AZEOTROPE`, `STAGE_LIMIT`, `OUT_OF_RANGE`, `NOT_SIMPLE`,
  `UNVERIFIED` or `INVALID_COMPOSITION`. The UI only ever handles data.
- **Rebuild on every change.** The plant is thrown away and rebuilt from `Results` on
  every successful solve. That sounds expensive, but the geometry is shared and the
  materials are pooled (see bug 6.2.8), so a 120-tray rebuild takes about 18–25 ms in
  the browser.

---

## 3. Codebase map

Paths are relative to `tutorial/` unless stated otherwise.

### Repository root

| Path | What it is |
|---|---|
| `index.html` | The legacy 2D simulator (v1.1). Left unchanged. |
| `FORYEEHO.md` | This guide. |
| `docs/superpowers/specs/2026-10-27-3d-distillation-tutorial-design.md` | The design spec: what to build and the correctness rules. The binding document. |
| `docs/superpowers/plans/2026-10-27-3d-distillation-tutorial.md` | The 16-task implementation plan with interfaces and test targets. |
| `docs/superpowers/plans/reference/*.py` | Independent Python reference calculations (`nrtl.py`, `ref.py`, `adv.py`, `en.py`, `q.py`). |
| `.superpowers/sdd/.../progress.md` | The build ledger: every ruling, deferred item and fix round. Git-ignored, local only. |

### `tutorial/` top level

| Path | What it is |
|---|---|
| `package.json` | Scripts (`dev`, `test`, `build`, `preview`, `derive-alpha`) and pinned dependencies. |
| `vite.config.ts` | Build and test config. `base: './'` makes the build work from any folder or host. |
| `tsconfig.json` | TypeScript in strict mode. |
| `vercel.json` | Vercel build command and output folder. |
| `index.html` | The page shell: one `#stage` div. Everything else is built by `src/main.ts`. |
| `README.md` | Commands, browser support, mixtures and data sources. |
| `scripts/derive-simple-alpha.ts` | Re-derives the Simple-mode α values from the Advanced VLE and fails on drift. |
| `reference/spike-3d-column-v2.html` | The throwaway 3D prototype. Geometry ideas were reused, the code was not. |

### Engine (`src/engine/`): no DOM, no 3D

| File | One line |
|---|---|
| `types.ts` | The contracts: `Inputs`, `Results`, `SolveResult`, warning and error codes. |
| `components.ts` | Pure-component data (MW, Tb, Tc, λ at Tb, cpL, cpV, Antoine with its NIST range), each with its source. |
| `antoine.ts` | `psat_bar(component, T)`, the inverse `tsat_K`, and a range check. |
| `steam.ts` | The IAPWS-IF97 saturated-steam table (1.01325–50 bar abs) with interpolation. |
| `activity.ts` | NRTL activity coefficients (γ = 1 for ideal mixtures). |
| `mixtures.ts` | The 8 mixture presets: model, NRTL parameters, Simple-mode α, defaults, and the `verified` and `simpleAllowed` flags. |
| `vle.ts` | Bubble point, dew point and azeotrope search; `VleModelError`. |
| `curve.ts` | Equilibrium curves y\*(x): analytic constant-α, or a Chebyshev-packed table of real VLE. |
| `mccabe.ts` | Stage stepping, Rmin by pinch, Nmin at total reflux, Fenske. |
| `enthalpy.ts` | Liquid and vapour enthalpies, Watson latent heat, superheated vapour. |
| `balance.ts` | Material balance, CMO internal flows, stage-to-tray mapping. |
| `profile.ts` | Stage-to-tray interpolation shared by the Advanced profile and the Simple flow colours. |
| `utilities.ts` | Condenser coolant (CW/ChW) and reboiler steam level (LP/MP/HP) selection and sizing. |
| `simple.ts` | `solveSimple`: constant α, the one self-consistent CMO energy convention. |
| `advanced.ts` | `solveAdvanced`: real VLE, q from enthalpy, energy-balance Qr, CMO gap, tray profile. |
| `solve.ts` | `solve()`: the single entry point. Validates, dispatches and maps every failure to a code. |

### App (`src/app/`): state and HTML

| File | One line |
|---|---|
| `state.ts` | The store: state, memoised solve, last good result, subscriptions, toasts. |
| `format.ts` | Number formatting (en-US grouping; no "−0"). |
| `progress.ts` | Lecture steps reached and cards viewed, in `localStorage` with a memory fallback. |
| `ui/topbar.ts` | Title, Lecture/Explore, Simple/Advanced, Cutaway, Components link. |
| `ui/panel.ts` | The Explore panel: picker, sliders, utility overrides, results, warnings, assumptions. |
| `ui/cards.ts` | Renders component cards, in the panel or as a projector-sized overlay. |
| `ui/componentsPage.ts` | All cards on one scrollable page for revision. |
| `ui/layers.ts` | Escape closes only the topmost overlay. |
| `ui/toast.ts`, `ui/dom.ts` | A transient message, and a tiny element-builder helper. |
| `content/components.ts` | The card text for every part, templated with the real chemical names and live numbers. |
| `charts/mccabe.ts` | The McCabe-Thiele diagram in hand-written SVG, drawn from the engine's own stages. |
| `charts/profile.ts` | The Advanced column profile: T, x and y down the column. |
| `charts/svg.ts`, `charts/mount.ts`, `charts/curveFor.ts` | SVG helpers, chart mounting and greying, and rebuilding the curve a result used. |
| `lecture/scripts.ts` | Lecture scripts as data. Captions are templates over live results. |
| `lecture/presenter.ts` | Applies a step, renders the caption and presenter bar, handles keys and clickers. |
| `lecture/lessons.ts` | The "Lessons" strip with a tick per step reached. |

### Scene (`src/scene/`): Three.js

| File | One line |
|---|---|
| `scene.ts` | Renderer, lights, floor, orbit controls, the time-based frame loop, shadows, resize. |
| `camera.ts` | Time-based camera flights, and framing that avoids the caption and panel. |
| `picking.ts` | Click versus drag (under 5 px counts as a click); finds the part that was clicked. |
| `plant.ts` | Builds the whole unit from `Results`: highlight, ghosting, pins, the material pool. |
| `flow.ts` | Liquid and vapour particles coloured by composition, at speeds proportional to the molar flows. |
| `labels.ts` | HTML pin labels. |
| `geometry/helpers.ts` | Shared geometry cache and material helpers (the performance model). |
| `geometry/column.ts` | Shell, 2:1 heads, skirt, nozzles, manways, platforms, ladder, sump, distributor. |
| `geometry/trays.ts` | Sieve deck, weir, downcomer apron and support ring; the liquid path. |
| `geometry/exchangers.ts` | Condenser, reflux drum, kettle reboiler and steel structure. |
| `geometry/piping.ts` | Service-coloured piping that follows the chosen utility. |

### Tests (`tests/`)

There are 21 test files and 464 tests. All passed on 2026-10-29.

- `engine/`: Antoine, steam, VLE, McCabe-Thiele, Simple, Advanced, profile, utilities and
  `solve()`, plus a 2,000-case fuzz and the error paths.
- `app/`: state, panel, cards, charts, lecture, format and legibility. These run in jsdom,
  a simulated browser page.
- `scene/`: camera, layout and geometry clearances, flow and shadows.

---

## 4. Technologies, and why each was chosen

| Technology | What it does here | Why this and not something else |
|---|---|---|
| **Vite 5** | Dev server with instant reload; bundles everything into a static `dist/` folder. | It is fast, needs almost no configuration and produces plain static files. No server is needed to run the tutorial. |
| **TypeScript 5, strict mode** | All code is typed; `tsc` runs before every build. | The engine and the UI share one contract (`Results`). Strict typing turns a renamed field, or a `null` that was not handled, into a build error instead of a blank number in front of a class. It is like a P&ID with tagged lines: a connection that does not match is visible before start-up. |
| **Three.js 0.160** | WebGL 3D: meshes, lights, shadows, orbit controls, HTML labels. | It is the standard, well-documented WebGL library, small enough to bundle. Raw WebGL would be far more code. Game engines are far heavier. |
| **Procedural geometry** (built in code) instead of a CAD model | Every shell, tray, nozzle and pipe is generated from numbers. | A CAD or glTF model is fixed: it cannot grow from 6 to 40 trays, move the feed tray or change its utility piping when the calculation changes. Procedural geometry makes the 3D model a *view of the calculation*. It also has no model files to license, download or keep in sync. The cost is more code (`geometry/` is about 1,300 lines). |
| **KaTeX 0.16** | Renders the card equations. | It is fast and synchronous (no flicker), and its fonts can be bundled. MathJax is heavier. |
| **Hand-written SVG charts** | McCabe-Thiele and profile charts. | Two charts do not justify a charting library. SVG is crisp on a projector at any size, and the chart is drawn from the engine's own stages, so it cannot disagree with the numbers. |
| **Plain DOM, no framework** (no React or Vue) | The panel, cards and presenter are built with small helper functions. | The UI is modest, and a store with `subscribe()` is enough. A framework adds build complexity, version churn and a second "state" system. Data-driven text goes in as text nodes; the only `innerHTML` is static labels (slider names with subscripts) and KaTeX's own output. That closes off script-injection mistakes from live values. |
| **Vitest + jsdom** | The test runner, with a simulated browser page for UI tests. | Vitest uses Vite's own configuration and runs TypeScript directly. jsdom lets the panel, cards and lecture be tested without a real browser. Engine tests run in plain Node. |
| **vite-node** | Runs `scripts/derive-simple-alpha.ts`. | It ships with Vitest, so no new dependency was needed. |
| **Bundled, no CDN** | Three.js, KaTeX and the KaTeX fonts are all inside `dist/`. UI text uses system fonts. | Lecture halls often have poor Wi-Fi. A page that fetches libraries from the internet at run time can fail in the middle of a lecture. This one works offline once loaded, and from any static host. |
| **Vercel** | Static hosting (your decision in the spec). | It is free for static sites and gives a stable link students can bookmark. `vercel.json` sets the build. The Vercel project's Root Directory must be `tutorial`. |

Dependency versions are pinned exactly for Three.js (0.160.0) and KaTeX (0.16.9), so a
future `npm install` cannot silently change the rendering or the maths output.

---

## 5. The thermodynamics, explained

This section follows the order the engine calculates in. You know the chemical
engineering better than any code. The value here is in *how each idea became code*, and
where the code had to be more careful than a textbook.

### 5.1 Antoine vapour pressure

The engine uses the NIST WebBook form:

  log₁₀(P_sat / bar) = A − B / (T/K + C)

Each component stores its NIST constant set **with its validity range** (Tmin–Tmax of
the measurements it was fitted to).

**Why the range matters.** A correlation is an interpolation formula, not a law. Outside
its fitted range it can drift without warning. Two real cases from this build:

- **Propane at 1 atm.** Propane's NIST set covers 277.6–360.8 K. Its 1-atm boiling point
  is 231.1 K, far outside that range. At 1 atm the set misses the boiling point by
  about 2.3 °C, which was checked during the design. That is one reason propane–butane
  runs at 18 bar abs, where the condenser end sits inside the range (the bottoms still
  exceed it, see below).
- **Mild extrapolation is often fine.** Benzene's set, extrapolated to 381.5 K (the
  benzene–toluene bottoms), gives 2.24 bar against about 2.26 bar real. Warning on every
  default benzene–toluene run would be a false alarm.

**The rule the engine uses** (a recorded ruling, refined twice):

- warn when T is more than **30 K** outside a component's NIST range;
- *always* warn when T is at or above the component's critical temperature Tc.

Propane–butane at 18 bar trips the second rule. The bottoms boil at about 103 °C
(376.6 K at x = 0.05), above propane's Tc of 369.8 K. Propane's P_sat is then a number
extrapolated past the critical point, and the warning says so.

### 5.2 Modified Raoult's law with NRTL

For each component i:

  yᵢ · P = xᵢ · γᵢ · Pᵢˢᵃᵗ(T)

where γᵢ is the liquid activity coefficient and the vapour is treated as ideal. With γ = 1
this is ideal Raoult's law. The engine uses:

- **NRTL** for methanol–water, ethanol–water, isopropanol–water and acetone–water.
  The parameters use the Aspen Plus APV databank form:
  τᵢⱼ = aᵢⱼ + bᵢⱼ/T, Gᵢⱼ = exp(−0.3 τᵢⱼ).
- **γ = 1** for benzene–toluene, hexane–heptane, methanol–ethanol and propane–butane.
  These are near-ideal pairs; each card states the choice.

A **bubble point** is found by bisection on T: find T such that Σ xᵢγᵢPᵢˢᵃᵗ(T) = P. The
bracket is 150–650 K, and it was verified to contain exactly one root for every preset
from 0.5 to 25 bar. Bisection is slower than Newton's method but cannot jump out of the
bracket, and that robustness is what matters here.

**Why ideal Raoult fails for aqueous mixtures.** Water and short alcohols repel each other
in the liquid (positive deviation, γ > 1). Each molecule "escapes" more easily than ideal
theory predicts, so the real mixture boils *lower* than ideal Raoult says. For example,
methanol–water at x = 0.95 has γ = [1.0009, 1.607]: water there behaves as if it had 60 %
more vapour pressure.

Ethanol–water at 1 atm, computed for this guide with the engine's own Antoine constants:

| x ethanol | Measured T (Carey and Lewis) | NRTL | Ideal Raoult |
|---|---|---|---|
| 0.072 | 89.0 °C | 88.1 °C | 97.6 °C |
| 0.124 | 85.3 °C | 85.1 °C | 96.1 °C |
| 0.234 | 82.7 °C | 82.3 °C | 93.0 °C |
| 0.894 | 78.15 °C | 78.15 °C | 79.9 °C |

Ideal Raoult is about **10 °C too hot** in the dilute region, which is exactly where the
bottom of an ethanol column operates. It also predicts no azeotrope at all, since its
y\*(x) never crosses y = x. NRTL reproduces the measurements: the bubble-point mean
absolute error is 0.24 °C for ethanol–water and 0.12 °C for methanol–water, and the
model azeotrope is x = 0.895 at 78.15 °C (literature 0.89, 78.2 °C).

So for these pairs, γ is not a refinement. Without it the column design is wrong.

### 5.3 Constant molar overflow (CMO) and its energy-balance gap

CMO assumes that each mole of vapour condensing on a tray boils exactly one mole of
liquid, so L and V are constant within each section:

- L = R·D and V = (R + 1)·D above the feed;
- L′ = L + q·F and V′ = V − (1 − q)·F below it.

That gives straight operating lines, which is the whole basis of McCabe-Thiele.

CMO is exactly true only when the components have equal molar latent heats. The tutorial
treats this honestly in two different ways:

- **Simple mode** uses the one self-consistent CMO energy convention: one molar λ for
  the system (the mean of the components' λ at their normal boiling points), saturated
  liquid at h = 0, and feed enthalpy h_F = (1 − q)·λ. Then Qc = V·λ and Qr = V′·λ
  exactly, and the overall energy balance closes identically. The identity holds by
  construction; the tests pin Qc = Qr at q = 1 (156.388 kW for the benzene–toluene
  reference).
- **Advanced mode** steps the stages with CMO lines (the standard "McCabe-Thiele with
  real equilibrium" method, stated on screen). The duties use real enthalpies:
  - Qc ≈ V·λ_mix at the top. The engine computes V·(h_V(xD, T_dew) − h_L(xD, T_bub)),
    which includes a small sensible-heat term;
  - **Qr comes from the overall energy balance:** F·h_F + Qr = D·h_D + B·h_B + Qc.

  Because the stepping assumed CMO but the duty used real enthalpies, Qr does not equal
  V′·λ(bottom). The engine reports the difference as the **"CMO consistency"** figure.
  For the methanol–water defaults it is −13.7 %, and a warning appears above ±5 %. The
  cause is that methanol's molar λ (35.2 kJ/mol at Tb) is below water's (40.7 kJ/mol).

This gap is deliberately shown, not hidden. It is a teaching point: it tells students how
far the textbook assumption is from the energy balance for their mixture.

### 5.4 Feed condition q from enthalpies (Advanced)

In Advanced mode you set the feed temperature, and the engine computes:

  q = (H_V,sat − H_F) / (H_V,sat − H_L,sat)

with every enthalpy evaluated at the feed composition and column pressure. The reference
state is each pure liquid at 298.15 K. H_F depends on where the feed temperature falls:

- **below the bubble point:** subcooled liquid, H_F = h_L(T), so q > 1;
- **between bubble and dew point:** an isothermal flash gives the vapour fraction β.
  The closed-form binary Rachford-Rice root is used, so q = 1 − β, between 0 and 1;
- **above the dew point:** superheated vapour, H_F = h_V(T_dew) + cp_V·(T − T_dew),
  so q < 0.

Independent reference values (from `q.py`) for methanol–water, xF 0.5, 1 atm:

| Feed T | q |
|---|---|
| 40 °C | 1.0674 |
| 80 °C | 0.3489 |
| 90 °C | −0.0051 |
| 110 °C | −0.0253 |

The superheated branch has its own bug story (6.2.4).

### 5.5 McCabe-Thiele stepping

The engine steps from the top, starting at (xD, xD):

1. Go across to the equilibrium curve to find the liquid xₙ in equilibrium with yₙ.
2. Go down to the operating line to find yₙ₊₁. This is the rectifying line while x is
   above the q-line intersection, and the stripping line after it. The first stage
   whose x falls at or below the intersection is the **optimal feed stage**.
3. Repeat until x ≤ xB. The last, partial step gives the **fractional** stage count
   (for example 5.31).

The conventions, which the legacy engine got wrong (6.1.2):

- **The partial reboiler is an equilibrium stage. The total condenser is not.**
- Theoretical trays = N − 1.
- Actual trays = ⌈(N − 1) / E_o⌉.
- Actual feed tray = min(⌈feed stage / E_o⌉, actual trays).

For the Simple defaults: N = 5, so there are 4 theoretical trays and ⌈4/0.7⌉ = 6 actual
trays, with the feed on stage 3, which is tray ⌈3/0.7⌉ = 5. The lecture caption says
exactly this.

**Tray temperatures (Advanced).** Each stage temperature is the bubble point of its liquid
xₙ. Actual trays are interpolated between theoretical stages, and the tray card says
"interpolated". A good lecture talking point: in the default case, tray 1 shows 67.1 °C,
but the "Top" label shows 65.3 °C. The top label is the bubble point of the condensate at
xD = 0.95, while tray 1's liquid is leaner (x ≈ 0.84) and therefore hotter.

### 5.6 Minimum reflux: the pinch method, and why Underwood is not enough

**Rmin by pinch** is the smallest R for which *neither* operating line touches or crosses
the equilibrium curve anywhere in [xB, xD]. The engine finds it by bisection on R. At each
trial R it checks a 401-point grid plus every node of the equilibrium table, then refines
every local minimum of the gap (curve minus operating line) with a golden-section search.

There are two kinds of pinch:

- **Feed pinch:** the lines touch the curve at the q-line intersection. This is the
  classic case.
- **Tangent pinch:** an operating line touches the curve *somewhere else*, tangentially,
  before the intersection reaches the curve. Ethanol–water at high xD does this,
  because its curve bends towards y = x near the azeotrope.

**The closed-form Underwood/King expression** used in the legacy engine,

  Rmin = [xD/xF − α(1 − xD)/(1 − xF)] / (α − 1),

is valid only for a saturated-liquid feed (q = 1) with constant α. More generally,
Underwood's method assumes constant α and CMO, so it cannot see a tangent pinch on a
non-ideal curve. Two illustrations from the tests:

- **α = 2.5, xF 0.5, xD 0.95, xB 0.05:** at q = 1 the pinch method gives Rmin = 1.100,
  identical to Underwood/King (this is kept as a cross-check test). At q = 0.5 the true
  Rmin is 1.499, but the q = 1 formula still says 1.100, a 27 % underestimate.
- **Ethanol–water, xF 0.1, xD 0.84 (Advanced):** a tangent pinch in the rectifying
  section gives Rmin = 1.614. Looking only at the q-line intersection gives about 1.137,
  roughly 30 % too low. A design at "1.3 × Rmin" from the wrong value would be below
  the true minimum reflux and could not make the separation at all.

Close to a tangent-pinch Rmin, the stage count rises steeply: about 140 stages at 1.01 × Rmin
for ethanol–water at xD 0.84 (the exact number depends on xB; for example 142 at
xB = 0.01). That is real physics, not a bug. Closer still, stepping hits
the engine's 300-stage limit, and `solve()` reports `STAGE_LIMIT` with a "very close to
minimum reflux" message rather than crashing.

### 5.7 Minimum stages: total-reflux stepping

At total reflux both operating lines become y = x. **Nmin** is the number of steps between
the curve and the diagonal:

- **Advanced** steps on the real curve. That is valid even for strongly non-ideal
  mixtures (methanol–water Nmin = 4.29).
- **Fenske**, Nmin = ln[(xD/(1 − xD))·((1 − xB)/xB)] / ln α, assumes constant α. Simple
  mode uses it. Advanced shows it only as a labelled shortcut using the geometric-mean α
  (4.04 for methanol–water), because it is invalid near an azeotrope.

For an ideal constant-α system, total-reflux stepping and Fenske should agree. The test
(α = 2.5) gives 6.53 against 6.43, within its half-stage tolerance.

### 5.8 Watson latent heat

Latent heat falls with temperature and reaches zero at the critical point. The engine
uses the Watson (1943) correlation with exponent 0.38:

  λ(T) = λ(Tb) · [ (1 − T/Tc) / (1 − Tb/Tc) ]^0.38

The vapour enthalpy is built as "heat the liquid to T, then vaporise at T":
h_V(T) = h_L(T) + λ(T), with ideal mixing. This is correct for *saturated* vapour, but it
has a trap for superheated vapour (bug 6.2.4). Above Tc, λ is clamped to 0, never NaN.

### 5.9 IAPWS-IF97 steam

The steam side uses a 14-node saturated-steam table from IAPWS-IF97 (1.01325 to 50 bar
abs). Tsat is interpolated linearly in ln P, and h_fg linearly in P. The tabulated h_fg
values are within about 0.06 % of IF97. Tsat at 1 atm is 0.026 °C off, which is within
the spec's 0.2 % tolerance. The three steam headers:

| Level | Gauge pressure | Tsat (from the app's IF97 table interpolation) |
|---|---|---|
| LP | 3.5 barg | ≈ 148.1 °C (true IF97 ≈ 147.9 °C) |
| MP | 10 barg | ≈ 184.2 °C (true IF97 ≈ 184.1 °C) |
| HP | 40 barg | ≈ 251.9 °C (true IF97 ≈ 251.8 °C) |

**Pressures are bar absolute everywhere, except steam levels, which are labelled barg**,
with barg + 1.01325 = bar abs. Mixing the two is a classic source of 1-bar errors.

### 5.10 Utility selection

**Condenser** (minimum approach 10 °C at the coolant outlet):

1. Cooling water (default 30 → 40 °C) if Tcond ≥ CW return + 10 °C.
2. Otherwise chilled water (7 → 12 °C) if Tcond ≥ ChW return + 10 °C.
3. Otherwise the warning "needs refrigeration — outside this tool", with no fake results.

Coolant flow = Qc / (cp_w·ΔT_w). Area = Qc / (U·LMTD), with the condensing side
isothermal at Tcond and U = 800 W/m²K.

**Reboiler:** the cheapest steam level giving Tsat − Treb ≥ 20 °C (LP, then MP, then HP),
otherwise "needs hot oil / fired heater". Steam flow = Qr / h_fg. Both sides change phase
(steam condenses, the process liquid boils), so the driving force is the plain
**ΔT = Tsat − Treb, not an LMTD**. Area = Qr / (U·ΔT), with U = 1000 W/m²K.

In Explore you can override the utility. An infeasible override, such as cooling water
for a 25 °C condensing vapour, gives a clear warning with flows and areas set to zero,
never invented numbers.

---

## 6. Bugs found and fixed

There are two groups. The first is the eight errors in the legacy `index.html` engine,
which the design deliberately did not carry over (spec §5.7). The second is the bugs that
appeared *during* this build and were caught by tests or reviews. Each entry gives the
symptom, the root cause, the fix and the lesson.

### 6.1 The eight legacy-engine errors (spec §5.7)

**6.1.1 Rmin formula valid only for q = 1**
- *Symptom:* the same Rmin whatever the feed condition.
- *Root cause:* the closed-form Underwood/King expression (legacy line ~1117) assumes a
  saturated-liquid feed and constant α. For α = 2.5 and q = 0.5 it gives 1.10 against
  the true 1.50, and it cannot see tangent pinches at all.
- *Fix:* the pinch method on the actual curve, for both operating lines (5.6). The old
  formula is kept only as a q = 1 cross-check test.
- *Lesson:* a closed-form shortcut carries hidden assumptions. Use it only where those
  assumptions hold, and test that boundary.

**6.1.2 The partial reboiler counted as a tray**
- *Symptom:* one tray too many before the efficiency division. The legacy code computed
  `Na = Math.ceil(N / 0.70)` (line ~1148). For the Simple defaults that gives ⌈5/0.7⌉ = 8
  instead of ⌈4/0.7⌉ = 6 trays. The 0.70 efficiency was also fixed in the code rather
  than an input.
- *Root cause:* the reboiler is an equilibrium stage but not a tray.
- *Fix:* theoretical trays = N − 1, and actual trays = ⌈(N − 1)/E_o⌉.
- *Lesson:* write down the counting convention explicitly. Off-by-one errors live in the
  conventions, not the arithmetic.

**6.1.3 The q formula treated every hot feed as liquid sensible heat**
- *Symptom:* a two-phase or superheated feed still came out near q = 1.
- *Root cause:* `q = (λ + cp(Tb − T))/λ` is only the subcooled-liquid branch. It also used
  a mole-fraction-weighted *average of boiling points* as the bubble point. For methanol–
  water xF 0.5 that gives 82.35 °C against the real bubble point of 73.16 °C. As a result,
  an 80 °C feed (truly two-phase, q ≈ 0.35) came out at q ≈ 1.005, "slightly subcooled".
- *Fix:* q from enthalpies at column pressure, with a real flash between bubble and dew
  points (5.4). Simple mode takes q directly as an input.
- *Lesson:* check a formula across every regime it will meet, not just the one it was
  derived for.

**6.1.4 A hidden `Qr × 1.08`**
- *Symptom:* the reboiler duty was 8 % above the energy balance, with no explanation.
- *Root cause:* an undocumented heat-loss allowance (legacy line ~1114).
- *Fix:* an explicit "heat loss, % of Qr" input, default 0 %, shown on screen.
- *Lesson:* no hidden fudge factors. Any correction must be visible, named and justified.
  This is one of the spec's anti-goals.

**6.1.5 A kettle reboiler "LMTD" built from steam and condensate temperatures**
- *Symptom:* a wrong reboiler area.
- *Root cause:* with condensing steam on one side and a boiling pool on the other, both
  sides are isothermal. An LMTD built from steam-supply and condensate temperatures has
  no physical meaning there.
- *Fix:* ΔT = Tsat − Treb, and A = Qr/(U·ΔT).
- *Lesson:* choose the driving force from the physics of each side, not from a habit.

**6.1.6 Linear fits for steam Tsat and λ**
- *Symptom:* `condT = 100 + (P − 1)·7.5` gives 130 °C at 5 bar. The truth is 151.8 °C, a
  22 °C error in the reboiler driving force.
- *Root cause:* Tsat(P) is strongly curved, and a straight line through 1 bar cannot
  follow it.
- *Fix:* the IAPWS-IF97 saturation table with ln P interpolation (5.9).
- *Lesson:* use standard property data when it exists, and interpolate in the variable in
  which the function is nearly linear (ln P for vapour pressure).

**6.1.7 Column pressure ignored**
- *Symptom:* propane–butane was calculated at its 1-atm boiling points (−42 °C and
  −0.5 °C), which no plant would use with cooling water.
- *Root cause:* the pressure input did not reach the VLE.
- *Fix:* Advanced mode uses real VLE at the column pressure, with propane–butane at 18 bar
  abs. Simple mode excludes that preset.
- *Lesson:* if an input is shown, it must change the calculation. Otherwise remove it.

**6.1.8 Undocumented "real-plant" corrections**
- *Symptom:* `R_eff = R(1 + 0.10·min(max(0, 1 − q), 1.5))` (legacy line ~1074), plus an
  overhead superheat term.
- *Root cause:* no derivation or source. At steady state R is a specification, and the
  top-tray vapour is at its dew point.
- *Fix:* both terms were dropped (your decision in the spec).
- *Lesson:* a teaching tool must teach the textbook model, stated with its assumptions,
  not unsourced plant folklore.

### 6.2 Bugs found during this build

**6.2.1 The dew-point solver silently returned wrong states (Task 3)**
- *Symptom:* the reviewer ran a bubble → dew round trip across the presets and pressures.
  In about 500 cases the dew point returned a liquid x that was *not* in equilibrium with
  the given y. The worst error was |Δx| = 0.70 (Task 3 review probe; see task-3-report). There was
  no error and no warning.
- *Root cause:* NRTL with these parameters predicts a spurious liquid–liquid split in
  some regions (isopropanol–water and acetone–water, especially at higher pressure).
  There, y\*(x) is not monotone, so one vapour y has several candidate liquids. A
  warm-started fixed-point iteration happily converged to a wrong one.
- *Fix:* the dew point is now a bisection on x inside the single grid cell where y\*(x)
  crosses y. When the model's curve is non-monotone around that y, the solver throws
  `VleModelError` ("the activity model predicts a liquid phase split … outside the
  model's validity"). Every returned state is re-verified: bubble(x).y must equal y to
  1e-6. After the fix there were 0 mismatches, and 598 cases now fail *loudly* inside
  the split windows instead of returning wrong answers.
- *Lesson:* **a wrong answer that looks right is the worst failure mode.** Prefer a solver
  that can say "I don't know" over one that always returns something. Then verify the
  output against the defining equation.

**6.2.2 VLE curve interpolation 25× less accurate than required near x → 0 (Task 4)**
- *Symptom:* the requirement was |y\* error| ≤ 1e-4 between table points. The first
  equilibrium table (400 equal intervals) had an error of 2.46e-3 at interval midpoints
  for acetone–water, about 25 times the limit. The original test passed anyway, because
  it only checked points *at* the table nodes, where interpolation is exact by definition.
- *Root cause:* y\*(x) for aqueous mixtures is very steep near x = 0, and equal spacing
  wastes points in the flat middle.
- *Fix:* end-packed (Chebyshev) nodes, xᵢ = (1 − cos(πi/400))/2, which put points densely
  near both ends. The worst midpoint errors fell to 8.75e-5 (acetone–water), 6.2e-5
  (isopropanol–water) and 2.8e-5 (ethanol–water). The new test checks the midpoint of
  *every* interval.
- *Lesson:* test an interpolant *between* its nodes. A test that samples only the nodes
  can never fail.

**6.2.3 Tangent-pinch Rmin underestimated (Task 4)**
- *Symptom:* for ethanol–water xD 0.84, Rmin came out as 1.614036, below a 20,000-point
  brute-force answer of 1.614102. The error is small, but it is on the unsafe side: a
  minimum reflux must not be underestimated.
- *Root cause:* the feasibility check sampled a fixed grid. A tangent touching point
  between grid points was missed, so slightly-too-low R values looked feasible.
- *Fix:* a "breakpoint-aware" check that includes every node of the curve table (where
  the piecewise-linear gap can reach its minimum), plus a golden-section refinement of
  each local minimum, with an R tolerance of 1e-9. The result is 1.6141166 against a brute
  force of 1.6141165. Rmin = 0 is now returned exactly when R = 0 is already feasible.
- *Lesson:* when you search for a minimum on a piecewise function, the breakpoints are the
  candidates. Check a numerical method against brute force on the same curve.

**6.2.4 A superheated feed gave q > 0 (Task 5)**
- *Symptom:* propane–butane feed superheated to 120 °C at 18 bar gave q = +0.116. A
  superheated feed must have q < 0.
- *Root cause:* the plan's recipe used h_V(T) = h_L(T) + λ_Watson(T) for the superheated
  feed too. With a constant liquid cp, that implies a vapour heat capacity of
  cp_L + dλ/dT. Watson's λ falls steeply with T, so this "effective vapour cp" was about
  1 J/(mol·K) for methanol at 350 K (the real value is about 44) and *negative*
  (−76 J/(mol·K)) for propane. Superheating the vapour therefore barely raised, or even
  lowered, its enthalpy.
- *Fix:* above the dew point, H_F = h_V(xF, T_dew) + cp_V,mix·(T − T_dew). The
  implementer flagged the departure from the plan, and it was accepted as a ruling
  because the spec ("q < 0 for superheated feed") overrides the plan's recipe. No
  saturated state or reference value changed.
- *Lesson:* a formula that is right on the saturation line can be wrong off it. Check the
  *derivative* a model implies (here dh/dT), not just its values.

**6.2.5 Acetone–water: a false azeotrope (Task 3)**
- *Symptom:* the NRTL set predicts an azeotrope at 1 atm near x = 0.956. Acetone–water has
  no azeotrope at atmospheric pressure. The feed flash for one acetone–water case also
  failed to converge.
- *Root cause:* the NRTL parameters do not represent this pair well over the full range
  (and they predict a spurious phase split at higher pressures, see 6.2.1). This is a
  *model versus reality* error, which no code-versus-code check can find.
- *Fix:* the preset is marked `verified: false` and hidden from the picker; `solve()`
  returns `UNVERIFIED` for it. Isopropanol–water is hidden the same way, because no cited
  T-x-y data had been checked for it yet. Both can be un-hidden once you supply data
  (section 10).
- *Lesson:* published parameters are not automatically valid. Validate a model against
  measurements before you put it in front of students, and hide what you cannot validate.

**6.2.6 Propane's Antoine range and the supercritical warning (Tasks 1 and 3)**
- *Symptom:* the first range rule (warn outside the strict NIST range) would warn on
  nearly every normal run. The NIST water set only starts at 344 K, and ethanol's ends at
  366.6 K, so methanol–water and ethanol–water would always warn. Meanwhile the real
  problem, propane above its critical temperature at the column bottom, needed a warning
  of its own.
- *Root cause:* "outside the fitted range" and "physically meaningless" are different
  things.
- *Fix (the rulings, in order):*
  1. Warn only beyond a 15 K margin.
  2. A proposed second water Antoine set was measured and **rejected**: the primary set
     extrapolated to 338 K gives 0.2501 bar against IAPWS 0.2503 bar, while the
     "better-ranged" set gives 0.2527 bar, which is 1 % worse.
  3. The margin was widened to 30 K, after measuring that benzene's extrapolation is
     accurate.
  4. A warning was added that *always* fires at T ≥ Tc.
- *Lesson:* set warning thresholds from measured error, not from the letter of a
  validity range. And measure before adding complexity: the "obvious" improvement
  (a second water set) was worse.

**6.2.7 16 versus 18 bar: whether cooling water can condense propane**
- *What the record shows:* the plan lists "the 16 vs 18 bar CW issue" among the bugs, and
  the spec fixes propane–butane at **18 bar abs** "so propane condenses at about 52 °C on
  cooling water". The ledger does not record the discussion itself, so I cannot tell you
  who raised it or when. It was settled before the spec was committed. The numbers below
  explain why 16 bar does not work (computed for this guide, default xD 0.95):

  | Pressure | Distillate bubble point (Tcond) | CW needs ≥ 40 + 10 = 50 °C | Engine choice |
  |---|---|---|---|
  | 16 bar abs | 48.5 °C | fails | chilled water |
  | 17 bar abs | 51.2 °C | passes by 1.2 °C | cooling water |
  | 18 bar abs | 53.9 °C | passes by 3.9 °C | cooling water |

  At 16 bar the overhead cannot be condensed with 30 → 40 °C cooling water and a 10 °C
  approach. The tool would switch to chilled water, which is the wrong lesson for an LPG
  splitter. The bottom is at about 103 °C at 18 bar, comfortably served by LP steam.
- *Lesson:* choose the column pressure from the utilities. The condenser temperature
  must clear the coolant return plus the approach, and pressure is the lever for that.
  This is standard design logic, and the tool now demonstrates it.

**6.2.8 A shader recompile on every slider move (Task 10)**
- *Symptom:* in a headless browser, the first frame after each rebuild took 186–236 ms,
  so slider dragging stuttered.
- *Root cause:* each rebuild disposed every material. Three.js then released the compiled
  GPU shader programs (nothing used them any more), so the next frame recompiled them all.
- *Fix:* **material pooling.** Each pickable part keeps its material set across rebuilds,
  reset to its default look on reuse. Sets for trays no longer shown are freed. After the
  fix, a rebuild took 5.5–11.5 ms plus 7–10 ms for the first frame. A highlight or ghost
  state never carries over (there is a test for this).
- *Lesson:* in graphics, "create" and "destroy" can each trigger hidden, expensive work.
  Measure the frame after a change, not just the change.

**6.2.9 The feed pipe ran through the downcomer apron (Task 10)**
- *Symptom:* the review found that the internal feed pipe on feed tray 5 passed through
  the downcomer apron of tray 4 above it. The reboiler vapour-return nozzle also blew
  straight into a downcomer.
- *Root cause:* the pipe was routed without considering which side each tray's downcomer
  was on. Downcomers alternate sides.
- *Fix:* the feed is delivered onto the feed tray's *inlet* side, opposite its downcomer.
  On one side it is a short stub into the gap behind the apron above (a downcomer feed);
  on the other, a pipe across the active area that stops short of the apron. The vapour
  return was moved to the back of the column, clear of both downcomer gaps. Tests now
  intersect bounding boxes of the feed pipe with every deck, ring, weir and apron, for
  several feed trays.
- *Lesson:* for a teaching model, physical realism is a correctness requirement, and it
  can be tested geometrically. (In the same spirit, the reflux drum was moved *above*
  the reflux nozzle: the prototype had it below, with no pump.)

**6.2.10 Card narratives contradicted the live numbers (Task 12)**
- *Symptom:* card text made absolute claims such as "methanol-rich vapour". Low in the
  column that is false: at the reboiler the vapour is about 28 % methanol, so mostly water.
- *Root cause:* the text described the column in general terms, while the numbers beside
  it were specific.
- *Fix:* relative wording. The vapour is "richer in methanol than the liquid it meets" and
  "grows richer as it climbs". Absolute words ("mostly water") appear only where they are
  tied to an actual composition (xD or xB). A test now forbids `(methanol|water)-rich`
  claims on the column, tray, sump and reboiler cards in both modes.
- *Lesson:* teaching text is part of the output. When it sits beside live numbers, it must
  be true for every input, not just the default.

**6.2.11 Tray temperature mislabelled as a bubble point (Task 12)**
- *Symptom:* tray 6 (methanol–water, Advanced) showed 84.07 °C labelled as the bubble
  point of its liquid, but the bubble point of the displayed x is 82.7 °C.
- *Root cause:* T and x were each interpolated linearly between stages, and the bubble
  point is not linear in x, so the interpolated T was not the bubble point of the
  interpolated x.
- *Fix:* the card computes T and γ from `bubblePoint(x_tray)` in one call, and labels x and
  y "≈ interpolated between theoretical stages". The test requires every Advanced tray's
  shown T to be within 0.05 °C of the bubble point of its shown x.
- *Lesson:* interpolating two linked quantities separately breaks the link between them.
  Interpolate the independent one, then compute the dependent one.

**6.2.12 The lecture caption offered q in Advanced mode (Task 14)**
- *Symptom:* step 9 ("Your turn"), which runs in Advanced, said "change R, q, …". In
  Advanced, q is not an input: you set the feed temperature and q is computed.
- *Root cause:* the caption template was written for one mode.
- *Fix:* mode-aware captions. Advanced says "the feed temperature" and Simple says "q".
  The test checks that the Advanced caption does not contain the word q.
- *Lesson:* every instruction to students must be checked against the mode they are in.

**6.2.13 The tray profile overshot past xB (Task 14b, a fix task inserted mid-build)**
- *Symptom:* in Advanced at the defaults, the bottom tray showed x = 0.028 and 95.8 °C. That
  is leaner than the bottoms product (xB = 0.05) and *hotter than the reboiler* (92.5 °C),
  which is impossible.
- *Root cause:* the last McCabe-Thiele step overshoots xB by construction. The final
  partial step lands at x = 0.0100. The profile interpolated the bottom tray towards that
  overshoot point.
- *Fix:* for interpolation, the reboiler node is taken as the actual bottoms state:
  x = xB, y = y\*(xB), T = Tbub(xB). Trays map onto stages 1…N−1 plus the reboiler, so the
  profile is monotone and bounded by [xB, xD]. Tray 8 now reads x = 0.056 at 91.9 °C. The
  same fix corrected the Simple-mode particle colours, which shared the bug through the
  sump colour.
- *Lesson:* a construction artefact (the overshoot of the fractional last step) must not
  leak into displayed physical quantities. Bound-check every displayed profile against
  the material balance.

**6.2.14 Frame-rate-dependent animation (designed against from the start)**
- *Symptom (in the prototype):* the throwaway spike moved the camera with
  `position.lerp(target, 0.05)` on every frame. After one second that leaves 21 % of the
  distance at 30 Hz, 4.6 % at 60 Hz and 0.06 % at 144 Hz. A flight on a projector laptop
  and on a gaming monitor would look completely different.
- *Root cause:* a per-frame constant is a per-frame rate, so speed scales with refresh rate.
- *Fix:* every motion uses the elapsed time dt in seconds, clamped to ≤ 0.05 s. Camera
  flights use exponential smoothing, k = 1 − e^(−dt/0.35 s), which gives the same flight
  at any frame rate. Particles move at speed × dt. Tests run the same three seconds at
  60 Hz and 15 Hz and require them to agree within 1 %.
- *Still open:* the orbit-controls damping (drag inertia) from Three.js is per-frame. It is
  logged as a deferred item.
- *Lesson:* anything that moves must be written as a rate per second, never per frame.

**6.2.15 Flaky wall-clock tests (Tasks 10 to 15)**
- *Symptom:* one unexplained test failure in 1 of 5 runs during Task 14.
- *Root cause:* tests that depend on the computer's speed: a "40-tray rebuild under 50 ms"
  timing assertion, and polling loops with fixed timeouts. Under the full parallel suite
  the machine is busy, and timings vary. For example, in the final run for this guide,
  the 40-tray rebuild median was 46.5 ms in the simulated browser, within 4 ms of the old
  limit.
- *Fix (Task 15):* the budget is now 150 ms in jsdom (300 ms on a CI server), and the real
  50 ms browser goal is documented. The real browser measures 18–25 ms even for a
  120-tray rebuild. Polling loops were replaced by `vi.waitFor` with a bound. The suite
  then passed three times in a row.
- *Lesson:* a test must fail only when the code is wrong. Timing goals belong in a
  measured benchmark with a generous margin, not in a tight unit-test assertion.

**6.2.16 NaN passed as "feasible" (Tasks 6 and 7)**
- *Symptom:* a NaN condenser or reboiler temperature was reported as a feasible utility.
- *Root cause:* every comparison with NaN is false. A guard written as
  `if (dT < 20) infeasible` does nothing when dT is NaN, so the code falls through to
  "feasible".
- *Fix:* negated guards, `if (!(dT >= 20)) infeasible`, which treat NaN as a failure.
  `isFinite` checks were added at the entry points, and the validation now rejects any
  non-finite input. A 2,000-case fuzz test confirms that no NaN or Infinity reaches any
  result.
- *Lesson:* write guards so that the *unknown* case fails safe, like a fail-closed valve.

**Smaller items worth knowing**
- *The azeotrope message prints three decimals.* The model azeotrope is x = 0.8954.
  Rounded to two decimals that is "0.90", which would contradict the literature 0.89
  shown elsewhere. Three decimals ("0.895") is honest.
- *A panel was measured as zero width.* For a `position: fixed` element the browser's
  `offsetParent` is null, so the plant sat hidden under the panel until the code used the
  element's bounding rectangle instead.
- *Wrong assumptions inside tests.* Task 11's plan said "top tray x ≥ 0.85". Physically,
  tray 1's liquid is leaner than xD (0.835), so the plan's assertion was wrong. The test
  now checks the reflux (= xD) instead.

---

## 7. How the numbers were verified

Your bar was "every number correct". No single kind of check can establish that. The
build used six kinds, and each one caught things the others could not.

| Method | What it is | What it caught that others could not |
|---|---|---|
| **Independent reference implementations** | Before any TypeScript was written, the plan's author wrote separate Python scripts (`docs/superpowers/plans/reference/`) for NRTL bubble points, McCabe-Thiele stepping, Rmin, Nmin, enthalpies and q. Many engine tests are pinned to those outputs (for example methanol–water Advanced N = 6, Nfrac 5.3142, Rmin 0.5576, Nmin 4.289, and the four q values in 5.4). | Coding mistakes in the engine. Two programs written separately rarely make the *same* mistake, so agreement to 1e-4 is strong evidence that both implement the method correctly. They also gave a fixed target before coding, so the tests could not be quietly tuned to whatever the code produced. |
| **Published experimental data** | Bubble points against Perry's (methanol–water) and Carey and Lewis 1932 (ethanol–water) at 1 atm; azeotrope compositions and temperatures; NIST vapour pressures; IAPWS steam. | *Model* errors that code-versus-code checks cannot see, because both programs share the same NRTL parameters. This is how the acetone–water false azeotrope surfaced and why two presets are hidden. |
| **Fuzz testing** | 2,000 random inputs (fixed seed 20261027) across all 8 mixtures, both modes and random utilities. The test asserts that `solve()` never throws, every number in an ok result is finite, and every error has a known code. | Combinations no person would think to try. It also confirmed that the "never NaN, never crash" promise holds across the whole input space, not just at the defaults. |
| **Brute force and round trips** | Rmin against a 20,000-point brute force; bubble → dew → bubble round trips over all presets at 0.5–25 bar; energy-balance closure recomputed with a *different* flash algorithm (residuals ≤ 3e-11). | Subtle numerical errors: the tangent-pinch underestimate (6.2.3) and the silent dew-point failures (6.2.1). |
| **Independent review after every task** | A separate reviewer read each task's diff against the spec and the plan, ran probes, and either accepted it or sent back a fix round. Rulings and deferred items went into the ledger. | Weak tests (the node-only interpolation test), plan errors (the superheated-feed formula, the "top tray ≥ 0.85" assertion), physical-realism errors (the feed pipe through the apron) and wrong teaching text (card narratives, the caption offering q). |
| **Real-browser checks** | Screenshots at 1920×1080 and smaller sizes, plus timing in headless Chrome. | Performance (shader recompiles), framing, and legibility from the back of a room. These cannot be seen in unit tests. |

Two habits made the tests themselves trustworthy:

- **RED before GREEN.** Each new test was first run against the *old* code and shown to
  fail for the expected reason. Only then was the fix written. A test that has never
  failed has not been shown to detect anything.
- **Mutation checks.** For example, flipping the downcomer side, or the cutaway angle,
  made exactly the matching tests fail.

One honest gap. Spec §7 asks the McCabe-Thiele tests to reproduce at least two *published
textbook worked examples*. I could not find tests that cite one. The constant-α stepping
tests are pinned to the independent Python reference instead. Adding one or two textbook
cases (for example from Wankat, or McCabe, Smith and Harriott) would close this. It is
listed in section 10.

---

## 8. Pitfalls, and how to avoid them

**NaN propagation.** NaN ("not a number") comes from 0/0, log of a negative number and
similar operations. It spreads silently through every later calculation, and every
comparison with it is false.
- *How to avoid it:*
  - validate inputs at the single entry point, `solve()`;
  - write guards as `!(x >= limit)` so NaN fails safe;
  - clamp at the edges, as the Watson λ does above Tc;
  - fuzz-test that no NaN ever reaches the output.

**Frame-rate-dependent animation.** Any "move 5 % per frame" logic runs at different speeds
on different screens.
- *How to avoid it:* express every motion per second and multiply by dt. Use
  k = 1 − e^(−dt/τ) for smoothing. Clamp dt so that a paused tab does not cause a jump.

**Shared materials leaking highlights.** In Three.js many meshes can share one material.
Change its colour to highlight tray 3, and every tray sharing it lights up.
- *How to avoid it:* give each pickable part its own material set (pooled, so rebuilds stay
  cheap). Reset pooled materials on reuse, and test that highlighting one part leaves the
  others unchanged and that a rebuild clears the highlight.

**Extrapolating correlations outside their fitted ranges.** Antoine, NRTL and Watson are all
fitted to data over a range.
- *How to avoid it:* store each range with its constants. Warn on extrapolation beyond a
  *measured* safe margin. Always warn at physical limits (Tc). Hide mixtures whose model
  has not been checked against data.

**Tests that only sample the nodes.** An interpolation is exact at its nodes, so a test
there proves nothing.
- *How to avoid it:* test at interval midpoints and other points between nodes, and
  compare with brute force.

**Wall-clock tests.** "Must finish in 50 ms" depends on the machine and what else is
running.
- *How to avoid it:* use generous budgets in unit tests, real benchmarks for real
  performance goals, and bounded `waitFor` instead of fixed sleeps.

**Teaching text that contradicts the live numbers.** A sentence that is true at the
defaults can be false after one slider move.
- *How to avoid it:*
  - template every number from `Results`;
  - prefer relative statements ("richer in methanol than…") over absolute ones;
  - make text mode-aware;
  - write tests that ban known-false phrasings.

**Mixing bar abs and barg.** The 1.01325 bar difference shifts steam temperatures by several
degrees.
- *How to avoid it:* one convention everywhere (bar abs), with the single exception labelled
  in the name (`P_barg`).

**Silent wrong answers from iterative solvers.** Fixed-point and Newton iterations can
converge to the wrong root, or to nothing.
- *How to avoid it:* bracket the root (bisection), verify the result against the defining
  equation, and throw a named error when the model leaves its valid region.

---

## 9. How good engineers think and work

These habits, more than any single technology, are what made this build trustworthy.
Most of them will feel familiar from process design and HAZOP.

1. **Spec before code.** The design spec fixed *what* "correct" means (which models, which
   conventions, which tolerances, which mistakes must not carry over) before any code
   existed. It is the design basis. When the plan's recipe and the spec disagreed (the
   uniform VLE grid in Task 4, the superheated-feed formula in Task 5), the spec won, and
   the decision was recorded.

2. **Rulings are written down, with "why" and "cost if wrong".** The ledger records every
   judgement call in a fixed form: the decision, the reason, and the cost if it turns out
   wrong. Examples are the 30 K Antoine margin, the rejected second water set, the
   accepted superheated-feed formula and the hidden presets. Months later anyone can see
   *why* the code is the way it is, like a management-of-change record.

3. **Small, reviewed steps.** The work was split into 16 tasks (plus one inserted fix task,
   14b). Each was built, tested, committed and independently reviewed before the next one
   started. A bug found in Task 4 was fixed in Task 4, not discovered in Task 15 under
   three more layers.

4. **Evidence over confidence.**
   - "Should be accurate" was never accepted; measured errors were.
   - The second water Antoine set *sounded* better and measured 1 % worse, so it was
     dropped.
   - The interpolation *looked* fine until midpoints were measured.
   - No test case was fabricated to cover a branch that no real mixture produces: Task 4
     scanned about 11,500 cases for a "tangent-stripping" pinch, found none, and said so
     rather than inventing one.

5. **Fail loudly, never silently.** A solver that throws "phase split, outside the
   model's validity" is better than one that returns a plausible wrong number. The UI
   turns every failure into a clear message and keeps the last good design on screen.

6. **Make assumptions visible.** Simple mode has an always-on assumptions box. Advanced
   mode shows the CMO gap instead of hiding it. Heat loss is an explicit input. A model
   shown without its assumptions is one of the spec's anti-goals.

7. **One source of truth.** Every display reads the same `Results`. Captions, cards, pins
   and charts never re-derive numbers on their own, so they cannot drift apart.

8. **Test the test.** Show a new test failing on the old code (RED) before writing the fix
   (GREEN). Mutate the code deliberately and check that the right test fails.

9. **Know when to stop.** Items that are real but not urgent are logged as "deferred" with
   a reason, instead of being fixed in a rush or forgotten. Section 10 lists them for
   triage.

---

## 10. Open items for you

These are the decisions and inputs only you can provide, plus the deferred items for the
final review to triage.

### Your inputs

1. **Experimental data to un-hide acetone–water and isopropanol–water.** For each pair,
   provide 5–10 T-x-y points at 1 atm from a citable source (for example DECHEMA, Perry's
   or a journal paper). They will go into `tests/engine/vle.test.ts`.
   - If NRTL matches them (bubble-point error ≤ 1 °C), the preset can be set to
     `verified: true`.
   - For acetone–water, the false azeotrope near x = 0.956 must also go. That probably
     needs different NRTL parameters, not just data. The feed-flash convergence failure
     for acetone–water (xF 0.6, 58 °C) must be fixed at the same time.
2. **Proofread the cards' "typical design values".** These were written from general
   knowledge of Sinnott and Towler, Kister, NACE SP0198 and OSHA guidance, not checked line
   by line against those sources. Examples are tray spacing, U ranges, steam levels and
   the CUI temperature band. Please check them before teaching from them.
3. **Vercel.** Nothing has been pushed or linked. When you are ready:
   - push the `feature/3d-tutorial` branch (or merge it);
   - create a Vercel project from the repository;
   - set **Root Directory = `tutorial`**.

   `vercel.json` already sets the build command and the output folder.

### Deferred items for the final review

These are recorded in the ledger. None of them affects the engine's validated numbers.

**Accessibility and layout**
- The teal text colour has a contrast ratio of 3.05:1 on some labels, below the WCAG AA
  4.5:1. A darker teal for text is proposed.
- At 1366 and 1024 px the Explore lesson strip can hide the overhead vapour line.
- Some fixed-distance camera views crop the condenser step on phones.
- 3D pins overlap on very tall or narrow views.

**Teaching content**
- Ethanol–water Advanced defaults put the feed on the bottom stage ("Feed → tray 13 of 13").
  Consider different defaults or wording.
- The tray↔stage mapping convention: tray k sits at s = 1 + (k − 0.5)(N − 1)/A, a midpoint
  convention. With E_o = 1, tray 1 never shows stage 1 exactly. Either document it or change
  it.
- Step 6 says "only 1.3 × Rmin" while step 7 calls 1.2–1.5 × Rmin the optimum. A note
  ("near-optimal but sensitive") would reconcile them.
- Tray 1 at 67.1 °C against the "Top 65.3 °C" label: explained in 5.5, and best used as a
  lecture talking point.

**Data attribution**
- MW, Tb, Tc, λ and cp are attributed generally to "Poling Appendix A / NIST". cpL at
  298 K was not individually verified.
- The U-value citations lack table numbers.

**Tests and code hygiene**
- No published textbook worked example is reproduced in the McCabe-Thiele tests (section 7).
- The tangent-stripping pinch branch is untested, because no real case was found.
- Orbit-control damping is still per-frame.
- The `curve.ts` header still says "400-interval" (the nodes are now Chebyshev-packed).
- The fuzz test takes 20–45 s of the roughly 50 s suite.

**Cosmetic**
- Task 2's commit trailer names the actual implementer model ("Claude Haiku 5.5"),
  accepted without rewriting history.

---

## 11. Appendix: commit history

From the plan commit (`06cc66b`) to the end of Task 15 there are 26 commits on
`feature/3d-tutorial`, oldest first. This guide's own commit (Task 16) comes after them.

| Task | Commits | What was built or fixed |
|---|---|---|
| 1 | `820eb85` | Scaffold, component data, Antoine |
| 2 | `20babf8` | IAPWS-IF97 steam table |
| 3 | `203cc37`, `17fa94a` | NRTL/ideal VLE; then a robust dew point and refined range warnings (6.2.1, 6.2.6) |
| 4 | `1d3a3ab`, `d11ca77` | McCabe-Thiele, pinch Rmin, Nmin; then Chebyshev nodes and breakpoint-aware Rmin (6.2.2, 6.2.3) |
| 5 | `50deb50` | Simple and Advanced solvers with energy balance (6.2.4) |
| 6 | `768b05b` | Utility selection and exchanger sizing |
| 7 | `054799c` | `solve()` facade, validation, derived Simple α, fuzz (6.2.16) |
| 8 | `0ed29dc` | App state, top bar, Explore panel |
| 9 | `5fdb6b2` | 3D scene, time-based camera flights (6.2.14) |
| 10 | `63f2f46`, `4d9f718`, `e97400b` | Procedural plant; then feed and vapour-return routing, true tray numbers, framing (6.2.8, 6.2.9) |
| 11 | `37263c3` | Composition-coloured flow particles |
| 12 | `09fd7b3`, `06fad0c` | Component cards and page; then correct narratives and tray temperature (6.2.10, 6.2.11) |
| 13 | `693b91d` | McCabe-Thiele and profile charts |
| 14 | `7f9029a`, `6e38d1d` | Lecture mode, lessons, progress; then caption fixes (6.2.12) |
| 14b | `db06141` | Tray profile ends at xB (6.2.13) |
| 15 | `5ad4fe9`, `9d4961a`, `7a7be53`, `9fe810d`, `c416fae` | Projector legibility, responsive layout, teardown, camera framing, test hardening (6.2.15), verification pass |
| 16 | (this commit) | `vercel.json`, `tutorial/README.md`, this guide |

The test suite grew with the build: 57 tests after Task 3, 190 after Task 7, 323 after
Task 12, 392 after Task 14b, and 464 at the end of Task 15.
