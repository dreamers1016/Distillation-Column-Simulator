// @vitest-environment jsdom
// Component cards (spec §6) and the Components page: content rules, rendering, wiring.
import { describe, it, expect, beforeEach } from 'vitest';
import { CARD_CONTENT, CARD_ORDER, type Card, type CardCtx } from '../../src/app/content/components';
import { renderCard, mountCards } from '../../src/app/ui/cards';
import { renderComponentsPage, mountComponentsPage } from '../../src/app/ui/componentsPage';
import { mountPanel } from '../../src/app/ui/panel';
import { createStore, defaultInputs, defaultState, type PartRef, type Store } from '../../src/app/state';
import { COMPONENTS } from '../../src/engine/components';
import { MIXTURES, type MixtureId } from '../../src/engine/mixtures';
import { solve } from '../../src/engine/solve';
import type { Inputs, Mode, Results } from '../../src/engine/types';
import { bubblePoint } from '../../src/engine/vle';

const SIMPLE_MIXTURES: MixtureId[] = ['methanol-water', 'benzene-toluene', 'hexane-heptane', 'methanol-ethanol'];
const ADVANCED_MIXTURES = (Object.keys(MIXTURES) as MixtureId[]).filter((id) => MIXTURES[id].verified);
const FORBIDDEN = /blue liquid|orange vapou?r/i;

function ctxFor(mixtureId: MixtureId, mode: Mode, tray?: number): CardCtx {
  const inputs: Inputs = { ...defaultInputs(), ...MIXTURES[mixtureId].defaults, mixtureId, mode };
  const r = solve(inputs);
  if (!r.ok) throw new Error(`${mixtureId} ${mode} must solve: ${r.error.message}`);
  return { r: r as Results, inputs, tray };
}

/** Every string in a card, KaTeX sources included. */
const cardText = (c: Card) =>
  [c.title, c.tag, c.what, c.how, ...c.equations, ...c.live.flat(), ...c.typical.flat(), ...c.problems].join('\n');

const allCards = (ctx: CardCtx) => CARD_ORDER.map((k) => CARD_CONTENT[k](ctx));

