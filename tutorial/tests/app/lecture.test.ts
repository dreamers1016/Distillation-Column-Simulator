// @vitest-environment jsdom
// Lecture mode (spec §3.2), lessons and progress (§3.4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { LECTURES, lectureInputs, nearRmin, type Lecture } from '../../src/app/lecture/scripts';
import { Presenter } from '../../src/app/lecture/presenter';
import { mountLessons } from '../../src/app/lecture/lessons';
import { createStore, defaultInputs, defaultState, type Store } from '../../src/app/state';
import { getProgress, markCard, markStep, resetProgressForTests, trackCardViews } from '../../src/app/progress';
import { solve } from '../../src/engine/solve';
import type { Results } from '../../src/engine/types';
import type { Anchor, AnchorKey } from '../../src/scene/plant';

const lecture = LECTURES[0];
const okSolve = (i: Parameters<typeof solve>[0]): Results => {
  const r = solve(i);
  if (!r.ok) throw new Error(r.error.message);
  return r;
};
/** Caption text of step k with that step's own inputs and results. */
const captionOf = (k: number) => {
  const i = lectureInputs(lecture, k);
  return lecture.steps[k].caption(okSolve(i), i);
};

/** Disposers registered by a test, run in afterEach so a failed assertion cannot leak listeners. */
const cleanup: Array<() => void> = [];
const runCleanup = () => {
  for (const off of cleanup.splice(0).reverse()) off();
};

/** Every anchor at a distinct point, so a flight's target names its anchor. */
function fakeAnchors(): Record<AnchorKey, Anchor> {
  const keys: AnchorKey[] = [
    'overview', 'column', 'tray', 'feed', 'condenser', 'refluxDrum', 'reboiler', 'sump', 'distributor',
    'skirt', 'manway', 'platform', 'nozzle', 'cwSystem', 'steamSystem',
  ];
  return Object.fromEntries(keys.map((k, n) => [k, { look: new Vector3(n, n, n), dist: 10 + n }])) as Record<AnchorKey, Anchor>;
}

