// Lecture presenter (spec §3.2): applies a script step to the app (inputs, mode, cutaway,
// card, camera), renders the caption card ("Step n of N · Title" + live text) and the
// presenter bar (Prev · step dots · Next), and takes clicker / keyboard input.
// Each step's state comes from the script alone, so any step can be shown in any order.
import type { Inputs } from '../../engine/types';
import type { FramingOptions } from '../../scene/camera';
import type { Anchor, AnchorKey } from '../../scene/plant';
import { getProgress, markStep, onProgress } from '../progress';
import type { AppState, Store } from '../state';
import { h } from '../ui/dom';
import { LECTURES, lectureInputs, type Lecture } from './scripts';

/** The part of CameraDirector the presenter drives. */
export interface Flyer {
  flyTo(target: Anchor['look'], distance: number, opts?: FramingOptions): void;
}

export interface PresenterOptions {
  /** Where the caption card and presenter bar are mounted (none: no UI, keys still work). */
  root?: HTMLElement;
  /** Camera anchors of the current plant (it is rebuilt synchronously on store changes). */
  anchors?: () => Record<AnchorKey, Anchor> | null;
  lectures?: Lecture[];
}

const FORWARD = new Set(['ArrowRight', 'PageDown', ' ', 'Spacebar']);
const BACK = new Set(['ArrowLeft', 'PageUp']);

/** Focus is in a text field, list box or editable region: keys belong to it. */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
}

/** Same values field by field (the coolant ranges compared by value). */
function sameInputs(a: Inputs, b: Inputs): boolean {
  const keys = Object.keys(a) as (keyof Inputs)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => (typeof a[k] === 'object' ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : a[k] === b[k]));
}

export class Presenter {
  private readonly lectures: Lecture[];
  private view: AppState['view'];
  private readonly offs: Array<() => void> = [];
  private readonly ui: {
    caption: HTMLElement;
    heading: HTMLElement;
    body: HTMLElement;
    bar: HTMLElement;
    prev: HTMLButtonElement;
    next: HTMLButtonElement;
    dots: HTMLElement;
  } | null;
  /** Caption cache: templates may run extra solves, so only re-run on a new result or step. */
  private shown: { key: string; r: unknown } = { key: '', r: null };

  constructor(
    private readonly store: Store,
    private readonly director: Flyer,
    private readonly opts: PresenterOptions = {},
  ) {
    this.lectures = opts.lectures ?? LECTURES;
    this.view = store.get().view;
    this.ui = opts.root ? this.mount(opts.root) : null;

    window.addEventListener('keydown', this.onKey);
    this.offs.push(() => window.removeEventListener('keydown', this.onKey));
    this.offs.push(
      store.subscribe((s) => {
        if (s.view !== this.view) {
          this.view = s.view;
          if (s.view === 'lecture') this.go(s.step); // entering Lecture shows the current step again
        }
        this.render();
      }),
    );
    this.offs.push(onProgress(() => this.render()));
    this.render();
  }

  /** The lecture named by the store (the first one if the id is unknown). */
  get lecture(): Lecture {
    const id = this.store.get().lectureId;
    return this.lectures.find((l) => l.id === id) ?? this.lectures[0];
  }

  next(): void {
    const { step } = this.store.get();
    if (step < this.lecture.steps.length - 1) this.go(step + 1);
  }

  prev(): void {
    const { step } = this.store.get();
    if (step > 0) this.go(step - 1);
  }

  /** Start a lesson from its first step (lesson strip). */
  start(lectureId: string): void {
    const lecture = this.lectures.find((l) => l.id === lectureId) ?? this.lectures[0];
    this.apply(lecture, 0);
  }

  /** Show step i (0-based, clamped) of the current lecture, in Lecture view. */
  go(i: number): void {
    this.apply(this.lecture, i);
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.ui?.caption.remove();
    this.ui?.bar.remove();
  }

