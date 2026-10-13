// Art lab (dev page): every chassis x mobility pairing, every module turret, every part icon, a tiny-scale
// readability row, a deploy-board view and a demo battle on a FieldView.
// URL params: ?enemy=1 (red team), ?battle=1 (auto-start battle), ?speed=N, ?only=grid|modules|icons|small|field,
// ?chassis=id,id (grid rows filter), ?big=1, ?zoom=N (grid cell scale), ?empty=1 (no turrets)

import { unlockAudio, playMusic } from './audio.ts';
import { drawPartIcon, drawUnitPreview, FieldView, type BoardUnit } from './render/field.ts';
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
  const designs = randomDesigns(24, 99);
  for (const d of designs) {
    const size = computeStats(d).size;
    host.append(preview(d, 20 * size + 8));
  }
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
  animate();
  addEventListener('pointerdown', () => unlockAudio(), { once: true });
}

main();
