'use strict';
/*
 * doda - personlig GTD-opgave- og noteapp.
 *
 * Ren Node: node:http + node:sqlite + node:crypto. Ingen npm-pakker.
 * Det er ikke sparsommelighed - det er sikkerhedsvalget: uden afhaengigheder
 * findes der ingen transitiv forsyningskaede at holde patchet. Se DESIGN.md §5.
 */

// Tidszonen SKAL sattes foer den foerste Date bruges - ellers regner
// containeren i UTC, og "i dag" bliver forkert nogle timer i doegnet.
// Node laeser process.env.TZ ved foerste brug af Date.
process.env.TZ = process.env.TZ || 'Europe/Copenhagen';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Samme parser som frontenden bruger. Fangst fra webappen, fra en iOS-genvej
// og fra MCP skal tolke praecis den samme tekst (handover §5.10).
const parse = require('./shared/parse.js');

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const BIND_PORT = Number(process.env.BIND_PORT || process.env.PORT_web || 3000);
const APP_NAME = process.env.APP_NAME || 'doda';
// Under udvikling star APP_VERSION stille (det bumpes foerst ved udgivelse),
// men de statiske filer serveres "immutable" - sa browseren koerer glad den
// gamle app.js videre. DODA_DEV=1 slar cachen fra.
const DEV = process.env.DODA_DEV === '1';
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

  function m2(d) {
    // Alt der forespoerges eller filtreres far en RIGTIG kolonne med indeks.
    // Kun bloedt indhold (beskrivelsen) ligger som tekst. Grunden er
    // RUNE-ERFARINGER §4: lister og endepunkter uden login ma aldrig scanne
    // hele datasaettet.
    d.exec(`
      CREATE TABLE areas (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '',
        area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
        parent_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        seq INTEGER NOT NULL DEFAULT 0, reviewed_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX projects_status ON projects(status, deleted);
      CREATE TABLE contexts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX contexts_navn ON contexts(lower(name));
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'task',
        status TEXT NOT NULL DEFAULT 'inbox',
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
        due_date TEXT, due_time TEXT, defer_date TEXT,
        waiting_for TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL DEFAULT 0,
        recurrence_id TEXT, skipped INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        completed_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX items_status ON items(status, deleted);
      CREATE INDEX items_projekt ON items(project_id);
      CREATE INDEX items_aendret ON items(updated_at);
      CREATE INDEX items_forfald ON items(due_date) WHERE due_date IS NOT NULL;
      CREATE TABLE item_contexts (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        context_id TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
        PRIMARY KEY (item_id, context_id)
      );
      CREATE INDEX item_contexts_kontekst ON item_contexts(context_id);
    `);
  },

  function m3(d) {
    // Kun hashen gemmes. Mistes databasen, kan ingen noegle bruges igen -
    // og selv jeg kan ikke vise en noegle frem efter oprettelsen.
    d.exec(`
      CREATE TABLE tokens (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        hash       TEXT NOT NULL UNIQUE,
        prefix     TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'full',
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX tokens_hash ON tokens(hash) WHERE revoked_at IS NULL;
    `);
  },

  function m4(d) {
    // Droppes et projekt, droppes dets aabne opgaver med. Flaget goer det
    // muligt at rulle praecis dem tilbage, hvis projektet genaabnes -
    // uden at vaekke opgaver, der blev droppet enkeltvis (DESIGN.md §6).
    d.exec("ALTER TABLE items ADD COLUMN dropped_with_project INTEGER NOT NULL DEFAULT 0");
  },
];

// Statusser. Raekkefoelgen er ogsaa den, lister sorteres efter.
const STATUSSER = ['inbox', 'next', 'queued', 'waiting', 'someday', 'done', 'dropped'];

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

/**
 * Laeser kroppen.
 *
 * @param {boolean} tilgivende  Saettes KUN naar forespoergslen er godkendt med
 *   en adgangsnoegle. Kravet om application/json er en CSRF-barriere, og CSRF
 *   forudsaetter en ambient legitimation (cookien). En Bearer-noegle sendes
 *   aktivt af klienten, sa der er intet at forfalske - og sa skal en genvej,
 *   der bare sender en tekststreng, kunne virke (handover §5.10).
 */
function readJsonBody(req, tilgivende) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const erJson = type.includes('application/json');
    if (!erJson && !tilgivende) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
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

      if (erJson || raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
        } catch {
          reject(Object.assign(new Error('The body is not valid JSON.'), { status: 400 }));
        }
        return;
      }

      // Tilgivende tilstand: en genvej, der sender formulardata eller bare en
      // raa tekststreng, skal virke.
      if (type.includes('application/x-www-form-urlencoded')) {
        const felter = {};
        for (const [n, v] of new URLSearchParams(raw)) felter[n] = v;
        resolve(felter);
        return;
      }
      resolve({ text: raw });
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

  // I DEV stemples ?v= med filernes mtime i stedet for APP_VERSION. Ellers
  // beholder browseren en "immutable" app.js fra foer og spoerger aldrig
  // serveren igen - saa ser man sine egne aendringer udeblive.
  if (isHtml && DEV) {
    let html = fs.readFileSync(full, 'utf8');
    html = html.replace(/(style\.css|app\.js)\?v=\d+/g, (_, fil) => {
      let m = 0;
      try { m = Math.floor(fs.statSync(path.join(PUBLIC, fil)).mtimeMs); } catch { /* ligegyldigt */ }
      return `${fil}?v=${m}`;
    });
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // HTML altid frisk: Cloudflare edge-cacher .js/.css i timevis og ignorerer
    // no-cache, saa versionerede URL'er baerer opdateringen (RUNE-ERFARINGER §5).
    'Cache-Control': (isHtml || DEV) ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(full).pipe(res);
}