  private apply(lecture: Lecture, i: number): void {
    const k = Math.min(Math.max(0, Math.round(i) || 0), lecture.steps.length - 1);
    const step = lecture.steps[k];
    const cur = this.store.get();
    const inputs = lectureInputs(lecture, k);
    this.view = 'lecture'; // set before store.set so the view subscriber does not re-apply
    this.store.set({
      view: 'lecture',
      lectureId: lecture.id,
      step: k,
      // Keep the same object when nothing changed: the store re-solves on a new reference.
      inputs: sameInputs(cur.inputs, inputs) ? cur.inputs : inputs,
      cutaway: step.cutaway ?? false,
      selected: step.openCard ? { kind: step.openCard } : null,
    });
    markStep(lecture.id, k);
    // The plant was rebuilt synchronously by the store change, so these anchors are current.
    const anchor = this.opts.anchors?.()?.[step.focus];
    if (anchor) this.director.flyTo(anchor.look, anchor.dist * (step.zoomOut ?? 1), { captionSafe: true });
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (this.store.get().view !== 'lecture' || e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
    if (document.querySelector('.components-page:not([hidden])')) return; // another page is on top
    const forward = FORWARD.has(e.key);
    if (!forward && !BACK.has(e.key)) return;
    // Space on a focused button already clicks it; do not step twice.
    if ((e.key === ' ' || e.key === 'Spacebar') && e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    e.preventDefault();
    if (forward) this.next();
    else this.prev();
  };

  // ---- UI ----

  private mount(root: HTMLElement) {
    const heading = h('h2', {});
    const body = h('p', { class: 'caption-body' });
    const caption = h('section', { class: 'caption', 'aria-live': 'polite', 'aria-label': 'Lecture caption' }, heading, body);
    const prev = h('button', { type: 'button', class: 'pres-btn', 'data-action': 'prev' }, '‹ Prev');
    const next = h('button', { type: 'button', class: 'pres-btn pres-next', 'data-action': 'next' }, 'Next ›');
    const dots = h('div', { class: 'step-dots', role: 'group', 'aria-label': 'Steps' });
    const bar = h('nav', { class: 'presenter', 'aria-label': 'Lecture steps' }, prev, dots, next);
    prev.addEventListener('click', () => this.prev());
    next.addEventListener('click', () => {
      const { step } = this.store.get();
      if (step >= this.lecture.steps.length - 1) this.store.set({ view: 'explore' });
      else this.next();
    });
    root.append(caption, bar);
    return { caption, heading, body, bar, prev, next, dots };
  }

  private render(): void {
    const ui = this.ui;
    if (!ui) return;
    const s = this.store.get();
    const inLecture = s.view === 'lecture';
    ui.caption.hidden = !inLecture;
    ui.bar.hidden = !inLecture;
    if (!inLecture) return;

    const lecture = this.lecture;
    const n = lecture.steps.length;
    const k = Math.min(Math.max(0, s.step), n - 1);
    const step = lecture.steps[k];
    ui.heading.textContent = `Step ${k + 1} of ${n} · ${step.title}`;

    const r = this.store.result();
    const key = `${lecture.id}:${k}`;
    if (key !== this.shown.key || r !== this.shown.r) {
      this.shown = { key, r };
      ui.body.textContent = r.ok
        ? step.caption(r, s.inputs)
        : `These settings have no valid solution: ${r.error.message} Press Prev or Next to return to the lesson.`;
    }

    ui.prev.disabled = k === 0;
    ui.next.textContent = k === n - 1 ? 'Explore ›' : 'Next ›';
    ui.next.title = k === n - 1 ? 'Leave the lecture and try it yourself in Explore' : 'Next step';

    const done = new Set(getProgress().steps[lecture.id] ?? []);
    if (ui.dots.children.length !== n || ui.dots.dataset.lecture !== lecture.id) {
      ui.dots.dataset.lecture = lecture.id;
      ui.dots.replaceChildren(
        ...lecture.steps.map((st, j) => {
          const b = h('button', { type: 'button', class: 'step-dot', 'aria-label': `Step ${j + 1}: ${st.title}`, title: `${j + 1}. ${st.title}` });
          b.addEventListener('click', () => this.go(j));
          return b;
        }),
      );
    }
    [...ui.dots.children].forEach((b, j) => {
      b.toggleAttribute('aria-current', false);
      if (j === k) b.setAttribute('aria-current', 'step');
      b.classList.toggle('done', done.has(j));
    });
  }
}
