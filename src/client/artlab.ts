// Art lab (dev page): every chassis x mobility pairing, every module turret, every part icon, a tiny-scale
// readability row, a deploy-board view and a demo battle on a FieldView.
// URL params: ?enemy=1 (red team), ?battle=1 (auto-start battle), ?speed=N, ?only=grid|modules|icons|small|field,
// ?chassis=id,id (grid rows filter), ?big=1, ?zoom=N (grid cell scale), ?empty=1 (no turrets),
// ?only=small&n=40&cell=48&rseed=N (sheet of random valid designs, labelled)

import { unlockAudio, playMusic } from './audio.ts';
import { drawPartIcon, drawUnitPreview, FieldView, type BoardUnit } from './render/field.ts';
import { MAPS, MAP_BY_ID } from './render/ground.ts';
import { hullPath, silhouette, unitSprites } from './render/unitart.ts';
import { aiDeck } from '../shared/ai.ts';
import { DEPLOY_D, DEPLOY_W, blockDims, blockInZone, blocksOverlap, hasSpacing, placementUnitCenters } from '../shared/grid.ts';
import { CHASSIS, MOBILITY, MODULES, fitsMount, pairingError } from '../shared/parts.ts';
import { Battle } from '../shared/sim/battle.ts';
import { TICK_RATE } from '../shared/sim/types.ts';
import { computeStats, isValidDesign } from '../shared/stats.ts';
import type { Design, ModuleDef, Placement, Side } from '../shared/types.ts';
import type { BattleInput } from '../shared/sim/types.ts';

const params = new URLSearchParams(location.search);
const side: Side = params.get('enemy') === '1' ? 1 : 0;
const only = params.get('only');
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

