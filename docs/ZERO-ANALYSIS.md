# why.zero.university: measurements we match (techniques only)

Captured 2026-09-26 with Node Playwright (Chrome, headless, SwiftShader, ~8 fps) at 1440x900 and 390x844,
scrubbed with wheel/CDP touch, gates held with the pointer. Screens: `tools/out/zero-ref/` (d-*, m-*),
their HUD CSS rules: `tools/out/zero-ref/css-hud.css`. Nothing of theirs (assets, copy, fonts, scenes) is reused.

## Structure
- 5 worlds, one canvas, zero DOM scroll: frost/green loader, sky garden, red curtain, green/black paper,
  black space, white clouds, isometric city. **Each act owns one hue**; acts change by crossfade or white-out.
- A gate every 15-25 s: draw-a-circle loader, then TAP/HOLD rings at act ends (3 holds), then the world.
- Holding a gate **changes the grade while you hold** (garden drifts to red before the cut to the red act).
- Headline lettering sits in the frame's empty space, never on the hero mesh: centre (1 line), or split
  top-left / bottom-right around the ring. Numbers ride **on glass slabs held by the hero object**.

## HUD (desktop 1440x900; mobile in brackets)
| Piece | Measured |
|---|---|
| Top-left round glass button | 40x40, top 16, left 20 |
| Top-right glass pill (XP) | 16px text, padding 11x16, radius 999 [moves top-left] |
| Ruler | 300x60 box, top 16, centred; ticks 1px (minor 9px, major 18px), labels mono 12px, tracking .08em, edge mask 8%/92%; fixed centre needle 2x18 [compact, top-right] |
| Status label | mono 1.25rem, bottom 108px, shimmer gradient clipped to text (9 s loop) |
| Hold gate | 88px ring, 4px white progress stroke with glow, two ripple rings every 1.4 s, label "TAP / HOLD" mono bold 1.4rem to the ring's right (+22px) |
| Bottom CTA | glass pill ~430x56 at bottom ~18px: round icon, dark pill button ~320x48, round menu [~300 wide] |

## Glass (the stacked-layer technique)
A `.has-glass` host holds an absolutely positioned stack: fill (grey 15%), colour-burn tint (5%),
soft and strong inset highlights (offset ~0.28em), light and dark inset edges (plus-lighter / overlay),
inner glow (1.75em inset). Plus a 1px gradient border via a masked `::after`. No backdrop blur on theirs.
**Ours:** same layering idea, warm-tinted values of our own, plus backdrop blur for legibility over 3D.

## Type and colour
- Lettering: one huge word (~100-130px desktop, ~48px mobile) with small companions (~24-30px);
  blur-to-sharp and glow reveals keyed to scroll. All baked to textures on theirs (not accessible).
- **Ours:** Geist 600, tracking -0.045em for the big line, real HTML text, same blur/glow reveal by progress.
- Grain is strong (visible at 100%), vignette mild, lens blur heavy on foreground petals/shards.

## Motion
- Virtual scroll eased with `1 - exp(-k*dt)`; ~12 wheel steps per act beat at 120px deltas.
- Gate completion: short autoplay into the next act (1-2 s), often through a white or colour flash.

## What Dinner Count takes (reinvented)
- Loader gate = the product's own 4 PM question ("Home for dinner?", tap HOME) while a clock counts to 4:00.
- Ruler = a dinner clock 3:50 PM to 7:10 PM, needle at the current story time.
- Top-right pill = tonight's running count/amount (their XP role). Bottom pill = "Start a family" link.
- Acts: cream 4 PM (plates) -> tomato (pot, HOLD TO COOK) -> night + brass (leftovers) -> steam reveal
  -> dusk table with the final hold ring. Numbers on glass cards pinned to the dishes.

## Mobbin references used for the interface
- Glass stat cards (big number + mono caption): Monologue https://mobbin.com/sites/sections/d5ba1cfe-7339-4d81-8531-ffdfa1d8c3af
- Tick-mark timeline ruler with accent ticks: V7 https://mobbin.com/sites/sections/a5b3c6c0-dd04-4ca2-b06b-4ee1c673c2a5
- Hold-to-confirm pill in a dark glass sheet: Opal https://mobbin.com/screens/e187ab82-450c-4625-8592-e6df33f395a3
- Thin progress arc around a 3D object on dark ground: Oura https://mobbin.com/screens/6fb27813-fdf7-4bb5-8baf-1ff5f38a4c4c
- Glass card with a pill button over imagery: Artlist https://mobbin.com/screens/edcf3e08-161c-4684-99cc-940d658acffd
- Frosted pill nav over a full-bleed scene: Analogue Agency https://mobbin.com/sites/sections/2897fc9c-97a9-48e6-9b96-ea02583b012d
- Headline top-left / product centre / small copy + CTA lower-right: Farm Minerals https://mobbin.com/sites/sections/2bb8e438-aba5-4bcc-9d43-a89ab22765f7
- Giant word bottom-left with a small tagline and arrow CTA right: VanMoof https://mobbin.com/sites/sections/33eaa6a1-4089-4d0c-9f7b-0c9cf0b30b62
