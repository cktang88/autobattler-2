#!/usr/bin/env python3
"""Generate the particle-effect atlas the 3D battlefield uses (public/assets/fx/fx_atlas.webp).
Run: python3 scripts/gen-fx-atlas.py        (needs numpy + Pillow; ~2-4 min on 4 cores)

One 2048 x 2048 RGBA atlas (lossy WebP with alpha), sampled by src/client/render3d/fx3d.ts:

  top-left  1024 x 1024   FIREBALL flipbook, 8 x 8 frames of 128 px, read left-to-right, top-to-bottom
  top-right 1024 x 1024   SMOKE flipbook, same layout
  bottom    2048 x 1024   MISC sprites, 8 x 4 tiles of 256 px (see MISC below)

Flipbook frames are ray-marched volumes: a cluster of metaball lobes displaced by 3D fbm noise. Channels:
  R, G  screen-space normal x, y of the cloud surface (0.5 = facing the camera), from the optical thickness
        heightfield, so the shader can light the billows by the sun direction
  B     fireball: visible temperature (1 = white hot core, 0 = cold soot); smoke: thinness (1 = wispy edge)
  A     density / coverage
The fireball starts as a compact lobed ball with hot cores and dark soot between the lobes, then expands and cools
from the outside in until it is all dark smoke; the smoke puff churns, slowly grows and breaks up into wisps.

Misc tiles (RGB white unless noted, A = shape):
  0 soft glow   1 spark streak (horizontal)   2 four-point star flare   3 hot dot
  4 shock ring (thin crisp line + faint inner wash)   5 scorch decal (RGB = soot colour)   6 debris chip   7 soft disc
"""
import os
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'fx')
FR = 128          # flipbook frame size
NF = 64           # frames per flipbook
NZ = 64           # ray-march samples
LAT = 48          # noise lattice period


def lattice(seed):
    return np.random.default_rng(seed).random((LAT, LAT, LAT)).astype(np.float32)


def vnoise(L, p):
    """trilinear value noise, p: (..., 3) float32"""
    pi = np.floor(p).astype(np.int32)
    f = p - pi
    f = f * f * f * (f * (f * 6 - 15) + 10)
    x0, y0, z0 = pi[..., 0] % LAT, pi[..., 1] % LAT, pi[..., 2] % LAT
    x1, y1, z1 = (x0 + 1) % LAT, (y0 + 1) % LAT, (z0 + 1) % LAT
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    c00 = L[x0, y0, z0] * (1 - fx) + L[x1, y0, z0] * fx
    c10 = L[x0, y1, z0] * (1 - fx) + L[x1, y1, z0] * fx
    c01 = L[x0, y0, z1] * (1 - fx) + L[x1, y0, z1] * fx
    c11 = L[x0, y1, z1] * (1 - fx) + L[x1, y1, z1] * fx
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz


# per-octave rotation hides the axis-aligned blockiness of lattice noise
_ROT = np.array([[0.00, 0.80, 0.60], [-0.80, 0.36, -0.48], [-0.60, -0.48, 0.64]], np.float32) * 2.03


def fbm(L, p, octaves=5, lac=2.03, gain=0.5):
    s, a, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * vnoise(L, p + o * 7.31)
        norm += a
        p = p @ _ROT
        a *= gain
    return s / norm


def billow(L, p, octaves=5):
    """cauliflower bumps: sum of folded noise octaves"""
    s, a, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * (1 - np.abs(vnoise(L, p + o * 5.17) * 2 - 1))
        norm += a
        p = p @ _ROT
        a *= 0.55
    return s / norm


def grid():
    c = (np.arange(FR, dtype=np.float32) + 0.5) / FR * 2 - 1
    u = c[None, :, None]          # x right
    v = -c[:, None, None]         # y up (row 0 = top)
    z = np.linspace(1, -1, NZ, dtype=np.float32)[None, None, :]  # front (toward viewer) to back
    P = np.stack(np.broadcast_arrays(u, v, z), -1).astype(np.float32)
    return P, 2.0 / (NZ - 1)


