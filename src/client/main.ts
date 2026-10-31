// Client entry: create the App, register screens, wire global audio unlock + saved volumes.
// Only the menu ships in the entry bundle: every other screen (and three.js) is a lazily loaded chunk, fetched
// in the background once the menu is up, so the first load is small and the menu's buttons respond right away.

import { App } from './app.ts';
import { setVolumes, unlockAudio } from './audio.ts';
import { loadSettings } from './storage.ts';
import { setSyncProblemHandler, startGarageSync } from './sync.ts';
import { currentSession, refreshSession } from './net.ts';
import { classicScreen, menuScreen } from './ui/menu.ts';

const root = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));
const app = new App(root);

// garage sync problems the player must know about (over the account's design cap, an upload the server refused)
setSyncProblemHandler((msg) => { if (msg) app.toast(msg, 'error'); });

// pull the server copy of the garage before a screen that reads it opens (bounded: offline play must not wait).
// The menu doesn't read the garage, so it shows at once.
const synced = Promise.race([startGarageSync(), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
/** screens with a battlefield wait for the 3D renderer when it's selected, so they don't fall back to 2D */
const with3d = () => (loadSettings().renderer === '3d' ? import('./render/viewfactory.ts').then((m) => m.preload3d()) : undefined);

app.register('menu', menuScreen);
app.register('classic', classicScreen);
app.registerLazy('vsai', async () => { await synced; return (await import('./ui/vsai.ts')).vsaiScreen; });
app.registerLazy('match', async () => { await Promise.all([synced, with3d()]); return (await import('./ui/match.ts')).matchScreen; });
app.registerLazy('settings', async () => (await import('./ui/settings.ts')).settingsScreen);
app.registerLazy('garage', async () => { await synced; return (await import('./ui/garage.ts')).garageScreen; });
app.registerLazy('lobby', async () => { await synced; return (await import('./ui/lobby.ts')).lobbyScreen; });
app.registerLazy('playground', async () => { await Promise.all([synced, with3d()]); return (await import('./ui/playground.ts')).playgroundScreen; });
app.registerLazy('tug', async () => { await synced; return (await import('./ui/tug.ts')).tugSetupScreen; });
app.registerLazy('tugmatch', async () => { await Promise.all([synced, with3d()]); return (await import('./ui/tug.ts')).tugMatchScreen; });

const s = loadSettings();
setVolumes({ master: s.master, music: s.music, sfx: s.sfx });

const unlock = () => {
  unlockAudio();
  window.removeEventListener('pointerdown', unlock, true);
  window.removeEventListener('keydown', unlock, true);
};
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);

app.go({ name: 'menu' });
// once the menu has painted and the browser is idle, fetch the other screens so the first click doesn't wait
const whenIdle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 500));
whenIdle(() => app.prefetch());
// a session stored by an older build doesn't know whether it has a password yet (the menu re-renders on change)
if (currentSession() && !currentSession()!.auto && !currentSession()!.registered) void refreshSession().catch(() => {});

// handy for debugging in the console
(window as unknown as { app: App }).app = app;
