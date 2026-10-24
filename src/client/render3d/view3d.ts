// Camera / light constants shared by the 3D views (battlefield FieldView3D and the garage's UnitStage3D), so a unit
// in the designer is seen at the same pitch, field of view and sun as on the battlefield. Pure: no three.js.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** camera pitch at the fit (zoomed-out) view: steep, for readability of the whole board */
export const ELEV = (60 * Math.PI) / 180;
/** camera pitch when zoomed in (k >= PITCH_Z x fit): lower, so unit flanks, legs and tracks show */
export const ELEV_CLOSE = (43 * Math.PI) / 180;
export const PITCH_Z = 3.5;
/** sun offset from the view centre for the viewer at side 0 (x: left, y: up, z: toward the camera; negative = behind) */
export const SUN: [number, number, number] = [30, 40, -16];
/** pitch for zoom z = k / minK: ELEV at the fit view easing down to ELEV_CLOSE (log-zoom smoothstep) */
export function pitchAt(z: number): number {
  const t = clamp(Math.log(Math.max(1, z)) / Math.log(PITCH_Z), 0, 1);
  return lerp(ELEV, ELEV_CLOSE, t * t * (3 - 2 * t));
}
/** vertical field of view of the perspective camera (narrow: depth cue without a fish-eye look) */
export const FOV = 32;
