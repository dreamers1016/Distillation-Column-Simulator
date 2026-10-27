# Learn Distillation — Interactive 3D Tutorial: Design

**Date:** 2026-10-27
**Owner:** Dr. Chai Yee Ho (dreamers1016)
**Builds on:** `dreamers1016/Distillation-Column-Simulator` (`index.html`, v1.1 engine)
**Look-and-feel reference:** https://learn-arduino-red.vercel.app/
**Validated spike:** `spike-3d-column-v2.html` (throwaway; geometry ideas reusable, code not)

---

## 1. Intent and why

Turn the existing 2D distillation-column simulator into an interactive 3D tutorial in the style of the "Learn Arduino" site. The moment the link opens, the user sees a realistic 3D distillation column.

Two real uses drive every decision:

1. **In lectures.** A lecturer projects it and walks the class through a worked example, step by step.
2. **Self-study.** Undergraduate students reopen the link later to revisit the example, try other mixtures, and explore the tool freely.

The owner's explicit bar: **all thermodynamic models, mathematical calculations, and mass and energy balances must be correct.** Lecturers will use it in front of students, so a wrong number is a credibility failure.

## 2. Goals, non-goals, anti-goals

**Goals**
- A realistic, interactive 3D column is the landing view. You can orbit, zoom and pan, and click any part.
- **Lecture mode:** a scripted worked example with Next/Prev (keyboard and presentation clicker), camera flights, large projector-legible captions, and live parameter changes.
- **Explore mode:** a docked control panel with live results, the full set of mixtures, and component cards.
- **Simple and Advanced calculation modes** (independent of Lecture/Explore):
  - Simple uses constant α shortcut methods.
  - Advanced uses rigorous VLE: Antoine + NRTL/ideal, tray temperatures, pressure effects.
- Component descriptions for every part of the unit operation, using the real component names of the selected mixture.
- Correct utility selection (cooling water / chilled water; LP / MP / HP steam), explained in the cards.
- A validation test suite proving the engine against literature data and textbook examples.

**Non-goals (v1)**
- Rigorous MESH / tray-by-tray enthalpy-balance (Ponchon-Savarit) simulation. Advanced mode uses real VLE with constant-molar-overflow operating lines. That is the standard textbook "McCabe-Thiele with real equilibrium data" method, and it is stated on screen.
- Multicomponent (more than 2 species) separations.
- Dynamic or transient simulation, and control loops.
- Lecturer-editable lecture scripts in the UI. Scripts are data files edited by the developer.
- User accounts, or a server-side backend.
- Hydraulic sizing (column diameter from flooding correlations, tray pressure drop). The 3D diameter is illustrative, and the column card says so. A possible v2.
- Air-cooled condensers. Owner's call: cooling water and chilled water only. Refrigeration appears only as a warning.

**Anti-goals (failure even if it "works")**
- Any number that contradicts the textbook or the literature data within the stated model assumptions.
- Hidden fudge factors. Every correction must be visible, named and justified.
- Generic "blue liquid / orange vapour" language. Text always names the actual chemicals.
- Text or labels unreadable when projected at the back of a lecture hall.
- A model shown without its assumptions. Simple mode must say it is simplified.

## 3. Experience

### 3.1 Layout and style
- Warm "lab-paper" style like the Arduino reference: cream grid background, dark ink, a teal accent, clean sans-serif type.
- Primary target is **1920×1080 projection**. It must also work well on laptops and tablets. Phones are usable but not optimised.
- Top bar:
  - title "LEARN DISTILLATION";
  - a **Lecture | Explore** switch;
  - a **Simple | Advanced** switch;
  - a **Cutaway** toggle;
  - a link to the **Components** page.

### 3.2 Lecture mode
- Full-screen 3D. A caption card (≥ 19 px body text at 1080p) shows "Step n of N · Title" and dynamic text with live numbers. A presenter bar holds Prev, step dots and Next.
- Keys: → / PageDown / Space go forward; ← / PageUp go back. Presentation clickers send PageUp and PageDown.
- Each step can:
  - fly the camera to a part;
  - set parameters;
  - switch Simple or Advanced;
  - toggle the cutaway;
  - open a component card as a large overlay.
