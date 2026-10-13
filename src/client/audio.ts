// WebAudio sound: synthesized SFX (weapons by visual family, impacts, explosions, deaths, UI) and streamed music
// with crossfades. Every entry point is safe to call when audio is unavailable or still locked.
//
// Mixing: sfx bus -> compressor -> master. Per-sound-type rate limits plus a global voice cap keep 100 guns
// from clipping. Battle sounds pan by world x (setPanFlip mirrors it for a viewer on side 1).

import { FIELD_W } from '../shared/grid.ts';
import { MODULE_BY_ID } from '../shared/parts.ts';
import type { BattleEvent } from '../shared/sim/types.ts';

export type SfxName = 'click' | 'hover' | 'place' | 'invalid' | 'upgrade' | 'ready' | 'roundWin' | 'roundLose' | 'victory' | 'defeat' | 'error';
export type MusicTrack = 'menu' | 'deploy' | 'battle' | 'victory' | 'defeat' | null;

type Wave = OscillatorType;

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let vol = { master: 0.8, music: 0.55, sfx: 0.8 };
let panFlip = false;
let voices = 0;
const MAX_VOICES = 56;
const lastPlay = new Map<string, number>();
const playing = new Map<string, number>();

function ctx(): AudioContext | null {
  if (ac) return ac;
  try {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = vol.master;
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    sfxBus = ac.createGain();
    sfxBus.gain.value = vol.sfx;
    sfxBus.connect(comp);
    comp.connect(master);
    master.connect(ac.destination);
    const len = ac.sampleRate;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ac = null;
  }
  return ac;
}

/** Call from a user gesture to unlock WebAudio. Safe to call repeatedly. */
export function unlockAudio(): void {
  try {
    const a = ctx();
    if (a && a.state === 'suspended') void a.resume().catch(() => {});
    music.unlock();
  } catch { /* ignore */ }
}

/** Mirror stereo panning (viewer on side 1 sees the field rotated 180°). */
export function setPanFlip(flip: boolean): void {
  panFlip = flip;
}

export function setVolumes(v: { master: number; music: number; sfx: number }): void {
  vol = { master: clamp01(v.master), music: clamp01(v.music), sfx: clamp01(v.sfx) };
  try {
    if (ac && master && sfxBus) {
      master.gain.setTargetAtTime(vol.master, ac.currentTime, 0.02);
      sfxBus.gain.setTargetAtTime(vol.sfx, ac.currentTime, 0.02);
    }
    music.applyVolume();
  } catch { /* ignore */ }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);

/* ------------------------------------------------------------------------------------------ voices */

interface Opt {
  delay?: number;
  pan?: number;
  attack?: number;
}

function out(a: AudioContext, pan: number): AudioNode {
  if (!sfxBus) return a.destination;
  if (pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(sfxBus);
    return p;
  }
  return sfxBus;
}

function track(node: AudioScheduledSourceNode, end: number): void {
  voices++;
  node.onended = () => { voices--; };
  void end;
}

function tone(wave: Wave, f0: number, f1: number, dur: number, gain: number, o: Opt = {}): void {
  const a = ac;
  if (!a) return;
  const t = a.currentTime + (o.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(1, f0), t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const at = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(out(a, o.pan ?? 0));
  osc.start(t);
  osc.stop(t + dur + 0.02);
  track(osc, t + dur);
}

function noise(type: BiquadFilterType, q: number, c0: number, c1: number, dur: number, gain: number, o: Opt = {}): void {
  const a = ac;
  if (!a || !noiseBuf) return;
  const t = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(20, c0), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, c1), t + dur);
  const g = a.createGain();
  const at = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out(a, o.pan ?? 0));
  const off = Math.random() * 0.5;
  src.start(t, off, dur + 0.05);
  track(src, t + dur);
}

/** Rate limit per key; returns false when the sound should be skipped. */
function gate(key: string, minGap: number, maxConcurrent = 6, dur = 0.2): boolean {
  if (!ac || ac.state !== 'running') return false;
  if (voices > MAX_VOICES) return false;
  const now = ac.currentTime;
  const last = lastPlay.get(key) ?? -1;
  if (now - last < minGap) return false;
  const until = playing.get(key) ?? 0;
  // approximate concurrency via a decaying counter
  const active = Math.max(0, until - now) / dur;
  if (active >= maxConcurrent) return false;
  lastPlay.set(key, now);
  playing.set(key, Math.max(now, until) + dur);
  return true;
}

