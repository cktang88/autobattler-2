// Settings: volumes, default battle speed, garage reset.

import { h, type App, type Screen } from '../app.ts';
import { playMusic, setVolumes, sfx } from '../audio.ts';
import { loadSettings, saveDeckIds, saveDesigns, saveSettings, type Settings } from '../storage.ts';
import { STARTER_DESIGNS } from '../../shared/starters.ts';
import { DECK_SIZE } from '../../shared/match.ts';
import { confirmModal } from './match-ui.ts';
import * as kit from './kit.ts';
import { preload3d, webglAvailable } from '../render/viewfactory.ts';
import { BATTLE_SPEEDS, speedLabel } from '../storage.ts';

export function settingsScreen(app: App): Screen {
  playMusic('menu');
  const s: Settings = loadSettings();
  const apply = () => {
    setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    saveSettings(s);
  };

  const slider = (key: 'master' | 'music' | 'sfx' | 'shake' | 'flashes', label: string) =>
    h('div.setting', null, h('label', null, label), kit.slider({
      value: Math.round(s[key] * 100), min: 0, max: 100, label,
      onInput: (v) => { s[key] = v / 100; apply(); },
      onCommit: () => sfx('click'),
    }));

  const speeds = BATTLE_SPEEDS;
  const speedHost = h('div');
  const renderSpeed = () => speedHost.replaceChildren(kit.segmented({
    value: s.battleSpeed, label: 'Default battle speed', options: speeds.map((v) => ({ value: v, label: speedLabel(v) })),
    onChange: (v) => { sfx('click'); s.battleSpeed = v; saveSettings(s); renderSpeed(); },
  }));
  renderSpeed();

  const rendererHost = h('div');
  const renderRenderer = () => rendererHost.replaceChildren(kit.segmented({
    value: s.renderer, label: 'Battlefield art', options: [{ value: '2d' as const, label: '2D' }, { value: '3d' as const, label: '3D' }],
    onChange: (v) => { sfx('click'); s.renderer = v; s.rendererChosen = true; saveSettings(s); if (v === '3d') void preload3d(); renderRenderer(); },
  }));
  renderRenderer();

  const reset = async () => {
    sfx('click');
    const ok = await confirmModal('Reset garage?', 'This deletes ALL your custom designs and restores the starter designs and deck. This cannot be undone.', 'Reset', true);
    if (!ok) return;
    saveDesigns(STARTER_DESIGNS.map((d) => structuredClone(d)));
    saveDeckIds(STARTER_DESIGNS.slice(0, DECK_SIZE).map((d) => d.id));
    app.toast('Garage reset to starter designs.', 'good');
  };

  const el = h('div.screen', null,
    h('div.topbar', null,
      h('button.icon', { onclick: () => { sfx('click'); app.go({ name: 'menu' }); }, title: 'Back' }, '‹ Back'),
      h('h2', null, 'Settings'),
    ),
    h('div.screen-scroll.grow', null,
      h('div.page', { style: { maxWidth: '620px' } },
        h('div.panel', null,
          h('div.panel-title', null, 'Audio'),
          slider('master', 'Master'),
          slider('music', 'Music'),
          slider('sfx', 'Effects'),
        ),
        h('div.panel', null,
          h('div.panel-title', null, 'Visual comfort'),
          slider('shake', 'Screen shake'),
          slider('flashes', 'Screen flashes'),
          h('div.setting.check', null, (() => {
            const host = h('span');
            const draw = () => host.replaceChildren(kit.toggle({
              label: 'Tilted battlefield camera', on: s.tilt !== false,
              title: 'A slight 3D tilt of the field; off = straight top-down view',
              onChange: (v) => { s.tilt = v; saveSettings(s); sfx('click'); draw(); },
            }));
            draw();
            return host;
          })(), h('span.muted', null, 'A slight 3D tilt of the battlefield; turn off for a flat top-down view')),
          h('div.setting.check', null, (() => {
            const host = h('span');
            const draw = () => host.replaceChildren(kit.toggle({
              label: 'Auto battle camera', on: s.autoCam !== false,
              title: 'The camera follows the fight and zooms in as it thins out; moving the camera yourself turns it off until the next battle',
              onChange: (v) => { s.autoCam = v; saveSettings(s); sfx('click'); draw(); },
            }));
            draw();
            return host;
          })(), h('span.muted', null, 'Follows the fight and zooms in as it thins out; moving the camera yourself takes over until the next battle')),
          h('div.setting.check', null, (() => {
            const host = h('span');
            const draw = () => host.replaceChildren(kit.toggle({
              label: 'Always show health bars', on: !!s.alwaysHealth,
              title: 'Otherwise bars show briefly after damage; hold Alt in battle',
              onChange: (v) => { s.alwaysHealth = v; saveSettings(s); sfx('click'); draw(); },
            }));
            draw();
            return host;
          })(), h('span.muted', null, 'Otherwise shown briefly after damage; hold Alt in battle')),
        ),
        h('div.panel', null,
          h('div.panel-title', null, 'Graphics'),
          h('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
            h('span', null, 'Battlefield art'),
            rendererHost,
          ),
          h('p.muted', null, webglAvailable() ? '2D is the classic hand-drawn look; 3D renders the units as 3D models (experimental). Applies to the next match or menu visit.' : '3D needs WebGL, which is unavailable here.'),
          h('div.setting.check', null, (() => {
            const host = h('span');
            const draw = () => host.replaceChildren(kit.toggle({
              label: 'Detailed unit textures (3D)', on: s.unitTextures !== false,
              title: 'Plate seams, rivets, chipped paint and grime on 3D units; turn off for plain paint on slow GPUs',
              onChange: (v) => { s.unitTextures = v; saveSettings(s); sfx('click'); draw(); },
            }));
            draw();
            return host;
          })(), h('span.muted', null, 'Plate seams, rivets, chipped paint and grime on 3D units; off = plain paint (faster)')),
          h('div.setting.check', null, (() => {
            const host = h('span');
            const draw = () => host.replaceChildren(kit.toggle({
              label: 'Sun shadows (3D)', on: s.shadows !== false,
              title: 'Real shadows cast by the bigger units, aircraft, wrecks and rocks; off = soft blobs under units (faster on weak GPUs)',
              onChange: (v) => { s.shadows = v; saveSettings(s); sfx('click'); draw(); },
            }));
            draw();
            return host;
          })(), h('span.muted', null, 'Shadows cast by the bigger units, aircraft and wrecks; off = soft blobs only (faster). Slow devices drop them automatically')),
        ),
        h('div.panel', null,
          h('div.panel-title', null, 'Gameplay'),
          h('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
            h('span', null, 'Default battle speed'),
            speedHost,
          ),
        ),
        h('div.panel', null,
          h('div.panel-title', null, 'Data'),
          h('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
            h('span', null, 'Restore the starter designs and deck'),
            h('button.danger', { onclick: reset }, 'Reset garage'),
          ),
        ),
        h('div.panel.credits', null,
          h('div.panel-title', null, 'Credits'),
          h('p.muted', null, 'Music (CC0, OpenGameArt): vitalezzz \u2014 Inevitable, Claimed by the Void, Brute Force, Hunter-class Lifeform; yd \u2014 Factory ambiance; Ruskerdax \u2014 Menacing Otherworld; Cethiel \u2014 Laments of the War; SRG774 \u2014 Dark Sci-Fi Audio Pack.'),
          h('p.muted', null, 'Fonts: Barlow by Jeremy Tribby (SIL OFL). Effect textures: Zero-K (public domain). Unit surface textures: ambientCG (CC0). Weapon ideas inspired by Zero-K.'),
        ),
      ),
    ),
  );
  return { el };
}
