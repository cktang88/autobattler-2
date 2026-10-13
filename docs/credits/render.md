# Render & audio credits

All unit, turret, part-icon, ground and effect art in `src/client/render/` is procedural canvas code written for
this project (no sprite sheets). All sound effects in `src/client/audio.ts` are synthesized with WebAudio at runtime.

## Music (`public/assets/music/`)

Copied unchanged from the author's `dead-air-game` repo (`assets/music/`), which took them from
[qompassai/light-show](https://github.com/qompassai/light-show) as bar-aligned loops (re-encoded 112 kbps MP3).

| File | Used for | Title | Composer | License |
| --- | --- | --- | --- | --- |
| `title.mp3` | menu | "We're all under the stars" (Resistor Anthems) | Eric Skiff | CC BY 4.0 |
| `tension.mp3` | deploy | "In a Heartbeat" | Kevin MacLeod | CC BY 3.0 |
| `combat.mp3` | battle | "Underclocked (underunderclocked mix)" (Resistor Anthems) | Eric Skiff | CC BY 4.0 |
| `win.mp3` | victory | "We're the Resistors" (Resistor Anthems) | Eric Skiff | CC BY 4.0 |
| `explore.mp3` | defeat (played at 0.8x, pitched down) | "Searching" (Resistor Anthems) | Eric Skiff | CC BY 4.0 |

Required attribution (show in an in-game credits screen):

> Music: Eric Skiff - We're all under the stars / Searching / Underclocked (underunderclocked mix) / We're the Resistors -
> Resistor Anthems - Available at http://EricSkiff.com/music (CC BY 4.0)
>
> "In a Heartbeat" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 3.0
> http://creativecommons.org/licenses/by/3.0/

The defeat track is `explore.mp3` slowed via `playbackRate = 0.8` with `preservesPitch = false` (a playback-time
transformation; the file itself is unmodified).

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
