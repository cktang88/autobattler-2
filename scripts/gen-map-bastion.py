# Generates the "Sea Bastion" battlefield with Blender: a paved arena between two citadels on a rocky island.
# Everything is procedural: no source images. One Blender unit = one field cell. +x runs from the blue citadel (viewer's
# end) to the red one, y across the field.
#
#   blender -b -P scripts/gen-map-bastion.py     # writes public/assets/maps/bastion/
#
# Output: map.glb (field, land, rocks, structures, clouds), and the textures read by the shaders in
# src/client/render3d/bakedmap.ts: shore.png (R = distance from the shore), water.webp, rock.webp.

import math
import os
import random
import struct
import sys
import tempfile
import zlib

import bmesh
import bpy
import numpy as np

HX, HY = 46, 48  # half the playable field (FIELD_H x FIELD_W)
DEPLOY = 24
BASE_DEPTH = 23  # cells of citadel behind each back line
FIELD_EXT = 52  # the hi-res field texture covers +-this
LAND_EXT = 110  # the land mesh and shore mask cover +-this
WATER_Z = -0.8
TILE = 14.0  # cells per repeat of the structure textures
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'maps', 'bastion')
TMP = tempfile.mkdtemp(prefix='bastion_')

random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 2
scene.render.image_settings.file_format = 'PNG'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('no GPU rendering:', e)

world = bpy.data.worlds.new('world')
scene.world = world
world.use_nodes = True
world_bg = world.node_tree.nodes['Background']


def srgb(hex_color):
    v = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [c / 12.92 if c < 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v]


# ------------------------------------------------------------------------------------------------ tiling textures


def spectral(n, beta, seed, aniso=(1.0, 1.0)):
    """tileable noise in 0..1: random phases under a 1/f^beta spectrum"""
    r = np.random.RandomState(seed)
    fy, fx = np.meshgrid(np.fft.fftfreq(n) * n, np.fft.fftfreq(n) * n, indexing='ij')
    f = np.hypot(fx * aniso[0], fy * aniso[1])
    f[0, 0] = 1
    spec = np.exp(2j * np.pi * r.rand(n, n)) / f ** beta
    spec[0, 0] = 0
    h = np.fft.ifft2(spec).real
    lo, hi = np.percentile(h, (1, 99))
    return np.clip((h - lo) / (hi - lo), 0, 1)


def ridged(a):
    return 1 - np.abs(a * 2 - 1)