/* ------------------------------------------------- adgangsnoegler */

/* Scopes. En mistet telefon ma ikke kunne laese hele systemet, sa en
   capture-noegle kan KUN oprette - den kan ikke se noget som helst
   (handover §5.10). */
const SCOPE_TILLADER = {
  capture: new Set(['capture']),
  read: new Set(['read']),
  full: new Set(['capture', 'read', 'write']),
};
const SCOPES = Object.keys(SCOPE_TILLADER);

function hashToken(raa) {
  return crypto.createHash('sha256').update(String(raa), 'utf8').digest('hex');
}

function opretToken(navn, scope) {
  const hemmelig = crypto.randomBytes(32).toString('base64url');
  const noegle = `doda_${hemmelig}`;
  const id = newId();
  db.prepare('INSERT INTO tokens (id, name, hash, prefix, scope, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, navn, hashToken(noegle), hemmelig.slice(0, 6), scope, now());
  audit('noegle-oprettet', navn, scope);
  // Noeglen returneres ÉN gang og gemmes aldrig i klartekst.
  return { id, key: noegle };
}

function findToken(raa) {
  if (typeof raa !== 'string' || !raa.startsWith('doda_')) return null;
  const row = db.prepare(`
    SELECT id, name, scope, last_used_at FROM tokens
     WHERE hash = ? AND revoked_at IS NULL`).get(hashToken(raa));
  return row || null;
}

function stemplBrug(token) {
  // Hoejst ét skriv i minuttet - ellers koster hvert API-kald en skrivning.
  const t = now();
  if (token.last_used_at && t - token.last_used_at < 60) return;
  db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(t, token.id);
}

/* ------------------------------------------------------------ api */

/**
 * Godkender en forespoergsel via adgangsnoegle ELLER session-cookie.
 *
 * Det er hele pointen i handover §5.10: webgraensefladen bruger samme API som
 * eksterne klienter. Der er ingen intern bagvej.
 *
 * @returns {{user, token, viaToken}|null} - null naar svaret allerede er sendt
 */
function godkend(req, res, kraevetScope) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  const raaNoegle = bearer ? bearer[1] : String(req.headers['x-api-key'] || '');

  if (raaNoegle) {
    const token = findToken(raaNoegle);
    if (!token) {
      logSecurity(`noegle-afvist ip=${clientIp(req)}`);
      apiFejl(res, 401, 'invalid_key', 'That access key is not valid. It may have been revoked.');
      return null;
    }
    if (!rateAllow(`api:${token.id}`, 600, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many requests with this key. Try again shortly.');
      return null;
    }
    if (!SCOPE_TILLADER[token.scope].has(kraevetScope)) {
      apiFejl(res, 403, 'wrong_scope',
        `This key is "${token.scope}" and cannot ${kraevetScope}. Create a key with a wider scope.`);
      return null;
    }
    stemplBrug(token);
    const bruger = db.prepare('SELECT id, username FROM users LIMIT 1').get();
    return { user: bruger, token, viaToken: true };
  }

  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'not_signed_in', 'You are not signed in.');
    return null;
  }
  return { user, token: null, viaToken: false };
}

/**
 * Kraever en rigtig SESSION - en adgangsnoegle er ikke nok.
 *
 * Bruges kun til kodeordsskift og til administration af noeglerne selv.
 * Ellers ville én laekket noegle vaere nok til at give sig selv fuld og
 * varig adgang, eller til at laase mig ude af min egen app.
 */
function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) {
    apiFejl(res, 401, 'session_required',
      'This needs a signed-in browser session — an access key cannot do it.');
    return null;
  }
  return user;
}

