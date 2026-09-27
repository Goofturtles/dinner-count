'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/portions');
const { todayInTz, minutesInTz, addDays } = require('../src/dates');

const fam = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

test('no answer counts as Home, plate is a full eater, out is not', () => {
  const c = P.countEaters(fam, { a: 'home', b: 'plate', c: 'out' });
  assert.equal(c.eaters, 3); // a, b(plate), d(unanswered)
  assert.equal(c.plate, 1); assert.equal(c.out, 1); assert.equal(c.unanswered, 1);
});

test('cook can edit the count by hand', () => {
  const c = P.countEaters(fam, {}, 6);
  assert.equal(c.eaters, 6); assert.equal(c.counted, 4); assert.ok(c.overridden);
});

test('amount = base × eaters × factor, rounded to 10, units kept', () => {
  assert.deepEqual(P.amountFor('pasta', 3, 1), { amount: 300, unit: 'g' });
  assert.deepEqual(P.amountFor('rice', 3, 1), { amount: 230, unit: 'g' }); // 225 → 230
  assert.deepEqual(P.amountFor('chili', 2, 1), { amount: 700, unit: 'ml' });
  assert.deepEqual(P.amountFor('pasta', 0, 1), { amount: 0, unit: 'g' });
  assert.deepEqual(P.amountFor('pasta', 4, 0.8), { amount: 320, unit: 'g' });
});

test('someone tapping Out drops the amount', () => {
  const before = P.amountFor('pasta', P.countEaters(fam, {}).eaters, 1).amount;
  const after = P.amountFor('pasta', P.countEaters(fam, { c: 'out' }).eaters, 1).amount;
  assert.equal(before, 400); assert.equal(after, 300);
});

test('cold start: factor 1 and the honest reason line', () => {
  assert.equal(P.freshDish().factor, 1);
  assert.equal(P.reason('pasta', P.freshDish()), 'Starting from the package amount.');
});

test('20 nights of "none left" hold the factor exactly steady', () => {
  for (const start of [1, 0.8, 1.2]) {
    let f = start;
    for (let i = 0; i < 20; i++) f = P.nextFactor(f, 'none');
    assert.equal(f, start);
  }
});

test('ranOut then lot settles, and alternating never grows or escapes the clamps', () => {
  let f = P.nextFactor(P.nextFactor(1, 'ranOut'), 'lot');
  const settled = f;
  for (let i = 0; i < 20; i++) f = P.nextFactor(f, 'none');
  assert.equal(f, settled);
  assert.ok(Math.abs(settled - 1) < 0.05);
  // Alternating: every swing is the same size or smaller, never growing.
  let g = 1, prevSwing = Infinity;
  for (let i = 0; i < 40; i++) {
    const a = P.nextFactor(g, 'ranOut'), b = P.nextFactor(a, 'lot');
    const swing = Math.abs(a - b);
    assert.ok(swing <= prevSwing + 1e-12);
    assert.ok(b >= P.MIN_FACTOR && a <= P.MAX_FACTOR);
    prevSwing = swing; g = b;
  }
});

test('clamps hold at both ends', () => {
  let f = 1; for (let i = 0; i < 200; i++) f = P.nextFactor(f, 'lot');
  assert.equal(f, P.MIN_FACTOR);
  f = 1; for (let i = 0; i < 500; i++) f = P.nextFactor(f, 'ranOut');
  assert.equal(f, P.MAX_FACTOR);
});

test('5 nights of "a lot" of rice lowers the amount and stays in the clamps', () => {
  let s = P.freshDish();
  const d0 = '2026-09-20';
  const first = P.amountFor('rice', 4, s.factor).amount;
  for (let i = 0; i < 5; i++) {
    const a = P.amountFor('rice', 4, s.factor).amount;
    s = P.recordNight(s, { date: addDays(d0, i), dish: 'rice', eaters: 4, amount: a, leftover: 'lot' });
  }
  const last = P.amountFor('rice', 4, s.factor).amount;
  assert.ok(last < first, `${last} < ${first}`);
  assert.ok(s.factor >= P.MIN_FACTOR && s.factor < 1);
  assert.equal(s.nights, 5);
  assert.match(P.reason('rice', s), /^Based on your last 5 rice nights, your family eats about \d+% less than the box says\.$/);
});

test('re-reporting the same night replaces it instead of double-counting', () => {
  let s = P.recordNight(null, { date: '2026-09-20', dish: 'pasta', eaters: 3, amount: 300, leftover: 'lot' });
  s = P.recordNight(s, { date: '2026-09-20', dish: 'pasta', eaters: 3, amount: 300, leftover: 'lot' });
  assert.equal(s.nights, 1);
});

test('a cook override counts as feedback', () => {
  // Cooked 240 g for 3 instead of 300 g, nothing left: the family eats ~80%.
  const s = P.recordNight(P.freshDish(), { date: '2026-09-20', dish: 'pasta', eaters: 3, amount: 300, override: 240, leftover: 'none' });
  assert.equal(Math.round(s.factor * 100), 80);
  assert.equal(s.history[0].amount, 240);
  // Override with no leftover report still moves 35% toward it.
  const t = P.recordNight(P.freshDish(), { date: '2026-09-20', dish: 'pasta', eaters: 3, amount: 300, override: 240 });
  assert.equal(Math.round(t.factor * 1000), Math.round((1 + 0.35 * (0.8 - 1)) * 1000));
});

test('reason line wording', () => {
  assert.equal(P.reason('pasta', { factor: 0.85, nights: 4 }), 'Based on your last 4 pasta nights, your family eats about 15% less than the box says.');
  assert.equal(P.reason('soup', { factor: 1.1, nights: 1 }), 'Based on your last soup night, your family eats about 10% more than the box says.');
  assert.equal(P.reason('rice', { factor: 1.01, nights: 3 }), 'Based on your last 3 rice nights, your family eats about what the box says.');
});

test('format keeps volumes as volumes', () => {
  assert.equal(P.format(320, 'g'), '320 g');
  assert.equal(P.format(1400, 'ml'), '1.4 L');
  assert.equal(P.format(1200, 'g'), '1.2 kg');
  assert.equal(P.format(2000, 'ml'), '2 L');
});

test('todayInTz: an 8 PM report stays on the family\'s local date', () => {
  // 8 PM in Toronto on Sep 26 = 00:00 UTC Sep 27.
  assert.equal(todayInTz('America/Toronto', new Date('2026-09-27T00:00:00Z')), '2026-09-26');
  assert.equal(todayInTz('America/Los_Angeles', new Date('2026-09-27T03:30:00Z')), '2026-09-26');
});

test('todayInTz across the DST change (Toronto falls back 2026-11-01, springs forward 2026-03-08)', () => {
  // Fall back: 8 PM EST on Nov 1 = 01:00 UTC Nov 2.
  assert.equal(todayInTz('America/Toronto', new Date('2026-11-02T01:00:00Z')), '2026-11-01');
  assert.equal(minutesInTz('America/Toronto', new Date('2026-11-02T01:00:00Z')), 20 * 60);
  // Same UTC wall time one day earlier is still EDT: 9 PM.
  assert.equal(minutesInTz('America/Toronto', new Date('2026-11-01T01:00:00Z')), 21 * 60);
  // Spring forward: 8 PM EDT Mar 8 = 00:00 UTC Mar 9.
  assert.equal(todayInTz('America/Toronto', new Date('2026-03-09T00:00:00Z')), '2026-03-08');
  assert.equal(minutesInTz('America/Toronto', new Date('2026-03-09T00:00:00Z')), 20 * 60);
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
});
