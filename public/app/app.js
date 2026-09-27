'use strict';
// Dinner Count PWA. Vanilla, no build. The server computes every amount; this file renders it.

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
  set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, JSON.stringify(v)); } catch {} },
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushCapable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';

const DISH = {
  pasta: { label: 'Pasta', what: 'dry pasta' }, rice: { label: 'Rice', what: 'dry rice' },
  potatoes: { label: 'Potatoes', what: 'potatoes' }, chili: { label: 'Chili', what: 'chili' }, soup: { label: 'Soup', what: 'soup' },
};
const LEFT = [['ranOut', 'Ran out'], ['none', 'None left'], ['bowl', 'A bowl'], ['lot', 'A lot']];

// Sandbox auth lives in this tab only, so trying the demo never signs a real family out.
let demoAuth = store.get('dc:demo', sessionStorage);
let auth = demoAuth || store.get('dc:auth');
let state = auth ? store.get('dc:state:' + auth.split('.')[0], demoAuth ? sessionStorage : localStorage) : null;
let offline = false, loading = false, lastAmount = null;

function setAuth(a, { demo = false } = {}) {
  if (demo) { demoAuth = a; store.set('dc:demo', a, sessionStorage); }
  else { demoAuth = null; store.set('dc:demo', null, sessionStorage); store.set('dc:auth', a); }
  auth = demoAuth || store.get('dc:auth');
}
function setState(s) {
  state = s;
  if (auth && s) store.set('dc:state:' + auth.split('.')[0], s, demoAuth ? sessionStorage : localStorage);
}
function signOut() {
  if (demoAuth) setAuth(null, { demo: true }); else { store.set('dc:auth', null); }
  auth = demoAuth || store.get('dc:auth'); state = null;
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    setOffline(true);
    throw new Error("You're offline. Try again when you're back online.");
  }
  setOffline(false);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) { signOut(); go('#/start'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function setOffline(v) { offline = v; $('#offline').classList.toggle('hidden', !v); }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = ''; clearTimeout(toastTimer);
  setTimeout(() => { t.textContent = msg; }, 50);
  toastTimer = setTimeout(() => { t.textContent = ''; }, 4500);
}
const go = (h) => { if (location.hash !== h) location.hash = h; else render(); };

// ---------- shared bits (markup only; design notes and Mobbin references in docs/APP-DESIGN.md)
const I = {
  home: '<path d="M3.5 10.4 12 3.8l8.5 6.6V19a1.2 1.2 0 0 1-1.2 1.2H15v-5.6H9v5.6H4.7A1.2 1.2 0 0 1 3.5 19Z"/>',
  plate: '<path d="M3 17.5h18M5 17.5a7 7 0 0 1 14 0M12 10.5V8.8M10.2 8.8h3.6"/>',
  out: '<path d="M13.5 4H6.8A1.8 1.8 0 0 0 5 5.8v12.4A1.8 1.8 0 0 0 6.8 20h6.7M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  arrow: '<path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5"/>',
  down: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  share: '<path d="M12 3.5v11M7.8 7.7 12 3.5l4.2 4.2M6 11H5v9h14v-9h-1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  shield: '<path d="M12 3.5 5.5 6v5.3c0 4.2 2.8 7.4 6.5 8.9 3.7-1.5 6.5-4.7 6.5-8.9V6Z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  phone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6"/><path d="M10.5 18h3"/>',
  spark: '<path d="M12 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9Z"/><path d="M18.5 16.5v3M17 18h3"/>',
  pot: '<path d="M4 10.5h16v3.5a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6Z"/><path d="M2 10.5h20M9.5 6.8c0-1.4.9-1.9.9-3.3M14 6.8c0-1.4.9-1.9.9-3.3"/>',
  minus: '<path d="M5.5 12h13"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
};
const BOWL = '<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z"/>';
const LEFT_ICON = {
  ranOut: BOWL + '<path d="M12 2.8v4.4M12 9.3v.01"/>',
  none: BOWL + '<path d="M8.8 6.4l2.2 2.2 4.2-4.3"/>',
  bowl: BOWL + '<path d="M5.94 15h12.12A7 7 0 0 1 5.94 15Z" fill="currentColor" stroke="none"/>',
  lot: BOWL + '<path d="M5 11.5h14a7 7 0 0 1-14 0ZM6.2 11.5c.8-3.1 3.1-4.7 5.8-4.7s5 1.6 5.8 4.7Z" fill="currentColor" stroke="none"/>',
};
const LEFT_HINT = { ranOut: 'Cook more', none: 'Just right', bowl: 'A touch less', lot: 'Cook less' };
const BOWL_LOW = '<path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0Z"/>';
const GLYPH = {
  pasta: BOWL_LOW + '<path d="M7.5 12.5c.4-2.4 2.2-3.8 4.3-3.8 1.3 0 2.4.5 3.2 1.4M16.8 3.2l-2.3 9.3M15.3 3.6l.4 2.6M18.4 4l-1 2.4"/>',
  rice: BOWL_LOW + '<path d="M6 12.5c.6-3.2 3.1-5 6-5s5.4 1.8 6 5M9.6 10.3l.9-.4M12.6 9.5h1M15 10.6l.7.5"/>',
  potatoes: '<ellipse cx="9.5" cy="13.5" rx="6" ry="4.4" transform="rotate(-18 9.5 13.5)"/><ellipse cx="16.8" cy="8.6" rx="3.9" ry="3" transform="rotate(20 16.8 8.6)"/><path d="M8 13h.01M11 15h.01M16.5 8.5h.01"/>',
  chili: '<path d="M15.2 7.2c-2 .1-3 1.4-3.9 3.6-.9 2.3-2.8 6.6-6.8 9.2 5.4.4 10.3-2.6 12.3-7.4.9-2.3.1-5.5-1.6-5.4Z"/><path d="M15.2 7.2c.1-1.6.9-2.8 2.4-3.4"/>',
  soup: BOWL_LOW + '<path d="M8.5 9c0-1.3 1-1.7 1-3.1M12 9c0-1.3 1-1.7 1-3.1M15.5 9c0-1.3 1-1.7 1-3.1"/>',
};
const icon = (d, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const av = (name) => `av${(String(name || '?').charCodeAt(0) || 0) % 5}`;
// Blender dish art; if a render is missing, the circle shows a line glyph of the dish instead.
const dishArt = (k, size, cls = '') => `<span class="dish-art ${cls}" aria-hidden="true">${icon(GLYPH[k], 'glyph')}<img src="/assets/dish-${k}.webp" alt="" width="${size}" height="${size}" decoding="async" onerror="this.parentNode.classList.add('noimg');this.remove()"></span>`;

const iosNote = () => (isIOS && !standalone ? `
  <div class="notice"><span class="notice-icon">${icon(I.phone)}</span>
  <div class="notice-body"><p><strong>On iPhone, add it to your Home Screen first.</strong> It's the only way an iPhone lets the 4 PM question buzz you, and the Home Screen app can't see a family you join here in Safari.</p>
  <a class="btn ink sm" href="#/install">Show me how</a></div></div>` : '');
const brand = `<div class="brand"><img src="/app/icons/icon.svg" alt="" width="30" height="30">Dinner Count</div>`;
const privacy = `<p class="fine">${icon(I.shield, 'ic-sm')}<span>First names only. No email, phone, last name, or location, ever.</span></p>`;
const back = `<a class="back" href="#/start">${icon(I.back)}Back</a>`;

function countText(c) {
  return c.overridden ? `<strong>${c.eaters}</strong> eating`
    : `<strong>${c.home}</strong> eating${c.plate ? ` <span class="plus">+</span> <strong>${c.plate}</strong> plate${c.plate > 1 ? 's' : ''}` : ''}`;
}

function tally(s) {
  const a = s.today.amount;
  const amt = a ? `<span class="amt">${esc(a.text)}</span> <span class="what">${esc(DISH[s.today.dish].what)}</span>`
    : `<span class="amt">${esc(s.amounts.pasta.text)}</span> <span class="what">if it's pasta</span>`;
  return `<p class="tally"><span class="tally-count">${countText(s.today.count)}</span><span class="arrow" aria-hidden="true">${icon(I.arrow)}</span><span class="sr">means</span> <span class="tally-amt">${amt}</span></p>`;
}

function answerChip(s, m) {
  const a = s.today.answers[m.id];
  const cls = a || 'none', text = { home: 'Home', plate: 'Plate', out: 'Out' }[a] || 'No answer yet';
  if (s.family.demo && m.id !== s.me.id) {
    return `<button class="chip ${cls}" data-action="cycle" data-id="${esc(m.id)}" aria-label="${esc(m.name)}: ${text}. Tap to change.">${text}</button>`;
  }
  return `<span class="chip ${cls}">${text}</span>`;
}

function people(s) {
  return `<ul class="people">${s.family.members.map((m) => `
    <li class="person"><span class="avatar ${av(m.name)}" aria-hidden="true">${esc(m.name[0])}</span>
      <span class="person-name"><span>${esc(m.name)}${m.id === s.me.id && m.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</span>${m.isCook ? '<span class="person-sub">Cook</span>' : ''}</span>
      ${answerChip(s, m)}</li>`).join('')}</ul>`;
}

function sandboxBanner(s) {
  if (!s.family.demo) return '';
  return `<div class="notice quiet"><span class="notice-icon">${icon(I.spark)}</span><div class="notice-body"><p><strong>Sandbox family.</strong> A pretend family with a week of dinners already learned. Tap anyone's answer to change it and watch the amount move.</p>
    <button class="link small" data-action="leave-demo">Leave the sandbox</button></div></div>`;
}

function pendingRequests(s) {
  if (!s.family.pending.length) return '';
  return `<section class="card requests" aria-label="Requests to join"><p class="eyebrow">Wants to join</p>${s.family.pending.map((p) => `
    <div class="request"><span class="avatar ${av(p.name)}" aria-hidden="true">${esc((p.name || '?')[0])}</span>
    <p><strong>${esc(p.name)}</strong> asked to join ${esc(s.family.name)}.</p>
    <div class="request-actions"><button class="btn ink sm" data-action="approve" data-id="${esc(p.id)}">Let in</button>
    <button class="btn sm" data-action="deny" data-id="${esc(p.id)}">Deny</button></div></div>`).join('')}</section>`;
}

function leftoverButtons(selected, date) {
  return `<div class="leftovers" role="group" aria-label="How much was left">${LEFT.map(([k, label]) =>
    `<button class="left-opt" aria-pressed="${selected === k}" data-action="leftover" data-value="${k}" data-date="${date || ''}">${icon(LEFT_ICON[k])}<span class="left-label">${label}</span><span class="left-hint">${LEFT_HINT[k]}</span></button>`).join('')}</div>`;
}

const dayLabel = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeLabel = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }); };

