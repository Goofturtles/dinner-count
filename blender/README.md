# Dinner Count: Blender assets

Everything under `public/assets/` is built from one script, `blender/build_scene.py` (Blender 4.5.3, headless). All geometry is modelled in code. Surfaces use three CC0 photo texture sets in `blender/textures/` (Poly Haven walnut veneer, ambientCG Porcelain001, ambientCG Metal009) plus the Poly Haven "Hotel Room" HDRI that ships inside Blender. Credits are in `../CREDITS.md`. Pasta and rice surfaces are still generated.

## Rebuild

Run from `dinner-count/`. Each step launches Blender in the background with no window. Renders and bakes use Cycles on the CPU (20 of 32 threads, about 62%) with a 2 s pause between frames, so the GPU is never loaded.

```sh
B="C:/Program Files/Blender Foundation/Blender 4.5/blender.exe"
"$B" -b --factory-startup -P blender/build_scene.py -- build        # ~2 min: model, sims, textures, AO bakes, decals, .blend, GLBs, env maps
"$B" -b blender/dinner_count.blend -P blender/build_scene.py -- framecheck   # every subject in frame on every camera (2% margin)
"$B" -b blender/dinner_count.blend -P blender/build_scene.py -- preview      # 640x400 path frames + 0.6x scale checks -> blender/renders/
"$B" -b blender/dinner_count.blend -P blender/build_scene.py -- hero         # ~3 min: hero.png + hero_mobile.png
"$B" -b blender/dinner_count.blend -P blender/build_scene.py -- dishes       # ~7 min: 5 dish PNGs (DC_DISHES=pasta,rice to limit)
"$B" -b --factory-startup -P blender/build_scene.py -- matcaps      # legacy matcaps (kept for the no-PBR fallback)
"$B" -b --factory-startup -P blender/build_scene.py -- verify       # re-imports the GLBs, prints names / verts / camera range
python blender/post.py                                               # PNG -> WebP, dish margin fade, hero edge blend, SIZES.log
```

The build is deterministic (seeded random numbers and rigid-body sims). Intermediate textures land in `blender/tex/`, renders in `blender/renders/`, and `blender/SIZES.log` holds the latest size report.

## Files (sizes from SIZES.log)

| File | Size | What |
|---|---|---|
| `scene.glb` | 1140 KB | All table objects: Draco meshes + PBR materials + 18 WebP textures (`EXT_texture_webp`, required) |
| `camera.glb` | 8.7 KB | One camera node `camera`, baked animation `camera_path` |
| `env.exr` | 185 KB | 1K HDRI, DWAB-compressed. **Recommended for desktop and phone.** three.js 0.169 `EXRLoader` decodes it (verified in Node) |
| `env.hdr` | 1404 KB | Same 1K HDRI as Radiance RGBE (lossless copy of the EXR) |
| `env-512.hdr` | 207 KB | 512x256 RGBE for phones: 3x3 blurred, 4 mantissa bits dropped. Fine for IBL, don't show it as a visible background |
| `hero.webp` | 57 KB | 1600x1000 Cycles still of frame 240, edges blended into the #2A211A to #14110E page gradient |
| `hero-mobile.webp` | 41 KB | 780x1688 portrait still (camera `cam_mobile`) |
| `dish-{pasta,rice,potatoes,chili,soup}.webp` | 16-24 KB each | 512x512 RGBA. The dish sits inside a circle of radius 0.34W, and alpha is exactly 0 in the outer 12% band, so it's safe in round tiles |
| `matcap-{ceramic,metal,food-warm}.webp` | 2-3 KB each | Earlier matcap look, superseded by PBR but kept |

**First-screen payload** (scene + camera + env): 1.33 MB desktop with `env.exr`, 1.36 MB phone with `env-512.hdr`. The budget is 1.8 MB. The build splits out `scene-late.glb` (pot, lid, pasta, bowl, rice and their decals) automatically only if the budget is exceeded; right now it isn't, so there is no `scene-late.glb`.

## Objects in scene.glb

Coordinates below are Blender (Z-up, metres). glTF/three.js is Y-up: `(x, y, z)` becomes `(x, z, -y)`. Transforms are clean (no rotation, scale 1). Each origin is a sensible pivot:

| Node | Pivot / notes |
|---|---|
| `plate_0` ... `plate_4` | Stack at (-0.42, 0.02). `plate_0` is the bottom, `plate_4` the top. Pitch 10.3 mm. Origin at the foot centre. All five share one mesh (27 cm plate) |
| `pot` | (-0.02, 0.10, 0), base centre. Brushed steel, 23 cm, two loop handles |
| `pot_lid` | Sits on the rim (z = 0.144). Lift along +Z |
| `pasta` | (0.17, -0.12, 0). Rigid-body penne heap (73 penne), origin at the heap base. Scale 0.6-1.0 about the origin |
| `bowl` | (0.40, 0.03, 0), base centre |
| `rice` | Origin at the bowl's inner bottom (z = 7.5 mm). Scale 0.6-1.0 and the mound sinks into the bowl (checked in renders) |
| `table` | 2.0 x 1.2 x 0.04 m walnut top, surface at z = 0, centred on (0, 0.10). No underside |
| `shadow_plate_0` | 0.36 m quad on the table under `plate_0` (z = +0.5 mm) |
| `shadow_plate_1..4` | 18.6 cm disc on the well of the plate below (z = well + 0.15 mm). Fade each to 0 as its plate lifts |
| `shadow_pot`, `shadow_bowl`, `shadow_pasta` | 0.40 / 0.22 / 0.28 m quads on the table (+0.5 mm). Parent `shadow_pasta` to `pasta` so it scales with it |

