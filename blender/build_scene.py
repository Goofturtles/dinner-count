"""Dinner Count - procedural Blender scene, GLB export and renders (Blender 4.5, headless).

Everything is modelled in code (bmesh revolves with Chaikin-smoothed profiles, swept tubes,
a rigid-body penne drop, Poisson-scattered rice grains). No downloaded assets.

Run from the dinner-count/ folder (see README.md for the full pipeline):
  blender -b --factory-startup -P blender/build_scene.py -- build     # model, save .blend, export GLBs
  blender -b blender/dinner_count.blend -P blender/build_scene.py -- preview
  blender -b blender/dinner_count.blend -P blender/build_scene.py -- dishes
  blender -b blender/dinner_count.blend -P blender/build_scene.py -- hero
  blender -b --factory-startup -P blender/build_scene.py -- matcaps
  blender -b --factory-startup -P blender/build_scene.py -- verify
  python blender/post.py                                              # PNG -> WebP, size log

Renders use Cycles on the CPU with a pause between frames, so the GPU is never loaded.
"""
import bpy
import bmesh
import math
import os
import random
import sys
import time
import numpy as np
from mathutils import Vector, Matrix, Quaternion, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "public", "assets")
RENDERS = os.path.join(HERE, "renders")
BLEND = os.path.join(HERE, "dinner_count.blend")
CM = 0.01
PAUSE = 2.0          # seconds between renders
TABLE_EXPOSURE = -1.5
DISH_EXPOSURE = -1.4
THREADS = 20         # of 32 logical CPUs (~62%)

# ---------------------------------------------------------------- layout (metres, Z up)
PLATE_XY = (-0.42, 0.02)
PLATE_PITCH = 0.0103          # nesting height of one plate on the next
POT_XY = (-0.02, 0.10)
PASTA_XY = (0.17, -0.12)
BOWL_XY = (0.40, 0.03)
DISH_ORIGIN = Vector((0.0, 6.0, 0.0))   # studio for the picker art, far from the table

# camera path: (frame, position, look-at target)
CAM_KEYS = [
    (0,   (-0.66, -0.40, 0.30), (-0.42, 0.02, 0.035)),   # plate stack
    (48,  (-0.55, -0.45, 0.27), (-0.41, 0.02, 0.035)),
    (72,  (-0.02, -0.66, 0.38), (0.06, -0.035, 0.050)),  # pot + pasta
    (118, (0.11, -0.63, 0.35),  (0.08, -0.035, 0.050)),
    (142, (0.49, -0.27, 0.21),  (0.40, 0.04, 0.045)),    # rice bowl
    (200, (0.54, -0.22, 0.18),  (0.40, 0.04, 0.045)),
    (240, (0.00, -1.12, 0.80),  (0.00, 0.02, 0.100)),    # wide hero
]
LENS_MM = 40.0
MOBILE_POS, MOBILE_TGT = (1.15, -0.50, 1.05), (0.00, 0.03, 0.12)   # portrait hero camera

# ---------------------------------------------------------------- profiles (cm, (r, z))
# Traversed counter-clockwise in the (r, z) plane so revolved normals face outward.
# A repeated point keeps that corner crisper through Chaikin smoothing.
PLATE = [(0, 0.55), (6.6, 0.55), (7.15, 0.45), (7.35, 0.08), (7.6, 0.0), (7.6, 0.0), (8.3, 0.0),
         (8.3, 0.0), (8.55, 0.08), (8.85, 0.45), (11.0, 1.15), (13.0, 1.85), (13.45, 2.02),
         (13.58, 2.2), (13.45, 2.38), (13.0, 2.44), (10.3, 1.55), (9.5, 1.1), (8.8, 1.0), (0, 1.0)]
POT = [(0, 0.0), (9.6, 0.0), (10.6, 0.12), (11.2, 0.6), (11.45, 1.4), (11.5, 2.2), (11.5, 12.9),
       (11.55, 13.5), (11.8, 13.85), (11.95, 14.15), (11.8, 14.4), (11.5, 14.42), (11.25, 14.2),
       (11.2, 13.6), (11.2, 2.3), (11.1, 1.2), (10.6, 0.6), (9.6, 0.42), (0, 0.42)]
LID = [(0, 1.05), (5, 0.85), (9.5, 0.42), (10.75, 0.28), (10.85, -0.55), (11.0, -0.62),
       (11.12, -0.4), (11.2, -0.05), (11.5, 0.0), (11.95, 0.05), (12.1, 0.2), (11.95, 0.36),
       (11.4, 0.45), (9.5, 0.72), (5, 1.2), (1.6, 1.36), (1.0, 1.42), (0.85, 1.6), (0.8, 2.3),
       (1.3, 2.5), (1.9, 2.8), (2.05, 3.3), (1.8, 3.7), (1.0, 3.92), (0, 3.95)]
RICE_BOWL = [(0, 0.4), (2.7, 0.4), (2.85, 0.05), (3.0, 0.0), (3.0, 0.0), (3.5, 0.0), (3.5, 0.0),
             (3.7, 0.15), (3.9, 0.6), (5.2, 1.8), (6.2, 3.8), (6.55, 5.6), (6.6, 6.2), (6.5, 6.35),
             (6.35, 6.25), (6.3, 5.6), (5.9, 3.8), (4.6, 1.6), (3.0, 0.85), (0, 0.75)]
WIDE_BOWL = [(0, 0.4), (3.8, 0.4), (4.0, 0.05), (4.2, 0.0), (4.2, 0.0), (4.8, 0.0), (4.8, 0.0),
             (5.0, 0.15), (5.3, 0.55), (7.5, 1.6), (9.0, 3.3), (9.9, 4.9), (10.1, 5.35),
             (9.95, 5.55), (9.7, 5.45), (9.25, 4.6), (8.2, 3.0), (6.6, 1.55), (4.5, 0.9), (0, 0.8)]


def log(*a):
    print("[dc]", *a, flush=True)


# ================================================================ geometry helpers
def chaikin(pts, iters=2):
    pts = [Vector(p) for p in pts]
    for _ in range(iters):
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            out.append(a.lerp(b, 0.25))
            out.append(a.lerp(b, 0.75))
        out.append(pts[-1])
        ded = [out[0]]
        for p in out[1:]:
            if (p - ded[-1]).length > 1e-4:
                ded.append(p)
        pts = ded
    return [(p.x, p.y) for p in pts]


def inner_part(prof):
    """Inner (food-side) surface of a smoothed vessel profile: from the rim top down to the axis."""
    top = max(range(len(prof)), key=lambda i: prof[i][1])
    return prof[top:]


def inner_r(prof, z):
    inner = inner_part(prof)
    for (r0, z0), (r1, z1) in zip(inner[:-1], inner[1:]):
        if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-9:
            t = (z - z0) / (z1 - z0)
            return r0 + (r1 - r0) * t
    return inner[-1][0]


def revolve_into(bm, prof, segs, M=None, s=CM, uv_rect=None):
    """Spin an (r, z) profile. uv_rect=(u0,v0,u1,v1) lays out u = angle, v = profile arc length."""
    M = M or Matrix.Identity(4)
    rings = []
    for (r, z) in prof:
        if r < 1e-6:
            v = bm.verts.new(M @ Vector((0.0, 0.0, z * s)))
            rings.append([v] * segs)
        else:
            rings.append([bm.verts.new(M @ Vector((r * s * math.cos(2 * math.pi * i / segs),
                                                    r * s * math.sin(2 * math.pi * i / segs), z * s)))
                          for i in range(segs)])
    uvl = bm.loops.layers.uv.verify() if uv_rect else None
    acc = [0.0]
    for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
        acc.append(acc[-1] + math.hypot(r1 - r0, z1 - z0))
    tot = acc[-1] or 1.0
    u0, v0, u1, v1 = uv_rect or (0, 0, 1, 1)
    for j, (A, B) in enumerate(zip(rings[:-1], rings[1:])):
        for i in range(segs):
            i2 = (i + 1) % segs
            vs, uvs = [], []
            for v, ui, vj in ((A[i], i, j), (A[i2], i + 1, j), (B[i2], i + 1, j + 1), (B[i], i, j + 1)):
                if all(v is not w for w in vs):
                    vs.append(v)
                    uu = i + 0.5 if prof[vj][0] < 1e-6 else ui
                    uvs.append((u0 + (u1 - u0) * uu / segs, v0 + (v1 - v0) * acc[vj] / tot))
            if len(vs) >= 3:
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                if uvl:
                    for loop, uv in zip(f.loops, uvs):
                        loop[uvl].uv = uv


def catmull(pts, n=6, closed=False):
    P = [Vector(p) for p in pts]
    out = []
    count = len(P) if closed else len(P) - 1
    for i in range(count):
        p0 = P[(i - 1) % len(P)] if closed or i > 0 else P[0]
        p1 = P[i]
        p2 = P[(i + 1) % len(P)]
        p3 = P[(i + 2) % len(P)] if closed or i + 2 < len(P) else P[-1]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1])
    return out


def sweep_into(bm, path, radius, segs=12, closed=False, caps=True, M=None, flat=1.0,
               up=Vector((0, 0, 1)), uv_rect=None):
    """Tube along `path`. radius: float or f(t). flat scales the cross-section's 'up' axis."""
    M = M or Matrix.Identity(4)
    n = len(path)
    rings = []
    for i, p in enumerate(path):
        if closed:
            t = path[(i + 1) % n] - path[(i - 1) % n]
        else:
            t = path[min(i + 1, n - 1)] - path[max(i - 1, 0)]
        t = t.normalized()
        u = up - t * up.dot(t)
        if u.length < 1e-6:
            u = Vector((1, 0, 0)) - t * t.x
        u.normalize()
        b = t.cross(u)
        R = radius(i / max(n - 1, 1)) if callable(radius) else radius
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ring.append(bm.verts.new(M @ (p + b * (math.cos(a) * R) + u * (math.sin(a) * R * flat))))
        rings.append(ring)
    nr = len(rings)
    pairs = [(i, i + 1) for i in range(nr - 1)] + ([(nr - 1, 0)] if closed else [])
    uvl = bm.loops.layers.uv.verify() if uv_rect else None
    u0, v0, u1, v1 = uv_rect or (0, 0, 1, 1)
    span = nr if closed else max(nr - 1, 1)
    for ia, ib in pairs:
        A, B = rings[ia], rings[ib]
        vb = ib if ib != 0 else nr
        for k in range(segs):
            k2 = (k + 1) % segs
            f = bm.faces.new((A[k], B[k], B[k2], A[k2]))
            if uvl:
                for loop, (ku, iv) in zip(f.loops, ((k, ia), (k, vb), (k + 1, vb), (k + 1, ia))):
                    loop[uvl].uv = (u0 + (u1 - u0) * ku / segs, v0 + (v1 - v0) * iv / span)
    if caps and not closed:
        for f in (bm.faces.new(rings[0]), bm.faces.new(list(reversed(rings[-1])))):
            if uvl:
                for loop in f.loops:
                    loop[uvl].uv = (u0 + 0.001, v0 + 0.001)


