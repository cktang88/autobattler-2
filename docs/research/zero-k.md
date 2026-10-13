# Zero-K research for Ironclad Assembly

Source: https://github.com/ZeroK-RTS/Zero-K, commit 48e99d8 (cloned 2026-10-13, blobless sparse clone at `/home/user/research/zero-k`).
Weapons live inside `units/*.lua` (`weaponDefs`), effects in `effects/*.lua` (CEGs), textures in `bitmaps/`, slow/EMP/area-damage logic in `LuaRules/Gadgets/`.

## 1. License verdict

| Thing | License | Evidence |
|---|---|---|
| Code, Lua defs, numbers, effect definitions | GPL v2 or later | `LICENSE` is GPLv2; `legal.txt`: "Unless otherwise specified everything in this project is released under the GNU General Public License or Public Domain" (GPLv2 or later); gadget headers say `license = "GNU GPL, v2 or later"` |
| `bitmaps/PD/*` | Public Domain (by folder name) | `legal.txt` + folder naming; no per-file notes |
| `bitmaps/GPL/*` | GPL v2+ (by folder name) | same |
| `bitmaps/CC/*` | "CC", variant unspecified. `bitmaps/CC/bar_icexuick/` is explicitly **CC-BY-NC-ND** (made for Beyond All Reason) | `bitmaps/CC/bar_icexuick/license.txt` |
| `bitmaps/Other`, `Unknown`, `Saktoths` | unclear | no notes |
| 3D models (`Objects3d`), `EoWcredits.txt` | "flex rights", transferable to CC-NC, CC-SA, GPL or PD, credit required | `EoWcredits.txt` |
| Sounds/music (`sounds/music/*`) | per-folder `license.txt` | not examined, not needed |
| AI policy | `ai_policy.md` is only about contributions to their repo | irrelevant to us |

There is no per-file author attribution for the bitmaps anywhere in the repo.

### What we may reuse

1. **Ideas, mechanics, numbers, color palettes, particle parameters**: free. Game mechanics are not copyrightable and re-implementing them in TypeScript from scratch is not a derivative of the Lua. Copying Lua code verbatim would be GPL; we do not need to.
2. **`bitmaps/PD/*`**: no obligation. Copied 21 files to `public/assets/zk/pd/`.
3. **`bitmaps/GPL/*`**: allowed with GPL obligations (keep GPL notice, point to source, mark modifications, provide license text). Whether it forces the whole game to GPL is a gray area; to be safe we copied them to a **separate** folder `public/assets/zk/gpl/` (17 files) that can be deleted with no code impact. If the game ships under a permissive or proprietary license, delete `gpl/`; if it is GPL, keep them and ship the GPL text.
4. **Do NOT use**: `bitmaps/CC/*` (NC-ND forbids use in anything but unmodified non-commercial form; variants unknown for the rest), `Other`, `Unknown`, `Saktoths`, models, sounds.

Details and per-file origin: `public/assets/zk/README.md`. Total size about 550 KB (PNG, max 256 px). Textures are mostly greyscale/additive sprites: draw with `globalCompositeOperation = 'lighter'` and tint via an offscreen canvas or `ctx.filter`.

## 2. Units and conversion

Zero-K: range/AoE in elmos, `reloadtime` in seconds, `weaponVelocity` in elmos/s, particle lifetimes in 30 fps frames, sizes in elmos.
Suggested conversion to our units: **cells = elmos / 50** (Glaive 185 = 3.7, Phantom 700 = 14, Lance 980 = 19.6, clamp to 18). AoE radius in cells = `areaOfEffect / 2 / 50` (AoE is a diameter; Reaver 96 = ~1 cell radius). Seconds map 1:1. Projectile speed cells/s = velocity/50 (Glaive 500 = 10).
Particle frames to seconds: /30. Particle `size` elmos to canvas px: size * (cellPx / 50).

