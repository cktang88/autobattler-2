# 3D units: art direction, architecture and lessons learned

How the procedural 3D units (hulls, legs, weapons) are built, what makes them look good, and the rules we learned
the hard way. Read this before touching `src/client/proto3d/`. The goal: units that look as cool, deadly and
imposing as Mechabellum / War Robots / BattleTech, readable from the RTS camera.

References live in `docs/inspo/` (user-picked) and `docs/inspo/research/` (War Robots Ares, Behemoth, Fafnir,
Raijin, Ravana; BattleTech Timber Wolf). Mechabellum unit renders and top-down silhouettes were the first target.
**Look at real reference images, never design from memory.**

---

## 1. Art direction: the rules

### The weapon IS the body
- Every unit is built around **one huge weapon system** (the "hero": its biggest weapon). On a tank, the hero's
  housing is the whole upper body (Mechabellum's Sabertooth). On a mech, the weapons are its arms and shoulders.
- **Extra weapons ride the main system** (side pods, mirrored shoulder pairs, top pods). Never scattered as
  separate turrets on a deck: that looks like duct tape and makes everything block everything else's traverse.
- **Never a generic flat platform with turrets on top.** No turret discs on a slab: a disc on a box reads as
  "someone put a cylinder on a tank".
- The hull is the **carrier** of the weapon: where it sits (centre, far back with a counterweight, on a spine, on a
  shoulder yoke), and what holds it up. Weapon locations are designed in, not N generic slots.

### Silhouette
- **Vertical and integrated**, not flat: stacked, layered masses climbing up into the weapon (raised torso, gun
  tower, shoulder masses over the running gear).
- **Top-heavy and wide**, like War Robots: compact torso, broad shoulders, weapons sticking out wider than the body
  at head height, thick legs in a wide stance. Lean forward, hunch; a narrow visor slit or a V of glowing eyes reads
  as menace. Swept-back armour blades and fins.
- **Every hull distinct from every other**, zoomed out and from the top-down camera: Sabertooth = four corner
  track pods; Fortress = two long forward pods; Vulcan = two big shoulder masses; Scorpion = long spine + splayed
  legs. Diverse sizes, shapes, module types and arrangements.
- Proportions matter more than detail: a mech whose legs outweigh its torso looks timid.

### Surface and parts
- Hulls are **assemblies of distinct chunky parts** with deep dark gaps between blocks, not one moulded block.
  Paint roles alternate: `kit.armor` (team colour), `kit.armor2` (near-black team), `kit.shell` (light bone),
  `kit.mech` (near-black mechanics), `kit.joint` (metal), emissives `kit.glow` / `kit.lamp` / `kit.plasma` /
  `kit.hot`.
- **Layered armour**: 2-3 stacked bevelled plates with offset edges; exposed mechanics (rams, drums, pistons) in
  the gaps; glowing cores seen through cut-outs.
- **A few big details, not many tiny ones.** Rows of tiny boxes read as "teeth" or "keyboard keys". Dots are cheap.
- **Glow must be chunky** enough to bloom (`kit.plasma` / `kit.glow` strips with real width, glowing cores).
  Thin emissive lines read as "white strings". `kit.rail` (blue, emissive 2.4) saturates to flat white: prefer
  `kit.plasma` for big glowing shapes.
- **Not low-poly**: rounded parts use real segment counts (weapon `Bld.segMax` is 16 on S>=2 units, 10 on S1).

### Weapons (year 2500, not modern / 1990s)
- New hardware on new physics: angular armoured housings, faceted glowing cores, layered receivers with vents and
  cut-outs. Families live in `weapons/w2500.ts` (rotary, blades, arc / arcCannon, lens, cradle, flame, carbine,
  artillery, emitter, railDriver).
- **Barrels are hollow** (a hollow muzzle with an inner wall and a dark core), and **length follows calibre**: thin
  guns are short (`barrel()` caps length at ~18 bores; `railDriver` caps by bore too).
- **Housing scales with the chassis** (`C.arm`, `mechHousing` levels): a small unit carrying a big gun is mostly
  exposed gun on a slim mount; a big body wraps it in full armour.
- The black turret ring/collar must **never overhang its base** (no "rubber gasket"): seats and collars are
  narrower than the turret (`collar()`, `ringSeat()`).
- Things the user hated, never again: nerf / foam guns, MLRS like an overhead projector, Tesla like Christmas decor,
  a railgun like a sandwiched block of ice, a laser with a round dish like a **suction cup**, coil teeth like a
  mouth. Prefer open forks, armoured petals, crystals, angular shrouds.

---

## 2. Architecture

```
src/client/proto3d/
  units3d.ts        buildUnit(design): hero pick + scaling, pods, chassis + mobility, turrets, torso, zfix, skin
  geo.ts            Bld: per-material geometry builder (box, slab, cyl, lathe, loft, strut, g); merge + SIMPLIFY at mount
  zfix.ts           z-fighting fix pass (run once per built unit)
  materials.ts      shared per-team "uber" material, role rows (kit.*)
  surface3d.ts      triplanar surface skins (layers, L0/L1/L2 tables)
  weapons3d.ts      buildTurret: rig groups, sizing, family dispatch (W25 families first)
  weapons/          wkit.ts (barrel, mechHousing, finishHousing, helpers), w2500.ts (families), legacy guns/launchers/...
  chassis/          registry.ts (READ ITS HEADER), one builder per shape/id, shapes.ts + hs-kit*.ts helpers
  mobility/         legs.ts (biped / spider / bug legs, legStance), tracks.ts, wheels, hover, ...
src/shared/mountgeo.ts   mount points shared with the sim (MOUNT_PTS / FOOT_MOUNTS / PART_SHAPES)
src/client/render3d/     game renderer: units-adapter.ts (instanced rigs from a template unit), UnitStage3D.ts (garage)
```

- Frame: +x = nose / muzzle, +y up, +z right; 1 cell = 1 unit.
- Turret rig groups: `yaw` (traverse) > `pitch` > `recoil` > `spin`; static parts merged per material per group
  (`C.b` yaw, `C.p` pitch, `C.rc` recoil, `C.sp` spin). `C.muzzle(x,y,z)` adds a muzzle point; the game fires
  effects from the muzzle's world position.
- **Weapon size belongs to the weapon, never to the hull** (units3d `DRAW_D`): one drawn housing diameter per
  size class, the same on every hull, main gun or not: S 0.75, M 1.5, L 3.0, XL 5.25 cells (each class twice the one
  below, XL 1.75x L: classes must read apart at a glance; titans are built round guns this big) (calibre moves it a
  little inside the class: sqrt of weaponD / slotD). The same gun is the same size everywhere, so players read
  weapons by size. A hull gets its integrated look by being designed round its biggest slots (its 1-2 main weapon
  slots, which are the bigger classes) with everything else fitting round them, NOT by inflating the main gun.
  The weapon body's armour level (`C.arm`) also follows the size class only.
- **Weapon cap**: a hull carries at most `weaponCap` weapons (parts.ts: sizes 1-3 two, giants three, titans four);
  its other sockets take utilities / armour / shields, which are drawn as compact add-on modules (0.6 x the class
  size, at most 1.2 cells), never turret-sized. Design a hull round its 1-2 biggest weapon sockets (its main weapon
  system) plus the rest of its cap; the fit audit arms the biggest sockets up to the cap and fills the rest with
  utilities. Aircraft keep their own hardpoint
  scale. Never rescale a weapon per hull (no hero boost, no shrinking to fit: fix the layout / mounts instead).
  The housing is exactly `DRAW_D` (buildTurret `drawD`); only barrels vary (bore from calibre, length per weapon),
  all on one drawing scale `DRAW_K`. No hull-based barrel stretch either.
- **The hull follows its guns**: a hull must be big enough for the class housings it carries (an M housing is 1.5
  cells, so an M-carrying hull is >= 2 cells wide). Resize the footprint in `parts.ts` when it isn't (the art box may
  not overhang the footprint: a test enforces it); carriage, longarm and hunter went from 1 to 2 cells wide for this.
  Audit: fill every hull with typical weapons and check housing overlap / housing vs hull width.
  `node scripts/3d/weapon-size.ts` prints every weapon's rest-pose box at its class (width / height as a multiple of
  `DRAW_D`; most guns are ~0.6-1.0 wide and ~0.3-0.6 tall): keep side parts (wings, fins) inside the housing's width
  and launchers low (the 16-cell battery lays its cells 2 high, the cruise / nuke missile lies nearly flat in its
  cradle) instead of scaling the weapon.
