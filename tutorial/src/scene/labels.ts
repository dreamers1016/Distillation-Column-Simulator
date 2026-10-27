// HTML pin labels rendered by CSS2DRenderer. Font size follows the body class
// (view-explore 11 px / view-lecture 14 px), see styles/app.css.
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export const LABEL_CLASS = 'pin';

export function makeLabel(text: string, onClick?: () => void): CSS2DObject {
  const el = document.createElement('div');
  el.className = LABEL_CLASS;
  el.textContent = text;
  if (onClick) {
    el.classList.add('clickable');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return new CSS2DObject(el);
}
