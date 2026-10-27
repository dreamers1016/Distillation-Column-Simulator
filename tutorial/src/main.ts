import './styles/tokens.css';
import './styles/app.css';
import { createStore } from './app/state';
import { mountPanel } from './app/ui/panel';
import { mountToast } from './app/ui/toast';
import { mountTopbar } from './app/ui/topbar';
import { CameraDirector } from './scene/camera';
import { Picker } from './scene/picking';
import { createScene } from './scene/scene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container missing from index.html');

const store = createStore();
mountTopbar(app, store);
mountPanel(app, store);
mountToast(app, store);

// 3D stage behind the UI. The plant arrives in a later task; for now it is floor + grid only.
const stageEl = document.querySelector<HTMLDivElement>('#stage');
if (!stageEl) throw new Error('#stage container missing from index.html');

const stage = createScene(stageEl);
const director = new CameraDirector(stage.camera, stage.controls, () => ({
  width: stageEl.clientWidth || window.innerWidth,
  height: stageEl.clientHeight || window.innerHeight,
}));
stage.onFrame((dt) => director.update(dt));

const picker = new Picker(stage.camera, stage.renderer.domElement);
picker.onPick((selected) => store.set({ selected }));

// Body class drives label font size (view-explore 11 px / view-lecture 14 px).
const syncViewClass = () => {
  const { view } = store.get();
  document.body.classList.toggle('view-lecture', view === 'lecture');
  document.body.classList.toggle('view-explore', view === 'explore');
};
syncViewClass();
store.subscribe(syncViewClass);

import.meta.hot?.dispose(() => {
  picker.dispose();
  director.dispose();
  stage.dispose();
});
