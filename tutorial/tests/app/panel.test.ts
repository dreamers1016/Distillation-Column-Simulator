// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, defaultState, setMixture, setMode, type Store } from '../../src/app/state';
import { mountPanel } from '../../src/app/ui/panel';
import { mountTopbar } from '../../src/app/ui/topbar';
import { mountToast } from '../../src/app/ui/toast';
import { solve } from '../../src/engine/solve';
import { MIXTURES } from '../../src/engine/mixtures';

let root: HTMLElement;
let store: Store;
const now = (fn: () => void) => fn();

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root') as HTMLElement;
  store = createStore({ ...defaultState(), view: 'explore' }); // the app opens in Lecture; these test Explore
  mountPanel(root, store, { schedule: now });
});

const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const text = (sel: string) => q(sel)?.textContent ?? '';
function drag(key: string, value: number) {
  const el = q<HTMLInputElement>(`input[data-input="${key}"]`) as HTMLInputElement;
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('mixture picker', () => {
  const options = () => Array.from(root.querySelectorAll<HTMLOptionElement>('select[data-input="mixture"] option'));

  it('hides unverified presets', () => {
    const labels = options().map((o) => o.textContent ?? '');
    expect(labels.some((l) => /Acetone/.test(l))).toBe(false);
    expect(labels.some((l) => /Isopropanol/.test(l))).toBe(false);
  });

  it('greys Advanced-only presets in Simple with "(Advanced only)"', () => {
    const eth = options().find((o) => o.value === 'ethanol-water') as HTMLOptionElement;
    expect(eth.disabled).toBe(true);
    expect(eth.textContent).toContain('(Advanced only)');
    const meth = options().find((o) => o.value === 'methanol-water') as HTMLOptionElement;
    expect(meth.disabled).toBe(false);
  });

  it('enables every verified preset in Advanced', () => {
    setMode(store, 'advanced');
    const opts = options();
    expect(opts.length).toBe(Object.values(MIXTURES).filter((m) => m.verified).length);
    expect(opts.every((o) => !o.disabled)).toBe(true);
    expect(opts.every((o) => !o.textContent?.includes('Advanced only'))).toBe(true);
  });

  it('changing the picker loads the preset defaults', () => {
    setMode(store, 'advanced');
    const sel = q<HTMLSelectElement>('select[data-input="mixture"]') as HTMLSelectElement;
    sel.value = 'propane-butane';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().inputs.mixtureId).toBe('propane-butane');
    expect(store.get().inputs.P_bar).toBe(18);
  });
});

