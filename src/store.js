'use strict';
// Key/value store with the spec's key shapes (fam:, sub:, day:, dish:) and per-key TTL.
// Postgres (Neon) when DATABASE_URL is set; in-memory otherwise (local dev + tests only).
// Writes to one key are serialised in-process so two taps at once can't lose an answer.

function withLocks() {
  const chains = new Map();
  return (key, fn) => {
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
    return run;
  };
}

function memoryStore() {
  const m = new Map(); // key -> { v, exp }
  const live = (e) => e && (!e.exp || e.exp > Date.now());
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  return {
    kind: 'memory',
    async init() {},
    async get(k) { const e = m.get(k); return live(e) ? clone(e.v) : null; },
    async set(k, v, ttlSec) { m.set(k, { v: clone(v), exp: ttlSec ? Date.now() + ttlSec * 1000 : null }); },
    async del(k) { m.delete(k); },
    async delPrefix(p) { for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k); },
    async list(p) { const out = []; for (const [k, e] of m) if (k.startsWith(p) && live(e)) out.push({ k, v: clone(e.v) }); return out; },
    async sweep() { for (const [k, e] of m) if (!live(e)) m.delete(k); },
    async close() {},
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000 });
  // Neon drops idle connections; without this listener pg-pool's 'error' event crashes the process.
  pool.on('error', (e) => console.warn('pg pool:', e.message));
  const likePrefix = (p) => p.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS dinner_count_kv (
        k text PRIMARY KEY, v jsonb NOT NULL, exp timestamptz)`);
    },
    async get(k) {
      const r = await pool.query('SELECT v FROM dinner_count_kv WHERE k=$1 AND (exp IS NULL OR exp > now())', [k]);
      return r.rows[0] ? r.rows[0].v : null;
    },
    async set(k, v, ttlSec) {
      await pool.query(`INSERT INTO dinner_count_kv (k, v, exp) VALUES ($1, $2, $3)
        ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, exp = EXCLUDED.exp`,
        [k, JSON.stringify(v), ttlSec ? new Date(Date.now() + ttlSec * 1000) : null]);
    },
    async del(k) { await pool.query('DELETE FROM dinner_count_kv WHERE k=$1', [k]); },
    async delPrefix(p) { await pool.query("DELETE FROM dinner_count_kv WHERE k LIKE $1 ESCAPE '\\'", [likePrefix(p)]); },
    async list(p) {
      const r = await pool.query("SELECT k, v FROM dinner_count_kv WHERE k LIKE $1 ESCAPE '\\' AND (exp IS NULL OR exp > now())", [likePrefix(p)]);
      return r.rows.map((x) => ({ k: x.k, v: x.v }));
    },
    async sweep() { await pool.query('DELETE FROM dinner_count_kv WHERE exp IS NOT NULL AND exp <= now()'); },
    async close() { await pool.end(); },
  };
}

function createStore(url = process.env.DATABASE_URL) {
  const s = url ? pgStore(url) : memoryStore();
  const lock = withLocks();
  // Read-modify-write one key under its lock. fn(current) returns the next value (or undefined to leave it).
  s.update = (k, fn, ttlSec) => lock(k, async () => {
    const cur = await s.get(k);
    const next = await fn(cur);
    if (next !== undefined) await s.set(k, next, ttlSec);
    return next === undefined ? cur : next;
  });
  return s;
}

module.exports = { createStore };