/* ------------------------------------------------------------------------------------- weapon sfx */

type Recipe = (pan: number, k: number) => void;

const R: Record<string, Recipe> = {
  mg: (p, k) => { noise('bandpass', 1, 2600 * k, 1100, 0.04, 0.35, { pan: p }); tone('square', 210 * k, 90, 0.03, 0.12, { pan: p }); },
  hmg: (p, k) => { noise('bandpass', 0.9, 1900 * k, 700, 0.07, 0.45, { pan: p }); tone('triangle', 150 * k, 60, 0.06, 0.3, { pan: p }); },
  gatling: (p) => { noise('bandpass', 1.2, 3000, 1600, 0.035, 0.28, { pan: p }); tone('square', 260, 140, 0.02, 0.07, { pan: p }); },
  shotgun: (p) => { noise('lowpass', 0.8, 3500, 400, 0.16, 0.7, { pan: p }); tone('sine', 140, 50, 0.15, 0.45, { pan: p }); noise('highpass', 0.7, 3000, 3000, 0.006, 0.4, { pan: p }); },
  autocannon: (p, k) => { tone('sine', 130 * k, 45, 0.12, 0.6, { pan: p }); noise('lowpass', 0.8, 1600 * k, 300, 0.1, 0.55, { pan: p }); noise('highpass', 0.7, 3200, 3200, 0.005, 0.35, { pan: p }); },
  cannon: (p, k) => {
    noise('highpass', 0.7, 3000, 3000, 0.006, 0.6, { pan: p });
    tone('sine', 110 * k, 34, 0.35, 0.9, { pan: p });
    noise('lowpass', 0.8, 1800 * k, 140, 0.4, 0.8, { pan: p });
    noise('lowpass', 0.7, 600, 150, 0.35, 0.18, { pan: p, delay: 0.06 });
  },
  gauss: (p) => { tone('sawtooth', 300, 2400, 0.12, 0.18, { pan: p }); noise('highpass', 0.7, 4000, 2000, 0.05, 0.5, { pan: p, delay: 0.1 }); tone('sine', 900, 80, 0.25, 0.5, { pan: p, delay: 0.1 }); },
  sniper: (p) => { noise('highpass', 0.7, 3500, 3500, 0.006, 0.9, { pan: p }); tone('sine', 95, 34, 0.25, 0.7, { pan: p }); noise('bandpass', 0.9, 900, 350, 0.12, 0.5, { pan: p }); noise('lowpass', 0.7, 650, 170, 0.4, 0.15, { pan: p, delay: 0.15 }); },
  rail: (p, k) => { tone('sine', 500, 3200 * k, 0.22, 0.18, { pan: p, attack: 0.15 }); noise('highpass', 0.7, 5000, 1500, 0.08, 0.8, { pan: p, delay: 0.2 }); tone('sawtooth', 1800, 60, 0.35, 0.4, { pan: p, delay: 0.2 }); },
  rocketPod: (p) => { noise('bandpass', 1.6, 500, 2600, 0.32, 0.4, { pan: p, attack: 0.03 }); tone('triangle', 120, 60, 0.08, 0.3, { pan: p }); },
  missileRack: (p) => { noise('lowpass', 0.9, 400, 3200, 0.5, 0.45, { pan: p, attack: 0.05 }); tone('sawtooth', 180, 520, 0.4, 0.06, { pan: p }); },
  cruise: (p) => { noise('lowpass', 0.9, 200, 2400, 1.0, 0.7, { pan: p, attack: 0.1 }); tone('sawtooth', 70, 160, 0.9, 0.12, { pan: p }); tone('sine', 80, 40, 0.3, 0.6, { pan: p }); },
  mortar: (p) => { tone('sine', 95, 40, 0.2, 0.7, { pan: p }); noise('bandpass', 1.4, 420, 180, 0.18, 0.5, { pan: p }); noise('lowpass', 0.8, 700, 100, 0.3, 0.3, { pan: p }); },
  artillery: (p) => {
    noise('highpass', 0.7, 3000, 3000, 0.007, 0.7, { pan: p });
    tone('sine', 70, 28, 0.6, 1.0, { pan: p });
    noise('lowpass', 0.8, 1000, 80, 0.75, 0.9, { pan: p });
    noise('lowpass', 0.7, 500, 120, 0.6, 0.25, { pan: p, delay: 0.12 });
  },
  laser: (p, k) => { tone('sawtooth', 1800 * k, 320, 0.12, 0.13, { pan: p }); tone('sine', 1100 * k, 260, 0.1, 0.2, { pan: p }); },
  heatray: (p) => { noise('bandpass', 2, 900, 700, 0.2, 0.18, { pan: p, attack: 0.03 }); tone('sawtooth', 95, 90, 0.2, 0.06, { pan: p, attack: 0.03 }); },
  plasma: (p, k) => { tone('sawtooth', 110 * k, 85, 0.22, 0.12, { pan: p, attack: 0.02 }); tone('sine', 230 * k, 180, 0.2, 0.18, { pan: p }); noise('bandpass', 3, 1400, 900, 0.15, 0.1, { pan: p }); },
  plasmaorb: (p) => { tone('sine', 600, 140, 0.3, 0.35, { pan: p }); tone('sawtooth', 160, 90, 0.3, 0.08, { pan: p }); },
  flamer: (p) => { noise('lowpass', 0.8, 900, 380, 0.25, 0.3, { pan: p, attack: 0.04 }); noise('bandpass', 1, 2400, 1400, 0.12, 0.08, { pan: p }); },
  tesla: (p) => {
    for (let i = 0; i < 5; i++) noise('highpass', 0.8, 2500 + Math.random() * 3000, 2000, 0.012 + Math.random() * 0.02, 0.4, { pan: p, delay: i * 0.03 + Math.random() * 0.02 });
    tone('square', 60, 58, 0.18, 0.08, { pan: p });
  },
  emp: (p) => { tone('square', 120, 40, 0.25, 0.14, { pan: p }); noise('bandpass', 4, 3000, 600, 0.25, 0.25, { pan: p }); },
  slowbeam: (p) => { tone('sine', 300, 180, 0.2, 0.15, { pan: p }); tone('sine', 306, 182, 0.2, 0.15, { pan: p }); },
  sonic: (p) => { tone('sine', 140, 40, 0.3, 0.8, { pan: p }); noise('bandpass', 1.2, 300, 120, 0.25, 0.5, { pan: p }); },
  gravity: (p) => { tone('sine', 55, 110, 0.35, 0.5, { pan: p }); tone('sawtooth', 40, 70, 0.3, 0.08, { pan: p }); },
  flak: (p) => { noise('bandpass', 1.1, 1400, 500, 0.06, 0.45, { pan: p }); tone('triangle', 260, 90, 0.06, 0.3, { pan: p }); },
  melee: (p) => { noise('bandpass', 2, 1800, 900, 0.08, 0.45, { pan: p }); tone('square', 900, 400, 0.04, 0.1, { pan: p }); tone('sine', 120, 50, 0.1, 0.4, { pan: p }); },
  saw: (p) => { tone('sawtooth', 900, 700, 0.2, 0.12, { pan: p }); noise('bandpass', 6, 3500, 3000, 0.2, 0.2, { pan: p }); },
  hammer: (p) => { tone('sine', 80, 30, 0.35, 1.0, { pan: p }); noise('lowpass', 0.8, 1500, 100, 0.3, 0.8, { pan: p }); tone('triangle', 620, 600, 0.3, 0.1, { pan: p, delay: 0.01 }); },
  pointdef: (p) => { tone('sawtooth', 2400, 900, 0.05, 0.06, { pan: p }); },
  repair: (p) => { tone('sine', 880, 1320, 0.15, 0.07, { pan: p, attack: 0.03 }); },
};