Slow / EMP / disarm systems (read from gadgets, directly portable ideas):
- **Slow** (`unit_timeslow.lua`, `timeslow_defs.lua`): hits add `slowDamage` (= weapon `timeslow_damagefactor` x damage, or `timeslow_damage`). Slow fraction = slowDamage / current HP, **capped at 0.5** (units never lose more than 50% speed AND fire rate); starts decaying 0.5 s after the last hit at 4% of current HP per second. So slow is relative to target health: big slow hits cripple fragile units fully, barely nudge tanks.
- **EMP/paralysis** (`unit_paralysis_damage.lua`): `paralyzer` damage accumulates vs unit HP; when it exceeds HP the unit is stunned for the overflow (`paralyzeTime` is the max stun, 40 s to decay 100%). `extra_damage` on lightning = EMP damage added to the normal damage (Knight 230 + 720). Stun disables move, fire and abilities.
- **Disarm**: `disarmDamageMult`, `disarmTimer` (s): hit adds a timer (Racketeer 6 s, Thunderbird 16 s); target cannot fire but can move. `disarmDamageOnly=1` means it deals no HP damage.
- **Impulse** (`impulseFactor`, `weapon_impulse.lua`): knockback proportional to damage; negative = pull (Likho -0.8, Black Hole -2.5). Jugglenaut/Newton gravity guns use `impulse = +/-150` per tick of 6-shot bursts, damage 0.
- **Area damage** (`weapon_area_damage.lua`, `area_damage_*`): lingering ground zone: radius, dps, duration; used for napalm (Firewalker 64 radius, 19 dps, 16 s), the Zeno slow field (320 radius, 190 slow dps, 30 s), black hole.
- **Capture** (`unit_capture.lua`, Dominatrix `CAPTURERAY` 22/tick, 450 range): captured HP accumulates; at full the unit changes team, and "capture linger" keeps partial progress.
- **Shield** weapon (`weaponType=Shield`): `shieldPower` 900-3600 (19400 Funnelweb), radius 80-550 elmos, bubble absorbs projectiles that enter, regenerates; Felon's lightning "Shield Gun" pays `shield_drain = 78`/s from its own shield charge while firing.

## 3. Weapon survey: Zero-K -> mechanics -> our modules

Zero-K dps = damage x projectiles x burst / reload. "Our match" = closest existing id in `src/shared/parts.ts`; "NEW" = no equivalent. Ranges already converted to cells.

