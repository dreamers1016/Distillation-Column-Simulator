// Mounts the McCabe-Thiele diagram and (Advanced only) the column profile into
// a host element and keeps them in step with the store. When the current inputs
// cannot be solved the last valid charts stay up, greyed, like the results grid.
import type { Inputs, Results } from '../../engine/types';
import type { Store } from '../state';
import { h } from '../ui/dom';
import { curveFor } from './curveFor';
import { renderMcCabe } from './mccabe';
import { renderProfile } from './profile';
import { svgEl } from './svg';

const PROFILE_NOTE = 'Temperature profile available in Advanced mode';

export function mountCharts(host: HTMLElement, store: Store): () => void {
  const mtSvg = svgEl('svg', { class: 'chart-svg mt-chart' });
  const pfSvg = svgEl('svg', { class: 'chart-svg pf-chart' });
  const note = h('p', { class: 'chart-note', 'data-role': 'chart-note' });
  const empty = h('p', { class: 'chart-note' }, 'No valid result yet. Adjust the inputs above.');
  const mtSection = h('section', { class: 'chart-sec' }, h('h3', {}, 'MCCABE-THIELE DIAGRAM'), mtSvg);
  const pfSection = h('section', { class: 'chart-sec' }, h('h3', {}, 'COLUMN PROFILE'));
  const charts = h('div', { class: 'charts' }, empty);
  host.append(charts);

  let shown: { r: Results; inputs: Inputs } | null = null;
  let drawn: Results | null = null;

  const draw = ({ r, inputs }: { r: Results; inputs: Inputs }) => {
    renderMcCabe(mtSvg, r, curveFor(r, inputs), inputs);
    if (r.trayProfile) {
      renderProfile(pfSvg, r);
      pfSection.replaceChildren(h('h3', {}, 'COLUMN PROFILE'), pfSvg);
    } else {
      note.textContent = PROFILE_NOTE;
      pfSection.replaceChildren(h('h3', {}, 'COLUMN PROFILE'), note);
    }
    charts.replaceChildren(mtSection, pfSection);
    drawn = r;
  };

  const update = (inputs: Inputs, result: ReturnType<Store['result']>) => {
    if (result.ok) shown = { r: result, inputs };
    charts.classList.toggle('stale', !result.ok);
    if (shown && shown.r !== drawn) draw(shown);
  };
  update(store.get().inputs, store.result());
  const off = store.subscribe((s, r) => update(s.inputs, r));

  return () => {
    off();
    charts.remove();
  };
}
