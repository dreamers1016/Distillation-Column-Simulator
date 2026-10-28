// Components page (spec §6): every component card, in order, for revision. It is an
// in-app view: a full-screen scrollable overlay opened by the top bar's Components
// link (#components) and closed with Back, browser Back or Escape (topmost layer first). Cards use the
// current (last valid) results, so the live values match the 3D model.
import { CARD_CONTENT, CARD_ORDER, type CardCtx } from '../content/components';
import { mixtureLabel } from '../format';
import type { Inputs, Results } from '../../engine/types';
import type { Store } from '../state';
import { renderCard } from './cards';
import { h } from './dom';
import { pushLayer } from './layers';

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

  /** True when the page was entered by navigating to #components (a history entry exists to go back to). */
  let enteredByNavigation = false;
  let popLayer: (() => void) | null = null;
  let trigger: Element | null = null;

  const open = () => {
    if (!page.hidden) return;
    trigger = document.activeElement;
    page.hidden = false;
    shownFor = null;
    render();
    page.scrollTop = 0;
    back.focus();
    popLayer = pushLayer(goBack);
  };
  const close = () => {
    if (page.hidden) return;
    page.hidden = true;
    popLayer?.();
    popLayer = null;
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    trigger = null;
  };
  const sync = (fromNavigation: boolean) => {
    if (window.location.hash === COMPONENTS_HASH) {
      if (page.hidden) enteredByNavigation = fromNavigation;
      open();
    } else {
      close();
    }
  };
  const onNavigate = () => sync(true);

  /**
   * Leave the page. Entered via the link: step back in history, so the browser Back
   * button does not loop between the two entries. Deep-linked: replace the entry.
   */
  function goBack(): void {
    if (window.location.hash === COMPONENTS_HASH) {
      if (enteredByNavigation) history.back();
      else history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    close();
  }

  back.addEventListener('click', goBack);
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('popstate', onNavigate);
  const off = store.subscribe(render);
  sync(false);

  return () => {
    off();
    window.removeEventListener('hashchange', onNavigate);
    window.removeEventListener('popstate', onNavigate);
    close();
    page.remove();
  };
}