let rngState = 12345;
const rnd = () => ((rngState = (rngState * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];

const WEAPONS = MODULES.filter((m) => m.kind === 'weapon');

function fillMounts(chassisId: string, prefer: number): (string | null)[] {
  const c = CHASSIS.find((x) => x.id === chassisId)!;
  return c.mounts.map((slot, i) => {
    const fit = WEAPONS.filter((m) => m.mount === slot);
    const any = fit.length ? fit : WEAPONS.filter((m) => fitsMount(slot, m.mount));
    return any[(prefer * 7 + i * 13) % any.length].id;
  });
}

/** previews to animate */
const animated: { c: HTMLCanvasElement; d: Design }[] = [];

function preview(d: Design, size: number, label?: string, sub?: string): HTMLElement {
  const box = el('div', 'cell');
  const c = el('canvas');
  c.style.width = c.style.height = size + 'px';
  box.append(c);
  if (label) box.append(el('div', 'lab', label));
  if (sub) box.append(el('div', 'sub', sub));
  animated.push({ c, d });
  return box;
}

function gridSection(): void {
  const host = $('#grid');
  const table = el('table');
  const head = el('tr');
  head.append(el('th', '', ''));
  for (const m of MOBILITY) head.append(el('th', '', m.name));
  table.append(head);
  const chF = params.get('chassis')?.split(',');
  CHASSIS.forEach((c, ci) => {
    if (chF && !chF.includes(c.id)) return;
    const tr = el('tr');
    tr.append(el('th', 'rowh', `${c.name} (${c.size})`));
    MOBILITY.forEach((m, mi) => {
      const td = el('td');
      if (!pairingError(c.id, m.id)) {
        const d: Design = { id: `g${ci}_${mi}`, name: 'x', chassis: c.id, mobility: m.id, mounts: params.get('empty') ? c.mounts.map(() => null) : fillMounts(c.id, ci + mi) };
        const zoom = Number(params.get('zoom') ?? '1') || 1;
        td.append(preview(d, (c.size >= 4 ? (params.get('big') ? 420 : 190) : params.get('big') ? 150 : 96) * zoom));
      } else td.className = 'na';
      tr.append(td);
    });
    table.append(tr);
  });
  host.append(table);
}

function refChassis(m: ModuleDef): { chassis: string; mobility: string; slot: number } {
  if (m.mount === 'T') return { chassis: 'titan', mobility: 'titanlegs', slot: 0 };
  if (m.mount === 'G') return { chassis: 'leviathan', mobility: 'megatracks', slot: 0 };
  if (m.mount === 'L') return { chassis: 'scout', mobility: 'wheels', slot: 0 };
  if (m.mount === 'M') return { chassis: 'warden', mobility: 'halftrack', slot: 0 };
  return { chassis: 'longarm', mobility: 'treads', slot: 0 };
}

function modulesSection(): void {
  const host = $('#modules');
  for (const m of MODULES) {
    const r = refChassis(m);
    const c = CHASSIS.find((x) => x.id === r.chassis)!;
    const mounts: (string | null)[] = c.mounts.map(() => null);
    mounts[r.slot] = m.id;
    const d: Design = { id: 'm_' + m.id, name: m.name, chassis: r.chassis, mobility: r.mobility, mounts };
    host.append(preview(d, m.mount === 'G' || m.mount === 'T' ? 230 : 110, m.name, `${m.id} · ${m.mount} · ${m.visual}`));
  }
}

function iconsSection(): void {
  const host = $('#icons');
  const add = (kind: 'chassis' | 'mobility' | 'module', id: string, name: string) => {
    const box = el('div', 'icon');
    const c = el('canvas');
    c.style.width = c.style.height = '72px';
    box.append(c, el('div', 'lab', name), el('div', 'sub', id));
    host.append(box);
    requestAnimationFrame(() => drawPartIcon(c, kind, id, { backdrop: true, team: side === 1 ? 1 : undefined }));
  };
  for (const c of CHASSIS) add('chassis', c.id, c.name);
  for (const m of MOBILITY) add('mobility', m.id, m.name);
  for (const m of MODULES) add('module', m.id, m.name);
}

function smallSection(): void {
  const host = $('#small');
  // ?n=40&cell=48&rseed=5: a bigger sheet of random valid designs (every one should look like an intentional unit)
  const n = Number(params.get('n') ?? '24') || 24;
  const cell = Number(params.get('cell') ?? '20') || 20;
  const vc = params.get('variants');
  const designs = vc ? variantDesigns(vc) : randomDesigns(n, Number(params.get('rseed') ?? '99') || 99);
  for (const d of designs) {
    const size = computeStats(d).size;
    host.append(preview(d, cell * size + 8, params.get('cell') ? `${d.chassis}${vc ? ' · ' + d.name : ''}` : undefined, params.get('cell') ? `${d.mobility} · ${d.mounts.filter(Boolean).join(',')}` : undefined));
  }
}

/** Same chassis with different whole-body builds: bare, max armour, shield, stealth, coatings, systems. */
function variantDesigns(spec: string): Design[] {
  const out: Design[] = [];
  for (const cm of spec.split(';')) {
    const [cid, mid] = cm.split(':');
    const c = CHASSIS.find((x) => x.id === cid);
    if (!c) continue;
    const mob = mid ?? MOBILITY.find((m) => !pairingError(c.id, m.id))!.id;
    const weapons = fillMounts(c.id, 3);
    const fill = (extra: string[]) => {
      // first slot keeps its weapon, the rest take the extras that fit (or stay armed)
      const used = new Set<number>();
      return c.mounts.map((slot, i) => {
        if (i === 0) return weapons[0];
        const k = extra.findIndex((id, j) => !used.has(j) && fitsMount(slot, MODULES.find((m) => m.id === id)!.mount));
        if (k >= 0) { used.add(k); return extra[k]; }
        return weapons[i];
      });
    };
    const plates = c.mounts.map((slot, i) => (i === 0 ? weapons[0] : MODULES.find((m) => m.kind === 'armor' && m.mount === slot)?.id ?? weapons[i]));
    const v: [string, (string | null)[]][] = [
      ['bare', c.mounts.map(() => null)], ['armed', weapons], ['max armour', plates],
      ['shield', fill(['shieldH', 'shield', 'shieldL', 'bulwarkshield'])], ['stealth', fill(['phantom', 'stealth'])],
      ['mirror+hardened', fill(['mirror', 'hardened', 'reactive'])], ['turbo+gyro+sensor', fill(['turbo', 'gyro', 'sensor', 'targeting'])],
      ['nanite+overclock+selfdestruct', fill(['nanite', 'overclock', 'selfdestruct'])],
    ];
    for (const [name, mounts] of v) out.push({ id: `v_${cid}_${name}`, name, chassis: c.id, mobility: mob, mounts });
  }
  return out;
}

function randomDesigns(n: number, seed: number): Design[] {
  rngState = seed;
  const out: Design[] = [];
  let guard = 0;
  while (out.length < n && guard++ < 5000) {
    const c = pick(CHASSIS), m = pick(MOBILITY);
    if (pairingError(c.id, m.id)) continue;
    const mounts = c.mounts.map((slot) => {
      const fit = MODULES.filter((x) => fitsMount(slot, x.mount) && (x.kind !== 'armor' || rnd() < 0.3));
      return pick(fit).id;
    });
    const d: Design = { id: `r${out.length}_${seed}`, name: 'Rnd', chassis: c.id, mobility: m.id, mounts };
    if (isValidDesign(d)) out.push(d);
  }
  return out;
}

function giantDeck(): Design[] {
  const mk = (id: string, chassis: string, mobility: string, mounts: string[]): Design => ({ id, name: id, chassis, mobility, mounts });
  return [
    mk('t1', 'titan', 'titanlegs', ['massdriver', 'siegeplasma', 'twin120', 'gauss', 'quad20']),
    mk('c1', 'citadel', 'megatracks', ['doomsday', 'tactnuke', 'siege240', 'twin30', 'quad20', 'mg']),
    mk('l1', 'leviathan', 'megatracks', ['siege240', 'inferno', 'cannon75', 'twin30']),
    mk('k1', 'carrier', 'gravlift', ['skyfortress', 'heavyflak', 'quad20', 'quad20']),
    mk('g1', 'goliath', 'titanlegs', ['stormtower', 'cannon', 'cannon', 'twin30']),
    mk('t2', 'titan', 'megatracks', ['stormcore', 'avenger', 'howitzer', 'cruise', 'autocannon']),
  ];
}

function makeDeck(seed: number): Design[] {
  if (params.get('giants')) return giantDeck();
  try {
    const d = aiDeck(seed, 'hard');
    if (d.length >= 4) return d;
  } catch { /* fall back */ }
  return randomDesigns(8, seed);
}

function placeUnits(deck: Design[], seed: number, count: number): Placement[] {
  rngState = seed;
  const out: Placement[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 2000) {
    const d = pick(deck);
    const unit = computeStats(d).size;
    const spacing = hasSpacing(unit) ? Math.floor(rnd() * 4) : 0;
    const { w, h } = blockDims(unit, spacing);
    const x = Math.floor(rnd() * (DEPLOY_W - w + 1)), y = Math.floor(rnd() * (DEPLOY_D - h + 1));
    if (!blockInZone(x, y, unit, spacing)) continue;
    if (out.some((p) => blocksOverlap(p, computeStats(deck.find((q) => q.id === p.designId)!).size, { x, y, spacing }, unit))) continue;
    out.push({ uid: out.length + 1, designId: d.id, x, y, level: 1 + Math.floor(rnd() * 3), round: 1, ...(spacing ? { spacing } : {}) });
  }
  return out;
}

function fieldSection(): void {
  const canvas = $('#field') as HTMLCanvasElement;
  const view = new FieldView(canvas, side);
  const mp = params.get('map');
  if (mp) view.setMap(MAP_BY_ID.get(mp as 'basin') ?? MAPS[0]);
  let battle: Battle | null = null;
  let board: BoardUnit[] = [];
  let acc = 0;
  let speed = Number(params.get('speed') ?? '1') || 1;
  let seed = Number(params.get('seed') ?? '7') || 7;
  const status = $('#status');

  const setup = () => {
    const decks: [Design[], Design[]] = [makeDeck(seed), makeDeck(seed + 1000)];
    const count = Number(params.get('n') ?? '14') || 14;
    const units: [Placement[], Placement[]] = [placeUnits(decks[0], seed, count), placeUnits(decks[1], seed + 5, count)];
    board = [];
    for (const s of [0, 1] as Side[]) {
      for (const p of units[s]) {
        const d = decks[s].find((q) => q.id === p.designId)!;
        for (const c of placementUnitCenters(s, p, computeStats(d).size)) board.push({ side: s, design: d, x: c.x, y: c.y, level: p.level });
      }
    }
    const input: BattleInput = { seed, sides: [{ designs: decks[0], units: units[0] }, { designs: decks[1], units: units[1] }] };
    return input;
  };
  let input = setup();
  ($('#demo') as HTMLButtonElement).onclick = () => {
    unlockAudio();
    playMusic('battle');
    seed++;
    input = setup();
    battle = new Battle(input);
    acc = 0;
  };
  ($('#reset') as HTMLButtonElement).onclick = () => { battle = null; seed++; input = setup(); playMusic('deploy'); unlockAudio(); };
  ($('#speed') as HTMLSelectElement).onchange = (e) => { speed = Number((e.target as HTMLSelectElement).value); };
  if (params.get('battle') === '1') battle = new Battle(input);
  const manual = !!params.get('manual');
  if (manual) {
    // scripted capture hook (Playwright): start a custom battle, step ticks, draw frames deterministically
    (window as unknown as Record<string, unknown>).__lab = {
      view,
      start(decks: [Design[], Design[]], units: [Placement[], Placement[]], s = 7) {
        battle = new Battle({ seed: s, sides: [{ designs: decks[0], units: units[0] }, { designs: decks[1], units: units[1] }] });
        view.fit(true);
      },
      step(n = 1, dt = 1 / TICK_RATE) {
        for (let i = 0; i < n && battle && !battle.done; i++) { battle.step(); view.pushEvents(battle.events); view.drawBattle(battle, dt); }
      },
      draw(dt = 1 / 60) { if (battle) view.drawBattle(battle, dt); },
      get battle() { return battle; },
    };
  }

  let hover: { col: number; row: number; size: number; valid: boolean } | null = null;
  canvas.addEventListener('mousemove', (e) => {
    const w = view.screenToWorld(e.offsetX, e.offsetY);
    hover = { col: Math.floor(w.x), row: Math.floor(w.y), size: 2, valid: side === 0 ? w.y > 23 : w.y < 9 };
  });
  canvas.addEventListener('mouseleave', () => { hover = null; });
  new ResizeObserver(() => view.resize()).observe(canvas);

  let last = performance.now();
  let fps = 60, drawMs = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    fps = fps * 0.95 + (1 / Math.max(0.001, (now - last) / 1000)) * 0.05;
    last = now;
    const t0 = performance.now();
    if (manual) { /* driven by __lab */ } else if (battle) {
      acc += dt * TICK_RATE * speed;
      let n = 0;
      while (acc >= 1 && !battle.done && n++ < 40) {
        battle.step();
        view.pushEvents(battle.events);
        acc -= 1;
      }
      view.drawBattle(battle, dt);
      drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1;
      const alive = [0, 1].map((s) => battle!.units.filter((u) => u.alive && u.side === s).length);
      status.textContent = `tick ${battle.tick} · blue ${alive[side]} vs red ${alive[1 - side]} · fx ${view.fx.parts.length} · ${fps.toFixed(0)} fps · frame ${drawMs.toFixed(1)}ms${battle.done ? ' · done' : ''}`;
    } else {
      view.drawBoard(board, { showZone: true, hover }, now / 1000);
      status.textContent = 'deploy board (hover to see footprint)';
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** ?only=sil: every chassis as a solid black silhouette on white (hull outline, then hull + running gear), so each
 *  frame's shape can be judged on its own. */
function silSection(): void {
  const sec = el('section');
  sec.append(el('h2', '', 'Chassis silhouettes'));
  const host = el('div');
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;background:#fff;padding:10px;color:#222';
  sec.append(host);
  document.body.append(sec);
  for (const c of CHASSIS) {
    for (const full of [false, true]) {
      const box = el('div');
      box.style.cssText = 'display:flex;flex-direction:column;align-items:center;font:11px sans-serif;width:118px';
      const cv = el('canvas');
      const W = 112;
      cv.width = cv.height = W;
      box.append(cv, el('div', '', c.id + (full ? ' +gear' : ` ${c.footprint ? c.footprint.join('x') : c.size + 'x' + c.size}`)));
      host.append(box);
      const g = cv.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, W);
      const fw = c.footprint?.[0] ?? c.size, fh = c.footprint?.[1] ?? c.size;
      const ext = Math.max(fw, fh) * (full ? 1.5 : 1.12);
      const px = W / ext;
      // footprint box (w across x h along the facing; facing = up)
      g.setTransform(px, 0, 0, px, W / 2, W / 2);
      g.strokeStyle = '#c33'; g.lineWidth = 1 / px; g.setLineDash([3 / px, 3 / px]);
      g.strokeRect(-fw / 2, -fh / 2, fw, fh);
      g.setLineDash([]);
      if (!full) {
        g.rotate(-Math.PI / 2);
        g.fillStyle = '#000'; g.fill(hullPath(c.shape, c.size, fh, fw));
      } else {
        const mob = params.get('mob') && !pairingError(c.id, params.get('mob')!) ? params.get('mob')! : MOBILITY.find((m) => !pairingError(c.id, m.id) && m.id !== 'anchor')?.id ?? 'anchor';
        const d: Design = { id: 'sil_' + c.id, name: c.id, chassis: c.id, mobility: mob, mounts: c.mounts.map(() => null) };
        const s = unitSprites(d, 0, 13);
        const sil = silhouette(s, '#000');
        g.setTransform(1, 0, 0, 1, W / 2, W / 2);
        g.rotate(-Math.PI / 2);
        const e = s.ext * px;
        void e;
        g.drawImage(sil, -e, -e, e * 2, e * 2);
      }
    }
  }
}

function animate(): void {
  let t0 = performance.now();
  const loop = (now: number) => {
    const t = (now - t0) / 1000;
    for (const a of animated) {
      const r = a.c.getBoundingClientRect();
      if (r.bottom < -50 || r.top > innerHeight + 50) continue;
      drawUnitPreview(a.c, a.d, { side, time: t });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  void t0;
}

function main(): void {
  document.body.classList.toggle('enemy', side === 1);
  const show = (id: string) => !only || only === id;
  for (const id of ['grid', 'modules', 'icons', 'small', 'field']) if (!show(id)) $('#sec-' + id).style.display = 'none';
  if (show('field')) fieldSection();
  if (show('grid')) gridSection();
  if (show('modules')) modulesSection();
  if (show('icons')) iconsSection();
  if (show('small')) smallSection();
  if (only === 'sil') silSection();
  animate();
  addEventListener('pointerdown', () => unlockAudio(), { once: true });
}

main();
