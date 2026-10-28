// Explore panel: mixture picker, operating-condition sliders, utility overrides,
// results grid, warnings, assumptions, plus empty slots for the selected-part
// card and the charts (McCabe-Thiele and profile, src/app/charts).
//
// The controls are built once per calculation mode and then only have their
// values synced, so a slider being dragged is never rebuilt under the pointer.
// Slider input is batched: at most one store update (one solve) per frame.
import { MIXTURES, type MixtureId, type MixturePreset } from '../../engine/mixtures';
import { solve } from '../../engine/solve';
import type { CondenserResult, ReboilerResult } from '../../engine/utilities';
import type { Inputs, Results, SolveResult } from '../../engine/types';
import { componentName, fmtKgh, fmtKW, fmtNum, fmtTempC, mixtureLabel } from '../format';
import { mountCharts } from '../charts/mount';
import { setMixture, type Store } from '../state';
import { h } from './dom';

export interface PanelOptions {
  /** Defer a callback to the next frame. Defaults to requestAnimationFrame; tests pass a synchronous one. */
  schedule?: (fn: () => void) => void;
}

type Edit = (i: Inputs) => Inputs;

interface NumSpec {
  key: string; // data-input attribute
  label: (m: MixturePreset) => string; // HTML (static text and component names only)
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  get: (i: Inputs) => number;
  set: (i: Inputs, v: number) => Inputs;
}

const top = <K extends 'F_kgh' | 'xF' | 'xD' | 'xB' | 'R' | 'q' | 'feedT_C' | 'P_bar' | 'Eo' | 'heatLossPct'>(
  key: K,
  label: NumSpec['label'],
  min: number,
  max: number,
  step: number,
  fmt: NumSpec['fmt'],
): NumSpec => ({ key, label, min, max, step, fmt, get: (i) => i[key], set: (i, v) => ({ ...i, [key]: v }) });

const lightNote = (m: MixturePreset) => componentName(m.light);

const SPECS = {
  F: top('F_kgh', () => 'Feed rate F', 100, 10000, 100, (v) => `${fmtNum(v)} kg/h`),
  xF: top('xF', (m) => `Feed x<sub>F</sub> (${lightNote(m)})`, 0.02, 0.98, 0.01, (v) => fmtNum(v, 2)),
  R: top('R', () => 'Reflux ratio R', 0.3, 10, 0.05, (v) => fmtNum(v, 2)),
  xD: top('xD', (m) => `Distillate x<sub>D</sub> (${lightNote(m)})`, 0.8, 0.995, 0.005, (v) => fmtNum(v, 3)),
  xB: top('xB', (m) => `Bottoms x<sub>B</sub> (${lightNote(m)})`, 0.005, 0.2, 0.005, (v) => fmtNum(v, 3)),
  q: top('q', () => 'Feed condition q', -0.5, 1.5, 0.05, (v) => fmtNum(v, 2)),
  feedT: top('feedT_C', () => 'Feed temperature', -40, 200, 1, (v) => `${fmtNum(v)} °C`),
  P: top('P_bar', () => 'Column pressure', 0.5, 25, 0.1, (v) => `${fmtNum(v, 1)} bar abs`),
  Eo: top('Eo', () => 'Tray efficiency E<sub>o</sub>', 0.4, 1, 0.05, (v) => fmtNum(v, 2)),
  loss: top('heatLossPct', () => 'Reboiler heat loss', 0, 15, 0.5, (v) => `${fmtNum(v, 1)} %`),
};

/** q-slider ticks: the value and its feed condition, placed at the value's true fraction of the slider range. */
const Q_TICKS: [number, string][] = [
  [-0.5, 'superheated'],
  [0, 'sat. vapour'],
  [0.5, 'two-phase'],
  [1, 'sat. liquid'],
  [1.5, 'subcooled'],
];

/** Position of `v` along a slider, 0..1 (the CSS adds the thumb inset). */
export const tickFraction = (v: number, min: number, max: number): number => (v - min) / (max - min);

const UTILITY_NAME: Record<CondenserResult['utility'], string> = {
  CW: 'Cooling water',
  ChW: 'Chilled water',
  REFRIGERATION: 'Refrigeration (outside this tool)',
};
const STEAM_NAME: Record<ReboilerResult['level'], string> = {
  LP: 'LP steam',
  MP: 'MP steam',
  HP: 'HP steam',
  HOT_OIL: 'Hot oil (outside this tool)',
};

