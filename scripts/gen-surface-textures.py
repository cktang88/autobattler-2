#!/usr/bin/env python3
"""Generate the tileable surface-detail maps the 3D units use (public/assets/tex/). Run: python3 scripts/gen-surface-textures.py

Output (1024 px, seamless, all greyscale data that MODULATES the per-part paint colours in the shader):
  hull_detail.png  R,G = height slope d(h)/du, d(h)/dv (0.5 = flat), B = cavity / paint tone (0.75 = neutral)
                   A procedural hard-surface "trim": plate panels with seams, rivet rows, hatches, vents, bolt rings,
                   access caps and stencil marks.
  hull_wear.jpg    R = chipped paint / scratches (bare metal), G = grime and drip streaks, B = fine mottling (0.5 = neutral)

Photo-sourced detail (scratches, grime, mottling) comes from CC0 ambientCG materials; put the 1K-JPG maps listed in
SOURCES into assets-src/ambientcg/ (git-ignored) first. Credits: public/assets/tex/README.md.
Needs numpy + Pillow.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets-src', 'ambientcg')
OUT = os.path.join(ROOT, 'public', 'assets', 'tex')
N = 1024
SOURCES = {
    'scratch': 'PaintedMetal004_1K-JPG_Metalness.jpg',    # https://ambientcg.com/view?id=PaintedMetal004
    'grime': 'PaintedMetal009_1K-JPG_Roughness.jpg',      # https://ambientcg.com/view?id=PaintedMetal009
    'mottle': 'SurfaceImperfections017_1K-JPG_Roughness.jpg',  # https://ambientcg.com/view?id=SurfaceImperfections017
    'speck': 'SurfaceImperfections017_1K-JPG_Opacity.jpg',
}

rng = np.random.default_rng(20261023)


def load(name):
    p = os.path.join(SRC, SOURCES[name])
    if not os.path.exists(p):
        sys.exit(f'missing {p} (download the ambientCG 1K-JPG zip, see the docstring)')
    im = Image.open(p).convert('L')
    if im.size != (N, N):
        im = im.resize((N, N), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def norm01(a, lo=1, hi=99):
    a0, a1 = np.percentile(a, lo), np.percentile(a, hi)
    return np.clip((a - a0) / max(1e-6, a1 - a0), 0, 1)


def blur(a, r):
    """wrap-around box blur (3 passes ~ gaussian)"""
    out = a
    for _ in range(3):
        for ax in (0, 1):
            acc = np.zeros_like(out)
            for k in range(-r, r + 1):
                acc += np.roll(out, k, axis=ax)
            out = acc / (2 * r + 1)
    return out


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
H = np.full((N, N), 0.5, np.float32)      # height
C = np.full((N, N), 0.75, np.float32)     # cavity / paint tone
W = np.zeros((N, N), np.float32)          # wear
G = np.zeros((N, N), np.float32)          # grime
seamD = np.full((N, N), 99.0, np.float32)  # distance to the nearest plate seam
drips = []                                # (x, y) sources of rust/grime streaks

# ---- plate layout: recursive split of the tile (borders on 0/N, so the seams tile) ----
panels = []


def split(x, y, w, h, d):
    mn = 120
    if (w < mn * 1.7 and h < mn * 1.7) or d > 5 or (d > 1 and rng.random() < 0.16):
        panels.append((x, y, w, h))
        return
    vert = w > h * 1.15 or (w > h * 0.87 and rng.random() < 0.5)
    cut = 0.34 + rng.random() * 0.32
    if vert and w > mn * 1.4:
        c = int(round(w * cut))
        split(x, y, c, h, d + 1); split(x + c, y, w - c, h, d + 1)
    elif h > mn * 1.4:
        c = int(round(h * cut))
        split(x, y, w, c, d + 1); split(x, y + c, w, h - c, d + 1)
    else:
        panels.append((x, y, w, h))


split(0, 0, N, N, 0)

GROOVE = 3.2


def rivet(cx, cy, r=3.0, hgt=0.1):
    x0, x1, y0, y1 = int(cx - r - 1), int(cx + r + 2), int(cy - r - 1), int(cy + r + 2)
    sy, sx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    rr = np.hypot(sx - cx, sy - cy) / r
    dome = np.where(rr < 1, np.sqrt(np.clip(1 - rr * rr, 0, 1)), 0)
    iy, ix = np.mod(sy.astype(int), N), np.mod(sx.astype(int), N)
    H[iy, ix] += dome * hgt
    C[iy, ix] += dome * 0.05 - (np.abs(rr - 1.05) < 0.25) * 0.12  # lit head, dark ring
    W[iy, ix] = np.maximum(W[iy, ix], (dome > 0.55) * 0.55 * (rng.random() < 0.5))


def rect_d(x, y, w, h):
    """inside-distance to the rect border on its own slice"""
    sy, sx = yy[y:y + h, x:x + w], xx[y:y + h, x:x + w]
    return np.minimum(np.minimum(sx - x + 0.5, x + w - 0.5 - sx), np.minimum(sy - y + 0.5, y + h - 0.5 - sy))


for (x, y, w, h) in panels:
    d = rect_d(x, y, w, h)
    lift = 0.04 * rng.random() + (0.05 if rng.random() < 0.2 else 0)
    prof = smooth(0, GROOVE, d)
    H[y:y + h, x:x + w] = 0.28 + (0.22 + lift) * prof
    C[y:y + h, x:x + w] = (0.75 + (rng.random() - 0.5) * 0.09) * (0.5 + 0.5 * smooth(0, GROOVE + 2.5, d))
    seamD[y:y + h, x:x + w] = d
    # rivet rows just inside the seams (not on every edge)
    step = 18 + int(rng.random() * 3) * 4
    ins = 8
    for side in range(4):
        if rng.random() < 0.35:
            continue
        if side < 2:
            yy0 = y + ins if side == 0 else y + h - ins
            for px in range(x + ins, x + w - ins + 1, step):
                rivet(px, yy0)
        else:
            xx0 = x + ins if side == 2 else x + w - ins
            for py in range(y + ins + step, y + h - ins - step + 1, step):
                rivet(xx0, py)
    # one feature per (big enough) panel
    f = rng.random()
    if w > 110 and h > 110 and f < 0.26:  # hatch: inset plate with a groove, hinge and handle recess
        hw, hh = int(w * (0.42 + rng.random() * 0.2)), int(h * (0.38 + rng.random() * 0.2))
        hx, hy = x + (w - hw) // 2, y + (h - hh) // 2
        hd = rect_d(hx, hy, hw, hh)
        H[hy:hy + hh, hx:hx + hw] += -0.12 * (1 - smooth(0, 2.2, hd)) + 0.03 * smooth(1.5, 4, hd)
        C[hy:hy + hh, hx:hx + hw] *= 0.6 + 0.4 * smooth(0, 2.5, hd)
        H[hy + 4:hy + 10, hx + 8:hx + hw - 8] += 0.05  # hinge bar
        H[hy + hh - 16:hy + hh - 9, hx + hw // 2 - 12:hx + hw // 2 + 12] -= 0.1
        C[hy + hh - 16:hy + hh - 9, hx + hw // 2 - 12:hx + hw // 2 + 12] *= 0.45
        drips.append((hx + hw // 2, hy + hh))
    elif w > 90 and h > 80 and f < 0.44:  # vent grille: dark slots
        sw = int(w * (0.4 + rng.random() * 0.25)); sx0 = x + (w - sw) // 2
        n = 4 + int(rng.random() * 4); sy0 = y + int(h * 0.3)
        gap = max(7, int(h * 0.4 / n))
        for k in range(n):
            ry = sy0 + k * gap
            H[ry:ry + 4, sx0:sx0 + sw] -= 0.16
            C[ry:ry + 4, sx0:sx0 + sw] *= 0.3
            H[ry + 4:ry + 5, sx0:sx0 + sw] += 0.03
        drips.append((sx0 + sw // 2, sy0 + n * gap))
    elif w > 80 and h > 80 and f < 0.58:  # bolt ring on a raised round plate
        cx, cy, R = x + w / 2, y + h / 2, min(w, h) * (0.22 + rng.random() * 0.08)
        sy, sx = yy[y:y + h, x:x + w], xx[y:y + h, x:x + w]
        rr = np.hypot(sx - cx, sy - cy)
        H[y:y + h, x:x + w] += 0.06 * smooth(R + 2, R - 1.5, rr)
        C[y:y + h, x:x + w] *= 1 - 0.35 * (np.abs(rr - R - 0.5) < 1.3)
        for k in range(6 + 2 * int(rng.random() * 2)):
            a = k / 8 * 2 * np.pi
            rivet(cx + np.cos(a) * R * 0.75, cy + np.sin(a) * R * 0.75, 2.6, 0.09)
        drips.append((cx, cy + R))
    elif w > 60 and h > 50 and f < 0.72:  # small access cap with corner screws
        cw, chh = int(24 + rng.random() * 26), int(16 + rng.random() * 18)
        cx0, cy0 = x + 12 + int(rng.random() * max(1, w - cw - 24)), y + 12 + int(rng.random() * max(1, h - chh - 24))
        cd = rect_d(cx0, cy0, cw, chh)
        H[cy0:cy0 + chh, cx0:cx0 + cw] += 0.05 * smooth(0, 2, cd)
        C[cy0:cy0 + chh, cx0:cx0 + cw] *= 0.65 + 0.35 * smooth(0, 1.6, cd)
        for (ax, ay) in ((cx0 + 4, cy0 + 4), (cx0 + cw - 4, cy0 + 4), (cx0 + 4, cy0 + chh - 4), (cx0 + cw - 4, cy0 + chh - 4)):
            rivet(ax, ay, 1.8, 0.05)
    elif f < 0.8 and h > 60:  # weld bead across the plate
        ry = y + int(h * (0.3 + rng.random() * 0.4))
        bead = (np.sin(xx[ry - 2:ry + 3, x + 6:x + w - 6] * 1.9) * 0.5 + 0.5) * 0.04 + 0.03
        H[ry - 2:ry + 3, x + 6:x + w - 6] += bead
        C[ry - 2:ry + 3, x + 6:x + w - 6] *= 0.85
    if rng.random() < 0.5:
        drips.append((x + rng.random() * w, y + h - 6))

# ---- stencil marks (paint only): short codes, arrows, warning triangles, "no step" boxes ----
try:
    font = ImageFont.load_default(size=15)
except Exception:  # very old Pillow
    font = ImageFont.load_default()
st = Image.new('L', (N, N), 0)
dr = ImageDraw.Draw(st)
codes = ['NO STEP', 'AX-7', '04', 'LIFT', '12-B', 'FUEL', 'MK IV', '220', 'DANGER', 'R7', 'HV', '3/9']
big = [p for p in panels if p[2] > 120 and p[3] > 70]
rng.shuffle(big)
for i, (x, y, w, h) in enumerate(big[:16]):
    k = i % 4
    px, py = x + 14 + int(rng.random() * (w - 110)), y + 14 + int(rng.random() * max(1, h - 46))
    if k == 0 or k == 1:
        dr.text((px, py), codes[i % len(codes)], fill=255, font=font)
    elif k == 2:  # arrow
        dr.polygon([(px, py + 6), (px + 22, py + 6), (px + 22, py), (px + 34, py + 10), (px + 22, py + 20), (px + 22, py + 14), (px, py + 14)], fill=255)
    else:  # warning triangle / boxed tag
        if rng.random() < 0.5:
            dr.polygon([(px + 14, py), (px + 28, py + 24), (px, py + 24)], outline=255, width=3)
            dr.rectangle([px + 13, py + 8, px + 15, py + 17], fill=255)
        else:
            dr.rectangle([px, py, px + 54, py + 20], outline=255, width=2)
            dr.text((px + 6, py + 2), codes[(i * 5) % len(codes)][:4], fill=255, font=font)
stencil = np.asarray(st, dtype=np.float32) / 255.0
speck = load('speck')
stencil *= 0.55 + 0.45 * (speck < np.percentile(speck, 70))  # worn, broken-up paint
C = C * (1 - stencil) + 0.97 * stencil

# ---- cheap AO from the height field ----
H = np.clip(H, 0, 1)
ao = H - blur(H, 4)
C *= np.clip(1 + ao * 1.6, 0.55, 1.15)

# ---- wear: photo scratches + chipped paint along the seams ----
scratch = norm01(load('scratch'), 2, 99.5)
chipN = blur(rng.random((N, N)).astype(np.float32), 2)
chipN = norm01(chipN)
edge = smooth(14, 3, seamD)
W = np.maximum(W, scratch * 0.6)
patchy = smooth(0.45, 0.75, norm01(blur(rng.random((N, N)).astype(np.float32), 24)))  # only some stretches of seam are chipped
W = np.maximum(W, edge * smooth(0.62, 0.78, chipN) * patchy)

# ---- grime: photo blotches/streaks + dirt in seams + drip streaks below features ----
grime = norm01(load('grime'))
G = 0.55 * smooth(0.35, 0.95, 1 - grime)
G = np.maximum(G, smooth(GROOVE + 3, 0.5, seamD) * 0.7)
streak = np.zeros((N, N), np.float32)
for (dx, dy) in drips + [(rng.random() * N, rng.random() * N) for _ in range(60)]:
    L = 40 + rng.random() * 190
    wdt = 2 + rng.random() * 6
    x0, x1 = int(dx - wdt * 2), int(dx + wdt * 2) + 1
    y0, y1 = int(dy), int(dy + L)
    sy, sx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    t = (sy - dy) / L
    a = np.exp(-((sx - dx) / wdt) ** 2) * (1 - t) ** 1.5 * (0.35 + 0.5 * rng.random())
    iy, ix = np.mod(sy.astype(int), N), np.mod(sx.astype(int), N)
    streak[iy, ix] = np.maximum(streak[iy, ix], a)
G = np.clip(np.maximum(G, streak), 0, 1)

mottle = norm01(load('mottle'))
M = 0.5 + (mottle - mottle.mean()) * 0.8

# ---- roll everything by a random offset so plate seams don't start at the tile corner (still seamless) ----
ox, oy = 371, 173
H, C, W, G, M = (np.roll(np.roll(a, oy, 0), ox, 1) for a in (H, C, W, G, M))

# ---- slopes (wrap-around central differences), lightly smoothed ----
Hs = blur(H, 1)
du = (np.roll(Hs, -1, 1) - np.roll(Hs, 1, 1)) * 0.5
dv = (np.roll(Hs, 1, 0) - np.roll(Hs, -1, 0)) * 0.5  # v points up the image (three flips Y on upload)
K = 4.0  # stored slope = 0.5 + slope * K (decoded in the shader)
R8 = lambda a: np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(np.dstack([R8(0.5 + du * K), R8(0.5 + dv * K), R8(np.clip(C, 0, 1))]), 'RGB').save(os.path.join(OUT, 'hull_detail.png'), optimize=True)
Image.fromarray(np.dstack([R8(W), R8(G), R8(M)]), 'RGB').save(os.path.join(OUT, 'hull_wear.jpg'), quality=88, subsampling=0)
print('wrote', OUT)
