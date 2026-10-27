// Top bar: title, Lecture | Explore, Simple | Advanced, Cutaway toggle, Components link.
import { setMode, type Store } from '../state';
import { h } from './dom';

export function mountTopbar(host: HTMLElement, store: Store): () => void {
  const btn = (label: string, onClick: () => void, extra: Record<string, string | boolean> = {}) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', ...extra }, label);
    b.addEventListener('click', onClick);
    return b;
  };

  // Lecture mode arrives in a later task; the switch is shown but disabled until then.
  const lecture = btn('Lecture', () => store.set({ view: 'lecture' }), { disabled: true, title: 'Lecture mode is coming soon' });
  const explore = btn('Explore', () => store.set({ view: 'explore' }));
  const simple = btn('Simple', () => setMode(store, 'simple'));
  const advanced = btn('Advanced', () => setMode(store, 'advanced'));
  const cutaway = btn('Cutaway', () => store.set((s) => ({ cutaway: !s.cutaway })));

  const bar = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('h1', {}, 'LEARN DISTILLATION'), h('small', {}, 'EXPLORE · UNDERSTAND · DESIGN')),
    h(
      'nav',
      { class: 'topbar-controls' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, lecture, explore),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Calculation mode' }, simple, advanced),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Column view' }, cutaway),
      h('a', { class: 'toplink', href: 'components.html' }, 'Components'),
    ),
  );
  host.append(bar);

  const press = (b: HTMLButtonElement, on: boolean) => b.setAttribute('aria-pressed', String(on));
  const sync = () => {
    const s = store.get();
    press(lecture, s.view === 'lecture');
    press(explore, s.view === 'explore');
    press(simple, s.inputs.mode === 'simple');
    press(advanced, s.inputs.mode === 'advanced');
    press(cutaway, s.cutaway);
    document.body.dataset.view = s.view;
  };
  sync();
  const off = store.subscribe(sync);
  return () => {
    off();
    bar.remove();
  };
}
