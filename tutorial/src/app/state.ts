// Application state: one store holding the UI state and the engine inputs.
// solve() is memoised on the inputs object reference, so view-only changes
// (cutaway, selection, step) never re-run the engine.
import { MIXTURES, type MixtureId } from '../engine/mixtures';
import { solve } from '../engine/solve';
import type { Inputs, Mode, Results, SolveResult } from '../engine/types';
import { mixtureLabel } from './format';

export interface PartRef {
  kind:
    | 'column' | 'tray' | 'feed' | 'condenser' | 'refluxDrum' | 'reboiler' | 'sump'
    | 'distributor' | 'skirt' | 'manway' | 'platform' | 'nozzle' | 'cwSystem' | 'steamSystem';
  tray?: number;
}

export interface AppState {
  view: 'lecture' | 'explore';
  inputs: Inputs;
  cutaway: boolean;
  selected: PartRef | null;
  lectureId: string;
  step: number;
}

export type StatePatch = Partial<AppState> | ((s: AppState) => Partial<AppState>);
export type Solver = (inputs: Inputs) => SolveResult;

export interface Store {
  get(): AppState;
  /** Engine result for the current inputs (memoised). */
  result(): SolveResult;
  /** Most recent successful result, kept for greying out while a later solve fails. */
  lastOk(): Results | null;
  set(patch: StatePatch): void;
  subscribe(fn: (s: AppState, r: SolveResult) => void): () => void;
  /** Show a transient message; the toast UI listens with onToast. */
  toast(message: string): void;
  onToast(fn: (message: string) => void): () => void;
}

export const FALLBACK_SIMPLE_MIXTURE: MixtureId = 'methanol-water';

/** Preset operating point (compositions, R, pressure, feed condition) applied over `prev`. */
function inputsFor(id: MixtureId, prev: Inputs): Inputs {
  return { ...prev, mixtureId: id, ...MIXTURES[id].defaults };
}

export function defaultInputs(): Inputs {
  return {
    mode: 'simple',
    mixtureId: FALLBACK_SIMPLE_MIXTURE,
    F_kgh: 1000,
    ...MIXTURES[FALLBACK_SIMPLE_MIXTURE].defaults, // xF, xD, xB, R, q, feedT_C, P_bar
    Eo: 0.7,
    heatLossPct: 0,
    condenserUtility: 'auto',
    steamLevel: 'auto',
    cw: { in_C: 30, out_C: 40 },
    chw: { in_C: 7, out_C: 12 },
  };
}

export function defaultState(): AppState {
  // The link opens straight onto the 3D column in Lecture mode, at step 1 of the v1 lesson.
  return { view: 'lecture', inputs: defaultInputs(), cutaway: true, selected: null, lectureId: 'mw-intro', step: 0 };
}

export function createStore(initial: AppState = defaultState(), solver: Solver = solve): Store {
  let state = initial;
  let solvedFor = state.inputs;
  let result = solver(solvedFor);
  let lastOk: Results | null = result.ok ? result : null;
  const subs = new Set<(s: AppState, r: SolveResult) => void>();
  const toasts = new Set<(m: string) => void>();

  return {
    get: () => state,
    result: () => result,
    lastOk: () => lastOk,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      if (state.inputs !== solvedFor) {
        solvedFor = state.inputs;
        result = solver(solvedFor);
        if (result.ok) lastOk = result;
      }
      for (const fn of [...subs]) fn(state, result);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    toast(message) {
      for (const fn of [...toasts]) fn(message);
    },
    onToast(fn) {
      toasts.add(fn);
      return () => void toasts.delete(fn);
    },
  };
}

/** Load a preset's default operating point; user-level settings (F, E_o, utilities, mode) are kept. */
export function setMixture(store: Store, id: MixtureId): void {
  store.set((s) => ({ inputs: inputsFor(id, s.inputs) }));
}

/**
 * Switch Simple / Advanced. An Advanced-only mixture cannot stay selected in
 * Simple: fall back to methanol-water (its defaults) and tell the user.
 */
export function setMode(store: Store, mode: Mode): void {
  const cur = store.get().inputs;
  if (mode === 'simple' && !MIXTURES[cur.mixtureId].simpleAllowed) {
    const from = mixtureLabel(cur.mixtureId);
    store.set({ inputs: { ...inputsFor(FALLBACK_SIMPLE_MIXTURE, cur), mode } });
    store.toast(`${from} is Advanced only — switched to ${mixtureLabel(FALLBACK_SIMPLE_MIXTURE)}`);
    return;
  }
  if (cur.mode === mode) return;
  store.set({ inputs: { ...cur, mode } });
}
