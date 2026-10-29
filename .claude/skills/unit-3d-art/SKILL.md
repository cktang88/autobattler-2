---
name: unit-3d-art
description: Design, model or fix the procedural 3D units (hulls, mech torsos, legs, weapons) in src/client/proto3d — art direction rules, mech torso mode, triangle budgets, mesh simplification, z-fighting fixes, render harness and checks. Use for any change to how a unit or weapon looks in 3D, or for flicker / socket / polycount issues.
---

# Unit 3D art

1. Read `docs/3d-units-guide.md` fully (art rules, architecture, budgets, simplification, z-fighting, workflow,
   the user's feedback history). Then read the header of `src/client/proto3d/chassis/registry.ts`.
2. Look at the reference images in `docs/inspo/` and `docs/inspo/research/` before designing. Never design from
   memory of a game: find and look at real pictures.
3. Design in one line per unit first: what carries the main weapon, side and top-down silhouette, how it differs
   from the other hulls. Mechs: use `ChassisOut.torso` (see `raider` in chassis/mechframes.ts).
4. Build and look:
   - `npm run build:proto3d`, serve `public/` (`python3 -m http.server 8766`, run in background)
   - `LAB='<chassis>:<mobility>:0:<w1|w2>' VIEWS='a@0,0,4.5,10,50,0.8;top@0,0,8,80,0,0;game@0,0,14,57,40,0' OUT=<dir> NODE_PATH=$(npm root -g) node scripts/3d/shots.cjs`
   - make a contact sheet and actually look at it; iterate until it is cool, deadly and imposing, not "basic".
5. Check before committing:
   - `npx tsc --noEmit`
   - `node --test test/turretseat3d.test.ts test/mountgeo.test.ts`, then `npm test`
   - `node scripts/3d/zfight-scan.ts` (flicker), `node scripts/3d/tri-budget.ts` (S1 <= 15k, S2..S5 <= 30k),
     `node scripts/3d/fit-audit.ts` (weapons fit their hull, no housings overlapping)
   - garage sockets if you touched turrets / pods / torso: `scripts/3d/garage-shots.cjs`
6. Commit the rebuilt `public/proto3d.js(.map)` with the source change. Add anything new you learned to
   `docs/3d-units-guide.md`.