describe('controls', () => {
  it('Simple shows the q slider with its tick labels and no feed T / pressure', () => {
    expect(q('input[data-input="q"]')).not.toBeNull();
    const ticks = text('[data-ticks="q"]');
    for (const t of ['superheated', 'sat. vapour', 'two-phase', 'sat. liquid', 'subcooled']) expect(ticks).toContain(t);
    expect(q('input[data-input="feedT_C"]')).toBeNull();
    expect(q('input[data-input="P_bar"]')).toBeNull();
  });

  it('places the q ticks at the true fractions of the slider range, with their values', () => {
    const slider = q<HTMLInputElement>('input[data-input="q"]') as HTMLInputElement;
    const [min, max] = [Number(slider.min), Number(slider.max)];
    const ticks = Array.from(root.querySelectorAll<HTMLElement>('[data-ticks="q"] .sl-tick'));
    expect(ticks.map((t) => Number(t.dataset.value))).toEqual([-0.5, 0, 0.5, 1, 1.5]);
    expect(ticks.map((t) => Number(t.style.getPropertyValue('--f')))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    for (const t of ticks) expect(Number(t.style.getPropertyValue('--f'))).toBeCloseTo((Number(t.dataset.value) - min) / (max - min), 12);
    expect(ticks.map((t) => t.querySelector('b')?.textContent)).toEqual(['-0.5', '0', '0.5', '1', '1.5']);
  });

  it('Advanced shows feed T and pressure and no q slider', () => {
    setMode(store, 'advanced');
    expect(q('input[data-input="q"]')).toBeNull();
    const t = q<HTMLInputElement>('input[data-input="feedT_C"]') as HTMLInputElement;
    expect([t.min, t.max]).toEqual(['-40', '200']);
    const p = q<HTMLInputElement>('input[data-input="P_bar"]') as HTMLInputElement;
    expect([p.min, p.max]).toEqual(['0.5', '25']);
  });

  it('uses the specified slider ranges', () => {
    const range = (k: string) => {
      const e = q<HTMLInputElement>(`input[data-input="${k}"]`) as HTMLInputElement;
      return [Number(e.min), Number(e.max)];
    };
    expect(range('R')).toEqual([0.3, 10]);
    expect(range('xD')).toEqual([0.8, 0.995]);
    expect(range('xB')).toEqual([0.005, 0.2]);
    expect(range('F_kgh')).toEqual([100, 10000]);
    expect(range('Eo')).toEqual([0.4, 1]);
    expect(range('heatLossPct')).toEqual([0, 15]);
    expect(range('q')).toEqual([-0.5, 1.5]);
  });

  it('moving a slider updates the store inputs and the displayed results', () => {
    const before = text('[data-result="Qc"]');
    drag('R', 5);
    expect(store.get().inputs.R).toBe(5);
    expect(text('[data-result="Qc"]')).not.toBe(before);
  });

  it('batches slider input through the scheduler (one solve per frame)', () => {
    const frames: Array<() => void> = [];
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root') as HTMLElement;
    store = createStore({ ...defaultState(), view: 'explore' }); // the app opens in Lecture; these test Explore
    mountPanel(root, store, { schedule: (f) => frames.push(f) });
    drag('R', 3);
    drag('R', 4);
    drag('xD', 0.9);
    expect(store.get().inputs.R).not.toBe(4);
    expect(frames.length).toBe(1);
    frames.forEach((f) => f());
    expect(store.get().inputs.R).toBe(4);
    expect(store.get().inputs.xD).toBe(0.9);
  });

  it('disposing the panel cancels a pending frame flush: no store update afterwards', () => {
    const frames: Array<() => void> = [];
    let cancelled = 0;
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root') as HTMLElement;
    store = createStore({ ...defaultState(), view: 'explore' });
    const unmount = mountPanel(root, store, {
      schedule: (f) => {
        frames.push(f);
        return () => void cancelled++;
      },
    });
    const R0 = store.get().inputs.R;
    drag('R', 4);
    expect(frames.length).toBe(1);
    unmount();
    expect(cancelled).toBe(1);
    frames.forEach((f) => f()); // even if the frame fires anyway, nothing is applied
    expect(store.get().inputs.R).toBe(R0);
    expect(root.querySelector('.panel')).toBeNull();
  });

  it('the default scheduler is requestAnimationFrame and the disposer cancels it', () => {
    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    const queued = new Map<number, FrameRequestCallback>();
    let next = 1;
    globalThis.requestAnimationFrame = (cb) => {
      queued.set(next, cb);
      return next++;
    };
    globalThis.cancelAnimationFrame = (id) => void queued.delete(id);
    try {
      document.body.innerHTML = '<div id="root"></div>';
      root = document.getElementById('root') as HTMLElement;
      store = createStore({ ...defaultState(), view: 'explore' });
      const unmount = mountPanel(root, store);
      drag('R', 4);
      expect(queued.size).toBe(1);
      unmount();
      expect(queued.size).toBe(0);
    } finally {
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
    }
  });

  it('utility overrides and coolant temperatures write to the store', () => {
    const cond = q<HTMLSelectElement>('select[data-input="condenserUtility"]') as HTMLSelectElement;
    cond.value = 'ChW';
    cond.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().inputs.condenserUtility).toBe('ChW');
    const steam = q<HTMLSelectElement>('select[data-input="steamLevel"]') as HTMLSelectElement;
    steam.value = 'MP';
    steam.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().inputs.steamLevel).toBe('MP');
    drag('cw.in_C', 25);
    expect(store.get().inputs.cw.in_C).toBe(25);
    drag('chw.out_C', 14);
    expect(store.get().inputs.chw.out_C).toBe(14);
  });
});

