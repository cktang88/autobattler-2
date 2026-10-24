// Camera shake for the 3D battle view: located jolts, weighted by blast size, by distance from the view centre and by
// zoom (nothing at the fit view, strongest zoomed right in), decaying smoothly. Photosensitivity-safe: a hard pixel cap
// however many sources stack, and the player's Screen shake setting scales it (0 = off).
//
// API (the only thing effects code needs):  shakeAt(x, z, power)
//   x, z  = world position (three x / three z = field x / field y, cells)
//   power = how big the boom is, roughly its blast radius in cells: 0.3 a small pop, 1 a shell, 2-3 a heavy blast or a
//           medium hull dying, 5+ a titan going up or a tactical nuke.
// It goes to the view that is drawing right now (FieldView3D makes its CameraShake active for the frame), so code inside
// fx3d / FieldView3D event handling can call it without plumbing. `CameraShake.add` is the same call on one view.

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** CSS px at full zoom for a fully traumatised camera */
export const SHAKE_MAX_PX = 12;

export class CameraShake {
  /** 0..1; the offset grows with trauma^1.5 (small knocks stay small, big booms hit) */
  trauma = 0;
  /** player setting 0..1 (0 = off) */
  scale = 1;
  // the view as of the last frame: centre (world), radius of the visible ground (cells), zoom over the fit view
  private vx = 0; private vz = 0; private vr = 40; private zoom = 1;
  private later: { t: number; x: number; z: number; p: number }[] = [];
  private time = 0;

  /** where the camera looks (world) and how much of the ground it sees; z = k / fit k */
  setView(cx: number, cz: number, radius: number, zoom: number): void {
    this.vx = cx; this.vz = cz; this.vr = Math.max(1, radius); this.zoom = zoom;
  }

  /** zoom weight: 0 at (and just past) the fit view, 1 from ~6x in */
  static zoomWeight(zoom: number): number {
    const t = clamp((Math.log(Math.max(1, zoom)) - Math.log(1.25)) / (Math.log(6) - Math.log(1.25)), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** distance weight: full inside the middle of the view, fading out past its edge (bigger booms reach further) */
  static distWeight(d: number, viewR: number, power: number): number {
    const inner = viewR * 0.45 + power * 0.5, outer = viewR * 1.3 + power * 2.5;
    const t = clamp((d - inner) / Math.max(1e-3, outer - inner), 0, 1);
    return 1 - t * t * (3 - 2 * t);
  }

  /** trauma a boom of `power` adds at full weight */
  static traumaOf(power: number): number { return clamp(0.04 + 0.08 * power, 0, 0.65); }

  /** a located jolt (see the header); `delay` seconds holds it back (a cook-off after the first blast) */
  add(x: number, z: number, power: number, delay = 0): void {
    if (!(power > 0)) return;
    if (delay > 0) { this.later.push({ t: this.time + delay, x, z, p: power }); return; }
    const w = CameraShake.distWeight(Math.hypot(x - this.vx, z - this.vz), this.vr, power);
    if (w <= 0) return;
    this.trauma = Math.min(1, this.trauma + CameraShake.traumaOf(power) * w);
  }

  update(dt: number): void {
    this.time += dt;
    // fast at first, lingering a little at the tail: a smooth settle rather than a cut
    this.trauma = Math.max(0, this.trauma - dt * (0.5 + 1.6 * this.trauma));
    if (this.later.length) {
      const due = this.later.filter((e) => e.t <= this.time);
      if (due.length) { this.later = this.later.filter((e) => e.t > this.time); for (const e of due) this.add(e.x, e.z, e.p); }
    }
  }

  clear(): void { this.trauma = 0; this.later.length = 0; }

  /** screen offset (CSS px) at time t; zero when off, at the fit view or settled */
  offset(t: number): { sx: number; sy: number } {
    const tr = this.trauma * Math.sqrt(this.trauma);
    const amp = SHAKE_MAX_PX * tr * CameraShake.zoomWeight(this.zoom) * clamp(this.scale, 0, 1);
    if (amp <= 0.02) return { sx: 0, sy: 0 };
    // smooth (sum of sines, no per-frame random jumps)
    return {
      sx: (Math.sin(t * 19.5) * 0.6 + Math.sin(t * 31.7 + 1.3) * 0.4) * amp,
      sy: (Math.sin(t * 16.3 + 0.7) * 0.6 + Math.sin(t * 27.1 + 2.1) * 0.4) * amp,
    };
  }
}

let active: CameraShake | null = null;
/** FieldView3D: route shakeAt() to this view for the frame being drawn */
export function setActiveShake(s: CameraShake | null): void { active = s; }
/** jolt the camera of the view being drawn (see the header for the units) */
export function shakeAt(x: number, z: number, power: number, delay = 0): void { active?.add(x, z, power, delay); }