def penne_into(bm, M, s=1.0):
    """One penne rigate: ridged tube with parallel 45-degree cuts. Axis = local Z, centred."""
    L, ro, ri, n, rings, k = 0.040 * s, 0.0050 * s, 0.0041 * s, 20, 5, 1.0
    O, I = [], []
    for j in range(rings):
        t = j / (rings - 1)
        oring, iring = [], []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = ro * (1.045 if i % 2 == 0 else 0.955)
            xo, yo = rr * math.cos(a), rr * math.sin(a)
            xi, yi = ri * math.cos(a), ri * math.sin(a)
            oring.append(bm.verts.new(M @ Vector((xo, yo, -L / 2 + k * xo + t * L))))
            iring.append(bm.verts.new(M @ Vector((xi, yi, -L / 2 + k * xi + t * L))))
        O.append(oring)
        I.append(iring)
    for j in range(rings - 1):
        for i in range(n):
            i2 = (i + 1) % n
            bm.faces.new((O[j][i], O[j][i2], O[j + 1][i2], O[j + 1][i]))
            bm.faces.new((I[j][i], I[j + 1][i], I[j + 1][i2], I[j][i2]))
    for i in range(n):
        i2 = (i + 1) % n
        bm.faces.new((O[0][i], I[0][i], I[0][i2], O[0][i2]))
        bm.faces.new((O[-1][i], O[-1][i2], I[-1][i2], I[-1][i]))


def ellipsoid_into(bm, M, rx, ry, rz, u=8, v=6, disp=None):
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=u, v_segments=v, radius=1.0)
    for vert in tmp.verts:
        c = vert.co
        d = disp(c) if disp else 1.0
        vert.co = Vector((c.x * rx * d, c.y * ry * d, c.z * rz * d))
    append_bm(bm, tmp, M)
    tmp.free()


def append_bm(dst, src, M):
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(M @ v.co)
    for f in src.faces:
        try:
            nf = dst.faces.new([vmap[v] for v in f.verts])
            nf.material_index = f.material_index
        except ValueError:
            pass