/** Recipe key + gate parameters for a module. */
function weaponSound(id: string): { key: string; k: number; gap: number; max: number; dur: number } | null {
  const m = MODULE_BY_ID.get(id);
  if (!m) return { key: 'mg', k: 1, gap: 0.05, max: 4, dur: 0.05 };
  const cal = m.caliber ?? 0.5;
  const k = 1.25 - cal * 0.5;
  switch (m.visual) {
    case 'gun':
      if (m.category === 'autocannon') return { key: 'autocannon', k, gap: 0.06, max: 5, dur: 0.12 };
      return cal >= 0.4 ? { key: 'hmg', k, gap: 0.05, max: 5, dur: 0.07 } : { key: 'mg', k, gap: 0.04, max: 5, dur: 0.04 };
    case 'gatling': return { key: 'gatling', k, gap: 0.035, max: 4, dur: 0.035 };
    case 'shotgun': return { key: 'shotgun', k, gap: 0.08, max: 3, dur: 0.16 };
    case 'cannon': return { key: 'cannon', k, gap: 0.08, max: 4, dur: 0.4 };
    case 'gauss': return { key: 'gauss', k, gap: 0.12, max: 3, dur: 0.35 };
    case 'sniper': return { key: 'sniper', k, gap: 0.1, max: 3, dur: 0.4 };
    case 'rail': return { key: 'rail', k: 1.3 - cal * 0.4, gap: 0.12, max: 3, dur: 0.55 };
    case 'rocketPod': return { key: 'rocketPod', k, gap: 0.06, max: 5, dur: 0.32 };
    case 'missileRack': return { key: 'missileRack', k, gap: 0.08, max: 4, dur: 0.5 };
    case 'cruise': return { key: 'cruise', k, gap: 0.3, max: 2, dur: 1 };
    case 'mortar': return { key: 'mortar', k, gap: 0.1, max: 3, dur: 0.3 };
    case 'artillery': return { key: 'artillery', k, gap: 0.15, max: 3, dur: 0.75 };
    case 'laser': return { key: 'laser', k, gap: 0.05, max: 4, dur: 0.12 };
    case 'heatray': return { key: 'heatray', k, gap: 0.15, max: 2, dur: 0.2 };
    case 'plasma': return m.projectile === 'orb' ? { key: 'plasmaorb', k, gap: 0.12, max: 3, dur: 0.3 } : { key: 'plasma', k, gap: 0.18, max: 2, dur: 0.22 };
    case 'flamer': return { key: 'flamer', k, gap: 0.18, max: 2, dur: 0.25 };
    case 'tesla': return { key: 'tesla', k, gap: 0.1, max: 3, dur: 0.2 };
    case 'emp': return { key: 'emp', k, gap: 0.1, max: 3, dur: 0.25 };
    case 'slowbeam': return { key: 'slowbeam', k, gap: 0.2, max: 2, dur: 0.2 };
    case 'sonic': return { key: 'sonic', k, gap: 0.12, max: 3, dur: 0.3 };
    case 'gravity': return { key: 'gravity', k, gap: 0.2, max: 2, dur: 0.35 };
    case 'flak': return { key: 'flak', k, gap: 0.06, max: 4, dur: 0.06 };
    case 'saw': case 'chainsaw': case 'drill': return { key: 'saw', k, gap: 0.12, max: 2, dur: 0.2 };
    case 'hammer': case 'ram': return { key: 'hammer', k, gap: 0.15, max: 2, dur: 0.35 };
    case 'claw': case 'blade': case 'prod': return { key: 'melee', k, gap: 0.08, max: 3, dur: 0.1 };
    case 'pointdef': return { key: 'pointdef', k, gap: 0.08, max: 2, dur: 0.05 };
    case 'repair': return null; // heal events handle it
    default: return m.kind === 'weapon' ? { key: 'hmg', k, gap: 0.06, max: 4, dur: 0.07 } : null;
  }
}

