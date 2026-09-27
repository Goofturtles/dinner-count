'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStore } = require('../src/store');
const { createApi } = require('../src/api');
const { todayInTz, addDays, minutesInTz } = require('../src/dates');

const quiet = { log() {}, warn() {}, error() {} };

async function boot() {
  const store = createStore('');
  await store.init();
  const { router, runTick } = createApi({ store, log: quiet });
  const app = express();
  app.use('/api', express.json(), router);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, auth) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { store, runTick, call, close: () => server.close() };
}

test('family flow: create, request to join, approve, answer, cook, learn, claim, leave', async (t) => {
  const { store, runTick, call, close } = await boot();
  t.after(close);
  const tz = 'America/Toronto';

  const mom = await call('POST', '/families', { familyName: 'Sharmas', name: 'Mom', isCook: true, tz });
  assert.equal(mom.status, 201);
  const code = mom.body.state.family.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);

  // The code alone gets you nothing: no token, no data.
  for (const [m, p] of [['GET', '/state'], ['POST', '/answer'], ['POST', '/cook'], ['POST', '/leftover'], ['POST', '/claim'], ['POST', '/settings'], ['POST', '/subscribe']]) {
    assert.equal((await call(m, p, { answer: 'out' }, `${code}.x.y`)).status, 401, `${m} ${p} with code only`);
    assert.equal((await call(m, p, { answer: 'out' })).status, 401, `${m} ${p} with nothing`);
  }

  // Joining asks; it doesn't grant.
  const kid = await call('POST', '/join', { code: code.slice(0, 4).toLowerCase() + '-' + code.slice(4), name: 'Leo' });
  assert.equal(kid.status, 201);
  assert.equal(kid.body.state.status, 'pending');
  assert.equal((await call('GET', '/state', null, kid.body.auth)).body.status, 'pending');
  assert.equal((await call('POST', '/answer', { answer: 'out' }, kid.body.auth)).status, 403);
  // Same name is blocked.
  assert.equal((await call('POST', '/join', { code, name: 'mom' })).status, 409);

  const st = (await call('GET', '/state', null, mom.body.auth)).body;
  assert.equal(st.family.pending.length, 1);
  await call('POST', `/members/${st.family.pending[0].id}/approve`, { allow: true }, mom.body.auth);
  const sis = await call('POST', '/join', { code, name: 'Maya' });
  await call('POST', `/members/${sis.body.state.me.id}/approve`, { allow: true }, mom.body.auth);

  // 3 people, nobody answered → all count as Home.
  let s = (await call('POST', '/cook', { dish: 'pasta' }, mom.body.auth)).body;
  assert.equal(s.today.count.eaters, 3);
  assert.equal(s.today.amount.amount, 300);
  assert.equal(s.today.amount.reason, 'Starting from the package amount.');

  // Leo taps Out → the cook's amount drops.
  await call('POST', '/answer', { answer: 'out' }, kid.body.auth);
  s = (await call('GET', '/state', null, mom.body.auth)).body;
  assert.equal(s.today.amount.amount, 200);
  // Kids can't cook.
  assert.equal((await call('POST', '/cook', { dish: 'rice' }, kid.body.auth)).status, 403);

  // "A lot" left → pasta factor drops; reporting twice doesn't learn twice.
  s = (await call('POST', '/leftover', { leftover: 'lot' }, mom.body.auth)).body;
  const f1 = s.amounts.pasta.factor;
  assert.ok(f1 < 1);
  s = (await call('POST', '/leftover', { leftover: 'lot' }, mom.body.auth)).body;
  assert.equal(s.amounts.pasta.factor, f1);
  assert.equal(s.amounts.pasta.nights, 1);

  // Move the report to "yesterday" so tomorrow's question offers the claim.
  const today = todayInTz(tz), yday = addDays(today, -1);
  await store.set(`day:${code}:${yday}`, await store.get(`day:${code}:${today}`));
  await store.del(`day:${code}:${today}`);
  s = (await call('GET', '/state', null, kid.body.auth)).body;
  assert.equal(s.claim.dish, 'pasta');
  assert.equal(s.claim.claimedBy, null);
  s = (await call('POST', '/claim', {}, kid.body.auth)).body;
  assert.equal(s.claim.claimedByName, 'Leo');
  assert.equal((await call('POST', '/claim', {}, sis.body.auth)).status, 409);

  // Tick is idempotent: day.sent flips once, repeat calls do nothing.
  // One clock for the whole check, so a midnight rollover can't split it across two days.
  const now = new Date(), tickDay = todayInTz(tz, now);
  const m = Math.max(0, minutesInTz(tz, now) - 1);
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  await store.update(`fam:${code}`, (f) => { f.reminderTime = hhmm; return f; });
  let claims = 0;
  const realUpdate = store.update;
  store.update = (k, fn, ttl) => realUpdate(k, (cur) => { const next = fn(cur); if (k.startsWith('day:') && next !== undefined && next.sent && !(cur && cur.sent)) claims++; return next; }, ttl);
  await runTick(now); await runTick(now);
  store.update = realUpdate;
  assert.equal(claims, 1, 'second tick must not claim the day again');
  assert.equal((await store.get(`day:${code}:${tickDay}`)).sent, true);

  // Leave really deletes; last one out deletes the family.
  await call('POST', '/leave', {}, kid.body.auth);
  assert.equal((await call('GET', '/state', null, kid.body.auth)).status, 401);
  await call('POST', '/leave', {}, sis.body.auth);
  await call('POST', '/leave', {}, mom.body.auth);
  assert.equal(await store.get(`fam:${code}`), null);
  assert.equal((await store.list(`day:${code}:`)).length, 0);
  assert.equal((await store.list(`dish:${code}:`)).length, 0);
});