Decals are black with a baked alpha (`alphaMode: BLEND`). Give them `depthWrite: false`, and add `polygonOffset` if they z-fight.

## Materials and textures (glTF PBR, WebP)

| Material | baseColor | normal | ORM (R = AO, G = roughness, B = metal) | Notes |
|---|---|---|---|---|
| `plate`, `bowl` | factor cream #F4EFE6 (no texture) | Porcelain001 normal (pinholes), strength 0.6, tiled 3x1 (plate) / 2x1 (bowl) via `KHR_texture_transform` | own AO bake + Porcelain001 gloss 0.06-0.16 resampled into UV space | UVs: u = angle, v = profile length. Whole-number u repeats, so no seam |
| `pot`, `pot_lid` | Metal009 colour lifted to stainless (about 0.55 linear), tiled 3x2 (pot) / 3x1 (lid) | Metal009 brushed normal, same tiling (streaks run around the pot, concentric on the lid) | 512: own AO (lid on) + Metal009 roughness about 0.30, metal 1 | |
| `pasta` | semolina gold with specks (1K) | none | 512 AO + roughness 0.55 | Smart-UV |
| `rice` | factor (0.86, 0.84, 0.78) | none | 512 AO (grain crevices) + roughness 0.45 | Smart-UV |
| `table` | Poly Haven walnut veneer, graded darker and warmer with its AO folded in (1K, 1 m tile, UV0) | walnut veneer normal (1K, tiled) | walnut roughness remapped to 0.44-0.55 on UV0; **occlusion on UV1** (1K, whole table, includes pot + bowl contact shadows) | The exporter packed rough (G, UV0) and AO (R, UV1) into one image. That is valid glTF, and GLTFLoader sets `aoMap.channel = 1` |

Notes for the web:
- `aoMap` only darkens ambient/IBL light in three.js. Light the scene with `env.exr` through PMREM so the AO and table contact shadows show. The decals work under any lighting.
- The table's occlusion already contains the pot and bowl contact shadows. `shadow_pot` and `shadow_bowl` are there for direct-light setups. Using both doubles the darkness, so pick one (or halve the decal opacity).
- Plates, bowl and pasta AO were baked without their movable neighbours (rice, other plates), so lifting and scaling never reveals a baked-in shadow.
- Blender lit the renders with the HDRI at strength 0.25, plus a warm key area light (upper-left), a warm rim (back-right) and a soft overhead pendant, AgX at -1.5 EV. The web will not match the area lights exactly. Check that the HDRI's bright window lands on the same side as in `hero.webp`; if it's mirrored, rotate the environment by pi.

## Camera path (camera.glb)

24 fps, frames 0-240 = 0-10 s, 241 samples (location + rotation), smooth Hermite path with no cuts. Blender lens is 40 mm, so yfov is 31.4 deg at 1.6 aspect (hfov 48.5 deg).

| Frames | Subject | Best-framed range |
|---|---|---|
| 0-60 | Plate stack | 0-48 (slow drift) |
| 60-130 | Pot + pasta | 72-118 |
| 130-200 | Rice bowl | 142-200 |
| 200-240 | Pull back to the wide hero of the whole table | 240 |

`framecheck` passes (every featured subject inside a 2% margin) at 1600x1000 and 16:9. It also passes on a 390x844 phone **if the horizontal FOV is locked at 48.5 deg**: `camera.fov = 2*atan(tan(24.25 deg) / aspect)` for aspect < 1.6. With the stock yfov a portrait phone crops the sides.

## Known weaknesses

- Pasta and rice textures are still generated rather than photo-based; at their size on screen that is hard to tell.
- The Porcelain001 normal is almost flat (pinholes only), so the glaze look comes from low roughness, AO and the HDRI. The texture tiles are not visible.
- WebP is exported at quality 90 so the walnut and steel relief survives (about 0.8 correlation with the source normals; q82 lost about a third of the relief).
- `scene.glb` now requires `KHR_texture_transform` (tiled porcelain and steel). three.js GLTFLoader supports it.
- Rice is the heaviest mesh (36k vertices after UV seams) and carries the heaviest texture (rice ORM, 90 KB).
- The plate-on-plate decal is a uniform soft disc, because a stacked plate's well is fully covered. It only shows while a plate lifts.
- The hero stills include Cycles-only effects (area-light soft shadows, depth of field), so the live WebGL frame will be close but not identical.