describe('card content', () => {
  it('lists all 14 kinds in the Components-page order', () => {
    expect(CARD_ORDER).toEqual([
      'column', 'tray', 'feed', 'distributor', 'sump', 'condenser', 'cwSystem',
      'refluxDrum', 'reboiler', 'steamSystem', 'skirt', 'manway', 'platform', 'nozzle',
    ]);
    expect(Object.keys(CARD_CONTENT).sort()).toEqual([...CARD_ORDER].sort());
  });

  for (const mode of ['simple', 'advanced'] as const) {
    it(`every kind has all six sections non-empty (${mode})`, () => {
      const ctx = ctxFor('methanol-water', mode, 3);
      for (const k of CARD_ORDER) {
        const c = CARD_CONTENT[k](ctx);
        expect(c.title, k).not.toBe('');
        expect(c.tag, k).not.toBe('');
        expect(c.what.trim(), `${k} what`).not.toBe('');
        expect(c.how.trim(), `${k} how`).not.toBe('');
        expect(c.equations.length, `${k} equations`).toBeGreaterThan(0);
        expect(c.live.length, `${k} live`).toBeGreaterThan(0);
        expect(c.typical.length, `${k} typical`).toBeGreaterThan(0);
        expect(c.problems.length, `${k} problems`).toBeGreaterThan(0);
        for (const [label, value] of [...c.live, ...c.typical]) {
          expect(label.trim(), k).not.toBe('');
          expect(value.trim(), k).not.toBe('');
        }
      }
    });
  }

  for (const id of SIMPLE_MIXTURES) {
    it(`${id} (Simple): names the chemicals, never "blue liquid / orange vapour"`, () => {
      const ctx = ctxFor(id, 'simple', 2);
      const heavy = COMPONENTS[MIXTURES[id].heavy].name.toLowerCase();
      for (const c of allCards(ctx)) expect(cardText(c)).not.toMatch(FORBIDDEN);
      expect(cardText(CARD_CONTENT.reboiler(ctx)).toLowerCase()).toContain(heavy);
    });
  }

  it('never prints NaN, undefined or Infinity (every mixture, both modes)', () => {
    const cases: [MixtureId, Mode][] = [
      ...SIMPLE_MIXTURES.map((id) => [id, 'simple'] as [MixtureId, Mode]),
      ...ADVANCED_MIXTURES.map((id) => [id, 'advanced'] as [MixtureId, Mode]),
    ];
    for (const [id, mode] of cases) {
      for (const tray of [undefined, 1, 3, 999]) {
        for (const c of allCards(ctxFor(id, mode, tray))) {
          expect(cardText(c), `${id} ${mode} ${c.title}`).not.toMatch(/NaN|undefined|Infinity|null/);
        }
      }
    }
  });

  it('tray card 3 for methanol-water Advanced shows x, y, T and γ, flagged as interpolated', () => {
    const c = CARD_CONTENT.tray(ctxFor('methanol-water', 'advanced', 3));
    const t = cardText(c);
    expect(t).toContain('x =');
    expect(t).toContain('y =');
    expect(t).toContain('°C');
    expect(t).toMatch(/γ/);
    expect(t).toMatch(/interpolated between theoretical stages/);
    expect(c.title).toMatch(/Tray 3 of \d+/);
    expect(t).toMatch(/NRTL/);
  });

  it('tray card in Simple says the profile is Advanced mode only and states constant α and CMO', () => {
    const t = cardText(CARD_CONTENT.tray(ctxFor('benzene-toluene', 'simple', 3)));
    expect(t).toContain('Advanced mode only');
    expect(t).not.toContain('x =');
    expect(t).toMatch(/constant α/i);
    expect(t).toMatch(/constant molar overflow|CMO/);
  });

  it('the reboiler card never mentions LMTD and uses ΔT = Tsat − Treb', () => {
    for (const mode of ['simple', 'advanced'] as const) {
      const c = CARD_CONTENT.reboiler(ctxFor('methanol-water', mode));
      expect(cardText(c)).not.toMatch(/LMTD|\\ln|lm\}/);
      expect(c.equations.some((e) => /T_\{\\?(text|mathrm)\{sat\}\}\s*-\s*T_\{\\?(text|mathrm)\{reb\}\}/.test(e))).toBe(true);
    }
  });

  it('condenser and reboiler cards show the utility selection reason', () => {
    const ctx = ctxFor('methanol-water', 'simple');
    expect(cardText(CARD_CONTENT.condenser(ctx))).toContain(ctx.r.condenser.reason);
    expect(cardText(CARD_CONTENT.reboiler(ctx))).toContain(ctx.r.reboiler.reason);
  });

  it('carries none of the §5.7 errors: trays = (N − 1)/E_o, Rmin by pinch, no ×1.08, no R_eff', () => {
    const ctx = ctxFor('methanol-water', 'simple');
    const all = allCards(ctx).map(cardText).join('\n');
    expect(all).not.toMatch(/1\.08|R_\{?eff|R_\{?\\?(text|mathrm)\{eff/);
    const col = cardText(CARD_CONTENT.column(ctx));
    expect(col).toMatch(/N\s*-\s*1/);
    expect(col).toMatch(/E_o|E_\{o\}/);
    const drum = cardText(CARD_CONTENT.refluxDrum(ctx));
    expect(drum).toMatch(/pinch/i);
    // The q = 1-only closed-form (Underwood / King) Rmin must not appear.
    expect(drum).not.toMatch(/\\alpha\s*x_D|\\alpha\s*\(1\s*-\s*x_D\)/);
  });

  it('the column card says the diameter is illustrative', () => {
    expect(cardText(CARD_CONTENT.column(ctxFor('benzene-toluene', 'simple')))).toMatch(/diameter[^.]*illustrative/i);
  });

  it('Simple methanol-water notes that constant α is an approximation (not for benzene-toluene)', () => {
    const mw = ctxFor('methanol-water', 'simple');
    expect(cardText(CARD_CONTENT.column(mw))).toMatch(/constant α[^.]*approximation/i);
    expect(cardText(CARD_CONTENT.tray(mw))).toMatch(/constant α[^.]*approximation/i);
    expect(cardText(CARD_CONTENT.column(ctxFor('benzene-toluene', 'simple')))).not.toMatch(/approximation/i);
  });

  it('templates the mixture names into the tray story in relative terms', () => {
    const t = cardText(CARD_CONTENT.tray(ctxFor('methanol-water', 'simple', 2)));
    expect(t).toMatch(/vapour rising from below[^.]*is richer in methanol than the liquid on the tray/i);
    expect(t).toMatch(/liquid leaves leaner in methanol/i);
  });

  it('makes no absolute composition claims about the internal streams (reflux is methanol-rich, reboiler vapour is water-rich)', () => {
    for (const mode of ['simple', 'advanced'] as const) {
      const ctx = ctxFor('methanol-water', mode, 2);
      const cards = [CARD_CONTENT.column(ctx), CARD_CONTENT.tray(ctx), CARD_CONTENT.tray({ ...ctx, tray: undefined }), CARD_CONTENT.sump(ctx), CARD_CONTENT.reboiler(ctx)];
      for (const c of cards) expect(cardText(c), c.title).not.toMatch(/(methanol|water)-rich/i);
    }
    expect(cardText(CARD_CONTENT.column(ctxFor('methanol-water', 'simple')))).toMatch(/vapour arriving from below is richer in methanol than the liquid/);
    expect(cardText(CARD_CONTENT.reboiler(ctxFor('methanol-water', 'simple')))).toMatch(/mostly water/);
  });

  it('tray 1 is fed by the reflux distributor; lower trays by the downcomer above', () => {
    const ctx = ctxFor('methanol-water', 'advanced');
    expect(CARD_CONTENT.tray({ ...ctx, tray: 1 }).how).toMatch(/^Reflux from the distributor/);
    expect(CARD_CONTENT.tray({ ...ctx, tray: 1 }).how).not.toMatch(/downcomer of the tray above/);
    expect(CARD_CONTENT.tray({ ...ctx, tray: 2 }).how).toMatch(/^Liquid leaves the downcomer of the tray above/);
  });

  it('Advanced tray temperature is the bubble point of the displayed x (every tray, within 0.05 °C), γ from the same point', () => {
    for (const id of ['methanol-water', 'benzene-toluene'] as MixtureId[]) {
      const ctx = ctxFor(id, 'advanced');
      for (const p of ctx.r.trayProfile ?? []) {
        const c = CARD_CONTENT.tray({ ...ctx, tray: p.tray });
        const row = c.live.find(([label]) => label === 'Tray temperature');
        const shown = Number(row?.[1].match(/^(-?[\d.]+) °C/)?.[1]);
        const bub = bubblePoint(ctx.r.mixture, p.x, ctx.inputs.P_bar);
        expect(Math.abs(shown - (bub.T_K - 273.15)), `${id} tray ${p.tray}`).toBeLessThanOrEqual(0.05);
        if (id === 'methanol-water') {
          const g = c.live.find(([label]) => label.startsWith('Activity coefficients'))?.[1] ?? '';
          expect(g).toContain(`γ methanol = ${bub.gamma[0].toFixed(2)}`);
          expect(g).toContain(`γ water = ${bub.gamma[1].toFixed(2)}`);
        }
      }
    }
  });

  it('the generic tray card (no tray chosen) shows both operating lines', () => {
    const c = CARD_CONTENT.tray(ctxFor('methanol-water', 'advanced'));
    expect(c.title).toBe('Sieve tray');
    expect(c.equations.some((e) => e.includes(String.raw`\dfrac{L}{V}`))).toBe(true);
    expect(c.equations.some((e) => e.includes(String.raw`\dfrac{L'}{V'}`))).toBe(true);
    expect(cardText(c)).not.toMatch(/x = /);
  });

  it('content corrections: q outside 0–1, tangent pinch, CUI range, steam-leak direction, misplaced feed', () => {
    const ctx = ctxFor('methanol-water', 'simple');
    const feed = cardText(CARD_CONTENT.feed(ctx));
    expect(feed).toMatch(/q > 1: a subcooled feed also condenses some rising vapour/);
    expect(feed).toMatch(/q < 0: a superheated feed vaporises some downflowing liquid/);
    expect(feed).toMatch(/steps bunch up near the operating-line intersection/);
    expect(cardText(CARD_CONTENT.refluxDrum(ctx))).toMatch(/tangent pinch[^.]*tangent to the equilibrium curve, not the q-line intersection/);
    expect(cardText(CARD_CONTENT.column(ctx))).toMatch(/at risk between about −4 °C and 175 °C/);
    expect(cardText(CARD_CONTENT.column(ctx))).not.toMatch(/worst between/);
    const steam = cardText(CARD_CONTENT.steamSystem(ctx));
    expect(steam).toMatch(/steam is normally at the higher pressure/);
    expect(steam).toMatch(/only if the process pressure is higher/);
  });
});

describe('renderCard', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="c"></div>';
    el = document.getElementById('c') as HTMLElement;
  });

  it('renders the six sections with KaTeX equations', () => {
    const c = CARD_CONTENT.condenser(ctxFor('methanol-water', 'simple'));
    renderCard(c, el, { size: 'panel' });
    const heads = Array.from(el.querySelectorAll('h4')).map((h) => h.textContent);
    expect(heads).toEqual(['What it is', 'How it works', 'Key equations', 'Live values', 'Typical design values', 'What goes wrong']);
    expect(el.querySelectorAll('.katex').length).toBe(c.equations.length);
    expect(el.querySelector('.katex-error')).toBeNull();
  });

  it('every equation of every card renders without a KaTeX error', () => {
    for (const mode of ['simple', 'advanced'] as const) {
      for (const c of allCards(ctxFor('methanol-water', mode, 3))) {
        renderCard(c, el, { size: 'panel' });
        expect(el.querySelector('.katex-error'), `${mode} ${c.title}`).toBeNull();
        expect(el.querySelectorAll('.katex').length, c.title).toBe(c.equations.length);
      }
    }
  });

  it('the overlay variant is marked for projector-size text', () => {
    renderCard(CARD_CONTENT.column(ctxFor('methanol-water', 'simple')), el, { size: 'overlay' });
    expect(el.querySelector('.card')?.classList.contains('card--overlay')).toBe(true);
  });

  it('escapes interpolated text', () => {
    const c: Card = {
      title: '<img src=x onerror=alert(1)>', tag: 't', what: '<b>w</b>', how: 'h', equations: ['x'],
      live: [['<i>l</i>', '<script>1</script>']], typical: [['a', 'b']], problems: ['<u>p</u>'],
    };
    renderCard(c, el, { size: 'panel' });
    expect(el.querySelector('img, b, script, u')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('tray card: hovering deck / weir / downcomer asks for that sub-mesh highlight', () => {
    const calls: [number, string | null][] = [];
    const c = CARD_CONTENT.tray(ctxFor('methanol-water', 'advanced', 3));
    renderCard(c, el, { size: 'panel', onSub: (tray, sub) => calls.push([tray, sub]) });
    for (const sub of ['deck', 'weir', 'downcomer']) {
      const w = el.querySelector<HTMLElement>(`[data-sub="${sub}"]`);
      expect(w, sub).not.toBeNull();
      w!.dispatchEvent(new MouseEvent('mouseenter'));
      w!.dispatchEvent(new MouseEvent('mouseleave'));
    }
    expect(calls).toEqual([[3, 'deck'], [3, null], [3, 'weir'], [3, null], [3, 'downcomer'], [3, null]]);
  });
});

describe('Components page', () => {
  it('renders 14 cards in order', () => {
    document.body.innerHTML = '<div id="p"></div>';
    const el = document.getElementById('p') as HTMLElement;
    renderComponentsPage(el, ctxFor('methanol-water', 'simple'));
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.card'));
    expect(cards.length).toBe(14);
    expect(cards.map((c) => c.dataset.kind)).toEqual(CARD_ORDER);
  });

  const mountPage = () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root') as HTMLElement;
    const store = createStore(defaultState());
    const unmount = mountComponentsPage(root, store);
    return { root, store, unmount, page: () => root.querySelector<HTMLElement>('.components-page') as HTMLElement };
  };
  /** Let jsdom run its queued history-traversal tasks (nested zero-delay timeouts). */
  const settle = async () => {
    for (let i = 0; i < 20 && window.location.hash !== ''; i++) await new Promise((r) => setTimeout(r, 10));
  };

  it('opens on #components (link) and Back steps back in history instead of pushing', async () => {
    history.replaceState(null, '', '/');
    const { page, unmount } = mountPage();
    expect(page().hidden).toBe(true);
    window.location.hash = '#components'; // what the top-bar link does: one new history entry
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(page().hidden).toBe(false);
    expect(page().querySelectorAll('.card').length).toBe(14);
    const len = history.length;
    (page().querySelector('[data-action="back"]') as HTMLButtonElement).click();
    expect(page().hidden).toBe(true);
    await settle();
    expect(window.location.hash).toBe('');
    expect(history.length).toBe(len); // no extra entry, so browser Back cannot loop
    unmount();
  });

  it('deep-linked #components: Back replaces the entry', () => {
    history.replaceState(null, '', '/#components');
    const { page, unmount } = mountPage();
    expect(page().hidden).toBe(false);
    const len = history.length;
    (page().querySelector('[data-action="back"]') as HTMLButtonElement).click();
    expect(page().hidden).toBe(true);
    expect(window.location.hash).toBe('');
    expect(history.length).toBe(len);
    unmount();
  });
});

describe('mountCards', () => {
  let root: HTMLElement;
  let store: Store;
  const sel = (p: PartRef | null) => store.set({ selected: p });

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root') as HTMLElement;
    store = createStore({ ...defaultState(), view: 'explore' });
    mountPanel(root, store, { schedule: (fn) => fn() });
    mountCards(root, store);
  });

  it('Explore: the selected part card goes in the panel slot', () => {
    const slot = root.querySelector('[data-slot="selected-part"]') as HTMLElement;
    expect(slot.children.length).toBe(0);
    sel({ kind: 'reboiler' });
    expect(slot.querySelector('.card[data-kind="reboiler"]')).not.toBeNull();
    expect(slot.textContent).toMatch(/water/);
    sel(null);
    expect(slot.children.length).toBe(0);
  });

  it('Explore: a tray card names the true tray number', () => {
    sel({ kind: 'tray', tray: 4 });
    expect(root.querySelector('[data-slot="selected-part"] .card h3')?.textContent).toMatch(/Tray 4 of/);
  });

  it('Lecture: the card opens as a large overlay with a close button', () => {
    store.set({ view: 'lecture' });
    sel({ kind: 'condenser' });
    const ov = root.querySelector<HTMLElement>('.card-overlay');
    expect(ov?.hidden).toBe(false);
    expect(ov?.querySelector('.card--overlay')).not.toBeNull();
    (ov!.querySelector('[data-action="close"]') as HTMLButtonElement).click();
    expect(store.get().selected).toBeNull();
    expect(ov?.hidden).toBe(true);
  });

  it('Lecture overlay: focus moves to the close button and returns to the trigger on close', () => {
    const trigger = document.createElement('button');
    root.append(trigger);
    trigger.focus();
    store.set({ view: 'lecture' });
    sel({ kind: 'reboiler' });
    expect(document.activeElement).toBe(root.querySelector('.card-overlay [data-action="close"]'));
    store.set((s) => ({ inputs: { ...s.inputs, R: s.inputs.R * 1.5 } })); // a re-render keeps focus in the overlay
    const close = root.querySelector<HTMLElement>('.card-overlay [data-action="close"]') as HTMLElement;
    expect(document.activeElement).toBe(close);
    close.click();
    expect(store.get().selected).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape closes only the topmost layer: the card overlay first, then the Components page', () => {
    history.replaceState(null, '', '/');
    const unmountPage = mountComponentsPage(root, store);
    const page = root.querySelector<HTMLElement>('.components-page') as HTMLElement;
    window.location.hash = '#components';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    store.set({ view: 'lecture' });
    sel({ kind: 'condenser' });
    const ov = root.querySelector<HTMLElement>('.card-overlay') as HTMLElement;
    expect(ov.hidden).toBe(false);
    expect(page.hidden).toBe(false);
    const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    esc();
    expect(ov.hidden).toBe(true);
    expect(store.get().selected).toBeNull();
    expect(page.hidden).toBe(false);
    esc();
    expect(page.hidden).toBe(true);
    esc(); // nothing left open: no error
    unmountPage();
  });

  it('re-renders live values when the results change', () => {
    sel({ kind: 'condenser' });
    const before = root.querySelector('[data-slot="selected-part"]')?.textContent;
    store.set((s) => ({ inputs: { ...s.inputs, R: s.inputs.R * 2 } }));
    expect(root.querySelector('[data-slot="selected-part"]')?.textContent).not.toBe(before);
  });
});