// ---------- views
const views = {
  start() {
    return `<div class="wrap screen-start">${brand}
      <div class="intro"><h1>Exactly how much to cook tonight.</h1>
      <p class="lede">At 4 PM everyone taps Home, Save me a plate, or Out. The cook gets grams, not guesses, and it learns from your leftovers.</p></div>
      <figure class="preview" aria-label="Example: 3 eating plus 1 plate means cook 320 grams of pasta.">
        <div class="preview-row" aria-hidden="true"><span class="faces"><span class="avatar av0">M</span><span class="avatar av1">L</span><span class="avatar av3">S</span><span class="avatar av2">A</span></span>
          <span class="preview-count"><strong>3</strong> eating + <strong>1</strong> plate</span></div>
        <div class="preview-amt" aria-hidden="true"><span class="preview-arrow">${icon(I.down)}</span>${dishArt('pasta', 88)}
          <span class="preview-text"><span class="eyebrow">Cook</span><span class="preview-num">320<span class="preview-unit">g</span></span><span class="preview-what">dry pasta, learned from your leftovers</span></span></div>
      </figure>
      ${iosNote()}
      <div class="actions"><a class="btn primary block" href="#/create">Start a family</a>
      <a class="btn secondary block" href="#/join">I have a family code</a>
      <button class="link" data-action="demo">Try the sandbox family</button></div>
      ${privacy}</div>`;
  },

  install() {
    return `<div class="wrap">${back}
      <header class="page-head"><h1>Add Dinner Count to your Home Screen</h1>
      <p class="lede">Do this before you join: an iPhone keeps the Home Screen app separate from Safari.</p></header>
      <ol class="steps card">
        <li><span>In Safari, tap <strong>Share</strong> <svg class="inline-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="(the square with an arrow)" role="img"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v9h14v-9"/></svg> at the bottom of the screen. (On newer iPhones it's inside the <strong>•••</strong> button; on iPad it's at the top.)</span></li>
        <li><span>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</span></li>
        <li><span>Open <strong>Dinner Count</strong> from your Home Screen and start or join your family there.</span></li>
      </ol>
      <img class="ios-shot" src="/app/img/ios-add-to-home.svg" alt="Safari's share sheet with the Add to Home Screen row highlighted." width="600" height="520"></div>`;
  },

  create() {
    return `<div class="wrap">${back}
      <header class="page-head"><h1>Start a family</h1><p class="lede">You'll get a code to send to everyone who eats at home.</p></header>${iosNote()}
      <form class="form" data-form="create" novalidate>
        <label class="field">Family name<input type="text" name="familyName" maxlength="30" placeholder="The Sharmas" autocomplete="off"></label>
        <label class="field">Your first name<input type="text" name="name" maxlength="20" required autocomplete="given-name" autocapitalize="words"></label>
        <label class="toggle"><span class="toggle-text">I'm the cook<span class="toggle-sub">You pick the dish and get the amount.</span></span><input type="checkbox" name="isCook" checked></label>
        <p class="fine">${icon(I.clock, 'ic-sm')}<span>Time zone: ${esc(TZ)} (from this phone). The question goes out at 4:00 PM; you can change it later.</span></p>
        <p class="error" role="alert"></p>
        <button class="btn primary block" type="submit">Create family</button>
      </form>${privacy}</div>`;
  },

  join() {
    const pre = new URLSearchParams(location.hash.split('?')[1] || '').get('code') || '';
    return `<div class="wrap">${back}
      <header class="page-head"><h1>Join your family</h1><p class="lede">Type the code someone at home sent you.</p></header>${iosNote()}
      <form class="form" data-form="join" novalidate>
        <label class="field">Family code<input class="code" type="text" name="code" value="${esc(pre)}" maxlength="9" placeholder="KTRW-8H4P" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        <label class="field">Your first name<input type="text" name="name" maxlength="20" required autocomplete="given-name" autocapitalize="words"></label>
        <label class="toggle"><span class="toggle-text">I cook some nights<span class="toggle-sub">Cooks see the amounts.</span></span><input type="checkbox" name="isCook"></label>
        <p class="fine">${icon(I.lock, 'ic-sm')}<span>The code only lets you ask. Someone in your family has to let you in.</span></p>
        <p class="error" role="alert"></p>
        <button class="btn primary block" type="submit">Ask to join</button>
      </form>${privacy}</div>`;
  },

  pending() {
    return `<div class="wrap screen-center">${brand}
      <div class="state"><span class="state-badge" aria-hidden="true">${icon(I.clock)}</span>
      <h1>Waiting to be let in</h1>
      <p class="lede">You asked to join <strong>${esc(state && state.familyName)}</strong> as ${esc(state && state.me && state.me.name)}. The cook will see your request next time they open Dinner Count.</p>
      <p class="status" aria-live="polite"><span class="pulse" aria-hidden="true"></span>Checking every few seconds…</p></div>
      <button class="link" data-action="leave">Cancel my request</button></div>`;
  },

  today(s) {
    const mine = s.today.answers[s.me.id];
    const btn = (k, label, hint, ic) => `<button class="answer ans-${k}" aria-pressed="${mine === k}" data-action="answer" data-value="${k}">
      <span class="answer-icon" aria-hidden="true">${icon(ic)}</span><span class="answer-text">${label}<span class="hint">${hint}</span></span><span class="dot" aria-hidden="true">${icon(I.check)}</span></button>`;
    const report = s.pendingReport && s.me.isCook ? `
      <section class="card stack"><p class="eyebrow">Last night</p>
      <h2>How much ${esc(DISH[s.pendingReport.dish].label.toLowerCase())} was left?</h2>
      <p class="sub">You made ${esc(s.pendingReport.amount)}. This is how it learns your family.</p>
      ${leftoverButtons(null, s.pendingReport.date)}</section>` : '';
    const c = s.claim;
    const claim = c ? `
      <section class="card claim"><div class="claim-head">${dishArt(c.dish, 60)}<p><strong>${esc(DISH[c.dish].label)} from last night is in the fridge.</strong> Who's taking it for lunch?</p></div>
      ${c.claimedBy === s.me.id ? `<div class="claim-done"><span class="claim-ok">${icon(I.check)}You're taking it.</span><button class="link" data-action="claim">Undo</button></div>`
        : c.claimedBy ? `<p class="claim-done">${esc(c.claimedByName)} is taking it.</p>`
        : `<button class="btn ink block" data-action="claim">I'll take it</button>`}</section>` : '';
    return `<div class="wrap">${sandboxBanner(s)}${pendingRequests(s)}${report}
      <header class="page-head"><p class="eyebrow">${esc(dayLabel(s.date))}</p><h1>Home for dinner?</h1></header>
      <div class="answers-block"><div class="answers" role="group" aria-label="Your answer">
        ${btn('home', 'Home', 'Eating with everyone', I.home)}${btn('plate', 'Save me a plate', 'Running late', I.plate)}${btn('out', 'Out', 'Not eating tonight', I.out)}
      </div>
      <p class="fine center">No answer counts as Home.</p></div>${claim}
      <section class="card tonight"><p class="eyebrow">Tonight so far</p>${tally(s)}${people(s)}</section></div>`;
  },

  cook(s) {
    if (!s.me.isCook) return `<div class="wrap"><header class="page-head"><p class="eyebrow">${esc(dayLabel(s.date))}</p><h1>The cook's screen</h1>
      <p class="lede">Only cooks see this. Turn it on in Family if you cook some nights.</p></header>
      <section class="card tonight"><p class="eyebrow">Tonight so far</p>${tally(s)}</section></div>`;
    const c = s.today.count, d = s.today.dish, a = s.today.amount;
    const dishes = Object.keys(DISH).map((k) => `
      <button class="dish" aria-pressed="${d === k}" data-action="dish" data-value="${k}">${dishArt(k, 68)}
        <span class="dish-check" aria-hidden="true">${icon(I.check)}</span><span class="dish-name">${DISH[k].label}</span><span class="dish-amt">${esc(s.amounts[k].text)}</span></button>`).join('');
    const unitSplit = (t) => { const m = /^([\d.]+)\s*(.+)$/.exec(t) || [t, t, '']; return [m[1], m[2]]; };
    let hero = `<div class="amount-hero empty" aria-live="polite"><span class="empty-icon" aria-hidden="true">${icon(I.pot)}</span><p>Pick what you're making to get the amount.</p></div>`;
    if (a) {
      const [num, unit] = unitSplit(a.text);
      const cooked = s.today.override;
      const box = a.box !== a.amount ? `<p class="boxline">The box says <s>${esc(a.box)} ${esc(a.unit)}</s> for ${c.eaters}.</p>` : '';
      hero = `<div class="amount-hero" aria-live="polite" aria-atomic="true">${dishArt(d, 132, 'hero-art')}
        <p class="eyebrow">Cook</p>
        <p class="figure"><span class="big">${esc(num)}</span><span class="unit">${esc(unit)}</span></p>
        <p class="what">${esc(DISH[d].what)} for ${c.eaters}</p>
        <p class="reason">${icon(I.spark, 'ic-sm')}<span>${esc(a.reason)}</span></p>${box}
        ${cooked ? `<p class="boxline">You cooked <strong>${esc(cooked)} ${esc(a.unit)}</strong>. That counts toward learning.</p>` : ''}</div>`;
    }
    const override = a ? `
      <details class="card disclosure" data-key="override"><summary class="link">I cooked a different amount${icon(I.chev, 'chev')}</summary>
        <form class="override-form" data-form="override">
          <label class="sr" for="ovr">Amount you cooked in ${esc(a.unit)}</label>
          <span class="unit-input"><input id="ovr" type="number" inputmode="numeric" name="override" min="1" max="20000" value="${esc(s.today.override || a.amount)}"><span>${esc(a.unit)}</span></span>
          <button class="btn ink" type="submit">Save</button></form></details>` : '';
    const after = a ? `
      <section class="card stack"><p class="eyebrow">After dinner</p><h2>How much was left?</h2>
      <p class="sub">One tap tonight and the ${esc(DISH[d].label.toLowerCase())} amount adjusts to your family.</p>
      ${leftoverButtons(s.today.leftover, s.date)}
      ${s.today.next ? `<p class="learned" aria-live="polite">Got it. Next time ${esc(DISH[d].label.toLowerCase())} for ${c.eaters} will be <strong>${esc(s.today.next.text)}</strong>.</p>` : ''}</section>` : '';
    return `<div class="wrap">${sandboxBanner(s)}${pendingRequests(s)}
      <header class="page-head"><p class="eyebrow">${esc(dayLabel(s.date))}</p><h1>Tonight</h1></header>
      <section class="card count-card"><div class="count-row"><p class="tally">${countText(c)}</p>
        <div class="count-edit"><button class="stepper" data-action="count" data-delta="-1" aria-label="One fewer">${icon(I.minus)}</button><span class="stepper-sep" aria-hidden="true"></span><button class="stepper" data-action="count" data-delta="1" aria-label="One more">${icon(I.plus)}</button></div></div>
      ${c.overridden ? `<p class="sub">You set the count by hand. <button class="link" data-action="count-reset">Use the answers (${c.counted})</button></p>` : `<p class="sub">${c.out} out${c.unanswered ? ` · ${c.unanswered} haven't answered (counted as Home)` : ''}</p>`}</section>
      <section class="picker"><h2 class="section-title">What are you making?</h2><div class="dishes" role="group" aria-label="Dish">${dishes}</div></section>
      ${hero}${override}${after}
      <details class="card disclosure" data-key="eaters"><summary class="link">Who's eating${icon(I.chev, 'chev')}</summary><div class="disclosure-body">${people(s)}</div></details></div>`;
  },

  family(s) {
    const f = s.family, admin = s.me.admin;
    let push;
    if (f.demo) push = `<p class="sub">Reminders are off in the sandbox.</p>`;
    else if (isIOS && !standalone) push = `<p class="sub">On iPhone, reminders only work from the Home Screen app.</p><a class="btn ink block" href="#/install">Show me how</a>`;
    else if (!pushCapable || !s.push.ready) push = `<p class="sub">This browser can't get reminders.</p>`;
    else if (s.push.subscribed && Notification.permission === 'granted') push = `<p class="on-line">${icon(I.check)}Reminders are on for this phone.</p><button class="link" data-action="push-off">Turn off on this phone</button>`;
    else if (Notification.permission === 'denied') push = `<p class="sub">Notifications are blocked for Dinner Count. Turn them on in your phone's Settings, then come back.</p>`;
    else push = `<button class="btn primary block" data-action="push-on">Turn on reminders</button>`;
    const notif = `<div class="notif" aria-hidden="true"><img src="/app/icons/icon.svg" alt="" width="38" height="38">
      <span class="notif-body"><span class="notif-top"><strong>Dinner Count</strong><span>now</span></span><span class="notif-title">Home for dinner?</span><span class="notif-text">Home, Save me a plate, or Out. One tap.</span></span></div>`;
    return `<div class="wrap">${sandboxBanner(s)}
      <header class="page-head"><p class="eyebrow">Family</p><h1>${esc(f.name)}</h1></header>
      ${f.code ? `<section class="group"><h2 class="group-title">Family code</h2>
        <div class="card code-card"><p class="display">${esc(f.code.slice(0, 4))}-${esc(f.code.slice(4))}</p>
        <button class="btn secondary block" data-action="share">${icon(I.share)}Send the code to your family</button></div>
        <p class="group-foot">Anyone with this code can ask to join. You decide who gets in.</p></section>` : ''}
      ${pendingRequests(s)}
      <section class="group"><h2 class="group-title">People</h2><div class="card list-card">${people(s)}
        <label class="toggle"><span class="toggle-text">I cook some nights<span class="toggle-sub">Cooks see the amounts.</span></span><input type="checkbox" data-action="toggle-cook" ${s.me.isCook ? 'checked' : ''}></label></div></section>
      <section class="group"><h2 class="group-title">The ${esc(timeLabel(f.reminderTime))} question</h2>
        <div class="card stack">${notif}${push}
        ${admin ? `<form class="time-row" data-form="reminder"><label for="rt">Question time</label>
          <input id="rt" type="time" name="reminderTime" value="${esc(f.reminderTime)}"><button class="btn secondary sm" type="submit">Save time</button></form>
          ${f.demo ? '' : `<button class="link" data-action="notify-now">Send today's question now</button>`}` : ''}</div></section>
      <section class="group"><h2 class="group-title">Privacy</h2>
        <div class="card stack"><p class="sub">Dinner Count only knows first names and who's home for dinner today. No email, phone, last name, or location. Answers are deleted after 30 days.</p>
        <button class="btn danger block" data-action="leave">Leave family</button></div>
        <p class="group-foot">Leaving deletes you and this phone's reminders. When the last person leaves, the whole family is deleted.</p></section></div>`;
  },
};

