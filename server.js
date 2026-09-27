'use strict';
const path = require('path');
const express = require('express');
const { createStore } = require('./src/store');
const { createApi } = require('./src/api');

const PORT = Number(process.env.PORT) || 3538;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 3); // Render: the client IP is 3 hops into X-Forwarded-For

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    'X-Frame-Options': 'DENY',
  });
  next();
});

async function main() {
  // On Render, never fall back to memory storage or throwaway push keys: both silently lose data.
  if (process.env.RENDER) {
    const missing = ['DATABASE_URL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'TICK_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) throw new Error('Missing env vars: ' + missing.join(', '));
  }
  const store = createStore();
  await store.init();
  const { router, runTick } = createApi({ store });

  app.use('/api', express.json({ limit: '10kb' }), router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // three.js for the landing page, pinned in package.json and served from node_modules (no build step, no CDN).
  const threeDir = path.join(__dirname, 'node_modules', 'three');
  app.use('/vendor/three', express.static(path.join(threeDir, 'build'), { maxAge: '30d', immutable: true }));
  app.use('/vendor/three-addons', express.static(path.join(threeDir, 'examples', 'jsm'), { maxAge: '30d', immutable: true }));

  const pub = path.join(__dirname, 'public');
  // Dev only: wipe this origin's HTTP cache (e.g. a cached redirect) in a local browser.
  if (process.env.NODE_ENV !== 'production') app.get('/__clear', (req, res) => res.set('Clear-Site-Data', '"cache"').redirect(302, '/'));
  app.get('/app/sw.js', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/app/' });
    res.sendFile(path.join(pub, 'app', 'sw.js'));
  });
  app.use(express.static(pub, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  app.listen(PORT, () => console.log(`Dinner Count on http://localhost:${PORT} (store: ${store.kind})`));

  // Backup trigger while awake. The primary trigger is an external pinger on POST /api/tick.
  setInterval(() => runTick().catch((e) => console.error('tick', e)), 60 * 1000).unref();
}

main().catch((e) => { console.error(e); process.exit(1); });