describe('results', () => {
  it('prefixes temperatures with ≈ in Simple and not in Advanced', () => {
    expect(text('[data-result="Ttop"]')).toContain('≈');
    expect(text('[data-result="Tbot"]')).toContain('≈');
    setMode(store, 'advanced');
    expect(text('[data-result="Ttop"]')).toMatch(/\d °C/);
    expect(text('[data-result="Ttop"]')).not.toContain('≈');
    expect(text('[data-result="Tbot"]')).not.toContain('≈');
  });

  it('shows the engine numbers and names the real chemicals', () => {
    const r = solve(store.get().inputs);
    if (!r.ok) throw new Error('expected ok');
    expect(text('[data-result="N"]')).toContain(String(r.N));
    expect(text('[data-result="actualTrays"]')).toContain(String(r.actualTrays));
    expect(text('[data-result="feedTray"]')).toContain(String(r.feedTray));
    expect(text('[data-result="Rmin"]')).toContain(r.Rmin.toFixed(2));
    expect(text('[data-result="Rmin"]')).toContain('R/Rmin');
    expect(text('[data-result="D"]')).toMatch(/Distillate \(methanol\)/);
    expect(text('[data-result="B"]')).toMatch(/Bottoms \(water\)/);
    expect(text('[data-result="Qc"]')).toMatch(/\d kW/);
  });

  it('shows the R_BELOW_MIN message in an error banner when R = 0.4 (methanol-water, Simple)', () => {
    drag('R', 0.4);
    const banner = q('[role="alert"]');
    expect(banner).not.toBeNull();
    const r = solve(store.get().inputs);
    if (r.ok) throw new Error('expected failure');
    expect(r.error.code).toBe('R_BELOW_MIN');
    expect(banner?.textContent).toContain(r.error.message);
  });

  it('keeps the last valid results, greyed, while the error banner shows', () => {
    const good = text('[data-result="N"]');
    drag('R', 0.4);
    const grid = q('[data-role="results"]') as HTMLElement;
    expect(grid.classList.contains('stale')).toBe(true);
    expect(text('[data-result="N"]')).toBe(good);
    drag('R', 3);
    expect(q('[role="alert"]')).toBeNull();
    expect(grid.classList.contains('stale')).toBe(false);
  });

  it('greyed stale results label E_o from the inputs that produced them, not the invalid ones', () => {
    drag('Eo', 0.5);
    expect(text('[data-result="actualTrays"]')).toContain('at E_o = 0.50');
    // one edit makes the case invalid and changes E_o at the same time
    store.set((s) => ({ inputs: { ...s.inputs, R: 0.4, Eo: 0.9 } }));
    expect(store.result().ok).toBe(false);
    expect(text('[data-result="actualTrays"]')).toContain('at E_o = 0.50');
    expect(text('[data-result="actualTrays"]')).not.toContain('0.90');
  });

  it('the error banner names the stale result when its mixture or mode differs from the selection', () => {
    expect(store.result().ok).toBe(true);
    const banner = () => text('[role="alert"]');
    drag('R', 0.4); // same mixture and mode: no extra sentence
    expect(banner()).not.toContain('Showing the last valid result');
    drag('R', 2.5);
    setMode(store, 'advanced');
    setMixture(store, 'ethanol-water');
    expect(store.result().ok).toBe(true);
    store.set((s) => ({ inputs: { ...s.inputs, mixtureId: 'methanol-water', mode: 'simple', R: 0.3, xD: 0.995 } }));
    expect(store.result().ok).toBe(false);
    expect(banner()).toContain('Showing the last valid result for Ethanol–Water (Advanced).');
  });

  it('shows the Simple vs Advanced stage-count row only in Advanced for Simple-capable mixtures', () => {
    expect(q('[data-role="compare"]')).toBeNull();
    setMode(store, 'advanced');
    const adv = store.result();
    if (!adv.ok) throw new Error('expected ok');
    const simple = solve({ ...store.get().inputs, mode: 'simple', q: adv.q });
    if (!simple.ok) throw new Error('expected ok');
    const row = text('[data-role="compare"]');
    expect(row).toContain(`Simple N = ${simple.N}`);
    expect(row).toContain(`Advanced N = ${adv.N}`);
    setMixture(store, 'ethanol-water');
    expect(q('[data-role="compare"]')).toBeNull();
  });

  it('Rmin = 0 for valid inputs: says "any R separates" and prints no R/Rmin ratio (never ∞)', () => {
    store.set((s) => ({ inputs: { ...s.inputs, mixtureId: 'methanol-water', mode: 'simple', q: 0.2, xF: 0.97, xD: 0.98 } }));
    const r = store.result();
    expect(r.ok && r.Rmin).toBe(0);
    const cellText = text('[data-result="Rmin"]');
    expect(cellText).toContain('Rmin = 0 (any R separates)');
    expect(cellText).not.toContain('R/Rmin');
    expect(cellText).not.toMatch(/∞|Infinity|NaN/);
  });

  it('labels the pressure when Advanced P differs from 1 atm (Simple always runs at 1 atm)', () => {
    setMode(store, 'advanced');
    expect(text('[data-role="compare"]')).not.toContain('at 1 atm'); // default P = 1.01325 bar
    drag('P_bar', 2);
    const adv = store.result();
    if (!adv.ok) throw new Error('expected ok');
    const simple = solve({ ...store.get().inputs, mode: 'simple', q: adv.q });
    if (!simple.ok) throw new Error('expected ok');
    const row = text('[data-role="compare"]');
    expect(row).toContain(`Simple N (at 1 atm) = ${simple.N}`);
    expect(row).toContain(`Advanced N (at 2 bar abs) = ${adv.N}`);
    expect(row).not.toMatch(/same inputs(?!,)/);
  });

  it('lists the assumptions box and every engine warning', () => {
    const r = store.result();
    if (!r.ok) throw new Error('expected ok');
    expect(text('[data-role="assumptions"]')).toContain(r.assumptions[0]);
    setMode(store, 'advanced');
    setMixture(store, 'propane-butane');
    drag('P_bar', 24);
    const adv = store.result();
    for (const w of adv.warnings) expect(text('[data-role="warnings"]')).toContain(w.message);
  });

  it('exposes empty slots for the selected-part card and chart', () => {
    expect(q('[data-slot="selected-part"]')).not.toBeNull();
    expect(q('[data-slot="chart"]')).not.toBeNull();
  });
});

describe('topbar and toast', () => {
  it('top bar switches Simple/Advanced and toggles the cutaway', () => {
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    mountTopbar(bar, store);
    expect(bar.textContent).toContain('LEARN DISTILLATION');
    const btn = (label: string) => Array.from(bar.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    btn('Advanced').click();
    expect(store.get().inputs.mode).toBe('advanced');
    expect(btn('Advanced').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Simple').getAttribute('aria-pressed')).toBe('false');
    expect(store.get().cutaway).toBe(true);
    btn('Cutaway').click();
    expect(store.get().cutaway).toBe(false);
    expect(btn('Explore').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Lecture').disabled).toBe(false);
    btn('Lecture').click();
    expect(store.get().view).toBe('lecture');
    expect(btn('Lecture').getAttribute('aria-pressed')).toBe('true');
    btn('Explore').click();
    expect(store.get().view).toBe('explore');
    expect(bar.querySelector('a[href*="components"]')).not.toBeNull();
  });

  it('shows the fallback toast in the DOM', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountToast(host, store);
    setMode(store, 'advanced');
    setMixture(store, 'ethanol-water');
    setMode(store, 'simple');
    expect(host.textContent).toContain('Ethanol–Water is Advanced only — switched to Methanol–Water');
  });
});
