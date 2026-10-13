// Destroyer-droid rolling form (mantis chassis): when it travels the droid curls into an armoured ball that rolls
// along its heading, and unfolds onto its tripod when it stops. Ball frames are baked per team + device px (one
// roll period = BALL_FRAMES frames), so a rolling unit costs a shadow blit, a halo blit and one frame blit.

import { METAL, OUTLINE, TEAM_PAL, clamp, ctx2d, makeCanvas, rgba, shade, type Ctx, type Team } from './palette.ts';
import { emis } from './giantart.ts';
import type { UnitLayout } from './unitart.ts';

const P2 = Math.PI * 2;
export const BALL_FRAMES = 8;
/** armour lames round the rolling circumference: the pattern repeats every 1/LAMES of a turn */
const LAMES = 6;

/** Ball radius (cells) for a layout. */
export const ballR = (L: UnitLayout): number => 0.46 * Math.min(L.X, L.Y) + 0.04 * L.S;

/** Does this layout curl up to travel? (mantis on its own legs; hover skims, anchors never move) */
export const rolls = (L: UnitLayout): boolean => L.shape === 'mantis' && L.mob.kind === 'ground' && L.mob.id !== 'hover';

const curlState = new Map<number, { m: boolean; t: number }>();
/** 1 = fully curled, 0 = deployed; eases over ~0.35 s after the unit starts / stops moving. */
export function curlOf(seed: number, moving: boolean, time: number): number {
  let st = curlState.get(seed);
  if (!st || time < st.t) {
    if (curlState.size > 4000) curlState.clear();
    st = { m: moving, t: time - 10 };
    curlState.set(seed, st);
  }
  if (st.m !== moving) { st.m = moving; st.t = time; }
  const k = clamp((time - st.t) / 0.35, 0, 1);
  return moving ? k : 1 - k;
}

const ballCache = new Map<string, HTMLCanvasElement[]>();

/** Baked ball frames (rolling toward +x), centred, half extent = ballR * 1.25 cells. */
export function ballFrames(L: UnitLayout, team: Team, px: number): HTMLCanvasElement[] {
  const R = ballR(L);
  const key = `${team}|${px}|${R.toFixed(3)}`;
  let fr = ballCache.get(key);
  if (fr) return fr;
  if (ballCache.size > 120) ballCache.clear();
  const pal = TEAM_PAL[team], E = emis(pal);
  const ext = R * 1.25, size = Math.ceil(2 * ext * px);
  const o = Math.max(1.3 / px, 0.03);
  fr = [];
  for (let f = 0; f < BALL_FRAMES; f++) {
    const c = makeCanvas(size, size);
    const g = ctx2d(c);
    g.translate(size / 2, size / 2); g.scale(px, px);
    drawBall(g, R, (f / BALL_FRAMES) * (P2 / LAMES), pal, E, o);
    fr.push(c);
  }
  ballCache.set(key, fr);
  return fr;
}

function drawBall(g: Ctx, R: number, roll: number, pal: (typeof TEAM_PAL)[number], E: string, o: number): void {
  const ball = new Path2D(); ball.arc(0, 0, R, 0, P2);
  // outline + team rim (the ball replaces the unit's own halo while rolling)
  g.lineWidth = o * 4.5; g.strokeStyle = rgba(pal.rim, 0.85); g.stroke(ball);
  g.lineWidth = o * 2.2; g.strokeStyle = OUTLINE; g.stroke(ball);
  const gr = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.05, 0, 0, R * 1.05);
  gr.addColorStop(0, shade(pal.light, 0.22)); gr.addColorStop(0.5, pal.body); gr.addColorStop(1, shade(pal.deep, -0.08));
  g.fillStyle = gr; g.fill(ball);
  g.save(); g.clip(ball);
  // armour lames: seams across the direction of travel, sliding forward and foreshortening as the ball turns
  for (let i = 0; i < LAMES * 2; i++) {
    const th = roll + (i / (LAMES * 2)) * P2;
    const ct = Math.cos(th);
    if (ct < 0.02) continue; // back of the ball
    const st = Math.sin(th), major = i % 2 === 0;
    // a meridian through the roll axis projects to a half ellipse: x-radius R|sin th|, y-radius R
    g.strokeStyle = major ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.28)';
    g.lineWidth = (major ? o * 1.3 : o * 0.7) * (0.4 + 0.6 * ct);
    g.beginPath(); g.ellipse(0, 0, Math.max(o * 0.2, R * Math.abs(st)), R, 0, -Math.PI / 2, Math.PI / 2, st < 0); g.stroke();
    if (major && i % 4 === 0) {
      g.fillStyle = rgba(pal.accent, 0.9 * ct);
      for (const s of [-1, 1]) { const x = R * st * Math.cos(0.95), y = s * R * Math.sin(0.95); g.beginPath(); g.ellipse(x, y, R * 0.07 * (0.3 + 0.7 * ct), R * 0.05, 0, 0, P2); g.fill(); }
    }
  }
  // the central rolling band (the folded back shell): darker metal rim with tread lugs, a glowing seam either side
  const bw = R * 0.34;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-R, -bw / 2 - o, R * 2, bw + o * 2);
  const bg = g.createLinearGradient(0, -bw / 2, 0, bw / 2);
  bg.addColorStop(0, METAL.light); bg.addColorStop(0.5, METAL.base); bg.addColorStop(1, METAL.deep);
  g.fillStyle = bg; g.fillRect(-R, -bw / 2, R * 2, bw);
  for (let i = 0; i < 16; i++) {
    const th = roll * 2 + (i / 16) * P2;
    const ct = Math.cos(th);
    if (ct < 0.05) continue;
    const x = Math.sin(th) * R;
    g.fillStyle = `rgba(10,12,14,${0.35 + 0.4 * ct})`;
    g.fillRect(x - R * 0.04 * ct, -bw * 0.42, R * 0.08 * ct, bw * 0.84);
  }
  for (const s of [-1, 1]) {
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = o * 1.6; g.beginPath(); g.moveTo(-R, s * bw / 2); g.lineTo(R, s * bw / 2); g.stroke();
    g.strokeStyle = rgba(E, 0.85); g.lineWidth = o * 0.7; g.stroke();
  }
  // terminator shade + specular
  const sh = g.createRadialGradient(R * 0.25, R * 0.3, R * 0.4, 0, 0, R * 1.1);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = sh; g.fillRect(-R, -R, R * 2, R * 2);
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.ellipse(-R * 0.38, -R * 0.42, R * 0.28, R * 0.14, -0.6, 0, P2); g.fill();
  g.restore();
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(ball);
}

/** Soft round contact shadow for the ball. */
export function ballShadow(g: Ctx, x: number, y: number, R: number, alpha: number): void {
  const gr = g.createRadialGradient(x, y, R * 0.3, x, y, R * 1.15);
  gr.addColorStop(0, `rgba(0,0,0,${0.55 * alpha})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, R * 1.15, 0, P2); g.fill();
}
