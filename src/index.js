/**
 * Cute To-Do — Worker API
 *
 * One account, one board, stored in D1 so every device sees the same data.
 *
 * Auth model:
 *   - The password is never stored. APP_PASSWORD_HASH holds a PBKDF2-SHA256
 *     verifier ("pbkdf2$<iterations>$<salt_b64>$<hash_b64>"), produced by
 *     scripts/hash-password.mjs.
 *   - A successful login returns an HMAC-signed session cookie. The signing
 *     key is derived from APP_PASSWORD_HASH, so changing the password
 *     invalidates every existing session for free.
 *   - The static HTML is public (it is just a shell); every byte of actual
 *     board data goes through the authenticated endpoints below.
 */

const MAX_GOALS = 4;
const MAX_SYSTEMS = 4;
const MAX_TASKS = 4;

const SESSION_COOKIE = 'todo_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const MAX_NAME = 80;
const MAX_TITLE = 90;
const MAX_DOD = 110;

/* ------------------------------------------------------------------ utils */

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Length-independent equality, so timing does not leak the secret. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function newId() {
  return crypto.randomUUID();
}

function clean(value, max) {
  if (typeof value !== 'string') return '';
  // Strip control characters; they have no business in a task title and
  // would render as invisible junk.
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

/* ------------------------------------------------------------------- auth */

async function verifyPassword(password, verifier) {
  // "pbkdf2$<iterations>$<salt_b64>$<hash_b64>"
  const parts = String(verifier || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  let salt, expected;
  try {
    salt = b64ToBytes(parts[2]);
    expected = b64ToBytes(parts[3]);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

async function signingKey(env) {
  // Derived from the password verifier: rotating the password kills sessions.
  return crypto.subtle.importKey(
    'raw',
    enc.encode('session:' + env.APP_PASSWORD_HASH),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function issueSession(env) {
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })));
  const sig = await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(payload));
  return payload + '.' + b64urlEncode(sig);
}

async function sessionValid(env, token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let sigBytes;
  try {
    sigBytes = b64urlDecode(sig);
  } catch {
    return false;
  }

  const ok = await crypto.subtle.verify('HMAC', await signingKey(env), sigBytes, enc.encode(payload));
  if (!ok) return false;

  try {
    const { exp } = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function cookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * SameSite=Lax already blocks cross-site form posts, but an explicit Origin
 * check costs nothing and covers the state-changing verbs directly.
 */
function originAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches may omit it
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ board */

async function loadBoard(db) {
  const [goals, systems, tasks, prefs] = await db.batch([
    db.prepare('SELECT id, name, position FROM goals ORDER BY position, created_at'),
    db.prepare('SELECT id, goal_id, name, position FROM systems ORDER BY position, created_at'),
    db.prepare('SELECT id, system_id, title, dod, done, position FROM tasks ORDER BY position, created_at'),
    db.prepare("SELECT value FROM prefs WHERE id = 'ui'")
  ]);

  const tasksBySystem = new Map();
  for (const t of tasks.results) {
    if (!tasksBySystem.has(t.system_id)) tasksBySystem.set(t.system_id, []);
    tasksBySystem.get(t.system_id).push({
      id: t.id, title: t.title, dod: t.dod, done: !!t.done
    });
  }

  const systemsByGoal = new Map();
  for (const s of systems.results) {
    if (!systemsByGoal.has(s.goal_id)) systemsByGoal.set(s.goal_id, []);
    systemsByGoal.get(s.goal_id).push({
      id: s.id, name: s.name, tasks: tasksBySystem.get(s.id) || []
    });
  }

  let ui = {};
  const raw = prefs.results[0] && prefs.results[0].value;
  if (raw) { try { ui = JSON.parse(raw); } catch { ui = {}; } }

  return {
    goals: goals.results.map(g => ({
      id: g.id, name: g.name, systems: systemsByGoal.get(g.id) || []
    })),
    ui: { sel: Number.isInteger(ui.sel) ? ui.sel : 0, open: Array.isArray(ui.open) ? ui.open : [] }
  };
}

async function countRows(db, sql, ...binds) {
  const row = await db.prepare(sql).bind(...binds).first();
  return row ? row.n : 0;
}

/* ----------------------------------------------------------------- routes */

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (!env.APP_PASSWORD_HASH) {
    return json({ error: 'Server is not configured yet. Set the APP_PASSWORD_HASH secret.' }, 503);
  }
  if (!env.DB) {
    return json({ error: 'Server is not configured yet. Bind a D1 database as DB.' }, 503);
  }

  if (method !== 'GET' && !originAllowed(request)) {
    return json({ error: 'Bad origin.' }, 403);
  }

  /* --- unauthenticated --- */

  if (path === '/api/login' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Expected JSON.' }, 400); }
    const ok = await verifyPassword(String(body && body.password || ''), env.APP_PASSWORD_HASH);
    if (!ok) {
      // PBKDF2 already makes each attempt expensive; this widens the gap a
      // little more without being noticeable on a real login.
      await new Promise(r => setTimeout(r, 250));
      return json({ error: 'That password does not match.' }, 401);
    }
    return json({ ok: true }, 200, {
      'set-cookie': cookieHeader(await issueSession(env), SESSION_TTL_SECONDS)
    });
  }

  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
  }

  const authed = await sessionValid(env, readCookie(request, SESSION_COOKIE));

  if (path === '/api/session' && method === 'GET') {
    return json({ authed });
  }

  if (!authed) return json({ error: 'Not signed in.' }, 401);

  /* --- authenticated --- */

  const db = env.DB;
  const ok = async () => json(await loadBoard(db));

  if (path === '/api/board' && method === 'GET') return ok();

  let body = null;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    try { body = await request.json(); } catch { return json({ error: 'Expected JSON.' }, 400); }
  }

  // --- goals ---
  if (path === '/api/goals' && method === 'POST') {
    const n = await countRows(db, 'SELECT COUNT(*) AS n FROM goals');
    if (n >= MAX_GOALS) return json({ error: `You can have at most ${MAX_GOALS} goals.` }, 409);
    const name = clean(body && body.name, MAX_NAME) || 'New goal';
    await db.prepare('INSERT INTO goals (id, name, position, created_at) VALUES (?, ?, ?, ?)')
      .bind(newId(), name, n, Date.now()).run();
    return ok();
  }

  let m;
  if ((m = path.match(/^\/api\/goals\/([\w-]+)$/))) {
    if (method === 'PATCH') {
      const name = clean(body && body.name, MAX_NAME);
      if (!name) return json({ error: 'A goal needs a name.' }, 400);
      const r = await db.prepare('UPDATE goals SET name = ? WHERE id = ?').bind(name, m[1]).run();
      if (!r.meta.changes) return json({ error: 'That goal no longer exists.' }, 404);
      return ok();
    }
    if (method === 'DELETE') {
      // Explicit child deletes: D1 does not guarantee FK cascade is on.
      await db.batch([
        db.prepare('DELETE FROM tasks WHERE system_id IN (SELECT id FROM systems WHERE goal_id = ?)').bind(m[1]),
        db.prepare('DELETE FROM systems WHERE goal_id = ?').bind(m[1]),
        db.prepare('DELETE FROM goals WHERE id = ?').bind(m[1])
      ]);
      return ok();
    }
  }

  // --- systems ---
  if ((m = path.match(/^\/api\/goals\/([\w-]+)\/systems$/)) && method === 'POST') {
    const goal = await db.prepare('SELECT id FROM goals WHERE id = ?').bind(m[1]).first();
    if (!goal) return json({ error: 'That goal no longer exists.' }, 404);
    const n = await countRows(db, 'SELECT COUNT(*) AS n FROM systems WHERE goal_id = ?', m[1]);
    if (n >= MAX_SYSTEMS) return json({ error: `A goal can hold at most ${MAX_SYSTEMS} systems.` }, 409);
    const name = clean(body && body.name, MAX_NAME) || 'New system';
    await db.prepare('INSERT INTO systems (id, goal_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(newId(), m[1], name, n, Date.now()).run();
    return ok();
  }

  if ((m = path.match(/^\/api\/systems\/([\w-]+)$/))) {
    if (method === 'PATCH') {
      const name = clean(body && body.name, MAX_NAME);
      if (!name) return json({ error: 'A system needs a name.' }, 400);
      const r = await db.prepare('UPDATE systems SET name = ? WHERE id = ?').bind(name, m[1]).run();
      if (!r.meta.changes) return json({ error: 'That system no longer exists.' }, 404);
      return ok();
    }
    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM tasks WHERE system_id = ?').bind(m[1]),
        db.prepare('DELETE FROM systems WHERE id = ?').bind(m[1])
      ]);
      return ok();
    }
  }

  // --- tasks ---
  if ((m = path.match(/^\/api\/systems\/([\w-]+)\/tasks$/)) && method === 'POST') {
    const sys = await db.prepare('SELECT id FROM systems WHERE id = ?').bind(m[1]).first();
    if (!sys) return json({ error: 'That system no longer exists.' }, 404);
    const n = await countRows(db, 'SELECT COUNT(*) AS n FROM tasks WHERE system_id = ?', m[1]);
    if (n >= MAX_TASKS) return json({ error: `A system can hold at most ${MAX_TASKS} tasks.` }, 409);
    const title = clean(body && body.title, MAX_TITLE);
    if (!title) return json({ error: 'A task needs a title.' }, 400);
    await db.prepare('INSERT INTO tasks (id, system_id, title, dod, done, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .bind(newId(), m[1], title, clean(body && body.dod, MAX_DOD), n, Date.now()).run();
    return ok();
  }

  if ((m = path.match(/^\/api\/tasks\/([\w-]+)$/))) {
    if (method === 'PATCH') {
      const sets = [], binds = [];
      if (body && typeof body.title === 'string') {
        const title = clean(body.title, MAX_TITLE);
        if (!title) return json({ error: 'A task needs a title.' }, 400);
        sets.push('title = ?'); binds.push(title);
      }
      if (body && typeof body.dod === 'string') {
        sets.push('dod = ?'); binds.push(clean(body.dod, MAX_DOD));
      }
      if (body && typeof body.done === 'boolean') {
        sets.push('done = ?'); binds.push(body.done ? 1 : 0);
      }
      if (!sets.length) return json({ error: 'Nothing to change.' }, 400);
      binds.push(m[1]);
      const r = await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
      if (!r.meta.changes) return json({ error: 'That task no longer exists.' }, 404);
      return ok();
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM tasks WHERE id = ?').bind(m[1]).run();
      return ok();
    }
  }

  // --- per-account UI state (open tab, expanded systems) ---
  if (path === '/api/ui' && method === 'PUT') {
    const value = JSON.stringify({
      sel: Number.isInteger(body && body.sel) ? body.sel : 0,
      open: Array.isArray(body && body.open) ? body.open.filter(x => typeof x === 'string').slice(0, 64) : []
    });
    await db.prepare("INSERT INTO prefs (id, value) VALUES ('ui', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
      .bind(value).run();
    return json({ ok: true });
  }

  // --- one-time import of a board saved in a browser before sync existed ---
  if (path === '/api/import' && method === 'POST') {
    const existing = await countRows(db, 'SELECT COUNT(*) AS n FROM goals');
    if (existing > 0) return json({ error: 'The board already has goals; import would overwrite them.' }, 409);

    const goals = Array.isArray(body && body.goals) ? body.goals.slice(0, MAX_GOALS) : [];
    const stmts = [];
    const now = Date.now();
    goals.forEach((g, gi) => {
      const goalId = newId();
      stmts.push(db.prepare('INSERT INTO goals (id, name, position, created_at) VALUES (?, ?, ?, ?)')
        .bind(goalId, clean(g && g.name, MAX_NAME) || 'Untitled goal', gi, now));
      const systems = Array.isArray(g && g.systems) ? g.systems.slice(0, MAX_SYSTEMS) : [];
      systems.forEach((s, si) => {
        const sysId = newId();
        stmts.push(db.prepare('INSERT INTO systems (id, goal_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(sysId, goalId, clean(s && s.name, MAX_NAME) || 'Untitled system', si, now));
        const tasks = Array.isArray(s && s.tasks) ? s.tasks.slice(0, MAX_TASKS) : [];
        tasks.forEach((t, ti) => {
          const title = clean(t && t.title, MAX_TITLE);
          if (!title) return;
          stmts.push(db.prepare('INSERT INTO tasks (id, system_id, title, dod, done, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(newId(), sysId, title, clean(t && t.dod, MAX_DOD), t && t.done ? 1 : 0, ti, now));
        });
      });
    });
    if (stmts.length) await db.batch(stmts);
    return ok();
  }

  return json({ error: 'No such endpoint.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error('API error', err && err.stack || err);
        return json({ error: 'Something went wrong saving that. Try again.' }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