def bm_to_mesh(bm, name, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    return me


def get_coll(name, parent=None):
    parent = parent or bpy.context.scene.collection
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
    if parent.children.get(name) is None:
        parent.children.link(c)
    return c


def new_obj(name, me, coll, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, me)
    o.location = loc
    coll.objects.link(o)
    return o


def set_mat(me, *mats):
    me.materials.clear()
    for m in mats:
        me.materials.append(m)


def rand_quat(rnd):
    u1, u2, u3 = rnd.random(), rnd.random(), rnd.random()
    return Quaternion((math.sqrt(u1) * math.cos(2 * math.pi * u3),
                       math.sqrt(1 - u1) * math.sin(2 * math.pi * u2),
                       math.sqrt(1 - u1) * math.cos(2 * math.pi * u2),
                       math.sqrt(u1) * math.sin(2 * math.pi * u3)))


def frame_from(n, t, p):
    """4x4 with local X = n (normal), local Z = t (long axis), origin p."""
    y = t.cross(n)
    m = Matrix((n, y, t)).transposed().to_4x4()
    m.translation = p
    return m


# ================================================================ materials
def sock(coll, ident):
    return next(s for s in coll if s.identifier == ident)


def principled(name, color, rough=0.5, metal=0.0, sss=0.0, sss_radius=(1.0, 0.5, 0.3),
               sss_scale=0.005, coat=0.0, coat_rough=0.05, spec=0.5, var=None, bump=None,
               stretch=(1, 1, 1)):
    """var = (color2, noise_scale, lo, hi) colour variation; bump = (strength, scale)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Subsurface Weight"].default_value = sss
    b.inputs["Subsurface Radius"].default_value = sss_radius
    b.inputs["Subsurface Scale"].default_value = sss_scale
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    b.inputs["Specular IOR Level"].default_value = spec
    tc = None
    if var or bump:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = stretch
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    if var:
        c2, scale, lo, hi = var
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = 6
        nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = lo
        mr.inputs["From Max"].default_value = hi
        nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        sock(mix.inputs, "A_Color").default_value = (*color, 1)
        sock(mix.inputs, "B_Color").default_value = (*c2, 1)
        nt.links.new(mr.outputs["Result"], sock(mix.inputs, "Factor_Float"))
        nt.links.new(sock(mix.outputs, "Result_Color"), b.inputs["Base Color"])
    if bump:
        strength, bscale = bump
        nz2 = nt.nodes.new("ShaderNodeTexNoise")
        nz2.inputs["Scale"].default_value = bscale
        nz2.inputs["Detail"].default_value = 8
        nt.links.new(mp.outputs["Vector"], nz2.inputs["Vector"])
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = strength
        bp.inputs["Distance"].default_value = 0.0005
        nt.links.new(nz2.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def potato_skin():
    """Golden potato skin with dark speckles and eyes; object space is centimetres."""
    m = principled("potato_skin", (0.50, 0.34, 0.15), rough=0.7,
                   var=((0.66, 0.48, 0.24), 0.9, 0.3, 0.7), bump=(0.25, 2.5))
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    mix_out = b.inputs["Base Color"].links[0].from_socket
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 2.2
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 0.09
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    nt.links.new(vor.outputs["Distance"], mr.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sock(mix.inputs, "B_Color").default_value = (0.20, 0.12, 0.05, 1)
    nt.links.new(mix_out, sock(mix.inputs, "A_Color"))
    nt.links.new(mr.outputs["Result"], sock(mix.inputs, "Factor_Float"))
    nt.links.new(sock(mix.outputs, "Result_Color"), b.inputs["Base Color"])
    return m


def make_materials():
    M = {}
    M["ceramic"] = principled("ceramic_proc", (0.905, 0.863, 0.791), rough=0.3, coat=0.8, coat_rough=0.04,
                              sss=0.05, sss_radius=(1, 0.8, 0.6), sss_scale=0.002)
    M["metal"] = principled("metal_render", (0.80, 0.76, 0.71), rough=0.2, metal=1.0,
                            bump=(0.04, 900), stretch=(1, 1, 30))
    M["pasta"] = principled("pasta_render", (0.80, 0.50, 0.10), rough=0.42, sss=0.3, sss_radius=(1, 0.55, 0.15),
                            sss_scale=0.004, var=((0.92, 0.64, 0.18), 260, 0.35, 0.65),
                            bump=(0.08, 1800))
    M["rice"] = principled("rice_render", (0.86, 0.85, 0.80), rough=0.35, sss=0.6, sss_radius=(1, 0.9, 0.75),
                           sss_scale=0.002, coat=0.2)
    M["wood"] = principled("wood", (0.034, 0.023, 0.015), rough=0.6, coat=0.0, spec=0.06,
                           var=((0.058, 0.040, 0.027), 7, 0.3, 0.7), bump=(0.03, 60),
                           stretch=(1.2, 22, 1.2))
    M["sauce"] = principled("chili_sauce", (0.30, 0.055, 0.025), rough=0.3, coat=0.35, coat_rough=0.1,
                            sss=0.2, sss_radius=(1, 0.3, 0.2), sss_scale=0.003,
                            var=((0.46, 0.11, 0.035), 120, 0.3, 0.7), bump=(0.15, 300))
    M["bean"] = principled("bean", (0.22, 0.035, 0.03), rough=0.22, coat=0.4,
                           var=((0.32, 0.07, 0.05), 400, 0.3, 0.7))
    M["meat"] = principled("meat", (0.20, 0.085, 0.04), rough=0.55, bump=(0.4, 900),
                           var=((0.30, 0.13, 0.06), 500, 0.3, 0.7))
    M["cream"] = principled("sour_cream", (0.90, 0.88, 0.83), rough=0.28, sss=0.5,
                            sss_radius=(1, 0.95, 0.9), sss_scale=0.004)
    M["onion"] = principled("green_onion", (0.16, 0.42, 0.06), rough=0.3, sss=0.3,
                            sss_radius=(0.6, 1, 0.4), sss_scale=0.002)
    M["cheese"] = principled("cheddar", (0.85, 0.42, 0.06), rough=0.35, sss=0.4,
                             sss_radius=(1, 0.6, 0.2), sss_scale=0.003)
    M["broth"] = principled("broth", (0.60, 0.29, 0.05), rough=0.04, spec=0.6,
                            var=((0.70, 0.38, 0.08), 40, 0.35, 0.65))
    M["carrot"] = principled("carrot", (0.88, 0.28, 0.02), rough=0.35, sss=0.3,
                             sss_radius=(1, 0.4, 0.1), sss_scale=0.003)
    M["celery"] = principled("celery", (0.42, 0.60, 0.16), rough=0.3, sss=0.3,
                             sss_radius=(0.7, 1, 0.4), sss_scale=0.003)
    M["noodle"] = principled("noodle", (0.88, 0.72, 0.38), rough=0.3, sss=0.4,
                             sss_radius=(1, 0.8, 0.4), sss_scale=0.003)
    M["chicken"] = principled("chicken", (0.82, 0.70, 0.52), rough=0.5, bump=(0.3, 700),
                              sss=0.2, sss_scale=0.003)
    M["parsley"] = principled("parsley", (0.04, 0.17, 0.02), rough=0.4)
    M["skin"] = potato_skin()
    M["flesh"] = principled("potato_flesh", (0.96, 0.74, 0.26), rough=0.3, sss=0.35,
                            sss_radius=(1, 0.8, 0.4), sss_scale=0.3, bump=(0.08, 3.0))
    M["basil"] = principled("basil", (0.04, 0.20, 0.025), rough=0.3, sss=0.25,
                            sss_radius=(0.5, 1, 0.3), sss_scale=0.002, coat=0.3)
    return M


# ================================================================ objects
def build_plate_mesh(M):
    bm = bmesh.new()
    revolve_into(bm, chaikin(PLATE, 2), 80, uv_rect=(0, 0, 1, 1))
    me = bm_to_mesh(bm, "plate")
    set_mat(me, M["ceramic"])
    return me


def build_pot(M):
    prof = chaikin(POT, 2)
    bm = bmesh.new()
    revolve_into(bm, prof, 72, uv_rect=(0, 0, 1, 0.84))
    path = [(11.0, -3.4, 11.2), (12.6, -3.3, 11.35), (14.0, -2.6, 11.5), (14.7, -1.2, 11.55),
            (14.8, 0, 11.55), (14.7, 1.2, 11.55), (14.0, 2.6, 11.5), (12.6, 3.3, 11.35),
            (11.0, 3.4, 11.2)]
    path = [p * CM for p in catmull(path, 5)]
    for ang, rect in ((0.0, (0.0, 0.86, 0.49, 1.0)), (math.pi, (0.51, 0.86, 1.0, 1.0))):
        sweep_into(bm, path, 0.0042, segs=12, M=Matrix.Rotation(ang, 4, "Z"), uv_rect=rect)
    me = bm_to_mesh(bm, "pot")
    set_mat(me, M["metal"])
    rim_top = max(z for _, z in prof)
    bm = bmesh.new()
    revolve_into(bm, chaikin(LID, 2), 72, uv_rect=(0, 0, 1, 1))
    lid = bm_to_mesh(bm, "pot_lid")
    set_mat(lid, M["metal"])
    return me, lid, rim_top * CM


def seg_dist(p1, q1, p2, q2):
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    den = a * e - b * b
    s = min(max((b * f - c * e) / den, 0.0), 1.0) if den > 1e-12 else 0.0
    t = (b * s + f) / e
    if t < 0:
        t, s = 0.0, min(max(-c / a, 0.0), 1.0)
    elif t > 1:
        t, s = 1.0, min(max((b - c) / a, 0.0), 1.0)
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


def simulate_penne(count, seed, drop_r, z_lo, z_hi, collider_me=None, frames=170, cup_r=None):
    """Drop penne with Bullet at 10x scale (small objects are unstable at real size).
    Returns world matrices at 10x scale."""
    S = 10.0
    scene = bpy.context.scene
    rnd = random.Random(seed)
    tmp = get_coll("_sim")
    bmp = bmesh.new()
    penne_into(bmp, Matrix.Identity(4), s=S)
    tmpl = bm_to_mesh(bmp, "_penne_sim")
    gbm = bmesh.new()
    bmesh.ops.create_cube(gbm, size=1.0)
    ground = new_obj("_ground", bm_to_mesh(gbm, "_ground", False), tmp, (0, 0, -0.5))
    ground.scale = (8, 8, 1)
    half, rad = (0.020 + 0.0025) * S, 0.0056 * S
    caps, objs, tries = [], [], 0
    while len(objs) < count and tries < 40000:
        tries += 1
        a = rnd.random() * 2 * math.pi
        rr = drop_r * math.sqrt(rnd.random())
        p = Vector((rr * math.cos(a), rr * math.sin(a), rnd.uniform(z_lo, z_hi)))
        q = rand_quat(rnd)
        ax = q @ Vector((0, 0, 1))
        p1, p2 = p - ax * half, p + ax * half
        if min(p1.z, p2.z) < rad * 1.2:
            continue
        if cup_r and max(p1.xy.length, p2.xy.length) > cup_r - rad * 1.3:
            continue
        if any(seg_dist(p1, p2, c1, c2) < 2.1 * rad for c1, c2 in caps):
            continue
        caps.append((p1, p2))
        o = new_obj("_p%d" % len(objs), tmpl, tmp, p)
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = q
        objs.append(o)
    log("penne placed", len(objs), "tries", tries)
    bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    rbw.substeps_per_frame = 12
    rbw.solver_iterations = 25
    rbw.point_cache.frame_start = 1
    rbw.point_cache.frame_end = frames

    def add_rb(o, typ):
        for x in bpy.context.view_layer.objects:
            x.select_set(False)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.rigidbody.object_add(type=typ)
        o.select_set(False)

    add_rb(ground, "PASSIVE")
    ground.rigid_body.collision_shape = "BOX"
    ground.rigid_body.friction = 1.0
    if collider_me is not None:
        col = new_obj("_collider", collider_me, tmp)
        add_rb(col, "PASSIVE")
        col.rigid_body.collision_shape = "MESH"
        col.rigid_body.friction = 0.9
        col.rigid_body.use_margin = True
        col.rigid_body.collision_margin = 0.004
    if cup_r:
        # measuring cup: penne settle inside, then the cup lifts away and the pile slumps
        cbm = bmesh.new()
        revolve_into(cbm, [(cup_r, 0.0), (cup_r, z_hi * 0.5), (cup_r, z_hi * 1.2)], 48, s=1.0)
        cup = new_obj("_cup", bm_to_mesh(cbm, "_cup", False), tmp)
        add_rb(cup, "PASSIVE")
        cup.rigid_body.collision_shape = "MESH"
        cup.rigid_body.kinematic = True
        cup.rigid_body.friction = 0.2
        cup.rigid_body.use_margin = True
        cup.rigid_body.collision_margin = 0.004
        for f, z in ((1, 0.0), (95, 0.0), (160, z_hi * 1.3)):
            cup.location.z = z
            cup.keyframe_insert("location", frame=f)
    for o in objs:
        add_rb(o, "ACTIVE")
        rb = o.rigid_body
        rb.collision_shape = "CONVEX_HULL"
        rb.mass = 0.05
        rb.friction = 1.0
        rb.restitution = 0.0
        rb.linear_damping = 0.3
        rb.angular_damping = 0.75
        rb.use_margin = True
        rb.collision_margin = 0.003
    for f in range(1, frames + 1):
        scene.frame_set(f)
    mats = [o.matrix_world.copy() for o in objs]
    bpy.ops.rigidbody.world_remove()
    for o in tmp.objects:
        if o.animation_data and o.animation_data.action:
            bpy.data.actions.remove(o.animation_data.action)
    for o in list(tmp.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(tmp)
    for me in (tmpl, bpy.data.meshes.get("_ground"), collider_me):
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    scene.frame_set(0)
    return mats


def pile_mesh(name, mats10, recentre=True, keep_r=0.085):
    pos = [Vector((M.translation.x * 0.1, M.translation.y * 0.1, M.translation.z * 0.1)) for M in mats10]
    cx = cy = 0.0
    if recentre:
        xs = sorted(p.x for p in pos)
        ys = sorted(p.y for p in pos)
        cx, cy = xs[len(xs) // 2], ys[len(ys) // 2]
    bm = bmesh.new()
    kept = 0
    for M, p in zip(mats10, pos):
        if math.hypot(p.x - cx, p.y - cy) > keep_r:
            continue
        T = Matrix.Translation(Vector((p.x - cx, p.y - cy, p.z))) @ M.to_quaternion().to_matrix().to_4x4()
        penne_into(bm, T)
        kept += 1
    if recentre:
        minz = min(v.co.z for v in bm.verts)
        for v in bm.verts:
            v.co.z -= minz
    log(name, "penne kept", kept)
    return bm_to_mesh(bm, name)


def build_rice(bowl_prof, M, seed=7, zf=5.1, H=2.5):
    """Rice mound + ~1000 grains. Built in cm in bowl space, returned in metres with the
    origin at the bowl's inner bottom so scaling the object shrinks the mound into the bowl."""
    rnd = random.Random(seed)
    z_ib = inner_part(bowl_prof)[-1][1]
    Rf = inner_r(bowl_prof, zf) - 0.05

    def dome_z(r):
        u = min((r / Rf) ** 2, 1.0)
        return zf + H * (1 - u) ** 0.75

    def dome_g(r):
        u = min((r / Rf) ** 2, 0.995)
        return -H * 0.75 * (1 - u) ** (-0.25) * 2 * r / Rf ** 2

    bm = bmesh.new()
    inner = list(reversed(inner_part(bowl_prof)))
    prof = [(max(r - 0.08, 0.0), z + 0.08) for r, z in inner if z < zf - 0.05]
    prof.append((Rf, zf))
    N = 18
    for k in range(1, N + 1):
        r = Rf * (1 - k / N)
        prof.append((r, dome_z(r)))
    revolve_into(bm, prof, 64, s=1.0)

    d = 0.42
    cell = {}
    pts = []

    def free(p):
        key = (int(p.x // d), int(p.y // d), int(p.z // d))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q in cell.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                        if (q - p).length < d:
                            return False
        return True

    def add(p, n):
        key = (int(p.x // d), int(p.y // d), int(p.z // d))
        cell.setdefault(key, []).append(p)
        pts.append((p, n))

    for _ in range(60000):
        a = rnd.random() * 2 * math.pi
        r = Rf * 0.995 * math.sqrt(rnd.random())
        g = dome_g(r)
        if rnd.random() > min(math.sqrt(1 + g * g), 5.0) / 5.0:
            continue
        p = Vector((r * math.cos(a), r * math.sin(a), dome_z(r)))
        n = Vector((-g * math.cos(a), -g * math.sin(a), 1.0)).normalized() if r > 1e-4 else Vector((0, 0, 1))
        if free(p):
            add(p, n)
    for _ in range(20000):
        a = rnd.random() * 2 * math.pi
        z = rnd.uniform(zf - 1.4, zf - 0.1)
        r = inner_r(bowl_prof, z) - 0.08
        p = Vector((r * math.cos(a), r * math.sin(a), z))
        n = Vector((math.cos(a), math.sin(a), -0.25)).normalized()
        if free(p):
            add(p, n)

    grain = bmesh.new()
    bmesh.ops.create_uvsphere(grain, u_segments=6, v_segments=4, radius=1.0)
    for v in grain.verts:
        v.co = Vector((v.co.x * 0.12, v.co.y * 0.13, v.co.z * 0.36))
    for p, n in pts:
        rv = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        t = (rv - n * rv.dot(n))
        if t.length < 1e-4:
            continue
        t.normalize()
        tilt = rnd.uniform(-0.25, 0.25)
        t = (t + n * tilt).normalized()
        n2 = (n - t * n.dot(t)).normalized()
        append_bm(bm, grain, frame_from(n2, t, p + n * 0.07))
    grain.free()
    for v in bm.verts:
        v.co = Vector((v.co.x * CM, v.co.y * CM, (v.co.z - z_ib) * CM))
    me = bm_to_mesh(bm, "rice")
    set_mat(me, M["rice"])
    log("rice grains", len(pts))
    return me, z_ib * CM


def vessel(name, prof, segs, mat):
    bm = bmesh.new()
    revolve_into(bm, prof, segs, uv_rect=(0, 0, 1, 1))
    me = bm_to_mesh(bm, name)
    set_mat(me, mat)
    return me


def surface_disc(name, Rf, zfun, rings=28, segs=72, s=CM):
    bm = bmesh.new()
    c = bm.verts.new(Vector((0, 0, zfun(0, 0) * s)))
    R = []
    for k in range(1, rings + 1):
        r = Rf * k / rings
        R.append([bm.verts.new(Vector((r * math.cos(2 * math.pi * i / segs) * s,
                                       r * math.sin(2 * math.pi * i / segs) * s,
                                       zfun(r * math.cos(2 * math.pi * i / segs),
                                            r * math.sin(2 * math.pi * i / segs)) * s)))
                  for i in range(segs)])
    for i in range(segs):
        bm.faces.new((c, R[0][i], R[0][(i + 1) % segs]))
    for A, B in zip(R[:-1], R[1:]):
        for i in range(segs):
            i2 = (i + 1) % segs
            bm.faces.new((A[i], B[i], B[i2], A[i2]))
    return bm_to_mesh(bm, name)


def lumps_obj(name, coll, loc, M_list, mat, size_fn, seed, u=8, v=6, rough=0.25):
    rnd = random.Random(seed)
    bm = bmesh.new()
    for M in M_list:
        rx, ry, rz = size_fn(rnd)
        off = Vector((rnd.uniform(0, 50), rnd.uniform(0, 50), rnd.uniform(0, 50)))
        ellipsoid_into(bm, M, rx, ry, rz, u, v,
                       disp=lambda c, off=off: 1 + rough * noise.noise(c * 1.8 + off))
    me = bm_to_mesh(bm, name)
    set_mat(me, mat)
    return new_obj(name, me, coll, loc)


def build_chili(coll, O, M, wide_prof, wide_me):
    new_obj("chili_bowl", wide_me, coll, O)
    rnd = random.Random(11)
    zf = 3.5
    Rf = inner_r(wide_prof, zf) + 0.1
    off = Vector((3.1, 7.7, 0))

    def zfun(x, y):
        r = math.hypot(x, y)
        return (zf + 0.5 * (1 - min((r / Rf) ** 2, 1)) + 0.22 * noise.noise(Vector((x, y, 0)) * 0.8 + off)
                + 0.08 * noise.noise(Vector((x, y, 0)) * 2.6 + off))

    me = surface_disc("chili_surface", Rf, zfun)
    set_mat(me, M["sauce"])
    new_obj("chili_surface", me, coll, O)

    def spot(rmax, avoid=()):
        for _ in range(200):
            a = rnd.random() * 2 * math.pi
            r = rmax * math.sqrt(rnd.random())
            x, y = r * math.cos(a), r * math.sin(a)
            if all(math.hypot(x - ax, y - ay) > ar for ax, ay, ar in avoid):
                return x, y
        return 0.0, 0.0

    dol = (1.6, -1.8, 2.6)
    # beans
    bm = bmesh.new()
    for _ in range(15):
        x, y = spot(Rf - 1.4, [dol])
        yaw = rnd.uniform(0, 2 * math.pi)
        R = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(rnd.uniform(-0.3, 0.3), 4, "X")
        T = Matrix.Translation(Vector((x, y, zfun(x, y) + 0.08))) @ R
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=14, v_segments=8, radius=1.0)
        for v in tmp.verts:
            c = v.co
            v.co = Vector((c.x * 0.85, c.y * 0.45 - 0.28 * (c.x ** 2) + 0.14, c.z * 0.36))
        append_bm(bm, tmp, Matrix.Scale(CM, 4) @ T)
        tmp.free()
    me = bm_to_mesh(bm, "chili_beans")
    set_mat(me, M["bean"])
    new_obj("chili_beans", me, coll, O)
    # meat crumbles
    Ms = []
    for _ in range(46):
        x, y = spot(Rf - 0.8, [dol])
        Ms.append(Matrix.Scale(CM, 4) @ Matrix.Translation(Vector((x, y, zfun(x, y) + 0.05)))
                  @ rand_quat(rnd).to_matrix().to_4x4())
    lumps_obj("chili_meat", coll, O, Ms, M["meat"],
              lambda r: (r.uniform(0.3, 0.5), r.uniform(0.25, 0.4), r.uniform(0.2, 0.3)), 5, 8, 6, 0.35)
    # sour cream dollop with a soft swirl peak
    prof = [(2.35, -0.3), (2.3, 0.1), (2.0, 0.55), (1.5, 0.95), (0.9, 1.2), (0.4, 1.45), (0.15, 1.7), (0, 1.75)]
    bm = bmesh.new()
    revolve_into(bm, chaikin(prof, 2), 48, s=1.0)
    for v in bm.verts:
        c = v.co
        ang = math.atan2(c.y, c.x)
        h = max(c.z, 0.0)
        wob = 1 + 0.10 * math.sin(3 * ang + h * 3.0) + 0.05 * noise.noise(c * 1.5)
        v.co = Vector((c.x * wob, c.y * wob, c.z * (1 + 0.06 * math.sin(2 * ang))))
    bz = zfun(dol[0], dol[1])
    for v in bm.verts:
        v.co = Vector(((v.co.x + dol[0]) * CM, (v.co.y + dol[1]) * CM, (v.co.z + bz) * CM))
    me = bm_to_mesh(bm, "chili_cream")
    set_mat(me, M["cream"])
    new_obj("chili_cream", me, coll, O)
    # green onion rings + cheddar shreds
    bm = bmesh.new()
    for i in range(16):
        if i < 7:
            a = rnd.random() * 2 * math.pi
            rr = rnd.uniform(0.2, 1.7)
            x, y = dol[0] + rr * math.cos(a), dol[1] + rr * math.sin(a)
            z = bz + 1.75 * max(0.0, 1 - rr / 2.3) ** 0.9 + 0.08
        else:
            x, y = spot(Rf - 1.0)
            z = zfun(x, y) + 0.08
        R = Matrix.Rotation(rnd.uniform(-0.5, 0.5), 4, "X") @ Matrix.Rotation(rnd.uniform(-0.5, 0.5), 4, "Y")
        ring = catmull([(0.30 * math.cos(2 * math.pi * k / 8), 0.30 * math.sin(2 * math.pi * k / 8), 0)
                        for k in range(8)], 2, closed=True)
        sweep_into(bm, ring, 0.075, segs=6, closed=True,
                   M=Matrix.Scale(CM, 4) @ Matrix.Translation(Vector((x, y, z))) @ R)
    me = bm_to_mesh(bm, "chili_onion")
    set_mat(me, M["onion"])
    new_obj("chili_onion", me, coll, O)
    bm = bmesh.new()
    for i in range(18):
        x, y = spot(Rf - 1.5, [(dol[0], dol[1], 1.2)])
        yaw = rnd.uniform(0, 2 * math.pi)
        ln = rnd.uniform(1.0, 1.8)
        path = [Vector((ln * (k / 4 - 0.5), 0.15 * math.sin(k * 1.3 + i), 0.06 * math.sin(k)))
                for k in range(5)]
        sweep_into(bm, catmull(path, 3), 0.1, segs=6, flat=0.45,
                   M=Matrix.Scale(CM, 4) @ Matrix.Translation(Vector((x, y, zfun(x, y) + 0.12)))
                   @ Matrix.Rotation(yaw, 4, "Z"))
    me = bm_to_mesh(bm, "chili_cheddar")
    set_mat(me, M["cheese"])
    new_obj("chili_cheddar", me, coll, O)


def build_soup(coll, O, M, wide_prof, wide_me):
    new_obj("soup_bowl", wide_me, coll, O)
    rnd = random.Random(23)
    zf = 3.7
    Rf = inner_r(wide_prof, zf) + 0.1

    def zfun(x, y):
        r = math.hypot(x, y)
        return zf + 0.12 * min(r / Rf, 1) ** 10 + 0.015 * noise.noise(Vector((x, y, 0)) * 1.2)

    me = surface_disc("soup_broth", Rf, zfun)
    set_mat(me, M["broth"])
    new_obj("soup_broth", me, coll, O)
    placed = []

    def spot(rmax, clear):
        for _ in range(300):
            a = rnd.random() * 2 * math.pi
            r = rmax * math.sqrt(rnd.random())
            x, y = r * math.cos(a), r * math.sin(a)
            if x > 1.0 and y > 0.2 and x + y > 3.0:     # keep the spoon's lane clear
                continue
            if all(math.hypot(x - px, y - py) > clear + pr for px, py, pr in placed):
                return x, y
        return None

    def Mat(x, y, dz, yaw, tilt):
        return (Matrix.Scale(CM, 4) @ Matrix.Translation(Vector((x, y, zf + dz)))
                @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(tilt, 4, "X"))

    # carrot coins
    bm = bmesh.new()
    for _ in range(10):
        s = spot(Rf - 1.4, 0.9)
        if not s:
            continue
        rad = rnd.uniform(0.75, 0.95)
        placed.append((s[0], s[1], rad))
        prof = chaikin([(0, -0.17), (rad, -0.17), (rad, -0.17), (rad + 0.03, 0.0), (rad, 0.17), (rad, 0.17), (0, 0.17)], 1)
        revolve_into(bm, prof, 24, M=Mat(s[0], s[1], 0.02, 0, rnd.uniform(-0.12, 0.12)), s=1.0)
    me = bm_to_mesh(bm, "soup_carrot")
    set_mat(me, M["carrot"])
    new_obj("soup_carrot", me, coll, O)
    # celery pieces: short curved channels
    bm = bmesh.new()
    for _ in range(8):
        s = spot(Rf - 1.2, 0.7)
        if not s:
            continue
        placed.append((s[0], s[1], 0.6))
        path = [Vector((-0.55, 0, 0)), Vector((0, 0.08, 0)), Vector((0.55, 0, 0))]
        sweep_into(bm, catmull(path, 3), 0.32, segs=10, flat=0.45,
                   M=Mat(s[0], s[1], 0.05, rnd.uniform(0, 6.28), 0))
    me = bm_to_mesh(bm, "soup_celery")
    set_mat(me, M["celery"])
    new_obj("soup_celery", me, coll, O)
    # egg noodles
    bm = bmesh.new()
    for i in range(14):
        s = spot(Rf - 1.0, 0.5)
        if not s:
            continue
        ln = rnd.uniform(1.8, 2.8)
        path = [Vector((ln * (k / 5 - 0.5), 0.25 * math.sin(k * 1.1 + i), 0.05 * math.sin(k * 2.0 + i)))
                for k in range(6)]
        sweep_into(bm, catmull(path, 3), 0.22, segs=8, flat=0.25,
                   M=Mat(s[0], s[1], 0.03, rnd.uniform(0, 6.28), 0))
    me = bm_to_mesh(bm, "soup_noodles")
    set_mat(me, M["noodle"])
    new_obj("soup_noodles", me, coll, O)
    # chicken pieces
    Ms = []
    for _ in range(7):
        s = spot(Rf - 1.3, 0.7)
        if not s:
            continue
        placed.append((s[0], s[1], 0.6))
        Ms.append(Mat(s[0], s[1], 0.05, rnd.uniform(0, 6.28), 0) @ rand_quat(rnd).to_matrix().to_4x4())
    lumps_obj("soup_chicken", coll, O, Ms, M["chicken"],
              lambda r: (r.uniform(0.6, 0.8), r.uniform(0.45, 0.6), r.uniform(0.3, 0.4)), 9, 10, 8, 0.25)
    # parsley flecks
    bm = bmesh.new()
    for _ in range(34):
        a = rnd.random() * 2 * math.pi
        r = (Rf - 0.6) * math.sqrt(rnd.random())
        x, y = r * math.cos(a), r * math.sin(a)
        tmp = bmesh.new()
        bmesh.ops.create_circle(tmp, cap_ends=True, segments=5, radius=1.0)
        for v in tmp.verts:
            v.co = Vector((v.co.x * rnd.uniform(0.12, 0.22), v.co.y * rnd.uniform(0.08, 0.16), 0))
        append_bm(bm, tmp, Mat(x, y, zfun(x, y) - zf + 0.02, rnd.uniform(0, 6.28), 0))
        tmp.free()
    me = bm_to_mesh(bm, "soup_parsley", smooth=False)
    set_mat(me, M["parsley"])
    new_obj("soup_parsley", me, coll, O)
    # spoon: dipped bowl + curved handle over the back-right rim
    bm = bmesh.new()
    tmp = bmesh.new()
    bmesh.ops.create_uvsphere(tmp, u_segments=24, v_segments=12, radius=1.0)
    bmesh.ops.delete(tmp, geom=[v for v in tmp.verts if v.co.z > 0.02], context="VERTS")
    for v in tmp.verts:
        v.co = Vector((v.co.x * 2.1, v.co.y * 1.45, v.co.z * 0.65))
    append_bm(bm, tmp, Matrix.Identity(4))
    tmp.free()
    hp = [Vector((1.9, 0, 0.0)), Vector((3.4, 0, 0.35)), Vector((6.0, 0, 1.2)),
          Vector((8.6, 0, 2.15)), Vector((11.5, 0, 2.45)), Vector((14.0, 0, 2.35))]
    sweep_into(bm, catmull(hp, 5), lambda t: 0.28 + 0.34 * t, segs=12, flat=0.28)
    yaw = math.radians(38)
    spoon_M = (Matrix.Scale(CM, 4) @ Matrix.Translation(Vector((0.6, 0.2, zf - 0.05)))
               @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.radians(-6), 4, "Y"))
    for v in bm.verts:
        v.co = spoon_M @ v.co
    me = bm_to_mesh(bm, "soup_spoon")
    set_mat(me, M["metal"])
    sp = new_obj("soup_spoon", me, coll, O)
    mod = sp.modifiers.new("thick", "SOLIDIFY")
    mod.thickness = 0.0012
    mod.offset = 0.0


def potato_mesh(name, seed, size, halve, M):
    rnd = random.Random(seed)
    b = bmesh.new()
    bmesh.ops.create_icosphere(b, subdivisions=5, radius=1.0)
    off = Vector((rnd.uniform(0, 90), rnd.uniform(0, 90), rnd.uniform(0, 90)))
    eyes = [Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized() for _ in range(6)]
    for v in b.verts:
        n = v.co.normalized()
        d = 1 + 0.11 * noise.noise(n * 1.2 + off) + 0.03 * noise.noise(n * 4 + off)
        for e in eyes:
            ang = n.angle(e)
            if ang < 0.18:
                d -= 0.035 * (1 - ang / 0.18) ** 2
        v.co = Vector((n.x * size[0] * d, n.y * size[1] * d, n.z * size[2] * d))
    if halve:
        res = bmesh.ops.bisect_plane(b, geom=b.verts[:] + b.edges[:] + b.faces[:], plane_co=(0, 0, 0),
                                     plane_no=(0, 0, 1), clear_outer=True)
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
        boundary = [e for e in b.edges if e.is_boundary]
        fill = bmesh.ops.contextual_create(b, geom=boundary)
        bmesh.ops.triangulate(b, faces=fill["faces"])
        for f in b.faces:
            if all(abs(v.co.z) < 1e-4 for v in f.verts):
                f.material_index = 1
                f.smooth = False
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
    me = bpy.data.meshes.new(name)
    b.to_mesh(me)
    b.free()
    set_mat(me, M["skin"], M["flesh"])
    for p in me.polygons:
        cap = halve and all(abs(me.vertices[i].co.z) < 1e-4 for i in p.vertices)
        p.material_index = 1 if cap else 0
        p.use_smooth = not cap
    return me


def build_potatoes(coll, O, M, plate_me):
    pl = new_obj("potato_plate", plate_me, coll, O)
    pl.scale = (0.62, 0.62, 0.62)
    top = 1.0 * 0.62
    items = [((-2.7, 1.9), 25, (3.6, 2.5, 2.2), False, 1),
             ((2.7, 2.3), -40, (3.3, 2.3, 2.1), False, 2),
             ((0.3, -2.5), 12, (3.5, 2.5, 2.2), True, 3)]
    for (x, y), yaw, size, halve, seed in items:
        me = potato_mesh("potato_%d" % seed, seed, size, halve, M)
        zmin = min(v.co.z for v in me.vertices)
        o = new_obj("potato_%d" % seed, me, coll,
                    O + Vector((x * CM, y * CM, (top - zmin * 0.97) * CM)))
        o.scale = (CM, CM, CM)
        o.rotation_euler = (math.radians(3 if not halve else 0), 0, math.radians(yaw))


def leaf_obj(name, coll, M_world, length, width, mat):
    bm = bmesh.new()
    nu, nv = 12, 7
    grid = []
    for i in range(nu + 1):
        u = i / nu
        w = width * 0.5 * (math.sin(math.pi * min(u * 1.05, 1.0)) ** 0.75) * (1 - 0.25 * u)
        row = []
        for j in range(nv + 1):
            v = -1 + 2 * j / nv
            x, y = u * length, v * w
            z = 0.28 * w * abs(v) ** 1.4 + 0.12 * length * math.sin(math.pi * u)
            row.append(bm.verts.new(M_world @ Vector((x, y, z))))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            a, b, c, d = grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]
            if len({id(a), id(b), id(c), id(d)}) == 4:
                bm.faces.new((a, b, c, d))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    me = bm_to_mesh(bm, name)
    set_mat(me, mat)
    return new_obj(name, me, coll)


# ================================================================ PBR pass: textures, bakes, decals
TEX = os.path.join(HERE, "tex")
TILE = 1.0                     # metres of tabletop per walnut-texture repeat
TABLE_W, TABLE_D, TABLE_T, TABLE_CY = 2.0, 1.2, 0.04, 0.10
HDRI = "interior.exr"          # Blender-bundled Poly Haven 'hotel_room' 1K, CC0
HDRI_STRENGTH = 0.25


def pnoise(h, w, fx, fy, seed):
    """Tileable gaussian-filtered noise, ~N(0,1). fx/fy = feature frequency in cycles per tile."""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((h, w)))
    ky = np.fft.fftfreq(h)[:, None] * h
    kx = np.fft.fftfreq(w)[None, :] * w
    n = np.real(np.fft.ifft2(F * np.exp(-((kx / fx) ** 2 + (ky / fy) ** 2))))
    return ((n - n.mean()) / (n.std() + 1e-9)).astype(np.float32)


def save_img(name, arr, srgb):
    """Write an HxW(x3|x4) array (row 0 = bottom, v = 0) to blender/tex/<name>.png and load it."""
    arr = np.clip(np.asarray(arr, np.float32), 0, 1)
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, -1)
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1)
    os.makedirs(TEX, exist_ok=True)
    path = os.path.join(TEX, name + ".png")
    tmp = bpy.data.images.new("_tmp_" + name, w, h, alpha=True)
    tmp.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    tmp.pixels.foreach_set(arr.ravel())
    tmp.filepath_raw = path
    tmp.file_format = "PNG"
    tmp.save()
    bpy.data.images.remove(tmp)
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.load(path)
    img.name = name
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return img


