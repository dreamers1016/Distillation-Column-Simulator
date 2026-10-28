// Components page (spec §6): every component card, in order, for revision. It is an
// in-app view: a full-screen scrollable overlay opened by the top bar's Components
// link (#components) and closed with Back, browser Back or Escape. Cards use the
// current (last valid) results, so the live values match the 3D model.
import { CARD_CONTENT, CARD_ORDER, type CardCtx } from '../content/components';
import { mixtureLabel } from '../format';
import type { Inputs, Results } from '../../engine/types';
import type { Store } from '../state';
import { renderCard } from './cards';
import { h } from './dom';

export const COMPONENTS_HASH = '#components';

/** Render all 14 cards into `el` (replacing its content). */
export function renderComponentsPage(el: HTMLElement, ctx: CardCtx): void {
  const grid = h('div', { class: 'components-grid' });
  for (const kind of CARD_ORDER) {
    const cell = h('div', { class: 'components-cell' });
    renderCard(CARD_CONTENT[kind](ctx), cell, { size: 'panel' });
    grid.append(cell);
  }
  el.replaceChildren(grid);
}

export function mountComponentsPage(root: HTMLElement, store: Store): () => void {
  const back = h('button', { type: 'button', class: 'toplink', 'data-action': 'back' }, '← Back');
  const heading = h('h2', {}, 'Components');
  const sub = h('small', {});
  const body = h('div', { class: 'components-body' });
  const page = h(
    'div',
    { class: 'components-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Components', hidden: true },
    h('header', { class: 'components-head' }, back, h('div', {}, heading, sub)),
    body,
  );
  root.append(page);

  let okInputs: Inputs = store.get().inputs;
  let shownFor: Results | null = null;

  const render = () => {
    if (store.result().ok) okInputs = store.get().inputs;
    if (page.hidden) return;
    const r = store.lastOk();
    if (r === shownFor) return;
    shownFor = r;
    if (!r) {
      sub.textContent = '';
      body.replaceChildren(h('p', { class: 'empty' }, 'No valid result yet: adjust the inputs in Explore.'));
      return;
    }
    sub.textContent = `${mixtureLabel(r.mixture.id)} · ${r.mode === 'simple' ? 'Simple' : 'Advanced'} mode · live values from the current design`;
    renderComponentsPage(body, { r, inputs: okInputs });
  };

  const open = () => {
    if (!page.hidden) return;
    page.hidden = false;
    shownFor = null;
    render();
    page.scrollTop = 0;
    back.focus();
  };
  const close = () => {
    page.hidden = true;
  };
  const sync = () => (window.location.hash === COMPONENTS_HASH ? open() : close());

  back.addEventListener('click', () => {
    if (window.location.hash === COMPONENTS_HASH) {
      // Drop the fragment without a page jump; hashchange does not fire for pushState.
      history.pushState(null, '', window.location.pathname + window.location.search);
    }
    close();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !page.hidden) back.click();
  };
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);
  window.addEventListener('keydown', onKey);
  const off = store.subscribe(render);
  sync();

  return () => {
    off();
    window.removeEventListener('hashchange', sync);
    window.removeEventListener('popstate', sync);
    window.removeEventListener('keydown', onKey);
    page.remove();
  };
}
