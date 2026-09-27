# Lake Oswego Hacks: submission kit (Hackathon track)

**Live:** https://dinner-count.onrender.com  ·  **Sandbox for judges:** https://dinner-count.onrender.com/app/#demo  ·  **Code:** https://github.com/Goofturtles/dinner-count
(Free server: the first load after it sleeps can take ~50 seconds.)

## Devpost fields (paste-ready)

**Title:** Dinner Count

**Tagline:** Who's home for dinner, turned into exactly how much to cook, and it learns from your leftovers.

**The problem.** Families cook for everyone, every night. On the nights two people are out, the extra pasta sits in the fridge and gets thrown away. Cooking more than gets eaten is one of the most common ways households waste food, and it happens a few times a week in a lot of homes.

**What it does.**
- 4:00 PM: every family member's phone asks one question, *Home for dinner?* One tap: Home, Save me a plate, or Out.
- The cook's screen turns the count into an exact amount: "3 eating + 1 plate → Cook 320 g pasta", with the reason underneath.
- After dinner the cook taps how much was left (ran out / none left / a bowl / a lot), and the app adjusts that family's amount for that dish. Within about a week it matches how *your* family eats, not what the box says.
- Leftovers get claimed: the next day's question asks who's taking last night's chili for lunch.

**How we built it.** A vanilla-JavaScript installable web app (no build step) with a Node + Express API and Postgres (Neon). Real push notifications use Web Push with VAPID keys and a service worker, including the iPhone Home Screen path. The learning is a small set of pure, unit-tested functions (`src/portions.js`). The landing page is a scroll-driven three.js scene with models, materials and a camera move made in Blender 4.5, using CC0 textures. The app screens were designed from Mobbin research. Code was written with AI coding tools (Claude Code), directed, reviewed and tested by me.

**Privacy (it's an app about where kids are).** First names only: no email, phone, last name or location. A family code only lets you *ask* to join; the family's creator lets you in, and each device gets its own secret token. Answers expire after 30 days, and "Leave family" really deletes you.

**Challenges.** Making "none left" mean *just right*, so the amount doesn't creep up forever. Keeping dates in each family's own time zone, so an 8 PM report doesn't land on tomorrow's date. And iPhones only allow notifications from a Home Screen app, so the install path had to be built first.

**What's next.** Grocery-list amounts that come from the same learning, and more dishes.

## Rubric → evidence
| Criterion | Points | Evidence |
|---|---|---|
| Technical Execution | 30 | Live deploy with Postgres + real Web Push; `src/portions.js` learning engine; **19 unit/API tests** (`npm test`); two-phone end-to-end check (`tools/verify_app.cjs`, 28 checks); live API smoke test passed on the deployed URL (join approval, access control, amount drops when someone taps Out, learning, idempotent 4 PM trigger, delete on leave) |
| Purpose & Sustainability | 20 | Prevents household over-cooking at the moment it happens; leftovers get claimed instead of binned |
| Creativity & Innovation | 20 | The headcount isn't new; *grams that learn from your leftovers, per family, per dish* is |
| Presentation & Documentation | 15 | Cinematic landing page, README, this file, `docs/APP-DESIGN.md` (Mobbin references), CREDITS.md |
| Project Focus | 15 | The core loop only (ask → amount → leftovers → claim): no accounts, streaks, points, recipes, grocery list or chat |

## Video (≤ 3:00): a shot list, not a script
1. 0:00 The problem: a full pot, three people at the table.
2. 0:20 4:00 PM, three phones buzz, one taps **Out**. On the cook's phone, **500 g → 300 g** changes live.
3. 1:00 After dinner: "A lot" left → "Next time 270 g". Show the reason line.
4. 1:40 The next day: "Chili from last night… who's taking it?" One tap.
5. 2:10 Privacy in one line, then the sandbox link for judges.
6. 2:40 End card: live link + repo.

Filming tip: Family tab → **Send today's question now** fires the real push on demand.

## Before you submit (Arjun)
- [ ] On your iPhone: open the live link in Safari → Share → Add to Home Screen → open it → Start a family → Family tab → Turn on reminders → Send today's question now. You should get the notification.
- [ ] Film, then submit on Devpost with the live link, sandbox link and repo link.
