# Dinner Count

**Who's home for dinner, turned into exactly how much to cook, and it learns from your leftovers.**

Built for Lake Oswego Hacks 2026 (theme: Technology for the Planet).

## The problem
Families cook for everyone every night. On the nights two people are out, the extra food sits in the fridge and gets thrown away. Cooking too much is one of the most common ways households waste food, and it happens a few times a week.

## How it works
1. **4:00 PM:** every family member's phone gets one question: *Home for dinner?* One tap: **Home / Save me a plate / Out**. No answer counts as Home.
2. **The cook's screen** turns the count into an amount: "3 eating + 1 plate → **Cook 320 g pasta**", with the reason underneath.
3. **After dinner**, the cook taps how much was left: **ran out / none left / a bowl / a lot**.
4. **It learns.** Each report nudges that family's amount for that dish, so within about a week the amounts match how *this* family eats, not what the box says.
5. **Leftovers get claimed.** The next day's question adds "Chili from last night is in the fridge. Who's taking it for lunch?" One tap.

## The learning (`src/portions.js`, pure functions, unit-tested)
```
amount = round(base[dish] × eaters × factor[family][dish], 10)
target = { ranOut: 1.05, none: 1.00, bowl: 0.95, lot: 0.85 }[leftover]
factor = clamp(factor × (1 + 0.35 × (target − 1)), 0.6, 1.5)
```
"None left" means *just right* and holds the factor steady (tested: 20 nights of "none" leave it unchanged). A cook's "I cooked a different amount" also counts as feedback. Re-reporting a night never counts it twice.

**Starting amounts per person** are typical adult main-course portions from common package serving guidance: pasta 100 g dry, rice 75 g dry, potatoes 200 g, chili 350 ml, soup 400 ml. They are only the starting point. The app replaces them with what your family actually eats.

## Privacy (it's an app about where kids are)
- First names only. **No email, phone, last name, or location.**
- A family code only lets you *ask* to join. The family's creator has to let you in, and every device gets its own secret token.
- Answers expire after 30 days. "Leave family" really deletes you, and the last person out deletes the family.
- Judges get a separate sandbox family (`/app/#demo`), never a real one.

## Try it
- Sandbox with a week of history: `/app/#demo`
- Start a real family: `/app/`. On iPhone, add it to your Home Screen first; that's the only way iPhones allow the 4 PM notification.

## Stack
Vanilla HTML/CSS/JS PWA (no build step), Node + Express, Postgres (Neon), Web Push (VAPID) with a service worker. The landing page uses three.js 0.169 with Draco GLB models and a camera animation made in Blender 4.5. The app screens' design was researched on Mobbin (`docs/APP-DESIGN.md`).

```
npm install
npm run vapid        # once; put the keys in .env
npm run dev          # http://localhost:3538
npm test             # 19 unit + API tests
node tools/verify_app.cjs   # two-phone end-to-end check (Playwright)
```
Env: `DATABASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `TICK_SECRET` (POST `/api/tick` with header `x-tick-secret`).

## Credits
- Code written with AI coding tools (Claude Code), directed, reviewed and tested by Arjun Sharma.
- 3D assets built in Blender with CC0 textures from Poly Haven and ambientCG; see `CREDITS.md`.