const panOf = (x: number) => {
  const p = (x / FIELD_W) * 2 - 1;
  return (panFlip ? -p : p) * 0.7;
};

function explosion(r: number, pan: number, big: boolean): void {
  const s = Math.min(2.5, Math.max(0.3, r));
  noise('highpass', 0.7, 2500, 2500, 0.008, 0.4 + 0.2 * s, { pan });
  tone('sine', 90 / (0.6 + s * 0.3), 28, 0.25 + s * 0.25, Math.min(1, 0.45 + s * 0.25), { pan });
  noise('lowpass', 0.8, 1400 / (0.5 + s * 0.3), 70, 0.3 + s * 0.35, Math.min(1, 0.4 + s * 0.3), { pan });
  if (big) noise('lowpass', 0.7, 400, 60, 1.2, 0.35, { pan, delay: 0.08 });
}

/** Play sounds for a tick's battle events (positional pan from x in world cells, 0..FIELD_W). */
export function battleSfx(events: BattleEvent[]): void {
  try {
    if (!ac || ac.state !== 'running' || !events.length) return;
    // a burst of many events in one call (fast-forward) gets thinned
    const thin = events.length > 60 ? 60 / events.length : 1;
    for (const e of events) {
      if (thin < 1 && Math.random() > thin && e.t !== 'death') continue;
      switch (e.t) {
        case 'fire': {
          const w = weaponSound(e.moduleId);
          if (!w || !gate('w:' + w.key, w.gap, w.max, w.dur)) break;
          R[w.key]?.(panOf(e.x), w.k);
          break;
        }
        case 'beam': {
          const m = MODULE_BY_ID.get(e.moduleId);
          // beams have a 'fire' event too for most weapons; only add the repair hum here
          if (m?.visual === 'repair' && gate('repair', 0.35, 1, 0.15)) R.repair(panOf(e.x2), 1);
          break;
        }
        case 'chain':
          if (e.points.length > 1 && gate('chainzap', 0.08, 3, 0.2)) {
            const p = panOf(e.points[e.points.length - 1].x);
            for (let i = 0; i < Math.min(6, e.points.length); i++) noise('highpass', 0.8, 3000 + Math.random() * 2000, 2200, 0.02, 0.25, { pan: p, delay: i * 0.025 });
          }
          break;
        case 'hit':
          if (e.shieldHit) { if (gate('shield', 0.06, 3, 0.15)) tone('sine', 1300, 600, 0.15, 0.12, { pan: panOf(e.x) }); }
          else if (e.damage >= 50) { if (gate('hitBig', 0.05, 4, 0.1)) { noise('bandpass', 2, 1500, 600, 0.08, 0.3, { pan: panOf(e.x) }); tone('triangle', 520, 480, 0.12, 0.06, { pan: panOf(e.x) }); } }
          else if (gate('hit', 0.035, 4, 0.03)) noise('highpass', 0.9, 3200, 2400, 0.025, 0.14, { pan: panOf(e.x) });
          break;
        case 'explode': {
          const m = MODULE_BY_ID.get(e.moduleId);
          const key = e.radius >= 1.4 ? 'boomL' : e.radius >= 0.6 ? 'boomM' : 'boomS';
          if (m?.visual === 'flak') { if (gate('flakburst', 0.06, 4, 0.12)) { noise('bandpass', 1, 1800, 500, 0.12, 0.4, { pan: panOf(e.x) }); tone('sine', 220, 70, 0.1, 0.3, { pan: panOf(e.x) }); } break; }
          if (m?.visual === 'emp') { if (gate('empburst', 0.1, 2, 0.3)) R.emp(panOf(e.x), 1); break; }
          if (!gate(key, key === 'boomL' ? 0.12 : 0.06, key === 'boomL' ? 3 : 5, 0.5)) break;
          explosion(e.radius, panOf(e.x), m?.visual === 'cruise' || e.radius >= 2);
          break;
        }
        case 'heal':
          if (gate('heal', 0.4, 1, 0.15)) tone('sine', 1046, 1568, 0.18, 0.05, { attack: 0.04 });
          break;
        case 'death': {
          if (!gate('death', 0.05, 5, 0.6)) break;
          const p = panOf(e.x);
          explosion(0.8 + e.size * 0.6, p, e.size >= 2);
          for (let i = 0; i < 2 + e.size; i++) tone('triangle', 400 + Math.random() * 900, 300, 0.12, 0.05, { pan: p, delay: 0.1 + Math.random() * 0.4 });
          break;
        }
        case 'leap':
          if (gate('leap', 0.1, 3, 0.3)) noise('bandpass', 1.5, 300, 1500, 0.3, 0.25, { attack: 0.05 });
          break;
        default: {
          const ev = e as { t: string; x?: number };
          if (ev.t === 'smoke' && gate('smoke', 0.3, 2, 0.6)) noise('lowpass', 0.8, 1200, 300, 0.6, 0.3, { pan: panOf(ev.x ?? FIELD_W / 2), attack: 0.03 });
        }
      }
    }
  } catch { /* never throw from audio */ }
}

