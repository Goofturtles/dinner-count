# Claude Code build prompt: Dinner Count

> Open Claude Code anywhere and say:
> **"Read C:\Users\arjun\Music\Documents\Desktop\Website\dinner-count\docs\PROMPT.md and execute it."**

---

## 0. Mission

Build **Dinner Count**: a family web app that turns "who's home for dinner?" into **exactly how much to cook**,
and gets more accurate every night by learning from leftovers.

One day with it:
1. **4:00 PM** — every family member's phone buzzes: *Home for dinner?* One tap: **Home / Save me a plate / Out**.
2. **5:30 PM, the cook's screen** — "3 eating + 1 plate". The cook picks the dish and gets an exact amount:
   **"Cook 320 g pasta."**
3. **After dinner** — how much was left: **ran out / none left / a bowl / a lot**.
4. **It learns** — always "a lot" of rice left means less rice next time, for *this* family. Inside a week the
   amounts match how the family actually eats, not what the box says.
5. **Leftovers get claimed** — tomorrow's 4 PM question adds "Chili from last night is in the fridge. Who's
   taking it for lunch?" One tap.

**The thing that must land:** a headcount poll is not new. *Grams, and learning from leftovers,* is. Every screen
must show the count turning into an amount.

**Done means:** a stranger opens the link on a phone, joins with a family code, gets a real 4 PM push
notification, and the cook sees an amount that changes when someone taps Out. Deployed, public link, working on
a real iPhone.

## 1. Target and hard rules

- **Hackathon:** Lake Oswego Hacks, due **Sun 2026-09-27, 5:00 PM PT**. Technical is 30 of 100 points, the
  heaviest category. **Phase 0:** re-open the rules page and confirm the deadline, rubric, and submission form.
- **No demo video in this build.** Arjun films it later. Don't script, shoot, or edit one. Do leave the app
  filmable: three devices can join one family, and `#demo` loads a sandbox family with a week of history.
- **Scope is one day.** Ship the five steps above and the landing page. No accounts, no streaks, no points, no
  recipe database, no grocery list, no chat.
- **Privacy — this is an app about where kids are.** See section 6. Never publish a family's real code.
- **Machine rules:** work only in `dinner-count/`. No visible terminal windows. No GitHub push until Arjun says
  so. Ask before installing anything beyond the dependency list. Work inline; no subagent fan-outs.
- Keep the 4090 at roughly 60–70% load during Blender renders, with pauses between batches.
- In any writeup, credit AI tools for the code.

## 2. Look and feel — zero.university style, with real Blender 3D

Arjun wants this to look and move like **why.zero.university**. **Read
`webgl-story-template/docs/BREAKDOWN.md` first** — it is a verified teardown of exactly how that site works, and
`webgl-story-template/docs/PROMPT.md` has the engine spec. Reuse the techniques, not their content: no copied
assets, copy, fonts, or scenes.

Take from it:
- **Scroll is an input, not page movement.** The wheel and touch drive a progress number from 0 to 1, eased with
  a frame-rate-independent lerp, and every animation is keyed to that number. No page scroll.
- **Real Blender art** — Blender 4.5 headless
  (`C:\Program Files\Blender Foundation\Blender 4.5\blender.exe -b -P pipeline/scene.py`), Cycles or EEVEE, with
  proper lighting, materials, and depth of field. Build a dinner-table scene: a pot, a pasta pile, plates, and a
  table.
- **Gates over passive scrolling** — one press-and-hold moment that doubles as "start a family".
- Film grain, a radial gradient ground, and a soft focal blur.

**Scope, in deadline order** (BREAKDOWN §7.4 is the point: zero gets most of its depth from *layers*, not meshes):
1. **First: the layered version.** Render the scene to 4–6 **transparent PNG depth layers** (foreground pot,
   mid table, background room, light rays) and composite them on the canvas with per-layer parallax from scroll
   and pointer, plus grain and a focal blur. This is cheap, loads fast, and is what actually reads as cinematic.
2. **Only if time remains:** add one live GLB (the pot) with a Blender-rendered matcap. A real modelled asset
   Arjun supplies is preferred over anything scripted from primitives — put it behind
   `pipeline/import_hero.py` the way `webgl-story-template` does, and skip it if none exists.
3. **Don't build:** a baked camera GLB, adaptive quality tiers, or multiple scenes. Not in one day.

The **app itself** (join, the 4 PM question, cook screen) stays fast, plain, and mobile-first, sharing only the
palette, type, and Blender-rendered dish art in the picker. **The working app comes first: stop landing-page work
6 hours before the deadline** and ship what's done.