- **Pods**: on ground hulls with S <= 3 whose shape is not in PART_SHAPES, secondary weapons ride the hero's yaw
  group as pods (`Turret.host`, aimed with `aimPod`, +-0.4 rad of their own). The chassis builder only receives the
  hero (and utilities) in `c.mounts`.
- **Where a gun is drawn is where the sim fires it from.** `shared/mountgeo.ts` `drawnSeats(design)` is the one
  placement both sides use: hero pick (biggest `weaponD`), hero into the primary seat, pods, clash relocation, with
  `DRAW_D` and `TORSO_HULLS` kept in shared code so the server's sim sees the same data. `fireOffsets(design)` turns
  it into firing points (a pod sits on its hero's flank, `podSeat`); the battle sim (`battle.ts`) and the range tools
  (`fieldtools.ts`) use it, the 2D art keeps `mountOffsets`. Torso hulls place guns in their own builders, so their
  firing points come from `TORSO_SEATS`, measured from the 3D build by `scripts/3d/torso-seats.ts` (keyed by role or
  by slot, whichever the builder places by). **After changing a torso builder's hardpoints, re-run that script and
  paste its table** (`node scripts/3d/torso-seats.ts`, ~5 min; `ONLY=titan` for one hull). Check with
  `node scripts/3d/mount-drift.ts` (`RAND=1` for every hull with random fits; flags weapons > 0.5 cells off) and
  `test/firepoints.test.ts`. An empty garage socket is drawn where a gun put in it would sit (`slotSeat`).
- **Mech torso mode** (`ChassisOut.torso`): the chassis builds the upper body into the hero's yaw group, so torso
  and weapons twist together (a mech, not a turret on a box). It returns weapon hardpoints in the yaw frame:
  `hp[0]` = hero trunnion (its pitch group moves there), `hp[1..]` = pods; `at` moves the twist pivot. units3d
  drops the hero's ring / yoke / pod brackets; weapons keep their class size. The torso group is tagged `userData.torso` so the
  garage socket / highlight skips it. Example: `raider` in `chassis/mechframes.ts`. Declare the chassis with
  `registerTorso(id)` (registry.ts): then ALL its secondary weapons ride the torso as pods at your hardpoints, and its
  utilities / armour / shields ride it too (they turn with the torso: place them with `up[j]` for each `utilR[j]`, else
  units3d spreads them over the back of the torso's top; they are never seated on the static lower body)
  (weapons: any size, any anatomy, up to 6), so the sim's mount table no longer decides where a gun is drawn: design the
  hull, housing and hardpoints round the fixed-size weapons, never the other way round.
  Big hulls use it too (arachne mantle, broodmother howdah in `giants.ts`): `chassis/torso-kit.ts` `torsoSlots(c)`
  tells which design slot is the hero and which slots ride as pods (so the torso builds a sponson / arm only for armed
  slots), `torsoHP` turns a per-slot base table into the hp list. Lay the slots out in world cells round the class
  housings (XL 5.25, L 3.0, M 1.5: centre distance >= 0.9 x the radii sum, or stack them in tiers with clear air between
  housings), and keep the static body under the torso's sweep low (raise the swivel on a neck if an abdomen / knees
  would cut through it). The torso takes the hull's surface skin (skins.ts), not the turret's (no collar hazard bands).
  Titans use it too, each round its main gun: the Titan Walker (`titans.ts`) carries the XL on a right-shoulder
  saddle (a titan fist hangs as a right arm instead), the L as its left forearm; the Lance (`titans-lance.ts`) is the XL
  laid in a long keel between two trunnion cheeks with a command tower at the breech; the Monolith
  (`titans-monolith.ts`) twists its whole casemate, the L lying in a slot cut into its front between two shield horns.
  `titans.ts` `shiftTo(t, pivot)` wraps the torso Bld so the upper body is authored in hull coordinates (one builder for
  the torso and for the static fallback when there is no torso: all-utility fits, flyers). Utilities stay static: seat
  them outside the torso's sweep (or the fit audit flags them against the hero's yaw origin).
  More examples: the walkers in `chassis/walkers.ts` (strider, mantis, arachnid; shared `torsoOut()` helper, which
  also builds the torso static when a fit has no weapon so all-utility fits still have a body).
  Torso lessons:
  - `hp[0]` is the hero's PITCH point, `hp[1..]` are the pods' YAW origins: a pod still has its own black turret ring
    (now a slim octagonal swivel well, 0.5 r: S ~0.38 cells wide, M ~0.75 wide) and its trunnion sits ~0.16 (S) / 0.27-0.47 (M) above it.
    A ring standing on a narrow forearm reads as a "disc on a box": sink it instead. Put the pod's yaw origin ~0.4 r
    below the top of a forearm / shoulder bay / cradle at least 1.5-1.7 r across, so only the ring's lip shows, and give
    the hero a matching lip so paired guns sit alike (arachnid).
  - Two S guns cannot sit side by side on a 1-cell hull (2 x 0.75 + a body): put them on the centre line one behind
    the other instead (mantis: chin gun under the head, second gun on a dorsal hump).
  - Arm guns: trunnion just outside the chest flank (z ~ 0.3 + 0.78 r), the chest narrow at gun height and the
    shoulders / pauldrons widening above the gun (strider): top-heavy without the gun clipping the body.
  - Utilities stay static at their own mounts while the torso twists. Put the twist pivot (`at`) right under a utility
    socket so its module stays on the torso's axis (crab: pivot under the light slot, the rig on the crest), or carry
    the utility on a static frame above the torso's sweep (aegis: a rear gantry over the gun's breech); only fall back
    to a mast / stub at the mount (walkers, warlord arm slots).
  - Even single-gun vehicles use torso mode when the gun's surroundings must turn with it: a field gun's shield and
    trunnion cheeks (carriage), a casemate's gun walls (juggernaut). An M housing is ~1.6 cells long: anything static
    within that radius of the pivot and above the deck clips the breech when the gun traverses.
  - Flying titans: a titan-class GROUND hull on air mobility (gravlift / jet; units3d `liftedTitan`) is not an
    airframe. Its weapons keep their DRAW_D class size and turn (no 1.1 hardpoint scale, not `fixed`), and a torso hull
    keeps torso mode exactly as on the ground (hero at class size, pods on its yaw, utilities riding the torso). The
    chassis builds its non-legged lower body and returns `ChassisOut.lift`: `titanLift` (hs-kit-titan.ts) hangs
    outrigger grav nacelles / stern thruster cans off the hull; the citadel puts grav emitters under its bastions and
    towers. Smaller flyers and air-domain hulls keep the aircraft hardpoint scale.
