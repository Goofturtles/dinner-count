// Dinner Count landing: boot, input -> progress, gates, choreography, HUD, quality tiers, fallbacks.
// Every animated value is a function of one progress number p (0..1). Only the gates use time.
import * as THREE from 'three';
import { makeHold } from './hold.js';

const html = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');

// ---------------------------------------------------------------- tiny math
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const remap = (x, a, b) => clamp01((x - a) / (b - a));
const ss = (t) => t * t * (3 - 2 * t);
const win = (p, a, b) => ss(remap(p, a, b));
const lerp = (a, b, t) => a + (b - a) * t;
function keyed(p, keys) { // piecewise-linear [[p, value], ...]
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [p1, v1] = keys[i], [p0, v0] = keys[i - 1];
    if (p <= p1) return lerp(v0, v1, ss(remap(p, p0, p1)));
  }
  return keys[keys.length - 1][1];
}

// ---------------------------------------------------------------- glass layers (stacked divs)
for (const el of $$('.has-glass')) {
  const fx = document.createElement('span');
  fx.className = 'glass-fx'; fx.setAttribute('aria-hidden', 'true');
  fx.innerHTML = '<i class="g-fill"></i><i class="g-tint"></i><i class="g-sheen"></i><i class="g-hi"></i><i class="g-edge-l"></i><i class="g-edge-d"></i><i class="g-glow"></i>';
  el.prepend(fx);
}

// Leftover claim card works in every mode.
const claim = $('.claim');
claim.addEventListener('click', () => {
  const on = claim.getAttribute('aria-pressed') !== 'true';
  claim.setAttribute('aria-pressed', String(on));
  claim.lastChild.nodeValue = on ? 'Claimed by you' : 'Me';
});

const go = (url) => { location.assign(url); };
const finalHold = makeHold($('.hold-final'), {
  ms: 900,
  onDone: () => { flashT0 = performance.now(); setTimeout(() => go('/app/#/create'), 380); },
});
let flashT0 = 0;

// ---------------------------------------------------------------- static page (no WebGL / reduced motion / slow)
const styled = new Set();
function setStyle(el, prop, val) {
  if (el.style[prop] === val) return;
  el.style[prop] = val; styled.add(el);
}
function staticState() {
  $$('.family li').forEach((li) => li.classList.add('done'));
  $$('.ledger li').forEach((li) => li.classList.remove('pending'));
  $('.swap').classList.add('on');
  $('[data-grams]').textContent = '320';
}
let running = false;
function goStatic(reason) {
  running = false;
  html.classList.remove('webgl');
  html.classList.add('static');
  html.dataset.fallback = reason;
  html.removeAttribute('data-hud');
  styled.forEach((el) => el.removeAttribute('style'));
  staticState();
  finalHold.enabled = true;
  if (DEBUG) console.info('[landing] static fallback:', reason);
}
// On the still page the 4 PM question just starts the story: answering scrolls to the first chapter.
$$('.answer').forEach((b) => b.addEventListener('click', () => {
  if (html.classList.contains('static')) $('#h-1').scrollIntoView({ behavior: html.classList.contains('reduced') ? 'auto' : 'smooth', block: 'start' });
}));
if (html.classList.contains('static')) { staticState(); } else { boot(); }

