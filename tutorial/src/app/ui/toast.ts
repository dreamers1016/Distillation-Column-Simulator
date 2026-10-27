// Transient message shown at the bottom centre (e.g. the Advanced-only fallback notice).
import type { Store } from '../state';
import { h } from './dom';

const VISIBLE_MS = 6000;

export function mountToast(host: HTMLElement, store: Store): () => void {
  const box = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
  host.append(box);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const off = store.onToast((message) => {
    box.textContent = message;
    box.hidden = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      box.hidden = true;
    }, VISIBLE_MS);
  });

  return () => {
    off();
    if (timer !== undefined) clearTimeout(timer);
    box.remove();
  };
}
