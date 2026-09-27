# Dinner Count app: design notes (Mobbin-referenced)

One idea on every screen: **the headcount turns into an amount**. Reference, don't copy: each pattern below is
matched for craft and reinvented for our content. Fonts: Geist (text, titles, figures, tabular lining) and Geist
Mono (eyebrows, meta, codes). No serifs.

## Patterns per screen

| Screen | Pattern adopted | Mobbin reference |
|---|---|---|
| Start | Welcome: brand mark, one-line promise, a "product preview" card, stacked capsule buttons at the bottom (primary, secondary, text) | [Noom](https://mobbin.com/screens/cfc2f03f-5df8-4f37-bc4e-6cf0cb0bc96e), [Duolingo](https://mobbin.com/screens/fb4eda98-538d-4bc0-9ef6-bf06ed401c12), [Abode](https://mobbin.com/flows/844af9dc-5327-4704-89f0-4d230768b828) |
| Start preview | A mini "tonight" card: avatars + "3 eating + 1 plate" → dish art + "Cook 320 g". Ours shows the math, theirs a mascot | [Apple Health summary card](https://mobbin.com/screens/e60672f4-262f-478f-9326-6a6a2262f43f) |
| Create | Wise-style form: large title, lede, filled fields with labels above, a settings-style switch row with a subtitle, full-width capsule CTA | [Wise](https://mobbin.com/screens/04f4af0a-a6e1-4166-bcb7-45f093f2edbd), [Splitwise](https://mobbin.com/screens/726d2ab7-0406-4916-951e-74080b429b65) |
| Join | Big mono code field, centred, wide tracking (one input, not 8 boxes, so paste works); "the code only lets you ask" note | [Paired](https://mobbin.com/screens/9db90a5d-e0ae-4c48-b3a9-5811753d5eb6), [Abode](https://mobbin.com/flows/844af9dc-5327-4704-89f0-4d230768b828), [Posh](https://mobbin.com/screens/fdee71f5-bcb9-4b8c-9b41-694735f6bf7f) |
| Pending | Centred waiting state: tinted clock badge, title, who-and-where sentence, live status line, quiet cancel | [BlaBlaCar](https://mobbin.com/screens/e8084665-d73a-4c3e-b3f7-ad9efc1534ad), [DoorDash Dasher](https://mobbin.com/screens/27919063-dbc0-49df-99c0-cb5dbabb7778) |
| Install | Numbered steps in a card (filled number badges), then the share-sheet picture | [Truecaller](https://mobbin.com/screens/3515c637-eb2f-450a-9012-3e23b69850f2), [talabat](https://mobbin.com/screens/a8178cea-d40c-44f9-b184-54d5f04a4f92), [Buddy](https://mobbin.com/screens/b58bf220-7443-4e09-883e-5f11e6d29e5b) |
| Today: question | Three big choice rows, icon badge + label + hint, check on the right when chosen; colour per answer | [Apple Invites RSVP](https://mobbin.com/screens/5a5a0fdb-b99a-4352-bd57-80680ca6862d), [stoic.](https://mobbin.com/screens/d30feee4-8fab-4f6a-97be-2f2cb828dced) |
| Today: who answered | Inset list, tinted initial avatars, status pills (Home green, Plate brass, Out grey, no answer dashed) | [Apple Invites guest list](https://mobbin.com/screens/93e6c76c-c79b-4494-8cff-b61c72736251), [Telegram](https://mobbin.com/screens/b4926c5d-ee7d-4f0b-b1d8-09cc747e74dc) |
| Today: tally | Health-style card: eyebrow, then "4 eating → 370 g pasta" with the amount in the accent | [Apple Health](https://mobbin.com/screens/37402325-0dcd-4f27-b55c-122ac857d2ac) |
| Cook: count | Servings row with a capsule [− \| +] stepper, like a recipe scaler, but the count comes from answers | [Apple Store](https://mobbin.com/screens/58317aed-ad22-4043-bb85-4d2dc246612b), [Kitchen Stories](https://mobbin.com/screens/1e04386d-385e-4207-af18-7ef9a73cdba8), [Recime](https://mobbin.com/screens/76b7f726-05fc-41a6-bdab-aaa2024eb745) |
| Cook: dish picker | Round dish art over a name + amount, selected = accent ring + check badge | [BitePal](https://mobbin.com/screens/412b7bf4-d2c9-430b-8204-012cbddc65ea), [Swiggy](https://mobbin.com/screens/3b4a15c7-cd58-40f2-b44e-869b1f076e53) |
| Cook: amount hero | One huge number + unit, a label, then the plain-language "why" line (Oura score + sentence) | [Oura readiness](https://mobbin.com/screens/7ff0dafd-7d45-4d6c-bf94-f2d926bd0288), [Oura BP](https://mobbin.com/screens/247ec172-7754-4c0a-8453-27a87e92ca9e), [Gentler Streak](https://mobbin.com/screens/75155a21-29eb-49a8-95fd-646768eb36ba) |
| After dinner | 2×2 card grid with a glyph per option; ours adds what it teaches ("cook more", "just right") | [Deepstash](https://mobbin.com/screens/b620b4e9-f2d5-410a-9c22-7dca67b1fd17), [Amazon quiz](https://mobbin.com/screens/5f0aa030-bf0f-49d3-994b-c0fc87c96af8) |
| Family: code | Code card: mono code, share action, "don't share publicly" footnote | [Abode copy code](https://mobbin.com/flows/46b531b7-6b1a-440b-b955-d353acf3bcd8) |
| Family: requests | Pending rows with Let in / Deny capsules | [Apple Invites](https://mobbin.com/screens/93e6c76c-c79b-4494-8cff-b61c72736251), [X member requests](https://mobbin.com/screens/b9d47aae-5407-4bc1-b76f-56198d875dc0) |
| Family: reminders | Notification preview mock above the enable button (priming), time row with a pill time field | [Zocdoc](https://mobbin.com/screens/624436bd-5176-4fb7-99af-161f59d3ac99), [Lloyds](https://mobbin.com/screens/1d2e548f-513b-43a1-b148-e8e0071a7eea), [Blinkist](https://mobbin.com/screens/cadacc39-d6ce-4817-a1ad-5b633039b077) |
| Family: leave | Grouped sections with header above and footnote below; destructive action as red text row | [WhatsApp group info](https://mobbin.com/screens/35a19b01-4e1a-4bed-854b-700360465f77), [Reminders](https://mobbin.com/screens/a43135a4-5211-470f-945a-44f197d1060e) |
| Tab bar | Floating translucent capsule, selected tab gets a filled pill | [Gentler Streak](https://mobbin.com/screens/eb117be8-7532-49ff-8f57-57aeeb9630c9), [Opal](https://mobbin.com/screens/d5e84bad-9b8c-4386-915d-24e6c5ac4153), [CLEAR](https://mobbin.com/screens/a8d054fe-8acb-4a46-b5c4-5edfcddbd6a5) |
| Toast | Dark pill above the tab bar, short sentence | [Fabric](https://mobbin.com/screens/a6b9d0c9-126a-4248-90fa-9f16aa95a8dc), [Jobber](https://mobbin.com/screens/750a3e8e-0eb4-4e75-aba7-6ea87254bce1) |

## Type scale (Geist; line-height never under 1.25 for words)

| Role | Size / line / weight | Notes |
|---|---|---|
| Amount hero `.big` | clamp(84, 26vw, 112) / 1.0 / 700 | digits only, tabular lining, -0.045em |
| Large title h1 | 34 / 1.25 / 700 | -0.025em |
| Title h2 | 22 / 1.3 / 600 | -0.015em |
| Tally figures | 28 / 1.25 / 700 | tabular lining |
| Headline, buttons | 17 / 1.3 / 600 | |
| Body | 17 / 1.47 / 400 | |
| Subhead | 15 / 1.4 / 400–500 | hints, reasons |
| Footnote | 13 / 1.4 / 400 | muted |
| Eyebrow / meta | Geist Mono 12 / 1.4 / 500, caps, +0.08em | dates, section heads, code |
| Family code `.display` | Geist Mono 30 / 1.25 / 500, +0.12em | |

## Spacing, radii, colour

- 4 pt grid (`--s1`…`--s8`). Screen gutter 20 px; card padding 20 px; section gap 28 px; row height ≥ 56 px.
- Radii: cards 22, fields and tiles 16, small chips 999 (capsule), buttons capsule. Dish art is round and allowed to
  overflow its circle (no `overflow:hidden`, so no crop).
- Colour: warm paper background, off-white cards with a 1 px hairline plus a soft shadow. **Tomato is only for the
  amount and the primary action.** Status colours: herb green = Home, brass = Save me a plate, grey = Out.
  Every text pair is at least 4.5:1 (checked by `tools/verify_app.cjs`).
- Motion: 120–200 ms ease-out presses and a toast rise; all off under `prefers-reduced-motion`. No dark mode yet.