def cluster(seed, nbig, spread, rbig, nsub, up=0.0):
    """puff cluster: big lobes, each crowned with smaller puffs on its surface (rounded cauliflower billows).
    Returns centres (N,3), radii (N,), level (0 big, 1 sub), surface direction for subs (N,3)."""
    r = np.random.default_rng(seed)
    C, R, lev, D = [], [], [], []
    big = []
    for i in range(nbig):
        d = r.normal(size=3)
        d /= np.linalg.norm(d) + 1e-6
        c = d * spread * (0 if i == 0 else r.random() ** 0.5)
        c[1] += up * r.random()
        rr = rbig * (1.0 if i == 0 else 0.6 + 0.35 * r.random())
        big.append((c, rr))
        C.append(c); R.append(rr); lev.append(0); D.append(np.zeros(3))
    for c, rr in big:
        for k in range(nsub):
            d = r.normal(size=3)
            d /= np.linalg.norm(d) + 1e-6
            cs, rs = c + d * rr * 0.72, rr * (0.32 + 0.3 * r.random())
            C.append(cs); R.append(rs); lev.append(1); D.append(d * rr)
            for j in range(3):  # tiny puffs on the puffs
                e = r.normal(size=3)
                e = e / (np.linalg.norm(e) + 1e-6) * 0.6 + d * 0.5
                e /= np.linalg.norm(e) + 1e-6
                C.append(cs + e * rs * 0.6); R.append(rs * (0.3 + 0.25 * r.random())); lev.append(2); D.append(d * rr * 1.3)
    return np.array(C, np.float32), np.array(R, np.float32), np.array(lev), np.array(D, np.float32)


def puff_field(P, cl, s, expand, billow_out, only_big=False):
    """sum of compact metaballs; each one only touches the grid block inside its bounding box"""
    C, R, lev, D = cl
    f = np.zeros(P.shape[:-1], np.float32)
    xs, ys, zs = P[0, :, 0, 0], P[:, 0, 0, 1], P[0, 0, :, 2]   # x ascending, y descending, z descending

    def span(axis, lo, hi):
        if axis[0] <= axis[-1]:
            return np.searchsorted(axis, lo), np.searchsorted(axis, hi, side='right')
        a = axis[::-1]
        n = len(axis)
        return n - np.searchsorted(a, hi, side='right'), n - np.searchsorted(a, lo)

    for c, rr, lv, d in zip(C, R, lev, D):
        if only_big and lv:
            continue
        cc = c * s * (1 + expand) + d * s * billow_out
        r = rr * s
        x0, x1 = span(xs, cc[0] - r, cc[0] + r)
        y0, y1 = span(ys, cc[1] - r, cc[1] + r)
        z0, z1 = span(zs, cc[2] - r, cc[2] + r)
        if x0 >= x1 or y0 >= y1 or z0 >= z1:
            continue
        q = P[y0:y1, x0:x1, z0:z1] - cc[None, None, None, :]
        x = np.clip(1 - np.sum(q * q, -1) / r ** 2, 0, None)
        f[y0:y1, x0:x1, z0:z1] += x * x
    return f


def window(P):
    m = np.maximum(np.abs(P[..., 0]), np.abs(P[..., 1]))
    return np.clip((0.97 - m) / 0.14, 0, 1)


def composite(sig, temp, dz):
    """front-to-back: alpha, weighted temperature, optical thickness"""
    T = np.ones(sig.shape[:2], np.float32)
    E = np.zeros_like(T)
    W = np.zeros_like(T)
    tau = np.sum(sig, -1) * dz
    for k in range(sig.shape[2]):
        a = 1 - np.exp(-sig[..., k] * dz)
        w = T * a
        E += w * temp[..., k]
        W += w
        T *= 1 - a
    return 1 - T, E / np.maximum(W, 1e-5), tau


def normals(tau, gain):
    h = tau * gain
    # smooth a little so lossy compression and bilinear filtering don't facet the lighting
    k = np.array([1, 4, 6, 4, 1], np.float32)
    k /= k.sum()
    for ax in (0, 1):
        h = np.apply_along_axis(lambda m: np.convolve(np.pad(m, 2, mode='edge'), k, mode='valid'), ax, h)
    gy, gx = np.gradient(h, 2.0 / FR)
    n = np.stack([-gx, gy, np.ones_like(h)], -1)   # gy: rows go down, v goes up
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


