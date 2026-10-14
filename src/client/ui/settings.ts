// Settings: volumes, default battle speed, garage reset.

import { h, type App, type Screen } from '../app.ts';
import { playMusic, setVolumes, sfx } from '../audio.ts';
import { loadSettings, saveDeckIds, saveDesigns, saveSettings, type Settings } from '../storage.ts';
import { STARTER_DESIGNS } from '../../shared/starters.ts';
import { DECK_SIZE } from '../../shared/match.ts';
import { confirmModal } from './match-ui.ts';
import * as kit from './kit.ts';
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
              label: 'Always show health bars', on: !!s.alwaysHealth,
              title: 'Otherwise bars show briefly after damage; hold Alt in battle',
              onChange: (v) => { s.alwaysHealth = v; saveSettings(s); sfx('click'); draw(); },
            }));
            draw();
            return host;
          })(), h('span.muted', null, 'Otherwise shown briefly after damage; hold Alt in battle')),
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
          h('p.muted', null, 'Fonts: Barlow by Jeremy Tribby (SIL OFL). Effect textures: Zero-K (public domain). Weapon ideas inspired by Zero-K.'),
        ),
      ),
    ),
  );
  return { el };
}
