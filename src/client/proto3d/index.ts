// Public surface of the 3D prototype builders (no dependence on main.ts scene globals), for reuse by other views.
//
//   const renderer = createRenderer(canvas);                 // WebGLRenderer: shadows, ACES tone mapping
//   const stage    = setupStage(renderer, scene);            // sun + sky hemisphere + PMREM sky env + fog; stage.fitShadow(cx, cz, radius)
//   const post     = setupPost(renderer, scene, camera, w, h, { ao, bloom, grade });   // post.render(), post.setSize(w, h)
//   const terrain  = buildTerrain(wCells, hCells, { seed, grid, zoneFrac, keepOut });  // terrain.group centred on the origin
//   const unit     = buildUnit(design, side);                // unit.root, unit.turrets[], unit.animate(t, dt, moving), unit.tris
//   aimTurret(tu, localX, localZ, dt); recoilKick(tu); recoilRelax(tu, dt);

export { buildUnit, contactShadow, type Unit3D } from './units3d.ts';
export { buildTurret, aimTurret, recoilKick, recoilRelax, type Turret } from './weapons3d.ts';
export { makeKit, paint, rng, atlasUV, type Kit, type MatLike, type UMat } from './materials.ts';
export { buildTerrain, type Terrain, type TerrainOpts } from './terrain3d.ts';
export { createRenderer, setupStage, setupPost, type Stage, type Post } from './stage3d.ts';
export { Bld, loft, lathe, slabGeo, bevBox, mtx } from './geo.ts';
