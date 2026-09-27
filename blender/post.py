"""Dinner Count - turn Blender PNG renders into web assets and log sizes.

Run after the Blender modes (see README.md):   python blender/post.py
Needs Pillow + numpy (already on this machine). Writes public/assets/*.webp and blender/SIZES.log.
"""
import json
import os
import struct

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
R = os.path.join(HERE, "renders")
A = os.path.join(ROOT, "public", "assets")
BG_IN, BG_OUT = (0x2A, 0x21, 0x1A), (0x14, 0x11, 0x0E)   # page radial gradient, centre -> edge


def matcap(name):
    a = np.asarray(Image.open(os.path.join(R, "matcap_%s.png" % name)).convert("RGB")).astype(np.float32)
    h, w, _ = a.shape
    cy, cx, rad = (h - 1) / 2, (w - 1) / 2, w / 2
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - cx, yy - cy)
    ang = np.arctan2(yy - cy, xx - cx)
    out = r > rad * 0.975          # replace the anti-aliased rim + background with the edge colour
    sx = np.clip(np.round(cx + np.cos(ang) * rad * 0.965), 0, w - 1).astype(int)
    sy = np.clip(np.round(cy + np.sin(ang) * rad * 0.965), 0, h - 1).astype(int)
    a[out] = a[sy[out], sx[out]]
    im = Image.fromarray(a.astype(np.uint8)).resize((256, 256), Image.LANCZOS)
    im.save(os.path.join(A, "matcap-%s.webp" % name), "WEBP", quality=92, method=6)


def dish(name):
    im = Image.open(os.path.join(R, "dish_%s.png" % name)).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot((xx + 0.5) / w - 0.5, (yy + 0.5) / h - 0.5)
    t = np.clip((0.38 - r) / (0.38 - 0.335), 0, 1)          # 0 beyond 0.38 -> >=12% clear margin
    a[..., 3] *= t * t * (3 - 2 * t)
    im = Image.fromarray(a.astype(np.uint8), "RGBA")
    im.save(os.path.join(A, "dish-%s.webp" % name), "WEBP", quality=90, alpha_quality=100, method=6)


def radial(w, h, cx=0.5, cy=0.42):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot(xx - cx * w, yy - cy * h) / np.hypot(w / 2, h / 2)
    t = np.clip(d, 0, 1)
    t = t * t * (3 - 2 * t)
    c = np.array(BG_IN, np.float32) * (1 - t[..., None]) + np.array(BG_OUT, np.float32) * t[..., None]
    return c, d


def hero(src, dst, quality=82):
    im = np.asarray(Image.open(os.path.join(R, src)).convert("RGBA")).astype(np.float32)
    h, w = im.shape[:2]
    bg, d = radial(w, h)
    rgb, alpha = im[..., :3], im[..., 3:4] / 255.0
    comp = rgb * alpha + bg * (1 - alpha)
    # fade the frame edges into the page gradient so the still sits seamlessly on #14110E
    v = np.clip((d - 0.62) / 0.45, 0, 1)
    v = (v * v * (3 - 2 * v))[..., None]
    comp = comp * (1 - v) + bg * v
    comp = np.maximum(comp, bg * 0.92)   # lift the deepest shadows to the page colour so nothing reads as a hole
    comp += (np.random.default_rng(1).random(comp.shape, dtype=np.float32) - 0.5) * 1.2   # dither vs banding
    Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8)).save(os.path.join(A, dst), "WEBP",
                                                                  quality=quality, method=6)


def glb_json(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + n])


def main():
    os.makedirs(A, exist_ok=True)
    for m in ("ceramic", "metal", "food-warm"):
        matcap(m)
    for d in ("pasta", "rice", "potatoes", "chili", "soup"):
        dish(d)
    hero("hero.png", "hero.webp")
    hero("hero_mobile.png", "hero-mobile.webp")

    # 72 px recognisability sheet (for eyeballing only)
    sheet = Image.new("RGBA", (5 * 88, 88), (26, 21, 17, 255))
    for i, d in enumerate(("pasta", "rice", "potatoes", "chili", "soup")):
        t = Image.open(os.path.join(A, "dish-%s.webp" % d)).convert("RGBA").resize((72, 72), Image.LANCZOS)
        sheet.alpha_composite(t, (i * 88 + 8, 8))
    sheet.save(os.path.join(R, "contact_72.png"))

    lines = []
    total = 0
    for fn in sorted(os.listdir(A)):
        sz = os.path.getsize(os.path.join(A, fn))
        total += sz
        extra = ""
        if fn.endswith(".webp"):
            with Image.open(os.path.join(A, fn)) as im:
                extra = "%dx%d %s" % (im.width, im.height, im.mode)
        lines.append("%-22s %9d B  %7.1f KB  %s" % (fn, sz, sz / 1024, extra))
    def kb(*fs):
        return sum(os.path.getsize(os.path.join(A, f)) for f in fs if os.path.exists(os.path.join(A, f))) / 1024

    lines.append("")
    lines.append("all assets:                                   %8.1f KB" % (total / 1024))
    for label, fs in (("first screen, phone  (scene+camera+env-512.hdr)", ("scene.glb", "camera.glb", "env-512.hdr")),
                      ("first screen, desktop (scene+camera+env.exr)", ("scene.glb", "camera.glb", "env.exr"))):
        v = kb(*fs)
        lines.append("%-47s %8.1f KB  (budget 1843 KB) %s" % (label, v, "OK" if v <= 1843 else "OVER"))
    for fn in ("scene.glb", "scene-late.glb"):
        if not os.path.exists(os.path.join(A, fn)):
            continue
        g = glb_json(os.path.join(A, fn))
        img = sum(g["bufferViews"][i["bufferView"]]["byteLength"] for i in g.get("images", []))
        lines.append("")
        lines.append("%s nodes: %s" % (fn, ", ".join(n["name"] for n in g["nodes"])))
        lines.append("%s: %d meshes, %d materials, %d textures (%.0f KB of images), extensionsRequired %s" % (
            fn, len(g["meshes"]), len(g.get("materials", [])), len(g.get("textures", [])), img / 1024,
            g.get("extensionsRequired")))
        for i in g.get("images", []):
            lines.append("    %-22s %6.1f KB" % (i.get("name"), g["bufferViews"][i["bufferView"]]["byteLength"] / 1024))
    cam = glb_json(os.path.join(A, "camera.glb"))
    lines.append("")
    c = cam["cameras"][0]["perspective"]
    anim = cam["animations"][0]
    acc = cam["accessors"][anim["samplers"][0]["input"]]
    lines.append("camera.glb nodes: %s  yfov=%.4f rad (%.1f deg) aspect=%.3f" % (
        [n["name"] for n in cam["nodes"]], c["yfov"], np.degrees(c["yfov"]), c.get("aspectRatio", 0)))
    lines.append("camera.glb animation '%s': %d channels, %d keys, t=%.3f..%.3f s (24 fps -> frames 0..240)" % (
        anim["name"], len(anim["channels"]), acc["count"], acc["min"][0], acc["max"][0]))
    txt = "\n".join(lines)
    print(txt)
    with open(os.path.join(HERE, "SIZES.log"), "w", encoding="utf-8") as f:
        f.write(txt + "\n")


if __name__ == "__main__":
    main()
