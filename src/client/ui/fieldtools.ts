// Field controls shared by the match screen (match.ts) and the Playground (playground.ts), so both behave the same:
// zoom buttons, the battle auto camera, weapon range rings, the box-select rectangle, stat tooltips and the live
// stat line of a unit clicked mid-battle.

import { h } from '../app.ts';
import type { BattleView } from '../render/view.ts';
import { TILT_SIN, flyHeight, hullHeight } from '../render/tilt.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import type { SimUnit } from '../../shared/sim/types.ts';
import { forwardY, placementUnitCenters } from '../../shared/grid.ts';
import { bodyScale, hullK, mountOffsets } from '../../shared/mountgeo.ts';
import { placementValue } from '../../shared/match.ts';
import { MAX_LEVEL, fmtUnitPrice } from '../../shared/stats.ts';
import type { Design, Placement, Side, UnitStats } from '../../shared/types.ts';
import { RING_COLOR, ringsOf, statCard, svgIcon } from './match-ui.ts';
import type { DesignInfo } from './deckstats.ts';

export const stars = (lv: number) => '★'.repeat(lv) + '☆'.repeat(Math.max(0, MAX_LEVEL - lv));

// ---------- shop card filter ----------
/** what a card can do (the shop / Playground card filter) */
export type CardFilter = 'all' | 'aa' | 'ground' | 'armor' | 'swarm' | 'long' | 'air';
export const CARD_FILTERS: { value: CardFilter; label: string; title: string; test: (i: DesignInfo) => boolean }[] = [
  { value: 'all', label: 'All', title: 'Every design in your deck', test: () => true },
  { value: 'aa', label: 'Anti-air', title: 'Can shoot aircraft', test: (i) => i.caps.has('aa') },
  { value: 'ground', label: 'Anti-ground', title: 'Can shoot ground units', test: (i) => i.gnd > 0 },
  { value: 'armor', label: 'Anti-armor', title: 'Armor-piercing or heavy single hits', test: (i) => i.caps.has('armor') },
  { value: 'swarm', label: 'Splash', title: 'Splash, flame, chain or spread: clears light squads', test: (i) => i.caps.has('swarm') },
  { value: 'long', label: 'Long range', title: 'Reaches 80 m or more', test: (i) => i.caps.has('long') },
  { value: 'air', label: 'Aircraft', title: 'Flying units', test: (i) => i.caps.has('air') },
];

// ---------- zoom buttons ----------
/** + / − / fit buttons over the field (each marks the camera as user-moved, which stops the auto camera) */
export function zoomButtons(view: BattleView): HTMLElement {
  const user = () => { view.cam.userAt = performance.now(); };
  return h('div.zoombtns', null,
    h('button.small', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => { user(); view.zoomBy(1.5); } }, '+'),
    h('button.small', { title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => { user(); view.zoomBy(1 / 1.5); } }, '−'),
    h('button.small', { title: 'Fit whole field and reset the view (F) · right-drag (or Ctrl / Option + drag) turns the view', 'aria-label': 'Fit whole field', onclick: () => { user(); view.fit(); } }, '⤢'),
  );
}

// ---------- auto camera ----------
/** Auto camera for a battle: frames every living unit (zooming in as the fight thins out) until the player moves the
 *  camera themselves (Camera.userAt changes); `start()` turns it back on for the next battle. `box` is the eased
 *  bounding box (world cells), so the framing glides instead of jumping when a unit dies or a jet loops away. */
export class AutoCam {
  private on = false;
  private since = 0;
  private box: [number, number, number, number] | null = null;
  private view: BattleView;
  constructor(view: BattleView) { this.view = view; }
  start(enabled: boolean) { this.on = enabled; this.since = this.view.cam.userAt; this.box = null; }
  update(b: Battle, dt: number) {
    if (!this.on) return;
    if (this.view.cam.userAt > this.since) { this.on = false; return; }
    // where most of the units are: with 8+ alive, the outer 8% on each axis (stragglers, jets looping wide) is
    // left out so one far unit doesn't hold the whole field in view
    const xs: number[] = [], ys: number[] = [];
    for (const u of b.units) if (u.alive) { xs.push(u.x); ys.push(u.y); }
    if (!xs.length) return;
    xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
    const cut = xs.length >= 8 ? Math.floor(xs.length * 0.08) : 0, hiI = xs.length - 1 - cut;
    const x0 = xs[cut], x1 = xs[hiI], y0 = ys[cut], y1 = ys[hiI];
    const bx = this.box;
    if (!bx) this.box = [x0, y0, x1, y1];
    else {
      // ease toward the live box: grows a little faster than it shrinks so units rarely leave the frame
      const ease = (cur: number, want: number, out: boolean) => cur + (want - cur) * Math.min(1, dt * (out ? 2.2 : 0.9));
      bx[0] = ease(bx[0], x0, x0 < bx[0]); bx[1] = ease(bx[1], y0, y0 < bx[1]);
      bx[2] = ease(bx[2], x1, x1 > bx[2]); bx[3] = ease(bx[3], y1, y1 > bx[3]);
    }
    const f = this.box!;
    this.view.frameWorldBox(f[0], f[1], f[2], f[3]);
  }
}