| Zero-K weapon (unit) | Mechanics (raw) | Approx dps | Range (cells) | Our match / gap |
|---|---|---|---|---|
| Pulse MG (Glaive) | 3-round burst 10.5 dmg each / 0.3 s, spray 1180, velocity 500, yellow `1 .95 .4` | 105 | 3.7 | `hmg`/`ac20` (we lack the tight burst feel: ok) |
| Heavy Pulse MG (Reaver) | 3x45 / 0.5 s, AoE 96 (~1 cell), yellow | 270 | 5.4 | `minigun` + splash; **NEW**: MG with splash |
| Impulse Cannon (Ripper) | 250 dmg, AoE 144, impulseFactor 0.6, reload 1.8, vel 750 | 140 | 5.7 | **NEW: knockback** |
| Heat Ray (Scorcher / Desolator / Dante) | Scorcher: 30 dmg every 0.1 s = 300 dps, range 262, damage **falls off with range**; Desolator 51 x2 | 300 | 5.2 | `heatray` (has falloff) ok; ZK beam is a short-lived tracer stream |
| Laser Blaster (Bandit / Welder) | 8.5 dmg / 0.1 s, red tracer, vel 870 | 85 | 4.6 | `laser` |
| Mace laser (Mace) | 32.65 dmg / 0.1 s continuous green beam, range 345 | 326 | 6.9 | `twinlaser` + sweeping beam |
| Lance / Tachyon Accel. (Lance, Lucifer, Paladin) | 3000-4000 dmg beam, 1 s charge-and-fire duration, reload 23 / 10 s, thickness 17, violet `.25 0 1`, range 980-1200 | 130 / 400 | 19.6-24 | `railgun` is close, **NEW: charged sustained beam, applies damage over 1 s** |
| Pulsed Particle Projector (Phantom sniper) | 1500 dmg, reload 17 s, vel 850, red `1 .2 .2`, size 5 | 88 | 14 | `sniper` (we are lower dmg/faster) |
| Gauss (Dagger/Gauss turret/Detriment) | 110-200 dmg, vel 2200, `single_hit` pierce, teal `.5 1 1`, size 0.8, cooldown 2-2.7 | 50-95 | 4-11 | `gauss` ok; ZK has burst of 3 on Detriment |
| Rocket (Ronin) | 180 dmg, AoE 48, vel 200 accel 200, range 455, reload 3.5 | 51 | 9 | `rocketL`/`atgm` |
| Rocket Volley (Recluse) | 3x135 burst, reload 4, tracking none, range 570 | 100 | 11 | `rockets` |
| Heavy Rocket (Rogue) | 330 dmg AoE 96, reload 7, indirect-ish | 47 | 10.6 | `rockets`/`mortar` |
| Missile (Scalpel/Picket/Magpie) | homing, 104-320 dmg, turnRate high, flightTime 3-5 s, trail yellow | 85 | 8-13 | `atgm`/`sam` |
| Banisher heavy missile (Ogre) | 240 dmg AoE 160, impulse 0.6, **reload 0.3 s** (fires continuously), range 320 | 800 (Ogre is 1950 HP) | 6.4 | `rockets` x10 rate: **NEW: rapid-fire AoE riot** |
| Napalm Rocket Salvo (Dante) | 10x2 rockets 150 dmg AoE 168, burning zone 17 dps for 3 s | burst | 9 | `incendiary` |
| Napalm Mortar (Firewalker) | 10 shells x68, AoE 128, range 900, reload 12, ground fire 19 dps 16 s r64, burn 60 | 57+fire | 18 | **NEW: persistent fire zone** (we only have on-hit burn) |
| Napalm Bombs (Phoenix) | 18 bombs x40, AoE 320, reload 1, spread 15000, burn 360 | bombing | n/a | **NEW: carpet bombing** (bomber) |
| Flame Bomb (Kodachi) | 40 dmg AoE 96, ground fire 43 dps 1.6 s | 80 | 4.2 | `napalm` |
| Flamethrower (Pyro/Dante) | 9 dmg / 0.133 s, 240-340 range, 40% burn chance | 70 | 4.8-6.8 | `flamer` (Dante's reaches 6.8: longer than ours) |
| Tremor (Tremor) | 145 dmg AoE 140, **reload 0.333 s**, range 1160, terrain deform | 435 | 23 | `barrage` but continuous: **NEW: rapid saturation artillery** |
| Emissary / Envoy / Shogun / Plasma Battery | 600 dmg AoE 84-96, reload 7 s; Shogun 3x501 burst; Plasma Battery 3x601 AoE 192 range 1850 | 85-250 | 23-37 | `howitzer` (clamp range to 18) |
| Light Plasma (Sling, Thug, Hermit, Ravager) | 140-210 dmg AoE 32, vel 245-280, reload 2-6, light orange trail | 35-105 | 5.6-17 | `cannon75`, `mortar` |
| Disruptor Pulse Beam (Moderator / Bolas / Dart / Viper) | beam, damage 32-460 + **slow damage = dmg x factor (1.7-5.5)**, purple `.3 0 .4`, thickness 8-16 | 32-46 | 3-8.4 | `slowbeam` (ours is continuous; ZK is a pulse with burst slow) |
| Sunlance | 1400 dmg + 2500 slow dmg every 4 s, range 750, thickness 16 | 350 | 15 | **NEW: heavy slow + damage pulse** |
| Slowing Beam (Cyclops, Commander) | 2000 slow-only dmg, reload 2.5, range 440, no HP damage, coreThickness 0 | 0 | 8.8 | `slowbeam` heavy variant |
| Zeno slow missile | 10000 slow, area slow field radius 320, 190 slow-dps, 30 s | 0 | long | **NEW: slow field (zone)** |
| Lightning Gun (Knight/Blitz/Scorpion) | 180-360 dmg + `extra_damage` EMP (500-1080), 1 s paralyze, reload 2-2.6, lightning arcs spread, range 245-490 | 90-140 | 5-10 | `tesla`/`arclance` |
| Electro-Stunner (Faraday/Venom/Gnat/Widow) | paralyzer only: Faraday 1100 dmg AoE 160 stun 2 s r 460; Venom 65+400 EMP AoE 128; Widow 8000 EMP = 30 s stun | stun | 2.4-9 | `stungun`/`empcannon`; **NEW: stun-over-HP rule** |
| EMP Bomb (Imp) / EMP Missile | suicide AoE 352, 2800 paralyze 16 s | n/a | n/a | **NEW: suicide EMP unit** |
| Disarm missile (Racketeer / Reef / Cutter) | 2500 disarm dmg, disarmTimer 6 s, no HP damage, range 940, reload 10, AoE 24 | 0 | 18 | **NEW: disarm** |
| Lightning Bomb (Thunderbird) | 80 lightning bolts, disarm 16 s, AoE 160 | n/a | n/a | **NEW: area disarm** |
| Capture Ray (Dominatrix) | 22 per tick (1/30 s), range 450, green `0 .8 .2` | n/a | 9 | **NEW: capture / hijack** |
| Gravity guns (Newton, Jugglenaut) | 6-shot bursts every 0.2 s, impulse -150 (pull) or +150 (push), 0 dmg, range 440, blue/red beam | n/a | 8.8 | **NEW: push/pull** |
| Black Hole (Placeholder) | slow ball, AoE 300, impulse -2.5 + area_damage_dps 5600 radius 70 for 13 s | n/a | 9.5 | **NEW: gravity well** |
| Implosion bomb (Likho) | 2000 dmg AoE 192, impulse -0.8 (pulls in) | n/a | n/a | **NEW: implosion** |
| Shield Gun (Felon) | 94 lightning per 0.166 s, uses its own shield charge 78/s | 566 | 8.7 | **NEW: shield-fueled weapon** |
| Energy Shield (Thug 1200, Felon 1800, Aspis 3600 big area, Funnelweb 19400) | bubble, radius 80-550, absorbs projectiles | n/a | n/a | `shield` (ours is personal; area shield = NEW) |
| Sonic Blaster (Archer / Siren / Morningstar) | ~155-175 dmg, AoE 128-200, pushes, impulse 0.5, reload 1.1, expanding cone, rgb `.2 .6 .8` | 150 | 5-6 | **NEW: cone shockwave** |
| Shotgun/Flechette (Scallop, Corsair, Punisher) | 3-4 pellets x23-28 yellow, spray 1800-2400 | 100 | 5-6 | `shotgun` |
| Scatter Beam (Trisula) | 9 beams x40, spray 1640, reload 4, range 360 | 90 | 7.2 | **NEW: multi-beam fan** (we have pellets only for bullets) |
| Anti-air Cluster: Hacksaw | 70 (x10 vs air) homing, reload 0.2 | 3500 vs air | 9.8 | `aamissile` (we lack ultra-fast AA burst) |
| Chainsaw / Artemis | homing AA, range 1800-2400 (36-48), 225-1600 vs air | n/a | clamp 18 | `sam` |
| Flak (Ettin, Thresher) | 9-13 dmg x10 vs air, AoE 64-128, vel 2000, reload 0.4-0.5 | 330 vs air | 18 | `flak`/`heavyflak` ok |
| AA Laser (Razor, Gremlin, Toad) | 1.5-2 dmg vs ground, ~15-20 vs air, 0.1 s, cyan / red tracers | 150 vs air | 14-20 | `quad20` |
| Cluster Bomb (Krow) | 75 bomblets x250 AoE 128 spray 13500, reload 30 s manual fire | n/a | 4 | **NEW: cluster salvo** |
| Mine Layer (Dampener/Badger/Claw) | drops mine units 20 dmg then spawn 34x5 bomblets, expire 60 s | n/a | 6-15 | **NEW: mines** |
| Obliteration Blaster / Starlight / Disco Rave | superweapons: 1200 dmg x10 pulses, 8800-10500 range | n/a | n/a | skip |
| Torpedo / Depth Charge | water only | n/a | n/a | skip (no water) |

## 4. Gaps in our catalog and suggested modules (our units)

Current catalog covers: MGs, autocannons, cannons, sniper/rail, rockets, missiles, artillery, energy, flame, tesla/stun/slow/EMP, flak, shield/repair. Missing mechanics (all are Zero-K identity mechanics):

| # | Mechanic | New fields (ModuleDef) | Suggested module (dps / range / numbers) |
|---|---|---|---|
| 1 | **Knockback/impulse** | `impulse: number` (cells of push per 100 dmg, scaled by target weight) | "Riot Cannon" (Ripper): M mount, dmg 90, splash 1.4, cooldown 1.7, range 5.5, push 1.2 cells (halved by chassis size 2, quartered at 3). Plus "Sonic Blaster": L/M, dmg 60, cone 60 deg, range 5, push 0.8 |
| 2 | **Gravity pull / push** | `impulse` negative, `damage:0` | "Gravity Projector" (Newton): M, 6 short ticks/s, pull 3 cells/s toward emitter or push away, range 8, toggled by sign (two modules: "Attractor", "Repulsor"); pairs with flamers/shotguns for combos |
| 3 | **Disarm (cannot fire, can move)** | `disarm: seconds` (new status next to `stun`/`slow`) | "Disarm Missile" (Racketeer): M, homing, 0 dmg, disarm 5 s (stacks to 8 s), splash 0.5, cooldown 8, range 15. "Disarm Mortar" L: range 9, disarm 3 s. Disarmed unit still moves and flees/charges |
| 4 | **Capture ray** | `capture: dps` | "Capture Beam" (Dominatrix): M, continuous, fills a capture bar = target max HP x 1; progress decays 5%/s when beam off; full = target joins attacker for 20 s (or permanently). Range 8, 22 pts/tick = 660/s. Block on bosses |
| 5 | **Shield drain / shield-fueled weapon** | `shieldDrain` (weapon costs shield HP/s), `vsShield` mult | "Shield Lance" (Felon): M, hitscan lightning 25 dmg x 6/s, range 8.5, costs 70 shield/s from own shield; 2.0x dmg vs shields |
| 6 | **Slow rules like ZK** | change `slow` to `slowDamage` relative to target hp, cap 0.5 | "Disruptor Pulse" (Moderator): M, beam pulse, 20 dmg + slow = 300 / target hp, cooldown 1.5, range 8; "Sunlance" H: cooldown 4, dmg 400 + slowDamage 2500 |
| 7 | **Persistent ground zones** (fire, slow field, acid) | `zone: {radius, dps, duration, kind}` | "Napalm Mortar" (Firewalker): H, 10 shells dmg 15 splash 1, leaves 3 s burning zone r1.3 at 19 dps; range 16, cooldown 9. "Slow Missile" (Zeno): H, 1 shot, slow field r6 for 12 s, range 18, cooldown 14 |
| 8 | **Charged sustained beam ("Tachyon")** | `chargeTime`, `beamDuration`, `beamWidth` | "Tachyon Lance" (Lance): H, 1 s charge telegraph (thin line), then 1 s thick violet beam dealing 420 total over duration; dps ~100, range 18, cooldown 8; hits everything along line |
| 9 | **Continuous sweeping beam** | `sweep: true` (target tracking lag; beam drags across the line) | "Sweep Laser" (Mace): M, dps 100, range 6.5, beam follows aim with lag; hits first unit it crosses; ammo hit-spreads over crowd |
| 10 | **Burst-fire sniper charge** | `charge`, `moveCancel` | "Phantom Rifle": L/M, 1500-equivalent single shot: dmg 260, charge 1.5 s with laser sight, cooldown 10, range 14, pierces 1 unit. Stationary while charging |
| 11 | **Rapid-fire AoE riot / saturation artillery** | no new field: reduce `cooldown` + splash | "Banisher Rack" (Ogre): H, rocket cooldown 0.4, dmg 40, splash 1.6, range 6.5, push 0.3; "Tremor": H artillery cooldown 0.4, dmg 28, splash 1.4, range 18, min 6 (very high spread) |
| 12 | **Cluster bomb / bomblet salvo** | `cluster: {count, spread}` | "Cluster Launcher": H arc, 1 shell splits at apex into 8 bomblets (dmg 25, splash 0.8, spread 3 cells); cooldown 7, range 12 |
| 13 | **Suicide / EMP-bomb chassis** | `onDeath: {aoe, stun, damage}` module "Payload" | "EMP Payload" (Imp): M, on death stun all within 4 cells 6 s, 1800 EMP; "Implosion Core": dmg 400 + pull 4 cells |
| 14 | **Mines** | `spawnsEntity: mine` | "Mine Dropper": L, drops a mine every 5 s, armed after 1 s, expires 20 s, 60 dmg splash 1 |
| 15 | **Area shield** | `shieldRadius` | "Area Shield" (Aspis): H, radius 5, absorbs 600, no personal shield; other allies' hit points shielded inside radius |
| 16 | **Multi-beam fan** | `pellets` for beam projectile | "Scatter Beam" (Trisula): M, 7 hitscan lines x 25 dmg in 30 deg cone, cooldown 3.5, range 7 |
| 17 | **EMP overflow rule** (paralyze vs HP) | stun = max(0, empDamage - target.hp * 0.? ) over time | Replace fixed `stun` seconds with EMP damage accumulating vs target hp; big units take long to stun, small ones instantly |

### Top 10 recommended (best value for an autobattler, implementation cost low to medium)

1. **Knockback/impulse** (Ripper, Sonic): readable on a top-down canvas; creates formation play.
2. **Disarm** (Racketeer, Thunderbird): a counter to a single big unit that does not kill it; trivial status flag.
3. **Slow relative to target HP with 50% cap** (Moderator, Cyclops, Sunlance): turns the existing `slow` into a real counter to heavies.
4. **Gravity push/pull** (Newton, Jugglenaut, Black Hole): pulls enemies into AoE or breaks formations.
5. **Persistent fire zone** (Firewalker, Kodachi): changes positioning after the shot.
6. **Charged sustained beam** (Lance/Lucifer): spectacular, telegraphed, one-shots mids.
7. **Capture ray** (Dominatrix): comeback mechanic with a visible bar.
8. **Shield-fueled weapon + shield drain** (Felon): couples support and weapon categories.
9. **Rapid-fire AoE riot rocket / saturation artillery** (Banisher, Tremor): just numbers, no new engine work.
10. **Stun as EMP damage vs target HP** (Faraday/Venom/Widow): scales stun to unit size; fixes `stun` stacking.

## 5. Visual effect recipes (2D canvas)

Zero-K sources: `effects/*.lua` (CEG = custom explosion generator). Particle system terminology: `colormap` = RGBA keyframes over lifetime (alpha is the 4th value, written as 0.01 for additive), `particlelife` = frames at 30 fps, `heatcloud` = expanding glowing ring/flash, `explspike` = streak spikes, `groundflash` = brief ground-level light. Everything is additive blending. In canvas use `globalCompositeOperation = 'lighter'`.

General rules derived from the files:
- Impact = 3 layers: **groundflash** (1-10 frames bright circle, radius ~ AoE), **heatcloud** (size 1->8 over ~10 frames), **sparks/pikes** (8-20 particles 7-15 frames, speed 1-4 elmos/frame).
- Tracers are cheap: beam = line with width `thickness`, inner core `coreThickness` fraction, linear fade over `beamTime`/`duration`.
- Ground-impacts spawn a smoke particle with `colormap 0.1 0.1 0.1 -> 0` over 20-50 frames.

### Per-family recipes

| Family | Projectile / beam | Muzzle & trail | Impact (frames @30 fps) |
|---|---|---|---|
| **Pulse MG** (Glaive, Reaver) | Tiny bright-yellow dot, color `#fff266` (`1 .95 .4`), size 1.75-2 px x ~3 length streak; spread cone ~6 deg | Trail `hmg_trail`: faint orange smoothtrail, `rgba(255,140,0,.1)` length 2.5x width 6, fades in ~10 frames | Reaver `EMG_HIT_HE`: groundflash r48 alpha .25 for 3 frames; heatcloud size 1 growing +8; 16 sparks `#fff280` life 10, size 2, speed 1; 3 smoke puffs yellow->orange->black over 10 frames |
| **Laser tracer** (Bandit, Swift, Razor) | Short bright dash color red `#ff0000` / cyan `#00ffff` (AA), width 2-2.5, core 50% white, length 40 px at speed 870-2200; AA laser lasts 15 frames fade | `laser_cannon_trail`: thin line trail | `BEAMWEAPON_HIT_RED`: flash r8-12 alpha .9 for 4 frames; 5 small red sparks life 7 |
| **Continuous beam** (Mace green `#00ff00`, Commander cyan `#00ffff`, Redback red, Krow `#0099e6`) | Line from muzzle to hit, thickness 3-5 px, 50% core | `flare` at muzzle laserFlareSize ~ thickness x 1.3; beam alpha fades over `beamTime` 0.1 s | green flash `flash1green` r12 alpha .9 ttl 4; sparks 6-8 |
| **Heat Ray** (Scorcher) | Stream of 2 overlapping tracers: `#ff1a00` outer (`1 .1 0`) and `#ffff40` inner (`1 1 .25`), thickness 3-4, `duration` 0.3 s each, fired every 0.1 s so it looks like a flickering rope | none | `HEATRAY_HIT`: cinder heatcloud size 5 (texture red explo), sparks 5 `#ffbf40`->black life 5-10, speed .5, gravity down; groundflash `#ff4000` r8 ttl ~64 alpha .5; 2 steam puffs delayed 1 frame |
| **Disruptor (slow) beam** | Purple `#4d0066` (`.3 0 .4`) -> `#8a0099` bright core, thickness 8 (Viper/Dart/Bolas) to 16 (Sunlance); visible for `beamttl` 0.5-1.7 s fading | none | `flashslow` / `heavy_disruptor_beam_hit`: heatcloud `pinknovaexplo` 3 puffs size 5 growing +3 life ~8; 20 pink sparks `#ff40ff`->dark life 20 speed .6; 7 spikes `#ff40ff` length 17 growing +5 width 3 fade .06/frame; groundflash purple r25 ttl 10 alpha .5 |
| **Lightning** (Knight, Blitz, Venom, Widow) | Jittered polyline with 8-12 segments, midpoint displacement ~ 15% length, width 2-3 px, color `#8080ff` (`.5 .5 1`) for damage, `#ffff40` (`1 1 .25`) for pure EMP, duration 8-10 frames, re-jitter every 2 frames | none | `lightningplosion`: 15 spikes `#8080ff` length 30 width 5, alpha .8 fade .1/frame; bluebolts delay 3 frames; 20 mini storm bolts randomly delayed within 200 frames in a r100 circle (for AoE); groundflash `#8080ff` r86 alpha .3 ttl 12; yellow variant `#ffff40` |
| **Gauss** (teal) | Fast streak size 0.8, color `#80ffff` (`.5 1 1`), instant | `gauss_tag_l`: groundflash teal r80 life 10, expanding **ring** (bluering texture) size 1->15 per ring over 15 frames, color `#00ff80` at 0.03 alpha, spawned every 3 frames along the path | `gauss_hit_*`: teal flash + ring |
| **Plasma cannon shell** (Sling, Thug, Ravager, Hermit) | Orange-gold glow ball, glare size 10 elmos growing +12 over 3 frames at alpha .1; core `#ffe0a0` | `light_plasma_trail`: shaft: smoothtrail length ~3x size 8 color `rgb(.09 .05 0)` additive faint; heavier arty (`medium_arty_trail`, `heavy_arty_trail`): size 9, length 3 | `MARY_SUE`/`INGEBORG`: 3 fireball frames spaced 6.6 frames apart; 15 pikes `#ffb380` length 15; 20 sparks `#ffff00`->`#ffb380`->0 life 7.5 speed 3; groundflash r25 alpha .9 ttl 6. Large: Tremor `tremor`: glow `#ffcc99` size 65 life 8, groundflash r100 ttl 5, 5 debris chunks size 30 gravity (dust brown `#383026`), 10 water drops |
| **Riot AoE shock** (Ripper, Archer) | Thick short bullet; sonic: expanding translucent blue cone/ring `#33a0cc` (`.2 .6 .8`) growing for 0.15 s | `riot_cannon_trail`; shells ejected: `shell` sprite red-brown `#bf0000`, size 6-12, gravity .5, life 15-60 frames | `FLASH64`: groundflash r64 alpha 1.9 ttl 6, circlegrowth +4/frame (expanding ring); plus dust ring |
| **Rocket / missile** | Small body + exhaust. Rocket color flame `rgb(255,77,26)`, missile yellow `#e6e666` / blue `#9933e6`/`#ffcc66` for AA, thin spikes x4 length 4-5 | `rocket_trail_bar`: muzzle flare big orange `1 .3 .1`, glow `gunshotglow` size 28 life 2 frames; sparks size 21; smoke 3-6 puffs size 2.5 growing .11/frame life 10 (grey `rgb(13,10,8)` alpha .5->0). `missiletrailyellow`: flare `rgba(230,230,100)` size 6 growth .85 | `MEDMISSILE_EXPLOSION` / `xamelimpact`: fireball (heatcloud size 8 -> 25) + 15 pikes + 20-40 sparks + 1 smoke 20-50 frames |
| **Flame / napalm** | Flamethrower: dense stream of orange->red->grey particles 16 px, life 12-20 frames, speed 800 elmos/s; cone 4 deg | `flamer_240_range`: translucent additive blobs, size grows 2x over life | Burning zone: groundflash `#b34d1a` (`.7 .3 .1`) r108-128 ttl 75-480 frames (long, with flicker), 3-9 "fireball" puffs (Phoenix 3 per bomb, 9 for Pyro) delayed, rising smoke |
| **Napalm ground fire** | Persistent dps zone r54-128 elmos | none | flickering fireball sprites (`fire.png`, `flame.png`) at random positions inside the radius, refresh every 10 frames; alpha follows remaining duration |
| **Disarm / EMP** | Disarm missile white lightning trail `disarmtrail`, white-yellow lightning arcs `#ffffff`; EMP missile yellow-white | `bigemptrail` | `WHITE_LIGHTNING_BOMB`: many white arcs inside the AoE for 1 s; `YELLOW_LIGHTNINGPLOSION`: yellow bolts `#ffff40` re-struck randomly for 8 frames across AoE |
| **Capture / repair beam** | Green `#00cc33` (`0 .8 .2`) thin continuous line, width 3-4, pulsed alpha | none | none; bar overhead |
| **Gravity gun** | 6-shot burst of short thick pulses (width 4, size 2) in 0.2 s; attractive = blue `#0000ff` with violet core `#ff80ff`, repulsive = red `#ff0000`; pulses visible 1 frame each so beam looks like a dashed rope | none | none (draw radial arrows on affected units) |
| **Disintegrator / super beam** | Lance: thickness 17, violet `#4000ff`, 1 s duration, flare size 10-17 at the muzzle | none | `ataalaser`: groundsmoke violet `rgb(.4 0 .7)`, flash `#4059ff` growing 1.5/frame life 8, flash2 `#4d26e6` size 8 life 15, 8 spikes `#2640ff` length 10, 5 sparks life 12 speed 4, ground flash violet r80 shrinking -1.25/frame, yellow core flash r20 |
| **Flak** | Invisible shell (size .01) | `flak_trail`: 3 orange `#e68000`->0 puffs growth ~3 life 7 | `flakplosion`: white burst size 2 life 15; smoke `#e68000` size 48 life 50 alpha .3->0; **80 sparks** `#ffb333` life 7 size 4; groundflash r12 ttl 3 |
| **Sniper (Phantom)** | Red `#ff3333` bullet size 5, vel 850 (fast, 2 px trail) | none | `spectre_hit`: 3 vertical pillars (pink nova texture) size 90 shrinking -11/frame; pop size 90 +.9; airflash size 10 +2; 1 big pike `#ff40ff` length 26 growing 1.8 width 8; 15 wide sparks `#bf26bf` life 40-80 size 20 speed 6-30; core sparks white-pink |
| **Cluster / bombs** | Bomb: small dark body falling with scale 1->0.6 | none | Medium: heatcloud 8->30, ring shockwave; nuke family (`NUKE_150`): mushroom + shockwave ring (shockwave.png) size 150 grows +10/frame |
| **Shield bubble** | Hex-grid circle (hexbig / shield3hex), color matches team, alpha 0.15 idle, flash 0.5 on hit and ripple at impact point | none | hit = small white-blue ripple r20 life 15 frames |

### Canvas implementation hints
- Particle count budget: ZK uses 10-80 particles per impact; with 200 units on screen cap at ~10 for small, 30-80 for AoE >= 3 cells, drop to 5 above 300 live particles.
- Bloom: draw glow sprites (`glow2`, `gunshotglow`, `smallflare`) with `lighter` at 2-4x projectile size, alpha .1-.5.
- Beam fade: alpha = (1 - t/ttl)^1.5, width shrinks 100% -> 50%.
- Smoke: dark `rgba(13,10,8,.5)` normal blend (not additive) with radius growing 0.11 x size per frame, life 10-50 frames.
- Fire zone: tint `fire.png` additive `#ffb366` at 0.5, flicker +/-30% every 4 frames.

## 6. Comparison summary with our MODULES

Covered closely: sniper, light rail, heavy rail, gauss, cannons, rockets (2/4/12 tube), napalm rockets, ATGM, swarm, mortar, howitzer, barrage, pulse laser, heat ray, flamer, napalm, tesla, stun gun, EMP cannon, slow beam, arc lance, flak, shield, repair.
Not covered (see section 4): knockback, gravity, disarm, capture, shield-drain, area/persistent zones, charged beams, sweeping beams, cluster, suicide EMP, mines, area shield, multi-beam, EMP-vs-hp stun.
Partially covered with different rules: `slow` (flat fraction; ZK is relative to target hp, capped 0.5, decays 4%/s of hp after 0.5 s), `stun` (flat seconds; ZK is EMP damage accumulating vs hp, decays over 40 s).
