// End-to-end verification for Dinner Count (spec section 9).
//   BASE=https://dinner-count.onrender.com TICK_SECRET=... node tools/verify_app.cjs
// Defaults to http://localhost:3538. Headless Chrome, phone-sized contexts with touch. Screenshots → tools/out/.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE || 'http://localhost:3538').replace(/\/$/, '');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const skip = (name, why) => { results.push({ name, pass: null, detail: why }); console.log(`SKIP  ${name}  — ${why}`); };
const api = async (method, p, body, auth) => {
  const r = await fetch(BASE + '/api' + p, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}), ...(p === '/tick' && process.env.TICK_SECRET ? { 'x-tick-secret': process.env.TICK_SECRET } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// Runs inside the page: clipping, tap targets, contrast, semantics.
function probe() {
  const issues = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.name || el.tagName).trim().slice(0, 40);
  // 1. Vertical clipping (overflow hidden and content taller than box), excluding line-clamp.
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (!vis(el) || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) continue;
    if ((cs.overflowY === 'hidden' || cs.overflow === 'hidden') && el.scrollHeight > el.clientHeight + 1 && !el.classList.contains('sr')) issues.push(`clipped: ${el.tagName}.${el.className} "${label(el)}"`);
  }
  // 2. Tap targets ≥ 44px.
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), summary, select')) {
    if (!vis(el) || el.closest('.sr')) continue;
    const r = el.getBoundingClientRect();
    const h = el.type === 'checkbox' ? (el.closest('label') || el).getBoundingClientRect().height : r.height;
    if (h < 44 || (r.width < 44 && el.type !== 'checkbox')) issues.push(`small tap target ${Math.round(r.width)}x${Math.round(h)}: ${el.tagName} "${label(el)}"`);
  }
  // 3. Clickable things must be real buttons/links.
  for (const el of document.querySelectorAll('[data-action]')) if (!/^(BUTTON|A|INPUT)$/.test(el.tagName)) issues.push(`non-button action: ${el.tagName} "${label(el)}"`);
  // 4. Contrast ≥ 4.5:1 for text (3:1 for ≥ 24px or ≥ 18.66px bold).
  const rgb = (s) => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 1]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if ((c[3] ?? 1) > 0.9) return c; } return [255, 255, 255]; };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('.sr')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color), bg = bgOf(el);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const key = cs.color + '|' + bg.join(',');
    if (ratio < need && !seen.has(key)) { seen.add(key); issues.push(`contrast ${ratio.toFixed(2)} < ${need}: "${label(el)}"`); }
  }
  // 5. Zoom not disabled.
  const vp = document.querySelector('meta[name=viewport]');
  if (vp && /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(vp.content)) issues.push('viewport disables zoom');
  // 6. No horizontal scroll.
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push(`horizontal scroll ${document.documentElement.scrollWidth}px`);
  return issues;
}