export function mountPanel(root: HTMLElement, store: Store, opts: PanelOptions = {}): () => void {
  const schedule = opts.schedule ?? ((fn: () => void) => void requestAnimationFrame(() => fn()));

  // ---- batched edits -------------------------------------------------------
  let pending: Edit[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (pending.length === 0) return;
    const edits = pending;
    pending = [];
    store.set((s) => ({ inputs: edits.reduce((i, e) => e(i), s.inputs) }));
  };
  const queue = (edit: Edit) => {
    pending.push(edit);
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  };

  // ---- controls ------------------------------------------------------------
  interface Ref {
    input: HTMLInputElement | HTMLSelectElement;
    read: (i: Inputs) => string;
    out?: HTMLElement;
    fmt?: (v: number) => string;
    label?: HTMLElement;
    labelFn?: NumSpec['label'];
    shownLabel?: string;
  }
  let refs: Ref[] = [];

  const sliderRow = (spec: NumSpec, mix: MixturePreset): HTMLElement => {
    const input = h('input', { type: 'range', 'data-input': spec.key, min: spec.min, max: spec.max, step: spec.step });
    const out = h('output', {});
    const label = h('span', {});
    const ref: Ref = { input, out, fmt: spec.fmt, label, labelFn: spec.label, read: (i) => String(spec.get(i)) };
    refs.push(ref);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      out.textContent = spec.fmt(v);
      queue((i) => spec.set(i, v));
    });
    label.innerHTML = spec.label(mix);
    return h('div', { class: 'sl' }, h('label', {}, label, out), input);
  };

  const numberField = (key: string, get: (i: Inputs) => number, set: (i: Inputs, v: number) => Inputs, aria: string): HTMLElement => {
    const input = h('input', { type: 'number', 'data-input': key, step: 1, 'aria-label': aria });
    refs.push({ input, read: (i) => String(get(i)) });
    input.addEventListener('input', () => {
      if (input.value.trim() === '') return;
      const v = Number(input.value);
      if (Number.isFinite(v)) queue((i) => set(i, v));
    });
    return input;
  };

  const selectField = (key: string, options: [string, string][], get: (i: Inputs) => string, set: (i: Inputs, v: string) => Inputs, aria: string) => {
    const sel = h('select', { 'data-input': key, 'aria-label': aria });
    for (const [value, text] of options) sel.append(h('option', { value }, text));
    refs.push({ input: sel, read: get });
    sel.addEventListener('change', () => queue((i) => set(i, sel.value)));
    return sel;
  };

  const section = (title: string, ...kids: (Node | null)[]) => h('section', { class: 'sec' }, h('h3', {}, title), ...kids);

  const buildControls = (inputs: Inputs): HTMLElement => {
    refs = [];
    const advanced = inputs.mode === 'advanced';
    const mix = MIXTURES[inputs.mixtureId];

    // Mixture picker: unverified presets are hidden; Advanced-only ones are greyed in Simple.
    const picker = h('select', { 'data-input': 'mixture', 'aria-label': 'Mixture' });
    for (const m of Object.values(MIXTURES)) {
      if (!m.verified) continue;
      const lock = !advanced && !m.simpleAllowed;
      picker.append(h('option', { value: m.id, disabled: lock }, lock ? `${mixtureLabel(m.id)} (Advanced only)` : mixtureLabel(m.id)));
    }
    refs.push({ input: picker, read: (i) => i.mixtureId });
    picker.addEventListener('change', () => {
      flush();
      setMixture(store, picker.value as MixtureId);
    });

    // Staggered in two rows (alternate ticks drop a row) so neighbouring words never collide.
    const qTicks = h(
      'div',
      { class: 'sl-ticks', 'data-ticks': 'q' },
      ...Q_TICKS.map(([v, word], j) => {
        const f = tickFraction(v, SPECS.q.min, SPECS.q.max);
        const t = h('span', { class: j % 2 ? 'sl-tick low' : 'sl-tick', 'data-value': v }, h('b', {}, fmtNum(v, v % 1 ? 1 : 0)), h('span', {}, word));
        t.style.setProperty('--f', String(f));
        return t;
      }),
    );
    const feedCondition = advanced
      ? [sliderRow(SPECS.feedT, mix), sliderRow(SPECS.P, mix)]
      : [sliderRow(SPECS.q, mix), qTicks];

    const coolant = (name: string, key: 'cw' | 'chw') =>
      h(
        'div',
        { class: 'pair' },
        h('span', {}, `${name} in / out (°C)`),
        numberField(`${key}.in_C`, (i) => i[key].in_C, (i, v) => ({ ...i, [key]: { ...i[key], in_C: v } }), `${name} inlet temperature`),
        numberField(`${key}.out_C`, (i) => i[key].out_C, (i, v) => ({ ...i, [key]: { ...i[key], out_C: v } }), `${name} outlet temperature`),
      );

    const cond = selectField(
      'condenserUtility',
      [['auto', 'Auto'], ['CW', 'Cooling water (CW)'], ['ChW', 'Chilled water (ChW)']],
      (i) => i.condenserUtility,
      (i, v) => ({ ...i, condenserUtility: v as Inputs['condenserUtility'] }),
      'Condenser utility',
    );
    const steam = selectField(
      'steamLevel',
      [['auto', 'Auto'], ['LP', 'LP, 3.5 barg'], ['MP', 'MP, 10 barg'], ['HP', 'HP, 40 barg']],
      (i) => i.steamLevel,
      (i, v) => ({ ...i, steamLevel: v as Inputs['steamLevel'] }),
      'Reboiler steam level',
    );

    return h(
      'div',
      { class: 'controls' },
      section('MIXTURE', picker),
      section('FEED', sliderRow(SPECS.F, mix), sliderRow(SPECS.xF, mix), ...feedCondition),
      section('COLUMN', sliderRow(SPECS.R, mix), sliderRow(SPECS.xD, mix), sliderRow(SPECS.xB, mix), sliderRow(SPECS.Eo, mix), sliderRow(SPECS.loss, mix)),
      section(
        'UTILITIES',
        h('label', { class: 'field' }, h('span', {}, 'Condenser'), cond),
        h('label', { class: 'field' }, h('span', {}, 'Reboiler steam'), steam),
        coolant('CW', 'cw'),
        coolant('ChW', 'chw'),
        h('div', { class: 'util-status', 'data-role': 'utilities' }),
      ),
    );
  };

  const syncControls = (inputs: Inputs) => {
    const mix = MIXTURES[inputs.mixtureId];
    for (const r of refs) {
      if (document.activeElement !== r.input) {
        const v = r.read(inputs);
        if (r.input.value !== v) r.input.value = v;
      }
      if (r.out && r.fmt) r.out.textContent = r.fmt(Number(r.read(inputs)));
      if (r.label && r.labelFn) {
        const html = r.labelFn(mix);
        if (r.shownLabel !== html) {
          r.label.innerHTML = html;
          r.shownLabel = html;
        }
      }
    }
  };

  // ---- results -------------------------------------------------------------
  const banner = h('div', { class: 'banner-slot' });
  const grid = h('div', { class: 'kpi', 'data-role': 'results' });
  const compareSlot = h('div', { class: 'compare-slot' });
  const warnings = h('div', { class: 'warnings', 'data-role': 'warnings' });
  const assumptionsSlot = h('div', { class: 'assumptions-slot' });

  const cell = (key: string, label: string, value: string, sub?: string) =>
    h('div', { class: 'cell', 'data-result': key }, h('small', {}, label), h('b', {}, value), sub ? h('em', {}, sub) : null);

  let compareFor: Results | null = null;
  let compareResult: SolveResult | null = null;
  const simpleCounterpart = (adv: Results, inputs: Inputs): SolveResult => {
    if (compareFor !== adv || !compareResult) {
      compareResult = solve({ ...inputs, mode: 'simple', q: adv.q });
      compareFor = adv;
    }
    return compareResult;
  };

  const renderResults = (inputs: Inputs, result: SolveResult) => {
    const shown: Results | null = result.ok ? result : store.lastOk();

    banner.replaceChildren(
      ...(result.ok
        ? []
        : [h('div', { class: 'banner err', role: 'alert' }, h('b', {}, 'Cannot solve this case. '), result.error.message)]),
    );

    warnings.replaceChildren(
      ...(result.warnings.length > 0 ? [h('ul', {}, ...result.warnings.map((w) => h('li', { class: 'warn' }, w.message)))] : []),
    );

    grid.classList.toggle('stale', !result.ok);
    compareSlot.replaceChildren();
    assumptionsSlot.replaceChildren();
    const status = panel.querySelector('[data-role="utilities"]');

    if (!shown) {
      grid.replaceChildren(h('div', { class: 'empty' }, 'No valid result yet. Adjust the inputs above.'));
      status?.replaceChildren();
      return;
    }

    const m = shown.mixture;
    const light = componentName(m.light);
    const heavy = componentName(m.heavy);
    const Rshown = shown.L / shown.D_kmolh;
    grid.replaceChildren(
      cell('N', 'Theoretical stages N', String(shown.N), 'including the reboiler'),
      cell('theoreticalTrays', 'Theoretical trays', String(shown.theoreticalTrays)),
      cell('actualTrays', 'Actual trays', String(shown.actualTrays), `at E_o = ${fmtNum(inputs.Eo, 2)}`),
      cell('feedTray', 'Feed tray', String(shown.feedTray), 'counted from the top'),
      cell('Rmin', 'Minimum reflux Rmin', fmtNum(shown.Rmin, 2), `R/Rmin = ${fmtNum(Rshown / shown.Rmin, 2)}`),
      cell('Nmin', 'Nmin (total reflux)', fmtNum(shown.Nmin, 1)),
      cell('Qc', 'Condenser duty Qc', fmtKW(shown.Qc_kW)),
      cell('Qr', 'Reboiler duty Qr', fmtKW(shown.Qr_kW)),
      cell('D', `Distillate (${light})`, fmtKgh(shown.D_kgh)),
      cell('B', `Bottoms (${heavy})`, fmtKgh(shown.B_kgh)),
      cell('Ttop', 'Top temperature', fmtTempC(shown.Ttop_C, shown.TtopIsEstimate), 'condensate'),
      cell('Tbot', 'Bottom temperature', fmtTempC(shown.Tbot_C, shown.TtopIsEstimate), 'reboiler'),
      cell('q', 'Feed quality q', fmtNum(shown.q, 2)),
    );

    status?.replaceChildren(
      h('p', {}, h('b', {}, `Condenser: ${UTILITY_NAME[shown.condenser.utility]}${shown.condenser.auto ? ' (auto)' : ''}. `), shown.condenser.reason),
      h('p', {}, h('b', {}, `Reboiler: ${STEAM_NAME[shown.reboiler.level]}${shown.reboiler.auto ? ' (auto)' : ''}. `), shown.reboiler.reason),
    );

    if (result.ok && inputs.mode === 'advanced' && MIXTURES[inputs.mixtureId].simpleAllowed) {
      const simple = simpleCounterpart(result, inputs);
      compareSlot.append(
        h(
          'div',
          { class: 'compare', 'data-role': 'compare' },
          h('small', {}, 'Simple vs Advanced, same inputs'),
          h('b', {}, `Simple N = ${simple.ok ? simple.N : 'n/a'} · Advanced N = ${result.N}`),
        ),
      );
    }

    const items = h('ul', {}, ...shown.assumptions.map((a) => h('li', {}, a)));
    assumptionsSlot.append(
      shown.mode === 'simple'
        ? h('div', { class: 'assumptions', 'data-role': 'assumptions' }, h('h3', {}, 'ASSUMPTIONS'), items)
        : h('details', { class: 'assumptions', 'data-role': 'assumptions' }, h('summary', {}, 'ASSUMPTIONS'), items),
    );
  };

  // ---- assemble ------------------------------------------------------------
  const controlsHost = h('div', { class: 'controls-host' });
  const panel = h(
    'aside',
    { id: 'panel', class: 'panel', 'aria-label': 'Explore controls' },
    controlsHost,
    h('section', { class: 'sec' }, h('h3', {}, 'RESULTS'), banner, grid, compareSlot, warnings, assumptionsSlot),
    h('div', { 'data-slot': 'selected-part' }),
    h('div', { 'data-slot': 'chart' }),
  );
  root.append(panel);
  const offCharts = mountCharts(panel.querySelector('[data-slot="chart"]') as HTMLElement, store);

  let builtMode: Inputs['mode'] | null = null;
  let shownInputs: Inputs | null = null;
  const update = (inputs: Inputs, result: SolveResult) => {
    if (inputs === shownInputs) return; // view-only change (cutaway, selection): nothing to redraw
    shownInputs = inputs;
    if (builtMode !== inputs.mode) {
      builtMode = inputs.mode;
      controlsHost.replaceChildren(buildControls(inputs));
    }
    syncControls(inputs);
    renderResults(inputs, result);
  };
  update(store.get().inputs, store.result());
  const off = store.subscribe((s, r) => update(s.inputs, r));

  return () => {
    off();
    offCharts();
    panel.remove();
  };
}