/* ------------------------------------------------------------------------------------------- UI sfx */

function notes(seq: [number, number, number][], wave: Wave = 'square', gain = 0.12): void {
  for (const [f, d, at] of seq) tone(wave, f, f * 0.999, d, gain, { delay: at, attack: 0.005 });
}

export function sfx(name: SfxName): void {
  try {
    const a = ctx();
    if (!a || a.state !== 'running') return;
    if (!gate('ui:' + name, name === 'hover' ? 0.04 : 0.02, 3, 0.1)) return;
    switch (name) {
      case 'click': tone('square', 1200, 900, 0.035, 0.08); noise('highpass', 0.8, 4000, 4000, 0.01, 0.06); break;
      case 'hover': tone('sine', 1900, 1800, 0.025, 0.025); break;
      case 'place': tone('sine', 160, 60, 0.12, 0.45); noise('lowpass', 0.8, 1800, 200, 0.1, 0.3); tone('triangle', 700, 650, 0.08, 0.06, { delay: 0.04 }); break;
      case 'invalid': tone('square', 160, 150, 0.08, 0.1); tone('square', 120, 110, 0.12, 0.1, { delay: 0.09 }); break;
      case 'error': tone('sawtooth', 220, 110, 0.25, 0.12); break;
      case 'upgrade': notes([[523, 0.09, 0], [659, 0.09, 0.07], [784, 0.09, 0.14], [1046, 0.2, 0.21]], 'triangle', 0.16); break;
      case 'ready': notes([[659, 0.1, 0], [988, 0.22, 0.09]], 'triangle', 0.16); noise('bandpass', 1.5, 800, 2400, 0.25, 0.08); break;
      case 'roundWin': notes([[523, 0.12, 0], [659, 0.12, 0.1], [784, 0.12, 0.2], [1046, 0.35, 0.3]], 'square', 0.1); break;
      case 'roundLose': notes([[392, 0.18, 0], [349, 0.18, 0.16], [311, 0.4, 0.32]], 'triangle', 0.16); break;
      case 'victory': notes([[523, 0.12, 0], [659, 0.12, 0.12], [784, 0.12, 0.24], [1046, 0.18, 0.36], [784, 0.12, 0.54], [1046, 0.6, 0.66]], 'square', 0.1); break;
      case 'defeat': notes([[392, 0.3, 0], [370, 0.3, 0.3], [349, 0.3, 0.6], [262, 0.9, 0.9]], 'triangle', 0.18); break;
    }
  } catch { /* ignore */ }
}

