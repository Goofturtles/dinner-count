'use strict';
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const P = require('./portions');
const { todayInTz, minutesInTz, addDays, validTz, hhmmToMinutes } = require('./dates');

const DAY_TTL = 30 * 86400;     // day: keys expire after 30 days
const DEMO_TTL = 2 * 86400;     // sandbox families vanish after 2 days
const SEND_WINDOW_MIN = 180;    // a missed 4 PM push is still sent up to 3 h late, never at midnight
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LEN = 8;
const NAME_RE = /^[\p{L}][\p{L}' .-]{0,19}$/u;
const ANSWERS = ['home', 'plate', 'out'];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const newId = () => crypto.randomBytes(6).toString('base64url');
const newCode = () => Array.from({ length: CODE_LEN }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const validCode = (c) => c.length === CODE_LEN && [...c].every((ch) => CODE_ALPHABET.includes(ch));
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const emptyDay = () => ({ answers: {}, dish: null, amount: null, unit: null, override: null, leftover: null,
  claimedBy: null, sent: false, countOverride: null, factorBefore: null, factorAfter: null });

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// Fixed-window rate limiter, per IP and bucket.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return true; }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    return h.n <= max;
  };
}

function createApi({ store, log = console }) {
  const router = express.Router();
  const joinLimit = limiter(10, 10 * 60 * 1000);
  const createLimit = limiter(10, 60 * 60 * 1000);
  const demoLimit = limiter(30, 60 * 60 * 1000);

  // ---- push setup: keys must come from env in production (regenerating breaks every subscription)
  let vapidPublic = process.env.VAPID_PUBLIC_KEY, vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) log.error('VAPID keys missing: push is disabled');
    else { const k = webpush.generateVAPIDKeys(); vapidPublic = k.publicKey; vapidPrivate = k.privateKey; log.warn('Using throwaway local VAPID keys'); }
  }
  const pushReady = !!(vapidPublic && vapidPrivate);
  if (pushReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://dinner-count.onrender.com', vapidPublic, vapidPrivate);

  const famKey = (c) => `fam:${c}`, dayKey = (c, d) => `day:${c}:${d}`, dishKey = (c, d) => `dish:${c}:${d}`, subKey = (c, m) => `sub:${c}:${m}`;
  const ttlFor = (fam, base) => (fam && fam.demo ? DEMO_TTL : base);
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
    if (!(e instanceof HttpError)) log.error(e);
    res.status(e.status || 500).json({ error: e instanceof HttpError ? e.message : 'Something went wrong. Try again.' });
  });

  // ---- auth: Authorization: Bearer <code>.<memberId>.<token>. The family code alone is never enough.
  async function authed(req, { allowPending = false } = {}) {
    const m = /^Bearer ([A-Z0-9]+)\.([\w-]+)\.([\w-]+)$/.exec(req.get('authorization') || '');
    if (!m) fail(401, 'Not signed in to a family on this device.');
    const [, code, mid, token] = m;
    const fam = await store.get(famKey(code));
    if (!fam) fail(401, 'That family no longer exists.');
    const me = fam.members.find((x) => x.id === mid) || (fam.pending || []).find((x) => x.id === mid);
    const a = Buffer.from(sha(token)), b = Buffer.from(me ? me.token : sha('x'));
    if (!me || !crypto.timingSafeEqual(a, b)) fail(401, 'This device is not part of that family.');
    const pending = !fam.members.includes(me);
    if (pending && !allowPending) fail(403, 'Waiting for someone in the family to let you in.');
    return { fam, me, pending, code };
  }
  // Admin (let people in, settings) is the family's creator or someone they made admin. Cooking never grants it.
  const isAdmin = (fam, me) => fam.createdBy === me.id || me.admin === true;
  const pubMember = (x) => ({ id: x.id, name: x.name, isCook: !!x.isCook });

  function newMember(body, token) {
    const name = cleanName(body.name);
    if (!NAME_RE.test(name)) fail(400, 'Use a first name only: letters, up to 20 characters.');
    return { id: newId(), name, isCook: !!body.isCook, token: sha(token) };
  }
  const sameName = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

  // ---- the state a signed-in device needs, computed server-side
  async function buildState(fam, me) {
    const code = fam.code, tz = fam.tz, date = todayInTz(tz), yday = addDays(date, -1);
    const [day0, yd, ...dishStates] = await Promise.all([
      store.get(dayKey(code, date)), store.get(dayKey(code, yday)),
      ...P.DISHES.map((d) => store.get(dishKey(code, d))),
    ]);
    const day = day0 || emptyDay();
    const dishes = {};
    P.DISHES.forEach((d, i) => { dishes[d] = dishStates[i] || P.freshDish(); });
    const count = P.countEaters(fam.members, day.answers, day.countOverride);
    const amounts = {};
    for (const d of P.DISHES) {
      const a = P.amountFor(d, count.eaters, dishes[d].factor);
      const box = P.amountFor(d, count.eaters, 1);
      amounts[d] = { ...a, text: P.format(a.amount, a.unit), box: box.amount, reason: P.reason(d, dishes[d]),
        factor: Math.round(dishes[d].factor * 1000) / 1000, nights: dishes[d].nights };
    }
    const nameOf = (id) => (fam.members.find((x) => x.id === id) || {}).name || null;
    const pendingReport = yd && yd.dish && !yd.leftover
      ? { date: yday, dish: yd.dish, amount: P.format(yd.override ?? yd.amount, yd.unit) } : null;
    const claim = yd && yd.dish && (yd.leftover === 'bowl' || yd.leftover === 'lot')
      ? { date: yday, dish: yd.dish, leftover: yd.leftover, claimedBy: yd.claimedBy, claimedByName: nameOf(yd.claimedBy) } : null;
    return {
      status: 'member',
      me: { ...pubMember(me), admin: isAdmin(fam, me) },
      family: {
        code: fam.demo ? null : fam.code, name: fam.name, tz, reminderTime: fam.reminderTime, demo: !!fam.demo,
        members: fam.members.map(pubMember),
        pending: isAdmin(fam, me) ? (fam.pending || []).map(pubMember) : [],
      },
      date,
      localMinutes: minutesInTz(tz),
      today: {
        answers: day.answers, count, dish: day.dish, override: day.override, leftover: day.leftover,
        // Once tonight is reported, "tonight" stays what was cooked and "next" shows what it learned.
        amount: day.dish ? (day.factorBefore != null
          ? (() => { const a = P.amountFor(day.dish, count.eaters, day.factorBefore); return { ...amounts[day.dish], ...a, text: P.format(a.amount, a.unit) }; })()
          : amounts[day.dish]) : null,
        next: day.dish && day.leftover ? amounts[day.dish] : null,
      },
      amounts,
      pendingReport,
      claim,
      push: { ready: pushReady, publicKey: vapidPublic || null, subscribed: !!(await store.get(subKey(code, me.id))) },
    };
  }

  // ---- create a family (creator becomes its first member)
  router.post('/families', wrap(async (req, res) => {
    if (!createLimit('create:' + req.ip)) fail(429, 'Too many new families from here. Try again later.');
    const b = req.body || {};
    const tz = validTz(b.tz) ? b.tz : 'America/Toronto';
    const famName = cleanName(b.familyName).slice(0, 30) || 'Our family';
    const token = newToken();
    const me = newMember(b, token);
    let code;
    for (let i = 0; i < 5 && !code; i++) { const c = newCode(); if (!(await store.get(famKey(c)))) code = c; }
    if (!code) fail(500, 'Could not make a family code. Try again.');
    const fam = { code, name: famName, tz, reminderTime: '16:00', members: [me], pending: [], createdBy: me.id, createdAt: new Date().toISOString() };
    await store.set(famKey(code), fam);
    res.status(201).json({ auth: `${code}.${me.id}.${token}`, state: await buildState(fam, me) });
  }));

  // ---- ask to join with a code. Creates a PENDING member; someone in the family lets them in.
  router.post('/join', wrap(async (req, res) => {
    if (!joinLimit('join:' + req.ip)) fail(429, 'Too many tries. Wait 10 minutes and try again.');
    const code = normCode(req.body && req.body.code);
    if (!validCode(code)) fail(400, 'Family codes are 8 letters and numbers, like KTRW-8H4P.');
    const token = newToken();
    const me = newMember(req.body || {}, token);
    const fam = await store.update(famKey(code), (f) => {
      if (!f || f.demo) fail(404, 'No family with that code. Check it with whoever sent it.');
      const all = f.members.concat(f.pending || []);
      if (all.some((x) => sameName(x.name, me.name))) fail(409, `That name can't be used in this family. Try adding an initial, like "${me.name} B".`);
      if ((f.pending || []).length >= 5 || f.members.length >= 12) fail(409, "This family can't take more requests right now.");
      f.pending = (f.pending || []).concat(me);
      return f;
    });
    res.status(201).json({ auth: `${code}.${me.id}.${token}`, state: { status: 'pending', familyName: fam.name, me: pubMember(me) } });
  }));

  router.get('/state', wrap(async (req, res) => {
    const { fam, me, pending } = await authed(req, { allowPending: true });
    kickTick();
    res.set('Cache-Control', 'no-store');
    if (pending) return res.json({ status: 'pending', familyName: fam.name, me: pubMember(me) });
    res.json(await buildState(fam, me));
  }));

  router.post('/members/:id/approve', wrap(async (req, res) => {
    const { fam: f0, me } = await authed(req);
    if (!isAdmin(f0, me)) fail(403, 'Only the cook can let people in.');
    const allow = !!(req.body && req.body.allow);
    const fam = await store.update(famKey(f0.code), (f) => {
      const p = (f.pending || []).find((x) => x.id === req.params.id);
      if (!p) fail(404, 'That request is gone.');
      f.pending = f.pending.filter((x) => x !== p);
      if (allow) { if (f.members.length >= 12) fail(409, 'This family is full (12 people).'); f.members.push(p); }
      return f;
    });
    res.json(await buildState(fam, fam.members.find((x) => x.id === me.id)));
  }));

  // ---- today's answer. In the sandbox you can also answer for the pretend family.
  router.post('/answer', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    const answer = req.body && req.body.answer;
    if (!ANSWERS.includes(answer)) fail(400, 'Answer Home, Save me a plate, or Out.');
    const who = req.body.memberId && fam.demo ? req.body.memberId : me.id;
    if (!fam.members.some((x) => x.id === who)) fail(404, 'No one by that name here.');
    const date = todayInTz(fam.tz);
    await store.update(dayKey(code, date), (d) => { d = d || emptyDay(); d.answers[who] = answer; return d; }, ttlFor(fam, DAY_TTL));
    res.json(await buildState(fam, me));
  }));

  // Learn from one night (leftover report and/or override). Safe to repeat for the same night: it recomputes
  // from the factor before that night and applies only the change, so nights learned since then survive.
  async function learnNight(fam, code, date, d) {
    await store.update(dishKey(code, d.dish), (ds) => {
      ds = ds || P.freshDish();
      const before = d.factorBefore ?? ds.factor;
      const eaters = P.countEaters(fam.members, d.answers, d.countOverride).eaters;
      const amount = P.amountFor(d.dish, eaters, before).amount;
      const rec = P.recordNight({ ...ds, factor: before }, { date, dish: d.dish, eaters, amount, override: d.override, leftover: d.leftover });
      const factor = d.factorAfter == null ? rec.factor
        : Math.min(P.MAX_FACTOR, Math.max(P.MIN_FACTOR, ds.factor + rec.factor - d.factorAfter));
      d.factorBefore = before; d.factorAfter = rec.factor; d.amount = amount;
      return { ...rec, factor };
    }, ttlFor(fam, 0) || undefined);
  }

  // ---- the cook: pick the dish, fix the count by hand, or say what was actually cooked
  router.post('/cook', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    if (!me.isCook) fail(403, 'Only the cook can do that.');
    const b = req.body || {};
    const date = todayInTz(fam.tz);
    await store.update(dayKey(code, date), async (d) => {
      d = d || emptyDay();
      if ('dish' in b) {
        if (!P.BASE[b.dish]) fail(400, 'Pick one of the dishes.');
        if (b.dish !== d.dish && d.factorAfter != null) fail(400, `Tonight's ${P.BASE[d.dish].label} is already counted. Change it tomorrow.`);
        if (b.dish !== d.dish) { d.override = null; d.factorBefore = null; }
        d.dish = b.dish;
      }
      if ('countOverride' in b) {
        const n = b.countOverride;
        if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 30)) fail(400, 'Count must be 0–30.');
        d.countOverride = n;
      }
      if ('override' in b) {
        const n = b.override;
        if (n !== null && !(Number.isFinite(n) && n > 0 && n <= 20000)) fail(400, 'Enter the amount you cooked.');
        if (n !== null && !d.dish) fail(400, 'Pick the dish first.');
        d.override = n === null ? null : Math.round(n);
      }
      if (d.dish) {
        const ds = (await store.get(dishKey(code, d.dish))) || P.freshDish();
        const eaters = P.countEaters(fam.members, d.answers, d.countOverride).eaters;
        const a = P.amountFor(d.dish, eaters, d.factorBefore ?? ds.factor);
        d.amount = a.amount; d.unit = a.unit;
        // An override is feedback on its own; a count change after reporting re-learns the night.
        if (d.leftover || d.override != null || d.factorAfter != null) await learnNight(fam, code, date, d);
      }
      return d;
    }, ttlFor(fam, DAY_TTL));
    res.json(await buildState(fam, me));
  }));

  // ---- after dinner: how much was left. This is the learning step.
  router.post('/leftover', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    if (!me.isCook) fail(403, 'Only the cook can report leftovers.');
    const { leftover } = req.body || {};
    if (!P.LEFTOVERS.includes(leftover)) fail(400, 'Pick ran out, none left, a bowl, or a lot.');
    const today = todayInTz(fam.tz);
    const date = req.body.date || today;
    if (date !== today && date !== addDays(today, -1)) fail(400, 'You can only report tonight or last night.');
    await store.update(dayKey(code, date), async (d) => {
      if (!d || !d.dish) fail(400, 'Pick what you cooked first.');
      d.leftover = leftover;
      await learnNight(fam, code, date, d);
      if (leftover !== 'bowl' && leftover !== 'lot') d.claimedBy = null;
      return d;
    }, ttlFor(fam, DAY_TTL));
    res.json(await buildState(fam, me));
  }));

  // ---- one tap claims last night's leftovers for lunch (tap again to give them back)
  router.post('/claim', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    const date = addDays(todayInTz(fam.tz), -1);
    await store.update(dayKey(code, date), (d) => {
      if (!d || !(d.leftover === 'bowl' || d.leftover === 'lot')) fail(400, 'No leftovers from last night.');
      if (d.claimedBy && d.claimedBy !== me.id && fam.members.some((x) => x.id === d.claimedBy)) fail(409, 'Someone already took them.');
      d.claimedBy = d.claimedBy === me.id ? null : me.id;
      return d;
    }, ttlFor(fam, DAY_TTL));
    res.json(await buildState(fam, me));
  }));

  router.post('/settings', wrap(async (req, res) => {
    const { fam: f0, me } = await authed(req);
    if (!isAdmin(f0, me)) fail(403, 'Only the cook can change family settings.');
    const b = req.body || {};
    const fam = await store.update(famKey(f0.code), (f) => {
      if ('reminderTime' in b) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.reminderTime)) fail(400, 'Pick a time.'); f.reminderTime = b.reminderTime; }
      if ('familyName' in b) f.name = cleanName(b.familyName).slice(0, 30) || f.name;
      if ('tz' in b && validTz(b.tz)) f.tz = b.tz;
      return f;
    }, ttlFor(f0, 0) || undefined);
    res.json(await buildState(fam, fam.members.find((x) => x.id === me.id)));
  }));

  // Anyone can say whether they cook some nights (it only unlocks the cook screen for them).
  router.post('/me', wrap(async (req, res) => {
    const { fam: f0, me } = await authed(req);
    const fam = await store.update(famKey(f0.code), (f) => {
      const m = f.members.find((x) => x.id === me.id);
      if ('isCook' in (req.body || {})) m.isCook = !!req.body.isCook;
      return f;
    }, ttlFor(f0, 0) || undefined);
    res.json(await buildState(fam, fam.members.find((x) => x.id === me.id)));
  }));

  // "Leave family" really deletes: the member, their push subscription, and (if last out) everything.
  router.post('/leave', wrap(async (req, res) => {
    const { fam: f0, me, code } = await authed(req, { allowPending: true });
    await store.del(subKey(code, me.id));
    const fam = await store.update(famKey(code), (f) => {
      if (!f) return undefined;
      f.members = f.members.filter((x) => x.id !== me.id);
      f.pending = (f.pending || []).filter((x) => x.id !== me.id);
      if (f.createdBy === me.id && f.members[0]) f.createdBy = f.members[0].id;
      return f;
    }, ttlFor(f0, 0) || undefined);
    if (fam && fam.members.length === 0) {
      for (const p of ['sub:', 'day:', 'dish:']) await store.delPrefix(`${p}${code}:`);
      await store.del(famKey(code));
    }
    res.json({ ok: true });
  }));

  router.post('/subscribe', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    const s = req.body && req.body.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) fail(400, 'That subscription looks broken.');
    await store.set(subKey(code, me.id), { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, fam.demo ? DEMO_TTL : undefined);
    res.json(await buildState(fam, me));
  }));

  router.delete('/subscribe', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    await store.del(subKey(code, me.id));
    res.json(await buildState(fam, me));
  }));

  // ---- push: the 4 PM question
  async function sendQuestion(fam, date) {
    if (!pushReady) return { sent: 0, failed: 0 };
    const yd = await store.get(dayKey(fam.code, addDays(date, -1)));
    const body = yd && yd.dish && (yd.leftover === 'bowl' || yd.leftover === 'lot') && !yd.claimedBy
      ? `${cap(P.BASE[yd.dish].label)} from last night is in the fridge. Who's taking it for lunch?`
      : 'Home, Save me a plate, or Out. One tap.';
    const payload = JSON.stringify({ title: 'Home for dinner?', body, url: '/app/#today', tag: `q-${date}` });
    let sent = 0, failed = 0;
    for (const m of fam.members) {
      const sub = await store.get(subKey(fam.code, m.id));
      if (!sub) continue;
      try { await webpush.sendNotification(sub, payload, { TTL: 3 * 3600, urgency: 'high' }); sent++; }
      catch (e) {
        failed++;
        if (e.statusCode === 404 || e.statusCode === 410) await store.del(subKey(fam.code, m.id));
        else log.warn('push failed', e.statusCode || e.message);
      }
    }
    return { sent, failed };
  }
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  // Idempotent per family per day: safe to call every minute, from any number of triggers.
  let ticking = null;
  async function runTick(now = new Date()) {
    if (ticking) return ticking;
    ticking = (async () => {
      const out = { families: 0, sent: 0 };
      for (const { v: fam } of await store.list('fam:')) {
        if (!fam || fam.demo) continue;
        out.families++;
        const date = todayInTz(fam.tz, now), mins = minutesInTz(fam.tz, now), at = hhmmToMinutes(fam.reminderTime);
        if (mins < at || mins >= at + SEND_WINDOW_MIN) continue;
        let claimed = false;
        await store.update(dayKey(fam.code, date), (d) => { d = d || emptyDay(); if (d.sent) return undefined; d.sent = true; claimed = true; return d; }, DAY_TTL);
        if (!claimed) continue;
        try { out.sent += (await sendQuestion(fam, date)).sent; }
        catch (e) {
          log.error('tick send', fam.code.slice(0, 2), e.message);
          await store.update(dayKey(fam.code, date), (d) => { if (d) d.sent = false; return d || undefined; }, DAY_TTL).catch(() => {});
        }
      }
      await store.sweep();
      return out;
    })().finally(() => { ticking = null; });
    return ticking;
  }
  let lastKick = 0;
  function kickTick() { if (Date.now() - lastKick > 60000) { lastKick = Date.now(); runTick().catch((e) => log.error('tick', e)); } }

  router.post('/tick', wrap(async (req, res) => {
    const secret = process.env.TICK_SECRET;
    if (!secret) fail(503, 'Tick is not configured.');
    const got = Buffer.from(sha(req.get('x-tick-secret') || '')), want = Buffer.from(sha(secret));
    if (!crypto.timingSafeEqual(got, want)) fail(401, 'Bad secret.');
    res.json(await runTick());
  }));

  // The cook can send today's question right now (for testing push, or filming).
  router.post('/notify-now', wrap(async (req, res) => {
    const { fam, me, code } = await authed(req);
    if (!isAdmin(fam, me)) fail(403, 'Only the cook can send the question.');
    const date = todayInTz(fam.tz);
    await store.update(dayKey(code, date), (d) => { d = d || emptyDay(); d.sent = true; return d; }, ttlFor(fam, DAY_TTL));
    res.json(await sendQuestion(fam, date));
  }));

  // ---- the judges' sandbox: a fresh pretend family with a week of history, never a real one
  router.post('/demo', wrap(async (req, res) => {
    if (!demoLimit('demo:' + req.ip)) fail(429, 'Too many sandboxes from here. Try again later.');
    const tz = validTz(req.body && req.body.tz) ? req.body.tz : 'America/Los_Angeles';
    const token = newToken();
    const me = { id: newId(), name: 'You', isCook: true, token: sha(token) };
    const others = ['Maya', 'Leo', 'Sam'].map((name) => ({ id: newId(), name, isCook: false, token: sha(newToken()) }));
    let code; do { code = newCode(); } while (await store.get(famKey(code)));
    const fam = { code, name: 'The sandbox family', tz, reminderTime: '16:00', demo: true, members: [me, ...others], pending: [], createdBy: me.id, createdAt: new Date().toISOString() };
    const today = todayInTz(tz);
    // A believable week: this family leaves pasta and rice behind, and runs out of soup.
    const week = [['pasta', 'lot', 4], ['rice', 'lot', 4], ['chili', 'none', 3], ['pasta', 'bowl', 4], ['rice', 'lot', 3], ['soup', 'ranOut', 4], ['chili', 'bowl', 4]];
    const states = {};
    for (let i = 0; i < week.length; i++) {
      const [dish, leftover, eaters] = week[i];
      const date = addDays(today, i - week.length);
      const s = states[dish] || P.freshDish();
      const amount = P.amountFor(dish, eaters, s.factor).amount;
      states[dish] = P.recordNight(s, { date, dish, eaters, amount, leftover });
      const answers = {}; [me, ...others].forEach((m, j) => { answers[m.id] = j < eaters ? 'home' : 'out'; });
      await store.set(dayKey(code, date), { ...emptyDay(), answers, dish, amount, unit: P.BASE[dish].unit, leftover, sent: true, factorBefore: s.factor }, DEMO_TTL);
    }
    for (const [dish, s] of Object.entries(states)) await store.set(dishKey(code, dish), s, DEMO_TTL);
    await store.set(dayKey(code, today), { ...emptyDay(), answers: { [others[0].id]: 'home' }, sent: true }, DEMO_TTL);
    await store.set(famKey(code), fam, DEMO_TTL);
    res.status(201).json({ auth: `${code}.${me.id}.${token}`, state: await buildState(fam, me) });
  }));

  router.get('/health', wrap(async (req, res) => { res.json({ ok: true, store: store.kind, push: pushReady }); }));

  return { router, runTick };
}

module.exports = { createApi, normCode, validCode, CODE_ALPHABET };