def normal_rgb(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack((-dx, dy, np.ones_like(h)), -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True) * 0.5 + 0.5


def ramp(t, stops):
    xs = [s[0] for s in stops]
    cols = np.array([[int(s[1][i:i + 2], 16) / 255 for i in (1, 3, 5)] for s in stops])
    return np.stack([np.interp(t, xs, cols[:, c]) for c in range(3)], -1)


def write_png(path, a):
    """a: rows top-down, floats 0..1, shape (h, w) or (h, w, 3 / 4)"""
    a8 = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    channels = 1 if a8.ndim == 2 else a8.shape[2]
    kind = {1: 0, 3: 2, 4: 6}[channels]
    rows = b''.join(b'\0' + r.tobytes() for r in a8)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', a8.shape[1], a8.shape[0], 8, kind, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))
    return path


def write_webp(path, a, quality=86):
    img = bpy.data.images.load(write_png(os.path.join(TMP, os.path.basename(path) + '.png'), a))
    img.colorspace_settings.name = 'Non-Color'
    s = scene.render.image_settings
    s.file_format, s.color_mode, s.quality = 'WEBP', 'RGB', quality
    scene.view_settings.view_transform = 'Raw'
    img.save_render(path, scene=scene)
    s.file_format, s.color_mode = 'PNG', 'RGB'
    bpy.data.images.remove(img)


def seams(n, seed, depth=3):
    """recursive rectangular panel seams: 1 on a seam, 0 elsewhere; wraps at the tile edges"""
    r = random.Random(seed)
    m = np.zeros((n, n))

    def split(x0, x1, y0, y1, d):
        w, h = x1 - x0, y1 - y0
        if d == 0 or max(w, h) < n / 10:
            return
        if w >= h:
            c = x0 + int(w * r.choice((0.25, 0.5, 0.5, 0.75)))
            m[y0:y1, c - 1:c + 1] = 1
            split(x0, c, y0, y1, d - 1)
            split(c, x1, y0, y1, d - 1)
        else:
            c = y0 + int(h * r.choice((0.25, 0.5, 0.5, 0.75)))
            m[c - 1:c + 1, x0:x1] = 1
            split(x0, x1, y0, c, d - 1)
            split(x0, x1, c, y1, d - 1)

    split(0, n, 0, n, depth)
    m[:1, :] = m[-1:, :] = m[:, :1] = m[:, -1:] = 1
    return m


def blur(a, passes=2):
    for _ in range(passes):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a


def concrete_textures(n=1024):
    mottling = spectral(n, 1.2, 11)
    streaks = spectral(n, 1.1, 12, (1.0, 0.12))  # long vertical stains
    pits = spectral(n, 0.5, 13)
    joints = seams(n, 3, 2)
    tone = 0.9 + (mottling - 0.5) * 0.16 + (streaks - 0.5) * 0.24 - np.clip(pits - 0.82, 0, 1) * 0.7 - blur(joints) * 0.1
    color = np.clip(tone, 0, 1)[..., None] * np.array([0.72, 0.69, 0.62])
    height = blur(mottling, 1) * 0.5 + pits * 0.15 - blur(joints, 3) * 0.2
    return color, normal_rgb(height, 5)


def armor_textures(n=1024):
    mottling = spectral(n, 1.4, 21)
    grime = spectral(n, 1.0, 22, (1.0, 0.2))
    panel = seams(n, 9, 3)
    wear = np.clip(blur(panel, 4) * 3 - 0.1, 0, 1) * np.clip(spectral(n, 0.8, 23) - 0.45, 0, 1) * 0.8
    tone = 0.95 + (mottling - 0.5) * 0.18 + (grime - 0.5) * 0.22 - blur(panel, 2) * 0.14
    color = np.clip(tone, 0, 1)[..., None] * np.array([0.27, 0.285, 0.31]) + wear[..., None] * np.array([0.26, 0.25, 0.22])
    height = -blur(panel, 3) * 0.25 + mottling * 0.1
    return color, normal_rgb(height, 6)


def rock_texture(n=1024):
    broad = spectral(n, 1.5, 31)
    strata = ridged(spectral(n, 1.3, 32, (1.0, 3.5)))
    fine = spectral(n, 0.9, 33)
    t = np.clip(broad * 0.5 + strata ** 2 * 0.35 + fine * 0.25 - 0.05, 0, 1)
    return ramp(t, [(0.0, '#262322'), (0.35, '#4b4640'), (0.62, '#7a7268'), (1.0, '#a89f90')])


def worley_lace(n, cells, seed):
    """tileable cellular network: 1 along the walls between random cells, as bubbles leave in foam"""
    r = np.random.RandomState(seed)
    pts = r.rand(cells, cells, 2)
    yy, xx = np.mgrid[0:n, 0:n] / n * cells
    # sway the sampling a little so the cells are not all round
    sway = (spectral(n, 1.8, seed + 1) - 0.5) * 1.6
    xx, yy = xx + sway, yy + np.roll(sway, n // 3, 0)
    cx, cy = np.floor(xx).astype(int), np.floor(yy).astype(int)
    d1, d2 = np.full((n, n), 9.0), np.full((n, n), 9.0)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            px, py = cx + dx, cy + dy
            jit = pts[py % cells, px % cells]
            d = np.hypot(px + jit[..., 0] - xx, py + jit[..., 1] - yy)
            d2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
    return np.clip(1 - (d2 - d1) / 0.22, 0, 1)


def water_texture(n=1024):
    """RG: wave normal, from a directional swell with chop across it; B: foam lace with bubbles at two sizes"""
    swell = spectral(n, 1.9, 41, (1.0, 2.2))
    chop = spectral(n, 1.4, 44, (1.7, 1.0))
    nrm = normal_rgb(swell * 0.75 + chop * 0.25, 9)
    lace = worley_lace(n, 20, 42) * 0.7 + worley_lace(n, 54, 45) * 0.5
    clumps = spectral(n, 1.5, 43)
    foam = np.clip(lace * (0.45 + clumps * 0.9), 0, 1)
    return np.dstack((nrm[..., 0], nrm[..., 1], foam))


def cloud_texture(n=768):
    density = spectral(n, 1.75, 51) * 0.75 + spectral(n, 1.2, 52) * 0.25
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    edge = np.clip(1 - np.hypot(xx, yy) ** 2.2, 0, 1)
    alpha = np.clip((density * edge - 0.14) / 0.26, 0, 1)
    shade = 0.66 + 0.34 * np.clip(density * 1.3 - 0.1, 0, 1)
    return np.dstack((shade * 0.95, shade * 0.97, shade, alpha))


# ------------------------------------------------------------------------------------------------ render materials


class Look:
    """A material whose output can be switched between its colour and its shading normal (for the normal-map render)."""

    all = []

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        self.shaded = None
        self.normal = None
        Look.all.append(self)

    def n(self, kind, **inputs):
        node = self.nt.nodes.new(kind)
        for k, v in inputs.items():
            if hasattr(v, 'is_linked'):
                self.nt.links.new(v, node.inputs[k])
            elif k in node.inputs:
                node.inputs[k].default_value = v
            else:
                setattr(node, k, v)
        return node

    def ramp(self, fac, stops):
        r = self.n('ShaderNodeValToRGB', Fac=fac)
        cr = r.color_ramp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (p, c) in zip(cr.elements, stops):
            el.position = p
            el.color = (*srgb(c), 1)
        return r.outputs['Color']

    def mix(self, a, b, fac, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        if hasattr(fac, 'is_linked'):
            self.nt.links.new(fac, m.inputs['Factor'])
        else:
            next(i for i in m.inputs if i.name == 'Factor' and i.type == 'VALUE').default_value = fac
        for sock, v in (('A', a), ('B', b)):
            target = next(i for i in m.inputs if i.name == sock and i.type == 'RGBA')
            if hasattr(v, 'is_linked'):
                self.nt.links.new(v, target)
            else:
                target.default_value = v
        return next(o for o in m.outputs if o.type == 'RGBA')

    def finish(self, color, height=None, bump=0.5):
        bsdf = self.n('ShaderNodeBsdfPrincipled', Roughness=1.0)
        bsdf.inputs['Specular IOR Level'].default_value = 0
        self.nt.links.new(color, bsdf.inputs['Base Color'])
        if height is not None:
            b = self.n('ShaderNodeBump', Strength=bump, Distance=0.4, Height=height)
            nrm = b.outputs['Normal']
            self.nt.links.new(nrm, bsdf.inputs['Normal'])
        else:
            nrm = self.n('ShaderNodeNewGeometry').outputs['Normal']
        self.shaded = bsdf.outputs['BSDF']
        scaled = self.n('ShaderNodeVectorMath', operation='SCALE')
        self.nt.links.new(nrm, scaled.inputs[0])
        scaled.inputs['Scale'].default_value = 0.5
        offs = self.n('ShaderNodeVectorMath', operation='ADD')
        self.nt.links.new(scaled.outputs[0], offs.inputs[0])
        offs.inputs[1].default_value = (0.5, 0.5, 0.5)
        em = self.n('ShaderNodeEmission', Strength=1.0)
        self.nt.links.new(offs.outputs[0], em.inputs['Color'])
        self.normal = em.outputs[0]
        self.nt.links.new(self.shaded, self.out.inputs['Surface'])
        return self


def set_mode(mode):
    for l in Look.all:
        sock = l.normal if mode == 'normal' else l.shaded
        if sock is not None:
            l.nt.links.new(sock, l.out.inputs['Surface'])


def pavement():
    """Old stone paving half buried in windblown sand: irregular flagstones with chipped edges and their own tones,
    grit in patches, and drifts that hide the stones where the wind has left them."""
    l = Look('pavement')
    pos = l.n('ShaderNodeNewGeometry').outputs['Position']

    def nz(scale, detail=2.0, rough=0.5, at=pos):
        return l.n('ShaderNodeTexNoise', Vector=at, Scale=scale, Detail=detail, Roughness=rough).outputs['Fac']

    def mul(a, f, stops):
        return l.mix(a, l.ramp(f, stops), 1.0, 'MULTIPLY')

    def math_(op, a, b):
        m = l.n('ShaderNodeMath', operation=op)
        for sock, v in zip(m.inputs, (a, b)):
            if hasattr(v, 'is_linked'):
                l.nt.links.new(v, sock)
            else:
                sock.default_value = v
        return m.outputs[0]

    # warp the stone pattern so joints wander instead of running as clean straight cell edges
    wob = l.n('ShaderNodeTexNoise', Vector=pos, Scale=0.45, Detail=3.0, Roughness=0.55).outputs['Color']
    wob0 = l.n('ShaderNodeVectorMath', operation='SUBTRACT')
    l.nt.links.new(wob, wob0.inputs[0])
    wob0.inputs[1].default_value = (0.5, 0.5, 0.5)
    wob1 = l.n('ShaderNodeVectorMath', operation='SCALE')
    l.nt.links.new(wob0.outputs[0], wob1.inputs[0])
    wob1.inputs['Scale'].default_value = 1.5
    warp = l.n('ShaderNodeVectorMath', operation='ADD')
    l.nt.links.new(pos, warp.inputs[0])
    l.nt.links.new(wob1.outputs[0], warp.inputs[1])
    w = warp.outputs[0]

    edge = l.n('ShaderNodeTexVoronoi', Vector=w, Scale=1.05, feature='DISTANCE_TO_EDGE', Randomness=0.95).outputs['Distance']
    tile = l.n('ShaderNodeTexVoronoi', Vector=w, Scale=1.05, feature='F1', Randomness=0.95)
    tone = l.n('ShaderNodeSeparateColor', Color=tile.outputs['Color']).outputs
    chips = nz(6.0, 3.0, 0.6)
    # joints widen and narrow along their length
    joint = math_('ADD', edge, math_('MULTIPLY', chips, -0.016))

    wash = nz(0.018, 3.0, 0.42)
    stone = l.ramp(wash, [(0.28, '#8d8a87'), (0.46, '#9c968d'), (0.6, '#ad9f8b'), (0.76, '#bbab92')])
    stone = mul(stone, nz(0.065, 3.0, 0.5), [(0.3, '#ebe8e3'), (0.7, '#ffffff')])
    stone = mul(stone, tone[0], [(0.0, '#e6e4e0'), (1.0, '#ffffff')])
    stone = l.mix(stone, l.ramp(tone[1], [(0.0, '#b2a896'), (1.0, '#a2a2a2')]), 0.14)
    stone = mul(stone, nz(1.1, 5.0, 0.62), [(0.28, '#cfccc6'), (0.72, '#ffffff')])
    stone = mul(stone, nz(11.0, 3.0, 0.6), [(0.25, '#cfccc6'), (0.75, '#ffffff')])
    stone = mul(stone, joint, [(0.0, '#dcd9d2'), (0.02, '#f8f7f4'), (0.06, '#ffffff')])

    # drifts: long soft banks, ribbed by the wind
    drift = math_('ADD', nz(0.028, 4.0, 0.5), math_('MULTIPLY', nz(0.13, 3.0, 0.5), 0.22))
    bank = l.n('ShaderNodeMapRange', Value=drift)
    bank.inputs['From Min'].default_value = 0.52
    bank.inputs['From Max'].default_value = 0.86
    sand = l.ramp(nz(0.05, 3.0, 0.5), [(0.3, '#ab9e88'), (0.7, '#b8a990')])
    ripple_at = l.n('ShaderNodeMapping', Vector=pos)
    ripple_at.inputs['Scale'].default_value = (1.0, 0.16, 1.0)
    ripple_at.inputs['Rotation'].default_value = (0, 0, 0.5)
    ripple = nz(3.2, 2.0, 0.4, ripple_at.outputs[0])
    sand = mul(sand, ripple, [(0.3, '#dcd8d0'), (0.7, '#ffffff')])
    sand = mul(sand, nz(14.0, 3.0, 0.6), [(0.25, '#dcd9d3'), (0.75, '#ffffff')])
    c = l.mix(stone, sand, bank.outputs[0])

    # grit gathers in patches instead of evenly over the field
    grit = math_('MULTIPLY', l.ramp(nz(5.5, 2.0), [(0.68, '#000000'), (0.73, '#ffffff')]), l.ramp(nz(0.09, 3.0), [(0.5, '#000000'), (0.66, '#ffffff')]))
    c = l.mix(c, (*srgb('#57534d'), 1), grit)

    # relief: each stone sits at its own height with a soft shoulder; sand smooths all of it over
    shoulder = l.ramp(joint, [(0.0, '#000000'), (0.05, '#ffffff')])
    relief = math_('ADD', math_('MULTIPLY', shoulder, 0.12), math_('MULTIPLY', tone[2], 0.2))
    relief = math_('ADD', relief, math_('MULTIPLY', nz(2.2, 5.0, 0.6), 0.45))
    relief = math_('MULTIPLY', relief, math_('SUBTRACT', 1.0, bank.outputs[0]))
    relief = math_('ADD', relief, math_('MULTIPLY', ripple, math_('MULTIPLY', bank.outputs[0], 0.35)))
    return l.finish(c, relief, 0.11)


def asphalt():
    """The deploy pads: poured, patched, oil-stained and dusty at the edges rather than one flat dark sheet"""
    l = Look('asphalt')
    pos = l.n('ShaderNodeNewGeometry').outputs['Position']
    a = l.n('ShaderNodeTexNoise', Vector=pos, Scale=0.05, Detail=3.0, Roughness=0.45).outputs['Fac']
    b = l.n('ShaderNodeTexNoise', Vector=pos, Scale=7.0, Detail=3.0, Roughness=0.6).outputs['Fac']
    stain = l.n('ShaderNodeTexNoise', Vector=pos, Scale=0.22, Detail=4.0, Roughness=0.55).outputs['Fac']
    dust = l.n('ShaderNodeTexNoise', Vector=pos, Scale=0.09, Detail=5.0, Roughness=0.6).outputs['Fac']
    c = l.mix(l.ramp(a, [(0.3, '#55554f'), (0.7, '#66655d')]), l.ramp(b, [(0.25, '#c4c4c4'), (0.75, '#ffffff')]), 1.0, 'MULTIPLY')
    c = l.mix(c, l.ramp(stain, [(0.62, '#ffffff'), (0.76, '#b8b8ba')]), 1.0, 'MULTIPLY')
    c = l.mix(c, l.ramp(dust, [(0.5, '#000000'), (0.78, '#3c382e')]), 1.0, 'ADD')
    return l.finish(c, b, 0.08)


def flat(name, hex_color, emit=0.0):
    l = Look(name)
    if emit:
        em = l.n('ShaderNodeEmission', Strength=emit)
        em.inputs['Color'].default_value = (*srgb(hex_color), 1)
        l.shaded = em.outputs[0]
        grey = l.n('ShaderNodeEmission', Strength=1.0)
        grey.inputs['Color'].default_value = (0.5, 0.5, 1, 1)
        l.normal = grey.outputs[0]
        l.nt.links.new(l.shaded, l.out.inputs['Surface'])
        return l
    rgb = l.n('ShaderNodeRGB')
    rgb.outputs[0].default_value = (*srgb(hex_color), 1)
    return l.finish(rgb.outputs[0])


def worn(l, scale, lo, hi):
    """painted lines scuffed through to the stone underneath, instead of ruler-clean vectors"""
    pos = l.n('ShaderNodeNewGeometry').outputs['Position']
    f = l.n('ShaderNodeTexNoise', Vector=pos, Scale=scale, Detail=6.0, Roughness=0.62).outputs['Fac']
    keep = l.n('ShaderNodeMapRange', Value=f)
    keep.inputs['From Min'].default_value = lo
    keep.inputs['From Max'].default_value = hi

    def through(sock):
        ms = l.n('ShaderNodeMixShader')
        l.nt.links.new(keep.outputs[0], ms.inputs[0])
        l.nt.links.new(l.n('ShaderNodeBsdfTransparent').outputs[0], ms.inputs[1])
        l.nt.links.new(sock, ms.inputs[2])
        return ms.outputs[0]

    l.shaded, l.normal = through(l.shaded), through(l.normal)
    l.nt.links.new(l.shaded, l.out.inputs['Surface'])
    return l


PAVE = pavement()
ASPH = asphalt()
PAINT_W = worn(flat('paint_white', '#d8d4c8'), 2.6, 0.32, 0.46)
PAINT_DIM = worn(flat('paint_dim', '#a39e92'), 2.6, 0.38, 0.52)
PAINT_Y = worn(flat('paint_amber', '#c49a55'), 2.6, 0.34, 0.48)
ROAD = worn(flat('road_dark', '#6b6862'), 0.9, 0.3, 0.62)
PLATE_FLOOR = worn(flat('plate_floor', '#83807a'), 0.9, 0.26, 0.5)
GLOW = {
    'amber': flat('glow_amber', '#ffad52', 2.2),
    'cyan': flat('glow_cyan', '#a8dcff', 2.0),
    'blue': flat('glow_blue', '#2f7dff', 4.2),
    'red': flat('glow_red', '#ff2a1a', 4.2),
}
CONC = flat('concrete', '#a8a498')
ARMOR = flat('armor', '#3f4248')

# ------------------------------------------------------------------------------------------------ geometry kit


def poly_area(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2


def inset(poly, d):
    """offset a convex polygon inward by d, keeping its edges parallel"""
    n = len(poly)
    sign = 1 if poly_area(poly) > 0 else -1
    out = []
    for i in range(n):
        ax, ay = poly[i - 1]
        bx, by = poly[i]
        cx, cy = poly[(i + 1) % n]
        e1, e2 = np.array((bx - ax, by - ay), float), np.array((cx - bx, cy - by), float)
        e1, e2 = e1 / np.linalg.norm(e1), e2 / np.linalg.norm(e2)
        n1, n2 = np.array((-e1[1], e1[0])) * sign, np.array((-e2[1], e2[0])) * sign
        m = n1 + n2
        m = m / max(np.linalg.norm(m), 1e-6)
        k = d / max(m @ n1, 0.2)
        out.append((bx + m[0] * k, by + m[1] * k))
    return out


def rect(x0, x1, y0, y1):
    return [(min(x0, x1), min(y0, y1)), (max(x0, x1), min(y0, y1)), (max(x0, x1), max(y0, y1)), (min(x0, x1), max(y0, y1))]


def octo(x0, x1, y0, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


class Kit:
    """Accumulates geometry per material, so the whole map ends up as a handful of draw calls."""

    def __init__(self):
        self.bms = {}

    def bm(self, look):
        if look not in self.bms:
            self.bms[look] = bmesh.new()
        return self.bms[look]

    def loft(self, look, lower, z0, upper, z1, cap=True):
        b = self.bm(look)
        lo = [b.verts.new((x, y, z0)) for x, y in lower]
        hi = [b.verts.new((x, y, z1)) for x, y in upper]
        n = len(lower)
        for i in range(n):
            j = (i + 1) % n
            b.faces.new((lo[i], lo[j], hi[j], hi[i]))
        if cap:
            b.faces.new(hi)

    def tier(self, look, poly, z0, h, batter=0.0):
        """a block whose walls lean inward by `batter` on the way up, like a fortress wall"""
        self.loft(look, poly, z0, inset(poly, batter) if batter else poly, z0 + h)

    def box(self, look, cx, cy, z0, sx, sy, h, batter=0.0):
        self.tier(look, rect(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2), z0, h, batter)

    def tube(self, look, p0, p1, r0, r1=None, n=8):
        r1 = r0 if r1 is None else r1
        p0, p1 = np.array(p0, float), np.array(p1, float)
        ax = (p1 - p0) / np.linalg.norm(p1 - p0)
        u = np.cross(ax, (0, 0, 1) if abs(ax[2]) < 0.9 else (1, 0, 0))
        u /= np.linalg.norm(u)
        v = np.cross(ax, u)
        b = self.bm(look)
        rings = []
        for p, r in ((p0, r0), (p1, r1)):
            rings.append([b.verts.new(tuple(p + (u * math.cos(i / n * math.tau) + v * math.sin(i / n * math.tau)) * r)) for i in range(n)])
        for i in range(n):
            j = (i + 1) % n
            b.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
        b.faces.new(rings[1])

    def mesh(self, name, look, coll, mapped=False):
        b = self.bms[look]
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        if mapped:
            # box projection in world cells: texture scale is the same on every wall, and stains run down the walls
            uv = b.loops.layers.uv.new('UVMap')
            for f in b.faces:
                n = f.normal
                dom = max(range(3), key=lambda i: abs(n[i]))
                for loop in f.loops:
                    c = loop.vert.co
                    p = (c.x, c.y) if dom == 2 else (c.y, c.z) if dom == 0 else (c.x, c.z)
                    loop[uv].uv = (p[0] / TILE, p[1] / TILE)
        m = bpy.data.meshes.new(name)
        b.to_mesh(m)
        b.free()
        o = bpy.data.objects.new(name, m)
        m.materials.append(look.mat)
        coll.objects.link(o)
        return o


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


C_FIELD, C_PAINT, C_GLOW, C_STRUCT = map(collection, ('field', 'paint', 'glowpaint', 'structures'))

# ------------------------------------------------------------------------------------------------ painted field


def fill(k, look, poly, z=0.012):
    b = k.bm(look)
    b.faces.new([b.verts.new((x, y, z)) for x, y in poly])


def line(k, look, pts, w, closed=False, z=0.02):
    b = k.bm(look)
    seq = pts + pts[:1] if closed else pts
    for (x0, y0), (x1, y1) in zip(seq, seq[1:]):
        dx, dy = x1 - x0, y1 - y0
        d = max(math.hypot(dx, dy), 1e-6)
        ux, uy = dx / d * w / 2, dy / d * w / 2
        nx, ny = -uy, ux
        b.faces.new([b.verts.new(p) for p in ((x0 - nx - ux, y0 - ny - uy, z), (x1 - nx + ux, y1 - ny + uy, z), (x1 + nx + ux, y1 + ny + uy, z), (x0 + nx - ux, y0 + ny - uy, z))])


def arc(k, look, r, a0, a1, w, cx=0.0, z=0.02):
    n = max(6, int(abs(a1 - a0) * r / 0.4))
    b = k.bm(look)
    prev = None
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        ca, sa = math.cos(a), math.sin(a)
        cur = (b.verts.new((cx + ca * (r - w / 2), sa * (r - w / 2), z)), b.verts.new((cx + ca * (r + w / 2), sa * (r + w / 2), z)))
        if prev:
            b.faces.new((prev[0], prev[1], cur[1], cur[0]))
        prev = cur


def dot(k, look, x, y, s=0.3, z=0.03):
    b = k.bm(look)
    b.faces.new([b.verts.new((x + dx * s, y + dy * s, z)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])


paint = Kit()
fill(paint, PLATE_FLOOR, [(math.cos(i / 48 * math.tau) * 7.4, math.sin(i / 48 * math.tau) * 7.4) for i in range(48)], 0.008)
for r, w, look, gap in ((1.3, 0.07, PAINT_DIM, 0), (3.0, 0.12, PAINT_W, 0), (4.6, 0.36, ROAD, 0), (5.6, 0.07, PAINT_W, 0.14), (7.4, 0.26, PAINT_W, 0.16), (10.2, 0.11, PAINT_W, 0.11), (12.6, 0.06, PAINT_DIM, 0.1), (17.0, 0.12, PAINT_Y, 0.16), (21.5, 0.07, PAINT_DIM, 0.28)):
    if not gap:
        arc(paint, look, r, 0, math.tau, w)
        continue
    for q in range(4):
        arc(paint, look, r, q * math.pi / 2 + gap, (q + 1) * math.pi / 2 - gap, w)
for i in range(72):
    a = i / 72 * math.tau
    l0, l1 = (8.7, 9.15) if i % 6 else (8.4, 9.6)
    line(paint, PAINT_W if i % 6 == 0 else PAINT_DIM, [(math.cos(a) * l0, math.sin(a) * l0), (math.cos(a) * l1, math.sin(a) * l1)], 0.06)

for s in (-1, 1):
    # the attack axis: a double line from the rings to the deploy pad
    for off in (-0.55, 0.55):
        line(paint, PAINT_W, [(s * 13.0, off), (s * 22, off)], 0.13)
    fill(paint, ROAD, [(s * 7.6, -0.95), (s * 10.2, -0.95), (s * 10.2, -0.45), (s * 7.6, -0.45)])
    fill(paint, ROAD, [(s * 7.6, 0.45), (s * 10.2, 0.45), (s * 10.2, 0.95), (s * 7.6, 0.95)])
    # the cross axis: a service road between the side gates, interrupted by the centre rings
    for off in (-1.15, 1.15):
        line(paint, PAINT_W, [(off, s * 13), (off, s * 49)], 0.09)
    fill(paint, ROAD, [(-1.0, s * 13), (1.0, s * 13), (1.0, s * 21), (-1.0, s * 21)])
    fill(paint, ROAD, [(-1.0, s * 40), (1.0, s * 40), (1.0, s * 50), (-1.0, s * 50)])

    def pad(x0, x1, y):
        c = 5.0
        return [(s * x0, -y), (s * (x1 + c), -y), (s * x1, -y + c), (s * x1, y - c), (s * (x1 + c), y), (s * x0, y)]

    fill(paint, ASPH, pad(HX, HX - DEPLOY, 24))
    line(paint, PAINT_Y, pad(HX - 0.6, HX - DEPLOY + 0.6, 23.4), 0.1, True)
    line(paint, PAINT_W, pad(HX - 7, HX - DEPLOY + 5, 12), 0.13, True)
    tx = s * (HX - 12)
    for r in (0.9, 2.2):
        arc(paint, PAINT_W, r, 0, math.tau, 0.07, tx)
    line(paint, PAINT_DIM, [(tx - 3, 0), (tx + 3, 0)], 0.05)
    line(paint, PAINT_DIM, [(tx, -3), (tx, 3)], 0.05)
    for sy in (-1, 1):
        ly = HX - DEPLOY
        line(paint, PAINT_DIM, [(s * ly, sy * 24), (s * ly, sy * 45), (s * (ly + 6), sy * 47.4)], 0.06)
        line(paint, PAINT_DIM, [(s * 12.6, sy * 16), (s * 19, sy * 24.4)], 0.05)
        for a in (0.4, 0.68, 1.02):
            line(paint, PAINT_DIM, [(s * 21.8 * math.cos(a), sy * 21.8 * math.sin(a)), (s * 37 * math.cos(a), sy * 37 * math.sin(a))], 0.045)

gapA = 0.16
for x, y in ((17 * math.cos(gapA), 17 * math.sin(gapA)), (17 * math.sin(gapA), 17 * math.cos(gapA))):
    for sx in (-1, 1):
        for sy in (-1, 1):
            dot(paint, GLOW['amber'], sx * x, sy * y, 0.1)
# small lamps along the amber ring, every 15 degrees
for i in range(24):
    a = (i + 0.5) / 24 * math.tau
    dot(paint, GLOW['amber'], 17 * math.cos(a), 17 * math.sin(a), 0.07)
dot(paint, GLOW['cyan'], 0, 0, 0.18)
for i in range(8):
    a = i / 8 * math.tau
    dot(paint, GLOW['cyan'], 7.4 * math.cos(a + 0.39), 7.4 * math.sin(a + 0.39), 0.1)
dot(paint, GLOW['blue'], -(HX - 12), 0, 0.16)
dot(paint, GLOW['red'], HX - 12, 0, 0.16)
for s in (-1, 1):
    for y in (21, 40):
        dot(paint, GLOW['amber'], 0, s * y, 0.14)
    for x in (13, 22):
        for off in (-0.55, 0.55):
            dot(paint, GLOW['cyan'], s * x, off, 0.1)
    # lights along each pad's front edge and its decks
    for yy in (-14, -7, 0, 7, 14):
        dot(paint, GLOW['blue'] if s < 0 else GLOW['red'], s * (HX - DEPLOY + 0.2), yy, 0.12)

for look in list(paint.bms):
    paint.mesh(f'paint_{look.mat.name}', look, C_GLOW if look in GLOW.values() else C_PAINT)

field_mesh = bpy.data.meshes.new('field')
E = FIELD_EXT
FX, FY = HX + 0.6, HY + 0.6
field_mesh.from_pydata([(-FX, -FY, 0), (FX, -FY, 0), (FX, FY, 0), (-FX, FY, 0)], [], [(0, 1, 2, 3)])
field_mesh.materials.append(PAVE.mat)
field_obj = bpy.data.objects.new('field', field_mesh)
C_FIELD.objects.link(field_obj)
fuv = field_mesh.uv_layers.new(name='UVMap')
for i, (cx, cy) in enumerate(((-FX, -FY), (FX, -FY), (FX, FY), (-FX, FY))):
    fuv.data[i].uv = ((cx + E) / (2 * E), (cy + E) / (2 * E))

# ------------------------------------------------------------------------------------------------ architecture

k = Kit()


def cannon(x, y, z, s):
    """a coastal battery: a low armoured drum and a twin barrel laid across the field"""
    d = -s
    k.tier(ARMOR, octo(x - 3.2, x + 3.2, y - 3.2, y + 3.2, 1.1), z, 0.7, 0.3)
    k.tier(CONC, octo(x - 2.5, x + 2.9, y - 2.7, y + 2.7, 0.9), z + 0.7, 1.5, 0.5)
    k.tier(ARMOR, octo(x - 1.4, x + 1.6, y - 1.8, y + 1.8, 0.5), z + 2.2, 0.3)
    for off in (-1.0, 1.0):
        root = (x + d * 2.0, y + off, z + 1.5)
        k.tube(ARMOR, root, (x + d * 5, y + off, z + 1.8), 0.48, 0.34)
        k.tube(CONC, (x + d * 5, y + off, z + 1.8), (x + d * 7.5, y + off, z + 2.05), 0.32, 0.26)
        k.tube(ARMOR, (x + d * 6.8, y + off, z + 1.98), (x + d * 7.7, y + off, z + 2.07), 0.38, 0.38)


def plant(x, y, z, sx, sy, s):
    """a rooftop plant bay: a low housing, a row of vents and one pipe run, always laid out the same way"""
    k.box(CONC, x, y, z, sx, sy, 0.35, 0.1)
    n = max(2, int(sy / 1.6))
    for i in range(n):
        vy = y - sy / 2 + (i + 0.5) * sy / n
        k.tube(ARMOR, (x - s * sx * 0.2, vy, z + 0.35), (x - s * sx * 0.2, vy, z + 0.85), 0.32, 0.26, 8)
    k.tube(ARMOR, (x + s * sx * 0.25, y - sy * 0.42, z + 0.5), (x + s * sx * 0.25, y + sy * 0.42, z + 0.5), 0.12, 0.12, 6)


def citadel(s, glow):
    """BASE_DEPTH cells deep behind the back line: nothing here is playable, so it stays a thin, tall silhouette"""
    X = lambda u: s * (HX + u)
    P = lambda pts: [(X(u), y) for u, y in pts]
    # the forecourt: dark armoured deck behind the back line, edged by a slim kerb
    deck_poly = P([(0, -54), (BASE_DEPTH - 3, -54), (BASE_DEPTH, -48), (BASE_DEPTH, 48), (BASE_DEPTH - 3, 54), (0, 54)])
    k.loft(ARMOR, deck_poly, -3, deck_poly, 0.03)
    k.box(CONC, X(0.25), 0, 0, 0.5, 96, 0.22)
    # a broad lit threshold line across the forecourt, where the pad's lanes end
    k.box(glow, X(0.62), 0, 0.03, 0.14, 46, 0.04)

    # three great stepped tiers rising to the keep
    t1 = P([(4, -39), (8, -46), (22, -46), (22, 46), (8, 46), (4, 39)])
    t2 = P([(12, -30), (15, -37), (22.5, -37), (22.5, 37), (15, 37), (12, 30)])
    k.tier(CONC, t1, 0, 4.4, 1.3)
    k.tier(ARMOR, inset(t1, 1.3), 4.4, 0.5)
    k.tier(CONC, t2, 4.9, 3.8, 1.2)
    k.tier(ARMOR, inset(t2, 1.2), 8.7, 0.4)
    keep = P([(17, -12), (19, -15), (22.5, -15), (22.5, 15), (19, 15), (17, 12)])
    k.tier(CONC, keep, 9.1, 6.2, 1.0)
    k.tier(ARMOR, inset(keep, 1.0), 15.3, 1.3, 0.4)

    # pilasters give the long front wall a slow, regular rhythm; each bay carries an armoured panel and a lamp
    for y in (-35, -29, -23, -17, 17, 23, 29, 35):
        k.box(CONC, X(3.7), y, 0, 1.4, 1.4, 4.2, 0.3)
    for y in (-32, -26, -20, 20, 26, 32):
        k.box(ARMOR, X(4.0), y, 0.4, 0.9, 4.0, 2.6)
        k.box(GLOW['amber'], X(3.5), y, 3.25, 0.06, 3.0, 0.08)
    # lamp strips along the chamfers of each tier
    for sy in (-1, 1):
        for i in range(5):
            t = (i + 0.5) / 5
            k.box(GLOW['amber'], X(4.4 + t * 3.6), sy * (39.4 + t * 6.6), 3.6, 0.5, 0.5, 0.08)

    # the great gate: a recess, two leaves, one bright line above it, team-coloured bars either side
    k.box(ARMOR, X(3.4), 0, 0, 1.6, 20, 3.8)
    for off in (-5, 5):
        k.box(CONC, X(2.5), off, 0, 0.5, 9.3, 3.2)
    k.box(ARMOR, X(2.2), 0, 0, 0.5, 0.5, 3.2)
    k.box(glow, X(2.5), 0, 3.42, 0.18, 19, 0.2)
    for y in (-14.5, 14.5):
        k.box(CONC, X(3.2), y, 0, 2.6, 4, 5.4, 0.5)
        for off in (-1.1, 0, 1.1):
            k.box(glow, X(1.92), y + off, 0.9, 0.14, 0.34, 3.2)

    # batteries on the first terrace, covering the field
    for sy in (-1, 1):
        cannon(X(8.7), sy * 21, 4.9, s)

    # the roofs are what the camera sees most: plant bays and skylights laid out in strict rows
    for y in (-33, -12, 0, 12, 33):
        plant(X(8), y, 4.9, 3.6, 5.2, s)
    for sy in (-1, 1):
        for u in (11, 15, 19):
            plant(X(u), sy * 41.3, 4.9, 3.6, 5.2, s)
        for y in (19, 24.5, 30):
            k.box(CONC, X(17.5), sy * y, 9.1, 7, 3.6, 0.3, 0.1)
            k.box(glow, X(13.9), sy * y, 9.1, 0.1, 3.0, 0.14)

    # the keep: a tall slit of team colour, an observation deck, and masts
    k.box(glow, X(16.9), 0, 10.2, 0.16, 0.9, 4.2)
    for y in (-7, 7):
        k.box(ARMOR, X(17.2), y, 9.1, 1.4, 2.4, 4.8, 0.3)
        k.box(glow, X(16.45), y, 10.4, 0.1, 0.4, 2.6)
    k.tier(ARMOR, octo(X(20) - 1.5, X(20) + 1.5, -4, 4, 0.7), 16.6, 0.9, 0.3)
    k.box(glow, X(20), 0, 17.5, 1.0, 1.4, 0.06)
    k.tube(ARMOR, (X(20), -9, 16.6), (X(20), -9, 26), 0.26, 0.05, 6)
    k.tube(ARMOR, (X(20), 9, 16.6), (X(20), 9, 23), 0.26, 0.05, 6)
    k.box(glow, X(20), -9, 26, 0.18, 0.18, 0.22)

    # corner towers: the silhouette at the edges of the field
    for sy in (-1, 1):
        cx, cy = X(6), sy * 49.5
        r = 4.6
        k.tier(CONC, octo(cx - r, cx + r, cy - r, cy + r, 1.5), 0, 6.8, 1.0)
        k.tier(ARMOR, octo(cx - r + 1, cx + r - 1, cy - r + 1, cy + r - 1, 1.1), 6.8, 0.8, 0.2)
        k.tier(CONC, octo(cx - 1.9, cx + 1.9, cy - 1.9, cy + 1.9, 0.6), 7.6, 1.5, 0.3)
        k.tube(ARMOR, (cx, cy, 9.1), (cx, cy, 15), 0.16, 0.04, 6)
        for off in (-1.2, 0, 1.2):
            k.box(glow, cx - s * (r + 0.02), cy + off, 2.0, 0.12, 0.34, 2.6)
        # low lamps along the back line, either side of the deploy pad
        for y in (26, 30, 34, 38):
            k.box(GLOW['amber'], X(0.7), sy * y, 0.03, 0.8, 0.12, 0.06)


for s, glow in ((-1, GLOW['blue']), (1, GLOW['red'])):
    citadel(s, glow)

# the sea wall along both flanks: a long battered curtain with buttresses and two gate towers
for sy in (-1, 1):
    Y = lambda v: sy * (HY + v)
    k.box(CONC, 0, Y(0.6), 0, 92, 0.5, 0.25)
    for x0, x1 in ((-41, -7), (7, 41)):
        k.tier(CONC, rect(x0, x1, Y(1.6), Y(9.2)), -3, 5.4, 1.9)
        k.tier(ARMOR, rect(x0 + 1.9, x1 - 1.9, Y(2.6), Y(7.3)), 2.4, 0.18)
        for x in np.arange(x0 + 5, x1 - 2, 8.0):
            k.tier(CONC, rect(float(x) - 1.3, float(x) + 1.3, Y(8), Y(11.4)), -3, 4.6, 0.9)
            k.box(GLOW['amber'], float(x), Y(1.55), 1.0, 1.2, 0.1, 0.14)
            k.box(GLOW['amber'], float(x), Y(5), 2.58, 0.5, 0.5, 0.05)
    k.box(ARMOR, 0, Y(5), -3, 14, 9, 3.05)
    for x in (-5.2, 5.2):
        k.tier(CONC, rect(x - 3.2, x + 3.2, Y(1.2), Y(11.5)), -3, 11.4, 1.4)
        k.tier(ARMOR, rect(x - 1.8, x + 1.8, Y(2.8), Y(9.8)), 8.4, 0.5, 0.2)
        k.box(GLOW['cyan'], x, Y(1.12), 1.6, 0.4, 0.08, 3.4)

for look in list(k.bms):
    k.mesh(f'struct_{look.mat.name}', look, C_STRUCT, mapped=look in (CONC, ARMOR))

# ------------------------------------------------------------------------------------------------ land, rocks, shore


def fbm(x, y, oct=5, base=0.05, seed=1):
    lat = np.random.RandomState(seed).rand(512, 512)
    v, amp, f, tot = 0.0, 0.5, base, 0.0
    for _ in range(oct):
        fx, fy = x * f + 1000, y * f + 1000
        xi, yi = np.floor(fx).astype(int), np.floor(fy).astype(int)
        tx, ty = fx - xi, fy - yi
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        at = lambda a, b: lat[a & 511, b & 511]
        n = at(xi, yi) * (1 - tx) * (1 - ty) + at(xi + 1, yi) * tx * (1 - ty) + at(xi, yi + 1) * (1 - tx) * ty + at(xi + 1, yi + 1) * tx * ty
        v, tot, amp, f = v + n * amp, tot + amp, amp * 0.5, f * 2.03
    return v / tot


def island_height(x, y):
    qx, qy = np.abs(x) - (HX + BASE_DEPTH + 3), np.abs(y) - 60
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)
    d = d + (fbm(x, y, 5, 0.03, 3) - 0.5) * 12
    crag = ridged(fbm(x, y, 6, 0.06, 4)) ** 1.6
    z = -d * 0.42 + np.clip(d + 1, 0, 9) / 9 * (crag * 5.5 - 1.0)
    return np.where(d < -4, -0.1, z)


N = 241
xs = np.linspace(-LAND_EXT, LAND_EXT, N)
gx, gy = np.meshgrid(xs, xs, indexing='xy')
gz = island_height(gx, gy)
for _ in range(2):  # no sawtooth down the steep faces
    gz[1:-1, 1:-1] = (gz[1:-1, 1:-1] * 2 + gz[:-2, 1:-1] + gz[2:, 1:-1] + gz[1:-1, :-2] + gz[1:-1, 2:]) / 6
# only what stands near or above the water, outside the field; the rest would be triangles nobody sees
land_faces = [(j * N + i, j * N + i + 1, (j + 1) * N + i + 1, (j + 1) * N + i) for j in range(N - 1) for i in range(N - 1) if gz[j:j + 2, i:i + 2].max() > WATER_Z - 1 and (abs(xs[i]) > HX - 2 or abs(xs[j]) > HY - 2)]
land_mesh = bpy.data.meshes.new('land')
land_mesh.from_pydata(np.stack((gx, gy, gz), -1).reshape(-1, 3).tolist(), [], land_faces)
bm_land = bmesh.new()
bm_land.from_mesh(land_mesh)
bmesh.ops.delete(bm_land, geom=[v for v in bm_land.verts if not v.link_faces], context='VERTS')
bm_land.to_mesh(land_mesh)
bm_land.free()
for p in land_mesh.polygons:
    p.use_smooth = True
land_obj = bpy.data.objects.new('land', land_mesh)
scene.collection.objects.link(land_obj)

rocks = []
rock_objs = []


def crag(x, y, size):
    """a sea stack: an icosphere cut by ridged noise and a few hard fracture planes, narrowing toward its peak"""
    b = bmesh.new()
    bmesh.ops.create_icosphere(b, subdivisions=4, radius=1)
    waves = []
    freq, amp = 1.7, 0.2
    for _ in range(5):
        d = np.array((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-0.4, 0.4)))
        waves.append((d / np.linalg.norm(d) * freq, random.uniform(0, 6), amp))
        freq, amp = freq * 1.95, amp * 0.55
    cuts = [np.array((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(0.0, 0.9))) for _ in range(7)]
    cuts = [c / np.linalg.norm(c) for c in cuts]
    tall = random.uniform(1.0, 1.7)
    for v in b.verts:
        co = np.array(v.co)
        d = 0.82 + sum((1 - abs(math.sin(co @ w[0] + w[1]))) * w[2] for w in waves)
        for c in cuts:
            h = co @ c
            if h > 0.62:
                d = min(d, 0.8 / h)
        taper = 1 - 0.62 * max(co[2], 0)
        v.co = (x + co[0] * d * size * taper, y + co[1] * d * size * taper, max(WATER_Z - 3, (co[2] * d - 0.08) * size * tall))
    m = bpy.data.meshes.new('r')
    b.to_mesh(m)
    b.free()
    for p in m.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new('rock', m)
    scene.collection.objects.link(o)
    rock_objs.append(o)
    rocks.append((x, y, size))


for sx in (-1, 1):
    for sy in (-1, 1):
        for cx, cy, spread, n, s0, s1 in ((14, 68, 6, 2, 3.5, 6), (34, 68, 7, 3, 4, 7), (55, 68, 6, 3, 4.5, 8), (66, 68, 5, 3, 4.5, 8), (78, 52, 5, 2, 4, 7), (80, 25, 5, 2, 3.5, 6)):
            for _ in range(n):
                crag(sx * (cx + random.uniform(-spread, spread)), sy * (cy + random.uniform(-2.5, spread * 0.7)), random.uniform(s0, s1))

# shore distance: 0 at the waterline, 1 at 30 cells or more
M = 512
mx = np.linspace(-LAND_EXT, LAND_EXT, M)
ax, ay = np.meshgrid(mx, mx, indexing='xy')
solid = island_height(ax, ay) > WATER_Z
for x, y, s in rocks:
    solid |= (ax - x) ** 2 + (ay - y) ** 2 < (s * 0.72) ** 2
cell = 2 * LAND_EXT / (M - 1)


def edt_1d(f):
    """squared distance transform of one line (Felzenszwalb & Huttenlocher)"""
    n = len(f)
    v, z, j = [0] * n, [0.0] * (n + 1), 0
    z[0], z[1] = -1e20, 1e20
    for q in range(1, n):
        while True:
            s_ = (f[q] + q * q - f[v[j]] - v[j] * v[j]) / (2 * (q - v[j]))
            if s_ > z[j]:
                break
            j -= 1
        j += 1
        v[j], z[j], z[j + 1] = q, s_, 1e20
    out, j = [0.0] * n, 0
    for q in range(n):
        while z[j + 1] < q:
            j += 1
        out[q] = (q - v[j]) ** 2 + f[v[j]]
    return out


sq = np.where(solid, 0.0, 1e10)
sq = np.array([edt_1d(col.tolist()) for col in sq.T]).T
sq = np.array([edt_1d(row.tolist()) for row in sq])
shore = np.clip(np.sqrt(sq) * cell / 30, 0, 1)

# ------------------------------------------------------------------------------------------------ rendering

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.clip_end = 1000
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = (0, 0, 200)
scene.camera = cam


def show(camera=(), shadow=()):
    """collections seen by the camera; `shadow` ones are unseen but still occlude light (contact shading)"""
    land_obj.hide_render = True
    for o in rock_objs:
        o.hide_render = True
    for c in (C_FIELD, C_PAINT, C_GLOW, C_STRUCT):
        for o in c.objects:
            o.hide_render = c not in camera and c not in shadow
            o.visible_camera = c in camera


def render(path, ext, res, samples, transform='Standard', ambient=1.0):
    cam_data.ortho_scale = ext * 2
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.view_settings.view_transform = transform
    scene.view_settings.look = 'None'
    world_bg.inputs['Color'].default_value = (1, 1, 1, 1)
    world_bg.inputs['Strength'].default_value = ambient
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path)


os.makedirs(OUT, exist_ok=True)

show((C_FIELD, C_PAINT, C_GLOW), (C_STRUCT,))
set_mode('shaded')
# the structures' long shadows, baked: a wide soft sun (the game's sun direction, in map axes) plus sky, adding up to
# exactly the albedo wherever nothing blocks it
TO_SUN = np.array((24.0, 34.0, 22.0)) / np.linalg.norm((24.0, 34.0, 22.0))
sun = bpy.data.lights.new('sun', 'SUN')
sun.angle = math.radians(14)
sun.energy = 0.45 * math.pi / TO_SUN[2]
sun_obj = bpy.data.objects.new('sun', sun)
sun_obj.rotation_euler = (math.acos(TO_SUN[2]), 0, math.atan2(TO_SUN[0], -TO_SUN[1]))
scene.collection.objects.link(sun_obj)
render(os.path.join(TMP, 'field_albedo.png'), FIELD_EXT, 4096, 48, ambient=0.55)
bpy.data.objects.remove(sun_obj)

show((C_FIELD, C_PAINT, C_GLOW))
set_mode('normal')
render(os.path.join(TMP, 'field_normal.png'), FIELD_EXT, 2048, 4, 'Raw')
set_mode('shaded')

show((C_GLOW,))
cam_data.ortho_scale = FIELD_EXT * 2
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.cycles.samples = 4
scene.view_settings.view_transform = 'Standard'
world_bg.inputs['Strength'].default_value = 0
scene.render.filepath = os.path.join(TMP, 'field_emissive.png')
bpy.ops.render.render(write_still=True)

# ------------------------------------------------------------------------------------------------ export


def textured(name, albedo, normal=None, emissive=None, emit=1.3, rough=1.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Specular IOR Level'].default_value = 0.25

    def tex(path, non_color=False):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(path)
        if non_color:
            t.image.colorspace_settings.name = 'Non-Color'
        return t

    nt.links.new(tex(albedo).outputs['Color'], b.inputs['Base Color'])
    if normal:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tex(normal, True).outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if emissive:
        nt.links.new(tex(emissive).outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emit
    return m


def tmp_png(name, a):
    return write_png(os.path.join(TMP, name + '.png'), a)


field_mesh.materials[0] = textured('field', os.path.join(TMP, 'field_albedo.png'), os.path.join(TMP, 'field_normal.png'), os.path.join(TMP, 'field_emissive.png'))
cc, cn = concrete_textures()
ac, an = armor_textures()
conc_mat = textured('concrete', tmp_png('concrete_c', cc), tmp_png('concrete_n', cn), rough=0.9)
armor_mat = textured('armor', tmp_png('armor_c', ac), tmp_png('armor_n', an), rough=0.6, metal=0.5)

for look, m in [(CONC, conc_mat), (ARMOR, armor_mat)] + [(g, None) for g in GLOW.values()]:
    if m is None:
        m = bpy.data.materials.new(look.mat.name + '_x')
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        em = next(n for n in look.nt.nodes if n.type == 'EMISSION' and n.inputs['Strength'].default_value > 1)
        b.inputs['Base Color'].default_value = (0, 0, 0, 1)
        b.inputs['Emission Color'].default_value = em.inputs['Color'].default_value
        b.inputs['Emission Strength'].default_value = em.inputs['Strength'].default_value
    for o in C_STRUCT.objects:
        for i, slot in enumerate(o.data.materials):
            if slot == look.mat:
                o.data.materials[i] = m

# all crags become one mesh, thinned down: one draw call
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = rock_objs[0]
for o in rock_objs:
    o.select_set(True)
bpy.ops.object.join()
rocks_obj = bpy.context.view_layer.objects.active
rocks_obj.name = 'rocks'
rocks_obj.modifiers.new('dec', 'DECIMATE').ratio = 0.2

for c in (C_PAINT, C_GLOW):
    for o in list(c.objects):
        bpy.data.objects.remove(o)

C_CLOUD = collection('clouds')
cloud_mat = bpy.data.materials.new('cloud')
cloud_mat.use_nodes = True
cloud_mat.surface_render_method = 'BLENDED'
cnt = cloud_mat.node_tree
cb = cnt.nodes['Principled BSDF']
ct = cnt.nodes.new('ShaderNodeTexImage')
ct.image = bpy.data.images.load(tmp_png('cloud', cloud_texture()))
cnt.links.new(ct.outputs['Color'], cb.inputs['Base Color'])
cnt.links.new(ct.outputs['Alpha'], cb.inputs['Alpha'])
cb.inputs['Roughness'].default_value = 1
# the corners of the view
for i, (x, y, z, h, rot) in enumerate(((-58, 78, 20, 24, 0.4), (62, 74, 18, 22, 2.1), (66, -80, 20, 26, 4.0), (-62, -74, 18, 22, 5.2), (-30, 88, 19, 18, 1.3), (34, -90, 18, 18, 3.1))):
    c_, s_ = math.cos(rot), math.sin(rot)
    me = bpy.data.meshes.new(f'cloud{i}')
    me.from_pydata([(x + a * c_ - b * s_, y + a * s_ + b * c_, z) for a, b in ((-h, -h), (h, -h), (h, h), (-h, h))], [], [(0, 1, 2, 3)])
    me.materials.append(cloud_mat)
    u = me.uv_layers.new(name='UVMap')
    for j, co in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        u.data[j].uv = co
    C_CLOUD.objects.link(bpy.data.objects.new(f'cloud{i}', me))

bpy.ops.object.select_all(action='SELECT')
cam.select_set(False)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'map.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
    export_image_format='WEBP', export_image_quality=84, export_cameras=False, export_lights=False,
)

write_png(os.path.join(OUT, 'shore.png'), np.flipud(shore))
write_webp(os.path.join(OUT, 'water.webp'), water_texture())
write_webp(os.path.join(OUT, 'rock.webp'), rock_texture())
print('done', OUT)