L1, L2, L3 = lattice(11), lattice(23), lattice(37)
P0, DZ = grid()
FCL = cluster(5, 7, 0.4, 0.42, 7, up=0.06)
SCL = cluster(17, 7, 0.4, 0.4, 7, up=0.04)


def fire_frame(i):
    t = i / (NF - 1)
    grow = 1 - (1 - t) ** 2.2
    s = 1.1 + 0.32 * grow                        # overall size in the frame
    P = P0
    q = P / s
    n = fbm(L1, q * 3.2 + np.array([0, -t * 0.9, t * 0.5], np.float32) + 3.0, 4)
    n2 = fbm(L2, q * 3.0 + np.array([t * 0.7, -t * 1.4, 0], np.float32), 4)
    field = puff_field(P, FCL, s, 0.22 * grow, 0.25 * grow)
    core = puff_field(P, FCL, s, 0.22 * grow, 0, only_big=True)
    # rounded lobes with a little fine texture; erodes into broken smoke near the end
    d = field - 0.22 + (n - 0.5) * 0.4 - 0.1 * t ** 2
    dens = np.clip(d * 5, 0, 1) * window(P)
    sig = dens * (16 - 6 * t)
    # hot inside the big lobes, sooty in the creases between puffs; cools over time from the outside in
    temp = core * 1.3 + field * 0.35 + (n2 - 0.5) * 0.9 + 0.25 + 0.6 * (1 - t) ** 3 - t * 1.3
    temp = np.clip(temp, 0, 1)
    a, tv, tau = composite(sig, temp, DZ)
    nm = normals(tau, 1.0 / 32)
    return i, np.dstack([nm[..., 0] * 0.5 + 0.5, nm[..., 1] * 0.5 + 0.5, tv, a])


def smoke_frame(i):
    t = i / (NF - 1)
    s = 1.22 + 0.2 * t
    P = P0
    q = P / s
    n = fbm(L3, q * 3.2 + np.array([t * 0.35, -t * 0.8, t * 0.3], np.float32) + 9.0, 4)
    n2 = fbm(L2, q * 7.0 + np.array([0, -t * 1.2, t], np.float32) + 2.0, 3)
    field = puff_field(P, SCL, s, 0.12 * t, 0.2 * t)
    d = field - 0.2 + (n - 0.5) * 0.45 + (n2 - 0.5) * 0.12 - 0.12 * t ** 1.5
    dens = np.clip(d * 3.5, 0, 1) * window(P) * (1 - 0.25 * t)
    sig = dens * 9
    a, _, tau = composite(sig, np.zeros_like(sig), DZ)
    nm = normals(tau, 1.0 / 22)
    thin = np.exp(-tau * 0.55)
    return i, np.dstack([nm[..., 0] * 0.5 + 0.5, nm[..., 1] * 0.5 + 0.5, thin, a])


# ------------------------------------------------------------------------------------------------- misc tiles

T = 256


def tcoords():
    c = (np.arange(T, dtype=np.float32) + 0.5) / T * 2 - 1
    return np.meshgrid(c, -c)


