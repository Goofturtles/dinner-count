// Press-and-hold gate on a real <button>. Pointer or Enter/Space held for `ms` completes it;
// releasing early rewinds the ring. A click with no hold behind it (screen readers, switch access)
// completes at once, so the hold is never the only way through.
const C = 2 * Math.PI * 44; // ring circumference (svg r = 44)

export function makeHold(btn, { ms = 900, onProgress = () => {}, onDone = () => {}, tapAfter = Infinity, tapLabel = '' } = {}) {
  const fill = btn.querySelector('.hold-fill');
  const label = btn.querySelector('.hold-label');
  let v = 0, holding = false, done = false, fails = 0, tapMode = false, raf = 0, last = 0, lastInput = -1e9, enabled = true;

  const draw = () => { fill.style.strokeDashoffset = String(C * (1 - v)); onProgress(v); };
  // Progress follows wall time, so slow frames never stretch (or cheat) the hold.
  const advance = (now) => {
    const dt = Math.min(1, Math.max(0, (now - last) / 1000)); last = now;
    if (holding) v = Math.min(1, v + dt * 1000 / ms);
    else v = Math.max(0, v - dt * 2500 / ms);
  };
  const tick = (now) => {
    advance(now);
    draw();
    if (holding && v >= 1) return complete();
    if (holding || v > 0) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
  const loop = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  function start() {
    if (done || !enabled) return;
    lastInput = performance.now();
    if (tapMode) return complete();
    holding = true; btn.classList.add('is-holding'); loop();
  }
  function release() {
    if (!holding) return;
    advance(performance.now());               // count the time since the last frame before letting go
    if (v >= 1) return complete();
    holding = false; btn.classList.remove('is-holding');
    lastInput = performance.now();
    if (!done && v < 1 && ++fails >= tapAfter && !tapMode) {
      tapMode = true;
      if (label && tapLabel) label.innerHTML = tapLabel;
    }
    loop();
  }
  function complete() {
    if (done) return;
    done = true; holding = false; v = 1; draw();
    cancelAnimationFrame(raf); raf = 0;
    btn.classList.remove('is-holding'); btn.classList.add('is-done');
    onDone();
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    start();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) start();
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    release();
  });
  btn.addEventListener('click', (e) => {
    // A real pointer or key hold already handled this press. A bare click means assistive tech.
    if (performance.now() - lastInput < 1200) return;
    e.preventDefault();
    if (enabled) complete();
  });

  return {
    el: btn,
    keyStart: start, keyEnd: release, complete,
    get done() { return done; },
    get value() { return v; },
    set enabled(on) { enabled = on; if (!on) release(); },
    reset() { done = false; v = 0; fails = 0; holding = false; btn.classList.remove('is-done', 'is-holding'); draw(); },
  };
}