test('review fixes: cooking never grants admin, dish locked after learning, overrides learn once', async (t) => {
  const { call, store, close } = await boot();
  t.after(close);
  const mom = await call('POST', '/families', { name: 'Mom', isCook: true, tz: 'America/Toronto' });
  const code = mom.body.state.family.code;
  const kid = await call('POST', '/join', { code, name: 'Leo', isCook: true });
  await call('POST', `/members/${kid.body.state.me.id}/approve`, { allow: true }, mom.body.auth);
  // A cook who isn't the creator can't let people in or change settings.
  const stranger = await call('POST', '/join', { code, name: 'Eve' });
  assert.equal((await call('POST', `/members/${stranger.body.state.me.id}/approve`, { allow: true }, kid.body.auth)).status, 403);
  assert.equal((await call('POST', '/settings', { reminderTime: '17:00' }, kid.body.auth)).status, 403);
  assert.equal((await call('POST', '/me', { isCook: true }, kid.body.auth)).status, 200);
  assert.equal((await call('POST', '/settings', { reminderTime: '17:00' }, kid.body.auth)).status, 403);

  // Override alone counts as feedback: 2 eaters, cooked 160 g instead of 200 g → factor 1 + .35(.8-1) = .93
  await call('POST', '/cook', { dish: 'pasta' }, mom.body.auth);
  let s = (await call('POST', '/cook', { override: 160 }, mom.body.auth)).body;
  assert.equal(s.amounts.pasta.factor, 0.93);
  // Saving the same override again doesn't learn twice; a leftover report then replaces it, not stacks.
  s = (await call('POST', '/cook', { override: 160 }, mom.body.auth)).body;
  assert.equal(s.amounts.pasta.factor, 0.93);
  s = (await call('POST', '/leftover', { leftover: 'none' }, mom.body.auth)).body;
  assert.equal(s.amounts.pasta.factor, 0.8);   // cooked 160 for 2 and nothing left → 0.8 exactly
  assert.equal(s.amounts.pasta.nights, 1);
  // Can't switch dish once tonight is learned (would double-learn).
  assert.equal((await call('POST', '/cook', { dish: 'rice' }, mom.body.auth)).status, 400);

  // Re-reporting last night after tonight was learned keeps tonight's learning.
  const today = todayInTz('America/Toronto');
  const night1 = await store.get(`day:${code}:${today}`);
  await store.set(`day:${code}:${addDays(today, -1)}`, night1);
  await store.set(`day:${code}:${today}`, { ...night1, override: null, leftover: null, factorBefore: null, factorAfter: null });
  await call('POST', '/leftover', { leftover: 'lot' }, mom.body.auth);                     // tonight: 0.8 × 0.9475 = 0.758
  s = (await call('POST', '/leftover', { leftover: 'bowl', date: addDays(today, -1) }, mom.body.auth)).body; // last night none → bowl
  const expected = 0.8 * 0.9475 + (0.8 * (1 + 0.35 * (0.95 - 1)) - 0.8); // last night's change applied on top of tonight's
  assert.ok(Math.abs(s.amounts.pasta.factor - Math.round(expected * 1000) / 1000) < 0.002, `${s.amounts.pasta.factor} ≈ ${expected}`);
});

test('bad codes and rate limits', async (t) => {
  const { call, close } = await boot();
  t.after(close);
  assert.equal((await call('POST', '/join', { code: 'O0I1O0I1', name: 'Ann' })).status, 400);
  assert.equal((await call('POST', '/join', { code: 'ABCDEFGH', name: 'Ann' })).status, 404);
  assert.equal((await call('POST', '/join', { code: 'ABCDEFGH', name: 'x1@' })).status, 400);
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/join', { code: 'ABCDEFGH', name: 'Ann' });
  assert.equal(last.status, 429);
});

test('sandbox: a week of history, and you can answer for the pretend family', async (t) => {
  const { call, close } = await boot();
  t.after(close);
  const d = await call('POST', '/demo', { tz: 'America/Los_Angeles' });
  assert.equal(d.status, 201);
  const s = d.body.state;
  assert.equal(s.family.demo, true);
  assert.equal(s.family.code, null); // never shown
  assert.ok(s.amounts.rice.factor < 1 && s.amounts.rice.nights === 2);
  assert.ok(s.amounts.soup.factor > 1);
  assert.equal(s.claim.dish, 'chili');
  await call('POST', '/cook', { dish: 'rice' }, d.body.auth);
  const leo = s.family.members.find((m) => m.name === 'Leo');
  const before = (await call('GET', '/state', null, d.body.auth)).body.today.amount.amount;
  const after = (await call('POST', '/answer', { answer: 'out', memberId: leo.id }, d.body.auth)).body.today.amount.amount;
  assert.ok(after < before, `${after} < ${before}`);
});
