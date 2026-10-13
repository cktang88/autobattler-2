# Render & audio credits

All unit, turret, part-icon, ground and effect art in `src/client/render/` is procedural canvas code written for
this project (no sprite sheets). All sound effects in `src/client/audio.ts` are synthesized with WebAudio at runtime.

## Music (`public/assets/music/`)

All tracks are CC0 (public domain dedication; no attribution required, credited anyway), downloaded from
OpenGameArt.org and re-encoded to MP3 (160 kbps, 192 kbps for the OGG source) with metadata stripped. Phases with two
files alternate each time the phase comes round (`TRACKS` in `src/client/audio.ts`).

| File | Used for | Title | Author | Source |
| --- | --- | --- | --- | --- |
| `menu-factory.mp3` | menu / hangar | "Factory ambiance" | yd | https://opengameart.org/content/factory-ambiance |
| `menu-menacing-otherworld.mp3` | menu / hangar | "Menacing Otherworld" | Ruskerdax | https://opengameart.org/content/menacing-otherworld |
| `deploy-tension.mp3` | deploy | "Inevitable" | vitalezzz | https://opengameart.org/content/inevitable |
| `deploy-tension-alt.mp3` | deploy | "Claimed by the Void" (loop version) | vitalezzz | https://opengameart.org/content/claimed-by-the-void |
| `battle-brute-force.mp3` | battle | "Brute Force" (loop version) | vitalezzz | https://opengameart.org/content/brute-force |
| `battle-hunter-class.mp3` | battle | "Hunter-class Lifeform" | vitalezzz | https://opengameart.org/content/hunter-class-lifeform |
| `victory-sting.mp3` | victory | "victory_4" (Dark Sci-Fi Audio Pack) | SRG774 | https://opengameart.org/content/dark-sci-fi-audio-pack |
| `defeat-lament.mp3` | defeat | "Laments of the War" | Cethiel | https://opengameart.org/content/laments-of-the-war |

## Effect textures (`public/assets/zk/pd/`)

From the Zero-K game repository (https://github.com/ZeroK-RTS/Zero-K, `bitmaps/PD/`), Public Domain per Zero-K's
`legal.txt` and folder naming; converted to PNG and downscaled by the research agent (see `public/assets/zk/README.md`
and `docs/research/zero-k.md`). Used with additive blending, tinted at runtime: `shockwave.png` (blast/sonic rings),
`spark.png` (muzzle flashes), `fireball.png` (explosion/flame puffs), `smoke1.png` (smoke), `hexbig.png` (shield hit
ripple), `lightningball4.png` (EMP orb), `whitelightningball.png` (EMP bolts), `burncircle.png` (napalm scorch).
Everything falls back to procedural gradients if a texture fails to load.

`public/assets/zk/gpl/` is NOT used by the renderer (licensing unresolved).

## Code references

Effect parameters (colours, lifetimes, particle counts) for weapon families follow the recipes summarised in
`docs/research/zero-k.md` (ideas/numbers only, no code copied). General approach (layered synth SFX, decals, camera
shake) inspired by the author's own `tinwar` and `dead-air-game` repos.