**The landing page must work with no canvas at all.** Ship `/` as static HTML first: hero text in the DOM, and a
real `<a href="/join">Start a family</a>`. The canvas scene layers on top as an enhancement, and the press-and-
hold gate is an *alternative* to that link, never the only way in. Keyboard and screen-reader users must be able
to join without touching the scene (WCAG 2.1.1). Honor `prefers-reduced-motion` by showing the composed still.

Phone budget: under 3 MB and 30 fps at 390×844, or fall back to the still hero image.

## 3. Stack

- **Frontend:** one installable PWA. Vanilla HTML/CSS/JS, no build step. Mobile-first, thumb-sized taps.
  The landing page adds `three` (pinned version) and its Draco decoder.
- **Backend:** Node + Express on Render free tier, serving the PWA and a small JSON API.
- **Storage:** **Phase 0 must confirm whether Render's free Key Value plan actually persists.** It may be
  in-memory with LRU eviction, which loses data on restart. If it is not durable, use Upstash Redis free or Neon
  Postgres with the same key shapes. Never SQLite or a local file — the free tier's disk is wiped on sleep.
- **Push:** Web Push with VAPID (the `web-push` package) and a service worker. **VAPID keys live in Render env
  vars** — regenerating them on deploy invalidates every existing subscription.
- **The 4 PM trigger must survive sleeping.** A free Render service sleeps, so an in-process timer misses it.
  Primary trigger is a **free external pinger** (cron-job.org or UptimeRobot, every 5 min) hitting
  `POST /api/tick` with a shared secret. The first call wakes the service and may time out after ~50 s, so the
  pinger retries and `/api/tick` is idempotent per family per day. Schedule pings only for roughly
  **15:30–20:30 family-local**, not 24/7: Render's free 750 instance-hours are shared across Arjun's whole
  account (second-opinion also runs there), and constant pings would burn them. Keep an in-process timer as a
  backup. Do not depend on GitHub Actions cron: it needs a push Arjun hasn't approved, fires up to an hour late,
  and disables itself after 60 idle days.
