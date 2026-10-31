// The deck / roster analysis panel shared by the Classic loadout editor (vsai.ts) and the Tug of War roster picker
// (tug.ts): warnings, role coverage (anti-air, anti-armor, stealth, ...), cost curve and headline numbers.

import { h } from '../app.ts';
import { CAPS, analyzeDeck, type Cap, type DesignInfo } from './deckstats.ts';
import type { Design } from '../../shared/types.ts';

export const CAP_ICON: Record<Cap, string> = {
  aa: '✈', armor: '⛨', swarm: '✸', long: '◎', front: '▣', support: '✚', detect: '◉', stealth: '◌', air: '⇡', fast: '»',
};

/** the capability icons of one design (cards) */
export const capBadges = (i: DesignInfo): HTMLElement => h('span.db-caps', null,
  ...CAPS.filter((c) => i.caps.has(c.id)).map((c) => h('span.db-cap', { class: `cap-${c.id}`, title: c.label }, CAP_ICON[c.id])));

/** Analysis of a deck (match, `slots` = DECK_SIZE) or a tug roster (`slots` = its size): replaces `host`'s children. */
export function renderDeckAnalysis(host: HTMLElement, deck: Design[], o: { slots: number; mode: 'match' | 'tug'; title?: string }): void {
  const r = analyzeDeck(deck, o.mode);
  const maxB = Math.max(1, ...r.buckets.map((b) => b.n));
  const stat = (label: string, value: string, tip = '') => h('div.db-stat', { title: tip || null }, h('span', null, label), h('b', null, value));
  const tug = o.mode === 'tug';
  host.replaceChildren(
    h('div.panel-title', null, o.title ?? 'Deck analysis'),
    h('div.db-warn', null, ...r.warnings.map((w) => h('div.db-w', { class: w.level }, w.text))),
    h('div.db-sec', null, h('h4', null, 'Coverage'),
      h('div.db-capgrid', null, ...CAPS.map((c) => {
        const n = r.capCount[c.id];
        // a missing optional role (aircraft, fast, support, stealth) is not a hole
        return h('div.db-caprow', { class: n || c.id === 'air' || c.id === 'fast' || c.id === 'support' || c.id === 'stealth' ? '' : 'zero', title: c.tip },
          h('span.db-cap', { class: `cap-${c.id}` }, CAP_ICON[c.id]),
          h('span.db-caplbl', null, c.label),
          h('span.db-capbar', null, ...Array.from({ length: o.slots }, (_, k) => h('i', { class: k < n ? 'on' : null }))),
          h('b', null, String(n)));
      }))),
    h('div.db-sec', null, h('h4', null, 'Cost curve'),
      h('div.db-hist', null, ...r.buckets.map((b) => h('div.db-col', { title: `${b.n} design${b.n === 1 ? '' : 's'} costing ${b.label}` },
        h('div.db-bar', null, h('i', { style: { height: `${(b.n / maxB) * 100}%` } })),
        h('b', null, String(b.n)),
        h('span', null, b.label))))),
    h('div.db-sec', null, h('h4', null, 'Numbers'),
      h('div.db-statgrid', null,
        stat('Avg cost', String(Math.round(r.avgCost))),
        stat('Cheapest', String(r.minCost), 'Smallest purchase you can make'),
        stat('Priciest', String(r.maxCost)),
        tug ? stat('Buyable at start', `${r.roundOne}/${r.infos.length}`, 'Designs in the hull tiers you start with (the rest need a tier unlock)')
          : stat('Round-1 buys', `${r.roundOne}/${r.infos.length}`, 'Designs you can afford with round 1 supply'),
        stat('Avg speed', `${Math.round(r.avgSpeed)} m/s`, 'Mobile designs only'),
        stat('Max reach', `${Math.round(r.maxRange)} m`),
        stat('Ground DPS · all blocks', String(Math.round(r.gnd)), 'One block of each design combined (a light design\'s block is its whole squad of 4, 8 or 16)'),
        stat('Air DPS · all blocks', String(Math.round(r.air)), 'One block of each design combined (a light design\'s block is its whole squad of 4, 8 or 16)'),
      )),
  );
}
