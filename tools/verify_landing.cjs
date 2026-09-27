// Verify the landing page (/). Node Playwright, installed Chrome, headless, SwiftShader WebGL.
//   node tools/verify_landing.cjs [baseUrl]        default http://localhost:3538
// Writes screenshots to tools/out/landing-*.png and a summary to tools/out/landing-results.json.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'http://localhost:3538').replace(/\/$/, '');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const GL_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const results = { base: BASE, when: new Date().toISOString(), checks: {} };
const pass = (k, ok, info) => { results.checks[k] = { ok, ...info }; console.log(`${ok ? 'PASS' : 'FAIL'}  ${k}`, info ? JSON.stringify(info) : ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, { w, h, mobile = false, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const log = { errors: [], failed: [], bytes: 0, requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => log.failed.push(r.url()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const urls = new Map();
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, { url: e.response.url, status: e.response.status }));
  cdp.on('Network.loadingFinished', (e) => {
    log.bytes += e.encodedDataLength;
    const u = urls.get(e.requestId); if (u) log.requests.push({ ...u, bytes: e.encodedDataLength });
  });
  return { ctx, page, log };
}
async function waitReady(page, timeout = 90000) {
  await page.waitForFunction(() => document.documentElement.classList.contains('webgl') || document.documentElement.classList.contains('static'), null, { timeout });
  return page.evaluate(() => (document.documentElement.classList.contains('static') ? 'static:' + (document.documentElement.dataset.fallback || 'css') : 'webgl'));
}
async function settle(page, ms = 1800) { await sleep(ms); }
async function waitLate(page) { await page.waitForFunction(() => window.__dc && window.__dc.lateReady, null, { timeout: 120000 }); }
async function clipProbe(page) {
  return page.evaluate(() => {
    const hits = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!/hidden|clip/.test(cs.overflow + cs.overflowY)) continue;
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') continue;
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue; // .sr-only
      if (el.scrollHeight > el.clientHeight + 1) hits.push({ el: el.tagName.toLowerCase() + '.' + [...el.classList].join('.'), sh: el.scrollHeight, ch: el.clientHeight, text: el.textContent.trim().slice(0, 40) });
    }
    return hits;
  });
}

// Text contrast over the live WebGL frame: hide the text, screenshot what is behind it, and compare the
// text colour with the worst-case (5th/95th percentile) background luminance inside each text box.
async function contrastProbe(page, browser) {
  const boxes = await page.evaluate(() => {
    const out = []; const sel = '.act.live .eyebrow, .act.live .headline .lt, .act.live .body, .act.live .family li, .act.live .leftovers li, .act.live .bignum-k span.on, .act.live .ledger li:not(.pending) .ledger-k, .act.live .ledger li:not(.pending) .ledger-v, .act.live .card, .act.live .demo-link, .hud-status-label, .skip, .tally, .pill-alt';
    for (const el of document.querySelectorAll(sel)) {
      const tgt = el.matches('.card') ? (el.querySelector('.card-v, .card-q') || el) : el;
      const rg = document.createRange(); rg.selectNodeContents(tgt);
      const r = rg.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;   // the glyph box, not padding/corners
      let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      if (o < 0.9) continue;
      const col = getComputedStyle(tgt).color;
      out.push({ name: (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '"', x: r.x, y: r.y, w: r.width, h: r.height, col });
      el.dataset.cprobe = '1';
    }
    const st = document.createElement('style'); st.id = 'cprobe';
    st.textContent = '[data-cprobe], [data-cprobe] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; } .hud-status-label[data-cprobe] { background: none !important; }';
    document.head.appendChild(st);
    return out;
  });
  await sleep(300);
  const shot = await page.screenshot();
  await page.evaluate(() => { document.getElementById('cprobe').remove(); document.querySelectorAll('[data-cprobe]').forEach((e) => delete e.dataset.cprobe); });
  const p2 = await browser.newPage();
  const res = await p2.evaluate(async ([png, boxes]) => {
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + png; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    return boxes.map((b) => {
      const d = g.getImageData(Math.max(0, b.x | 0), Math.max(0, b.y | 0), Math.max(1, b.w | 0), Math.max(1, b.h | 0)).data;
      const ls = []; for (let i = 0; i < d.length; i += 16) ls.push(L(d[i], d[i + 1], d[i + 2]));
      ls.sort((a, z) => a - z);
      const m = b.col.match(/[\d.]+/g).map(Number); const lt = L(m[0], m[1], m[2]);
      const med = ls[ls.length >> 1];
      const worst = lt > med ? ls[Math.floor(ls.length * 0.95)] : ls[Math.floor(ls.length * 0.05)];
      const ratio = (Math.max(lt, worst) + 0.05) / (Math.min(lt, worst) + 0.05);
      return { name: b.name, ratio: Math.round(ratio * 100) / 100 };
    });
  }, [shot.toString('base64'), boxes]);
  await p2.close();
  return res;
}
async function tapTargets(page) {
  return page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll('a[href], button')) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!r.width || cs.visibility === 'hidden' || el.closest('.sr-only')) continue;
      let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      if (o < 0.5) continue;
      if (r.width < 44 || r.height < 44) small.push({ el: el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height) });
    }
    return small;
  });
}
async function imageDiff(browser, a, b) {
  const page = await browser.newPage();
  const d = await page.evaluate(async ([A, B]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(A), load(B)]);
    const w = 240, h = Math.round(240 * ia.height / ia.width);
    const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
    const pa = px(ia), pb = px(ib); let s = 0;
    for (let i = 0; i < pa.length; i += 4) s += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
    return s / (w * h * 3);
  }, [a.toString('base64'), b.toString('base64')]);
  await page.close();
  return Math.round(d * 10) / 10;
}

