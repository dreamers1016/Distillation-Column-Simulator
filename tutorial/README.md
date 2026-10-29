# Learn Distillation: interactive 3D tutorial

An interactive 3D distillation column for lectures and self-study. A procedural
Three.js plant (column, sieve trays, condenser, reflux drum, kettle reboiler,
piping) is rebuilt from a validated McCabe-Thiele engine every time an input
changes.

- **Lecture / Explore** views: a scripted, projector-sized worked example
  (methanol-water, 9 steps, keyboard and presentation-clicker control), or a
  docked panel with every input, live results, component cards and charts.
- **Simple / Advanced** calculation modes: constant relative volatility, or
  real VLE (Antoine + NRTL or ideal liquid, modified Raoult's law) with feed q
  from enthalpies, a tray temperature profile and an energy-balance reboiler duty.

The legacy 2D simulator (`../index.html`) is unchanged and is not part of this build.

## Requirements

- Node.js 20 or newer (developed and tested on Node 24+) and npm.
- No network access is needed at run time: Three.js, KaTeX and the KaTeX fonts
  are bundled, and the UI text uses the system font stack. The built site works
  offline and from any static host.

## Commands

Run all commands from this `tutorial/` folder.

| Command | What it does |
|---|---|
| `npm install` | Install the dependencies (once). |
| `npm run dev` | Start the Vite dev server with hot reload (default http://localhost:5173). |
| `npm test` | Run the full Vitest suite once (engine, app and scene tests; about 50 s, most of it the 2,000-case solver fuzz). |
| `npm test -- vle` | Run only the test files whose names match `vle` (any file filter works). |
| `npm run build` | Type-check with `tsc`, then build the static site into `dist/`. |
| `npm run preview` | Serve the built `dist/` locally to check the production build. |
| `npm run derive-alpha` | Re-derive the frozen Simple-mode relative volatilities from the Advanced VLE model and fail if any frozen value has drifted by more than 1e-4. |

The build prints a "chunk larger than 500 kB" notice for the main bundle (Three.js
plus KaTeX). It is a size advisory, not an error.

## Deployment (Vercel)

`vercel.json` sets the build command (`npm run build`) and output directory (`dist`).
The Vercel project's **Root Directory must be set to `tutorial`**, because the
repository root also holds the legacy `index.html`. `vite.config.ts` uses
`base: './'`, so the built files also work from a sub-path or any other static host.

## Browser support

- A current desktop browser with WebGL and ES2020 support (recent Chrome, Edge,
  Firefox or Safari). The build was checked in Chromium (Chrome and the Claude
  browser pane); other browsers were not tested in this build.
- Primary target: 1920×1080 projection. Laptops and tablets are supported; phones
  are usable (the panel becomes a bottom sheet) but not optimised.
- Progress (lecture steps reached, cards viewed) is kept in `localStorage`; the app
  works normally when storage is blocked or in a private window.

## Mixtures

| Mixture | Model | Simple mode | Advanced mode | Status |
|---|---|---|---|---|
| Methanol-water | NRTL | yes (α = 4.3011) | yes | verified against Perry's T-x data (bubble-point MAE 0.12 °C) |
| Ethanol-water | NRTL | no (azeotrope) | yes | verified against Carey and Lewis (1932) (MAE 0.24 °C); model azeotrope x 0.895, 78.15 °C (lit. 0.89, 78.2 °C) |
| Benzene-toluene | ideal | yes (α = 2.4744) | yes | ideal solution |
| n-Hexane-n-heptane | ideal | yes (α = 2.4746) | yes | ideal solution |
| Methanol-ethanol | ideal | yes (α = 1.7232) | yes | ideal solution |
| Propane-n-butane | ideal | no (pressurised) | yes, default 18 bar abs | ideal vapour flagged above 10 bar; bottoms above propane's Tc flagged |
| Acetone-water | NRTL | no | **hidden** | `verified: false`: the NRTL set predicts a false azeotrope at 1 atm (x ≈ 0.956) |
| Isopropanol-water | NRTL | no | **hidden** | `verified: false`: no cited T-x-y data yet; the set predicts a spurious phase split at higher pressure |

The Simple-mode α values are the geometric mean of α at x = 0.95 and x = 0.05 from
the Advanced VLE model at 1.01325 bar (`scripts/derive-simple-alpha.ts`).

To un-hide acetone-water or isopropanol-water, add 5 to 10 cited experimental T-x-y
points at 1 atm to `tests/engine/vle.test.ts`, check the bubble-point error, and set
`verified: true` in `src/engine/mixtures.ts`.

## Data sources

- **Antoine constants:** NIST Chemistry WebBook phase-change data,
  log10(P/bar) = A − B/(T/K + C), each with its NIST validity range. Rows used:
  water (Bridgeman and Aldrich 1964), methanol and ethanol (Ambrose and Sprake 1970),
  isopropanol (Biddiscombe et al. 1963), acetone (Ambrose, Sprake et al. 1974),
  benzene, toluene, n-hexane and n-heptane (Willingham, Taylor et al. 1945),
  propane (Helgeson and Sage 1967), n-butane (Das, Reed et al. 1973).
  Per-component URLs are in `src/engine/components.ts`.
- **Pure-component properties (MW, Tb, Tc, λ at Tb, liquid and vapour cp):**
  Poling, Prausnitz and O'Connell, *The Properties of Gases and Liquids*, 5th ed.,
  Appendix A; NIST Chemistry WebBook.
- **Latent heat temperature dependence:** Watson correlation, exponent 0.38
  (K. M. Watson, *Ind. Eng. Chem.* 35 (1943) 398; Poling et al. 5th ed., eq. 7-12.1).
- **NRTL binary parameters:** Aspen Plus APV NRTL databank form
  (τij = aij + bij/T, α = 0.3).
- **Experimental VLE used in the tests (101.325 kPa):** methanol-water from the VLE
  tables of *Perry's Chemical Engineers' Handbook*; ethanol-water from Carey and
  Lewis (1932), as tabulated in Perry's.
- **Saturated steam:** IAPWS-IF97 (IAPWS R7-97(2012)), tabulated 1.01325 to 50 bar abs
  (h_fg within about 0.06 % of IF97).
- **Exchanger design values:** overall U (800 W/m²K condenser, 1000 W/m²K reboiler)
  and minimum approach temperatures (10 °C condenser, 20 °C reboiler) are typical
  values from Sinnott and Towler, *Chemical Engineering Design*. Water cp 4.18 kJ/(kg·K)
  (NIST WebBook).
- **Independent reference calculations:** the Python scripts in
  `../docs/superpowers/plans/reference/` (`nrtl.py`, `ref.py`, `adv.py`, `en.py`,
  `q.py`) were written separately from the TypeScript engine; many test values
  are pinned to their output.

## Folder layout

```
src/engine/   pure TypeScript calculation engine (no DOM), entry point solve.ts
src/app/      state store, top bar, Explore panel, cards, charts, lecture presenter
src/scene/    Three.js scene, camera flights, picking, procedural plant, flow particles
src/styles/   design tokens and app CSS
tests/        Vitest suites: engine/, app/ (jsdom), scene/
scripts/      derive-simple-alpha.ts
reference/    the throwaway 3D spike the geometry ideas came from (not built)
```

A plain-language guide to the whole project, its design decisions and the bugs
found along the way is in `../FORYEEHO.md`.