describe('v1 lecture script', () => {
  it('is the methanol–water lesson with 9 steps', () => {
    expect(lecture.id).toBe('mw-intro');
    expect(lecture.title).toBe('Methanol–water: meet the column');
    expect(lecture.steps).toHaveLength(9);
  });

  it('runs Simple until step 8, which switches to Advanced', () => {
    const modes = lecture.steps.map((_, k) => lectureInputs(lecture, k).mode);
    expect(modes.slice(0, 7).every((m) => m === 'simple')).toBe(true);
    expect(modes[7]).toBe('advanced');
    for (let k = 0; k < 9; k++) expect(lectureInputs(lecture, k).mixtureId).toBe('methanol-water');
  });

  it("step 6 sets R to round(1.2·Rmin + 0.05, 1) using the current inputs' Rmin", () => {
    const Rmin = okSolve(lectureInputs(lecture, 5 - 1)).Rmin; // same inputs apart from R
    const want = Math.round((1.2 * Rmin + 0.05) * 10) / 10;
    expect(nearRmin(Rmin)).toBe(want);
    expect(lectureInputs(lecture, 5).R).toBe(want);
    expect(lectureInputs(lecture, 5).R).toBeGreaterThan(Rmin);
  });

  it('step 7 sets R = 4', () => {
    expect(lectureInputs(lecture, 6).R).toBe(4);
  });

  it('step 8 sets mode advanced and its caption names both stage counts', () => {
    const i = lectureInputs(lecture, 7);
    expect(i.mode).toBe('advanced');
    const simpleN = okSolve({ ...i, mode: 'simple' }).N;
    const advancedN = okSolve(i).N;
    const text = captionOf(7);
    expect(text).toContain(`Simple N = ${simpleN}`);
    expect(text).toContain(`Advanced N = ${advancedN}`);
  });

  it('step 8 lists representative tray temperatures from the profile (top, feed, stripping, reboiler)', () => {
    const i = lectureInputs(lecture, 7);
    const r = okSolve(i);
    const text = captionOf(7);
    const p = r.trayProfile ?? [];
    const T = (tray: number) => `${p[tray - 1].T_C.toFixed(1)} °C`;
    expect(text).toContain(`Tray 1: ${T(1)}`);
    expect(text).toContain(`tray ${r.feedTray} (feed): ${T(r.feedTray)}`);
    const strip = Math.round((r.feedTray + p.length) / 2);
    expect(text).toContain(`tray ${strip}: ${T(strip)}`);
    expect(text).toContain(`reboiler: ${r.Tbot_C.toFixed(1)} °C`);
    expect(text).toMatch(/interpolated/);
    // the profile ends at the bottoms composition: no tray is hotter than the reboiler it feeds
    for (const q of p) expect(q.T_C).toBeLessThanOrEqual(r.Tbot_C + 1e-6);
  });

  it('step 9 offers the inputs of the current mode: feed temperature in Advanced, q in Simple', () => {
    const adv = captionOf(8);
    expect(lectureInputs(lecture, 8).mode).toBe('advanced');
    expect(adv).toMatch(/feed temperature/);
    expect(adv).not.toMatch(/\bq\b/);
    expect(adv).toMatch(/ethanol–water \(Advanced only\)/);
    const i = { ...lectureInputs(lecture, 8), mode: 'simple' as const };
    const simple = lecture.steps[8].caption(okSolve(i), i);
    expect(simple).toMatch(/change R, q,/);
    expect(simple).not.toMatch(/feed temperature/);
  });

  it('steps 6 and 7 show fractional stages and give each duty a reference', () => {
    const r6 = okSolve(lectureInputs(lecture, 5));
    const r7 = okSolve(lectureInputs(lecture, 6));
    const preset = okSolve(lectureInputs(lecture, 0)); // R = 2.5
    expect(captionOf(5)).toContain(`${r6.Nfrac.toFixed(1)} theoretical stages`);
    expect(captionOf(5)).toContain(`from ${Math.round(preset.Qr_kW)} kW at R = 2.5`);
    expect(captionOf(6)).toContain(`${r7.Nfrac.toFixed(1)} theoretical stages`);
    expect(captionOf(6)).toContain(`${preset.Nfrac.toFixed(1)} at R = 2.5`);
    expect(captionOf(6)).toMatch(/1\.2–1\.5 × Rmin/);
    for (const k of [5, 6]) expect(captionOf(k)).toMatch(/\(\d+\.\d × Rmin\)|is only \d+\.\d × Rmin/);
  });

  it('step 4 turns the cutaway on and looks at a tray', () => {
    expect(lecture.steps[3].cutaway).toBe(true);
    expect(lecture.steps[3].focus).toBe('tray');
  });

  it('captions use live numbers and real names, never generic colour language', () => {
    for (let k = 0; k < 9; k++) {
      const text = captionOf(k);
      expect(text).not.toMatch(/blue liquid|orange/i);
      expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
      expect(text).toMatch(/methanol|water/);
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(50);
    }
    const r = okSolve(lectureInputs(lecture, 0));
    expect(captionOf(0)).toContain('95 mol % methanol');
    expect(captionOf(1)).toContain(`tray ${r.feedTray} of ${r.actualTrays}`);
    expect(captionOf(2)).toMatch(/LP steam/);
    expect(captionOf(4)).toMatch(/cooling water/i);
  });
});

describe('progress (localStorage wrapped, in-memory fallback)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetProgressForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    runCleanup();
  });

  it('records steps and cards and persists them', () => {
    markStep('mw-intro', 0);
    markStep('mw-intro', 2);
    markStep('mw-intro', 2);
    markCard('reboiler');
    expect(getProgress()).toEqual({ steps: { 'mw-intro': [0, 2] }, cards: ['reboiler'] });
    resetProgressForTests(); // reload from storage
    expect(getProgress().steps['mw-intro']).toEqual([0, 2]);
  });

  it('keeps working when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => markStep('mw-intro', 3)).not.toThrow();
    expect(() => markCard('condenser')).not.toThrow();
    expect(getProgress()).toEqual({ steps: { 'mw-intro': [3] }, cards: ['condenser'] });
  });

  it('keeps working when localStorage.getItem throws or holds junk', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getProgress()).toEqual({ steps: {}, cards: [] });
    markStep('mw-intro', 1);
    expect(getProgress().steps['mw-intro']).toEqual([1]);
    vi.restoreAllMocks();
    localStorage.setItem('learn-distillation:progress:v1', '{not json');
    resetProgressForTests();
    expect(getProgress()).toEqual({ steps: {}, cards: [] });
  });

  it('marks a card when a part is selected (opened)', () => {
    const store = createStore(defaultState());
    cleanup.push(trackCardViews(store));
    store.set({ selected: { kind: 'feed' } });
    store.set({ selected: { kind: 'tray', tray: 3 } });
    store.set({ selected: null });
    expect(getProgress().cards).toEqual(['feed', 'tray']);
  });
});