- **Local dev:** port **3538** (confirm it's free in `.claude/launch.json`).

## 4. Data model

```js
fam:<code>        = { code, name, tz, reminderTime: '16:00', members: [{id, name, isCook, status}],
                      pending: [{id, name, requestedAt}], createdAt }
tok:<sha256>      = { code, mid }        // tokens live ONLY here
sub:<code>:<mid>  = PushSubscription
day:<code>:<date> = { answers: {mid: 'home'|'plate'|'out'}, dish, amount, unit, override: null|number,
                      leftover: null|'ranOut'|'none'|'bowl'|'lot', claimedBy: null|mid, sent: false }
dish:<code>:<dish>= { factor: 1.0, nights: 0, history: [{date, eaters, amount, leftover}] }
```

`<date>` is **the family's local date**, from one helper `todayInTz(tz)` used by every read and write. An 8 PM
leftover report must not land on tomorrow's UTC date. Unit-test it across a DST change. Give `day:` keys a TTL
(30 days).

## 5. The amount, and the learning (this is the project)

Base amounts per eater, with sources in the README, stored as `{amount, unit}` so volumes stay volumes:
pasta 100 g, rice 75 g, potatoes 200 g, chili 350 ml, soup 400 ml. "Save me a plate" counts as a full eater.

```
amount = round( base[dish].amount × eaters × factor[family][dish] , 10 )   // formatted with base[dish].unit
```

After the cook reports leftovers, nudge that family's factor for that dish:

```
target = { ranOut: 1.15, none: 1.00, bowl: 0.95, lot: 0.85 }[leftover]
factor = clamp( factor + 0.35 × (target − 1), 0.6, 1.5 )     // additive: symmetric, and it converges
```

**"None left" means "just right" and must hold steady** (target 1.00). The nudge is **additive, not
multiplicative** — a multiplicative one is asymmetric, so alternating "ran out" and "a lot" would drift downward
every pair until families are told to cook too little, which is the opposite of the promise. Tests:
- 20 nights of `none` leave the factor unchanged.
- Alternating `ranOut` / `lot` settles near 1.0 instead of drifting to a clamp.
- Running out of food recovers faster than one night of "a lot" pushes down.

Rules that keep it honest:
- Show the reason under every amount: *"Based on your last 4 pasta nights, your family eats about 15% less than
  the box says."* With no history: *"Starting from the package amount."*
- A cook override is stored in `day.override` and counts as feedback.
- Put all of this in `src/portions.js` as pure functions with **unit tests**. This is the technical core and must
  be testable without a browser.

## 6. Privacy and access (an app about kids' whereabouts)

- A family code alone must **not** grant access. The code only lets you **request** to join: the request lands in
  `pending`, and **the cook taps Approve** before any `day:` read returns answers. A leaked code then reveals
  nothing about where anyone is.
- On approval the server issues a **per-device member token**, stored only under `tok:<sha256>`. **Never
  serialize `token` or the family code in any member list** — screens 3, 4, and 6 all render members, and one
  careless endpoint would hand every client everyone's credential.
- Joining as an existing member's name is blocked — new joiners create a new member.
- Codes use a long, unambiguous alphabet (no 0/O/1/I), and join attempts are rate-limited per IP.
  Behind Render, the client IP is 3 hops into `X-Forwarded-For`.
- No email, phone, last name, or location. First names only. Say this plainly in the app and the README.
- "Leave family" actually deletes that member and their subscription.
- Judges get a **separate sandbox family** (`#demo`), never a real one.

## 7. Screens

1. **Landing** (`/`) — the cinematic scene from section 2, ending in a press-and-hold "Start a family" gate.
2. **Join / create** — code, first name, "I'm the cook", timezone auto-detected. On iOS, subscribing to push is
   **only possible inside the installed app**, so detect iOS Safari, show Add to Home Screen instructions with a
   screenshot, and only show the "Turn on reminders" button when `navigator.standalone === true`. That button
   requests permission from a real tap. `beforeinstallprompt` does not exist on iOS.
3. **The 4 PM question** — big Home / Save me a plate / Out buttons, the leftover claim row, and who has answered.
4. **Cook screen** — "3 eating + 1 plate", dish picker (Blender-rendered dish art), the amount in large type, the
   reason line, and "I cooked a different amount".
5. **After dinner** — ran out / none left / a bowl / a lot, repeated at the top of the next day's question since
   people forget at night.
6. **Family settings** — reminder time, members, leave family.

Defaults that stop it breaking: **no answer counts as Home**, and the cook can always edit the count by hand.

## 8. Build order (gates)

1. Rules check → `RULES.md`. Confirm Key Value persistence. Pick the pinger service.
2. `src/portions.js` + tests, including the `none`-holds-steady and DST cases.
3. API + storage + member tokens.
4. PWA screens 2–6, mobile-first.
5. Push: VAPID env vars, service worker, `/api/tick`, external pinger, the iOS install path **tested on a real
   iPhone**.
6. Deploy to Render → public URL. Verify against the deployed URL, not localhost.
7. Run one real dinner through it tonight and fix whatever breaks.
8. Landing page (section 2), **hard stop 6 hours before the deadline**.
9. README + `SUBMISSION.md` mapping each rubric line to evidence. Arjun submits it himself.

## 9. Verification (do it yourself, except the two human tasks below)

**Arjun's two 5-minute tasks** — everything else you verify yourself. Give him a pass/fail checklist for each,
ask early (not at the deadline), and keep building while you wait:
- **Sign up for the pinger** (cron-job.org or UptimeRobot) and paste the URL + secret. You must not create accounts.
- **Test push on a real iPhone**: install to the home screen, tap "Turn on reminders", and confirm the buzz
  arrives. No emulator can prove this.


`tools/verify_app.cjs`, Node Playwright (channel `chrome`, headless), run against the **deployed URL**:
1. **Unit**: portion math, factor updates, clamps, cold start, `none` holding steady, `todayInTz` across DST.
2. **Two-phone flow**: two contexts at 390×844 with touch in one family. One taps Out, and the cook's amount
   drops. Screenshot before and after.
3. **Learning**: 5 nights of "a lot" of rice drops the amount and stays inside the clamps.
4. **Leftovers**: report "a lot", then the next day's question offers the claim, and one tap assigns it.
5. **Push**: `/api/tick` sends once per family per day, is safe every 5 minutes, and survives a cold start.
6. **Durability**: restarting the *web service* never clears the key-value store, so that proves nothing. Read
   back the store's own eviction/persistence policy, write a key, restart the **store**, and re-read it.
7. **Access control**: with a family code but no member token, every read and write is refused.
8. **Mobile + accessibility**: nothing clipped, tap targets ≥ 44 px, contrast ≥ 4.5:1, real `<button>` elements,
   `aria-live` on the amount (it changes with no navigation), `prefers-reduced-motion` honored by the landing
   scene, and no `user-scalable=no` in the viewport meta.
9. **Empty and broken states**: bad code, nobody answered yet, offline.
10. **Landing page**: loads under 3 MB, holds 30 fps at 390×844, and falls back to a still image when WebGL is
    missing.
