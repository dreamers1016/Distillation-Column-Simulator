import './styles/tokens.css';
import './styles/app.css';
import { createStore, type PartRef } from './app/state';
import { mountPanel } from './app/ui/panel';
import { mountToast } from './app/ui/toast';
import { mountTopbar } from './app/ui/topbar';
import type { Results } from './engine/types';
import { CameraDirector, rightInsetFor } from './scene/camera';
import { Picker } from './scene/picking';
import { buildPlant, disposePlantResources, type LegendEntry, type Plant } from './scene/plant';
import { createScene } from './scene/scene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container missing from index.html');

const store = createStore();
mountTopbar(app, store);
mountPanel(app, store);
mountToast(app, store);

// 3D stage behind the UI: the procedural plant is rebuilt from the last valid result.
const stageEl = document.querySelector<HTMLDivElement>('#stage');
if (!stageEl) throw new Error('#stage container missing from index.html');

const stage = createScene(stageEl);
const director = new CameraDirector(stage.camera, stage.controls, () => ({
  width: stageEl.clientWidth || window.innerWidth,
  height: stageEl.clientHeight || window.innerHeight,
}));
stage.onFrame((dt) => director.update(dt));

const picker = new Picker(stage.camera, stage.renderer.domElement);
const select = (selected: PartRef) => store.set({ selected });
picker.onPick(select);

// ---- plant: rebuild on a new valid result or a cutaway change; grey it while invalid ----
const legendEl = document.createElement('div');
legendEl.className = 'pipe-legend';
legendEl.setAttribute('aria-label', 'Pipe colours by service');
app.append(legendEl);
const renderLegend = (entries: LegendEntry[]) => {
  legendEl.replaceChildren(
    ...entries.map(({ label, color }) => {
      const row = document.createElement('span');
      const sw = document.createElement('i');
      sw.style.background = color;
      row.append(sw, label);
      return row;
    }),
  );
};

/** Width of the Explore panel's cover over the right edge of the stage, px (0 for a bottom sheet). */
const rightInset = () => {
  const panel = document.querySelector<HTMLElement>('.panel');
  return panel ? rightInsetFor(panel.getBoundingClientRect(), stageEl.clientWidth || window.innerWidth) : 0;
};

let plant: Plant | null = null;
let builtFrom: { r: Results; cutaway: boolean } | null = null;
let framed = false;
/** Inputs that produced store.lastOk(): purities are inputs, and the current inputs may be invalid. */
let okInputs = store.get().inputs;

const syncPlant = () => {
  const s = store.get();
  if (store.result().ok) okInputs = s.inputs;
  const r = store.lastOk();
  if (r && (builtFrom?.r !== r || builtFrom.cutaway !== s.cutaway)) {
    performance.mark('plant-rebuild-start');
    plant?.dispose();
    plant = buildPlant(r, {
      cutaway: s.cutaway,
      utilityColors: true,
      products: { xD: okInputs.xD, xB: okInputs.xB },
      onSelect: select,
    });
    stage.scene.add(plant.group);
    picker.setRoots([plant.group]);
    builtFrom = { r, cutaway: s.cutaway };
    performance.clearMeasures('plant-rebuild');
    performance.measure('plant-rebuild', 'plant-rebuild-start');
    renderLegend(plant.legend);
    // Tall (100+ tray) columns need more zoom-out room than the default.
    stage.controls.maxDistance = Math.max(90, plant.anchors.overview.dist * 1.3);
    if (!framed) {
      framed = true;
      const o = plant.anchors.overview;
      director.flyTo(o.look, o.dist, { rightInsetPx: rightInset() });
    }
  }
  if (!plant) return;
  plant.setGhost(!store.result().ok);
  plant.highlight(s.selected);
};
syncPlant();
store.subscribe(syncPlant);

// Body class drives label font size (view-explore 11 px / view-lecture 14 px).
const syncViewClass = () => {
  const { view } = store.get();
  document.body.classList.toggle('view-lecture', view === 'lecture');
  document.body.classList.toggle('view-explore', view === 'explore');
};
syncViewClass();
store.subscribe(syncViewClass);

import.meta.hot?.dispose(() => {
  plant?.dispose();
  disposePlantResources();
  legendEl.remove();
  picker.dispose();
  director.dispose();
  stage.dispose();
});
