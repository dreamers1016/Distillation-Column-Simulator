import './styles/tokens.css';
import './styles/app.css';
import { createStore } from './app/state';
import { mountPanel } from './app/ui/panel';
import { mountToast } from './app/ui/toast';
import { mountTopbar } from './app/ui/topbar';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container missing from index.html');

const store = createStore();
mountTopbar(app, store);
mountPanel(app, store);
mountToast(app, store);