- **Mount points are shared with the sim** (mountgeo.ts). You may move a chassis's mounts when the anatomy needs it
  (keep them inside the footprint, keep count and classes, run the mountgeo / turretseat tests). The old 2D
  footprint art (`render/footart.ts`) still draws from them.
- The game (`render3d/units-adapter.ts`) builds one template per (design, team) and instances it; nodes under a
  turret's groups are dynamic. Anything you hang under a turret group moves with it.
- The garage socket rings (`UnitStage3D.buildMounts`) use the weapon's OWN parts only (not pods riding it, not a
  torso) and sit over the trunnion when a weapon hangs off a torso. Keep that in mind when you add parts to a yaw
  group: tag non-weapon parts (`userData.torso = true`).

### Legs
`mobility/legs.ts`: biped thighs / shins / feet (`hsThigh` / `hsShin` / `hsFoot`) are layered armour segments over
a dark core, big hip / knee drums, bright rams, stepped feet. `legStance`: biped `hipY = 0.56*m + 0.14` (tall
stance: thigh and shin both read), bones 1.12x the hip height so the knee always bends forward. Chassis that place
their own hips (`ChassisOut.hips`) set the leg height: hips set too low make short stubby legs.

- **The tug of war castle** (`chassis/castle.ts`, design id `tug-castle`: a Monolith on an anchor in the sim) is its own
  model: the side's mothership set down for good as a forward base (wedge carrier hull on four splayed landing legs,
  bow ramp down as the gate, folded wings planted as rampart walls, cooling engines, an off-centre command island, the
  glowing reactor ring on the spine as the thing worth defending, a camp of crates and fuel tanks). It is drawn 15%
  past its 7-cell footprint (the drop zone keeps a clear ring round it) and builds its own footing (`ChassisOut.ownGround`
  skips the anchor's plinth). It swaps its one gun during a game for any weapon of any class, so its gun cupola is the
  one housing that follows the gun: radius / height from the gun's `DRAW_D` (S ~0.6 .. XL ~3.2 cells), on a raised
  drum for big guns. The gun keeps its class size. proto3d lab: `castle:anchor:0:<gun>|-`; the zfight scan covers it
  with a gun of each class. Everything round on it is really round (36-point hull sections, 40-48 segment lathes,
  lathed tori for glow rings, continuous skin-following glow bands instead of strut chains), and it opts out of the
  default simplification (`Bld.simp` 0.0008, see section 3) and of the far LOD build: ~25-28k tris.

---

## 3. Triangle budgets and mesh simplification

- Budget per unit incl. weapons and gear: **S1 <= 15k, S2..S5 <= 30k** (registry.ts). Spend it on shape (bevels,
  layered plates, smooth curves), not greebles.
- **Every merged mesh is simplified at mount** (`geo.ts`, meshoptimizer):
  1. weld vertices per part (exact position + part id `mid`, so parts / colours never merge),
  2. `MeshoptSimplifier.simplify` down to a geometric error of `SIMP` x the mesh's extent (default **0.004**),
  3. rebuild normals with a **40 deg crease angle** (hard edges stay hard, curves stay smooth), un-index.
- Result: about **1/3 fewer triangles** across the roster (311k -> 208k). Not 1/4 of the original: the models are
  hard-surface, so most triangles are hard edges and bevels that ARE the detail. Measured:
  - keeping every hard edge as a seam: only 14-23% saved;
  - welding by position and letting the error decide: 0.003 -> 0.72, 0.005 -> 0.60, 0.008 -> 0.44;
  - 0.005 erased a thin support under a helicopter pod (turretseat test failed); 0.004 is the safe default.
- Knobs: `setSimplify(err)` (geo.ts), `?simp=<err>` / `?simp=0` on proto3d.html for before / after renders.
  `scripts/3d/tri-budget.ts` prints roster totals at several errors.
- The error is relative to each merged mesh's extent, so a large hull loses the most curvature: on the 8-cell tug castle
  0.004 turned 40-segment circles into ~9-gons. A builder can lower it for its own meshes (`Bld.simp`).
- Weapons self-reduce detail on big units (`detail()` in w2500: S3/S4 ~0.6 segments, S5 ~0.5).

---

## 4. Z-fighting (flicker)

Symptom: "two solids colliding and overriding each other's texture in spots", flickering as the camera moves.
Cause: faces of different parts in exactly the same plane, facing the same way, overlapping (a glow strip laid
flush on a plate, two blocks sharing a face, a collar flush on a deck). The depth test can't pick one.

- `zfix.ts` runs on every built unit (units3d, after assembly): buckets all triangles by world plane, finds
  overlapping pairs from different parts and lifts them apart 2 mm per step along the normal: in each plane the
  faces are sorted largest first and each sits one step above the highest overlapping face before it, so chains of
  three or more stacked parts (megatracks' track pods) all get distinct heights in one pass; it repeats until nothing
  moves (max 4). Every starter scans at 0 pairs.
- Still author cleanly: inset or proud details by a visible amount instead of exactly flush.
- Check: `node scripts/3d/zfight-scan.ts` (expect 0 or a few tiny pairs per design).

---

## 5. Workflow

1. Look at the references (docs/inspo, research). Write down the concept per hull in one line: what carries the
   weapon, the silhouette from the side and from the top.
2. Build: `npm run build:proto3d` (writes `public/proto3d.js`, which IS committed: rebuild and commit it with your
   changes). Serve: `cd public && python3 -m http.server 8766`.
3. Render several views in one browser session with `scripts/3d/shots.cjs` (see its header). Always look at:
   a close 3/4 front at low tilt (10-25 deg), the back, the top-down (tilt ~80), and **game zoom** (d ~ 14-22,
   tilt ~57). Make a contact sheet (PIL) and actually look at it. Iterate until it is genuinely cool, then compare
   with the reference images side by side.
4. Check the garage too: `scripts/3d/garage-shots.cjs` (socket rings on the weapons).
5. Checks: `npx tsc --noEmit`; `node --test test/turretseat3d.test.ts test/mountgeo.test.ts` (floating turrets,
   mount geometry); `npm test` before pushing. The sim test "120v120 stays fast" is timing-based and fails on a
   loaded machine (parallel agents rendering): re-run it on a quiet machine before blaming your change.
6. Budget: `node scripts/3d/tri-budget.ts` / the tri count `shots.cjs` prints; flicker: `scripts/3d/zfight-scan.ts`.

### Pitfalls
- `lathe` does not close open profiles: add the closing point (e.g. `[Ri, 0]`) for hollow shapes.
- swiftshader renders take minutes under load: load once with `&freeze=1` and call `renderOnce()` per view
  (shots.cjs does), use long timeouts, never one browser per view.
- Camera framing: pass explicit views (`setView(x, z, dist, tilt, yaw, targetY)`); the default framing crops big
  units.
- Torso mode drops the hero's own yaw base (ring / lower housing) but pods keep theirs: when the hero and a pod stand on
  mirrored stations (saucer sponsons), model a base block under the hero's station so both guns look alike, and put
  the hero's hardpoint at station + its trunnion height (~0.38 r for guns, ~0.62 r for launchers / melee).
- Many same-class guns on a narrow hull: stagger them (centipede: alternate sides 0.6 cells off the centreline, cars
  0.71 apart) and step their heights toward the rear (superfiring) instead of shrinking or overlapping them. Mounts
  riding animated parts come from the 2D rig (footart footParts) via PART_REST: change the rig, regenerate PART_REST
  from layoutOf, run test/mountgeo.test.ts.
- Titan footprints: the sim's gather margin (battle.ts MAX_RADIUS) is the biggest hull's bound, and a non-square
  footprint's bound is its full diagonal (a square one is just its side): enlarge a titan to a SQUARE footprint
  (citadel 10x10, like the arachne) so the margin does not grow. A hull's hardpoints and drawn L/W follow its art box
  (`ChassisDef.art`), so lay the anatomy out in art-box cells. Twin XL side by side need ~5.2 cells between centres:
  the citadel's two 5.25 housings ride two 2.3-radius bastion drums all but touching on the centreline, and its keep
  is tall enough that the giant gun superfires over them. In torso mode the hero's own body is narrower than DRAW_D
  (the titan gun's pitch group is ~3.5-4 wide): measure it (`Box3` of `turret.pitch`) and lay the cradle round that.
- Parallel agents: give each its own git worktree and render port, a written brief (concept rules + references +
  workflow), and tell them which shared files they must not touch. Merge their branches one at a time, re-run the
  tests, rebuild the bundle.

---

## 6. Feedback history (what the user asked for, in order)

Brighter explosions / fire / sniper shots / tracers -> replace the "electro" skin (high-tech + dull-metal skins) ->
hulls must be assemblies of distinct parts -> weapons too small: the main weapon must dominate, weapon locations
designed into each hull -> no turret ring overhang -> weapons year 2500, hollow barrels, length by calibre ->
integrated weapon housings sized by chassis -> each unit built around ONE weapon system, extras ride it ->
railgun: real rails, sizzling energy, wings -> denser, cooler weapons; legs like real mech legs; hulls integrated
and vertical; not low-poly; 30k budget and simplification -> flat hulls should become vertical bodies / mechs,
diverse, built around their weapons -> research real mech games (War Robots, Star Wars, BattleTech): look cool,
deadly, imposing -> fix flicker and garage sockets -> write all of this down (this file) -> the same weapon must be
the same size on every hull (size by class), hulls integrate by designing round their 1-2 main (bigger) slots.

---

## 7. Firing effects match the guns

- Effect size per class follows the drawn gun ratios (`FieldView3D` `CLASS_S` S 0.3, M 0.6, L 1.2, XL 2.1): a titan
  gun's flash, round and blast are as big as the gun. Rounds are as wide as the drawn barrel (`drawnBore`).
- Visible ammunition is built into `C.am` (warhead tips in launcher cells, the missile on a cruise / nuke erector,
  bombs on a rack): it becomes `Turret.ammo`, and the game hides it when the weapon fires (`Rig.spent`) until the
  weapon has reloaded (its cooldown / reload). Any new launcher family must put its rounds in `C.am`, not `rc`.
