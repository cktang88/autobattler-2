// Minimap: a small overview of the whole field shown while zoomed in. Dots for every live unit (own side blue, enemy
// red; bigger hulls bigger dots, aircraft hollow), the deploy zones, and the outline of what the camera sees.
// Click or drag on it to glide the camera there.

import { DEPLOY_D, FIELD_H, FIELD_W } from '../../shared/grid.ts';
import type { Side } from '../../shared/types.ts';
import { TEAM_PAL } from '../render/palette.ts';
import type { BattleView } from '../render/view.ts';
import { h } from '../app.ts';

export interface MiniDot { x: number; y: number; side: Side; size: number; flying: boolean }

/** share of the field the view must show less than before the minimap appears */
const SHOW_BELOW = 0.6;
const W = 168;

type P = { x: number; y: number };
/** Clip a convex polygon to an axis-aligned rectangle (Sutherland-Hodgman). Clamping each corner on its own (as this
 *  used to) bent a turned view's footprint out of shape wherever a corner lay past the field edge. */
export function clipRect(poly: P[], x0: number, y0: number, x1: number, y1: number): P[] {
  let out = poly;
  const edges: [(p: P) => number, (a: P, b: P) => P][] = [
    [(p) => p.x - x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => x1 - p.x, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y - y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0 })],
    [(p) => y1 - p.y, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1 })],
  ];
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], ia = inside(a) >= 0, ib = inside(b) >= 0;
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

export function createMinimap(host: HTMLElement, view: BattleView, canvasEl: HTMLElement) {
  const H = Math.round((W * FIELD_H) / FIELD_W);
  const cv = h('canvas.minimap', { width: String(W * 2), height: String(H * 2), title: 'Click to move the camera there' }) as HTMLCanvasElement;
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  host.append(cv);
  const g = cv.getContext('2d')!;
  let shown = false;

  /** world cells -> minimap px (the viewer's own side at the bottom, like the field) */
  const toMap = (x: number, y: number) => (view.viewerSide === 1 ? { x: ((FIELD_W - x) / FIELD_W) * W, y: ((FIELD_H - y) / FIELD_H) * H } : { x: (x / FIELD_W) * W, y: (y / FIELD_H) * H });
  const toWorld = (mx: number, my: number) => {
    const x = (mx / W) * FIELD_W, y = (my / H) * FIELD_H;
    return view.viewerSide === 1 ? { x: FIELD_W - x, y: FIELD_H - y } : { x, y };
  };

  let dragging = false;
  const go = (e: PointerEvent) => {
    // CSS may draw the map smaller than W x H (phones): map the pointer through the drawn size
    const r = cv.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * W) / Math.max(1, r.width), my = ((e.clientY - r.top) * H) / Math.max(1, r.height);
    const p = toWorld(Math.max(0, Math.min(W, mx)), Math.max(0, Math.min(H, my)));
    view.centerOn(p.x, p.y);
  };
  cv.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); dragging = true; cv.setPointerCapture(e.pointerId); go(e); });
  cv.addEventListener('pointermove', (e) => { if (dragging) { e.stopPropagation(); go(e); } });
  const end = (e: PointerEvent) => { dragging = false; e.stopPropagation(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  /** the camera's footprint on the ground (world cells): the four screen corners projected, clipped to the field */
  const footprint = () => {
    const w = canvasEl.clientWidth, hh = canvasEl.clientHeight;
    const pts = [[0, 0], [w, 0], [w, hh], [0, hh]].map(([px, py]) => {
      let p: { x: number; y: number };
      try { p = view.screenToWorld(px, py); } catch { p = { x: NaN, y: NaN }; }
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) p = { x: FIELD_W / 2, y: FIELD_H / 2 };
      return p;
    });
    return clipRect(pts, -4, -4, FIELD_W + 4, FIELD_H + 4);
  };
  const area = (p: { x: number; y: number }[]) => {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
    return Math.abs(a) / 2;
  };

  function update(dots: MiniDot[] | null): void {
    const fp = footprint();
    const want = dragging || area(fp) < FIELD_W * FIELD_H * SHOW_BELOW;
    if (want !== shown) { shown = want; cv.classList.toggle('on', want); }
    if (!shown) return;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,18,22,0.82)';
    g.fillRect(0, 0, W, H);
    // deploy zones: own at the bottom, enemy at the top
    const zh = (DEPLOY_D / FIELD_H) * H;
    g.fillStyle = 'rgba(63,140,255,0.12)'; g.fillRect(0, H - zh, W, zh);
    g.fillStyle = 'rgba(255,90,60,0.10)'; g.fillRect(0, 0, W, zh);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    for (const d of dots ?? []) {
      const p = toMap(d.x, d.y), mine = d.side === view.viewerSide;
      const r = Math.min(4, 0.9 + d.size * 0.55);
      g.fillStyle = mine ? TEAM_PAL[0].mark : TEAM_PAL[1].mark;
      g.strokeStyle = g.fillStyle;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (d.flying) { g.lineWidth = 1; g.stroke(); } else g.fill();
    }
    // camera footprint
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.2;
    g.beginPath();
    fp.forEach((q, i) => { const p = toMap(q.x, q.y); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
    g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  return { update, destroy: () => cv.remove() };
}