// ================================================================ cinematic
async function boot() {
  let Stage;
  let stage;
  try {
    ({ Stage } = await import('./scene.js'));
    stage = new Stage($('#gl'));
  } catch (e) {
    return goStatic('no-webgl');
  }
  const canvas = $('#gl');
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); goStatic('context-lost'); });

  // ------------------------------------------------ DOM handles
  const acts = $$('.act');
  const actLetters = acts.map((a) => $$('.copy > *, .copy .lt', a).filter((el) => !el.classList.contains('headline')));
  const gateEl = $('.act-gate');
  const clockEl = $('[data-clock]');
  const statusEl = $('[data-status]');
  const tallyEl = $('[data-tally]');
  const gramsEl = $('[data-grams]');
  const stepEls = $$('.bignum-k span');
  const famEls = $$('.family li');
  const ledgerEls = $$('.ledger li');
  const swapEl = $('.act-1 .swap');
  const scrimL = $('.scrim-light'), scrimD = $('.scrim-dark');
  const cards = {
    plates: { el: $('[data-anchor="plates"]'), at: new THREE.Vector3(-0.42, 0.07, -0.02) },
    pasta: { el: $('[data-anchor="pasta"]'), at: new THREE.Vector3(0.17, 0.045, 0.12) },
    rice: { el: $('[data-anchor="rice"]'), at: new THREE.Vector3(0.40, 0.075, -0.03) },
  };
  const midGate = { el: $('.gate-mid'), at: new THREE.Vector3(-0.02, 0.075, -0.10) };
  const tmpV = new THREE.Vector3();

  // ------------------------------------------------ ruler (dinner clock 3:50 PM - 7:10 PM)
  const track = $('.ruler-track');
  const TICK = 11; // px per 5 minutes
  for (let m = -10; m <= 190; m += 5) {
    const t = document.createElement('span');
    t.className = 'tick' + (m % 30 === 0 ? ' major' : '');
    t.style.left = ((m + 10) / 5 * TICK) + 'px';
    track.appendChild(t);
    if (m % 30 === 0) {
      const l = document.createElement('span');
      l.className = 'tick-label';
      const hh = 4 + Math.floor(m / 60), mm = m % 60;
      l.textContent = `${hh}:${String(mm).padStart(2, '0')}`;
      l.style.left = ((m + 10) / 5 * TICK) + 'px';
      track.appendChild(l);
    }
  }
  const rulerEl = $('.ruler');
  let rulerW = rulerEl.clientWidth;

  // ------------------------------------------------ moods (one hue per act)
  const C = (h) => new THREE.Color(h);
  const G = (r, g, b) => new THREE.Color(r, g, b);
  // Each act is its own world: background, key light (colour, angle, strength), pendant, environment, grade.
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const MOODS = {
    cream: { bgA: C('#F4E6D0'), bgB: C('#B8986F'), keyCol: C('#FFE3C2'), key: 6.5, keyDir: V3(-0.95, 0.62, -0.3), pend: 0, env: .17, gain: G(1, 1, 1), lift: G(0, 0, 0), exposure: 1.12, vig: .35, light: 1 },
    tomato: { bgA: C('#9A2A0C'), bgB: C('#1E0501'), keyCol: C('#FF6A3D'), key: 3.6, keyDir: V3(0.7, 0.85, -0.75), pend: 2.5, env: .18, gain: G(1.12, .88, .82), lift: G(0, 0, 0), exposure: 1.05, vig: .75, light: 0 },
    night: { bgA: C('#3A2A18'), bgB: C('#080605'), keyCol: C('#FFC98E'), key: 1.3, keyDir: V3(-0.35, 1.5, -0.5), pend: 8, env: .15, gain: G(1.02, .95, .84), lift: G(0, 0, 0), exposure: .95, vig: .85, light: 0 },
    steam: { bgA: C('#F6F0E6'), bgB: C('#A89C8E'), keyCol: C('#FFF4E6'), key: 3.4, keyDir: V3(-0.5, 1.3, -0.3), pend: 0, env: .35, gain: G(1, 1, 1), lift: G(0, 0, 0), exposure: 1.05, vig: .3, light: 1 },
    dusk: { bgA: C('#33271B'), bgB: C('#0C0907'), keyCol: C('#FFB27A'), key: 2.8, keyDir: V3(-1.0, 0.5, -0.55), pend: 2.5, env: .17, gain: G(1, .96, .92), lift: G(0, 0, 0), exposure: 1.02, vig: .8, light: 0 },
  };
  const MOOD_KEYS = [[0, 'cream'], [0.215, 'cream'], [0.27, 'tomato'], [0.47, 'tomato'], [0.52, 'night'], [0.745, 'night'], [0.785, 'steam'], [0.865, 'steam'], [0.92, 'dusk'], [1, 'dusk']];
  const mood = { bgA: new THREE.Color(), bgB: new THREE.Color(), keyCol: new THREE.Color(), keyDir: new THREE.Vector3(), gain: new THREE.Color(), lift: new THREE.Color(), key: 1, pend: 0, env: 1, exposure: 1, vig: .5, light: 1 };
  function moodAt(p) {
    let i = 1; while (i < MOOD_KEYS.length - 1 && p > MOOD_KEYS[i][0]) i++;
    const [p0, a] = MOOD_KEYS[i - 1], [p1, b] = MOOD_KEYS[i];
    const t = ss(remap(p, p0, p1)), A = MOODS[a], B = MOODS[b];
    for (const k of ['bgA', 'bgB', 'keyCol', 'gain', 'lift']) mood[k].copy(A[k]).lerp(B[k], t);
    mood.keyDir.copy(A.keyDir).normalize().lerp(B.keyDir.clone().normalize(), t);
    for (const k of ['key', 'pend', 'env', 'exposure', 'vig', 'light']) mood[k] = lerp(A[k], B[k], t);
    return mood;
  }

  // ------------------------------------------------ story tables (all keyed to p)
  const FRAME_KEYS = [[0, 0], [0.2, 48], [0.235, 58], [0.30, 72], [0.46, 118], [0.525, 142], [0.74, 200], [0.78, 204], [0.9, 240], [1, 240]];
  const CLOCK_KEYS = [[0, 0], [0.2, 12], [0.27, 90], [0.47, 100], [0.53, 150], [0.745, 165], [0.8, 170], [0.9, 176], [1, 180]];
  const SUBJ = [new THREE.Vector3(-0.42, 0.04, -0.02), new THREE.Vector3(0.08, 0.05, 0.02), new THREE.Vector3(0.40, 0.04, -0.03), new THREE.Vector3(0, 0.05, -0.02)];
  const SUBJ_KEYS = [[0, 0], [0.235, 0], [0.30, 1], [0.47, 1], [0.525, 2], [0.745, 2], [0.86, 3], [1, 3]];
  const POOL = [[-0.42, -0.02, 0.62], [0.07, 0.0, 0.75], [0.40, -0.03, 0.5], [0.0, -0.02, 1.1]];
  // act windows [in0, in1, out0, out1]
  const WIN = [null, [0.008, 0.038, 0.2, 0.235], [0.255, 0.29, 0.475, 0.5], [0.51, 0.545, 0.74, 0.765], [0.785, 0.81, 0.875, 0.895], [0.905, 0.945, 9, 9]];
  const SHIFT_KEYS = [[0, 0.28], [0.235, 0.28], [0.3, 0.12], [0.47, 0.12], [0.525, 0.26], [0.745, 0.26], [0.86, 0.3], [1, 0.3]];
  const ENV_ROT = Q.has('envrot') ? +Q.get('envrot') : 0;
  const COOK_P = 0.42, WIDE = () => innerWidth / innerHeight > 1.05;

  // ------------------------------------------------ progress + gates
  let p = 0, target = 0, maxP = 0, auto = null, scrolled = false;
  const gates = { home: false, cook: false };
  let revealT0 = 0, cookT0 = 0, cookHold = 0;
  const K = -Math.log(1 - 0.075) * 60;              // frame-rate independent lerp speed
  let lateReady = false;
  function limit() { maxP = !gates.home ? 0 : !lateReady ? 0.215 : !gates.cook ? COOK_P : 1; }
  function push(d) {
    if (auto) return;
    const want = target + d;
    if (want > maxP + 1e-4 && d > 0) nudge();
    target = Math.min(maxP, Math.max(gates.home ? 0.0 : 0, want));
    if (target > 0.06) scrolled = true;
  }
  function autoTo(to, dur) { auto = { from: p, to, t0: performance.now(), dur }; }
  let nudgeT = 0;
  function nudge() { nudgeT = performance.now(); }

  function completeHome() {
    if (gates.home) return;
    gates.home = true; limit();
    revealT0 = performance.now();
    autoTo(0.06, 1900);
  }
  const cookHoldApi = makeHold($('[data-hold="cook"]'), {
    ms: 900, tapAfter: 2, tapLabel: 'Tap<br>to cook',
    onProgress: (v) => { cookHold = v; },
    onDone: () => { gates.cook = true; limit(); cookT0 = performance.now(); autoTo(0.53, 2600); },
  });
  $$('.answer').forEach((b) => b.addEventListener('click', () => { completeHome(); }));

  // Focus on a later control means the visitor wants to be there: jump, never trap.
  $('[data-hold="cook"]').addEventListener('focus', () => { if (!gates.cook) { if (!gates.home) completeHome(); limit(); auto = null; target = COOK_P; } });
  $('.hold-final').addEventListener('focus', () => { gates.home = gates.cook = true; limit(); auto = null; target = 1; });
  claim.addEventListener('focus', () => { gates.home = gates.cook = true; limit(); auto = null; target = 0.84; });

  // ------------------------------------------------ input
  addEventListener('wheel', (e) => {
    let d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    d = Math.max(-500, Math.min(500, d));
    push(d * 0.0001);
  }, { passive: true });
  let ty = null;
  canvas.addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (ty == null) return;
    const y = e.touches[0].clientY;
    if (e.cancelable && !e.target.closest('a,button')) e.preventDefault();
    push((ty - y) * 0.00024); ty = y;
  }, { passive: false });
  addEventListener('touchend', () => { ty = null; }, { passive: true });
  const isEditable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  let bodyHold = null;
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (isEditable(t)) return;
    const onControl = t && t.closest && t.closest('a,button');
    const k = e.key;
    if ((k === 'Enter' || k === ' ') && !onControl) {
      e.preventDefault();
      if (!gates.home) return completeHome();
      if (!gates.cook && p > COOK_P - 0.01) { bodyHold = cookHoldApi; if (!e.repeat) cookHoldApi.keyStart(); return; }
      if (p > 0.97) { bodyHold = finalHold; if (!e.repeat) finalHold.keyStart(); return; }
      if (k === ' ') push(e.shiftKey ? -0.1 : 0.1);
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); push(0.035); }
    else if (k === 'ArrowUp') { e.preventDefault(); push(-0.035); }
    else if (k === 'PageDown') { e.preventDefault(); push(0.1); }
    else if (k === 'PageUp') { e.preventDefault(); push(-0.1); }
    else if (k === 'Home' && !onControl) { e.preventDefault(); push(-1); }
    else if (k === 'End' && !onControl) { e.preventDefault(); push(1); }
  });
  addEventListener('keyup', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && bodyHold) { bodyHold.keyEnd(); bodyHold = null; }
  });
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = -(e.clientY / innerHeight * 2 - 1);
  }, { passive: true });

  // ------------------------------------------------ quality tiers
  const d = devicePixelRatio || 1;
  const TIERS = [
    { dpr: Math.min(d, 2), msaa: 4, shadow: 2048, blur: true, grain: true },
    { dpr: Math.min(d, 1.5), msaa: 0, shadow: 1024, blur: true, grain: true },
    { dpr: Math.min(d, 1), msaa: 0, shadow: 0, blur: true, grain: true },
    { dpr: Math.min(d, 1), msaa: 0, shadow: 0, blur: false, grain: true },
    { dpr: Math.min(d, 0.8), msaa: 0, shadow: 0, blur: false, grain: false },
  ];
  const forced = Q.has('tier') ? Math.max(0, Math.min(TIERS.length - 1, +Q.get('tier') | 0)) : null;
  let tier = forced ?? (d > 2.5 || innerWidth < 500 ? 1 : 0);
  stage.setTier(TIERS[tier]);
  const perf = { samples: [], skip: 30, log: [] };
  function measure(ms) {
    if (forced != null) return;
    if (perf.skip > 0) { perf.skip--; return; }
    perf.samples.push(ms);
    if (perf.samples.length < 45) return;
    const avg = perf.samples.reduce((a, b) => a + b, 0) / perf.samples.length;
    perf.samples.length = 0;
    perf.log.push({ tier, avg: Math.round(avg * 10) / 10 });
    if (perf.log.length > 12) perf.log.shift();
    if (avg > 22 && tier < TIERS.length - 1) {
      tier = Math.min(TIERS.length - 1, tier + (avg > 45 ? 2 : 1));
      stage.setTier(TIERS[tier]); perf.skip = 20;
    } else if (avg > 34.5 && tier === TIERS.length - 1) {
      goStatic('slow');
    }
  }

  // ------------------------------------------------ load (the loader clock counts to 4:00 as files land)
  let loaded = 0, shown = 0, ready = false;
  const TOTAL = 5;
  statusEl.textContent = 'Setting the table';
  try {
    await stage.load(() => { loaded++; });
  } catch (e) {
    console.error(e);
    return goStatic('load-failed');
  }
  if (html.classList.contains('static')) return goStatic('load-timeout');   // the still page already took over
  html.classList.add('webgl');
  running = true;
  // Second wave, after the first screen is interactive: the late dishes and a real HDR environment.
  setTimeout(() => {
    stage.loadLate().then(() => { lateReady = true; limit(); }, (e) => { console.error(e); goStatic('load-failed'); });
    // env.exr: the 1K HDRI at ~185 KB (DWAB), for desktop and phone. env.hdr (1.4 MB) would break the 3 MB budget.
    stage.upgradeEnvironment('/assets/env.exr', ENV_ROT);
  }, 50);

  // ------------------------------------------------ frame
  const f = {
    frame: 0, shift: { x: 0, y: 0 }, parallax: { x: 0, y: 0 }, dolly: 0, subject: new THREE.Vector3(),
    mood, pool: { x: 0, z: 0, r: 1 }, fade: [0.9, 1.9], focusRange: .2,
    plateOut: 0, plateSaved: 0, savedSpot: { x: -0.216, z: 0.166 }, brass: new THREE.Color('#C9A25B'),
    pastaScale: 1, riceScale: 1, lid: 0, steam: 0, curtain: 0, curtainPart: 0,
    motes: 0, moteSize: .006, moteColor: new THREE.Color(),
    reveal: 0, grain: .05, reducedGrain: false, flash: 0, time: 0,
  };
  const moteDay = new THREE.Color('#FFE9C8'), moteNight = new THREE.Color('#E7B45A');
  let last = performance.now(), lastStatus = '', lastTally = '', lastHud = '';
  const t0 = last;

  function setStatus(s) {
    if (s === lastStatus) return;
    lastStatus = s;
    statusEl.textContent = s;
    statusEl.parentElement.style.opacity = s ? '1' : '0';
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const rawMs = now - last; last = now;
    const dt = Math.min(1 / 20, rawMs / 1000);
    if (document.visibilityState === 'visible' && ready) measure(rawMs);
    if (!running) return;
    const time = (now - t0) / 1000;

    // loader clock: 3:52 -> 4:00 as files land
    shown += (loaded / TOTAL - shown) * (1 - Math.exp(-6 * dt));
    if (!ready && shown > 0.985) { ready = true; gateEl.classList.add('ready'); }
    const mins = ready ? 8 : Math.min(7, Math.floor(shown * 8));
    clockEl.textContent = mins >= 8 ? '4:00' : `3:${52 + mins}`;

    // progress
    if (auto) {
      const k = clamp01((now - auto.t0) / auto.dur);
      target = lerp(auto.from, auto.to, ss(k));
      if (k >= 1) auto = null;
    }
    p += (target - p) * (1 - Math.exp(-K * dt));
    if (Math.abs(target - p) < 1e-5) p = target;

    // camera, layout, mood
    const wide = WIDE();
    f.time = time;
    f.frame = keyed(p, FRAME_KEYS);
    const si = keyed(p, SUBJ_KEYS), s0 = Math.floor(si), s1 = Math.min(3, s0 + 1);
    f.subject.copy(SUBJ[s0]).lerp(SUBJ[s1], si - s0);
    const pl = POOL[s0], pr = POOL[s1], pt = si - s0;
    f.pool.x = lerp(pl[0], pr[0], pt); f.pool.z = lerp(pl[1], pr[1], pt); f.pool.r = lerp(pl[2], pr[2], pt);
    const heroT = win(p, 0.78, 0.9);
    f.fade[0] = lerp(0.85, 1.25, heroT); f.fade[1] = lerp(1.7, 2.6, heroT);
    f.shift.x = wide ? keyed(p, SHIFT_KEYS) : 0;
    f.shift.y = wide ? lerp(0, -0.1, heroT) : lerp(-0.2, -0.16, heroT);
    f.dolly = wide ? 0.12 * heroT : 0;
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-5 * dt));
    pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-5 * dt));
    f.parallax.x = pointer.sx; f.parallax.y = pointer.sy;
    moodAt(p);
    // holding to cook warms the grade before the cut (the gate changes the world while you hold)
    const cooking = Math.max(cookHold, gates.cook ? 1 - remap(now - cookT0, 1400, 3200) : 0);
    mood.exposure *= 1 + cookHold * 0.1;
    mood.key *= 1 + cookHold * 0.35;
    mood.gain.r *= 1 + cookHold * 0.05;
    f.focusRange = lerp(0.2, 0.32, heroT);

    // gate 0 reveal: rack focus from soft to sharp
    const rv = gates.home ? ss(clamp01((now - revealT0) / 1600)) : 0;
    f.reveal = lerp(0.4, 1, rv);

    // act 1: plates leave the stack as people answer
    f.plateOut = win(p, 0.10, 0.145);
    f.plateSaved = win(p, 0.125, 0.165);
    // act 2: 500 -> 400 -> 320 g
    const g1 = win(p, 0.31, 0.335), g2 = win(p, 0.355, 0.39);
    const grams = Math.round((500 - 100 * g1 - 80 * g2) / 10) * 10;
    f.pastaScale = Math.max(0.6, grams / 500);
    f.lid = Math.max(cookHold * 0.8, gates.cook ? 1 - win(p, 0.5, 0.56) : 0);
    f.steam = Math.max(cookHold, cooking * (1 - win(p, 0.5, 0.56))) * (p < 0.6 ? 1 : 0);
    // act 3: rice 300 -> 270 -> 250
    const r1 = win(p, 0.61, 0.635), r2 = win(p, 0.66, 0.685);
    const rice = Math.round((300 - 30 * r1 - 20 * r2) / 10) * 10;
    f.riceScale = rice / 300;
    // act 4: the steam curtain closes over the move, then parts on the wide table
    f.curtain = win(p, 0.745, 0.79) * (1 - win(p, 0.9, 0.94));
    f.curtainPart = win(p, 0.83, 0.905);
    // motes: afternoon dust, then brass bokeh at night
    const night = win(p, 0.5, 0.545) * (1 - win(p, 0.745, 0.785));
    f.motes = (0.3 + 0.6 * night) * (1 - f.curtain);
    f.moteSize = lerp(0.005, 0.012, night);
    f.moteColor.copy(moteDay).lerp(moteNight, Math.max(night, win(p, 0.9, 0.95)));
    f.grain = lerp(0.03, 0.045, 1 - mood.light);
    const veil = f.curtain * (1 - f.curtainPart) * 0.78;   // the steam act: a white veil over the move, puffs on top
    f.flash = flashT0 ? clamp01((now - flashT0) / 350) : (gates.cook ? 0.35 * (1 - clamp01((now - cookT0) / 500)) * (cookT0 ? 1 : 0) : 0);
    f.flash = Math.max(f.flash, veil);

    stage.update(f);
    stage.render();

    // ------------------------------------------------ DOM choreography
    const hud = (p < 0.24 || (p > 0.77 && p < 0.88)) ? 'light' : 'dark';
    if (hud !== lastHud) { html.dataset.hud = hud; lastHud = hud; }
    const vis = [];
    vis[0] = gates.home ? 1 - win(p, 0.0, 0.03) : 1;
    for (let i = 1; i < acts.length; i++) { const w = WIN[i]; vis[i] = win(p, w[0], w[1]) * (1 - win(p, w[2], w[3])); }
    acts.forEach((a, i) => {
      setStyle(a, 'opacity', vis[i].toFixed(3));
      const live = vis[i] > 0.6;
      if (a.classList.contains('live') !== live) a.classList.toggle('live', live);
      if (i === 0) return;
      const w = WIN[i];
      actLetters[i].forEach((el, j) => {
        const e = win(p, w[0] + j * 0.004, w[1] + j * 0.004) * (1 - win(p, w[2] - 0.006 + j * 0.002, w[3]));
        setStyle(el, 'opacity', e.toFixed(3));
        const b = (1 - e) * 14;
        setStyle(el, 'filter', b > 0.2 ? `blur(${b.toFixed(1)}px)` : 'none');
        setStyle(el, 'transform', e > 0.999 ? 'none' : `translate3d(0, ${((1 - e) * 22).toFixed(1)}px, 0)`);
      });
    });
    // legibility scrims behind the copy column, light or dark with the mood
    const copyVis = Math.max(vis[0] * 0.6, vis[1], vis[2], vis[3], vis[5]);
    setStyle(scrimL, 'opacity', (copyVis * mood.light).toFixed(3));
    setStyle(scrimD, 'opacity', (copyVis * (1 - mood.light)).toFixed(3));
    // act 1 details
    famEls.forEach((li) => { const on = p >= +li.dataset.at; li.classList.toggle('done', on); li.classList.toggle('pending', !on); });
    swapEl.classList.toggle('on', p >= 0.155);
    // act 2 details
    gramsEl.textContent = String(grams);
    const step = p < 0.335 ? 0 : p < 0.375 ? 1 : 2;
    stepEls.forEach((s, i) => s.classList.toggle('on', i === step));
    // act 3 details
    ledgerEls.forEach((li) => li.classList.toggle('pending', p < +li.dataset.at));

    // floating cards pinned to their dishes
    const { w: vw, h: vh } = stage.size;
    const place = (card, show) => {
      stage.project(card.at, tmpV);
      const x = (tmpV.x * 0.5 + 0.5) * vw, y = (-tmpV.y * 0.5 + 0.5) * vh;
      const cw = card.el.offsetWidth, ch = card.el.offsetHeight;
      let cx = x + 26, cy = y - 30, pinRight = false;
      if (cx + cw > vw - 16) { cx = x - 26 - cw; pinRight = true; }
      if (cx < 12) cx = Math.min(12, vw - cw - 12);
      cy = Math.max(70, Math.min(vh - ch - 150, cy));
      card.el.classList.toggle('pin-right', pinRight);
      setStyle(card.el, 'transform', `translate(${cx.toFixed(1)}px, ${(cy + (1 - show) * 10).toFixed(1)}px)`);
      setStyle(card.el, 'opacity', show.toFixed(3));
    };
    place(cards.plates, win(p, 0.06, 0.09) * (1 - win(p, 0.2, 0.225)));
    place(cards.pasta, win(p, 0.385, 0.405) * (1 - win(p, 0.47, 0.49)));
    place(cards.rice, win(p, 0.635, 0.655) * (1 - win(p, 0.735, 0.755)));
    // mid gate sits on the pot lid
    stage.project(midGate.at, tmpV);
    const gx = (tmpV.x * 0.5 + 0.5) * vw, gy = (-tmpV.y * 0.5 + 0.5) * vh;
    const gv = gates.cook ? 1 - clamp01((now - cookT0) / 600) : win(p, COOK_P - 0.03, COOK_P - 0.004);
    setStyle(midGate.el, 'transform', `translate3d(${(gx - 44).toFixed(1)}px, ${(gy - 44).toFixed(1)}px, 0)`);
    setStyle(midGate.el, 'opacity', gv.toFixed(3));
    midGate.el.classList.toggle('live', gv > 0.5);
    setStyle(midGate.el, 'pointerEvents', gv > 0.5 ? 'auto' : 'none');

    // HUD: ruler, tally, status
    rulerW = rulerEl.clientWidth || rulerW;
    const minutes = gates.home ? keyed(p, CLOCK_KEYS) : -8 + shown * 8;
    setStyle(track, 'transform', `translate3d(${(rulerW / 2 - (minutes + 10) / 5 * TICK).toFixed(1)}px, 0, 0)`);
    const tally = p < 0.1 ? '5 plates' : p < 0.155 ? '4 plates' : p < 0.27 ? '3 eating + 1 plate' : p < 0.5 ? `${grams} g pasta` : p < 0.9 ? `${rice} g rice` : '4 at the table';
    if (tally !== lastTally) { tallyEl.textContent = tally; lastTally = tally; }
    let status = '';
    if (!gates.home) status = ready ? 'Tap Home' : 'Setting the table';
    else if (!lateReady && p > 0.2) status = 'Setting the table';
    else if (!scrolled && p > 0.03) status = matchMedia('(pointer: coarse)').matches ? 'Swipe up' : 'Scroll';
    else if (!gates.cook && p > COOK_P - 0.012) status = cookHoldApi.value > 0 ? 'Keep holding' : 'Hold to cook';
    else if (p > 0.97) status = 'Hold to start';
    if (now - nudgeT < 900 && status) statusEl.parentElement.classList.add('nudge'); else statusEl.parentElement.classList.remove('nudge');
    setStatus(status);
  }
  requestAnimationFrame(frame);

  addEventListener('resize', () => { stage.resize(); rulerW = rulerEl.clientWidth; });
  document.addEventListener('visibilitychange', () => { last = performance.now(); perf.samples.length = 0; perf.skip = 10; });

  if (DEBUG) {
    window.__dc = {
      jump(v) { gates.home = true; if (v > COOK_P) gates.cook = true; limit(); auto = null; revealT0 = -1e9; target = p = Math.min(v, maxP); },
      get lateReady() { return lateReady; },
      get p() { return p; }, get tier() { return tier; }, get perf() { return perf.log; }, stage,
    };
  }
}