// ---------- render + routing
function route() { return (location.hash.replace(/^#\/?/, '').split('?')[0] || '').replace(/[^a-z]/g, ''); }

function render() {
  const r = route();
  if (location.hash === '#demo') return startDemo();
  let view;
  if (!auth) view = ['start', 'install', 'create', 'join'].includes(r) ? r : 'start';
  else if (!state) { if (!loading) { loading = true; refresh().finally(() => { loading = false; }); } view = null; }
  else if (state.status === 'pending') view = 'pending';
  else view = ['today', 'cook', 'family', 'install'].includes(r) ? r : (state.me.isCook ? 'cook' : 'today');
  const member = state && state.status === 'member' && auth;
  $('#tabs').classList.toggle('hidden', !member || view === 'install');
  document.body.classList.toggle('no-tabs', !member || view === 'install');
  document.querySelectorAll('#tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === view ? 'page' : 'false'));
  if (!view) { main.innerHTML = `<div class="wrap"><p class="muted">Loading…</p></div>`; return; }
  const html = views[view](state);
  if (main.dataset.view !== view || main.dataset.html !== html) {
    const same = main.dataset.view === view;
    const keep = same ? snapshot() : null, keepScroll = same ? scrollY : 0;
    main.innerHTML = html; main.dataset.html = html;
    if (same) restore(keep);
    else {
      main.dataset.view = view;
      const h = main.querySelector('h1');
      document.title = view === 'start' ? 'Dinner Count' : `${h ? h.textContent.trim() : 'Dinner Count'} · Dinner Count`;
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
    scrollTo(0, keepScroll);
  }
  // The amount changes with no navigation: announce it from a region that is never re-rendered.
  const a = state && state.today && state.today.amount;
  const now = a ? `${a.text} ${DISH[state.today.dish].what} for ${state.today.count.eaters}` : null;
  if (view === 'cook' && now && lastAmount && now !== lastAmount) $('#live').textContent = `Now ${now}.`;
  lastAmount = now;
}

// Re-rendering replaces the DOM; keep keyboard/screen-reader focus and open panels where they were.
function snapshot() {
  const el = document.activeElement;
  let sel = null;
  if (el && main.contains(el)) {
    if (el.dataset.action) sel = ['action', 'value', 'id', 'date'].filter((k) => el.dataset[k]).map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
    else if (el.tagName === 'SUMMARY' && el.parentElement.dataset.key) sel = `details[data-key="${el.parentElement.dataset.key}"] > summary`;
    else if (el.id) sel = '#' + CSS.escape(el.id);
  }
  return { sel, open: [...main.querySelectorAll('details[open]')].map((d) => d.dataset.key) };
}
function restore({ sel, open }) {
  for (const k of open) { const d = main.querySelector(`details[data-key="${k}"]`); if (d) d.open = true; }
  const el = sel && main.querySelector(sel);
  if (el) el.focus({ preventScroll: true });
}

async function refresh() {
  if (!auth) return;
  try { setState(await api('GET', '/state')); }
  catch (e) {
    if (!state) { main.innerHTML = `<div class="wrap stack"><p class="error">${esc(e.message)}</p><button class="btn" data-action="retry">Try again</button></div>`; main.dataset.view = ''; return; }
  }
  if (!document.activeElement || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) render();
}

async function startDemo() {
  history.replaceState(null, '', '/app/#/cook');
  main.innerHTML = `<div class="wrap"><p class="muted">Setting the table…</p></div>`;
  try {
    const out = await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tz: TZ }) }).then((r) => r.json());
    if (!out.auth) throw new Error(out.error || 'Could not start the sandbox.');
    setAuth(out.auth, { demo: true }); setState(out.state); render();
  } catch (e) { main.innerHTML = `<div class="wrap stack"><p class="error">${esc(e.message)}</p><a class="link" href="#/start">Back</a></div>`; }
}

async function act(fn) {
  try { const s = await fn(); if (s && s.status) setState(s); render(); }
  catch (e) { alertInline(e.message); }
}
function alertInline(msg) { const el = main.querySelector('.error'); if (el) el.textContent = msg; else toast(msg); }

// ---------- events
main.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || b.tagName === 'INPUT') return;
  const v = b.dataset.value, id = b.dataset.id;
  switch (b.dataset.action) {
    case 'demo': return go('#demo');
    case 'retry': return refresh();
    case 'leave-demo': signOut(); return go('#/start');
    case 'answer': return act(() => api('POST', '/answer', { answer: v }));
    case 'cycle': {
      const next = { home: 'plate', plate: 'out', out: 'home' }[state.today.answers[id] || 'home'];
      return act(() => api('POST', '/answer', { answer: next, memberId: id }));
    }
    case 'dish': return act(() => api('POST', '/cook', { dish: v }));
    case 'count': return act(() => api('POST', '/cook', { countOverride: Math.max(0, state.today.count.eaters + Number(b.dataset.delta)) }));
    case 'count-reset': return act(() => api('POST', '/cook', { countOverride: null }));
    case 'leftover': return act(() => api('POST', '/leftover', { leftover: v, date: b.dataset.date || undefined }));
    case 'claim': return act(() => api('POST', '/claim', {}));
    case 'approve': return act(() => api('POST', `/members/${encodeURIComponent(id)}/approve`, { allow: true }));
    case 'deny': return act(() => api('POST', `/members/${encodeURIComponent(id)}/approve`, { allow: false }));
    case 'share': return shareCode();
    case 'push-on': return enablePush();
    case 'push-off': return disablePush();
    case 'notify-now': return act(async () => { const r = await api('POST', '/notify-now', {}); toast(r.sent ? `Sent to ${r.sent} phone${r.sent > 1 ? 's' : ''}.` : 'No phones have reminders on yet.'); });
    case 'leave':
      if (!confirm(state && state.status === 'pending' ? 'Cancel your request?' : 'Leave this family? This deletes you from it on every device.')) return;
      return act(async () => { await api('POST', '/leave', {}); signOut(); go('#/start'); });
  }
});

