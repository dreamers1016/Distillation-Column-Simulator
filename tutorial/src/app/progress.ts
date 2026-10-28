// Learner progress (spec §3.4): lecture steps reached per script and component cards
// viewed, kept per browser in localStorage. Every storage call is wrapped in try/catch:
// private windows, blocked site data and a full quota all fall back to memory, and the
// app works the same (progress then lasts until the page is reloaded).
import type { PartRef, Store } from './state';

export type CardKind = PartRef['kind'];

export interface Progress {
  /** Lecture id -> 0-based step indices reached, ascending. */
  steps: Record<string, number[]>;
  /** Card kinds opened at least once, in first-opened order. */
  cards: CardKind[];
}

const KEY = 'learn-distillation:progress:v1';

/** In-memory copy: the source of truth once loaded; storage is a best-effort mirror. */
let mem: Progress | null = null;
const listeners = new Set<(p: Progress) => void>();

const empty = (): Progress => ({ steps: {}, cards: [] });

/** Keep only well-formed entries from whatever was stored. */
function sanitize(raw: unknown): Progress {
  const out = empty();
  if (!raw || typeof raw !== 'object') return out;
  const { steps, cards } = raw as { steps?: unknown; cards?: unknown };
  if (steps && typeof steps === 'object') {
    for (const [id, list] of Object.entries(steps as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const ok = [...new Set(list.filter((n): n is number => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
      if (ok.length) out.steps[id] = ok;
    }
  }
  if (Array.isArray(cards)) out.cards = [...new Set(cards.filter((c): c is CardKind => typeof c === 'string'))];
  return out;
}

function load(): Progress {
  if (mem) return mem;
  mem = empty();
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) mem = sanitize(JSON.parse(raw));
  } catch {
    // unreadable, blocked or corrupt storage: start empty in memory
  }
  return mem;
}

function save(p: Progress): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // quota exceeded or storage blocked: the in-memory copy still has it
  }
  const snapshot = getProgress();
  for (const fn of [...listeners]) fn(snapshot);
}

/** Record that step `i` (0-based) of lecture `lectureId` was shown. */
export function markStep(lectureId: string, i: number): void {
  const p = load();
  const list = p.steps[lectureId] ?? [];
  if (!Number.isInteger(i) || i < 0 || list.includes(i)) return;
  p.steps[lectureId] = [...list, i].sort((a, b) => a - b);
  save(p);
}

/** Record that a component card of this kind was opened. */
export function markCard(kind: CardKind): void {
  const p = load();
  if (p.cards.includes(kind)) return;
  p.cards = [...p.cards, kind];
  save(p);
}

/** A copy of the current progress. */
export function getProgress(): Progress {
  const p = load();
  return { steps: Object.fromEntries(Object.entries(p.steps).map(([k, v]) => [k, [...v]])), cards: [...p.cards] };
}

/** Called with the new progress after every change. Returns the unsubscribe function. */
export function onProgress(fn: (p: Progress) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Mark a card as viewed whenever a part is selected (its card opens in the panel or overlay). */
export function trackCardViews(store: Store): () => void {
  let last = store.get().selected;
  if (last) markCard(last.kind);
  return store.subscribe((s) => {
    if (s.selected === last) return;
    last = s.selected;
    if (last) markCard(last.kind);
  });
}

/** Test hook: forget the in-memory copy so the next read reloads from storage. */
export function resetProgressForTests(): void {
  mem = null;
}