// ---------- box select ----------
/** rubber-band rectangle in canvas CSS px; `add`: Shift / Box-select mode (a click toggles one block) */
export interface BoxSel { x0: number; y0: number; x1: number; y1: number; add: boolean }
export function drawBoxSel(boxEl: HTMLElement, b: BoxSel | null) {
  if (!b) { boxEl.classList.add('hidden'); return; }
  const l = Math.min(b.x0, b.x1), t = Math.min(b.y0, b.y1);
  Object.assign(boxEl.style, { left: `${l}px`, top: `${t}px`, width: `${Math.abs(b.x1 - b.x0)}px`, height: `${Math.abs(b.y1 - b.y0)}px` });
  boxEl.classList.remove('hidden');
}
/** a box too small to be a drag (a click) */
export const boxIsTiny = (b: BoxSel) => Math.abs(b.x1 - b.x0) < 6 && Math.abs(b.y1 - b.y0) < 6;
/** does the screen point (canvas CSS px) fall inside the box */
export const inBox = (b: BoxSel, sx: number, sy: number) =>
  sx >= Math.min(b.x0, b.x1) && sx <= Math.max(b.x0, b.x1) && sy >= Math.min(b.y0, b.y1) && sy <= Math.max(b.y0, b.y1);

// ---------- stat tooltips ----------
/** block price; for a squad it buys all its units. `d` + `level` > 1: also the supply invested in the block (price +
 *  its upgrades), which is what it is worth */