- The lecturer can grab and rotate the model at any time, then press Next to continue.
- Clicking a part opens its card as a projector-sized overlay.
- The caption must never cover the column at 1920×1080. The camera framing accounts for the caption area.
- **v1 script** (methanol–water, 1 atm):
  1. overview
  2. feed (q)
  3. reboiler (steam level choice)
  4. inside a tray (cutaway, flow of methanol-rich and water-rich streams)
  5. condenser and reflux drum (cooling water choice)
  6. low R near Rmin (tall column)
  7. high R (short column, high duty)
  8. switch to Advanced (tray temperature profile, stage count change vs Simple)
  9. "Your turn"

  Scripts live in a data file. The structure supports adding more scripts (lessons) later.

### 3.3 Explore mode
- A docked side panel:
  - mixture picker;
  - sliders and inputs (§5.1);
  - results grid;
  - warnings;
  - selected-component card;
  - McCabe-Thiele diagram (2D, live);
  - in Advanced mode, the temperature and composition profile chart.
- The 3D model, cards, flows and labels update live as inputs change.

### 3.4 Lessons and progress
- A lesson list (the Arduino "Lessons" strip) lists available lecture scripts. v1 ships with one.
- Progress is the steps completed per script and the component cards viewed. It is stored per-browser in `localStorage`, wrapped in try/catch, and the app works without it.

## 4. The 3D model

Built **procedurally in code**. A fixed CAD model can't change its tray count with the calculation. The level of realism matches the owner's reference image (sectioned CAD-style column).

**Column**
- Shell with 2:1 ellipsoidal heads, girth seams, and a flared skirt with base ring and anchor bolts.
- Flanged nozzles: overhead vapour, reflux, feed, reboiler vapour return, bottoms.
- Bolted manways, instrument taps, platforms with railings, and a ladder.
- Bottom sump with liquid.
- A **Cutaway** toggle opens the shell in half-section.

**Trays (count = actual trays from the calculation)**
- Perforated sieve decks with an outlet weir, a downcomer apron and a support ring.
- Downcomers alternate sides on successive trays.
- A reflux distributor header sits above tray 1.
- The feed tray is marked, with an internal feed pipe.

**Exchangers and vessels**
- **Condenser:** shell-and-tube with channel heads, body flanges, tubesheets and a visible tube bundle. Utility nozzles on the channel.
- **Reflux drum:** horizontal, on saddles, with liquid inventory and a level glass.
- **Kettle reboiler:** reducer, U-tube bundle in a boiling pool, overflow weir, steam in and condensate out, on saddles.
- A steel structure supports the condenser and drum.

**Piping**
- Coloured by service, with a legend: vapour, liquid, feed, cooling or chilled water, steam.
- **Utility lines and labels change** with the chosen utility (CW vs ChW; LP/MP/HP steam).

**Flow visualisation**
- Liquid particles follow the real path: across each tray, over the weir and down the downcomer.
- Vapour particles rise through the decks.
- **Particle colour encodes composition** between a colour for the light component and one for the heavy component. A legend names them (e.g. ■ methanol ■ water). Colour comes from the stage compositions x (liquid) and y (vapour).
- Particle speed is proportional to the molar flows in each section. The rectifying section (L, V) and stripping section (L′, V′) differ visibly.

**Labels and picking**
- Pins on major parts. Tray count, feed tray, top and bottom temperatures, and product labels show real values, e.g. "Distillate: 95 mol% methanol, 626 kg/h".
- Every part is clickable, including individual trays ("Tray 3 of 9").

**Camera**
- Smooth flights to parts.
- Animation is time-based, not frame-based, so it runs at the same speed on any refresh rate.

## 5. Calculation engine

A pure, DOM-free TypeScript module, so it is unit-testable in isolation. Both modes share the input and output types.

### 5.1 Inputs