describe('Presenter', () => {
  let store: Store;
  let fly: ReturnType<typeof vi.fn>;
  let presenter: Presenter;
  let root: HTMLElement;
  const anchors = fakeAnchors();
  const key = (k: string, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  beforeEach(() => {
    localStorage.clear();
    resetProgressForTests();
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root') as HTMLElement;
    store = createStore(defaultState());
    fly = vi.fn();
    presenter = new Presenter(store, { flyTo: fly }, { root, anchors: () => anchors });
    presenter.go(0);
    fly.mockClear();
  });
  afterEach(() => presenter.dispose());

  it('opens in Lecture view on step 1 of the methanol–water lesson', () => {
    expect(defaultState().view).toBe('lecture');
    expect(defaultState().lectureId).toBe('mw-intro');
    expect(store.get().step).toBe(0);
    expect(root.querySelector('.caption h2')?.textContent).toBe(`Step 1 of 9 · ${lecture.steps[0].title}`);
    expect(root.querySelector('.caption-body')?.textContent).toBe(captionOf(0));
  });

  it('PageDown advances and PageUp goes back; arrows and Space too', () => {
    key('PageDown');
    expect(store.get().step).toBe(1);
    key('ArrowRight');
    key(' ');
    expect(store.get().step).toBe(3);
    key('PageUp');
    expect(store.get().step).toBe(2);
    key('ArrowLeft');
    expect(store.get().step).toBe(1);
    key('PageUp');
    key('PageUp');
    expect(store.get().step).toBe(0); // clamped at the first step
  });

  it('keys do nothing in Explore', () => {
    presenter.go(2);
    store.set({ view: 'explore' });
    const before = store.get();
    key('PageDown');
    key('ArrowLeft');
    key(' ');
    expect(store.get().step).toBe(2);
    expect(store.get()).toBe(before);
  });

  it('Space after a mouse click on a step dot advances instead of re-clicking the dot', () => {
    const dots = root.querySelectorAll<HTMLButtonElement>('.presenter .step-dot');
    dots[3].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dots[3].focus();
    dots[3].click();
    expect(store.get().step).toBe(3);
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    dots[3].dispatchEvent(ev);
    expect(store.get().step).toBe(4);
    expect(ev.defaultPrevented).toBe(true); // no native click on keyup
    expect(document.activeElement).not.toBe(dots[3]);
  });

  it('Space on a control reached with Tab is left to the control (native activation)', () => {
    const dots = root.querySelectorAll<HTMLButtonElement>('.presenter .step-dot');
    key('Tab');
    dots[2].focus();
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    dots[2].dispatchEvent(ev);
    expect(store.get().step).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
    key('PageDown', dots[2]); // other keys still step
    expect(store.get().step).toBe(1);
  });

  it('keys are ignored while typing in a form field', () => {
    const input = document.createElement('input');
    root.append(input);
    input.focus();
    key('PageDown', input);
    key('ArrowRight', input);
    expect(store.get().step).toBe(0);
  });

  it('each step flies caption-safe to its focus anchor', () => {
    presenter.go(2);
    const focus = lecture.steps[2].focus;
    expect(fly).toHaveBeenCalledTimes(1);
    const [target, dist, opts] = fly.mock.calls[0];
    expect((target as Vector3).equals(anchors[focus].look)).toBe(true);
    expect(dist).toBeCloseTo(anchors[focus].dist * (lecture.steps[2].zoomOut ?? 1), 9);
    expect(opts).toEqual({ captionSafe: true });
    fly.mockClear();
    presenter.go(0); // overview: the anchor's own distance
    expect(fly.mock.calls[0][1]).toBe(anchors.overview.dist);
  });

  it('steps are idempotent: going back re-applies that step from the script', () => {
    presenter.go(7); // Advanced, cutaway
    store.set({ cutaway: false, selected: { kind: 'condenser' } }); // lecturer fiddles
    presenter.go(1);
    const s = store.get();
    expect(s.inputs).toEqual(lectureInputs(lecture, 1));
    expect(s.cutaway).toBe(lecture.steps[1].cutaway ?? false);
    expect(s.selected).toBeNull();
    presenter.go(5);
    expect(store.get().inputs.R).toBe(lectureInputs(lecture, 5).R);
    presenter.go(5);
    expect(store.get().inputs.R).toBe(lectureInputs(lecture, 5).R);
  });

  it('keeps the inputs object (no re-solve) when a step does not change the inputs', () => {
    const before = store.get().inputs;
    presenter.go(1);
    expect(store.get().inputs).toBe(before);
  });

  it('a step with openCard opens that card; the caption shows the live numbers', () => {
    const custom: Lecture = {
      id: 'mw-intro',
      title: 't',
      mixtureId: 'methanol-water',
      steps: [{ title: 'Reboiler', focus: 'reboiler', openCard: 'reboiler', caption: (r) => `Qr ${Math.round(r.Qr_kW)}` }],
    };
    presenter.dispose();
    presenter = new Presenter(store, { flyTo: fly }, { root, anchors: () => anchors, lectures: [custom] });
    presenter.go(0);
    expect(store.get().selected).toEqual({ kind: 'reboiler' });
    expect(root.querySelector('.caption-body')?.textContent).toBe(`Qr ${Math.round((store.result() as Results).Qr_kW)}`);
  });

  it('presenter bar: Prev, a dot per step, Next; dots jump; progress marks visited steps', () => {
    const dots = root.querySelectorAll<HTMLButtonElement>('.presenter .step-dot');
    expect(dots).toHaveLength(9);
    dots[4].click();
    expect(store.get().step).toBe(4);
    expect(dots[4].getAttribute('aria-current')).toBe('step');
    root.querySelector<HTMLButtonElement>('.presenter [data-action="prev"]')?.click();
    expect(store.get().step).toBe(3);
    root.querySelector<HTMLButtonElement>('.presenter [data-action="next"]')?.click();
    expect(store.get().step).toBe(4);
    expect(getProgress().steps['mw-intro']).toEqual([0, 3, 4]);
    expect(root.querySelector('.caption h2')?.textContent).toBe(`Step 5 of 9 · ${lecture.steps[4].title}`);
  });

  it('on the last step Next opens Explore; the caption is hidden in Explore', () => {
    presenter.go(8);
    const next = root.querySelector<HTMLButtonElement>('.presenter [data-action="next"]') as HTMLButtonElement;
    expect(next.textContent).toMatch(/Explore/);
    key('PageDown'); // a clicker press on the last step does nothing
    expect(store.get().view).toBe('lecture');
    next.click();
    expect(store.get().view).toBe('explore');
    expect(root.querySelector<HTMLElement>('.caption')?.hidden).toBe(true);
  });

  it('returning to Lecture view re-applies the current step', () => {
    presenter.go(6);
    store.set({ view: 'explore' });
    store.set((s) => ({ inputs: { ...s.inputs, R: 9 } }));
    fly.mockClear();
    store.set({ view: 'lecture' });
    expect(store.get().inputs.R).toBe(4);
    expect(fly).toHaveBeenCalledTimes(1);
  });
});

describe('lesson strip', () => {
  afterEach(runCleanup);
  beforeEach(() => {
    localStorage.clear();
    resetProgressForTests();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('lists the lessons with a tick per completed step; clicking one starts it at step 1', () => {
    const root = document.getElementById('root') as HTMLElement;
    const store = createStore({ ...defaultState(), view: 'explore', inputs: { ...defaultInputs(), R: 3 } });
    const fly = vi.fn();
    const presenter = new Presenter(store, { flyTo: fly }, { root, anchors: () => fakeAnchors() });
    cleanup.push(() => presenter.dispose(), mountLessons(root, store, presenter));
    markStep('mw-intro', 0);
    markStep('mw-intro', 1);
    const item = root.querySelector<HTMLButtonElement>('.lessons [data-lecture="mw-intro"]') as HTMLButtonElement;
    expect(item.textContent).toContain('Methanol–water: meet the column');
    expect(item.querySelectorAll('.tick')).toHaveLength(9);
    expect(item.querySelectorAll('.tick.done')).toHaveLength(2);
    item.click();
    expect(store.get().view).toBe('lecture');
    expect(store.get().step).toBe(0);
    expect(store.get().inputs.R).toBe(lectureInputs(lecture, 0).R);
    expect(fly).toHaveBeenCalled();
  });
});
