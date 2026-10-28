#!/usr/bin/env python3
"""Generate the tileable surface-detail maps the 3D units use (public/assets/tex/). Run: python3 scripts/gen-surface-textures.py

Every map is greyscale DATA that modulates the per-part paint colours in the shader (src/client/proto3d/surface3d.ts):

  surf_detail.png  vertical strip of 15 layers, 512 px each (one per surface treatment, see LAYERS):
                   R,G = height slope d(h)/du, d(h)/dv (0.5 = flat), B = cavity / paint tone (0.75 = neutral)
  surf_mask.png    the same strip, one channel: a per-treatment special mask (camo, pits, scorch, accent paint,
                   accent panels, gouges, dust, sheen, oil ... the shader decides per layer what it means)
  hull_wear.jpg    1024 px, shared: R = chipped paint / scratches, G = grime and drip streaks, B = mottling (0.5 = neutral)
  surf_marks.png   12 x 128 px glyph cells for intentional big-unit markings: digits 0-9, kill tally, insignia

Photo-sourced detail (scratches, grime, mottling) comes from CC0 ambientCG materials; put the 1K-JPG maps listed in
SOURCES into assets-src/ambientcg/ (git-ignored) first. Credits: public/assets/tex/README.md. Needs numpy + Pillow.
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets-src', 'ambientcg')
OUT = os.path.join(ROOT, 'public', 'assets', 'tex')
SOURCES = {
    'scratch': 'PaintedMetal004_1K-JPG_Metalness.jpg',    # https://ambientcg.com/view?id=PaintedMetal004
    'grime': 'PaintedMetal009_1K-JPG_Roughness.jpg',      # https://ambientcg.com/view?id=PaintedMetal009
    'mottle': 'SurfaceImperfections017_1K-JPG_Roughness.jpg',  # https://ambientcg.com/view?id=SurfaceImperfections017
    'speck': 'SurfaceImperfections017_1K-JPG_Opacity.jpg',
}
# order = layer index in the shader (surface3d.ts LAYER)
LAYERS = ['scout', 'cast', 'slab', 'titan', 'air', 'rotor', 'arty', 'support', 'carapace', 'ceramic', 'brawler',
          'stealth', 'grating', 'machinery', 'dullmetal']
N = 512
R8 = lambda a: np.clip(np.round(a * 255), 0, 255).astype(np.uint8)


def load(name, size):
    p = os.path.join(SRC, SOURCES[name])
    if not os.path.exists(p):
        sys.exit(f'missing {p} (download the ambientCG 1K-JPG zip, see the docstring)')
    im = Image.open(p).convert('L')
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def norm01(a, lo=1, hi=99):
    a0, a1 = np.percentile(a, lo), np.percentile(a, hi)
    return np.clip((a - a0) / max(1e-6, a1 - a0), 0, 1)


def blur(a, r):
    """wrap-around box blur (3 passes ~ gaussian)"""
    out = a
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.concatenate([np.take(out, range(-r - 1, 0), axis=ax), out, np.take(out, range(0, r), axis=ax)], axis=ax), axis=ax)
            n = out.shape[ax]
            hi = np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=ax)
            lo = np.take(c, range(0, n), axis=ax)
            out = (hi - lo) / (2 * r + 1)
    return out


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def font(size, bold=True):
    for f in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else []) + ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()


class Layer:
    def __init__(self, seed):
        self.r = np.random.default_rng(seed)
        self.H = np.full((N, N), 0.5, np.float32)
        self.C = np.full((N, N), 0.75, np.float32)
        self.A = np.zeros((N, N), np.float32)
        self.seam = np.full((N, N), 99.0, np.float32)
        yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
        self.yy, self.xx = yy, xx

    def rnd(self):
        return float(self.r.random())

    def noise(self, rad, octaves=1):
        out = np.zeros((N, N), np.float32)
        amp = 1.0
        for o in range(octaves):
            out += norm01(blur(self.r.random((N, N)).astype(np.float32), max(1, int(rad / (2 ** o))))) * amp
            amp *= 0.5
        return norm01(out)

    # -- wrapped stamp helpers --
    def _grid(self, x0, y0, x1, y1):
        sy, sx = np.mgrid[int(np.floor(y0)):int(np.ceil(y1)), int(np.floor(x0)):int(np.ceil(x1))].astype(np.float32)
        return sy, sx, np.mod(sy.astype(int), N), np.mod(sx.astype(int), N)

    def rivet(self, cx, cy, r=2.0, h=0.08, ring=0.1):
        sy, sx, iy, ix = self._grid(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2)
        rr = np.hypot(sx - cx, sy - cy) / r
        dome = np.where(rr < 1, np.sqrt(np.clip(1 - rr * rr, 0, 1)), 0)
        self.H[iy, ix] += dome * h
        self.C[iy, ix] += dome * 0.04 - (np.abs(rr - 1.05) < 0.3) * ring

    def hexbolt(self, cx, cy, r=4.0, h=0.12):
        sy, sx, iy, ix = self._grid(cx - r - 2, cy - r - 2, cx + r + 3, cy + r + 3)
        dx, dy = np.abs(sx - cx), np.abs(sy - cy)
        hexd = np.maximum(dx * 0.866 + dy * 0.5, dy) / r
        top = smooth(1.0, 0.75, hexd)
        self.H[iy, ix] += top * h
        washer = smooth(1.45, 1.25, np.hypot(sx - cx, sy - cy) / r) * (1 - top)
        self.H[iy, ix] += washer * h * 0.3
        self.C[iy, ix] *= 1 - 0.3 * ((hexd > 0.95) & (hexd < 1.15))

    def rect_d(self, x, y, w, h):
        sy, sx = self.yy[y:y + h, x:x + w], self.xx[y:y + h, x:x + w]
        return np.minimum(np.minimum(sx - x + 0.5, x + w - 0.5 - sx), np.minimum(sy - y + 0.5, y + h - 0.5 - sy))

    def split(self, mn, maxd=5, aniso=1.0, stop=0.16):
        out = []

        def go(x, y, w, h, d):
            if (w < mn * 1.7 * aniso and h < mn * 1.7) or d > maxd or (d > 1 and self.rnd() < stop):
                out.append((x, y, w, h)); return
            vert = w > h * 1.15 * aniso or (w > h * 0.87 * aniso and self.rnd() < 0.5)
            cut = 0.34 + self.rnd() * 0.32
            if vert and w > mn * 1.4 * aniso:
                c = int(round(w * cut)); go(x, y, c, h, d + 1); go(x + c, y, w - c, h, d + 1)
            elif h > mn * 1.4:
                c = int(round(h * cut)); go(x, y, w, c, d + 1); go(x, y + c, w, h - c, d + 1)
            else:
                out.append((x, y, w, h))
        go(0, 0, N, N, 0)
        return out

    def plates(self, panels, groove, depth=0.22, lift=0.04, tone=0.08, cav=0.5):
        for (x, y, w, h) in panels:
            d = self.rect_d(x, y, w, h)
            prof = smooth(0, groove, d)
            self.H[y:y + h, x:x + w] = 0.5 - depth + (depth + lift * self.rnd()) * prof
            self.C[y:y + h, x:x + w] = (0.75 + (self.rnd() - 0.5) * tone) * (1 - cav + cav * smooth(0, groove + 2, d))
            self.seam[y:y + h, x:x + w] = d

    def rivet_rows(self, panels, inset, step, r, h=0.07, prob=0.65, double=False):
        for (x, y, w, hh) in panels:
            for side in range(4):
                if self.rnd() > prob:
                    continue
                for off in ([inset, inset + step * 0.8] if double else [inset]):
                    if side < 2:
                        yy0 = y + off if side == 0 else y + hh - off
                        for px in np.arange(x + inset, x + w - inset + 0.1, step):
                            self.rivet(px, yy0, r, h)
                    else:
                        xx0 = x + off if side == 2 else x + w - off
                        for py in np.arange(y + inset + step, y + hh - inset - step + 0.1, step):
                            self.rivet(xx0, py, r, h)

    def hatch(self, x, y, w, h, groove=1.6):
        d = self.rect_d(x, y, w, h)
        self.H[y:y + h, x:x + w] += -0.1 * (1 - smooth(0, groove, d)) + 0.025 * smooth(groove, groove * 2.5, d)
        self.C[y:y + h, x:x + w] *= 0.6 + 0.4 * smooth(0, groove * 1.4, d)

    def slots(self, x, y, w, h, n, horizontal=True, depth=0.16):
        if horizontal:
            gap = max(3, h // n)
            for k in range(n):
                ry = y + k * gap
                self.H[ry:ry + max(2, gap // 2), x:x + w] -= depth
                self.C[ry:ry + max(2, gap // 2), x:x + w] *= 0.32
        else:
            gap = max(3, w // n)
            for k in range(n):
                rx = x + k * gap
                self.H[y:y + h, rx:rx + max(2, gap // 2)] -= depth
                self.C[y:y + h, rx:rx + max(2, gap // 2)] *= 0.32

    def stencil(self, panels, count, size, codes, shapes=True, mask=None):
        st = Image.new('L', (N, N), 0)
        dr = ImageDraw.Draw(st)
        f = font(size)
        big = [p for p in panels if p[2] > size * 5 and p[3] > size * 2.5]
        self.r.shuffle(big)
        for i, (x, y, w, h) in enumerate(big[:count]):
            px = x + size + int(self.rnd() * max(1, w - size * 6))
            py = y + size + int(self.rnd() * max(1, h - size * 2.5))
            k = i % 4 if shapes else 0
            if k <= 1:
                dr.text((px, py), codes[i % len(codes)], fill=255, font=f)
            elif k == 2:
                s = size / 15
                dr.polygon([(px, py + 6 * s), (px + 22 * s, py + 6 * s), (px + 22 * s, py), (px + 34 * s, py + 10 * s), (px + 22 * s, py + 20 * s), (px + 22 * s, py + 14 * s), (px, py + 14 * s)], fill=255)
            else:
                s = size / 15
                dr.polygon([(px + 14 * s, py), (px + 28 * s, py + 24 * s), (px, py + 24 * s)], outline=255, width=max(1, int(3 * s)))
                dr.rectangle([px + 13 * s, py + 8 * s, px + 15 * s, py + 17 * s], fill=255)
        a = np.asarray(st, dtype=np.float32) / 255.0
        a *= 0.55 + 0.45 * (SPECK < np.percentile(SPECK, 70))
        self.C = self.C * (1 - a) + 0.97 * a
        if mask is not None:
            self.A = np.maximum(self.A, a * mask)

    def finish(self):
        H = np.clip(self.H, 0, 1)
        ao = H - blur(H, 3)
        C = self.C * np.clip(1 + ao * 1.6, 0.5, 1.15)
        Hs = blur(H, 1)
        du = (np.roll(Hs, -1, 1) - np.roll(Hs, 1, 1)) * 0.5
        dv = (np.roll(Hs, 1, 0) - np.roll(Hs, -1, 0)) * 0.5  # v points up the image
        K = 3.0  # stored slope = 0.5 + slope * K
        rgb = np.dstack([R8(0.5 + du * K), R8(0.5 + dv * K), R8(np.clip(C, 0, 1))])
        return rgb, R8(np.clip(self.A, 0, 1))


def voronoi(L, n, jitter=1.0):
    """wrapped Voronoi: returns (distance to own seed, distance to nearest cell border approx, cell id)"""
    pts = L.r.random((n, 2)) * N
    best = np.full((N, N), 1e9, np.float32); second = np.full((N, N), 1e9, np.float32); cid = np.zeros((N, N), np.int32)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(L.xx - px); dx = np.minimum(dx, N - dx)
        dy = np.abs(L.yy - py); dy = np.minimum(dy, N - dy)
        d = np.hypot(dx, dy)
        m1 = d < best
        second = np.where(m1, best, np.minimum(second, d))
        cid = np.where(m1, i, cid)
        best = np.where(m1, d, best)
    return best, (second - best) * 0.5, cid


# ---------------------------------------------------------------------------------------------------------------
SPECK = load('speck', N)


def L_scout():  # light: fine panel lines, many small hatches, small stencils, camo blotches in A
    L = Layer(11)
    P = L.split(44, 6)
    L.plates(P, 1.6, depth=0.16, tone=0.1)
    L.rivet_rows(P, 5, 9, 1.2, 0.05, prob=0.3)
    for (x, y, w, h) in P:
        if w > 40 and h > 34 and L.rnd() < 0.55:
            hw, hh = int(w * (0.4 + L.rnd() * 0.25)), int(h * (0.35 + L.rnd() * 0.25))
            L.hatch(x + (w - hw) // 2, y + (h - hh) // 2, hw, hh, 1.2)
        elif w > 40 and h > 30 and L.rnd() < 0.3:
            L.slots(x + w // 4, y + h // 4, w // 2, h // 2, 4)
    L.stencil(P, 14, 8, ['AX', '04', 'R7', 'NO STEP', '3/9', 'HV'])
    n1, n2 = L.noise(26, 2), L.noise(14, 2)
    L.A = np.maximum(smooth(0.52, 0.56, n1) * 0.7, smooth(0.6, 0.64, n2))  # two-tone disruptive camo
    return L


def L_cast():  # medium: cast armour (pitted, undulating), weld beads, bolted add-on plates
    L = Layer(12)
    L.H += (L.noise(40, 3) - 0.5) * 0.12
    pits = np.zeros((N, N), np.float32)
    for _ in range(1400):
        cx, cy, r = L.rnd() * N, L.rnd() * N, 0.8 + L.rnd() ** 2 * 2.8
        sy, sx, iy, ix = L._grid(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2)
        rr = np.hypot(sx - cx, sy - cy) / r
        pits[iy, ix] = np.maximum(pits[iy, ix], smooth(1, 0.3, rr))
    L.H -= pits * 0.07
    L.C *= 1 - pits * 0.25
    blot = L.noise(9, 2)
    L.A = np.maximum(pits, smooth(0.5, 0.75, blot) * 0.65)  # pitted, blotchy casting skin
    L.H -= smooth(0.5, 0.75, blot) * 0.03
    for _ in range(5):  # weld beads, meandering
        x, y = L.rnd() * N, L.rnd() * N
        ang = L.rnd() * np.pi
        for s in range(160):
            ang += (L.rnd() - 0.5) * 0.25
            x += np.cos(ang) * 1.6; y += np.sin(ang) * 1.6
            L.rivet(x, y, 2.2 + (s % 3) * 0.3, 0.06, ring=0.0)
    for _ in range(6):  # bolted add-on plates
        w, h = int(70 + L.rnd() * 80), int(50 + L.rnd() * 60)
        x, y = int(L.rnd() * (N - w)), int(L.rnd() * (N - h))
        d = L.rect_d(x, y, w, h)
        L.H[y:y + h, x:x + w] = np.maximum(L.H[y:y + h, x:x + w], 0.55 + 0.1 * smooth(0, 3, d))
        L.C[y:y + h, x:x + w] = (0.78 + (L.rnd() - 0.5) * 0.06) * (0.55 + 0.45 * smooth(0, 3, d))
        L.seam[y:y + h, x:x + w] = np.minimum(L.seam[y:y + h, x:x + w], d)
        for (bx, by) in ((x + 8, y + 8), (x + w - 8, y + 8), (x + 8, y + h - 8), (x + w - 8, y + h - 8), (x + w // 2, y + 8), (x + w // 2, y + h - 8)):
            L.hexbolt(bx, by, 3.4, 0.1)
    return L


def L_slab():  # heavy: thick layered slabs, deep seams, big bolts; A = the darker frame around each raised slab
    L = Layer(13)
    P = L.split(130, 4, stop=0.3)
    L.plates(P, 4.5, depth=0.3, tone=0.06, cav=0.65)
    for (x, y, w, h) in P:
        ins = 14
        if w > 60 and h > 60:  # second slab layer on top
            d2 = L.rect_d(x + ins, y + ins, w - 2 * ins, h - 2 * ins)
            L.H[y + ins:y + h - ins, x + ins:x + w - ins] += 0.1 * smooth(0, 3.5, d2)
            L.C[y + ins:y + h - ins, x + ins:x + w - ins] *= 0.78 + 0.22 * smooth(0, 4, d2)
        for (bx, by) in ((x + 8, y + 8), (x + w - 8, y + 8), (x + 8, y + h - 8), (x + w - 8, y + h - 8)):
            L.hexbolt(bx, by, 4.5, 0.14)
        for px in range(x + 40, x + w - 30, 40):
            L.hexbolt(px, y + 8, 3.6, 0.12); L.hexbolt(px, y + h - 8, 3.6, 0.12)
        L.A[y:y + h, x:x + w] = 1.0  # darker frame around the raised inner slab
        if w > 60 and h > 60:
            L.A[y + ins:y + h - ins, x + ins:x + w - ins] = 1 - smooth(0, 3, d2)
    return L


def L_titan():  # titan / giant: huge plates, double rivet rows, A = battle damage (scorch + gouges)
    L = Layer(14)
    P = L.split(120, 4, stop=0.3)
    L.plates(P, 5.0, depth=0.28, tone=0.16, cav=0.75)
    L.rivet_rows(P, 9, 11, 2.4, 0.09, prob=0.9, double=True)
    for (x, y, w, h) in P:  # inner stiffener lines
        if w > 200 and L.rnd() < 0.6:
            cx = x + w // 2
            L.H[y + 6:y + h - 6, cx - 2:cx + 2] += 0.04
            L.C[y + 6:y + h - 6, cx - 3:cx + 3] *= 0.92
    L.stencil(P, 4, 12, ['DANGER', 'TL-7', 'HV 440'], shapes=True)
    dmg = np.zeros((N, N), np.float32)
    n = L.noise(10, 2)
    for _ in range(4):
        cx, cy, R = L.rnd() * N, L.rnd() * N, 22 + L.rnd() * 30
        sy, sx, iy, ix = L._grid(cx - R * 1.6, cy - R * 1.6, cx + R * 1.6, cy + R * 1.6)
        rr = np.hypot(sx - cx, sy - cy) / R
        dmg[iy, ix] = np.maximum(dmg[iy, ix], smooth(1.3, 0.2, rr + (n[iy, ix] - 0.5) * 0.8))
        L.H[iy, ix] -= smooth(0.35, 0.0, rr) * 0.12  # small crater at the centre
    for _ in range(10):  # gouges
        x, y, ang, ln = L.rnd() * N, L.rnd() * N, (L.rnd() - 0.5) * 1.2, 30 + L.rnd() * 60
        for s in np.arange(0, ln, 1.0):
            L.rivet(x + np.cos(ang) * s, y + np.sin(ang) * s, 1.4, -0.06, ring=0)
    L.A = dmg
    return L


def L_air():  # aircraft: riveted aluminium skin, long stringer panels, dense rivet lines, walkway + chevrons
    L = Layer(15)
    P = []
    y = 0
    while y < N:
        h = 48 + int(L.rnd() * 3) * 16
        h = min(h, N - y)
        x = int(L.rnd() * 120) - 120
        while x < N:
            w = 150 + int(L.rnd() * 160)
            x0, x1 = max(0, x), min(N, x + w)
            if x1 - x0 > 4:
                P.append((x0, y, x1 - x0, h))
            x += w
        y += h
    L.plates(P, 1.1, depth=0.1, lift=0.015, tone=0.05, cav=0.35)
    L.rivet_rows(P, 3, 5, 0.9, 0.035, prob=1.0)
    st = Image.new('L', (N, N), 0)
    dr = ImageDraw.Draw(st)
    for _ in range(2):  # walkway outlines
        x, y = int(L.rnd() * (N - 200)), int(L.rnd() * (N - 60))
        dr.rectangle([x, y, x + 180, y + 40], outline=255, width=2)
        dr.text((x + 60, y + 13), 'WALK', fill=255, font=font(11))
    for _ in range(3):  # chevrons
        x, y = int(L.rnd() * (N - 60)), int(L.rnd() * (N - 40))
        for k in range(2):
            dr.line([(x + k * 14, y), (x + 14 + k * 14, y + 14), (x + k * 14, y + 28)], fill=255, width=4)
    dr.text((int(L.rnd() * 300), int(L.rnd() * 400)), 'NO STEP', fill=255, font=font(10))
    a = np.asarray(st, np.float32) / 255.0
    L.C = L.C * (1 - a) + 0.95 * a
    return L


def L_rotor():  # helicopters: skin panels + intake grilles
    L = Layer(16)
    P = L.split(70, 5)
    L.plates(P, 1.4, depth=0.12, tone=0.06, cav=0.45)
    L.rivet_rows(P, 4, 6, 1.0, 0.04, prob=0.8)
    for (x, y, w, h) in P:
        if w > 70 and h > 50 and L.rnd() < 0.4:  # grille
            gx, gy, gw, gh = x + 10, y + 10, w - 20, h - 20
            L.hatch(gx - 3, gy - 3, gw + 6, gh + 6, 1.5)
            yy, xx = L.yy[gy:gy + gh, gx:gx + gw], L.xx[gy:gy + gh, gx:gx + gw]
            holes = ((np.mod(xx - gx, 6) < 3.5) & (np.mod(yy - gy + (np.mod(xx // 6, 2)) * 3, 6) < 3.5)).astype(np.float32)
            L.H[gy:gy + gh, gx:gx + gw] -= holes * 0.15
            L.C[gy:gy + gh, gx:gx + gw] *= 1 - holes * 0.6
            sy = L.yy[gy:gy + gh + 60 if gy + gh + 60 < N else N, gx:gx + gw]
    L.stencil(P, 6, 9, ['FUEL', 'LIFT', 'R-2'])
    L.A = smooth(0.55, 0.85, L.noise(30, 2)) * 0.8  # exhaust soot
    return L


def L_arty():  # artillery / siege: utilitarian plates, strap bands, ribbed crate panels, hazard stencils; A = dust
    L = Layer(17)
    P = L.split(90, 4)
    L.plates(P, 2.2, depth=0.16, tone=0.07, cav=0.5)
    for (x, y, w, h) in P:
        f = L.rnd()
        if f < 0.35 and h > 60:  # ribbed crate panel
            for k in range(x + 8, x + w - 8, 10):
                L.H[y + 6:y + h - 6, k:k + 4] += 0.06
                L.C[y + 6:y + h - 6, k + 4:k + 5] *= 0.8
        elif f < 0.6 and h > 50:  # strap band with buckle
            by = y + h // 2
            L.H[by - 5:by + 5, x:x + w] += 0.05
            L.C[by - 6:by - 5, x:x + w] *= 0.6
            L.C[by + 5:by + 6, x:x + w] *= 0.6
            bx = x + int(w * 0.6)
            L.hatch(bx, by - 8, 16, 16, 1.2)
        L.rivet(x + 6, y + 6, 1.6); L.rivet(x + w - 6, y + 6, 1.6)
    L.stencil(P, 10, 11, ['DANGER', 'HE 155', 'KEEP CLEAR', 'LOAD'], shapes=True)
    L.A = smooth(0.4, 0.8, L.noise(40, 3))
    return L


def L_support():  # support / medic / shield: clean painted panels; A = role paint (crosses, stripes, rings)
    L = Layer(18)
    P = L.split(120, 4, stop=0.3)
    L.plates(P, 1.5, depth=0.1, tone=0.03, cav=0.35)
    L.rivet_rows(P, 5, 18, 1.1, 0.03, prob=0.35)
    st = Image.new('L', (N, N), 0)
    dr = ImageDraw.Draw(st)
    big = sorted(P, key=lambda p: -p[2] * p[3])
    for i, (x, y, w, h) in enumerate(big[:5]):
        cx, cy, s = x + w // 2, y + h // 2, min(w, h) * 0.32
        if i % 2 == 0:  # cross
            dr.rectangle([cx - s, cy - s * 0.33, cx + s, cy + s * 0.33], fill=255)
            dr.rectangle([cx - s * 0.33, cy - s, cx + s * 0.33, cy + s], fill=255)
        else:  # ring
            dr.ellipse([cx - s, cy - s, cx + s, cy + s], outline=255, width=max(3, int(s * 0.22)))
    for (x, y, w, h) in big[5:9]:  # accent stripe bands
        dr.rectangle([x + 4, y + h - 18, x + w - 4, y + h - 10], fill=255)
    a = np.asarray(st, np.float32) / 255.0
    L.A = a
    return L


def L_carapace():  # creatures: chitin plates (Voronoi), smooth domes, thin grooves, organic ridges; A = sheen
    L = Layer(19)
    d0, edge, cid = voronoi(L, 130)
    dome = smooth(0, 10, edge)
    L.H = 0.36 + 0.18 * np.sqrt(dome) + (L.noise(5, 2) - 0.5) * 0.04
    L.C = (0.74 + (np.mod(cid * 37, 11) / 11 - 0.5) * 0.06) * (0.8 + 0.2 * smooth(0, 3, edge))
    ridge = np.abs(np.sin(d0 * 0.45)) < 0.12
    L.H += ridge * dome * 0.02
    L.A = smooth(6, 18, edge) * 0.9
    return L


def wrap_draw(fn):
    """draw on a tileable N x N canvas: fn(draw, dx, dy) is called for the 9 wrapped offsets"""
    im = Image.new('L', (N, N), 0)
    dr = ImageDraw.Draw(im)
    for oy in (-N, 0, N):
        for ox in (-N, 0, N):
            fn(dr, ox, oy)
    return np.asarray(im, np.float32) / 255.0


def chamfer_d(L, x, y, w, h, c, corners):
    """distance inside a rect with the listed corners (0 tl, 1 tr, 2 bl, 3 br) cut at 45 degrees by c px"""
    sy, sx = L.yy[y:y + h, x:x + w], L.xx[y:y + h, x:x + w]
    d = L.rect_d(x, y, w, h)
    for k in corners:
        ddx = sx - x + 0.5 if k in (0, 2) else x + w - 0.5 - sx
        ddy = sy - y + 0.5 if k in (0, 1) else y + h - 0.5 - sy
        d = np.minimum(d, (ddx + ddy - c) / 1.414)
    return np.maximum(d, 0)


def hexes(L, cx, cy, r, rings):
    """centres of a hex-cell cluster (pointy-top) around (cx, cy)"""
    out = []
    for q in range(-rings, rings + 1):
        for rr in range(max(-rings, -q - rings), min(rings, -q + rings) + 1):
            out.append((cx + r * 1.732 * (q + rr / 2), cy + r * 1.5 * rr))
    return out


def L_ceramic():  # high-tech: dark angular armour plates over a fine mesh weave, hex-cell clusters, small LED lights;
    # A = 0.5 team-accent plates, 1.0 lights (the shader splits the two)
    L = Layer(20)
    # under-layer: woven mesh (shows in the gaps between the plates)
    wv = (np.sin(L.xx * 1.15) * np.sin(L.yy * 1.15))
    L.H[:] = 0.2 + 0.03 * wv
    L.C[:] = 0.42 + 0.08 * wv
    A = np.zeros((N, N), np.float32)
    P = L.split(96, 4, stop=0.2)
    gap = 4
    for (x, y, w, h) in P:
        x0, y0, w0, h0 = x + gap, y + gap, w - 2 * gap, h - 2 * gap
        if w0 < 12 or h0 < 12:
            continue
        ks = [k for k in range(4) if L.rnd() < 0.45]
        d = chamfer_d(L, x0, y0, w0, h0, min(w0, h0) * (0.18 + 0.2 * L.rnd()), ks)
        on = d > 0
        prof = smooth(0, 3.5, d)
        bevel = smooth(0.5, 1.8, d) * (1 - smooth(2.5, 4.5, d))
        top = 0.62 + 0.06 * L.rnd()
        L.H[y0:y0 + h0, x0:x0 + w0] = np.where(on, 0.3 + (top - 0.3) * prof, L.H[y0:y0 + h0, x0:x0 + w0])
        L.C[y0:y0 + h0, x0:x0 + w0] = np.where(on, (0.74 + (L.rnd() - 0.5) * 0.08) * (0.7 + 0.3 * prof) + bevel * 0.2, L.C[y0:y0 + h0, x0:x0 + w0])
        L.seam[y0:y0 + h0, x0:x0 + w0] = d
        inner = smooth(4, 6, d)
        if L.rnd() < 0.18:
            A[y0:y0 + h0, x0:x0 + w0] = np.maximum(A[y0:y0 + h0, x0:x0 + w0], inner * 0.5)
        # a thin engraved line following the plate outline
        if w0 > 50 and h0 > 40 and L.rnd() < 0.6:
            ln = (np.abs(d - 9) < 0.8)
            L.H[y0:y0 + h0, x0:x0 + w0] -= ln * 0.04
            L.C[y0:y0 + h0, x0:x0 + w0] *= 1 - ln * 0.3
        for (px, py) in ((x0 + 8, y0 + 8), (x0 + w0 - 8, y0 + h0 - 8)):
            if d[min(h0 - 1, int(py - y0)), min(w0 - 1, int(px - x0))] > 5 and L.rnd() < 0.6:
                L.rivet(px, py, 1.6, 0.04, 0.16)
    # hex-cell clusters: raised cells with a glowing centre cell
    for _ in range(2):
        cx, cy, r = L.rnd() * N, L.rnd() * N, 15 + L.rnd() * 5
        for i, (hx, hy) in enumerate(hexes(L, cx, cy, r, 1)):
            sy, sx, iy, ix = L._grid(hx - r, hy - r, hx + r + 1, hy + r + 1)
            dx, dy = np.abs(sx - hx), np.abs(sy - hy)
            hd = (r * 0.86 - np.maximum(dx * 0.866 + dy * 0.5, dy))  # px inside the hex edge (pointy-top)
            on = hd > 0
            L.H[iy, ix] = np.where(on, 0.3 + 0.36 * smooth(0, 3, hd), L.H[iy, ix])
            L.C[iy, ix] = np.where(on, 0.6 + 0.14 * smooth(0, 3, hd) + 0.15 * (smooth(0.5, 1.5, hd) * (1 - smooth(2, 3.5, hd))), L.C[iy, ix])
            if i == len(hexes(L, cx, cy, r, 1)) // 2:  # centre cell: a lit grid
                grid = (np.mod(sx, 4) < 2) * (np.mod(sy, 4) < 2) * smooth(2, 4, hd)
                A[iy, ix] = np.maximum(A[iy, ix], np.where(on, smooth(2, 4, hd) * (0.88 + 0.12 * grid), 0))
    # small LED lights in recessed sockets, and short light strips
    for _ in range(10):
        x, y = L.rnd() * N, L.rnd() * N
        if L.rnd() < 0.6:
            sy, sx, iy, ix = L._grid(x - 11, y - 11, x + 12, y + 12)
            rr = np.hypot(sx - x, sy - y)
            L.H[iy, ix] -= (rr < 9) * 0.06
            L.C[iy, ix] *= 1 - (rr < 9) * 0.4
            A[iy, ix] = np.maximum(A[iy, ix], smooth(7, 5, rr))
        else:
            w, h = (int(24 + L.rnd() * 30), 6) if L.rnd() < 0.5 else (6, int(24 + L.rnd() * 30))
            sy, sx, iy, ix = L._grid(x, y, x + w, y + h)
            A[iy, ix] = 1
            L.H[iy, ix] -= 0.05
    L.A = np.clip(A, 0, 1)
    return L


def L_dullmetal():  # dull scratched metal: chamfered panels, deep seams, vent grilles, pipe runs with collars,
    # engraved trace grooves (no glow), heavy fine scratches; A = team accent paint on some panels
    L = Layer(23)
    P = L.split(100, 4, stop=0.2)
    A = np.zeros((N, N), np.float32)
    g = 2.6
    for (x, y, w, h) in P:
        ks = [k for k in range(4) if L.rnd() < 0.35]
        d = chamfer_d(L, x, y, w, h, min(w, h) * (0.12 + 0.12 * L.rnd()), ks)
        prof = smooth(0, g, d)
        L.H[y:y + h, x:x + w] = 0.3 + (0.22 + 0.04 * L.rnd()) * prof
        L.C[y:y + h, x:x + w] = (0.75 + (L.rnd() - 0.5) * 0.1) * (0.4 + 0.6 * prof) + 0.12 * smooth(g, g + 1, d) * (1 - smooth(g + 1.5, g + 3.5, d))
        L.seam[y:y + h, x:x + w] = d
        if L.rnd() < 0.3:
            A[y:y + h, x:x + w] = smooth(g + 3, g + 5, d)
        r = L.rnd()
        if r < 0.3 and w > 50 and h > 40:  # vent grille in a framed recess
            vw, vh = int(w * 0.5), int(min(h * 0.45, 60))
            vx, vy = x + (w - vw) // 2, y + (h - vh) // 2
            L.hatch(vx, vy, vw, vh, 2.0)
            L.slots(vx + 5, vy + 5, vw - 10, vh - 10, max(3, (vh - 10) // 6), horizontal=L.rnd() < 0.7, depth=0.12)
        elif r < 0.55 and w > 60 and h > 50:  # inner framed panel with chamfered corners
            iw, ih = int(w * 0.6), int(h * 0.55)
            ix, iy = x + (w - iw) // 2, y + (h - ih) // 2
            di = chamfer_d(L, ix, iy, iw, ih, min(iw, ih) * 0.2, [0, 3])
            L.H[iy:iy + ih, ix:ix + iw] -= 0.05 * smooth(0, 2, di) * (di > 0)
            L.C[iy:iy + ih, ix:ix + iw] *= 1 - 0.25 * ((di > 0) & (di < 1.5))
        for (px, py) in ((x + 7, y + 7), (x + w - 7, y + 7), (x + 7, y + h - 7), (x + w - 7, y + h - 7)):
            if d[min(h - 1, max(0, int(py - y))), min(w - 1, max(0, int(px - x)))] > g + 2 and L.rnd() < 0.55:
                L.hexbolt(px, py, 2.4, 0.07)
    # engraved trace grooves: parallel runs with 45 degree jogs, ending in small pads
    runs = []
    for _ in range(4):
        x, y = L.rnd() * N, L.rnd() * N
        pts, dirn = [(x, y)], 0
        for _ in range(4):
            ln = 30 + L.rnd() * 70
            ang = [0, 45, 90, -45][dirn % 4] if L.rnd() < 0.6 else 0
            x += ln * np.cos(np.radians(ang)); y += ln * np.sin(np.radians(ang)); pts.append((x, y)); dirn += 1
        runs.append(pts)

    def tr(dr, ox, oy):
        for pts in runs:
            for k in range(4):
                o = k * 5
                dr.line([(px + ox, py + oy + o) for (px, py) in pts], fill=255, width=2)
                ex, ey = pts[-1]
                dr.ellipse([ex + ox - 3, ey + oy + o - 3, ex + ox + 3, ey + oy + o + 3], outline=255, width=1)
    grooves = wrap_draw(tr)
    L.H -= grooves * 0.05
    L.C *= 1 - grooves * 0.28
    # pipe runs: raised round tubes with collar rings
    pipes = []
    for _ in range(3):
        x, y = L.rnd() * N, L.rnd() * N
        horiz = L.rnd() < 0.5
        pts = [(x, y)]
        for k in range(3):
            ln = 50 + L.rnd() * 110
            if (k % 2 == 0) == horiz:
                x += ln
            else:
                y += ln * (1 if L.rnd() < 0.5 else -1)
            pts.append((x, y))
        pipes.append(pts)

    def pp(dr, ox, oy):
        for pts in pipes:
            dr.line([(px + ox, py + oy) for (px, py) in pts], fill=255, width=9, joint='curve')
    pm = wrap_draw(pp)
    tube = np.sqrt(np.clip(blur(pm, 2), 0, 1))
    L.H = np.maximum(L.H, 0.45 + tube * 0.3 * (pm > 0.01))
    L.C = np.where(tube > 0.05, 0.62 + 0.25 * tube, L.C * (1 - 0.35 * np.clip(blur(pm, 4) - pm, 0, 1)))  # contact shadow
    # heavy fine scratches: short random strokes, mostly lighter (bare metal), a few dark
    sc = Image.new('L', (N, N), 128)
    dr = ImageDraw.Draw(sc)
    for _ in range(1400):
        x, y = L.rnd() * N, L.rnd() * N
        a = L.rnd() * np.pi if L.rnd() < 0.4 else (0.6 + L.rnd() * 0.3) * (1 if L.rnd() < 0.5 else -1)
        ln = 6 + L.rnd() ** 2 * 60
        v = 128 + int((40 if L.rnd() < 0.8 else -45) * (0.4 + 0.6 * L.rnd()))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                dr.line([(x + ox, y + oy), (x + ox + ln * np.cos(a), y + oy + ln * np.sin(a))], fill=v, width=1)
    s2 = (np.asarray(sc, np.float32) - 128) / 128
    L.C = L.C * (1 + s2 * 0.6 * (L.H > 0.4))
    L.A = np.clip(A * 0.9, 0, 1)
    return L


def L_brawler():  # melee: dented, gouged, scraped plates; A = gouges / scrapes (bare metal)
    L = Layer(21)
    P = L.split(100, 4)
    L.plates(P, 3.0, depth=0.24, tone=0.07, cav=0.55)
    for _ in range(60):  # dents
        cx, cy, R = L.rnd() * N, L.rnd() * N, 6 + L.rnd() * 22
        sy, sx, iy, ix = L._grid(cx - R, cy - R, cx + R + 1, cy + R + 1)
        rr = np.hypot(sx - cx, sy - cy) / R
        L.H[iy, ix] -= smooth(1, 0, rr) ** 2 * 0.08
    g = np.zeros((N, N), np.float32)
    for _ in range(40):  # gouges in bunches of parallel scrapes
        x, y, ang, ln = L.rnd() * N, L.rnd() * N, (L.rnd() - 0.5) * 0.9, 40 + L.rnd() * 120
        for k in range(1 + int(L.rnd() * 4)):
            ox, oy = -np.sin(ang) * k * 4, np.cos(ang) * k * 4
            for s in np.arange(0, ln, 1.0):
                px, py = x + ox + np.cos(ang) * s, y + oy + np.sin(ang) * s
                g[int(py) % N, int(px) % N] = 1
    gb = blur(g, 1)
    L.H -= gb * 0.12
    L.C *= 1 - gb * 0.3
    L.A = np.clip(g + blur(g, 3) * 1.5, 0, 1)
    return L


def L_stealth():  # stealth: faceted RAM tiles, faint seams, almost no markings
    L = Layer(22)
    d0, edge, cid = voronoi(L, 46)
    L.H = 0.5 + (np.mod(cid * 53, 7) / 7 - 0.5) * 0.04 - (1 - smooth(0, 1.2, edge)) * 0.05
    L.C = 0.72 + (np.mod(cid * 29, 5) / 5 - 0.5) * 0.06
    return L


def L_grating():  # decks: steel grating in frames, deep dark holes
    L = Layer(23)
    P = L.split(110, 3, stop=0.4)
    L.plates(P, 2.5, depth=0.18, tone=0.03, cav=0.5)
    for (x, y, w, h) in P:
        gx, gy, gw, gh = x + 7, y + 7, w - 14, h - 14
        if gw < 10 or gh < 10:
            continue
        yy, xx = L.yy[gy:gy + gh, gx:gx + gw], L.xx[gy:gy + gh, gx:gx + gw]
        if L.rnd() < 0.5:  # bar grating
            holes = (np.mod(xx - gx, 7) > 2.2) & (np.mod(yy - gy, 22) > 2.5)
        else:  # diamond plate holes
            u, v = (xx - yy) / 9.0, (xx + yy) / 9.0
            holes = (np.abs(np.mod(u, 1) - 0.5) < 0.28) & (np.abs(np.mod(v, 1) - 0.5) < 0.28)
        holes = holes.astype(np.float32)
        L.H[gy:gy + gh, gx:gx + gw] -= holes * 0.22
        L.C[gy:gy + gh, gx:gx + gw] *= 1 - holes * 0.72
        for (bx, by) in ((x + 4, y + 4), (x + w - 4, y + 4), (x + 4, y + h - 4), (x + w - 4, y + h - 4)):
            L.rivet(bx, by, 1.8)
    return L


def L_machinery():  # legs / joints: ribbed cylinders, piston rods, hydraulic lines, hex bolts; A = oil
    L = Layer(24)
    yy, xx = L.yy, L.xx
    # horizontal bands of different machinery strips
    y = 0
    while y < N:
        h = 40 + int(L.rnd() * 60)
        h = min(h, N - y)
        kind = int(L.rnd() * 3)
        band = slice(y, y + h)
        if kind == 0:  # ribs
            L.H[band] = 0.45 + 0.08 * (np.sin(xx[band] * 2 * np.pi / 8) > 0.2)
        elif kind == 1:  # piston rods: bright smooth bars
            L.H[band] = 0.45
            for x0 in range(int(L.rnd() * 30), N, 64):
                L.H[band, x0:x0 + 14] += 0.08 * np.sin(np.linspace(0, np.pi, 14))
                L.C[band, x0:x0 + 14] = 0.9
        else:  # housing with hex bolts
            L.H[band] = 0.5
            for x0 in range(10, N, 26):
                L.hexbolt(x0, y + h / 2, 3.6, 0.12)
        L.H[y:y + 2] -= 0.15; L.C[y:y + 2] *= 0.4
        y += h
    for _ in range(6):  # hydraulic lines
        x0 = int(L.rnd() * N)
        wob = (np.sin(yy[:, 0] / 40 + L.rnd() * 6) * 6).astype(int)
        for row in range(N):
            xs = np.mod(np.arange(x0 + wob[row] - 2, x0 + wob[row] + 3), N)
            L.H[row, xs] += np.array([0.02, 0.05, 0.06, 0.05, 0.02])
            L.C[row, xs] = 0.6
    L.A = smooth(0.5, 0.8, L.noise(18, 2)) * 0.9
    return L


def main():
    os.makedirs(OUT, exist_ok=True)
    gens = {'scout': L_scout, 'cast': L_cast, 'slab': L_slab, 'titan': L_titan, 'air': L_air, 'rotor': L_rotor,
            'arty': L_arty, 'support': L_support, 'carapace': L_carapace, 'ceramic': L_ceramic, 'brawler': L_brawler,
            'stealth': L_stealth, 'grating': L_grating, 'machinery': L_machinery, 'dullmetal': L_dullmetal}
    rgbs, masks = [], []
    for name in LAYERS:
        rgb, a = gens[name]().finish()
        rgbs.append(rgb); masks.append(a)
        print('layer', name)
    Image.fromarray(np.concatenate(rgbs, 0), 'RGB').save(os.path.join(OUT, 'surf_detail.png'), optimize=True)
    Image.fromarray(np.concatenate(masks, 0), 'L').save(os.path.join(OUT, 'surf_mask.png'), optimize=True)

    # shared wear / grime / mottle (1024)
    M = 1024
    rng = np.random.default_rng(20261023)
    scratch = norm01(load('scratch', M), 2, 99.5) * 0.6
    grime = norm01(load('grime', M))
    G = 0.55 * smooth(0.35, 0.95, 1 - grime)
    streak = np.zeros((M, M), np.float32)
    for _ in range(140):
        dx, dy = rng.random() * M, rng.random() * M
        Ls, wdt = 40 + rng.random() * 190, 2 + rng.random() * 6
        sy, sx = np.mgrid[int(dy):int(dy + Ls), int(dx - wdt * 2):int(dx + wdt * 2) + 1].astype(np.float32)
        t = (sy - dy) / Ls
        a = np.exp(-((sx - dx) / wdt) ** 2) * (1 - t) ** 1.5 * (0.35 + 0.5 * rng.random())
        iy, ix = np.mod(sy.astype(int), M), np.mod(sx.astype(int), M)
        streak[iy, ix] = np.maximum(streak[iy, ix], a)
    G = np.clip(np.maximum(G, streak), 0, 1)
    mot = norm01(load('mottle', M))
    Mo = 0.5 + (mot - mot.mean()) * 0.8
    Image.fromarray(np.dstack([R8(scratch), R8(G), R8(Mo)]), 'RGB').save(os.path.join(OUT, 'hull_wear.jpg'), quality=88, subsampling=0)

    # marks atlas: digits 0-9, kill tally, insignia (chevron in a ring)
    W, Hh = 96, 128
    im = Image.new('L', (W * 12, Hh), 0)
    dr = ImageDraw.Draw(im)
    f = font(112)
    for d in range(10):
        bb = dr.textbbox((0, 0), str(d), font=f)
        dr.text((d * W + (W - (bb[2] - bb[0])) / 2 - bb[0], (Hh - (bb[3] - bb[1])) / 2 - bb[1]), str(d), fill=255, font=f)
        # stencil bridges
        dr.rectangle([d * W, Hh // 2 - 3, d * W + W, Hh // 2 + 3], fill=0)
    x0 = 10 * W
    for k in range(4):
        dr.rectangle([x0 + 12 + k * 16, 30, x0 + 20 + k * 16, 98], fill=255)
    dr.line([(x0 + 6, 90), (x0 + 84, 38)], fill=255, width=8)
    x0 = 11 * W
    dr.ellipse([x0 + 6, 22, x0 + 90, 106], outline=255, width=9)
    dr.polygon([(x0 + 24, 50), (x0 + 48, 72), (x0 + 72, 50), (x0 + 72, 66), (x0 + 48, 88), (x0 + 24, 66)], fill=255)
    im.save(os.path.join(OUT, 'surf_marks.png'), optimize=True)
    print('wrote', OUT)


main()
