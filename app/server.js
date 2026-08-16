'use strict';
/*
 * doda - personlig GTD-opgave- og noteapp.
 *
 * Ren Node: node:http + node:sqlite + node:crypto. Ingen npm-pakker.
 * Det er ikke sparsommelighed - det er sikkerhedsvalget: uden afhaengigheder
 * findes der ingen transitiv forsyningskaede at holde patchet. Se DESIGN.md §5.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const BIND_PORT = Number(process.env.BIND_PORT || process.env.PORT_web || 3000);
const APP_NAME = process.env.APP_NAME || 'doda';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'doda_session';
const SESSION_DAYS = 90;

/* ---------------------------------------------------------------- database */

const db = new DatabaseSync(path.join(DATA_DIR, 'doda.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Skema-trin. Tilfoej ALDRIG til et eksisterende trin efter udgivelse -
// laeg en ny funktion i enden af listen i stedet.
const MIGRATIONS = [
  function m1(d) {
    d.exec(`
      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        password     TEXT NOT NULL,
        created_at   INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_expires ON sessions(expires_at);
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE rate (
        bucket   TEXT PRIMARY KEY,
        count    INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      );
      CREATE TABLE audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        event   TEXT NOT NULL,
        subject TEXT,
        detail  TEXT
      );
      CREATE INDEX audit_at ON audit(at DESC);
    `);
  },
];

function migrate() {
  const cur = db.prepare('PRAGMA user_version').get().user_version || 0;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      log(`skema opdateret til version ${i + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/* ----------------------------------------------------------------- hjaelpere */

const now = () => Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[doda] ${msg}`);
const logError = (msg) => console.error(`[fejl] ${msg}`);
// Ruller op i panelets sikkerhedshistorik via runens events:-blok.
const logSecurity = (msg) => console.warn(`[sikkerhed] ${msg}`);

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function audit(event, subject, detail) {
  try {
    db.prepare('INSERT INTO audit (at, event, subject, detail) VALUES (?,?,?,?)')
      .run(now(), event, subject || null, detail ? String(detail).slice(0, 500) : null);
  } catch (err) {
    logError(`kunne ikke skrive audit: ${err.message}`);
  }
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/* Vedvarende rate-limit. In-memory ville nulstilles ved hver genstart -
   og panelet genstarter automatisk kl. 04. */
function rateAllow(bucket, limit, windowSec) {
  const t = now();
  const row = db.prepare('SELECT count, reset_at FROM rate WHERE bucket = ?').get(bucket);
  if (!row || row.reset_at <= t) {
    db.prepare('INSERT INTO rate (bucket, count, reset_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at')
      .run(bucket, t + windowSec);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE rate SET count = count + 1 WHERE bucket = ?').run(bucket);
  return true;
}

function rateClear(bucket) {
  db.prepare('DELETE FROM rate WHERE bucket = ?').run(bucket);
}

/* ---------------------------------------------------------------- kodeord */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- sessioner */

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, t, t + SESSION_DAYS * 86400);
  return token;
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function sessionCookie(req, token, maxAge) {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'ukendt';
}

/* ------------------------------------------------------------ http-svar */

// Hashen af det inline tema-script i index.html. Beregnes ved opstart i stedet
// for at blive stemplet ind af build'et - saa kan CSP'en aldrig komme ud af
// trit med filen. Se DESIGN.md §5.
let INLINE_SCRIPT_HASH = '';

function computeInlineHash() {
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const m = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/);
    if (!m) return;
    const digest = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
    INLINE_SCRIPT_HASH = ` 'sha256-${digest}'`;
  } catch (err) {
    logError(`kunne ikke beregne CSP-hash: ${err.message}`);
  }
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    `script-src 'self'${INLINE_SCRIPT_HASH}`,
    // 'unsafe-inline' gaelder kun typografi. Den betydningsfulde spaerring er
    // script-src; style-attributter er en langt mindre vektor, og uden dem kan
    // en vanilla-JS-frontend ikke bygge markup med innerHTML.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  }, extraHeaders || {}));
  res.end(data);
}

const MAX_BODY = 2 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    // CSRF-barriere oven paa SameSite=Lax: en formular kan ikke saette denne
    // header pa tvaers af oprindelser uden en preflight.
    if (!type.includes('application/json')) {
      reject(Object.assign(new Error('kraever application/json'), { status: 415 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('for stor forespoergsel'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) { resolve({}); return; }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(Object.assign(new Error('ugyldig JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/* ------------------------------------------------------------ statisk */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC_DIR, rel);
  // Sti-traversering: den opoeste sti skal ligge under public/.
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: 'forbudt' });
    return;
  }
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    sendJson(res, 404, { error: 'findes ikke' });
    return;
  }
  if (!stat.isFile()) { sendJson(res, 404, { error: 'findes ikke' }); return; }

  const ext = path.extname(full).toLowerCase();
  const isHtml = ext === '.html';
  securityHeaders(res);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // HTML altid frisk: Cloudflare edge-cacher .js/.css i timevis og ignorerer
    // no-cache, saa versionerede URL'er baerer opdateringen (RUNE-ERFARINGER §5).
    'Cache-Control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(full).pipe(res);
}

/* ------------------------------------------------------------ api */

function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'ikke logget ind' });
    return null;
  }
  return user;
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

const ROUTES = {
  'GET /api/public-config': (req, res) => {
    sendJson(res, 200, {
      appName: APP_NAME,
      // Naar der ingen bruger er, skal foerste-gangs-opsaetningen vises.
      needsSetup: userCount() === 0,
      secureContext: isHttps(req),
    });
  },

  'GET /api/me': (req, res) => {
    const user = sessionUser(req);
    sendJson(res, 200, user ? { user } : { user: null });
  },

  'POST /api/register': async (req, res) => {
    // doda er en en-bruger-app: registrering er kun mulig, saa laenge der
    // ingen bruger findes. Derefter er endepunktet lukket for altid.
    if (userCount() > 0) {
      logSecurity(`registrering-afvist ip=${clientIp(req)}`);
      sendJson(res, 403, { error: 'der findes allerede en bruger' });
      return;
    }
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length < 2) { sendJson(res, 400, { error: 'brugernavnet er for kort' }); return; }
    if (password.length < 8) { sendJson(res, 400, { error: 'kodeordet skal vaere mindst 8 tegn' }); return; }

    const id = newId();
    db.prepare('INSERT INTO users (id, username, password, created_at) VALUES (?,?,?,?)')
      .run(id, username, hashPassword(password), now());
    audit('bruger-oprettet', username, null);
    const token = createSession(id);
    sendJson(res, 200, { user: { id, username } }, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/login': async (req, res) => {
    const body = await readJsonBody(req);
    const username = str(body.username, 64).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(req);
    const bucket = `login:${ip}:${username}`;
    if (!rateAllow(bucket, 15, 900)) {
      logSecurity(`login-spaerret ip=${ip}`);
      sendJson(res, 429, { error: 'for mange forsoeg - proev igen om lidt' });
      return;
    }
    const row = db.prepare('SELECT id, username, password FROM users WHERE lower(username) = ?').get(username);
    if (!row || !verifyPassword(password, row.password)) {
      logSecurity(`login-fejl ip=${ip}`);
      audit('login-fejl', username, ip);
      sendJson(res, 401, { error: 'forkert brugernavn eller kodeord' });
      return;
    }
    rateClear(bucket);
    audit('login', row.username, ip);
    const token = createSession(row.id);
    sendJson(res, 200, { user: { id: row.id, username: row.username } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  'POST /api/logout': (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  },

  'POST /api/password': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';
    if (next.length < 8) { sendJson(res, 400, { error: 'kodeordet skal vaere mindst 8 tegn' }); return; }
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(current, row.password)) {
      logSecurity(`kodeordsskift-fejl ip=${clientIp(req)}`);
      sendJson(res, 401, { error: 'det nuvaerende kodeord passer ikke' });
      return;
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(next), user.id);
    // Alle andre sessioner droppes - et kodeordsskift skal kunne lukke en tyv ude.
    const keep = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, keep);
    audit('kodeord-skiftet', user.username, clientIp(req));
    sendJson(res, 200, { ok: true });
  },

  'GET /api/settings': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const row of rows) out[row.key] = row.value;
    sendJson(res, 200, { settings: out });
  },

  'POST /api/settings': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    // Whitelist - aldrig blind gennemskrivning af klientens noegler.
    const ALLOWED = new Set(['theme', 'review_weekday']);
    const written = {};
    for (const [key, value] of Object.entries(body.settings || {})) {
      if (!ALLOWED.has(key)) continue;
      setSetting(key, str(String(value), 200));
      written[key] = getSetting(key);
    }
    sendJson(res, 200, { settings: written });
  },
};

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    sendJson(res, 400, { error: 'ugyldig adresse' });
    return;
  }

  try {
    if (urlPath.startsWith('/api/')) {
      securityHeaders(res);
      const handler = ROUTES[`${req.method} ${urlPath}`];
      if (!handler) { sendJson(res, 404, { error: 'ukendt endepunkt' }); return; }
      await handler(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'metoden er ikke tilladt' });
      return;
    }
    serveStatic(req, res, urlPath);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) logError(`${req.method} ${urlPath}: ${err && err.stack ? err.stack : err}`);
    if (!res.headersSent) sendJson(res, status, { error: err && err.message ? err.message : 'serverfejl' });
    else res.end();
  }
});

/* --------------------------------------------------------- oprydning */

function sweep() {
  try {
    const t = now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
    db.prepare('DELETE FROM rate WHERE reset_at <= ?').run(t);
    db.prepare('DELETE FROM audit WHERE at < ?').run(t - 180 * 86400);
  } catch (err) {
    logError(`oprydning fejlede: ${err.message}`);
  }
}

process.on('SIGTERM', () => {
  log('lukker ned');
  server.close(() => { try { db.close(); } catch { /* ligegyldigt ved nedlukning */ } process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
});

process.on('uncaughtException', (err) => {
  logError(`ufanget undtagelse: ${err && err.stack ? err.stack : err}`);
});

migrate();
computeInlineHash();
sweep();
setInterval(sweep, 6 * 3600 * 1000).unref();

server.listen(BIND_PORT, () => {
  log(`doda lytter paa port ${BIND_PORT} (data: ${DATA_DIR})`);
});