| Input | Simple | Advanced | Notes |
|---|---|---|---|
| Mixture | 4 presets: benzene–toluene, hexane–heptane, methanol–ethanol, methanol–water | all 8 presets | Owner decision: ethanol–, acetone– and isopropanol–water and propane–butane are Advanced only. They appear greyed in Simple with "Advanced only". |
| Feed flow F | ✓ (kg/h) | ✓ | converted to kmol/h with the feed's average MW |
| xF, xD, xB | ✓ mole fraction of light component | ✓ | validated xB < xF < xD |
| Reflux ratio R | ✓ | ✓ | also shown as R/Rmin |
| Feed condition | **q directly** (slider labelled subcooled / sat. liquid / two-phase / sat. vapour / superheated) | **feed T → q from feed enthalpy at column pressure** | A separate feed pressure (let-down valve) is out of scope. |
| Column pressure | fixed 1 atm | ✓ (default 1.01325 bar; propane–butane default **18 bar abs**, so propane condenses at about 52 °C on cooling water) | **Pressures are absolute (bar abs) everywhere** except steam levels, which are labelled barg. |
| Overall tray efficiency E_o | ✓ (default 0.70) | ✓ | |
| Condenser utility | auto (override in Explore) | auto (override) | §5.6 |
| Reboiler steam level | auto (override) | auto (override) | §5.6 |
| CW / ChW supply and return T | ✓ defaults 30→40 °C / 7→12 °C | ✓ | |
| Heat loss | ✓ % of Qr, **default 0 %**, shown explicitly | ✓ | replaces the hidden ×1.08 |

### 5.2 Shared balances
- **Material balance (molar):**
  - F = D + B
  - F·xF = D·xD + B·xB
- **Mass flows** use each stream's own average MW.
- **Internal flows (CMO):**
  - L = R·D
  - V = (R + 1)·D
  - L′ = L + q·F
  - V′ = V − (1 − q)·F
- **Theoretical stages vs trays:**
  - N_stages counts the McCabe-Thiele steps. **The partial reboiler is one equilibrium stage. The total condenser is not.**
  - Theoretical trays = N_stages − 1.
  - Actual trays = ⌈(N_stages − 1) / E_o⌉.
  - Report fractional stages too (e.g. 8.4).
- **Optimal feed stage:** the step where the stepping crosses the q-line intersection. Actual feed tray = ⌈feed stage / E_o⌉, clamped to the tray count. The mapping must be stated in the card.
- **Rmin by pinch (both modes):**
  - It is the smallest R for which **neither** operating line touches or crosses the equilibrium curve anywhere in [xB, xD]. "Neither" means the rectifying line and the stripping line, which is fixed by the q-line intersection.
  - This covers the q-line pinch and **tangent pinches** (needed for ethanol–water in Advanced).
  - The closed-form Underwood/King expression currently in `index.html` is valid only for q = 1. It is kept only as a cross-check test for that case.
- **Nmin:**
  - Simple: Fenske with the constant α.
  - Advanced: **stepping at total reflux (y = x) on the real curve.** Fenske with geometric-mean α appears only as a labelled shortcut comparison. It is invalid near an azeotrope.
- **Total condenser.** Reflux and distillate leave as saturated liquid.
- **Energy:**
  - **Simple mode** uses the only self-consistent CMO convention: one molar λ for the system, saturated-liquid h = 0, and feed h_F = (1 − q)·λ. Then Qc = V·λ and Qr = V′·λ (+ heat loss) exactly, and the overall energy balance closes identically.
  - **Advanced mode:**
    - Qc = V·λ_mix(T_top), with real enthalpies (§5.4).
    - **Qr comes from the overall energy balance:** Qr = Qc + D·h_D + B·h_B − F·h_F (+ heat loss). This Qr drives steam flow and reboiler area.
    - Stages are still stepped with CMO. So when the components' latent heats differ, Qr differs from V′·λ_mix(T_bottom); for acetone/water the λ ratio is about 1.4. The gap is shown as a labelled **"CMO consistency"** figure in the energy card, as a teaching point, not hidden.
    - Particle speeds use the CMO flows L, V, L′ and V′.

