// Component cards (spec §6): rendering, plus the wiring that shows the selected part's
// card in the Explore panel slot, or as a projector-sized overlay in Lecture view.
// All interpolated text goes in through text nodes; KaTeX output is the only innerHTML.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { cardFor, type Card, type TraySub } from '../content/components';
import type { Inputs } from '../../engine/types';
import type { PartRef, Store } from '../state';
import { h } from './dom';

export interface RenderOptions {
  /** 'overlay' is the Lecture / projector variant (≥ 22 px body text). */
  size: 'panel' | 'overlay';
  /** Tray cards: hovering "deck", "weir" or "downcomer" lights that sub-mesh (null on leave). */
  onSub?: (tray: number, sub: TraySub | null) => void;
  /** Adds a close button to the card header. */
  onClose?: () => void;
}

const SUB_WORD = /\b(deck|weir|downcomer)s?\b/gi;

/** The "How it works" paragraph; on tray cards the sub-part words become hover targets. */
function howParagraph(card: Card, opts: RenderOptions): HTMLElement {
  const p = h('p', {});
  const tray = card.tray;
  if (card.kind !== 'tray' || tray === undefined || !opts.onSub) {
    p.textContent = card.how;
    return p;
  }
  const onSub = opts.onSub;
  let last = 0;
  for (const m of card.how.matchAll(SUB_WORD)) {
    const at = m.index ?? 0;
    if (at > last) p.append(card.how.slice(last, at));
    const sub = m[1].toLowerCase() as TraySub;
    const w = h('span', { class: 'sub-word', 'data-sub': sub, tabindex: 0, title: `Highlight the ${sub} in 3D` }, m[0]);
    const on = () => onSub(tray, sub);
    const off = () => onSub(tray, null);
    w.addEventListener('mouseenter', on);
    w.addEventListener('mouseleave', off);
    w.addEventListener('focus', on);
    w.addEventListener('blur', off);
    p.append(w);
    last = at + m[0].length;
  }
  if (last < card.how.length) p.append(card.how.slice(last));
  return p;
}

function equation(tex: string): HTMLElement {
  const el = h('div', { class: 'eq' });
  // KaTeX escapes its own output; throwOnError:false shows a bad source in red instead of throwing.
  el.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode: true });
  return el;
}

const rows = (pairs: [string, string][]) =>
  h('dl', {}, ...pairs.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)]));

/** Render a card into `el` (replacing its content). Returns the card element. */
export function renderCard(card: Card, el: HTMLElement, opts: RenderOptions): HTMLElement {
  const section = (title: string, ...kids: Node[]) => h('section', {}, h('h4', {}, title), ...kids);
  const close = opts.onClose
    ? h('button', { type: 'button', class: 'card-close', 'data-action': 'close', 'aria-label': 'Close card' }, '×')
    : null;
  if (close && opts.onClose) close.addEventListener('click', opts.onClose);
  const article = h(
    'article',
    { class: `card card--${opts.size}`, 'data-kind': card.kind },
    h('header', {}, h('small', { class: 'card-tag' }, card.tag), h('h3', {}, card.title), close),
    section('What it is', h('p', {}, card.what)),
    section('How it works', howParagraph(card, opts)),
    section('Key equations', ...card.equations.map(equation)),
    section('Live values', rows(card.live)),
    section('Typical design values', rows(card.typical)),
    section('What goes wrong', h('ul', {}, ...card.problems.map((p) => h('li', {}, p)))),
  );
  el.replaceChildren(article);
  return article;
}

export interface CardsOptions {
  /** Light / clear one tray sub-mesh in 3D (Plant.highlightSub). */
  onSub?: (tray: number, sub: TraySub | null) => void;
}

const sameRef = (a: PartRef | null, b: PartRef | null) => a?.kind === b?.kind && a?.tray === b?.tray;

/**
 * Show the selected part's card: in the Explore panel's "selected part" slot, or in
 * Lecture view as a large overlay with a close button (Escape also closes it).
 */
export function mountCards(root: HTMLElement, store: Store, opts: CardsOptions = {}): () => void {
  const slot = root.querySelector<HTMLElement>('[data-slot="selected-part"]');
  const body = h('div', { class: 'card-overlay-body' });
  const overlay = h('div', { class: 'card-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Component card', hidden: true }, body);
  root.append(overlay);

  const deselect = () => store.set({ selected: null });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) deselect(); // click on the dimmed backdrop
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !overlay.hidden) deselect();
  };
  window.addEventListener('keydown', onKey);

  /** The inputs that produced store.lastOk(): purities, E_o and pressure are inputs. */
  let okInputs: Inputs = store.get().inputs;
  let shown: { sel: PartRef | null; r: unknown; view: string } = { sel: null, r: null, view: '' };
  let litTray: number | null = null;

  const clearSub = () => {
    if (litTray !== null) opts.onSub?.(litTray, null);
    litTray = null;
  };
  const onSub = opts.onSub
    ? (tray: number, sub: TraySub | null) => {
        litTray = sub ? tray : null;
        opts.onSub?.(tray, sub);
      }
    : undefined;

  const update = () => {
    const s = store.get();
    if (store.result().ok) okInputs = s.inputs;
    const r = store.lastOk();
    const sel = r ? s.selected : null;
    if (sameRef(sel, shown.sel) && r === shown.r && s.view === shown.view) return;
    const newPart = !sameRef(sel, shown.sel);
    shown = { sel, r, view: s.view };
    clearSub();

    if (!sel || !r) {
      slot?.replaceChildren();
      body.replaceChildren();
      overlay.hidden = true;
      return;
    }
    const card = cardFor(sel, { r, inputs: okInputs });
    if (s.view === 'lecture') {
      slot?.replaceChildren();
      renderCard(card, body, { size: 'overlay', onSub, onClose: deselect });
      overlay.hidden = false;
    } else {
      body.replaceChildren();
      overlay.hidden = true;
      if (slot) {
        renderCard(card, slot, { size: 'panel', onSub, onClose: deselect });
        if (newPart) slot.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }
    }
  };
  update();
  const off = store.subscribe(update);

  return () => {
    off();
    clearSub();
    window.removeEventListener('keydown', onKey);
    slot?.replaceChildren();
    overlay.remove();
  };
}