/** Fejlsvar en iOS-genvej kan vise direkte: kort kode + laesbar besked. */
function apiFejl(res, status, kode, besked) {
  sendJson(res, status, { error: kode, message: besked });
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/* ------------------------------------------------------------ elementer */

function iDag() {
  return parse.fmtDato(new Date());
}

function hentKontekster() {
  return db.prepare('SELECT id, name, seq FROM contexts ORDER BY seq, lower(name)').all();
}

function hentProjekter() {
  // next_count regnes med: et projekt UDEN naeste handling er den klassiske
  // GTD-fejl og skal vaere synlig (handover §5.4). Underforespoergslen bruger
  // items_projekt- og items_status-indekserne.
  return db.prepare(`
    SELECT p.id, p.name, p.outcome, p.area_id, p.parent_id, p.status, p.seq, p.reviewed_at,
           (SELECT COUNT(*) FROM items i
             WHERE i.project_id = p.id AND i.deleted = 0 AND i.kind = 'task'
               AND i.status = 'next'
               AND (i.defer_date IS NULL OR i.defer_date <= ?)) AS next_count,
           -- Kun OPGAVER taeller som aabent arbejde. En note er reference:
           -- et projekt med tre noter og nul opgaver mangler ikke en naeste
           -- handling, det er bare ikke gaaet i gang.
           (SELECT COUNT(*) FROM items i
             WHERE i.project_id = p.id AND i.deleted = 0 AND i.kind = 'task'
               AND i.status NOT IN ('done','dropped')) AS open_count
      FROM projects p WHERE p.deleted = 0 ORDER BY p.seq, lower(p.name)`).all(iDag());
}

function hentOmraader() {
  return db.prepare('SELECT id, name, seq FROM areas ORDER BY seq, lower(name)').all();
}

const PROJEKT_STATUSSER = ['active', 'someday', 'done', 'dropped'];

/** Naeste ledige plads i en sorteret liste, sa nye ting laegger sig bagest. */
function naesteSeq(tabel, hvor, arg) {
  const r = db.prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM ${tabel} ${hvor}`).get(...(arg || []));
  return r.n;
}

function findKontekst(navn) {
  return db.prepare('SELECT id, name FROM contexts WHERE lower(name) = lower(?)').get(navn);
}

function findProjekt(navn) {
  return db.prepare('SELECT id, name FROM projects WHERE lower(name) = lower(?) AND deleted = 0').get(navn);
}

function opretKontekst(navn) {
  const id = newId();
  const t = now();
  // seq er et LOEBENUMMER, ikke et tidsstempel. Skrives now() her, bliver
  // manuel sortering umulig, fordi alle numre ligger i milliardklassen.
  db.prepare('INSERT INTO contexts (id, name, seq, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, navn, naesteSeq('contexts', ''), t, t);
  return { id, name: navn };
}

function opretProjekt(navn) {
  const id = newId();
  const t = now();
  db.prepare('INSERT INTO projects (id, name, seq, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, navn, naesteSeq('projects', ''), t, t);
  return { id, name: navn };
}

const ITEM_FELTER = `
  i.id, i.kind, i.status, i.title, i.note, i.project_id, i.area_id,
  i.due_date, i.due_time, i.defer_date, i.waiting_for, i.seq,
  i.recurrence_id, i.skipped, i.created_at, i.updated_at, i.completed_at`;

/** Haenger konteksterne pa en raekke elementer i ÉT opslag, ikke ét pr. element. */
function medKontekster(raekker) {
  if (!raekker.length) return raekker;
  const huller = raekker.map(() => '?').join(',');
  const par = db.prepare(`
    SELECT ic.item_id, c.id, c.name
      FROM item_contexts ic JOIN contexts c ON c.id = ic.context_id
     WHERE ic.item_id IN (${huller})`).all(...raekker.map((r) => r.id));
  const kort = new Map();
  for (const p of par) {
    if (!kort.has(p.item_id)) kort.set(p.item_id, []);
    kort.get(p.item_id).push({ id: p.id, name: p.name });
  }
  for (const r of raekker) r.contexts = kort.get(r.id) || [];
  return raekker;
}

function hentItems(filter) {
  const hvor = ['i.deleted = 0'];
  const arg = [];

  if (filter.status) {
    const liste = String(filter.status).split(',').filter((s) => STATUSSER.includes(s));
    if (!liste.length) return [];
    hvor.push(`i.status IN (${liste.map(() => '?').join(',')})`);
    arg.push(...liste);
  }
  if (filter.kind) { hvor.push('i.kind = ?'); arg.push(filter.kind); }
  if (filter.project) { hvor.push('i.project_id = ?'); arg.push(filter.project); }
  if (filter.skjulUdskudte) {
    // "Skjul indtil"-datoer i fremtiden ma ikke sta i handlingslisten
    // (handover §5.3).
    hvor.push('(i.defer_date IS NULL OR i.defer_date <= ?)');
    arg.push(iDag());
  }

  let join = '';
  if (filter.context) {
    join = 'JOIN item_contexts ic ON ic.item_id = i.id';
    hvor.push('ic.context_id = ?');
    arg.push(filter.context);
  }

  const raekker = db.prepare(`
    SELECT ${ITEM_FELTER} FROM items i ${join}
     WHERE ${hvor.join(' AND ')}
     ORDER BY ${filter.nyesteFoerst ? 'i.completed_at DESC, i.created_at DESC' : 'i.seq, i.created_at'}
     LIMIT ?`).all(...arg, Math.min(Number(filter.limit) || 500, 2000));

  return medKontekster(raekker);
}

function hentItem(id) {
  const raekke = db.prepare(`SELECT ${ITEM_FELTER} FROM items i WHERE i.id = ? AND i.deleted = 0`).get(id);
  return raekke ? medKontekster([raekke])[0] : null;
}

function saetKontekster(itemId, kontekstIder) {
  db.prepare('DELETE FROM item_contexts WHERE item_id = ?').run(itemId);
  const ins = db.prepare('INSERT OR IGNORE INTO item_contexts (item_id, context_id) VALUES (?,?)');
  for (const cid of kontekstIder.slice(0, 20)) ins.run(itemId, cid);
}

const GRAENSER = { title: 500, note: 20000, waiting_for: 200 };

/** Whitelister og afkorter alle felter. Klienten bestemmer aldrig formen. */
function renseItem(raa) {
  const ud = {};
  if (typeof raa.kind === 'string') ud.kind = raa.kind === 'note' ? 'note' : 'task';
  if (typeof raa.status === 'string' && STATUSSER.includes(raa.status)) ud.status = raa.status;
  if (typeof raa.title === 'string') ud.title = raa.title.trim().slice(0, GRAENSER.title);
  if (typeof raa.note === 'string') ud.note = raa.note.slice(0, GRAENSER.note);
  if (typeof raa.waiting_for === 'string') ud.waiting_for = raa.waiting_for.trim().slice(0, GRAENSER.waiting_for);
  for (const felt of ['due_date', 'defer_date']) {
    if (raa[felt] === null) ud[felt] = null;
    else if (typeof raa[felt] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raa[felt])) ud[felt] = raa[felt];
  }
  if (raa.due_time === null) ud.due_time = null;
  else if (typeof raa.due_time === 'string' && /^\d{2}:\d{2}$/.test(raa.due_time)) ud.due_time = raa.due_time;
  if (raa.project_id === null) ud.project_id = null;
  else if (typeof raa.project_id === 'string' && findProjektId(raa.project_id)) ud.project_id = raa.project_id;
  return ud;
}

function findProjektId(id) {
  return db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted = 0').get(id);
}

function opretItem(felter, kontekstIder) {
  const id = newId();
  const t = now();
  const f = Object.assign({ kind: 'task', status: 'inbox', title: '', note: '' }, felter);
  db.prepare(`
    INSERT INTO items (id, kind, status, title, note, project_id, due_date, due_time,
                       defer_date, waiting_for, seq, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, f.kind, f.status, f.title, f.note, f.project_id || null,
      f.due_date || null, f.due_time || null, f.defer_date || null,
      f.waiting_for || '', t, t, t);
  if (kontekstIder && kontekstIder.length) saetKontekster(id, kontekstIder);
  return hentItem(id);
}

function opdaterItem(id, felter) {
  const nuvaerende = hentItem(id);
  if (!nuvaerende) return null;
  const saet = [];
  const arg = [];
  for (const [n, v] of Object.entries(felter)) { saet.push(`${n} = ?`); arg.push(v); }
  if (!saet.length) return nuvaerende;
  // Serveren ejer updated_at - klientens vaerdi bruges kun ved bulk-import.
  saet.push('updated_at = ?');
  arg.push(now());
  db.prepare(`UPDATE items SET ${saet.join(', ')} WHERE id = ?`).run(...arg, id);
  return hentItem(id);
}

/**
 * Omsaetter en fangst-tekst til et element.
 * Ukendte kontekster og projekter kraever bekraeftelse (handover §5.1),
 * medmindre kalderen udtrykkeligt beder om at oprette dem.
 */
function fangst(tekst, opretNye) {
  const tolket = parse.tolkFangst(tekst);
  if (!tolket.title && !tolket.note) return { fejl: 'der er ingen tekst at fange' };

  const manglerKontekster = tolket.contexts.filter((n) => !findKontekst(n));
  const manglerProjekt = tolket.project && !findProjekt(tolket.project) ? tolket.project : null;

  if (!opretNye && (manglerKontekster.length || manglerProjekt)) {
    return { skalBekraeftes: { contexts: manglerKontekster, project: manglerProjekt }, tolket };
  }

  const kontekstIder = tolket.contexts.map((n) => (findKontekst(n) || opretKontekst(n)).id);
  let projektId = null;
  if (tolket.project) projektId = (findProjekt(tolket.project) || opretProjekt(tolket.project)).id;

  const item = opretItem({
    kind: tolket.kind,
    // En note er reference, ikke en handling - den skal aldrig ligge og vente
    // pa afklaring i inbox (handover §4).
    status: tolket.kind === 'note' ? 'queued' : 'inbox',
    title: tolket.title.slice(0, GRAENSER.title),
    note: tolket.note.slice(0, GRAENSER.note),
    project_id: projektId,
    due_date: tolket.due ? tolket.due.dato : null,
    due_time: tolket.due ? tolket.due.tid : null,
    defer_date: tolket.defer,
  }, kontekstIder);

  return { item, tolket };
}

/* --------------------------------------------------------------- ruter */

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

  /* --- data ------------------------------------------------------- */

  // Ét kald der giver skallen alt, den skal bruge for at tegne sig.
  'GET /api/v1/state': (req, res) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const tal = db.prepare(`
      SELECT status, COUNT(*) AS n FROM items
       WHERE deleted = 0 AND (defer_date IS NULL OR defer_date <= ?)
       GROUP BY status`).all(iDag());
    const antal = {};
    for (const r of tal) antal[r.status] = r.n;
    sendJson(res, 200, {
      contexts: hentKontekster(),
      projects: hentProjekter(),
      areas: hentOmraader(),
      counts: antal,
      today: iDag(),
    });
  },

  'GET /api/v1/items': (req, res, ctx) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const q = ctx.query;
    sendJson(res, 200, {
      items: hentItems({
        status: q.get('status'),
        kind: q.get('kind'),
        project: q.get('project'),
        context: q.get('context'),
        limit: q.get('limit'),
        skjulUdskudte: q.get('hideDeferred') === '1',
        nyesteFoerst: q.get('newest') === '1',
      }),
    });
  },

  'POST /api/v1/capture': async (req, res, ctx) => {
    const auth = godkend(req, res, 'capture');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);

    // Tilgivende: teksten ma komme som JSON-felt, som formularfelt, som ren
    // krop eller endda som ?text= i adressen. En genvej med ét tekstfelt
    // skal bare virke (handover §5.10).
    let tekst = '';
    for (const kandidat of [body.text, body.title, body.note, ctx.query.get('text')]) {
      if (typeof kandidat === 'string' && kandidat.trim()) { tekst = kandidat; break; }
    }
    if (!tekst.trim()) {
      apiFejl(res, 400, 'no_text', 'Nothing to capture — send some text.');
      return;
    }

    // Udefra oprettes ukendte kontekster og projekter uden at spoerge: en
    // genvej kan ikke svare pa et bekraeftelsesspoergsmal. Webappen sender
    // createNew: false og haandterer bekraeftelsen selv.
    const opretNye = auth.viaToken ? body.createNew !== false : body.createNew === true;
    const svar = fangst(tekst, opretNye);
    if (svar.fejl) { apiFejl(res, 400, 'no_text', svar.fejl); return; }
    if (svar.skalBekraeftes) {
      sendJson(res, 200, { needsConfirm: svar.skalBekraeftes, parsed: svar.tolket });
      return;
    }
    if (auth.viaToken) audit('fangst-via-api', auth.token.name, svar.item.title.slice(0, 80));
    sendJson(res, 200, {
      item: svar.item,
      parsed: svar.tolket,
      // Genveje viser gerne et svar. Giv dem én faerdig linje.
      message: `Added: ${svar.item.title}`,
    });
  },

  // Tolkning uden at gemme - bruges til at vise chips, mens der skrives.
  'POST /api/v1/parse': async (req, res) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const body = await readJsonBody(req);
    const tolket = parse.tolkFangst(typeof body.text === 'string' ? body.text : '');
    sendJson(res, 200, {
      parsed: tolket,
      unknownContexts: tolket.contexts.filter((n) => !findKontekst(n)),
      unknownProject: tolket.project && !findProjekt(tolket.project) ? tolket.project : null,
    });
  },

  'POST /api/v1/items': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req);
    const felter = renseItem(body);
    if (!felter.title && !felter.note) { sendJson(res, 400, { error: 'title is required' }); return; }
    const kontekstIder = Array.isArray(body.contexts)
      ? body.contexts.filter((id) => typeof id === 'string' && db.prepare('SELECT 1 FROM contexts WHERE id = ?').get(id))
      : [];
    sendJson(res, 200, { item: opretItem(felter, kontekstIder) });
  },

  'GET /api/v1/search': (req, res, ctx) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const q = String(ctx.query.get('q') || '').trim().slice(0, 200);
    if (q.length < 1) { sendJson(res, 200, { items: [] }); return; }
    // LIKE med escapede jokertegn - ellers kan et % i soegningen hente alt.
    const moenster = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const raekker = db.prepare(`
      SELECT ${ITEM_FELTER} FROM items i
       WHERE i.deleted = 0 AND (i.title LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN i.status IN ('done','dropped') THEN 1 ELSE 0 END,
                i.updated_at DESC
       LIMIT 40`).all(moenster, moenster);
    sendJson(res, 200, { items: medKontekster(raekker) });
  },

  /* Genvejs-venligt: kun det man kan gore nu, valgfrit én kontekst, og
     ?format=text giver en faerdig liste en genvej kan vise direkte. */
  'GET /api/v1/next': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const oensket = String(ctx.query.get('context') || '').trim();
    let kontekstId = null;
    if (oensket) {
      const k = findKontekst(oensket) || db.prepare('SELECT id FROM contexts WHERE id = ?').get(oensket);
      if (!k) {
        apiFejl(res, 404, 'unknown_context',
          `No context called "${oensket}". Known contexts: ${hentKontekster().map((c) => c.name).join(', ') || 'none yet'}.`);
        return;
      }
      kontekstId = k.id;
    }
    const items = hentItems({ status: 'next', skjulUdskudte: true, context: kontekstId, limit: ctx.query.get('limit') });

    if (ctx.query.get('format') === 'text') {
      const linjer = items.map((i) => {
        const dele = [i.title];
        if (i.contexts.length) dele.push(i.contexts.map((c) => `#${c.name}`).join(' '));
        if (i.due_date) dele.push(i.due_date + (i.due_time ? ` ${i.due_time}` : ''));
        return `• ${dele.join('  ·  ')}`;
      });
      const krop = linjer.length ? linjer.join('\n') : 'Nothing to do right now.';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(krop);
      return;
    }
    sendJson(res, 200, { items, count: items.length });
  },

  /* Lad en klient holde sig opdateret uden at hente alt. Slettede elementer
     kommer med som id'er, sa klienten kan fjerne dem igen. */
  'GET /api/v1/changes': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const raa = String(ctx.query.get('since') || '0');
    const since = /^\d+$/.test(raa) ? Number(raa) : Math.floor(Date.parse(raa) / 1000);
    if (!Number.isFinite(since)) {
      apiFejl(res, 400, 'bad_since', 'The "since" value must be a unix timestamp or an ISO date.');
      return;
    }
    const raekker = db.prepare(`
      SELECT ${ITEM_FELTER}, i.deleted FROM items i
       WHERE i.updated_at > ? ORDER BY i.updated_at LIMIT 1000`).all(since);
    const levende = raekker.filter((r) => !r.deleted);
    medKontekster(levende);
    sendJson(res, 200, {
      now: now(),
      items: levende.map((r) => { delete r.deleted; return r; }),
      deleted: raekker.filter((r) => r.deleted).map((r) => r.id),
    });
  },

  'GET /api/v1/contexts': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { contexts: hentKontekster() });
  },

  'GET /api/v1/projects': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { projects: hentProjekter() });
  },

  'GET /api/v1/areas': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { areas: hentOmraader() });
  },

  'POST /api/v1/areas': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const navn = str(body.name, 80);
    if (!navn) { apiFejl(res, 400, 'no_name', 'An area needs a name.'); return; }
    const fandtes = db.prepare('SELECT id, name, seq FROM areas WHERE lower(name) = lower(?)').get(navn);
    if (fandtes) { sendJson(res, 200, { area: fandtes }); return; }
    const id = newId();
    const t = now();
    db.prepare('INSERT INTO areas (id, name, seq, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(id, navn, naesteSeq('areas', ''), t, t);
    sendJson(res, 200, { area: { id, name: navn } });
  },

  'POST /api/v1/reorder': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const tabel = { items: 'items', projects: 'projects', contexts: 'contexts', areas: 'areas' }[body.kind];
    if (!tabel || !Array.isArray(body.ids)) {
      apiFejl(res, 400, 'bad_request', 'Send {kind: "items"|"projects"|"contexts"|"areas", ids: [...]}.');
      return;
    }
    const saet = db.prepare(`UPDATE ${tabel} SET seq = ? WHERE id = ?`);
    db.exec('BEGIN');
    try {
      body.ids.slice(0, 2000).forEach((id, i) => { if (typeof id === 'string') saet.run(i, id); });
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    sendJson(res, 200, { ok: true });
  },

  'GET /api/v1/notes': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { items: hentItems({ kind: 'note', limit: ctx.query.get('limit') }) });
  },

  'POST /api/v1/notes': async (req, res) => {
    const auth = godkend(req, res, 'capture');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const tekst = typeof body.text === 'string' ? body.text : '';
    const titel = str(body.title, GRAENSER.title) || tekst.split('\n')[0].slice(0, GRAENSER.title);
    if (!titel) { apiFejl(res, 400, 'no_text', 'A note needs at least a title.'); return; }
    const item = opretItem({
      kind: 'note', status: 'queued', title: titel,
      note: str(body.note, GRAENSER.note) || (tekst.includes('\n') ? tekst.slice(tekst.indexOf('\n') + 1) : ''),
    }, []);
    sendJson(res, 200, { item, message: `Saved note: ${item.title}` });
  },

  /* --- adgangsnoegler ---------------------------------------------
     BEVIDST session-only (requireUser, ikke godkend): en adgangsnoegle ma
     hverken kunne lave nye noegler eller se de eksisterende. Ellers er en
     laekket noegle nok til at give sig selv fuld og varig adgang. */
  'GET /api/v1/tokens': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, {
      tokens: db.prepare(`
        SELECT id, name, prefix, scope, created_at, last_used_at FROM tokens
         WHERE revoked_at IS NULL ORDER BY created_at DESC`).all(),
    });
  },

  'POST /api/v1/tokens': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const navn = str(body.name, 60);
    const scope = SCOPES.includes(body.scope) ? body.scope : 'capture';
    if (!navn) { apiFejl(res, 400, 'no_name', 'Give the key a name, so you know what to revoke later.'); return; }
    const ny = opretToken(navn, scope);
    sendJson(res, 200, { id: ny.id, key: ny.key, name: navn, scope });
  },

  'POST /api/v1/contexts': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req);
    const navn = str(body.name, 60);
    if (!navn) { sendJson(res, 400, { error: 'name is required' }); return; }
    sendJson(res, 200, { context: findKontekst(navn) || opretKontekst(navn) });
  },

  'POST /api/v1/projects': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req);
    const navn = str(body.name, 120);
    if (!navn) { sendJson(res, 400, { error: 'name is required' }); return; }
    sendJson(res, 200, { project: findProjekt(navn) || opretProjekt(navn) });
  },

  'GET /api/v1/settings': (req, res) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const row of rows) out[row.key] = row.value;
    sendJson(res, 200, { settings: out });
  },

  'POST /api/v1/settings': async (req, res) => {
    const user = godkend(req, res, 'write');
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

/** Et projekt med alt, hvad der hoerer til det. Opgaver OG noter (handover §5.4). */
function projektMedIndhold(id) {
  const p = hentProjekter().find((x) => x.id === id);
  if (!p) return null;
  const raekker = db.prepare(`
    SELECT ${ITEM_FELTER} FROM items i
     WHERE i.project_id = ? AND i.deleted = 0
     ORDER BY i.seq, i.created_at`).all(id);
  medKontekster(raekker);
  return {
    project: p,
    tasks: raekker.filter((r) => r.kind === 'task'),
    notes: raekker.filter((r) => r.kind === 'note'),
    children: hentProjekter().filter((x) => x.parent_id === id),
  };
}

/* Ruter med sti-parametre. Rakkefolgen er den, de proves i. */
const MOENSTRE = [
  {
    metode: 'GET', re: /^\/api\/v1\/projects\/([\w-]{1,64})$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const d = projektMedIndhold(ctx.params[0]);
      if (!d) { apiFejl(res, 404, 'not_found', 'No such project.'); return; }
      sendJson(res, 200, d);
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/projects\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const id = ctx.params[0];
      const nu = db.prepare('SELECT id, status FROM projects WHERE id = ? AND deleted = 0').get(id);
      if (!nu) { apiFejl(res, 404, 'not_found', 'No such project.'); return; }

      const saet = [];
      const arg = [];
      if (typeof body.name === 'string' && body.name.trim()) { saet.push('name = ?'); arg.push(str(body.name, 120)); }
      if (typeof body.outcome === 'string') { saet.push('outcome = ?'); arg.push(str(body.outcome, 2000)); }
      if (body.area_id === null || typeof body.area_id === 'string') {
        const gyldig = body.area_id === null || db.prepare('SELECT 1 FROM areas WHERE id = ?').get(body.area_id);
        if (gyldig) { saet.push('area_id = ?'); arg.push(body.area_id || null); }
      }
      if (body.parent_id === null || (typeof body.parent_id === 'string' && body.parent_id !== id
          && db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted = 0').get(body.parent_id))) {
        saet.push('parent_id = ?');
        arg.push(body.parent_id || null);
      }
      if (PROJEKT_STATUSSER.includes(body.status)) { saet.push('status = ?'); arg.push(body.status); }
      if (body.reviewed === true) { saet.push('reviewed_at = ?'); arg.push(now()); }
      if (saet.length) {
        saet.push('updated_at = ?');
        arg.push(now());
        db.prepare(`UPDATE projects SET ${saet.join(', ')} WHERE id = ?`).run(...arg, id);
      }

      // Droppes projektet, droppes dets AABNE opgaver med - og markeres, sa de
      // kan vaekkes igen samlet. Udfoerte opgaver roeres aldrig: logbogen skal
      // blive ved med at vaere sand (DESIGN.md §6).
      if (body.status === 'dropped' && nu.status !== 'dropped') {
        db.prepare(`
          UPDATE items SET status = 'dropped', completed_at = ?, dropped_with_project = 1, updated_at = ?
           WHERE project_id = ? AND deleted = 0 AND status NOT IN ('done','dropped')`)
          .run(now(), now(), id);
      }
      if (nu.status === 'dropped' && body.status && body.status !== 'dropped') {
        db.prepare(`
          UPDATE items SET status = 'queued', completed_at = NULL, dropped_with_project = 0, updated_at = ?
           WHERE project_id = ? AND dropped_with_project = 1`).run(now(), id);
      }
      sendJson(res, 200, projektMedIndhold(id));
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/projects\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      // Projektet slettes bloedt; opgaverne loesrives i stedet for at
      // forsvinde med det. Ingenting ma gaa tabt, fordi en mappe forsvandt.
      db.prepare('UPDATE projects SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), ctx.params[0]);
      db.prepare('UPDATE items SET project_id = NULL, updated_at = ? WHERE project_id = ?')
        .run(now(), ctx.params[0]);
      db.prepare('UPDATE projects SET parent_id = NULL WHERE parent_id = ?').run(ctx.params[0]);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/contexts\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const navn = str(body.name, 60);
      if (!navn) { apiFejl(res, 400, 'no_name', 'A context needs a name.'); return; }
      const optaget = db.prepare('SELECT id FROM contexts WHERE lower(name) = lower(?) AND id != ?')
        .get(navn, ctx.params[0]);
      if (optaget) { apiFejl(res, 409, 'name_taken', `There is already a context called "${navn}".`); return; }
      db.prepare('UPDATE contexts SET name = ?, updated_at = ? WHERE id = ?').run(navn, now(), ctx.params[0]);
      sendJson(res, 200, { contexts: hentKontekster() });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/contexts\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      // ON DELETE CASCADE rydder item_contexts. Opgaverne overlever - de
      // star bare uden kontekst bagefter.
      db.prepare('DELETE FROM contexts WHERE id = ?').run(ctx.params[0]);
      sendJson(res, 200, { contexts: hentKontekster() });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/areas\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const navn = str(body.name, 80);
      if (!navn) { apiFejl(res, 400, 'no_name', 'An area needs a name.'); return; }
      db.prepare('UPDATE areas SET name = ?, updated_at = ? WHERE id = ?').run(navn, now(), ctx.params[0]);
      sendJson(res, 200, { areas: hentOmraader() });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/areas\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      db.prepare('DELETE FROM areas WHERE id = ?').run(ctx.params[0]);
      sendJson(res, 200, { areas: hentOmraader() });
    },
  },
  {
    // Tilbagekaldelse skal virke OEJEBLIKKELIGT: der er ingen cache af
    // noegler, sa naeste kald slar op i databasen og finder ingenting.
    metode: 'DELETE', re: /^\/api\/v1\/tokens\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const user = requireUser(req, res);
      if (!user) return;
      await readJsonBody(req);
      const t = db.prepare('SELECT name FROM tokens WHERE id = ? AND revoked_at IS NULL').get(ctx.params[0]);
      if (!t) { apiFejl(res, 404, 'not_found', 'No such key.'); return; }
      db.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ?').run(now(), ctx.params[0]);
      audit('noegle-tilbagekaldt', t.name, clientIp(req));
      logSecurity(`noegle-tilbagekaldt navn=${t.name}`);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/items\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const felter = renseItem(body);
      if (Array.isArray(body.contexts)) {
        const gyldige = body.contexts.filter((id) => typeof id === 'string'
          && db.prepare('SELECT 1 FROM contexts WHERE id = ?').get(id));
        if (!hentItem(ctx.params[0])) { sendJson(res, 404, { error: 'not found' }); return; }
        saetKontekster(ctx.params[0], gyldige);
      }
      const item = opdaterItem(ctx.params[0], felter);
      if (!item) { sendJson(res, 404, { error: 'not found' }); return; }
      sendJson(res, 200, { item });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/items\/([\w-]{1,64})\/complete$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const item = hentItem(ctx.params[0]);
      if (!item) { sendJson(res, 404, { error: 'not found' }); return; }
      // Én fuldfoerelse pr. element. Er den allerede udfoert, er svaret det
      // samme - sa en genafsendt genvej ikke laver ravage (DESIGN.md §6).
      if (item.status === 'done') { sendJson(res, 200, { item }); return; }
      sendJson(res, 200, { item: opdaterItem(item.id, { status: 'done', completed_at: now() }) });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/items\/([\w-]{1,64})\/uncomplete$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const item = hentItem(ctx.params[0]);
      if (!item) { sendJson(res, 404, { error: 'not found' }); return; }
      sendJson(res, 200, { item: opdaterItem(item.id, { status: 'next', completed_at: null }) });
    },
  },
  {
    metode: 'GET', re: /^\/api\/v1\/items\/([\w-]{1,64})$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const item = hentItem(ctx.params[0]);
      if (!item) { sendJson(res, 404, { error: 'not found' }); return; }
      sendJson(res, 200, { item });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/items\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken); // haandhaever JSON-headeren ogsaa pa DELETE
      // Bloed sletning: intet forsvinder for altid, og logbogen bliver sand.
      const item = opdaterItem(ctx.params[0], { deleted: 1 });
      if (!item) { sendJson(res, 404, { error: 'not found' }); return; }
      sendJson(res, 200, { ok: true });
    },
  },
];

