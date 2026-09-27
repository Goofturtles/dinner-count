// Dinner Count — the portion engine. Pure functions only: no I/O, no clock, no browser.
// Works in Node (require) and the browser (window.Portions).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Portions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Package-style amount per eater. Sources in README.md ("Base amounts").
  const BASE = {
    pasta:    { amount: 100, unit: 'g',  label: 'pasta',    verb: 'dry pasta' },
    rice:     { amount: 75,  unit: 'g',  label: 'rice',     verb: 'dry rice' },
    potatoes: { amount: 200, unit: 'g',  label: 'potatoes', verb: 'potatoes' },
    chili:    { amount: 350, unit: 'ml', label: 'chili',    verb: 'chili' },
    soup:     { amount: 400, unit: 'ml', label: 'soup',     verb: 'soup' },
  };
  const DISHES = Object.keys(BASE);

  // Leftover report → the factor this night suggests.
  // "none" = just right, so it holds the factor exactly where it is.
  const TARGET = { ranOut: 1.05, none: 1.0, bowl: 0.95, lot: 0.85 };
  const LEFTOVERS = Object.keys(TARGET);
  const RATE = 0.35;
  const MIN_FACTOR = 0.6;
  const MAX_FACTOR = 1.5;
  const HISTORY_MAX = 30;

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round10 = (x) => Math.round(x / 10) * 10;

  // No answer counts as Home. "Save me a plate" is a full eater.
  function countEaters(members, answers, countOverride) {
    let home = 0, plate = 0, out = 0, unanswered = 0;
    for (const m of members) {
      const a = answers && answers[m.id];
      if (a === 'out') out++;
      else if (a === 'plate') plate++;
      else { home++; if (!a) unanswered++; }
    }
    const counted = home + plate;
    const eaters = Number.isInteger(countOverride) && countOverride >= 0 ? countOverride : counted;
    return { home, plate, out, unanswered, counted, eaters, overridden: eaters !== counted };
  }

  function amountFor(dish, eaters, factor) {
    const base = BASE[dish];
    if (!base) throw new Error('unknown dish: ' + dish);
    const f = Number.isFinite(factor) ? factor : 1;
    return { amount: round10(base.amount * eaters * f), unit: base.unit };
  }

  // One leftover report nudges the factor a little toward what the night suggested.
  function nextFactor(factor, leftover) {
    if (!(leftover in TARGET)) throw new Error('unknown leftover: ' + leftover);
    return clamp(factor * (1 + RATE * (TARGET[leftover] - 1)), MIN_FACTOR, MAX_FACTOR);
  }

  // The factor implied by what the cook actually made (an override).
  function impliedFactor(dish, eaters, cookedAmount) {
    const base = BASE[dish];
    if (!base || !(eaters > 0) || !(cookedAmount > 0)) return null;
    return clamp(cookedAmount / (base.amount * eaters), MIN_FACTOR, MAX_FACTOR);
  }

  const freshDish = () => ({ factor: 1, nights: 0, history: [] });

  // Record one night. The leftover report describes what was actually cooked, so when the cook
  // overrode the amount, learning starts from the override's factor. An override with no report
  // still counts as feedback: move 35% of the way toward the cook's judgement.
  function recordNight(state, night) {
    const s = state || freshDish();
    const { date, eaters, amount, override = null, leftover = null } = night;
    let factor = s.factor;
    const implied = override != null ? impliedFactor(night.dish, eaters, override) : null;
    if (leftover) factor = nextFactor(implied != null ? implied : factor, leftover);
    else if (implied != null) factor = clamp(factor + RATE * (implied - factor), MIN_FACTOR, MAX_FACTOR);
    else return s; // nothing learned
    const entry = { date, eaters, amount: override != null ? override : amount, leftover };
    const history = s.history.filter((h) => h.date !== date).concat(entry).slice(-HISTORY_MAX);
    return { factor, nights: history.length, history };
  }

  // The line under every amount. Never claim more than the data says.
  function reason(dish, state) {
    const base = BASE[dish];
    if (!state || !state.nights) return 'Starting from the package amount.';
    const n = state.nights;
    const pct = Math.round((state.factor - 1) * 100);
    const nights = `your last ${n === 1 ? '' : n + ' '}${base.label} night${n === 1 ? '' : 's'}`;
    if (Math.abs(pct) < 3) return `Based on ${nights}, your family eats about what the box says.`;
    return `Based on ${nights}, your family eats about ${Math.abs(pct)}% ${pct < 0 ? 'less' : 'more'} than the box says.`;
  }

  function format(amount, unit) {
    if (amount >= 1000 && (unit === 'ml' || unit === 'g')) {
      const big = String(Math.round(amount / 10) / 100); // 1200 → "1.2", 10000 → "10"
      return `${big} ${unit === 'ml' ? 'L' : 'kg'}`;
    }
    return `${amount} ${unit}`;
  }

  return { BASE, DISHES, TARGET, LEFTOVERS, RATE, MIN_FACTOR, MAX_FACTOR,
    countEaters, amountFor, nextFactor, impliedFactor, recordNight, reason, format, freshDish };
});