(async () => {
  const gl = await chromium.launch({ channel: 'chrome', headless: true, args: GL_ARGS });

  // ---------------------------------------------------------------- (a) bytes + (b) errors, 390x844 first load
  {
    const { ctx, page, log } = await newPage(gl, { w: 390, h: 844, mobile: true });
    await page.goto(BASE + '/?debug&tier=4', { waitUntil: 'load' });
    const mode = await waitReady(page);
    const firstBytes = log.bytes;
    await waitLate(page).catch(() => {});
    await settle(page, 3000);
    // pass the loader gate so anything lazy after it loads too
    const home = page.locator('.answer[data-answer="home"]');
    if (await home.isVisible()) await home.tap();
    await settle(page, 2500);
    const byType = {};
    for (const r of log.requests) {
      const u = new URL(r.url); const k = /three\.module/.test(u.pathname) ? 'three.module.min.js' : /draco/.test(u.pathname) ? 'draco decoder' : /\/vendor\/three-addons\//.test(u.pathname) ? 'three addons (loaders)' : /\.glb$/.test(u.pathname) ? u.pathname.split('/').pop() : /matcap/.test(u.pathname) ? 'matcaps' : /fonts\.(g|gstatic)/.test(u.host) ? 'fonts' : /hero/.test(u.pathname) ? 'hero stills' : /\/landing\//.test(u.pathname) ? 'landing js/css' : u.pathname === '/' ? 'index.html' : u.host + u.pathname;
      byType[k] = (byType[k] || 0) + r.bytes;
    }
    const kb = Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / 1024) + ' KB']));
    const missing = log.requests.filter((r) => r.status >= 400).map((r) => `${r.status} ${new URL(r.url).pathname}`);
    pass('a_bytes_under_3MB', log.bytes < 3 * 1024 * 1024, { totalKB: Math.round(log.bytes / 1024), firstInteractiveKB: Math.round(firstBytes / 1024), mode, breakdown: kb, missing });
    const jsErrors = log.errors.filter((e) => !/Failed to load resource/.test(e));
    pass('b_no_console_errors', jsErrors.length === 0, { jsErrors, notFound: log.errors.filter((e) => /Failed to load resource/.test(e)).length, missing });
    await ctx.close();
  }

  // ---------------------------------------------------------------- (c) scrub screenshots, desktop + phone
  const shots = {}; const contrast = []; let contrastMin = Infinity;
  for (const [tag, w, h, mobile] of [['desk', 1440, 900, false], ['phone', 390, 844, true]]) {
    const { ctx, page, log } = await newPage(gl, { w, h, mobile });
    await page.goto(BASE + '/?debug&tier=0', { waitUntil: 'load' });
    await waitReady(page);
    await settle(page, 2500);
    await waitLate(page);
    const buf0 = await page.screenshot({ path: path.join(OUT, `landing-${tag}-gate.png`) });
    if (tag === 'desk') shots.gate = buf0;
    const stops = tag === 'desk' ? [0, 0.045, 0.16, 0.3, 0.42, 0.6, 0.7, 0.83, 1.0] : [0, 0.16, 0.3, 0.42, 0.6, 0.83, 1.0];
    for (const p of stops) {
      await page.evaluate((v) => window.__dc.jump(v), p);
      await settle(page, 2200);
      const name = `landing-${tag}-p${String(Math.round(p * 1000)).padStart(4, '0')}.png`;
      const b = await page.screenshot({ path: path.join(OUT, name) });
      if (tag === 'desk' && [0, 0.3, 0.6, 1].includes(p)) shots[p] = b;
      if (p > 0) {
        const cr = await contrastProbe(page, gl);
        const low = cr.filter((r) => r.ratio < 4.5);
        contrast.push(...low.map((r) => ({ at: `${tag}@${p}`, ...r })));
        contrastMin = Math.min(contrastMin, ...cr.map((r) => r.ratio));
      }
    }
    const probe = await clipProbe(page);
    pass(`h_clip_probe_${tag}_cinematic`, probe.length === 0, { hits: probe });
    const small = await tapTargets(page);
    pass(`tap_targets_${tag}`, small.length === 0, { small });
    if (log.errors.filter((e) => !/Failed to load resource/.test(e)).length) pass(`b_errors_${tag}`, false, { errors: log.errors });
    await ctx.close();
  }
  pass('contrast_text_over_scene_4.5', contrast.length === 0, { minRatio: Math.round(contrastMin * 100) / 100, below: contrast });
  const pairs = [[0, 0.3], [0.3, 0.6], [0.6, 1], [0, 1]];
  const diffs = {};
  for (const [a, b] of pairs) diffs[`${a}-${b}`] = await imageDiff(gl, shots[a], shots[b]);
  pass('c_scrub_frames_differ', Object.values(diffs).every((d) => d > 8), { meanAbsDiff: diffs });

  // ---------------------------------------------------------------- (d) fps at 390x844, auto tiering
  {
    const { ctx, page } = await newPage(gl, { w: 390, h: 844, mobile: true });
    await page.goto(BASE + '/?debug', { waitUntil: 'load' });
    await waitReady(page);
    await settle(page, 2000);
    const home = page.locator('.answer[data-answer="home"]');
    if (await home.isVisible()) await home.tap();
    await waitLate(page).catch(() => {});
    await page.evaluate(() => window.__dc && window.__dc.jump(0.3));
    const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r(n / ((performance.now() - t) / 1000)); }; requestAnimationFrame(f); }));
    await settle(page, 60000); // let the tier manager react (SwiftShader runs at a few fps)
    const st = await page.evaluate(() => ({ mode: document.documentElement.classList.contains('static') ? 'static' : 'webgl', fallback: document.documentElement.dataset.fallback || null, tier: window.__dc ? window.__dc.tier : null, perf: window.__dc ? window.__dc.perf : null }));
    const renderer = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
    pass('d_fps_390x844_swiftshader', true, { fpsFirst3s: Math.round(fps * 10) / 10, ...st, renderer, note: 'SwiftShader is CPU rendering; not a phone GPU' });
    await ctx.close();
  }
  await gl.close();

  // ---------------------------------------------------------------- (e) WebGL disabled -> still + CTA
  {
    const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
    for (const [tag, w, h, mobile] of [['desk', 1440, 900, false], ['phone', 390, 844, true]]) {
      const { ctx, page, log } = await newPage(b, { w, h, mobile });
      await page.goto(BASE + '/', { waitUntil: 'load' });
      const mode = await waitReady(page);
      await settle(page, 800);
      await page.screenshot({ path: path.join(OUT, `landing-nowebgl-${tag}.png`), fullPage: true });
      const st = await page.evaluate(() => {
        const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20 && getComputedStyle(e).visibility !== 'hidden'; };
        const img = document.querySelector('#still img');
        return { still: vis('#still'), stillImg: img && img.complete && img.naturalWidth > 0 ? img.currentSrc.split('/').pop() : 'missing (gradient shown)', cta: vis('.pill-cta'), hold: vis('.hold-final'), demo: vis('.demo-link'), h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()) };
      });
      pass(`e_no_webgl_${tag}`, mode.startsWith('static') && st.still && st.cta && st.hold && st.h2.length === 5, { mode, ...st });
      const probe = await clipProbe(page);
      pass(`h_clip_probe_${tag}_static`, probe.length === 0, { hits: probe });
      await ctx.close();
    }
    await b.close();
  }

  // ---------------------------------------------------------------- (f) reduced motion, (g) hold gate
  {
    const b = await chromium.launch({ channel: 'chrome', headless: true, args: GL_ARGS });
    {
      const { ctx, page } = await newPage(b, { w: 390, h: 844, mobile: true, reduced: true });
      await page.goto(BASE + '/', { waitUntil: 'load' });
      const mode = await waitReady(page);
      await settle(page, 800);
      await page.screenshot({ path: path.join(OUT, 'landing-reduced-phone.png'), fullPage: true });
      const st = await page.evaluate(() => ({ canvasShown: getComputedStyle(document.querySelector('#gl')).display !== 'none', h2: [...document.querySelectorAll('h2')].filter((h) => h.getBoundingClientRect().height > 20).length, amount: document.querySelector('.card-accent .card-v').textContent }));
      pass('f_reduced_motion', mode.startsWith('static') && !st.canvasShown && st.h2 === 5, { mode, ...st });
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
      await page.goto(BASE + '/?debug&tier=3', { waitUntil: 'load' });
      await waitReady(page); await waitLate(page); await settle(page, 1500);
      await page.evaluate(() => window.__dc.jump(1)); await settle(page, 1500);
      const btn = page.locator('.hold-final');
      const box = await btn.boundingBox();
      // early release rewinds
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await sleep(350); await page.mouse.up(); await sleep(900);
      const rewound = await page.evaluate(() => ({ url: location.href, off: +getComputedStyle(document.querySelector('.hold-final .hold-fill')).strokeDashoffset.replace('px', '') }));
      pass('g_early_release_rewinds', !/#\/create/.test(rewound.url) && rewound.off > 270, rewound);
      await page.mouse.down(); await sleep(1300); await page.mouse.up();
      await page.waitForURL(/\/app\/#\/create/, { timeout: 5000 }).catch(() => {});
      pass('g_hold_navigates_pointer', /\/app\/#\/create/.test(page.url()), { url: page.url() });
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage(b, { w: 1440, h: 900 });
      await page.goto(BASE + '/?debug&tier=3', { waitUntil: 'load' });
      await waitReady(page); await waitLate(page); await settle(page, 1500);
      // keyboard only: Tab order starts with the skip link, then hold Enter on the final gate
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => document.activeElement.textContent.trim());
      pass('skip_link_first_in_tab_order', /Skip to the app/.test(first), { first });
      await page.focus('.hold-final'); await settle(page, 1200);
      await page.keyboard.down('Enter'); await sleep(1300); await page.keyboard.up('Enter');
      await page.waitForURL(/\/app\/#\/create/, { timeout: 5000 }).catch(() => {});
      pass('g_hold_navigates_keyboard', /\/app\/#\/create/.test(page.url()), { url: page.url() });
      await ctx.close();
    }
    await b.close();
  }

  fs.writeFileSync(path.join(OUT, 'landing-results.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results.checks).filter(([, v]) => !v.ok).map(([k]) => k);
  console.log(failed.length ? `\n${failed.length} FAILED: ${failed.join(', ')}` : '\nALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