export const costTag = (st: UnitStats, d?: Design, level = 1) => {
  const inv = d && level > 1 ? placementValue(d, level) : 0;
  return h('span.sc-cost', { title: `${st.squad > 1 ? `Block price: buys the whole squad of ${st.squad} units (≈${fmtUnitPrice(st.unitCost)} each)` : 'Supply price'}${inv ? ` · ${inv} invested with level ${level} upgrades` : ''}` },
    svgIcon('cost', 16), String(st.cost), st.squad > 1 ? h('small.sc-per', null, ` for ${st.squad}`) : null, inv ? h('small.sc-per', null, ` · ${inv} invested`) : null);
};
/** floating stat card of a design (shop card, live unit); `onRing`: hovering a range row highlights that ring */
export function tipFor(d: Design, st: UnitStats, level: number, tag: string, mine: boolean, spacing: number, onRing?: (k: string | null) => void, dmg: HTMLElement | null = null, rot = false): HTMLElement {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level));
  return h('div.stat-tip', { role: 'tooltip', class: mine ? 'friendly' : 'enemy' },
    h('div.sc-head', null,
      h('b.sc-name', null, d.name),
      h('span.stars', null, stars(lv)),
      h('span.sc-tag2', null, tag),
      costTag(st)),
    dmg,
    statCard({ design: d, st, level: lv, spacing, rot, onRing }));
}
/** place a mounted tooltip (size w x h) next to the client point `at`, inside `host` */
export function placeTipAt(tip: HTMLElement, host: HTMLElement, at: { x: number; y: number }, size: { w: number; h: number }) {
  const er = host.getBoundingClientRect();
  let left = at.x - er.left + 18, top = at.y - er.top + 18;
  if (left + size.w > er.width - 4) left = at.x - er.left - size.w - 18;
  if (top + size.h > er.height - 4) top = at.y - er.top - size.h - 18;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

// ---------- live unit (battle) ----------
/** the living sim unit drawn under the pointer (canvas CSS px), if any */
export function liveUnitAt(view: BattleView, battle: Battle | null, px: number, rawY: number): SimUnit | null {
  if (!battle) return null;
  // the drawn hull: the sim's oriented box (hullK x footprint, body-scaled) plus a finger margin; long hulls are hit
  // along their whole length. Tilted: a unit is drawn raised by its height (flyers by their altitude), so the
  // pointer is also read on the plane of its top.
  const probe = new Map<number, { x: number; y: number } | null>();
  const at = (rise: number) => {
    if (!probe.has(rise)) { try { probe.set(rise, view.screenToWorld(px, rawY + rise)); } catch { probe.set(rise, null); } }
    return probe.get(rise)!;
  };
  let best: SimUnit | null = null, bd = Infinity;
  for (const u of battle.units) {
    if (!u.alive) continue;
    const S = u.stats.size, hk = hullK(S), cs = Math.cos(u.angle), sn = Math.sin(u.angle);
    const tops = view.tilted ? [0, Math.round((u.flying ? flyHeight(S, u.design.mobility === 'jet') : 0.6 * hullHeight(S)) * TILT_SIN * view.cam.k)] : [0];
    for (const rise of tops) {
      const w = at(rise);
      if (!w) continue;
      const dx = w.x - u.x, dy = w.y - u.y;
      const out = Math.hypot(Math.max(0, Math.abs(dx * cs + dy * sn) - hk * u.stats.fh), Math.max(0, Math.abs(dy * cs - dx * sn) - hk * u.stats.fw));
      const d = Math.hypot(dx, dy);
      if (out < 0.3 && d < bd) { bd = d; best = u; }
    }
  }
  return best;
}
/** live hp / damage of a clicked unit. The sim only tallies damage per block, so for a squad the hp is this one
 *  unit's (plus a squad hp / alive line) and the damage is labelled as the whole squad's. */
export function liveLine(battle: Battle | null, u: SimUnit): HTMLElement {
  const dealt = battle ? Math.round(battle.blockDamage(u.side, u.uid)) : 0;
  const squad = u.stats.squad ?? 1;
  let alive = 0, hpSum = 0, hpMax = 0;
  if (squad > 1 && battle) for (const q of battle.units) {
    if (q.side !== u.side || q.uid !== u.uid) continue;
    hpMax += q.maxHp;
    if (q.alive) { alive++; hpSum += Math.max(0, q.hp); }
  }
  const fmt = (n: number) => Math.round(n).toLocaleString();
  return h('div.sc-dmg.sc-live', null,
    h('span', null, u.alive ? (squad > 1 ? 'This unit' : 'Now') : (squad > 1 ? 'Unit destroyed' : 'Destroyed')),
    u.alive ? h('b', null, `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)} HP${u.shield > 0 ? ` · ${Math.ceil(u.shield)} shield` : ''}`) : null,
    u.alive && u.para > 0 ? h('em', { style: { color: '#9fe0ff' } }, u.stun > 0 ? `stunned ${u.stun.toFixed(1)}s` : `paralysis ${Math.round((100 * u.para) / u.maxHp)}%`) : null,
    squad > 1
      ? h('div.sc-live-sq', null,
        h('span', null, 'Squad'),
        h('b', null, `${alive}/${squad}`), h('small', null, ' alive · '),
        h('b', null, fmt(hpSum)), h('small', null, ` / ${fmt(hpMax)} HP`),
        h('em', null, `squad dealt ${dealt.toLocaleString()} this battle`))
      : h('em', null, `dealt ${dealt.toLocaleString()} this battle`));
}

// ---------- range rings ----------
/** the range-ring legend shown while rings are up */
export function ringLegend(): HTMLElement {
  return h('div.rlegend.hidden', null,
    h('span', { style: `--c:${RING_COLOR.ground}` }, 'Ground'),
    h('span', { style: `--c:${RING_COLOR.air}` }, 'Air'),
    h('span', { style: `--c:${RING_COLOR.both}` }, 'Both'),
    h('span.sup', { style: `--c:${RING_COLOR.support}` }, 'Support'),
    h('span.dash', { style: `--c:${'#ffffff'}` }, 'Min range'),
  );
}

export interface RingTarget { side: Side; design: Design; st: UnitStats; pos: Pick<Placement, 'x' | 'y'> & { spacing?: number; rot?: boolean }; strong: boolean; invalid?: boolean }

/** point on the outline of the rect [x0,x1]x[y0,y1] grown by r, along the ray from its centre at `ang` */
function envelopePoint(x0: number, y0: number, x1: number, y1: number, r: number, ang: number): { x: number; y: number } {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let lo = 0, hi = r + Math.hypot(hw, hh) + 2;
  for (let i = 0; i < 22; i++) {
    const t = (lo + hi) / 2;
    const ex = Math.max(0, Math.abs(dx * t) - hw), ey = Math.max(0, Math.abs(dy * t) - hh);
    if (Math.hypot(ex, ey) < r) lo = t; else hi = t;
  }
  return { x: cx + dx * lo, y: cy + dy * lo };
}

/** Weapon range rings drawn on a 2D canvas laid over the field (`ringCv`, same size as `canvas`). `viewer`: the side
 *  whose weak (all-units) rings are drawn solid; the other side's are dashed. */
export function createRangeRings(view: BattleView, canvas: HTMLCanvasElement, ringCv: HTMLCanvasElement, legendEl: HTMLElement, viewer: Side) {
  const ringCtx = ringCv.getContext('2d');
  let ringW = 0, ringH = 0, ringDpr = 1, ringsShown = false;
  // what the canvas holds now: redrawing identical rings every frame reallocated the backing store 60 times a second
  let lastTargets: RingTarget[] = [], lastHi: string | null = null, lastCam = '';
  const sameTargets = (a: RingTarget[], b: RingTarget[]) => a.length === b.length && a.every((t, i) => {
    const o = b[i];
    return t.side === o.side && t.design === o.design && t.st === o.st && t.strong === o.strong && !!t.invalid === !!o.invalid
      && t.pos.x === o.pos.x && t.pos.y === o.pos.y && t.pos.spacing === o.pos.spacing && !!t.pos.rot === !!o.pos.rot;
  });
  function clear() {
    if (!ringCtx || !ringsShown) return;
    // Reset the backing store instead of clearRect: Chrome was seen skipping a lone clearRect on this canvas when
    // nothing had been drawn since the last frame (the deploy rings then stayed up through the whole battle).
    // Assigning width always drops the bitmap (and the context state).
    ringCv.width = ringCv.width;
    ringCv.style.visibility = 'hidden'; // and hide the layer, belt and braces (seen under GPU load with 3D)
    ringsShown = false;
    legendEl.classList.add('hidden');
  }
  /** `ringHi`: key of the ring to highlight (a hovered range row of a stat card) */
  function draw(targets: RingTarget[], ringHi: string | null) {
    if (!ringCtx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw !== ringW || ch !== ringH || dpr !== ringDpr) {
      ringW = cw; ringH = ch; ringDpr = dpr;
      ringCv.width = Math.max(1, Math.round(cw * dpr));
      ringCv.height = Math.max(1, Math.round(ch * dpr));
    }
    const g = ringCtx;
    if (!targets.length) { clear(); return; }
    // camera probe: where two field points land on screen (moves with any pan, zoom, tilt or turn)
    const a = view.worldToScreen(0, 0), b = view.worldToScreen(48, 46);
    const cam = `${cw},${ch},${dpr},${a.x.toFixed(2)},${a.y.toFixed(2)},${b.x.toFixed(2)},${b.y.toFixed(2)}`;
    if (ringsShown && cam === lastCam && ringHi === lastHi && sameTargets(targets, lastTargets)) return;
    lastCam = cam; lastHi = ringHi; lastTargets = targets;
    if (ringsShown) ringCv.width = ringCv.width; // full reset (see clear)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    ringsShown = true;
    ringCv.style.visibility = '';
    legendEl.classList.remove('hidden');
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    // weak (all-units) rings first so the focused block's rings sit on top
    for (const t of [...targets].sort((a, b) => Number(a.strong) - Number(b.strong))) {
      const worldCenters = placementUnitCenters(t.side, t.pos, t.st);
      // local ground scale at this block (the 3D perspective camera draws nearer ground larger)
      const sc = view.scaleAt(worldCenters[0]?.x ?? 0, worldCenters[0]?.y ?? 0);
      const k = sc.k;
      // units deploy facing the enemy; ranges are measured from each weapon's own mount (same offsets as the sim)
      const bs = bodyScale(t.st.size), offs = mountOffsets(t.design).map((o) => ({ x: o.x * bs, y: o.y * bs }));
      const head = forwardY(t.side) < 0 ? -Math.PI / 2 : Math.PI / 2, hc = Math.cos(head), hs = Math.sin(head);
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      const frame = (mounts: number[] | null) => {
        x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
        for (const c of worldCenters) {
          for (const m of mounts ?? [-1]) {
            const o = m >= 0 ? offs[m] : undefined;
            const wx = c.x + (o ? hc * o.x - hs * o.y : 0), wy = c.y + (o ? hs * o.x + hc * o.y : 0);
            const sp = view.worldToScreen(wx, wy);
            x0 = Math.min(x0, sp.x); y0 = Math.min(y0, sp.y); x1 = Math.max(x1, sp.x); y1 = Math.max(y1, sp.y);
          }
        }
      };
      const rings = ringsOf(t.design, t.st).sort((a, b) => b.range - a.range);
      // the ring lives on the ground plane (foreshortened by the camera tilt): a circle around the mount for one unit,
      // the rounded outline of all its circles for a squad
      const ay = sc.ay;
      let uh = 0;
      let cur = new Path2D();
      const path = (r: number) => {
        const base = new Path2D();
        base.roundRect(x0 - r, y0 - r, x1 - x0 + 2 * r, uh + 2 * r, r);
        cur = new Path2D();
        cur.addPath(base, new DOMMatrix([1, 0, 0, ay, 0, y0 * (1 - ay)]));
      };
      const angles = [-90, -62, -118, -34, -146, -10, -170].map((a) => (a * Math.PI) / 180);
      rings.forEach((rg, i) => {
        frame(rg.melee ? null : rg.mounts);
        uh = (y1 - y0) / ay;
        const R = rg.range * k;
        const hi = ringHi != null && rg.key === ringHi;
        const dim = ringHi != null && !hi ? 0.3 : 1;
        const sup = rg.kind === 'support';
        g.save();
        g.lineJoin = 'round';
        g.lineCap = 'round';
        if (t.strong) {
          path(R);
          g.globalAlpha = (hi ? 0.2 : sup ? 0.04 : 0.07) * dim;
          g.fillStyle = rg.color;
          g.fill(cur);
          if (rg.minRange > 0) { // dead zone: darken
            path(rg.minRange * k);
            g.globalAlpha = 0.22 * dim;
            g.fillStyle = '#000';
            g.fill(cur);
          }
          // dark under-stroke for contrast against any terrain
          path(R);
          g.globalAlpha = 0.55 * dim;
          g.strokeStyle = '#06090c';
          g.lineWidth = (hi ? 6 : 4.5);
          g.setLineDash(sup ? [1, 7] : []);
          g.stroke(cur);
          g.globalAlpha = (t.invalid ? 0.6 : 1) * dim;
          g.strokeStyle = rg.color;
          g.lineWidth = hi ? 3.5 : 2.4;
          g.stroke(cur);
          if (rg.minRange > 0) {
            path(rg.minRange * k);
            g.setLineDash([7, 6]);
            g.lineWidth = 2;
            g.globalAlpha = 0.95 * dim;
            g.strokeStyle = rg.color;
            g.stroke(cur);
          }
        } else {
          g.globalAlpha = (t.side === viewer ? 0.62 : 0.55);
          g.strokeStyle = rg.color;
          g.lineWidth = 1.2;
          g.setLineDash(sup ? [1, 5] : t.side === viewer ? [] : [6, 4]);
          path(R);
          g.stroke(cur);
          if (rg.minRange > 0) { path(rg.minRange * k); g.setLineDash([3, 4]); g.stroke(cur); }
        }
        g.restore();
        if (!t.strong && !hi) return;
        // label on the ring, nudged along the arc until it fits the viewport and misses other labels
        g.font = '700 14px "Barlow Condensed", "Barlow", system-ui, sans-serif';
        const tw = g.measureText(rg.label).width + 14, th = 20;
        for (let a = 0; a < angles.length * 2; a++) {
          const ang = angles[(i + a) % angles.length] + (a >= angles.length ? 0.12 : 0);
          const pu = envelopePoint(x0, y0, x1, y0 + uh, R, ang);
          const pt = { x: pu.x, y: y0 + (pu.y - y0) * ay };
          const lx = pt.x - tw / 2, ly = pt.y - th / 2;
          if (lx < 6 || ly < 6 || lx + tw > cw - 6 || ly + th > ch - 6) continue;
          if (taken.some((q) => lx < q.x + q.w + 3 && q.x < lx + tw + 3 && ly < q.y + q.h + 3 && q.y < ly + th + 3)) continue;
          taken.push({ x: lx, y: ly, w: tw, h: th });
          g.save();
          g.globalAlpha = dim < 1 ? 0.5 : 1;
          g.fillStyle = 'rgba(8,11,15,0.88)';
          g.strokeStyle = rg.color;
          g.lineWidth = 1.5;
          g.beginPath();
          g.roundRect(lx, ly, tw, th, 10);
          g.fill();
          g.stroke();
          g.fillStyle = '#f4f8fb';
          g.textBaseline = 'middle';
          g.textAlign = 'center';
          g.fillText(rg.label, pt.x, pt.y + 0.5);
          g.restore();
          break;
        }
      });
    }
  }
  return { draw, clear };
}