def misc_tiles():
    x, y = tcoords()
    r = np.sqrt(x * x + y * y)
    ang = np.arctan2(y, x)
    tiles = []
    white = lambda a: np.dstack([np.ones_like(a), np.ones_like(a), np.ones_like(a), np.clip(a, 0, 1)])
    # 0 glow: bright core, long soft falloff
    tiles.append(white(np.exp(-r * r * 9) * 0.75 + np.exp(-r * 3.2) * 0.35 - 0.012))
    # 1 spark streak: horizontal, hot thin core, tapered ends (head at +x)
    along = np.clip(1 - np.abs(x), 0, 1)
    head = np.clip((x + 1) / 2, 0, 1) ** 0.6
    tiles.append(white(np.exp(-(y / (0.07 + 0.05 * along)) ** 2) * along ** 0.7 * (0.55 + 0.45 * head) * 1.1))
    # 2 four-point star flare (muzzle flash)
    star = np.exp(-np.abs(y) * 26) * np.exp(-np.abs(x) * 2.6) + np.exp(-np.abs(x) * 26) * np.exp(-np.abs(y) * 3.4)
    d45 = (np.abs(x + y), np.abs(x - y))
    star += 0.35 * (np.exp(-d45[0] * 30) + np.exp(-d45[1] * 30)) * np.exp(-r * 4)
    tiles.append(white(star + np.exp(-r * r * 30) * 0.9))
    # 3 hot dot
    tiles.append(white(np.exp(-r * r * 22) * 1.1))
    # 4 shock ring: crisp thin line at r = 0.9 plus a faint wash inside it that fades toward the centre
    ring = np.exp(-((r - 0.9) / 0.018) ** 2) + 0.18 * np.clip(r / 0.9, 0, 1) ** 3 * (r < 0.9)
    tiles.append(white(ring))
    # 5 scorch: soft brown-black blot with radial streaks and specks, ragged edge (RGB carries the soot colour)
    rng = np.random.default_rng(3)
    Lx = lattice(51)
    P2 = np.stack([x * 3, y * 3, np.zeros_like(x)], -1).astype(np.float32)
    nz = fbm(Lx, P2 + 1.7, 5)
    rays = np.zeros_like(r)
    for k in range(20):
        a0, w, ln = rng.random() * 2 * np.pi, 0.02 + 0.06 * rng.random(), 0.55 + 0.4 * rng.random()
        da = np.angle(np.exp(1j * (ang - a0)))
        rays += np.exp(-(da / w) ** 2) * np.clip(1 - r / ln, 0, 1) * (0.3 + 0.5 * rng.random())
    edge = 0.66 + (nz - 0.5) * 0.45
    core = np.clip((edge - r) / 0.45, 0, 1) ** 1.2
    a = np.clip(core * (0.75 + 0.45 * nz) + rays * 0.22 * (r > 0.25) * np.clip((0.95 - r) / 0.35, 0, 1), 0, 1) * 0.9
    a *= np.clip((0.98 - r) / 0.1, 0, 1)
    tone = 0.05 + 0.08 * nz + 0.06 * np.clip(r / 0.8, 0, 1)
    tiles.append(np.dstack([tone * 1.15, tone * 0.95, tone * 0.75, a]))
    # 6 debris chip: an irregular hard-edged shard (a dark tumbling fleck seen from afar)
    poly = 0.55 + 0.22 * np.cos(ang * 3 + 1) + 0.12 * np.cos(ang * 5 + 2)
    tiles.append(white(np.clip((poly - r) * 40, 0, 1)))
    # 7 soft disc
    tiles.append(white(np.clip(1 - r, 0, 1) ** 1.6))
    return tiles


def main():
    os.makedirs(OUT, exist_ok=True)
    atlas = np.zeros((2048, 2048, 4), np.float32)
    with Pool() as pool:
        for i, img in pool.imap_unordered(fire_frame, range(NF)):
            r, c = divmod(i, 8)
            atlas[r * FR:(r + 1) * FR, c * FR:(c + 1) * FR] = img
            print('fire', i, end='\r', file=sys.stderr)
        for i, img in pool.imap_unordered(smoke_frame, range(NF)):
            r, c = divmod(i, 8)
            atlas[r * FR:(r + 1) * FR, 1024 + c * FR:1024 + (c + 1) * FR] = img
            print('smoke', i, end='\r', file=sys.stderr)
    for k, tile in enumerate(misc_tiles()):
        r, c = divmod(k, 8)
        atlas[1024 + r * T:1024 + (r + 1) * T, c * T:(c + 1) * T] = tile
    # transparent texels keep a neutral normal so filtering at cloud edges doesn't drag the lighting around
    a = atlas[..., 3:4]
    neutral = np.array([0.5, 0.5, 0.0], np.float32)
    flip = atlas[:1024, :, :3] * np.clip(a[:1024] * 8, 0, 1) + neutral * (1 - np.clip(a[:1024] * 8, 0, 1))
    atlas[:1024, :, :3] = flip
    img = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    path = os.path.join(OUT, 'fx_atlas.webp')
    img.save(path, 'WEBP', quality=88, alpha_quality=90, method=6)
    print('\nwrote', path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    main()