async function audit(page, name) {
  await page.waitForTimeout(300);
  const issues = await page.evaluate(probe);
  ok(`a11y/mobile: ${name}`, issues.length === 0, issues.slice(0, 6).join(' | '));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
const amountOf = async (page) => (await page.locator('.amount-hero .big').textContent()).trim();

(async () => {
  console.log(`Verifying ${BASE}\n`);
  // 1. Unit tests (portion math, factor, clamps, cold start, none-holds-steady, DST).
  try { execSync('node --test', { cwd: path.join(__dirname, '..'), stdio: 'pipe' }); ok('unit tests (node --test)', true); }
  catch (e) { ok('unit tests (node --test)', false, String(e.stdout).split('\n').filter((l) => /fail|✖/.test(l)).slice(0, 3).join(' ')); }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const cookCtx = await browser.newContext(PHONE), kidCtx = await browser.newContext(PHONE);
  const cook = await cookCtx.newPage(), kid = await kidCtx.newPage();
  const errors = [];
  for (const p of [cook, kid]) p.on('pageerror', (e) => errors.push(e.message));

  // Screens before joining.
  await cook.goto(BASE + '/app/');
  await audit(cook, '01-start');
  await cook.click('text=Start a family');
  await audit(cook, '02-create');

  // 2. Two-phone flow: create, ask to join, let in, pick pasta, kid taps Out → amount drops.
  await cook.fill('input[name=familyName]', 'Verify Family');
  await cook.fill('input[name=name]', 'Mom');
  await cook.click('button[type=submit]');
  await cook.waitForSelector('text=Family code');
  const code = (await cook.locator('.display').first().textContent()).trim();
  ok('create family shows a code', /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code), code.replace(/\w/g, '•'));
  await audit(cook, '03-family');
  const cookAuth = await cook.evaluate(() => JSON.parse(localStorage.getItem('dc:auth')));

  await kid.goto(BASE + '/app/#/join');
  await kid.fill('input[name=code]', 'WRONGCOD');
  await kid.fill('input[name=name]', 'Leo');
  await kid.click('button[type=submit]');
  await kid.waitForTimeout(800);
  ok('bad code shows a plain error', /No family with that code|8 letters/.test(await kid.locator('.error').textContent()));
  await audit(kid, '04-join-error');
  await kid.fill('input[name=code]', code.toLowerCase());
  await kid.click('button[type=submit]');
  await kid.waitForSelector('text=Waiting to be let in');
  await audit(kid, '05-pending');

  await cook.reload();
  await cook.waitForSelector('text=asked to join');
  await cook.click('text=Let in');
  await kid.waitForSelector('text=Home for dinner?', { timeout: 15000 });
  ok('join needs approval, then lets in', true);
  await audit(kid, '06-today-nobody-answered');
  ok('empty state: nobody answered counts as Home', /haven't answered|No answer yet/.test(await kid.locator('main').textContent()));

  await cook.goto(BASE + '/app/#/cook');
  await cook.click('.dish:has-text("Pasta")');
  await cook.waitForSelector('.amount-hero .big');
  const before = await amountOf(cook);
  const live = await cook.locator('.amount-hero').getAttribute('aria-live');
  ok('amount has aria-live', live === 'polite');
  await cook.screenshot({ path: path.join(OUT, '07-cook-before.png') });
  await kid.click('button.answer:has-text("Out")');
  await cook.waitForFunction((b) => document.querySelector('.amount-hero .big')?.textContent.trim() !== b, before, { timeout: 12000 }).catch(() => {});
  const after = await amountOf(cook);
  ok('kid taps Out → cook amount drops (live, no reload)', Number(after) < Number(before), `${before} g → ${after} g`);
  await cook.screenshot({ path: path.join(OUT, '08-cook-after.png') });
  await audit(cook, '09-cook');

  // 3. Learning on the live system: "a lot" left lowers the next amount and shows why.
  await cook.click('.leftovers button:has-text("A lot")');
  await cook.waitForSelector('text=Next time');
  const learnt = await cook.locator('text=Next time').textContent();
  ok('"a lot" left → next time is less', /Next time .* will be \*?\d+/.test(learnt) && Number(learnt.match(/(\d+) g/)[1]) < Number(after), learnt.trim());
  const s = (await api('GET', '/state', null, cookAuth)).body;
  ok('factor stays inside clamps', s.amounts.pasta.factor >= 0.6 && s.amounts.pasta.factor <= 1.5, `factor ${s.amounts.pasta.factor}`);
  await audit(cook, '10-cook-reported');

  // 7. Access control: family code alone gets nothing.
  const raw = code.replace('-', '');
  const denied = [];
  for (const [m, p] of [['GET', '/state'], ['POST', '/answer'], ['POST', '/cook'], ['POST', '/leftover'], ['POST', '/claim'], ['POST', '/settings'], ['POST', '/subscribe'], ['POST', '/notify-now'], ['POST', '/leave']]) {
    const r = await api(m, p, m === 'GET' ? null : { answer: 'out', dish: 'rice' }, `${raw}.guess.guess`);
    const r2 = await api(m, p, m === 'GET' ? null : { answer: 'out' });
    if (r.status !== 401 || r2.status !== 401) denied.push(`${m} ${p} → ${r.status}/${r2.status}`);
  }
  ok('code without member token: every read/write refused', denied.length === 0, denied.join(', '));

  // 5. Push trigger: idempotent per family per day.
  if (process.env.TICK_SECRET) {
    const t1 = await api('POST', '/tick'), t2 = await api('POST', '/tick');
    ok('tick is safe to repeat', t1.status === 200 && t2.status === 200 && t2.body.sent === 0, JSON.stringify([t1.body, t2.body]));
    ok('tick refuses a bad secret', (await fetch(BASE + '/api/tick', { method: 'POST', headers: { 'x-tick-secret': 'nope' } })).status === 401);
  } else skip('tick idempotency', 'set TICK_SECRET to test');

  // 4. Leftover claim, in the sandbox (it has last night's chili with a bowl left).
  const demo = await (await browser.newContext(PHONE)).newPage();
  demo.on('pageerror', (e) => errors.push(e.message));
  await demo.goto(BASE + '/app/#demo');
  await demo.waitForSelector('.amount-hero');
  await audit(demo, '11-sandbox-cook');
  await demo.click('#tabs a[data-tab=today]');
  await demo.waitForSelector('text=in the fridge');
  await audit(demo, '12-sandbox-today-claim');
  await demo.click("text=I'll take it");
  await demo.waitForSelector("text=You're taking it");
  ok('leftover claim: one tap assigns it', true);
  await demo.click('#tabs a[data-tab=cook]');
  await demo.click('.dish:has-text("Rice")');
  const r0 = await amountOf(demo);
  await demo.click('#tabs a[data-tab=today]');
  await demo.click('.chip[aria-label^="Leo"]');   // home → plate
  await demo.click('.chip[aria-label^="Leo"]');   // plate → out
  await demo.click('#tabs a[data-tab=cook]');
  const r1 = await amountOf(demo);
  ok('sandbox: answering for the pretend family moves the amount', Number(r1) < Number(r0), `${r0} → ${r1}`);
  await demo.click('#tabs a[data-tab=family]');
  await audit(demo, '13-sandbox-family');

  // 9. Offline: the banner shows and the last answers stay on screen.
  await kidCtx.setOffline(true);
  await kid.evaluate(() => dispatchEvent(new Event('visibilitychange')));
  await kid.waitForTimeout(6000);
  ok('offline: banner shows, last answers stay', await kid.locator('#offline').isVisible() && /Home for dinner/.test(await kid.locator('main').textContent()));
  await kid.screenshot({ path: path.join(OUT, '14-offline.png') });
  await kidCtx.setOffline(false);

  // Leave deletes; last one out deletes the family.
  kid.on('dialog', (d) => d.accept()); cook.on('dialog', (d) => d.accept());
  await kid.goto(BASE + '/app/#/family'); await kid.click('text=Leave family'); await kid.waitForSelector('text=Start a family');
  await cook.goto(BASE + '/app/#/family'); await cook.click('text=Leave family'); await cook.waitForSelector('text=Start a family');
  ok('leave family deletes the member (token stops working)', (await api('GET', '/state', null, cookAuth)).status === 401);

  // iOS Safari (not installed): install instructions, no reminder button.
  const ios = await (await browser.newContext({ ...PHONE, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' })).newPage();
  await ios.goto(BASE + '/app/');
  ok('iOS Safari: tells you to add to Home Screen first', await ios.locator('text=add it to your Home Screen first').isVisible());
  await ios.click('text=Show me how');
  await audit(ios, '15-ios-install');

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();

  const failed = results.filter((r) => r.pass === false);
  console.log(`\n${results.filter((r) => r.pass).length} passed, ${failed.length} failed, ${results.filter((r) => r.pass === null).length} skipped. Screenshots in tools/out/`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ base: BASE, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