main.addEventListener('change', (e) => {
  if (e.target.dataset.action === 'toggle-cook') act(() => api('POST', '/me', { isCook: e.target.checked }));
});

main.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, data = Object.fromEntries(new FormData(f)), err = f.querySelector('.error');
  const btn = f.querySelector('[type=submit]');
  if (err) err.textContent = '';
  if (btn) btn.disabled = true;
  try {
    if (f.dataset.form === 'create') {
      const out = await api('POST', '/families', { familyName: data.familyName, name: data.name, isCook: !!data.isCook, tz: TZ });
      setAuth(out.auth); setState(out.state); go('#/family');
    } else if (f.dataset.form === 'join') {
      const out = await api('POST', '/join', { code: data.code, name: data.name, isCook: !!data.isCook });
      setAuth(out.auth); setState(out.state); go('#/pending');
    } else if (f.dataset.form === 'override') {
      setState(await api('POST', '/cook', { override: Number(data.override) })); render(); toast('Saved. It counts toward learning.');
    } else if (f.dataset.form === 'reminder') {
      setState(await api('POST', '/settings', { reminderTime: data.reminderTime })); render(); toast('Reminder time saved.');
    }
  } catch (ex) { if (err) err.textContent = ex.message; else toast(ex.message); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
});

// ---------- share + push
async function shareCode() {
  const code = state.family.code, pretty = code.slice(0, 4) + '-' + code.slice(4);
  const url = `${location.origin}/app/#/join?code=${pretty}`;
  const text = `Join our family on Dinner Count. Code: ${pretty}`;
  try { if (navigator.share) await navigator.share({ title: 'Dinner Count', text, url }); else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Copied. Paste it in your family chat.'); } }
  catch {}
}

const b64ToBytes = (b) => { const p = '='.repeat((4 - (b.length % 4)) % 4); const raw = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

async function enablePush() {
  try {
    const perm = await Notification.requestPermission(); // must run from this tap
    if (perm !== 'granted') { toast('Reminders need notification permission.'); return render(); }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(state.push.publicKey) });
    setState(await api('POST', '/subscribe', { subscription: sub.toJSON() }));
    toast('Reminders are on.'); render();
  } catch (e) { toast('Could not turn on reminders: ' + e.message); }
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    setState(await api('DELETE', '/subscribe')); render();
  } catch (e) { toast(e.message); }
}

// ---------- boot
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
}
addEventListener('hashchange', render);
addEventListener('online', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
// Keep the cook's amount live when someone taps Out. Faster while waiting to be let in.
setInterval(() => { if (!document.hidden && auth) refresh(); }, 5000);
render();
if (auth) refresh();