/* -------------------------------------------------------------------------------------------- music */

const TRACKS: Record<Exclude<MusicTrack, null>, { file: string; loop: boolean; rate: number }> = {
  menu: { file: 'title.mp3', loop: true, rate: 1 },
  deploy: { file: 'tension.mp3', loop: true, rate: 1 },
  battle: { file: 'combat.mp3', loop: true, rate: 1 },
  victory: { file: 'win.mp3', loop: false, rate: 1 },
  // somber: the explore theme slowed and pitched down
  defeat: { file: 'explore.mp3', loop: true, rate: 0.8 },
};

let musicBase = 'assets/music/';
/** Override the music folder (relative to the page). */
export function setMusicBase(path: string): void {
  musicBase = path.endsWith('/') ? path : path + '/';
}

interface Chan {
  el: HTMLAudioElement;
  track: Exclude<MusicTrack, null>;
  fade: number;
  target: number;
}

const music = {
  chans: [] as Chan[],
  want: null as MusicTrack,
  timer: 0 as ReturnType<typeof setInterval> | 0,
  play(track: MusicTrack): void {
    this.want = track;
    for (const c of this.chans) c.target = c.track === track ? 1 : 0;
    if (track && !this.chans.some((c) => c.track === track && c.target === 1 && !c.el.ended)) {
      const def = TRACKS[track];
      if (typeof Audio === 'undefined') return;
      const el = new Audio(musicBase + def.file);
      el.loop = def.loop;
      el.preload = 'auto';
      try {
        el.playbackRate = def.rate;
        (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      } catch { /* ignore */ }
      el.volume = 0;
      const ch: Chan = { el, track, fade: 0, target: 1 };
      this.chans.push(ch);
      void el.play().catch(() => {});
    }
    this.ensureTimer();
  },
  unlock(): void {
    for (const c of this.chans) if (c.target > 0 && c.el.paused && !c.el.ended) void c.el.play().catch(() => {});
  },
  applyVolume(): void {
    for (const c of this.chans) c.el.volume = clamp01(c.fade * vol.master * vol.music);
  },
  ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const step = 0.05 / 1.2; // 1.2 s crossfade
      for (const c of this.chans) {
        if (c.fade < c.target) c.fade = Math.min(c.target, c.fade + step);
        else if (c.fade > c.target) c.fade = Math.max(c.target, c.fade - step);
      }
      this.applyVolume();
      this.chans = this.chans.filter((c) => {
        if (c.target === 0 && c.fade <= 0) { c.el.pause(); c.el.src = ''; return false; }
        return true;
      });
      if (!this.chans.length && this.timer) { clearInterval(this.timer); this.timer = 0; }
    }, 50);
  },
};

export function playMusic(track: MusicTrack): void {
  try {
    if (track === music.want && music.chans.some((c) => c.track === track && c.target === 1)) return;
    music.play(track);
  } catch { /* ignore */ }
}
