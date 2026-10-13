# Zero-K derived particle textures

Source: Zero-K game module, https://github.com/ZeroK-RTS/Zero-K (commit 48e99d8af6b95ead992298a28d8d9c347f48f5a1,
checked out 2026-10-13). Original path is `bitmaps/<folder>/<name>`.

Zero-K's `legal.txt` states: "Unless otherwise specified everything in this project is released under the GNU General
Public License [v2 or later] or Public Domain". The repo sorts its bitmaps into folders named by license
(`bitmaps/PD`, `bitmaps/GPL`, `bitmaps/CC`, `bitmaps/Other`, `bitmaps/Unknown`). Only `PD` and `GPL` were used here.
Per-file authors are NOT recorded anywhere in the repo, so author is "unknown (Zero-K / Spring RTS community)".
Provenance beyond the folder name could not be independently verified.

Processing: converted TGA/BMP to PNG with ImageMagick and downscaled to max 256 px. No other edits.
Most are greyscale/additive sprites meant for `globalCompositeOperation = 'lighter'` or for tinting.
Textures were NOT sampled from `bitmaps/CC` (contains CC-BY-NC-ND art by IceXuick, unusable) or Other/Unknown/Saktoths.

## pd/ (Public Domain per Zero-K folder: no obligations; crediting Zero-K is still polite)

| file | origin path |
|---|---|
| burncircle.png | bitmaps/PD/BurnCircle.tga |
| chargeparticles.png | bitmaps/PD/chargeparticles.tga |
| dosray.png | bitmaps/PD/dosray.tga |
| fireball.png | bitmaps/PD/Fireball.tga |
| flowerflash.png | bitmaps/PD/Flowerflash.tga |
| hexbig.png | bitmaps/PD/hexbig.png |
| lightning.png | bitmaps/PD/Lightning.tga |
| lightningball.png | bitmaps/PD/Lightningball.TGA |
| lightningball4.png | bitmaps/PD/Lightningball4.tga |
| lightring.png | bitmaps/PD/Lightring.tga |
| nano.png | bitmaps/PD/nano.png |
| orangesmoke.png | bitmaps/PD/OrangeSmoke.tga |
| shell.png | bitmaps/PD/Shell.tga |
| shield3hex.png | bitmaps/PD/shield3hex.png |
| shockwave.png | bitmaps/PD/shockwave.tga |
| smoke1.png | bitmaps/PD/smoke1.tga |
| smokesmall.png | bitmaps/PD/SmokeSmall.tga |
| smoketrail.png | bitmaps/PD/SmokeTrail.tga |
| smoketrailthinner.png | bitmaps/PD/SmokeTrailThinner.tga |
| spark.png | bitmaps/PD/spark.tga |
| whitelightningball.png | bitmaps/PD/WhiteLightningball.tga |

## gpl/ (GNU GPL v2 or later, per Zero-K `legal.txt` and `bitmaps/GPL` folder)

Obligations if you ship these: keep them identifiable as GPL-licensed, include the GPL text
(https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) and a pointer to the Zero-K source, note that they were modified
(format conversion/resize). Whether bundling GPL image files forces the game's code to be GPL is a gray area
(images loaded as data are arguably "mere aggregation", but a canvas game that embeds them is easier to defend if it is
itself GPL-compatible). If the project must stay permissively licensed, delete this folder and use pd/ only
(pd/ plus procedural canvas gradients covers every recipe in docs/research/zero-k.md).

| file | origin path |
|---|---|
| circles.png | bitmaps/GPL/circles.png |
| corelaser.png | bitmaps/GPL/corelaser.png |
| fire.png | bitmaps/GPL/fire.png |
| flame.png | bitmaps/GPL/flame.png |
| glow2.png | bitmaps/GPL/glow2.tga |
| glow3.png | bitmaps/GPL/glow3.tga |
| groundflash.png | bitmaps/GPL/groundflash.tga |
| gunshotglow.png | bitmaps/GPL/gunshotglow.tga |
| largelaserfalloff.png | bitmaps/GPL/largelaserfalloff.png |
| muzzleside.png | bitmaps/GPL/muzzleside.tga |
| plasma.png | bitmaps/GPL/plasma.tga |
| plasmashot.png | bitmaps/GPL/plasmashot.png |
| smallflare.png | bitmaps/GPL/smallflare.tga |
| smoke_orange.png | bitmaps/GPL/smoke_orange.png |
| smoothtrail.png | bitmaps/GPL/smoothtrail.png |
| smoothtrail2.png | bitmaps/GPL/smoothtrail2.png |
| sporetrailblue.png | bitmaps/GPL/sporetrailblue.tga |
