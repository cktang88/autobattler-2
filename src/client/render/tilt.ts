// Camera tilt for the battlefield: a slight 2.5D look (orthographic, tilted back from straight-down).
//
// The ground plane is foreshortened vertically by cos(TILT_DEG); a point `h` cells above the ground rises on screen
// by h * sin(TILT_DEG) (in the world transform that is a world-y shift of -h * tan(TILT_DEG) along the viewer's "up").
// Everything drawn in world space (ground, zones, range rings, footprints) is foreshortened automatically; unit sprites
// are only mildly squashed (cos 28 deg = 0.88) and are given height by lifting them and extruding a side wall.

/** Tilt from straight-down, degrees. 0 = classic top-down. ~20-30 reads as a 3D battlefield without distortion. */
export const TILT_DEG = 28;

const RAD = (TILT_DEG * Math.PI) / 180;
export const TILT_COS = Math.cos(RAD);
export const TILT_SIN = Math.sin(RAD);
export const TILT_TAN = Math.tan(RAD);

/** Hull body height (cells) of a ground unit of chassis size S: the extruded side wall. */
export const hullHeight = (S: number): number => 0.38 * Math.pow(Math.max(0.5, S), 0.85);
/** Flight height (cells) of a flyer of chassis size S. */
export const flyHeight = (S: number): number => 0.7 + 0.3 * S;