### 5.3 Simple mode
- Equilibrium curve: y = αx / (1 + (α − 1)x).
  - **α is derived, not hand-typed.** It is the geometric mean of α at xD and xB from the Advanced VLE model at 1 atm and the preset defaults. The value is computed once and frozen in the data file, with the derivation documented.
  - The card states where α comes from and that it is an average.
  - For methanol–water, which is moderately non-ideal, the card also notes that constant α is a textbook approximation and points to Advanced for comparison.
- Top and bottom temperatures: ideal (Raoult + Antoine) bubble points at xD and xB, labelled "≈ estimate". **No full temperature profile in Simple mode.**
- λ: constant molar latent heat (mean of the components at their normal boiling points) — the CMO assumption.
- Azeotropic pairs are not offered in Simple mode (owner decision), so Simple needs no azeotrope logic.
- An **Assumptions box**, always visible: constant α, CMO, ideal stages, 1 atm, saturated-liquid reflux.

### 5.4 Advanced mode
- **VLE:** modified Raoult's law, yᵢ·P = xᵢ·γᵢ·Pᵢˢᵃᵗ(T).
  - Pᵢˢᵃᵗ comes from Antoine (NIST WebBook form, log₁₀P[bar] = A − B/(T[K] + C)). Each constant set is stored with its validity range. A warning appears when the range is exceeded.
  - γ comes from **NRTL** for methanol–water, ethanol–water, isopropanol–water and acetone–water, using published binary parameters (source cited in code).
  - γ = 1 (ideal) for benzene–toluene, hexane–heptane, methanol–ethanol and propane–butane. The choice is stated in the card.
  - Vapour phase is ideal (fine below about 10 bar). For propane–butane at about 18 bar abs, the card states this assumption explicitly; reduced pressure there is about 0.4.
- **Equilibrium curve:** bubble-point calculation at the column pressure, solved robustly by bracketed Newton or bisection.
- **Stage stepping** on the real curve with CMO operating lines. Stage compositions xₙ and yₙ, and **stage temperature Tₙ = bubble T of xₙ**.
  - The profile per actual tray comes from linear interpolation in stage index. The card says it is interpolated.
- **Azeotrope:** found from the model (where y* = x in (0, 1)). If xD is beyond the azeotrope, the design is reported as **infeasible**, with an explanation and the azeotrope composition and temperature.
- **Feed condition:** feed T is an input. The feed is evaluated at column pressure and feed composition, with saturated enthalpies at that pressure:
  - q = (H_V,sat − H_F) / (H_V,sat − H_L,sat);
  - q > 1 for subcooled feed (liquid cp);
  - 0 ≤ q ≤ 1 for two-phase feed (q = 1 − flash vapour fraction);
  - q < 0 for superheated feed (vapour cp).
- **Enthalpies:**
  - liquid cp and vapour cp per component;
  - λᵢ(T) by the Watson correlation from λ at Tb (needs Tc);
  - ideal mixing for enthalpy.

  The reference state is documented.
- **Pressure:** constant column pressure. Pressure drop is neglected and stated.
- Outputs added: temperature and composition profile chart, γ per tray in the tray card, Simple-vs-Advanced stage comparison.

