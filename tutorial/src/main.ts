import './styles/tokens.css';
import './styles/app.css';
import { Box3, type Vector3 } from 'three';
import { mountLessons } from './app/lecture/lessons';
import { Presenter, type Flyer } from './app/lecture/presenter';
import { trackCardViews } from './app/progress';
import { createStore, type AppState, type PartRef } from './app/state';
import { mountCards } from './app/ui/cards';
import { mountComponentsPage } from './app/ui/componentsPage';
import { mountPanel } from './app/ui/panel';
import { mountToast } from './app/ui/toast';
import { mountTopbar } from './app/ui/topbar';
import type { Results } from './engine/types';
import { bottomInsetFor, CameraDirector, rightInsetFor, type FramingOptions } from './scene/camera';
import { createFlow, type Flow } from './scene/flow';
import { Picker } from './scene/picking';
import { buildPlant, disposePlantResources, type LegendEntry, type Plant } from './scene/plant';
import { createScene } from './scene/scene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container missing from index.html');

const store = createStore();
/** Teardown for HMR (dev only): every mount and subscription registers its disposer here. */
const disposers: Array<() => void> = [];
disposers.push(mountTopbar(app, store), mountPanel(app, store));
/** The 3D plant, rebuilt from each valid result (below); declared first so callbacks can use it. */
let plant: Plant | null = null;

// Selected-part card: Explore panel slot, or a large overlay in Lecture view. Hovering
// "deck" / "weir" / "downcomer" on a tray card lights that sub-mesh (plant is built below).
disposers.push(
  mountCards(app, store, { onSub: (tray, sub) => plant?.highlightSub(tray, sub) }),
  mountComponentsPage(app, store),
  mountToast(app, store),
);

// 3D stage behind the UI: the procedural plant is rebuilt from the last valid result.
const stageEl = document.querySelector<HTMLDivElement>('#stage');
if (!stageEl) throw new Error('#stage container missing from index.html');

const stage = createScene(stageEl);
const stageSize = () => ({
  width: stageEl.clientWidth || window.innerWidth,
  height: stageEl.clientHeight || window.innerHeight,
});
const director = new CameraDirector(stage.camera, stage.controls, stageSize);
stage.onFrame((dt) => director.update(dt));
stage.onFrame((dt) => flow?.update(dt));

const picker = new Picker(stage.camera, stage.renderer.domElement);
const select = (selected: PartRef) => store.set({ selected });
picker.onPick(select);

// ---- the left-hand dock: lesson strip, then (Lecture view) the caption card and presenter bar ----
// In Lecture at desktop widths it stays inside the left 38 % that caption-safe framing keeps
// clear; at narrow widths (CSS, <= 900 px) it becomes a band along the bottom.
const dock = document.createElement('div');
dock.className = 'dock';
app.append(dock);

// ---- camera framing: keep the framed object clear of whatever UI covers the stage ----
const rectOf = (sel: string | Element | null): DOMRect | null => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  return el instanceof HTMLElement && !el.hidden ? el.getBoundingClientRect() : null;
};
/** UI covering the stage edges in `view`, measured from the DOM: the top bar always, then
 *  the caption dock (Lecture) or the Explore panel (side panel or bottom sheet). */
function coverFor(view: AppState['view']): FramingOptions {
  const { width: W, height: H } = stageSize();
  let top = Math.max(0, rectOf('.topbar')?.bottom ?? 0);
  const d = rectOf(dock);
  const dockIsBand = !!d && d.width > W / 2 && d.height > 0; // narrow layout: full-width dock
  if (view === 'lecture') {
    if (dockIsBand && d && d.top > H / 3) {
      // narrow: caption band at the bottom, pipe legend (if shown) across the top
      const lg = rectOf(legendEl);
      if (lg && lg.height > 0 && lg.top < H / 3) top = Math.max(top, lg.bottom);
      return { topInsetPx: top, bottomInsetPx: Math.max(0, H - d.top) };
    }
    return { captionSafe: true, topInsetPx: top };
  }
  if (dockIsBand && d && d.top < H / 3) top = Math.max(top, d.bottom); // lesson strip across the top
  const p = rectOf('.panel');
  return {
    topInsetPx: top,
    rightInsetPx: p ? rightInsetFor(p, W) : 0,
    bottomInsetPx: p ? bottomInsetFor(p, W, H) : 0,
  };
}

/** The last programmatic flight, re-run (with fresh insets) when the stage is resized. */
let lastFlight: (() => void) | null = null;
const fly = (look: Vector3, dist: number, view: AppState['view'], opts: FramingOptions = {}) => {
  lastFlight = () => director.flyTo(look, dist, { ...opts, ...coverFor(view) });
  lastFlight();
};
/** Frame the whole plant (fitted to the visible region of the current view). A replay on
 *  resize re-reads the plant, so it never frames a box from before a rebuild. */
const flyOverview = () => {
  if (!plant) return;
  const o = plant.anchors.overview;
  director.flyTo(o.look, o.dist, { ...(o.box ? { fit: { box: o.box } } : {}), ...coverFor(store.get().view) });
  lastFlight = flyOverview;
};
// Presenter flights get the measured Lecture insets: caption-safe at desktop widths, or the
// bottom caption band at narrow widths (coverFor decides; the presenter's own flag is replaced).
const flyer: Flyer = {
  flyTo: (look, dist, opts = {}) => {
    const { captionSafe: _ignored, ...rest } = opts;
    fly(look, dist, 'lecture', rest);
  },
};

