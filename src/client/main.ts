// Client entry: create the App, register screens, wire global audio unlock + saved volumes.

import { App } from './app.ts';
import { setVolumes, unlockAudio } from './audio.ts';
import { preload3d } from './render/viewfactory.ts';
import { loadSettings } from './storage.ts';
import { menuScreen } from './ui/menu.ts';
import { vsaiScreen } from './ui/vsai.ts';
import { matchScreen } from './ui/match.ts';
import { settingsScreen } from './ui/settings.ts';
import { garageScreen } from './ui/garage.ts';
import { lobbyScreen } from './ui/lobby.ts';

const root = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));
const app = new App(root);

app.register('menu', menuScreen);
app.register('vsai', vsaiScreen);
app.register('match', matchScreen);
app.register('settings', settingsScreen);
app.register('garage', garageScreen);
app.register('lobby', lobbyScreen);

const s = loadSettings();
setVolumes({ master: s.master, music: s.music, sfx: s.sfx });

const unlock = () => {
  unlockAudio();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

if (s.renderer === '3d') await preload3d().catch(() => {});
app.go({ name: 'menu' });

// handy for debugging in the console
(window as unknown as { app: App }).app = app;