### 5.5 Physical property data
- One table per component: MW, Tb, Tc, Antoine (A, B, C, Tmin, Tmax), λ at Tb, cp_L, cp_V.
- **Every value cites its source** (NIST WebBook, Perry's Handbook, Poling et al. *Properties of Gases and Liquids*, DECHEMA or a named journal for NRTL).
- Antoine constants were pre-checked on 2026-10-27 against normal boiling points. All are within 0.2 °C except n-butane (−0.33 °C) and propane (−2.3 °C at 1 atm, which is outside its fitted range of 277–361 K). Propane–butane must therefore run in range: about 18 bar abs.
- **Steam tables:** an embedded IAPWS-IF97 saturation table (P → Tsat, h_fg) with interpolation. This replaces the linear fits in `index.html`. For example, `condT = 100 + (P − 1)·7.5` gives 130 °C at 5 bar; the true value is 151.8 °C.

### 5.6 Utilities
- **Condenser** (minimum approach ΔT_min = 10 °C):
  - cooling water (30 → 40 °C) if Tcond ≥ CW return + ΔT_min;
  - otherwise chilled water (7 → 12 °C) if Tcond ≥ ChW return + ΔT_min;
  - otherwise a warning: "needs refrigeration — outside this tool".
- Flow = Qc / (cp_w·ΔT). Area A = Qc / (U·LMTD), with the condensing side isothermal at Tcond (U defaults stated, e.g. 800 W/m²K).
- **Reboiler:** choose the cheapest steam that gives ΔT = Tsat − Treb ≥ 20 °C:
  - LP 3.5 barg (≈ 148 °C);
  - MP 10 barg (≈ 184 °C);
  - HP 40 barg (≈ 252 °C);
  - above that, a warning: "needs hot oil / fired heater".
- Steam flow = Qr / h_fg(P). **Both sides change phase, so ΔT = Tsat − Treb (not an LMTD).** A = Qr / (U·ΔT).
- In Explore mode the user can override the utility. An infeasible choice (e.g. CW at 30 °C condensing vapour at 25 °C) gives a clear warning, with no fake results.
- The 3D utility lines, colours and labels follow the selection. The condenser and reboiler cards explain *why*, with the numbers.

### 5.7 Corrections to the existing `index.html` engine (must not carry over)
1. The Rmin formula is valid only for q = 1. Replace it with the pinch method (§5.2).
2. The partial reboiler is counted as a tray. Fix: theoretical trays = N_stages − 1.
3. q formula: `q = (λ + cp(Tb − T))/λ` treats every hot feed as liquid sensible heat. It is wrong between bubble and dew point and above dew point. Replace it (§5.4, or q as an input in Simple mode).
4. Hidden `Qr × 1.08`. Replace it with an explicit heat-loss input (default 0 %).
5. Kettle reboiler "LMTD" built from steam supply and condensate temperatures is wrong for phase change on both sides. Use ΔT = Tsat − Treb.
6. Steam Tsat and λ linear fits. Replace them with steam tables.
7. Column pressure is ignored (propane–butane at 1-atm boiling points). Advanced mode uses real pressure. Simple mode excludes that preset.
8. The "real-plant" effective reflux `R_eff = R(1 + 0.10·(1 − q))` and the overhead superheat term have no derivation or source. At steady state R is a specification, and the top-tray vapour is at its dew point. **Owner decision: dropped.**

## 6. Component cards

**Components**
- Column shell, sieve tray (deck, weir, downcomer), feed tray and nozzle, reflux distributor, sump.
- Condenser, cooling or chilled water system, reflux drum, kettle reboiler, steam system.
- Mechanical items (shorter cards): skirt, manways, platforms and ladder, nozzles.

**Six sections per card**
1. **What it is:** one plain sentence.
2. **How it works:** tied to what is visible in 3D. Uses the mixture's real component names.
3. **Key equations:** KaTeX, from the existing `COMP_INFO`, corrected per §5.7.
4. **Live values:** from the current results, e.g. "Reboiler duty 1,113 kW · MP steam not needed — LP at 148 °C gives ΔT = 50 °C".
5. **Typical design values:** e.g. tray spacing 0.45–0.6 m, U ranges, steam levels.
6. **What goes wrong:** e.g. flooding, weeping, entrainment, foaming; fouling; drum level upsets; loss of cooling.

**Where cards appear**
- In the Explore panel, as an overlay in Lecture mode, and all together on a **Components page** for revision.
- The tray card highlights the deck, weir and downcomer in 3D as each is named.
- All text is templated with the mixture's component names. "Blue liquid" phrasing is forbidden.

## 7. Validation (how "correct" is proven)

An automated test suite runs on every build. Test data and sources are kept in the repo.

- **Antoine:** normal boiling points within 0.5 °C for each component, within its validity range. Propane is checked at a pressure in range against NIST.
- **NRTL:**
  - ethanol–water azeotrope x = 0.89 ± 0.01, T = 78.2 ± 0.3 °C at 1 atm;
  - isopropanol–water azeotrope x = 0.68 ± 0.02, T = 80.3 ± 0.5 °C;
  - bubble points vs published experimental T–x–y data for each aqueous pair (≥ 5 points each), with mean absolute error ≤ 1 °C.
- **Steam tables:** Tsat and h_fg vs IAPWS-IF97 reference values within 0.2 %.
- **Material balance:** overall and component closure to 1e-9 relative.
- **Energy balance:**
  - Simple: Qr = V′·λ and Qc = V·λ to 1e-9 relative.
  - Advanced: duties match an **independent hand calculation** within 0.5 % for at least two cases. The hand calculation computes enthalpies separately from the engine, not by reusing its own equation.
  - Advanced: the reported CMO-consistency gap has the sign and magnitude expected from the λ ratio.
- **McCabe-Thiele:** reproduce at least two published textbook worked examples (e.g. benzene–toluene constant α from McCabe-Smith-Harriott or Wankat) within ±0.5 stage.
- **Rmin:**
  - pinch method equals Underwood/King for q = 1 with constant α;
  - tangent pinch detected for ethanol–water (Advanced) at high xD;
  - a case where the stripping line governs the pinch.
- **Nmin (Advanced):** total-reflux stepping equals Fenske for an ideal constant-α system.
- **Simple-mode α:** the frozen values reproduce from the documented derivation.
- **Feed q:** at column pressure, q = 1 at the bubble point, 0 at the dew point, > 1 when subcooled and < 0 when superheated.
- **Edge cases:** R ≤ Rmin gives a clear error. Invalid compositions are rejected. No NaN or Infinity ever reaches the UI.

## 8. Technology

These are the builder's calls, recorded here.

- **Vite + TypeScript + Three.js.** The engine is a separate pure-TS module, tested with Vitest.
- KaTeX for equations. A light charting approach (SVG or Canvas) for McCabe-Thiele and the profiles.
- **Static build with no runtime CDN dependencies.** Three.js, KaTeX and fonts are bundled, so it works offline in lecture halls with poor Wi-Fi and from any static host (e.g. Vercel, GitHub Pages).
- The existing `index.html` stays in the repo as the legacy 2D simulator.
- Per the owner's standing instruction: a plain-language `FOR[name].md` explaining architecture, codebase structure, technology choices, the bugs found and fixed (§5.7 is a good start), pitfalls and lessons.

## 9. Decisions (2026-10-27)

**Owner**
1. **Location:** a new folder in the existing repo `dreamers1016/Distillation-Column-Simulator` (local clone `C:\Users\yeeho.chai\Distillation-Column-Simulator`). `index.html` stays as the legacy 2D simulator.
2. **v1.1 "real-plant" corrections:** dropped. Textbook balances only.
3. **Simple-mode mixtures:** near-ideal pairs plus methanol–water only. The azeotropic aqueous pairs and propane–butane are Advanced only.
4. **Deployment:** Vercel (static build).

**Builder calls from the design review** (can be revisited)
- Rmin by pinch checks both operating lines.
- Advanced Nmin uses total-reflux stepping.
- Simple mode uses the CMO energy convention. Advanced reports the energy-balance Qr plus a labelled CMO-consistency figure.
- Feed q is evaluated at column pressure.
- Pressures are in bar abs; propane–butane defaults to 18 bar abs.
- Column diameter is illustrative only.

## 10. Left to the builder
- Code structure, component and module boundaries, the state-management approach.
- Exact colours, fonts and spacing within the described style.
- Chart implementation.
- Exact camera framings and lecture caption wording (within §3.2 and §6 rules).
- Specific textbook examples and experimental datasets for tests, as long as they are cited.
