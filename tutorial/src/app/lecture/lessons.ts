// Lesson strip (spec §3.4, the Arduino "Lessons" list): every lecture script with a tick
// per step reached, plus the number of component cards viewed. Clicking a lesson enters
// Lecture view at its first step.
import { getProgress, onProgress } from '../progress';
import type { Store } from '../state';
import { h } from '../ui/dom';
import type { Presenter } from './presenter';
import { LECTURES, type Lecture } from './scripts';

export function mountLessons(root: HTMLElement, store: Store, presenter: Pick<Presenter, 'start'>, lectures: Lecture[] = LECTURES): () => void {
  const list = h('ul', {});
  const cards = h('small', { class: 'lessons-cards' });
  const strip = h('section', { class: 'lessons', 'aria-label': 'Lessons' }, h('h2', {}, 'LESSONS'), list, cards);
  root.append(strip);

  let shown = '';
  const render = () => {
    const p = getProgress();
    const s = store.get();
    shown = `${s.view}:${s.lectureId}`;
    list.replaceChildren(
      ...lectures.map((lec) => {
        const done = new Set(p.steps[lec.id] ?? []);
        const n = lec.steps.length;
        const count = lec.steps.filter((_, j) => done.has(j)).length;
        const current = s.view === 'lecture' && s.lectureId === lec.id;
        const ticks = h(
          'span',
          { class: 'ticks', 'aria-hidden': 'true' },
          ...lec.steps.map((_, j) => h('i', { class: done.has(j) ? 'tick done' : 'tick' })),
        );
        const b = h(
          'button',
          {
            type: 'button',
            'data-lecture': lec.id,
            'aria-current': current ? 'true' : undefined,
            'aria-label': `${lec.title}: ${count} of ${n} steps done`,
          },
          h('span', { class: 'lesson-title' }, lec.title),
          ticks,
          h('span', { class: 'lesson-count' }, `${count}/${n}`),
        );
        b.addEventListener('click', () => presenter.start(lec.id));
        return h('li', {}, b);
      }),
    );
    cards.textContent = `Component cards viewed: ${p.cards.length}`;
  };
  render();
  // Only the current-lesson mark depends on the store: skip unrelated changes (sliders).
  const onStore = () => {
    const s = store.get();
    const key = `${s.view}:${s.lectureId}`;
    if (key !== shown) render();
  };
  const offs = [onProgress(render), store.subscribe(onStore)];
  return () => {
    offs.forEach((off) => off());
    strip.remove();
  };
}
