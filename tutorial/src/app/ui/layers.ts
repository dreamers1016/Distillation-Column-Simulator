// Escape-to-close for stacked overlays (Lecture card overlay, Components page).
// Escape closes only the most recently opened layer, never everything at once.
type Close = () => void;

const stack: Close[] = [];
let installed = false;

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || stack.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  stack[stack.length - 1]();
}

/** Register an open layer; returns the function that unregisters it (call it on close). */
export function pushLayer(close: Close): () => void {
  if (!installed) {
    installed = true;
    window.addEventListener('keydown', onKey);
  }
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}
