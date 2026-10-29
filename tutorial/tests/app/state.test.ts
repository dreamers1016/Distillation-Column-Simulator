// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createStore, defaultState, setMixture, setMode, type Store } from '../../src/app/state';
import { solve } from '../../src/engine/solve';
import { MIXTURES } from '../../src/engine/mixtures';
import type { Inputs } from '../../src/engine/types';

function countingStore() {
  const solver = vi.fn((i: Inputs) => solve(i));
  const store = createStore(defaultState(), solver);
  solver.mockClear();
  return { store, solver };
}

describe('store', () => {
  it('defaults to Lecture (mw-intro, step 1), Simple, methanol-water with the preset defaults', () => {
    const s = defaultState();
    expect(s.view).toBe('lecture');
    expect(s.lectureId).toBe('mw-intro');
    expect(s.step).toBe(0);
    expect(s.cutaway).toBe(true);
    expect(s.selected).toBeNull();
    expect(s.inputs.mode).toBe('simple');
    expect(s.inputs.mixtureId).toBe('methanol-water');
    expect(s.inputs.R).toBe(MIXTURES['methanol-water'].defaults.R);
    expect(s.inputs.F_kgh).toBe(1000);
    expect(s.inputs.Eo).toBe(0.7);
    expect(s.inputs.cw).toEqual({ in_C: 30, out_C: 40 });
    expect(s.inputs.chw).toEqual({ in_C: 7, out_C: 12 });
  });

  it('recomputes when inputs change and not when cutaway changes', () => {
    const { store, solver } = countingStore();
    store.set({ cutaway: false });
    expect(solver).not.toHaveBeenCalled();
    store.set({ selected: { kind: 'tray', tray: 3 } });
    expect(solver).not.toHaveBeenCalled();
    store.set((s) => ({ inputs: { ...s.inputs, R: 3 } }));
    expect(solver).toHaveBeenCalledTimes(1);
    expect(solver.mock.calls[0][0].R).toBe(3);
  });

  it('notifies subscribers with the state and the memoised result; unsubscribe stops it', () => {
    const { store } = countingStore();
    const seen: number[] = [];
    const off = store.subscribe((_s, r) => {
      seen.push(r.ok ? r.N : -1);
    });
    store.set({ cutaway: false });
    store.set((s) => ({ inputs: { ...s.inputs, R: 4 } }));
    expect(seen.length).toBe(2);
    off();
    store.set({ cutaway: true });
    expect(seen.length).toBe(2);
  });

  it('a nested set inside a subscriber: later subscribers see only the current state, once', () => {
    const { store } = countingStore();
    const calls: { s: ReturnType<Store['get']>; r: ReturnType<Store['result']> }[] = [];
    store.subscribe((s) => {
      if (s.inputs.R === 3) store.set((p) => ({ inputs: { ...p.inputs, R: 4 } })); // e.g. a clamp
    });
    store.subscribe((s, r) => {
      expect(s).toBe(store.get()); // never stale
      expect(r).toBe(store.result());
      calls.push({ s, r });
    });
    store.set((p) => ({ inputs: { ...p.inputs, R: 3 } }));
    expect(store.get().inputs.R).toBe(4);
    expect(calls).toHaveLength(1); // the outer pass after the nested one is skipped
    expect(calls[0].s.inputs.R).toBe(4);
    expect(calls[0].r.ok && calls[0].r.L / calls[0].r.D_kmolh).toBeCloseTo(4, 9);
  });

  it('remembers the last valid result when a later solve fails', () => {
    const { store } = countingStore();
    const good = store.lastOk();
    expect(good).not.toBeNull();
    store.set((s) => ({ inputs: { ...s.inputs, R: 0.4 } }));
    expect(store.result().ok).toBe(false);
    expect(store.lastOk()).toBe(good);
  });
});

describe('setMixture', () => {
  it('propane-butane loads its defaults (P = 18 bar abs)', () => {
    const { store } = countingStore();
    setMixture(store, 'propane-butane');
    const i = store.get().inputs;
    expect(i.mixtureId).toBe('propane-butane');
    expect(i.P_bar).toBe(18);
    expect(i.R).toBe(3);
  });

  it('keeps the user-level settings (F, E_o, utilities) when changing mixture', () => {
    const { store } = countingStore();
    store.set((s) => ({ inputs: { ...s.inputs, F_kgh: 2500, Eo: 0.55 } }));
    setMixture(store, 'benzene-toluene');
    expect(store.get().inputs.F_kgh).toBe(2500);
    expect(store.get().inputs.Eo).toBe(0.55);
    expect(store.get().inputs.R).toBe(MIXTURES['benzene-toluene'].defaults.R);
  });
});

describe('setMode', () => {
  it('switches Simple to Advanced and back for a Simple-capable mixture', () => {
    const { store } = countingStore();
    const toasts: string[] = [];
    store.onToast((m) => toasts.push(m));
    setMode(store, 'advanced');
    expect(store.get().inputs.mode).toBe('advanced');
    setMode(store, 'simple');
    expect(store.get().inputs.mode).toBe('simple');
    expect(store.get().inputs.mixtureId).toBe('methanol-water');
    expect(toasts).toEqual([]);
  });

  it('falls back to methanol-water with a toast when an Advanced-only mixture meets Simple', () => {
    const { store } = countingStore();
    const toasts: string[] = [];
    store.onToast((m) => toasts.push(m));
    setMode(store, 'advanced');
    setMixture(store, 'ethanol-water');
    expect(store.get().inputs.xD).toBe(MIXTURES['ethanol-water'].defaults.xD);
    setMode(store, 'simple');
    const i = store.get().inputs;
    expect(i.mode).toBe('simple');
    expect(i.mixtureId).toBe('methanol-water');
    expect(i.xF).toBe(MIXTURES['methanol-water'].defaults.xF);
    expect(i.R).toBe(MIXTURES['methanol-water'].defaults.R);
    expect(toasts).toEqual(['Ethanol–Water is Advanced only — switched to Methanol–Water']);
    expect(store.result().ok).toBe(true);
  });

  it('does a single solve for a mode change that also swaps the mixture', () => {
    const { store, solver } = countingStore();
    setMode(store, 'advanced');
    setMixture(store, 'propane-butane');
    solver.mockClear();
    setMode(store, 'simple');
    expect(solver).toHaveBeenCalledTimes(1);
  });
});