def img_array(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def half_res(a):
    """2x2 box downsample (1024 -> 512)."""
    h, w = a.shape[:2]
    return a.reshape(h // 2, 2, w // 2, 2, *a.shape[2:]).mean((1, 3))


PHOTO = os.path.join(HERE, "textures")   # CC0 photo sets (see ../CREDITS.md)
CREAM = (0.905, 0.863, 0.791)            # #F4EFE6 in linear
# whole-number repeats around each vessel (u = angle, so no seam), v = along the profile
REPEAT = {"plate": (3, 1), "bowl": (2, 1), "pot": (3, 2), "pot_lid": (3, 1), "render": (3, 1)}


def load_photo(rel):
    """Photo texture as float array, row 0 = bottom, values as stored (sRGB for colour maps)."""
    img = bpy.data.images.load(os.path.join(PHOTO, rel))
    a = img_array(img)[..., :3].copy()
    bpy.data.images.remove(img)
    return a


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def resample_tiled(tile, ru, rv, res=1024):
    """Sample a seamless tile `ru` x `rv` times across a res x res UV image (bilinear, wraps)."""
    th, tw = tile.shape[:2]
    y = ((np.arange(res) + 0.5) / res * rv * th - 0.5) % th
    x = ((np.arange(res) + 0.5) / res * ru * tw - 0.5) % tw
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    y1, x1 = (y0 + 1) % th, (x0 + 1) % tw
    if tile.ndim == 3:
        fy, fx = fy[..., None], fx[..., None]
    return (tile[y0][:, x0] * (1 - fy) * (1 - fx) + tile[y0][:, x1] * (1 - fy) * fx
            + tile[y1][:, x0] * fy * (1 - fx) + tile[y1][:, x1] * fy * fx)


def photo_walnut():
    """Poly Haven natural_walnut_veneer: graded darker/warmer for the evening mood, AO folded in."""
    diff = srgb_to_lin(load_photo("walnut/natural_walnut_veneer_diff_1k.jpg"))
    ao = load_photo("walnut/natural_walnut_veneer_ao_1k.jpg")[..., 0]
    base = diff * np.array([0.25, 0.135, 0.072], np.float32) * (0.55 + 0.45 * ao)[..., None]
    rough = 0.2 + 0.4 * load_photo("walnut/natural_walnut_veneer_rough_1k.jpg")[..., 0]
    return {"base": lin_to_srgb(base), "normal": load_photo("walnut/natural_walnut_veneer_nor_gl_1k.jpg"),
            "rough": rough}


def photo_porcelain():
    """ambientCG Porcelain001: normal (pinholes) + gloss variation; colour stays the cream factor."""
    rough = load_photo("porcelain/Porcelain001_1K-JPG_Roughness.jpg")[..., 0]
    return {"normal": load_photo("porcelain/Porcelain001_1K-JPG_NormalGL.jpg"), "rough": 0.06 + 0.9 * rough}


def photo_steel():
    """ambientCG Metal009 brushed metal, lifted toward stainless (F0 ~0.55) with a faint warm cast."""
    col = srgb_to_lin(load_photo("steel/Metal009_1K-JPG_Color.jpg"))
    base = col / max(col.mean(), 1e-6) * 0.55 * np.array([1.0, 0.975, 0.94], np.float32)
    r = load_photo("steel/Metal009_1K-JPG_Roughness.jpg")[..., 0]
    rough = 0.30 + 0.35 * (r - r.mean())          # keep the brushing, calm the cloudy blotches
    return {"base": lin_to_srgb(base), "normal": load_photo("steel/Metal009_1K-JPG_NormalGL.jpg"), "rough": rough}


def tex_pasta(res=1024, seed=31):
    h = w = res
    base = np.array([0.89, 0.70, 0.36], np.float32)
    v = pnoise(h, w, 30, 30, seed) * 0.035
    specks = np.clip(pnoise(h, w, 350, 350, seed + 1) - 1.6, 0, None) * 0.3
    col = base[None, None, :] * (1 + v)[..., None] - specks[..., None] * np.array([0.10, 0.12, 0.10], np.float32)
    rough = 0.55 + 0.05 * pnoise(h, w, 40, 40, seed + 2)
    return {"base": col, "rough": rough}


def gltf_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def pbr(name, base=(0.8, 0.8, 0.8), base_img=None, normal_img=None, normal_strength=1.0, orm_img=None,
        rough_img=None, occl_img=None, rough=0.5, metal=0.0, uv_main=None, uv_occl=None, sss=0.0,
        sss_radius=(1, 0.6, 0.3), sss_scale=0.003, repeat=None):
    """Principled material the glTF exporter maps 1:1 to PBR (ORM: R=AO, G=roughness, B=metallic)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Subsurface Weight"].default_value = sss
    b.inputs["Subsurface Radius"].default_value = sss_radius
    b.inputs["Subsurface Scale"].default_value = sss_scale

    def tex(img, uv, rep=None):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        if uv or rep:
            u = nt.nodes.new("ShaderNodeUVMap")
            u.uv_map = uv or ""
            src = u.outputs["UV"]
            if rep:   # exported as KHR_texture_transform
                mp = nt.nodes.new("ShaderNodeMapping")
                mp.vector_type = "POINT"
                mp.inputs["Scale"].default_value = (rep[0], rep[1], 1)
                nt.links.new(src, mp.inputs["Vector"])
                src = mp.outputs["Vector"]
            nt.links.new(src, n.inputs["Vector"])
        return n

    if base_img:
        nt.links.new(tex(base_img, uv_main, repeat).outputs["Color"], b.inputs["Base Color"])
    if normal_img:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        if uv_main:
            nm.uv_map = uv_main
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex(normal_img, uv_main, repeat).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    out = None
    if orm_img or occl_img:
        out = nt.nodes.new("ShaderNodeGroup")
        out.node_tree = gltf_group()
    if orm_img:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex(orm_img, uv_main).outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
        nt.links.new(sep.outputs["Red"], out.inputs["Occlusion"])
    if rough_img:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex(rough_img, uv_main).outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
    if occl_img:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex(occl_img, uv_occl).outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Red"], out.inputs["Occlusion"])
    return m


def smart_uv(o):
    for x in bpy.context.view_layer.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    o.select_set(False)


def bake_ao(obj, res, visible, distance, samples=128, uv=None):
    """Cycles AO bake (CPU) of `obj` with only `visible` objects as occluders. Returns HxW array."""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.render.threads_mode = "FIXED"
    s.render.threads = THREADS
    s.world.light_settings.distance = distance
    img = bpy.data.images.new("_ao_" + obj.name, res, res, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    tmp = bpy.data.materials.new("_bake_" + obj.name)
    tmp.use_nodes = True
    node = tmp.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    tmp.node_tree.nodes.active = node
    saved = list(obj.data.materials)
    obj.data.materials.clear()
    obj.data.materials.append(tmp)
    was = {o.name: o.hide_render for o in bpy.context.view_layer.objects}
    for o in bpy.context.view_layer.objects:
        o.hide_render = not (o is obj or o.name in visible)
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    t = time.time()
    kw = dict(type="AO", margin=6, use_clear=True)
    if uv:
        kw["uv_layer"] = uv
    bpy.ops.object.bake(**kw)
    for o in bpy.context.view_layer.objects:
        o.hide_render = was[o.name]
    obj.select_set(False)
    obj.data.materials.clear()
    for m in saved:
        obj.data.materials.append(m)
    arr = img_array(img)[..., 0].copy()
    bpy.data.images.remove(img)
    bpy.data.materials.remove(tmp)
    log("baked AO", obj.name, "%.1fs" % (time.time() - t), "mean %.3f" % arr.mean())
    time.sleep(PAUSE)
    return arr


def build_table_mesh():
    W, D, T, cy = TABLE_W, TABLE_D, TABLE_T, TABLE_CY
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(W, D, T), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, cy, -T / 2), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.006, segments=3, affect="EDGES", profile=0.5)
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context="FACES")
    uv0 = bm.loops.layers.uv.new("UVMap")
    uv1 = bm.loops.layers.uv.new("AO")
    for f in bm.faces:
        n = f.normal
        for l in f.loops:
            c = l.vert.co
            if n.z > 0.5:
                l[uv0].uv = (c.x / TILE, c.y / TILE)
                l[uv1].uv = ((c.x + W / 2) / W, (c.y - cy + D / 2) / D * 0.955)
            else:
                a = c.x if abs(n.y) >= abs(n.x) else c.y
                l[uv0].uv = (a / TILE, c.z / TILE)
                l[uv1].uv = (min(max((a + W / 2) / W, 0), 1), 0.97 + 0.025 * (c.z + T) / T)
    return bm_to_mesh(bm, "table", smooth=False)


def decal_obj(name, coll, loc, size, disc=False):
    bm = bmesh.new()
    if disc:
        bmesh.ops.create_circle(bm, cap_ends=True, segments=48, radius=size / 2)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    else:
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / size + 0.5, l.vert.co.y / size + 0.5)
    return new_obj(name, bm_to_mesh(bm, name, smooth=False), coll, loc)


def decal_image(name, ao, gain):
    h, w = ao.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot((xx + 0.5) / w - 0.5, (yy + 0.5) / h - 0.5)
    fade = np.clip((0.5 - r) / 0.08, 0, 1)
    alpha = np.clip((1 - ao) * gain, 0, 0.94) * fade * fade
    arr = np.zeros((h, w, 4), np.float32)
    arr[..., 3] = alpha
    return save_img(name, arr, srgb=True)


def decal_material(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)
    b.inputs["Roughness"].default_value = 1.0
    b.inputs["Specular IOR Level"].default_value = 0.0
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    nt.links.new(n.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(n.outputs["Alpha"], b.inputs["Alpha"])
    m.surface_render_method = "BLENDED"
    return m


def hdri_world(strength):
    path = os.path.join(bpy.utils.system_resource("DATAFILES"), "studiolights", "world", HDRI)
    world = bpy.data.worlds.new("hdri")
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(path)
    bg = nt.nodes["Background"]
    bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    return world


def write_hdr(path, rgb, quant=0):
    """Radiance RGBE with new-style RLE. rgb: HxWx3 float, row 0 = TOP. quant>0 drops mantissa bits
    (smooth areas then form runs) to shrink the file."""
    h, w, _ = rgb.shape
    m = rgb.max(-1)
    mant, ex = np.frexp(m)
    scale = np.where(m > 1e-32, mant * 256.0 / np.maximum(m, 1e-32), 0)
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, ex + 128, 0).astype(np.uint8)
    if quant:
        rgbe[..., :3] &= np.uint8((0xFF << quant) & 0xFF)
    out = bytearray(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (h, w))
    for y in range(h):
        out += bytes((2, 2, w >> 8, w & 255))
        for c in range(4):
            row = rgbe[y, :, c].tobytes()
            i = 0
            while i < w:
                j = i
                while j < w and j - i < 127 and row[j] == row[i]:
                    j += 1
                if j - i >= 4:
                    out += bytes((128 + j - i, row[i]))
                    i = j
                    continue
                k = i
                while k < w and k - i < 128:
                    if k + 3 < w and row[k] == row[k + 1] == row[k + 2] == row[k + 3]:
                        break
                    k += 1
                out += bytes((k - i,)) + row[i:k]
                i = k
    with open(path, "wb") as f:
        f.write(out)
    return len(out)


def export_hdr():
    """env.exr = the bundled 189 KB DWAB file (three.js EXRLoader reads DWAB); env.hdr = same 1K data as
    RGBE; env-512.hdr = half-res RGBE for phones, trimmed to <= 250 KB."""
    import shutil
    path = os.path.join(bpy.utils.system_resource("DATAFILES"), "studiolights", "world", HDRI)
    shutil.copyfile(path, os.path.join(ASSETS, "env.exr"))
    img = bpy.data.images.load(path)
    rgb = img_array(img)[::-1, :, :3].astype(np.float32)          # top row first
    n1 = write_hdr(os.path.join(ASSETS, "env.hdr"), rgb)
    half = rgb.reshape(rgb.shape[0] // 2, 2, rgb.shape[1] // 2, 2, 3).mean((1, 3))
    # light 3x3 blur (wraps in longitude): phone IBL only, and it lets RLE find runs
    pad = np.concatenate([half[:1], half, half[-1:]], 0)
    half = sum(np.roll(pad, dx, 1)[1 + dy:pad.shape[0] - 1 + dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1)) / 9.0
    for q in (0, 1, 2, 3, 4):
        n2 = write_hdr(os.path.join(ASSETS, "env-512.hdr"), half, quant=q)
        if n2 <= 250 * 1024:
            break
    log("env.hdr %d KB, env-512.hdr %d KB (mantissa bits dropped: %d)" % (n1 // 1024, n2 // 1024, q))


def realism_pass():
    """Textures -> AO bakes -> ORM maps -> PBR materials -> contact-shadow decals."""
    O = bpy.data.objects
    wal, por, stl, pas = photo_walnut(), photo_porcelain(), photo_steel(), tex_pasta()
    I = {
        "wood_base": save_img("walnut_base", wal["base"], True),
        "wood_normal": save_img("walnut_normal", wal["normal"], False),
        "wood_rough": save_img("walnut_rough", wal["rough"], False),
        "por_normal": save_img("porcelain_normal", por["normal"], False),
        "steel_base": save_img("steel_base", stl["base"], True),
        "steel_normal": save_img("steel_normal", stl["normal"], False),
        "pasta_base": save_img("pasta_base", pas["base"], True),
    }
    ao = {
        "plate": bake_ao(O["plate_0"], 1024, {"table"}, 0.10),
        "pot": bake_ao(O["pot"], 1024, {"table", "pot_lid"}, 0.12),
        "pot_lid": bake_ao(O["pot_lid"], 1024, {"pot"}, 0.12),
        "bowl": bake_ao(O["bowl"], 1024, {"table"}, 0.10),
        "rice": bake_ao(O["rice"], 1024, {"bowl"}, 0.03),
        "pasta": bake_ao(O["pasta"], 1024, {"table"}, 0.03),
        "table": bake_ao(O["table"], 1024, {"pot", "pot_lid", "bowl"}, 0.12, uv="AO"),
    }

    def orm(name, a, r, m):
        return save_img(name, np.stack([a, np.broadcast_to(r, a.shape), np.full_like(a, m)], -1), False)

    def rough_uv(src, key):
        return resample_tiled(src, *REPEAT[key])

    mats = {
        "plate": pbr("plate", base=CREAM, normal_img=I["por_normal"], normal_strength=0.6, repeat=REPEAT["plate"],
                     orm_img=orm("plate_orm", ao["plate"], rough_uv(por["rough"], "plate"), 0.0), sss=0.04),
        "bowl": pbr("bowl", base=CREAM, normal_img=I["por_normal"], normal_strength=0.6, repeat=REPEAT["bowl"],
                    orm_img=orm("bowl_orm", ao["bowl"], rough_uv(por["rough"], "bowl"), 0.0), sss=0.04),
        "pot": pbr("pot", base_img=I["steel_base"], normal_img=I["steel_normal"], repeat=REPEAT["pot"],
                   orm_img=orm("pot_orm", half_res(ao["pot"]), half_res(rough_uv(stl["rough"], "pot")), 1.0)),
        "pot_lid": pbr("pot_lid", base_img=I["steel_base"], normal_img=I["steel_normal"], repeat=REPEAT["pot_lid"],
                       orm_img=orm("pot_lid_orm", half_res(ao["pot_lid"]), half_res(rough_uv(stl["rough"], "pot_lid")), 1.0)),
        "rice": pbr("rice", base=(0.86, 0.84, 0.78), orm_img=orm("rice_orm", half_res(ao["rice"]), 0.45, 0.0),
                    sss=0.5, sss_radius=(1, 0.9, 0.75), sss_scale=0.002),
        "pasta": pbr("pasta", base_img=I["pasta_base"],
                     orm_img=orm("pasta_orm", half_res(ao["pasta"]), half_res(pas["rough"]), 0.0),
                     sss=0.3, sss_radius=(1, 0.55, 0.15), sss_scale=0.004),
        "table": pbr("table", base_img=I["wood_base"], normal_img=I["wood_normal"], rough_img=I["wood_rough"],
                     occl_img=save_img("table_ao", ao["table"], False), uv_main="UVMap", uv_occl="AO"),
    }
    for key, obj in (("plate", "plate_0"), ("bowl", "bowl"), ("pot", "pot"), ("pot_lid", "pot_lid"),
                     ("rice", "rice"), ("pasta", "pasta"), ("table", "table")):
        set_mat(O[obj].data, mats[key])

    # contact-shadow decals (alpha = 1 - AO of a plane under the caster)
    C_DEC = get_coll("glb_decals")
    px, py = PLATE_XY
    well = 1.0 * CM
    specs = [
        ("shadow_plate_0", (px, py, 0.0005), 0.36, False, {"plate_0"}, 0.05, 1.25),
        ("shadow_plate_1", (px, py, PLATE_PITCH * 0 + well + 0.00015), 0.186, True, {"plate_1"}, 0.03, 0.65),
        ("shadow_pot", (POT_XY[0], POT_XY[1], 0.0005), 0.40, False, {"pot", "pot_lid"}, 0.08, 1.2),
        ("shadow_bowl", (BOWL_XY[0], BOWL_XY[1], 0.0005), 0.22, False, {"bowl"}, 0.05, 1.25),
        ("shadow_pasta", (PASTA_XY[0], PASTA_XY[1], 0.0005), 0.28, False, {"pasta"}, 0.035, 1.2),
    ]
    for name, loc, size, disc, casters, dist, gain in specs:
        d = decal_obj(name, C_DEC, loc, size, disc)
        a = bake_ao(d, 256, casters, dist, samples=256)
        set_mat(d.data, decal_material(name, decal_image(name + "_tex", a, gain)))
    # plates 2..4 reuse the plate-on-plate shadow (mesh + material shared)
    src = O["shadow_plate_1"]
    for k in range(2, 5):
        new_obj("shadow_plate_%d" % k, src.data, C_DEC, (px, py, (k - 1) * PLATE_PITCH + well + 0.00015))
    # dish-render ceramic (no per-object AO: Cycles computes it)
    return pbr("ceramic_render", base=CREAM, normal_img=I["por_normal"], normal_strength=0.6,
               repeat=REPEAT["render"], rough=0.1, sss=0.04)


# ================================================================ lights / cameras
def aim(o, target):
    d = Vector(target) - o.location
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("-Z", "Y")


def area(name, coll, loc, target, size, energy, color, size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.color = color
    if size_y:
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size, size_y
    else:
        ld.shape = "DISK"
        ld.size = size
    o = new_obj(name, ld, coll, loc)
    aim(o, target)
    return o


def hermite_path(frame):
    keys = CAM_KEYS
    vel = {}
    holds = [(0, 1), (2, 3), (4, 5)]
    for a, b in holds:
        for idx in (a, b):
            (fa, pa, ta), (fb, pb, tb) = keys[a], keys[b]
            vel[idx] = ((Vector(pb) - Vector(pa)) / (fb - fa), (Vector(tb) - Vector(ta)) / (fb - fa))
    vel[6] = (Vector((0, 0, 0)), Vector((0, 0, 0)))
    for i in range(len(keys) - 1):
        f0, p0, t0 = keys[i]
        f1, p1, t1 = keys[i + 1]
        if f0 <= frame <= f1:
            dt = f1 - f0
            s = (frame - f0) / dt
            h00 = 2 * s ** 3 - 3 * s ** 2 + 1
            h10 = s ** 3 - 2 * s ** 2 + s
            h01 = -2 * s ** 3 + 3 * s ** 2
            h11 = s ** 3 - s ** 2
            v0p, v0t = vel[i]
            v1p, v1t = vel[i + 1]
            pos = h00 * Vector(p0) + h10 * dt * v0p + h01 * Vector(p1) + h11 * dt * v1p
            tgt = h00 * Vector(t0) + h10 * dt * v0t + h01 * Vector(t1) + h11 * dt * v1t
            return pos, tgt
    return Vector(keys[-1][1]), Vector(keys[-1][2])


def build_camera(coll):
    cd = bpy.data.cameras.new("camera")
    cd.lens = LENS_MM
    cd.sensor_width = 36
    cd.sensor_fit = "AUTO"
    cd.clip_start = 0.01
    cd.clip_end = 30
    cam = new_obj("camera", cd, coll)
    cam.rotation_mode = "QUATERNION"
    prev = None
    for f in range(0, 241):
        pos, tgt = hermite_path(f)
        q = (tgt - pos).to_track_quat("-Z", "Y")
        if prev is not None and prev.dot(q) < 0:
            q.negate()
        prev = q
        cam.location = pos
        cam.rotation_quaternion = q
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_quaternion", frame=f)
    act = cam.animation_data.action
    act.name = "camera_path"
    try:
        curves = act.fcurves
    except AttributeError:
        curves = [fc for layer in act.layers for strip in layer.strips
                  for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    return cam


# ================================================================ build
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.unit_settings.system = "METRIC"
    M = make_materials()
    C_GLB = get_coll("glb")
    C_SET = get_coll("set")
    C_DISH = get_coll("dishes")
    C_STUDIO = get_coll("dish_studio")

    plate_me = build_plate_mesh(M)
    for k in range(5):
        new_obj("plate_%d" % k, plate_me, C_GLB, (PLATE_XY[0], PLATE_XY[1], k * PLATE_PITCH))
    pot_me, lid_me, rim = build_pot(M)
    new_obj("pot", pot_me, C_GLB, (POT_XY[0], POT_XY[1], 0))
    new_obj("pot_lid", lid_me, C_GLB, (POT_XY[0], POT_XY[1], rim - 0.0002))

    mats = simulate_penne(80, seed=3, drop_r=0.46, z_lo=0.3, z_hi=4.0, cup_r=0.5, frames=240)
    pasta_me = pile_mesh("pasta", mats, recentre=True, keep_r=0.11)
    set_mat(pasta_me, M["pasta"])
    new_obj("pasta", pasta_me, C_GLB, (PASTA_XY[0], PASTA_XY[1], 0))

    rb_prof = chaikin(RICE_BOWL, 2)
    bowl_me = vessel("bowl", rb_prof, 72, M["ceramic"])
    new_obj("bowl", bowl_me, C_GLB, (BOWL_XY[0], BOWL_XY[1], 0))
    rice_me, rice_z = build_rice(rb_prof, M)
    new_obj("rice", rice_me, C_GLB, (BOWL_XY[0], BOWL_XY[1], rice_z))

    # --- real table (exported), HDRI world, PBR textures + AO bakes + contact-shadow decals
    new_obj("table", build_table_mesh(), C_GLB)
    scene.world = hdri_world(HDRI_STRENGTH)
    smart_uv(bpy.data.objects["pasta"])
    smart_uv(bpy.data.objects["rice"])
    ceramic_render = realism_pass()
    k = area("key", C_SET, (-1.1, -0.9, 1.4), (0, 0, 0.03), 1.0, 22, (1.0, 0.80, 0.58))
    k.data.spread = math.radians(70)
    r = area("rim", C_SET, (0.9, 1.3, 0.7), (0, 0, 0.05), 0.8, 16, (1.0, 0.60, 0.33))
    r.data.spread = math.radians(80)
    sd = bpy.data.lights.new("pendant", "SPOT")
    sd.energy = 16
    sd.color = (1.0, 0.72, 0.45)
    sd.spot_size = math.radians(80)
    sd.spot_blend = 1.0
    sd.shadow_soft_size = 0.35
    sp = new_obj("pendant", sd, C_SET, (0.0, 0.05, 1.3))
    aim(sp, (0.0, 0.05, 0.0))
    cam = build_camera(C_SET)
    cd = bpy.data.cameras.new("cam_mobile")
    cd.lens = 30
    cd.sensor_width = 36
    cd.clip_start = 0.01
    cm = new_obj("cam_mobile", cd, C_SET, MOBILE_POS)
    aim(cm, MOBILE_TGT)

    # --- dish studio (picker art)
    wide_prof = chaikin(WIDE_BOWL, 2)
    wide_me = vessel("wide_bowl", wide_prof, 72, ceramic_render)
    C = {k: get_coll("dish_" + k, C_DISH) for k in ("pasta", "rice", "potatoes", "chili", "soup")}
    # pasta: penne dropped into the wide bowl
    bm = bmesh.new()
    revolve_into(bm, wide_prof, 48, s=CM * 10)
    col_me = bm_to_mesh(bm, "_wide_collider")
    pm = simulate_penne(70, seed=9, drop_r=0.42, z_lo=0.7, z_hi=5.0, collider_me=col_me)
    dp = pile_mesh("dish_pasta_penne", pm, recentre=False, keep_r=0.095)
    set_mat(dp, M["pasta"])
    new_obj("dish_pasta_bowl", wide_me, C["pasta"], DISH_ORIGIN)
    new_obj("dish_pasta_penne", dp, C["pasta"], DISH_ORIGIN)
    top_z = max(v.co.z for v in dp.vertices)
    for i, (x, y, yaw) in enumerate([(-0.9, -0.6, 0.4), (0.5, -1.4, -0.7)]):
        leaf_obj("basil_%d" % i, C["pasta"],
                 Matrix.Translation(DISH_ORIGIN + Vector((x * CM, y * CM, top_z - 0.004)))
                 @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(-0.25, 4, "Y"),
                 0.052 - i * 0.008, 0.030 - i * 0.004, M["basil"])
    new_obj("dish_rice_bowl", bowl_me, C["rice"], DISH_ORIGIN)
    new_obj("dish_rice", rice_me, C["rice"], DISH_ORIGIN + Vector((0, 0, rice_z)))
    build_potatoes(C["potatoes"], DISH_ORIGIN, M, plate_me)
    build_chili(C["chili"], DISH_ORIGIN, M, wide_prof, wide_me)
    build_soup(C["soup"], DISH_ORIGIN, M, wide_prof, wide_me)
    O = DISH_ORIGIN
    area("dish_key", C_STUDIO, O + Vector((-0.38, -0.32, 0.85)), O, 0.45, 11, (1.0, 0.82, 0.62))
    area("dish_rim", C_STUDIO, O + Vector((0.45, 0.55, 0.35)), O + Vector((0, 0, 0.03)), 0.35, 7, (1.0, 0.62, 0.36))
    area("dish_fill", C_STUDIO, O + Vector((0.4, -0.7, 0.35)), O, 0.8, 2.5, (1.0, 0.9, 0.8))
    gbm = bmesh.new()
    bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=0.3)
    catcher = new_obj("shadow_catcher", bm_to_mesh(gbm, "shadow_catcher", False), C_STUDIO, O)
    catcher.is_shadow_catcher = True
    dcd = bpy.data.cameras.new("cam_dish")
    dcd.lens = 60
    dcd.sensor_width = 36
    dcd.clip_start = 0.01
    new_obj("cam_dish", dcd, C_STUDIO, O + Vector((0, -0.5, 0.6)))

    scene.camera = cam
    scene.frame_start, scene.frame_end = 0, 240
    scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("saved", BLEND)
    export_hdr()
    export_glbs()


def gltf_export(**kw):
    props = {p.identifier: p for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    ok = {}
    for k, v in kw.items():
        p = props.get(k)
        if p is None or (p.type == "ENUM" and isinstance(v, str) and len(p.enum_items) and v not in p.enum_items.keys()):
            log("gltf: option skipped (not in this exporter):", k, v)
            continue
        ok[k] = v
    bpy.ops.export_scene.gltf(**ok)


def select_only(names):
    for o in bpy.context.view_layer.objects:
        o.select_set(o.name in names)


FIRST_SCREEN_BUDGET = 1.8 * 1024 * 1024
LATE = {"pot", "pot_lid", "pasta", "bowl", "rice", "shadow_pot", "shadow_pasta", "shadow_bowl"}


def export_scene(path, names):
    select_only(names)
    gltf_export(filepath=path, export_format="GLB", use_selection=True, export_apply=False,
                export_materials="EXPORT", export_image_format="WEBP", export_image_quality=90,
                export_texcoords=True, export_normals=True, export_tangents=False,
                export_vertex_color="NONE", export_cameras=False, export_lights=False,
                export_animations=False, export_extras=False, export_yup=True,
                export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                export_draco_position_quantization=14, export_draco_normal_quantization=10,
                export_draco_texcoord_quantization=14)
    return os.path.getsize(path)


def export_glbs():
    os.makedirs(ASSETS, exist_ok=True)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    select_only({"camera"})
    scene.frame_set(0)
    gltf_export(filepath=os.path.join(ASSETS, "camera.glb"), export_format="GLB", use_selection=True,
                export_cameras=True, export_lights=False, export_materials="NONE", export_animations=True,
                export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_range=True,
                export_frame_step=1, export_optimize_animation_size=False, export_anim_slide_to_zero=False,
                export_yup=True, export_apply=False, export_extras=False)
    names = {o.name for c in ("glb", "glb_decals") for o in bpy.data.collections[c].objects}
    main = os.path.join(ASSETS, "scene.glb")
    late = os.path.join(ASSETS, "scene-late.glb")
    size = export_scene(main, names)
    fixed = os.path.getsize(os.path.join(ASSETS, "camera.glb")) + os.path.getsize(os.path.join(ASSETS, "env-512.hdr"))
    if size + fixed > FIRST_SCREEN_BUDGET:
        log("scene.glb %.0f KB + camera/env over budget -> splitting" % (size / 1024))
        export_scene(main, names - LATE)
        export_scene(late, names & LATE)
    elif os.path.exists(late):
        os.remove(late)
    log("exported GLBs")


# ================================================================ rendering
def setup_cycles(w, h, samples, transparent, exposure=0.0, look=None):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_adaptive_sampling = True
    s.cycles.adaptive_threshold = 0.008
    s.cycles.use_denoising = True
    s.cycles.denoiser = "OPENIMAGEDENOISE"
    if hasattr(s.cycles, "denoising_use_gpu"):
        s.cycles.denoising_use_gpu = False
    s.cycles.max_bounces = 10
    s.cycles.glossy_bounces = 4
    s.cycles.transmission_bounces = 6
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.render.threads_mode = "FIXED"
    s.render.threads = THREADS
    s.render.resolution_x, s.render.resolution_y = w, h
    s.render.resolution_percentage = 100
    s.render.film_transparent = transparent
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    s.render.image_settings.color_depth = "8"
    s.view_settings.view_transform = "AgX"
    s.view_settings.look = "None"
    if look:
        try:
            s.view_settings.look = look
        except TypeError:
            log("look not available:", look)
    s.view_settings.exposure = exposure


def show_only(visible):
    """visible: collection names to render ('glb', 'set', 'dish_studio', 'dish_<name>')."""
    for c in bpy.data.collections:
        if c.name.startswith("dish_") and c.name != "dish_studio":
            c.hide_render = c.name not in visible
    any_dish = any(v.startswith("dish_") and v != "dish_studio" for v in visible)
    for name in ("glb", "glb_decals", "set", "dishes", "dish_studio"):
        c = bpy.data.collections.get(name)
        if c:
            c.hide_render = not (name in visible or (name == "dishes" and any_dish))


def render_to(path):
    s = bpy.context.scene
    s.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log("rendered", os.path.basename(path), "%.1fs" % (time.time() - t))
    time.sleep(PAUSE)


def mode_preview():
    os.makedirs(RENDERS, exist_ok=True)
    s = bpy.context.scene
    show_only({"glb", "set"})
    setup_cycles(640, 400, 32, False, TABLE_EXPOSURE)
    s.camera = bpy.data.objects["camera"]
    frames = [int(a) for a in (os.environ.get("DC_FRAMES") or "0,30,60,95,130,170,200,220,240").split(",")]
    for f in frames:
        s.frame_set(f)
        render_to(os.path.join(RENDERS, "cam_%03d.png" % f))
    # scale check: pasta and rice at 0.6x
    for n in ("pasta", "rice"):
        bpy.data.objects[n].scale = (0.6, 0.6, 0.6)
    for f in (95, 170):
        s.frame_set(f)
        render_to(os.path.join(RENDERS, "scale06_%03d.png" % f))
    for n in ("pasta", "rice"):
        bpy.data.objects[n].scale = (1, 1, 1)
    setup_cycles(390, 844, 32, False, TABLE_EXPOSURE)
    s.camera = bpy.data.objects["cam_mobile"]
    render_to(os.path.join(RENDERS, "mobile_preview.png"))


DISH_FIT_R = 0.34     # dish silhouette must sit inside this radius (fraction of width) -> round tiles


def fit_dish_camera(coll):
    """Neutral 3/4 view; distance chosen so every projected vertex lies within DISH_FIT_R of centre."""
    from bpy_extras.object_utils import world_to_camera_view
    s = bpy.context.scene
    cam = bpy.data.objects["cam_dish"]
    pts = []
    for o in coll.all_objects:
        if o.type != "MESH":
            continue
        vs = o.data.vertices
        step = max(1, len(vs) // 3000)
        pts += [o.matrix_world @ vs[i].co for i in range(0, len(vs), step)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    el = math.radians(50)
    d = Vector((0.0, -math.cos(el), math.sin(el)))
    dist = 0.5
    for _ in range(40):
        cam.location = c + d * dist
        aim(cam, c)
        bpy.context.view_layer.update()
        worst = max(math.hypot(q.x - 0.5, q.y - 0.5) for q in (world_to_camera_view(s, cam, p) for p in pts))
        if abs(worst - DISH_FIT_R) < 0.002:
            break
        dist *= worst / DISH_FIT_R
    return dist


def mode_dishes():
    os.makedirs(RENDERS, exist_ok=True)
    s = bpy.context.scene
    only = os.environ.get("DC_DISHES")
    names = only.split(",") if only else ["pasta", "rice", "potatoes", "chili", "soup"]
    setup_cycles(512, 512, 384, True, DISH_EXPOSURE, "AgX - Punchy")
    s.camera = bpy.data.objects["cam_dish"]
    for n in names:
        show_only({"dish_studio", "dish_" + n})
        fit_dish_camera(bpy.data.collections["dish_" + n])
        render_to(os.path.join(RENDERS, "dish_%s.png" % n))


def mode_hero():
    os.makedirs(RENDERS, exist_ok=True)
    s = bpy.context.scene
    show_only({"glb", "set"})
    s.frame_set(240)
    cam = bpy.data.objects["camera"]
    pos, tgt = hermite_path(240)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (tgt - pos).length
    cam.data.dof.aperture_fstop = 5.6
    s.camera = cam
    which = os.environ.get("DC_HERO", "desk,mobile").split(",")
    if "desk" in which:
        setup_cycles(1600, 1000, 256, True, TABLE_EXPOSURE)
        render_to(os.path.join(RENDERS, "hero.png"))
    if "mobile" in which:
        cm = bpy.data.objects["cam_mobile"]
        cm.data.dof.use_dof = True
        cm.data.dof.focus_distance = (Vector(MOBILE_TGT) - cm.location).length
        cm.data.dof.aperture_fstop = 5.6
        s.camera = cm
        setup_cycles(780, 1688, 256, True, TABLE_EXPOSURE)
        render_to(os.path.join(RENDERS, "hero_mobile.png"))


def mode_matcaps():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(RENDERS, exist_ok=True)
    s = bpy.context.scene
    C = s.collection
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=64, radius=1.0)
    sphere = new_obj("sphere", bm_to_mesh(bm, "sphere"), C)
    cd = bpy.data.cameras.new("mc")
    cd.type = "ORTHO"
    cd.ortho_scale = 2.0
    cam = new_obj("mc", cd, C, (0, -6, 0))
    aim(cam, (0, 0, 0))
    s.camera = cam
    # camera space: +X right, +Z up, -Y toward the viewer
    area("key", C, (-3.0, -3.4, 3.2), (0, 0, 0), 2.6, 150, (1.0, 0.80, 0.58), size_y=3.4)
    area("rim", C, (3.6, 2.6, 1.4), (0, 0, 0), 1.4, 70, (1.0, 0.60, 0.33), size_y=4.0)
    area("bounce", C, (0.0, -1.0, -4.5), (0, 0, 0), 9.0, 12, (1.0, 0.62, 0.38), size_y=6.0)
    front = area("front", C, (0.0, -7.0, 1.2), (0, 0, 0), 12.0, 70, (1.0, 0.86, 0.70), size_y=7.0)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.004, 0.003, 0.002, 1)
    els[1].position, els[1].color = 1.0, (0.030, 0.021, 0.014, 1)
    mid = els.new(0.5)
    mid.color = (0.010, 0.0072, 0.005, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    s.world = world
    setup_cycles(512, 512, 512, False)
    mats = {
        "ceramic": principled("mc_ceramic", (0.905, 0.863, 0.791), rough=0.3, coat=0.8, coat_rough=0.04,
                              sss=0.05, sss_radius=(1, 0.8, 0.6), sss_scale=0.02),
        "metal": principled("mc_metal", (0.80, 0.76, 0.71), rough=0.27, metal=1.0),
        "food-warm": principled("mc_food", (0.86, 0.80, 0.70), rough=0.5, sss=0.35,
                                sss_radius=(1, 0.6, 0.35), sss_scale=0.06, coat=0.15, coat_rough=0.2),
    }
    for name, m in mats.items():
        front.hide_render = name != "metal"
        set_mat(sphere.data, m)
        render_to(os.path.join(RENDERS, "matcap_%s.png" % name))


def mode_framecheck():
    """Project every GLB object's bounding box into camera space; flag anything off-frame."""
    from bpy_extras.object_utils import world_to_camera_view
    s = bpy.context.scene
    objs = list(bpy.data.collections["glb"].objects)

    def bounds(cam, names):
        out = {}
        for o in objs:
            if o.name not in names:
                continue
            mw = o.matrix_world
            vs = o.data.vertices
            pts = [world_to_camera_view(s, cam, mw @ vs[i].co) for i in range(0, len(vs), 3)]
            out[o.name] = (min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts))
        return out

    def report(label, cam, names, w, h):
        s.render.resolution_x, s.render.resolution_y = w, h
        bad = []
        for n, (x0, x1, y0, y1) in bounds(cam, names).items():
            if x0 < 0.02 or x1 > 0.98 or y0 < 0.02 or y1 > 0.98:
                bad.append("%s x[%.2f,%.2f] y[%.2f,%.2f]" % (n, x0, x1, y0, y1))
        log("FRAME %-14s %s" % (label, "OK" if not bad else "CLIPPED: " + "; ".join(bad)))

    cam = bpy.data.objects["camera"]
    plates = {"plate_%d" % k for k in range(5)}
    for f, names in ((0, plates), (24, plates), (48, plates), (72, {"pot", "pot_lid", "pasta"}),
                     (95, {"pot", "pot_lid", "pasta"}), (118, {"pot", "pot_lid", "pasta"}),
                     (142, {"bowl", "rice"}), (170, {"bowl", "rice"}), (200, {"bowl", "rice"}),
                     (240, {o.name for o in objs})):
        s.frame_set(f)
        report("frame %d" % f, cam, names, 1600, 1000)
        if f == 240:
            report("frame 240 16:9", cam, names, 1920, 1080)
        cam.data.sensor_fit = "HORIZONTAL"      # phone portrait with horizontal FOV locked at 48.5 deg
        report("phone %d" % f, cam, names, 390, 844)
        cam.data.sensor_fit = "AUTO"
    report("cam_mobile", bpy.data.objects["cam_mobile"], {o.name for o in objs}, 780, 1688)


def mode_verify():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for fn in ("scene.glb", "camera.glb"):
        bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, fn))
    for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if o.type == "MESH":
            dims = tuple(round(x, 3) for x in o.dimensions)
            log("MESH %-8s verts=%6d tris~%6d loc=%s dims=%s mesh=%s" % (
                o.name, len(o.data.vertices), sum(len(p.vertices) - 2 for p in o.data.polygons),
                tuple(round(x, 3) for x in o.location), dims, o.data.name))
        else:
            log(o.type, o.name, tuple(round(x, 3) for x in o.location))
            if o.animation_data and o.animation_data.action:
                a = o.animation_data.action
                log("  action", a.name, "range", tuple(a.frame_range))


MODES = {"build": build, "preview": mode_preview, "dishes": mode_dishes, "hero": mode_hero,
         "matcaps": mode_matcaps, "verify": mode_verify, "framecheck": mode_framecheck, "export": export_glbs}

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    mode = argv[0] if argv else "build"
    t0 = time.time()
    MODES[mode]()
    log("done", mode, "%.1fs" % (time.time() - t0))