// Resize (projector fullscreen, zoom, rotation): re-run the last flight unless the user has
// taken the camera since. A rotated/zoomed view is theirs to keep.
disposers.push(
  stage.onResize(() => {
    if (lastFlight && !director.userMoved) lastFlight();
  }),
);

// ---- plant: rebuild on a new valid result or a cutaway change; grey it while invalid ----
const legendEl = document.createElement('div');
legendEl.className = 'pipe-legend';
legendEl.setAttribute('aria-label', 'Pipe colours by service');
app.append(legendEl);
const renderLegend = (entries: LegendEntry[], f: Flow) => {
  const row = (label: string, color: string, round = false) => {
    const el = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.background = color;
    if (round) sw.className = 'dot';
    el.append(sw, label);
    return el;
  };
  const note = document.createElement('span');
  note.className = 'legend-note';
  note.textContent = 'Particle colour = composition (liquid x, vapour y)';
  legendEl.replaceChildren(
    ...entries.map(({ label, color }) => row(label, color)),
    row(`${f.legend.light.name}-rich`, f.legend.light.color, true),
    row(`${f.legend.heavy.name}-rich`, f.legend.heavy.color, true),
    note,
  );
};

/** Flow particles; the previous flow carries reference speeds and phases to the rebuild. */
let flow: Flow | null = null;
let builtFrom: { r: Results; cutaway: boolean } | null = null;
let framed = false;
/** Height of the plant box when the overview was last framed (Explore re-frame check). */
let framedHeight = 0;

/**
 * Explore, after a rebuild to a much taller or shorter column (R near Rmin, say): re-frame
 * the overview when the plant no longer fits, or the camera is now over a third further out
 * than the plant needs. A camera the user has moved is left alone unless the plant changed
 * height by more than half.
 */
function refitOverviewIfNeeded(box: Box3): void {
  const s = store.get();
  if (!plant || s.view !== 'explore') return;
  const height = box.max.y - box.min.y;
  const changed = framedHeight > 0 ? Math.abs(height / framedHeight - 1) : 0;
  if (director.userMoved && changed < 0.5) return;
  const need = director.fitDistance(box, coverFor('explore'));
  const have = director.distance;
  if (need > have * 1.02 || need < have * 0.75) {
    flyOverview();
    framedHeight = height;
  }
}

const syncPlant = () => {
  const s = store.get();
  const r = store.lastOk();
  if (r && (builtFrom?.r !== r || builtFrom.cutaway !== s.cutaway)) {
    const okInputs = store.lastOkInputs() ?? s.inputs; // purities are inputs; the current ones may be invalid
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
    const nextFlow = createFlow(plant, r, flow ?? undefined);
    flow?.dispose();
    flow = nextFlow;
    stage.scene.add(...flow.points);
    renderLegend(plant.legend, flow);
    const box = plant.anchors.overview.box ?? new Box3().setFromObject(plant.group);
    // Tall (100+ tray) columns need more zoom-out room than the default, and a narrow
    // visible region (tablet, bottom sheet) needs more than the 1.1-aspect anchor distance.
    stage.controls.maxDistance = Math.max(90, plant.anchors.overview.dist * 3);
    stage.fitToBounds(box, stage.controls.maxDistance);
    if (!framed) {
      framed = true;
      framedHeight = box.max.y - box.min.y;
      if (s.view === 'explore') flyOverview(); // Lecture: the presenter frames its step below
    } else {
      refitOverviewIfNeeded(box);
    }
  }
  if (!plant) return;
  plant.setGhost(!store.result().ok);
  flow?.setGhost(!store.result().ok);
  plant.highlight(s.selected);
};
syncPlant();
disposers.push(store.subscribe(syncPlant));

// Body class drives label font size (view-explore / view-lecture).
const syncViewClass = () => {
  const { view } = store.get();
  document.body.classList.toggle('view-lecture', view === 'lecture');
  document.body.classList.toggle('view-explore', view === 'explore');
};
syncViewClass();
disposers.push(store.subscribe(syncViewClass));

// ---- Lecture mode: caption + presenter bar, lesson strip, progress ----
const presenter = new Presenter(store, flyer, { root: dock, anchors: () => plant?.anchors ?? null });
disposers.push(mountLessons(dock, store, presenter), trackCardViews(store));
if (store.get().view === 'lecture') presenter.go(store.get().step);

// Leaving Lecture: frame the whole plant beside the Explore panel (Lecture re-applies its step itself).
let lastView = store.get().view;
disposers.push(
  store.subscribe((s) => {
    if (s.view === lastView) return;
    lastView = s.view;
    if (s.view === 'explore' && plant) {
      flyOverview();
      framedHeight = plant.anchors.overview.box ? plant.anchors.overview.box.max.y - plant.anchors.overview.box.min.y : 0;
    }
  }),
);

import.meta.hot?.dispose(() => {
  presenter.dispose();
  for (const off of disposers.splice(0).reverse()) off();
  dock.remove();
  plant?.dispose();
  flow?.dispose();
  disposePlantResources();
  legendEl.remove();
  picker.dispose();
  director.dispose();
  stage.dispose();
});