function findRute(metode, sti) {
  const direkte = ROUTES[`${metode} ${sti}`];
  if (direkte) return { kald: direkte, params: [] };
  for (const m of MOENSTRE) {
    if (m.metode !== metode) continue;
    const fund = sti.match(m.re);
    if (fund) return { kald: m.kald, params: fund.slice(1) };
  }
  return null;
}

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  let urlPath;
  let query;
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    query = u.searchParams;
  } catch {
    sendJson(res, 400, { error: 'ugyldig adresse' });
    return;
  }

  try {
    if (urlPath.startsWith('/api/')) {
      securityHeaders(res);
      const rute = findRute(req.method, urlPath);
      if (!rute) { sendJson(res, 404, { error: 'unknown endpoint' }); return; }
      await rute.kald(req, res, { query, params: rute.params });
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
    if (!res.headersSent) {
      // Samme form som resten af API'et, sa en genvej altid har noget at vise.
      // En 500 rober aldrig sin egen besked - den star i serverloggen.
      const KODER = { 400: 'bad_request', 413: 'too_large', 415: 'wrong_content_type' };
      apiFejl(res, status, KODER[status] || 'server_error',
        status >= 500 ? 'Something went wrong on the server.' : (err && err.message) || 'Bad request.');
    } else res.end();
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
