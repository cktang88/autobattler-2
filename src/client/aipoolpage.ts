// Hidden page (/aipool, not linked from the menu): the server's global AI design pool, read-only. Lists the tested
// and candidate tiers and the designs that left, with origin, creator, dates, games, good / bad verdicts and score;
// filters by tier and role, sorts by score or date; a click opens the loadout and stats; the event log is below.
// Data: GET /api/aipool/log (server/aipool.ts poolLog: no reporter data).

import { drawUnitPreview } from './render/field.ts';
import { MODULE_BY_ID, CHASSIS_BY_ID, MOBILITY } from '../shared/parts.ts';
import { computeStats } from '../shared/stats.ts';
import type { Design } from '../shared/types.ts';

interface Row {
  key: string; name: string; chassis: string; mobility: string; mounts: (string | null)[]; role: string; tags: string[];
  tier: 'tested' | 'candidate' | 'gone'; origin: 'curated' | 'adopted' | 'mutant'; creator?: string; parent?: string;
  addedAt?: number; promotedAt?: number; games: number; good: number; bad: number; score: number; leftAt?: number; leftWhy?: string;
}
interface Ev { t: number; kind: string; key: string; name: string; tier: string; detail?: string }
interface Log { tested: Row[]; candidates: Row[]; gone: Row[]; events: Ev[]; reports: number; rejected: number; matches: number }

const root = document.getElementById('app')!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
const date = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' }) : '—');
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const modName = (id: string | null) => (id ? MODULE_BY_ID.get(id)?.name ?? id : '');
const mobName = (id: string) => MOBILITY.find((m) => m.id === id)?.name ?? id;
const design = (r: Row): Design => ({ id: r.key, name: r.name, chassis: r.chassis, mobility: r.mobility, mounts: r.mounts });
const origin = (r: Row) => (r.origin === 'adopted' ? `adopted · ${r.creator ?? 'unknown'}` : r.origin === 'mutant' ? `mutant of ${r.parent ?? '?'}` : 'curated');

function preview(r: Row, px: number): HTMLCanvasElement {
  const c = el('canvas');
  requestAnimationFrame(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = px * dpr; c.height = px * dpr;
    try { drawUnitPreview(c, design(r), { side: 0, angle: -Math.PI / 2, still: true }); } catch { /* no preview */ }
  });
  return c;
}

function detail(r: Row, events: Ev[]): HTMLElement {
  const d = el('div', 'detail');
  d.addEventListener('click', (e) => e.stopPropagation());
  d.append(preview(r, 160));
  const t = el('table');
  const add = (k: string, v: string) => t.append(el('tr', '', el('td', 'dim', k), el('td', '', v)));
  add('Hull', CHASSIS_BY_ID.get(r.chassis)?.name ?? r.chassis);
  add('Drive', mobName(r.mobility));
  r.mounts.forEach((m, i) => add(`Mount ${i + 1}`, modName(m) || '(empty)'));
  try {
    const s = computeStats(design(r));
    add('Block', `${s.cost} supply · ${s.squad} unit${s.squad > 1 ? 's' : ''}`);
    add('HP / armour', `${Math.round(s.hp)} / ${s.armor}${s.shield ? ` · shield ${Math.round(s.shield)}` : ''}`);
    add('Speed / range', `${s.speed.toFixed(1)} / ${(s.range * 5).toFixed(0)} m`);
    add('DPS', `${Math.round(s.dps)}`);
  } catch { add('Stats', 'not valid under the current rules'); }
  d.append(t);
  const log = el('div', '', el('div', 'dim', 'History'));
  for (const e of events.filter((x) => x.key === r.key)) log.append(el('div', '', `${when(e.t)} · ${e.kind}${e.detail ? ` (${e.detail})` : ''}`));
  if (r.leftWhy) log.append(el('div', 'bad', `Left ${date(r.leftAt)}: ${r.leftWhy}`));
  d.append(log);
  return d;
}

function render(log: Log): void {
  let tier = 'all', role = 'all', sort = 'score';
  const all = [...log.tested, ...log.candidates, ...log.gone];
  const roles = [...new Set(all.map((r) => r.role))].sort();
  root.replaceChildren();
  root.append(el('h1', '', 'AI Design Pool'));
  root.append(el('div', 'sum', `${log.tested.length} tested · ${log.candidates.length} on trial · ${log.gone.length} gone · ${log.reports} matches learned from${log.rejected ? ` · ${log.rejected} reports rejected` : ''}`));
  const sel = (label: string, opts: [string, string][], on: (v: string) => void) => {
    const s = el('select');
    s.setAttribute('aria-label', label);
    for (const [v, t] of opts) { const o = el('option', '', t); o.value = v; s.append(o); }
    s.addEventListener('change', () => { on(s.value); draw(); });
    return s;
  };
  root.append(el('div', 'bar',
    sel('Tier', [['all', 'All tiers'], ['tested', 'Tested'], ['candidate', 'Candidates'], ['gone', 'Gone']], (v) => (tier = v)),
    sel('Role', [['all', 'All roles'], ...roles.map((r) => [r, r] as [string, string])], (v) => (role = v)),
    sel('Sort', [['score', 'Score'], ['joined', 'Newest'], ['games', 'Games']], (v) => (sort = v)),
  ));
  const list = el('div', 'list');
  root.append(list);
  root.append(el('h2', '', 'Recent events'));
  const evs = el('div');
  for (const e of log.events.slice(0, 150)) evs.append(el('div', 'ev', el('span', 'dim', when(e.t)), el('span', e.kind === 'kicked' || e.kind === 'pruned' ? 'bad' : e.kind === 'promoted' ? 'good' : '', e.kind), el('span', '', `${e.name} (${e.tier})${e.detail ? ` — ${e.detail}` : ''}`)));
  if (!log.events.length) evs.append(el('div', 'dim', 'Nothing yet.'));
  root.append(evs);

  function draw(): void {
    list.replaceChildren(el('div', 'row head', el('span'), el('span', '', 'Design'), el('span', '', 'Loadout'), el('span', '', 'Tier'), el('span', '', 'Origin'), el('span', '', 'Joined / promoted'), el('span', '', 'Games · W/L · score')));
    const rows = all
      .filter((r) => (tier === 'all' || r.tier === tier) && (role === 'all' || r.role === role))
      .sort((a, b) => (sort === 'score' ? b.score - a.score : sort === 'games' ? b.games - a.games : (b.addedAt ?? 0) - (a.addedAt ?? 0)));
    for (const r of rows) {
      const line = el('div', 'row',
        preview(r, 48),
        el('div', '', el('div', 'nm', r.name), el('div', 'dim', `${r.role} · ${r.tags.join(', ')}`)),
        el('div', 'dim', `${CHASSIS_BY_ID.get(r.chassis)?.name ?? r.chassis} / ${mobName(r.mobility)} — ${r.mounts.filter(Boolean).map(modName).join(', ')}`),
        el('div', '', el('span', `tier ${r.tier}`, r.tier)),
        el('div', 'dim', origin(r)),
        el('div', 'dim', `${date(r.addedAt)} / ${date(r.promotedAt)}`),
        el('div', 'num', `${r.games} · `, el('span', 'good', String(r.good)), '/', el('span', 'bad', String(r.bad)), ` · ${r.score.toFixed(2)}`),
      );
      let open: HTMLElement | null = null;
      line.addEventListener('click', () => { if (open) { open.remove(); open = null; } else { open = detail(r, log.events); line.append(open); } });
      list.append(line);
    }
    if (!rows.length) list.append(el('div', 'dim', 'No designs match.'));
  }
  draw();
}

async function main(): Promise<void> {
  root.textContent = 'Loading…';
  try {
    const res = await fetch('/api/aipool/log');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json() as Log);
  } catch (e) {
    root.textContent = `Could not load the AI pool (${(e as Error).message}).`;
  }
}
void main();
