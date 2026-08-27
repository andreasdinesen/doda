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
const totp = require('./totp.js');
const qr = require('./qr.js');

const DATA_DIR = process.env.DATA_DIR || process.cwd();
// KUN BIND_PORT, aldrig PORT_web.
//
// Panelet injicerer PORT_<navn> og <NAVN>_PORT med den HOST-port, den har
// allokeret (25000-30000) - ikke container-porten. Container-siden er den
// konstant, runen selv erklaerer i ports.default, altsa 3000. Binder appen
// sig til host-porten inde i containeren, peger panelets mapping paa 3000,
// hvor der ikke lytter noget, og serveren er utilgaengelig.
//
// Der findes med vilje ingen env-variabel med container-porten: den er ikke
// dynamisk. BIND_PORT er kun til lokal koersel.
const BIND_PORT = Number(process.env.BIND_PORT || 3000);
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

  function m5(d) {
    d.exec(`
      CREATE TABLE recurrences (
        id         TEXT PRIMARY KEY,
        rule       TEXT NOT NULL,          -- JSON fra parse.tolkGentagelse
        mode       TEXT NOT NULL,          -- schedule | completion
        template   TEXT NOT NULL,          -- JSON: titel, note, projekt, kontekster
        next_due   TEXT NOT NULL,          -- YYYY-MM-DD, lokal dato
        next_time  TEXT,
        paused     INTEGER NOT NULL DEFAULT 0,
        skips      INTEGER NOT NULL DEFAULT 0,
        last_completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted    INTEGER NOT NULL DEFAULT 0
      );
      -- rulFrem() koeres ved hvert state-opslag; indekset gor det til et
      -- punktopslag i stedet for en scanning.
      CREATE INDEX recurrences_forfald ON recurrences(next_due)
        WHERE deleted = 0 AND paused = 0;
      CREATE INDEX items_gentagelse ON items(recurrence_id) WHERE recurrence_id IS NOT NULL;
    `);
  },

  function m6(d) {
    // Filerne ligger pa DISK i /data/files, ikke i databasen. To grunde:
    // backup streamer dem i stedet for at laese dem i hukommelsen, og
    // databasen forbliver lille nok til at kunne kopieres.
    //
    // Og indholdet kommer ALDRIG i naerheden af items-tabellen. Kokkeri
    // ramte et login-svar pa 247,9 MB, fordi billeder la i de poster,
    // listen hentede (RUNE-ERFARINGER §4).
    d.exec(`
      CREATE TABLE attachments (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        sha        TEXT NOT NULL,
        width      INTEGER,
        height     INTEGER,
        created_at INTEGER NOT NULL,
        deleted    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX attachments_item ON attachments(item_id) WHERE deleted = 0;
    `);
  },

  function m7(d) {
    d.exec(`
      CREATE TABLE credentials (
        id         TEXT PRIMARY KEY,          -- credentialId, base64url
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL,             -- SPKI PEM
        alg        TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX credentials_bruger ON credentials(user_id);
    `);
  },

  function m8(d) {
    // OAuth 2.1 til claude.ai. Webklienten kender ikke serveren pa forhand,
    // sa den skal kunne registrere sig selv og sende mig gennem et login.
    //
    // Access-tokens far IKKE deres egen tabel: de laegges i tokens med et
    // client_id og et udloeb, sa de gar gennem praecis samme findToken-vej
    // som en handlavet noegle. Én validering, ét sted at tilbagekalde.
    d.exec(`
      CREATE TABLE oauth_clients (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,          -- JSON-array, matches NOEJAGTIGT
        created_at    INTEGER NOT NULL
      );
      CREATE TABLE oauth_refresh (
        hash       TEXT PRIMARY KEY,          -- sha256, aldrig klartekst
        token_id   TEXT NOT NULL,
        client_id  TEXT NOT NULL,
        scope      TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX oauth_refresh_klient ON oauth_refresh(client_id) WHERE revoked_at IS NULL;
      ALTER TABLE tokens ADD COLUMN client_id TEXT;
      ALTER TABLE tokens ADD COLUMN expires_at INTEGER;
    `);
  },

  function m9(d) {
    // Web Push. Kun endepunktet er noedvendigt, fordi doda sender uden
    // nyttelast - noeglerne gemmes alligevel, sa en fremtidig krypteret
    // push ikke kraever, at alle abonnementer laves forfra.
    d.exec(`
      CREATE TABLE push_subs (
        id         TEXT PRIMARY KEY,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT,
        auth       TEXT,
        created_at INTEGER NOT NULL,
        last_ok    INTEGER,
        fails      INTEGER NOT NULL DEFAULT 0
      );
      -- Stemplet, saa den samme opgave ikke kan minde om sig selv hvert minut.
      ALTER TABLE items ADD COLUMN notified_at INTEGER;
    `);
  },

  function m10(d) {
    // Ét link pr. element og pr. projekt: den side, sagen egentlig lever paa.
    //
    // Feltet er BEVIDST generelt og hedder ikke notion_url. Et link til en
    // Notion-side, et Google-dokument eller en GitHub-sag er lige nyttigt, og
    // doda har ingen grund til at bage én leverandoer ind i skemaet. UI'et
    // genkender kendte vaerter og viser et paent navn - det er hele forskellen.
    d.exec(`
      ALTER TABLE items ADD COLUMN link_url TEXT;
      ALTER TABLE items ADD COLUMN link_title TEXT;
      ALTER TABLE projects ADD COLUMN link_url TEXT;
      ALTER TABLE projects ADD COLUMN link_title TEXT;
    `);
  },

  function m11(d) {
    // Hvornaar titlen sidst blev hentet fra Notion. Uden stemplet ville
    // hver aabning af en opgave vaere et kald til en fremmed tjeneste.
    d.exec(`
      ALTER TABLE items ADD COLUMN link_checked_at INTEGER;
      ALTER TABLE projects ADD COLUMN link_checked_at INTEGER;
    `);
  },

  function m12(d) {
    /*
     * Stjernen. ÉT flag, ikke niveauer.
     *
     * Andreas bad om prioritet 23-08-2026, og det, han ville, var at loefte
     * en opgave i Next Actions - ikke at maerke den. Med hoej/normal/lav skal
     * man tage stilling tre gange, og »lav« bliver et sted at gemme det, man
     * alligevel ikke laver. Ét flag har én betydning og én virkning.
     *
     * DESIGN §7 sagde »ingen prioritetsniveauer«; omgoerelsen staar samme
     * sted med begge begrundelser.
     */
    d.exec('ALTER TABLE items ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');
  },

  function m13(d) {
    /*
     * Genoprettelseskoder til totrinsbekraeftelse.
     *
     * Egen tabel, ikke en indstilling: de skal kunne bruges ÉN ad gangen, og
     * en brugt kode skal blive staaende som brugt. Hashet som et kodeord -
     * kan de laeses ud af databasen, er de ikke en noedudgang, men en ekstra
     * doer.
     */
    d.exec(`
      CREATE TABLE recovery_codes (
        hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
    `);
  },
];

/*
 * Indstillinger, der ALDRIG maa forlade serveren.
 *
 * Ét sted, brugt baade af GET /api/v1/settings og af eksporten. Ligger
 * listen to steder, glemmer man den ene, naeste gang der kommer en
 * hemmelighed til - og det opdages ikke, for alt ser ud til at virke.
 */
const HEMMELIGE_SETTINGS = new Set(['ical_token', 'notion_token', 'vapid_private', 'sagu_key',
  // TOTP-hemmeligheden ER det andet led. Kan den laeses, er 2FA'en pynt.
  'totp_secret']);

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
// Selve scriptteksten og versionsnummeret laeses samme sted. Samtykkesiden
// (OAuth) er ikke en del af SPA'en, men skal se ud som resten og foelge
// samme tema - og med den ORDRET samme scripttekst er hashen allerede givet.
let INLINE_SCRIPT_TEXT = '';
// Appens version, laest ud af index.html (build stempler den samme vaerdi i
// ?v=, i sw.js og i runens version:). Serveren har den derfor uden at skulle
// have et tal, der kan komme ud af trit med frontendens.
let APP_VERSION_FIL = '1';
/* Hvornaar index.html sidst blev laest. Se `friskVersion()`. */
let INDEX_MTIME = 0;

/**
 * Genlaeser index.html, HVIS den er skiftet siden sidst.
 *
 * Versionen blev laest én gang ved opstart. Men panelets »Opdatér app«
 * skriver app-filerne igen UDEN at genstarte containeren, og saa blev
 * serveren ved med at melde det gamle tal - beskeden »der er kommet en ny
 * version« ville aldrig dukke op, selv om der laa en ny app.js paa disken.
 * (Samme fejl fandt Sagu i sin F17.)
 *
 * Et `stat` pr. kald er billigt; at laese hele filen er det ikke - derfor kun
 * naar mtime er aendret.
 */
function friskVersion() {
  try {
    const m = fs.statSync(path.join(PUBLIC_DIR, 'index.html')).mtimeMs;
    if (m === INDEX_MTIME) return;
    INDEX_MTIME = m;
    computeInlineHash();
  } catch { /* mangler filen, staar det gamle tal - bedre end at vaelte */ }
}

function computeInlineHash() {
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const v = html.match(/style\.css\?v=(\d+)/);
    if (v) APP_VERSION_FIL = v[1];
    const m = html.match(/<script data-theme-init>([\s\S]*?)<\/script>/);
    if (!m) return;
    INLINE_SCRIPT_TEXT = m[1];
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
    // Uden worker-src falder service workeren tilbage pa child-src og derfra
    // til default-src 'none' - og bliver blokeret af vores egen CSP.
    "worker-src 'self'",
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
function readJsonBody(req, tilgivende, tilladArray) {
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

      if (erJson || raw.startsWith('{') || (tilladArray && raw.startsWith('['))) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) { resolve(tilladArray ? parsed : {}); return; }
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
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

/**
 * @param {{clientId?: string, expiresAt?: number}} [ekstra]  Saettes kun for
 *   OAuth-tokens. En haandlavet noegle har hverken klient eller udloeb.
 */
function opretToken(navn, scope, ekstra) {
  const e = ekstra || {};
  const hemmelig = crypto.randomBytes(32).toString('base64url');
  const noegle = `doda_${hemmelig}`;
  const id = newId();
  db.prepare(`INSERT INTO tokens (id, name, hash, prefix, scope, created_at, client_id, expires_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, navn, hashToken(noegle), hemmelig.slice(0, 6), scope, now(), e.clientId || null, e.expiresAt || null);
  audit(e.clientId ? 'oauth-token-udstedt' : 'noegle-oprettet', navn, scope);
  // Noeglen returneres ÉN gang og gemmes aldrig i klartekst.
  return { id, key: noegle };
}

function findToken(raa) {
  if (typeof raa !== 'string' || !raa.startsWith('doda_')) return null;
  const row = db.prepare(`
    SELECT id, name, scope, last_used_at, client_id FROM tokens
     WHERE hash = ? AND revoked_at IS NULL
       -- Uden udloebstjekket ville et OAuth-token leve evigt, uanset hvad
       -- vi lovede klienten i expires_in.
       AND (expires_at IS NULL OR expires_at > ?)`).get(hashToken(raa), now());
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
           p.link_url, p.link_title,
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

/** Ét omraade ved navn - uden hensyn til store og smaa bogstaver. */
function findOmraade(navn) {
  return db.prepare('SELECT id, name, seq FROM areas WHERE lower(name) = lower(?)').get(String(navn || ''));
}

/** Opretter et omraade. Bruges naar `:Navn` naevner et, der ikke findes. */
function opretOmraade(navn) {
  const id = newId();
  const t = now();
  const n = String(navn || '').trim().slice(0, 80);
  db.prepare('INSERT INTO areas (id, name, seq, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(id, n, 0, t, t);
  return { id, name: n, seq: 0 };
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
  i.recurrence_id, i.skipped, i.created_at, i.updated_at, i.completed_at,
  i.link_url, i.link_title, i.starred`;

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
     ORDER BY ${filter.nyesteFoerst
    ? 'i.completed_at DESC, i.created_at DESC'
    /*
     * »Sorteret efter dato og tidspunkt og/eller oprettelsestidspunkt, saa man
     * kan faa et overblik over alle opgaver« (Andreas, 26-08-2026).
     *
     * Det med en frist foerst, i kalenderorden - dét er den raekkefoelge, man
     * laeser en samlet liste i. Resten bagefter, nyest oprettet oeverst: har
     * man ingen dato at gaa efter, er »hvad lavede jeg sidst« det naeste
     * holdepunkt.
     *
     * Sorteringen skal ske i SQL og ikke i klienten: `LIMIT` klipper foer, og
     * en liste sorteret efter afklipningen ville mangle netop dét, der laa
     * forrest.
     */
    : filter.efterDato
      ? `CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END,
         i.due_date, CASE WHEN i.due_time IS NULL THEN 1 ELSE 0 END, i.due_time,
         i.created_at DESC`
      /* Stjernede foerst. Det er hele pointen med stjernen: den skal LOEFTE
         opgaven, ikke bare maerke den. Inden for hver gruppe er raekkefoelgen
         uaendret, saa den, man selv har traekket paa plads, bliver staaende. */
      : 'i.starred DESC, i.seq, i.created_at'}
     LIMIT ?`).all(...arg, Math.min(Number(filter.limit) || 500, 2000));

  return medVedhaeftningsantal(medKontekster(raekker));
}

/** Fuldtekst i titel OG beskrivelse. Afsluttede sorteres bagest, ikke bort. */
function soegItems(raa) {
  const q = String(raa || '').trim().slice(0, 200);
  if (!q) return [];
  // LIKE med escapede jokertegn - ellers kan et % i soegningen hente alt.
  const moenster = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const raekker = db.prepare(`
    SELECT ${ITEM_FELTER} FROM items i
     WHERE i.deleted = 0 AND (i.title LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\')
     ORDER BY CASE WHEN i.status IN ('done','dropped') THEN 1 ELSE 0 END,
              i.updated_at DESC
     LIMIT 40`).all(moenster, moenster);
  return medVedhaeftningsantal(medKontekster(raekker));
}

function hentItem(id) {
  const raekke = db.prepare(`SELECT ${ITEM_FELTER} FROM items i WHERE i.id = ? AND i.deleted = 0`).get(id);
  if (!raekke) return null;
  const item = medKontekster([raekke])[0];
  // Det ENKELTE element far metadata med; lister far kun et antal.
  item.attachments = hentVedhaeftninger(id);
  item.attachment_count = item.attachments.length;
  return item;
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
  // Stjernen. Gemmes som 0/1, saa den kan sorteres paa direkte i SQL.
  if (raa.starred !== undefined) ud.starred = raa.starred ? 1 : 0;
  /* Omraadet paa en OPGAVE. Kolonnen har vaeret der siden F1, men der var
     ingen vej til at saette den - hverken i brugerfladen eller her. Andreas
     bad om den 23-08-2026. `null` er et gyldigt valg: »intet omraade«. */
  if (raa.area_id === null) ud.area_id = null;
  else if (typeof raa.area_id === 'string' && raa.area_id) ud.area_id = raa.area_id;
  for (const felt of ['due_date', 'defer_date']) {
    if (raa[felt] === null) ud[felt] = null;
    else if (typeof raa[felt] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raa[felt])) ud[felt] = raa[felt];
  }
  if (raa.due_time === null) ud.due_time = null;
  else if (typeof raa.due_time === 'string' && /^\d{2}:\d{2}$/.test(raa.due_time)) ud.due_time = raa.due_time;
  if (raa.project_id === null) ud.project_id = null;
  else if (typeof raa.project_id === 'string' && findProjektId(raa.project_id)) ud.project_id = raa.project_id;
  if (raa.link_url === null || raa.link_url === '') { ud.link_url = null; ud.link_title = null; }
  else if (typeof raa.link_url === 'string') {
    const rent = rentLink(raa.link_url);
    // Kun http(s). Et javascript:-link i et felt, der bliver til et <a href>,
    // er den samme vej ind som i linkify (DESIGN.md §3).
    if (rent) {
      ud.link_url = rent;
      ud.link_title = typeof raa.link_title === 'string' ? str(raa.link_title, 200) : null;
    }
  }
  return ud;
}

/** Kun http(s), og hoejst 1000 tegn. Alt andet er ikke et link, vi vil have. */
function rentLink(raa) {
  const s = String(raa || '').trim().slice(0, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? s : null;
  } catch { return null; }
}

function findProjektId(id) {
  return db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted = 0').get(id);
}

function opretItem(felter, kontekstIder) {
  const id = newId();
  const t = now();
  const f = Object.assign({ kind: 'task', status: 'inbox', title: '', note: '' }, felter);
  // seq er et LOEBENUMMER pr. projekt, ikke et tidsstempel. Samme faelde som
  // kontekster og projekter: now() her goer manuel sortering umulig.
  const seq = f.project_id
    ? naesteSeq('items', 'WHERE project_id = ?', [f.project_id])
    : naesteSeq('items', 'WHERE project_id IS NULL');
  db.prepare(`
    INSERT INTO items (id, kind, status, title, note, project_id, area_id, due_date, due_time,
                       defer_date, waiting_for, seq, starred, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, f.kind, f.status, f.title, f.note, f.project_id || null, f.area_id || null,
      f.due_date || null, f.due_time || null, f.defer_date || null,
      f.waiting_for || '', seq, f.starred ? 1 : 0, t, t);
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

/* -------------------------------------------------------- vedhaeftninger */

const FILES_DIR = path.join(DATA_DIR, 'files');
const MAX_FIL = 25 * 1024 * 1024;          // pr. fil
const MAX_SAMLET = 2 * 1024 * 1024 * 1024; // samlet kvote

/* Kun disse vises INLINE i browseren. Alt andet - inklusive SVG, der kan
   baere script - tvinges til download. Det er den vigtigste spaerring i hele
   funktionen: en fil, brugeren selv har uploadet, ma aldrig kunne koere som
   en side pa dodas eget domaene. */
const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

function sikreFilesDir() {
  try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch (err) { logError(`kunne ikke lave files/: ${err.message}`); }
}

/** Filnavnet er KUN til visning og download - stien pa disken er altid id'et. */
function renseFilnavn(raa) {
  const n = String(raa || 'file')
    .replace(/[\x00-\x1f\x7f]/g, '')   // kontroltegn
    .replace(/[/\\]/g, '-')                  // ingen stier
    .replace(/^\.+/, '')                     // ingen skjulte filer
    .trim()
    .slice(0, 120);
  return n || 'file';
}

function filSti(id) {
  // id'et kommer fra newId() og er ren hex - men tjek alligevel, sa en
  // fremtidig aendring ikke aabner for sti-traversering.
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  return path.join(FILES_DIR, id);
}

function samletStoerrelse() {
  return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE deleted = 0').get().n;
}

function hentVedhaeftninger(itemId) {
  return db.prepare(`
    SELECT id, name, mime, size, sha, width, height, created_at
      FROM attachments WHERE item_id = ? AND deleted = 0 ORDER BY created_at`).all(itemId);
}

/** Antal pr. element i ÉT opslag - listerne ma aldrig hente metadata pr. raekke. */
function medVedhaeftningsantal(raekker) {
  if (!raekker.length) return raekker;
  const huller = raekker.map(() => '?').join(',');
  const tal = db.prepare(`
    SELECT item_id, COUNT(*) AS n FROM attachments
     WHERE deleted = 0 AND item_id IN (${huller}) GROUP BY item_id`).all(...raekker.map((r) => r.id));
  const kort = new Map(tal.map((t) => [t.item_id, t.n]));
  for (const r of raekker) r.attachment_count = kort.get(r.id) || 0;
  return raekker;
}

/**
 * Laeser en raa krop direkte til disk.
 *
 * Ikke readJsonBody: den samler alt i hukommelsen med et 2 MB-loft. En fil
 * skal streames, ellers ligger 25 MB i heapen pr. samtidig upload.
 */
function modtagFil(req, maal, maxBytes) {
  return new Promise((resolve, reject) => {
    const ud = fs.createWriteStream(maal);
    const hash = crypto.createHash('sha256');
    let size = 0;
    let stoppet = false;

    const stop = (err) => {
      if (stoppet) return;
      stoppet = true;
      ud.destroy();
      fs.unlink(maal, () => {});
      // Forbindelsen rives IKKE ned her. Gjorde man det, ville klienten se
      // "connection reset" i stedet for det 413, vi gerne vil svare - og sa
      // aner en API-klient ikke, hvorfor uploaden fejlede. Kalderen svarer
      // foerst og lukker bagefter.
      req.pause();
      reject(err);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        stop(Object.assign(new Error(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`), { status: 413 }));
        return;
      }
      hash.update(chunk);
      ud.write(chunk);
    });
    req.on('error', stop);
    req.on('end', () => {
      if (stoppet) return;
      ud.end(() => resolve({ size, sha: hash.digest('hex') }));
    });
  });
}

/* --------------------------------------------------------- gentagelser */

/*
 * Reglerne, hele motoren hviler pa (handover §5.6):
 *
 *  1. Der er ALDRIG mere end én aaben forekomst ad gangen. Naeste opstar
 *     foerst, nar den nuvaerende er lukket (udfoert eller sprunget over).
 *  2. En forekomst er USYNLIG, indtil den er aktuel. Det klares med
 *     defer_date = due_date - sa filtrerer den eksisterende naeste-liste den
 *     selv fra. Ingen saerregel noget sted.
 *  3. "Fra fuldfoerelse" regner fra den dag, jeg blev faerdig.
 *     "Fast plan" regner fra forekomstens egen forfaldsdato, og en overskredet
 *     forekomst rulles frem og TAELLES som oversprunget - det er den
 *     information, den ugentlige gennemgang lever af.
 */

function hentGentagelse(id) {
  const r = db.prepare('SELECT * FROM recurrences WHERE id = ? AND deleted = 0').get(id);
  if (!r) return null;
  r.rule = JSON.parse(r.rule);
  r.template = JSON.parse(r.template);
  return r;
}

function aabenForekomst(recurrenceId) {
  const raekke = db.prepare(`
    SELECT ${ITEM_FELTER} FROM items i
     WHERE i.recurrence_id = ? AND i.deleted = 0
       AND i.status NOT IN ('done','dropped') LIMIT 1`).get(recurrenceId);
  // Kontekster SKAL haenges pa. Uden dem faar kalderen et element, der
  // ligner alle andre, men mangler et felt - og det knaekker foerst langt
  // vaek fra her.
  return raekke ? medKontekster([raekke])[0] : null;
}

function opretForekomst(r) {
  if (aabenForekomst(r.id)) return null;
  const t = r.template;
  const item = opretItem({
    kind: 'task',
    status: 'next',
    title: t.title || '',
    note: t.note || '',
    project_id: t.project_id || null,
    due_date: r.next_due,
    due_time: r.next_time,
    // Usynlig indtil sin dato - regel 2.
    defer_date: r.next_due,
  }, t.contexts || []);
  db.prepare('UPDATE items SET recurrence_id = ? WHERE id = ?').run(r.id, item.id);
  return hentItem(item.id);
}

function opretGentagelse(regel, skabelon) {
  const id = newId();
  const t = now();
  // Foerste forekomst: naeste traef FRA OG MED i dag. naesteForekomst giver
  // strengt fremtidige datoer, sa der maales fra i gaar - sa rammer en
  // ugedags- eller maanedsregel ogsaa i dag, hvis det passer.
  //
  // "hver N. dag" er en undtagelse: den skal starte I DAG. Ellers forfalder
  // "vand planterne hver 3. dag" om to dage, hvilket ingen forventer.
  const foerste = regel.freq === 'day'
    ? iDag()
    : parse.naesteForekomst(regel, parse.fmtDato(parse.plusDage(new Date(), -1)));
  if (!foerste) return null;
  db.prepare(`
    INSERT INTO recurrences (id, rule, mode, template, next_due, next_time, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, JSON.stringify(regel), regel.mode, JSON.stringify(skabelon), foerste, regel.time || null, t, t);
  const r = hentGentagelse(id);
  opretForekomst(r);
  return r;
}

/** Lukker en forekomst og aabner den naeste. */
function rykGentagelse(r, fraDato, taelSomSprunget) {
  /*
   * »Fra fuldfoerelse« skal ogsaa flytte den DAG, reglen haenger paa.
   *
   * `every! month` har ingen dag i teksten, saa maanedsdagen udledes af
   * ankeret - datoen da reglen blev skrevet. Blev den lavet den 22., stod der
   * `monthday: 22` i reglen for altid, og selv om serveren regnede FRA i dag,
   * gav `naesteForekomst` den 22. i naeste maaned. Andreas fuldfoerte den 23.
   * og fik den 22. tilbage.
   *
   * Derfor gentolkes reglen med fuldfoerelsesdatoen som anker. TEKSTEN er
   * uaendret; kun de felter, der ER udledt af ankeret, flytter sig - og siger
   * frasen selv en dag (»every! month on the 22nd«), bliver den staaende.
   *
   * Den gentolkede regel GEMMES, ellers ville overskriften blive ved med at
   * sige »on the 22nd«, mens forfaldet laa den 23.
   */
  let regel = r.rule;
  if (regel && regel.mode === 'completion' && regel.text) {
    const paany = parse.tolkGentagelse(regel.text, fraDato);
    if (paany) regel = paany;
  }
  const naeste = parse.naesteForekomst(regel, fraDato);
  if (!naeste) return null;
  db.prepare(`
    UPDATE recurrences SET rule = ?, next_due = ?, skips = skips + ?, last_completed_at = ?, updated_at = ?
     WHERE id = ?`).run(JSON.stringify(regel), naeste, taelSomSprunget ? 1 : 0, taelSomSprunget ? r.last_completed_at : now(), now(), r.id);
  const opdateret = hentGentagelse(r.id);
  // Sat pa pause: reglen bevares, men der laves ingen ny forekomst.
  if (opdateret.paused) return null;
  return opretForekomst(opdateret);
}

/**
 * Ruller overskredne FASTE planer frem. En forekomst, der aldrig blev lavet,
 * forsvinder ikke i det stille - hvert spring taelles.
 */
function rulFrem() {
  const idag = iDag();
  const raekker = db.prepare(`
    SELECT id FROM recurrences
     WHERE deleted = 0 AND paused = 0 AND mode = 'schedule' AND next_due < ?`).all(idag);
  for (const { id } of raekker) {
    const r = hentGentagelse(id);
    if (!r) continue;
    let d = r.next_due;
    let spring = 0;
    // Loft pa 500 - en regel med et vanvittigt interval ma ikke kunne
    // laase serveren i en uendelig loekke.
    while (d < idag && spring < 500) {
      const n = parse.naesteForekomst(r.rule, d);
      if (!n || n === d) break;
      d = n;
      spring++;
    }
    if (!spring) continue;
    db.prepare('UPDATE recurrences SET next_due = ?, skips = skips + ?, updated_at = ? WHERE id = ?')
      .run(d, spring, now(), id);
    const aaben = aabenForekomst(id);
    if (aaben) {
      db.prepare('UPDATE items SET due_date = ?, defer_date = ?, skipped = skipped + ?, updated_at = ? WHERE id = ?')
        .run(d, d, spring, now(), aaben.id);
    } else {
      opretForekomst(hentGentagelse(id));
    }
  }
}

function hentGentagelser() {
  rulFrem();
  return db.prepare('SELECT * FROM recurrences WHERE deleted = 0 ORDER BY next_due').all().map((r) => {
    const regel = JSON.parse(r.rule);
    const skabelon = JSON.parse(r.template);
    const aaben = aabenForekomst(r.id);
    return {
      id: r.id,
      title: skabelon.title,
      description: parse.beskrivGentagelse(regel),
      mode: r.mode,
      rule: regel,
      next_due: r.next_due,
      next_time: r.next_time,
      paused: !!r.paused,
      skips: r.skips,
      last_completed_at: r.last_completed_at,
      project_id: skabelon.project_id || null,
      /*
       * Skabelonens kontekster kunne saettes gennem API'et, men blev aldrig
       * sendt UD igen - saa ruden kunne hverken vise eller rette dem.
       *
       * PRAECIS det samme gjaldt `note`: den blev gemt, og hver forekomst fik
       * den med (`opretForekomst`), men den kom aldrig tilbage, saa der var
       * ingen vej til at se eller skrive en beskrivelse paa en gentagelse
       * (Andreas, 25-08-2026). Samme fejl, samme sted, to gange - et felt, der
       * kan SAETTES uden at kunne LAESES, er usynligt for den, der bruger det.
       */
      contexts: Array.isArray(skabelon.contexts) ? skabelon.contexts : [],
      note: skabelon.note || '',
      open_item_id: aaben ? aaben.id : null,
      due_today: !!aaben && aaben.due_date <= iDag(),
    };
  });
}

/**
 * Omsaetter en fangst-tekst til et element.
 * Ukendte kontekster og projekter kraever bekraeftelse (handover §5.1),
 * medmindre kalderen udtrykkeligt beder om at oprette dem.
 */
/*
 * Skaermen, brugeren staar paa, maa UDFYLDE - aldrig bestemme.
 *
 * Gaar man ind i Waiting For eller Someday og skriver, har man taget
 * beslutningen ved at gaa derhen; at sende den til inbox betyder, at man skal
 * tage den igen senere. Det samme gaelder en projektside og en kontekst-filtreret
 * liste (DESIGN.md §3). Men teksten vinder altid: skriver man @NogetAndet,
 * er det dét, der gaelder - ellers ville skaermen kunne overskrive noget,
 * brugeren udtrykkeligt har skrevet.
 *
 * Kun disse to statusser kan en skaerm implicere. "next" kan den ikke: noget,
 * der falder én ind midt i arbejdet, er ikke afklaret, fordi man stod paa
 * listen over afklaret arbejde.
 */
const SKAERM_STATUS = ['waiting', 'someday'];

function skaermensUdfyldning(fra) {
  const ud = { status: null, projektId: null, kontekstId: null };
  if (!fra || typeof fra !== 'object') return ud;
  if (typeof fra.status === 'string' && SKAERM_STATUS.includes(fra.status)) ud.status = fra.status;
  if (typeof fra.project === 'string'
    && db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted = 0').get(fra.project)) {
    ud.projektId = fra.project;
  }
  if (typeof fra.context === 'string'
    && db.prepare('SELECT 1 FROM contexts WHERE id = ?').get(fra.context)) {
    ud.kontekstId = fra.context;
  }
  return ud;
}

function fangst(tekst, opretNye, fra) {
  const tolket = parse.tolkFangst(tekst);
  if (!tolket.title && !tolket.note) return { fejl: 'der er ingen tekst at fange' };
  const skaerm = skaermensUdfyldning(fra);

  const manglerKontekster = tolket.contexts.filter((n) => !findKontekst(n));
  const manglerProjekt = tolket.project && !findProjekt(tolket.project) ? tolket.project : null;
  const manglerOmraade = tolket.area && !findOmraade(tolket.area) ? tolket.area : null;

  if (!opretNye && (manglerKontekster.length || manglerProjekt || manglerOmraade)) {
    return {
      skalBekraeftes: { contexts: manglerKontekster, project: manglerProjekt, area: manglerOmraade },
      tolket,
    };
  }

  const kontekstIder = tolket.contexts.map((n) => (findKontekst(n) || opretKontekst(n)).id);
  let projektId = null;
  if (tolket.project) projektId = (findProjekt(tolket.project) || opretProjekt(tolket.project)).id;
  // `:Navn` paa en opgave. Omraadet er opgavens EGET - det arves ikke fra
  // projektet, og et projekt uden omraade overskriver ikke et, man har skrevet.
  const omraadeId = tolket.area ? (findOmraade(tolket.area) || opretOmraade(tolket.area)).id : null;

  // Skaermen udfylder kun det, teksten TAV om.
  if (!projektId && skaerm.projektId) projektId = skaerm.projektId;
  if (!kontekstIder.length && skaerm.kontekstId) kontekstIder.push(skaerm.kontekstId);

  // Er der en gentagelsesregel, oprettes en GENTAGELSE - ikke en loes opgave.
  // Dens foerste forekomst laves med det samme, sa der altid er praecis én.
  if (tolket.recurrenceText) {
    const regel = parse.tolkGentagelse(tolket.recurrenceText);
    if (!regel) {
      return { fejl: `Could not understand the repeat rule "${tolket.recurrenceText}".` };
    }
    const r = opretGentagelse(regel, {
      title: tolket.title.slice(0, GRAENSER.title),
      note: tolket.note.slice(0, GRAENSER.note),
      project_id: projektId,
      contexts: kontekstIder,
    });
    if (!r) return { fejl: 'That repeat rule never comes around.' };
    return { item: aabenForekomst(r.id), recurrence: r, tolket };
  }

  /*
   * Stadiet: dét, brugeren SELV har sagt, foerst.
   *
   * `>waiting` slaar skaermen, og skaermen slaar inbox. En note er reference,
   * ikke en handling - den skal aldrig ligge og vente paa afklaring
   * (handover §4), og hverken en markoer eller en skaerm kan aendre det.
   */
  let status = tolket.kind === 'note' ? 'queued' : (tolket.status || skaerm.status || 'inbox');
  let defer = tolket.defer;

  /*
   * En DATO er en beslutning (Andreas, 26-08-2026).
   *
   * Har man skrevet `!fredag`, har man allerede afgjort, at opgaven skal
   * goeres - saa hoerer den ikke hjemme i inbox og vente paa at blive afklaret
   * én gang til. Den lander i Next Actions og SKJULER sig til dagen; ellers
   * ville alt fremtidigt ligge og fylde i den liste, der skal svare paa »hvad
   * kan jeg goere NU«.
   *
   * Kun naar brugeren ikke selv har valgt: `>waiting !fredag` er et bevidst
   * valg om at vente, og det maa en automatik ikke overskrive. Et `~udskyd`
   * vinder af samme grund over den dato, vi ellers ville gemme den til.
   */
  if (tolket.kind !== 'note' && tolket.due && !tolket.status && !skaerm.status) {
    status = 'next';
    if (!defer) defer = tolket.due.dato;
  }

  const item = opretItem({
    kind: tolket.kind,
    status,
    title: tolket.title.slice(0, GRAENSER.title),
    note: tolket.note.slice(0, GRAENSER.note),
    project_id: projektId,
    area_id: omraadeId,
    due_date: tolket.due ? tolket.due.dato : null,
    due_time: tolket.due ? tolket.due.tid : null,
    defer_date: defer,
  }, kontekstIder);

  return { item, tolket };
}

/* --------------------------------------------------------------- ruter */

/*
 * Notesboegerne gemmes, saa »hvor skal noten ligge« ikke koster et kald hver
 * gang dialogen aabnes. Bruges af BAADE connect og refresh - de to maa ikke
 * kunne drive fra hinanden, for den ene halvdel er let at glemme:
 *
 * findes den valgte notesbog ikke laengere, ryddes valget. Ellers ville
 * noterne lande i en bog, der er slettet, og INTET ville fejle.
 */
function gemNotesboeger(boeger) {
  const liste = boeger || [];
  setSetting('sagu_notebooks', JSON.stringify(liste));
  const valgt = getSetting('sagu_notebook', '');
  if (valgt && !liste.some((b) => b.id === valgt)) {
    db.prepare("DELETE FROM settings WHERE key = 'sagu_notebook'").run();
  }
}

const ROUTES = {
  'GET /api/public-config': (req, res) => {
    sendJson(res, 200, {
      appName: APP_NAME,
      // Den version, SERVEREN udleverer. Stemmer den ikke med den
      // APP_VERSION, browseren koerer, sidder der en gammel app.js i cachen
      // - og sa skal brugeren vide det frem for at lede efter en funktion,
      // der ikke er indlaest.
      // Frisk fra disken, hvis app-filerne er skiftet under os.
      version: (friskVersion(), Number(APP_VERSION_FIL)),
      // Naar der ingen bruger er, skal foerste-gangs-opsaetningen vises.
      needsSetup: userCount() === 0,
      secureContext: isHttps(req),
      dev: DEV,
      passkeys: !passkeySpaerre(req),
      hasPasskeys: db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n > 0,
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
    /*
     * Kodeordet passede. Er totrinsbekraeftelse slaaet til, er vi kun HALVVEJS.
     *
     * Der udstedes ingen session, foer koden er set. Et halvt login maa ikke
     * give adgang til noget - heller ikke til at laese, hvem man er.
     */
    if (getSetting('totp_enabled', '') === '1') {
      const kode = typeof body.code === 'string' ? body.code : '';
      if (!kode) {
        // IKKE en fejl: klienten skal kunne se forskel paa "forkert kodeord"
        // og "der mangler ét trin mere".
        sendJson(res, 200, { needsCode: true });
        return;
      }
      const svar = tjekAndetTrin(kode);
      if (!svar.ok) {
        logSecurity(`totp-fejl ip=${ip}`);
        audit('login-totp-fejl', row.username, ip);
        // Samme spand som kodeordet: ellers kunne man proeve seks cifre
        // igennem uden at loebe ind i en graense.
        // Husets form: {error: kode, message: tekst}. `bad_code` er dét, der
        // fortaeller klienten, at kodefeltet skal blive staaende - modsat et
        // forkert kodeord, hvor det skal foldes vaek igen.
        sendJson(res, 401, {
          error: 'bad_code',
          message: svar.fejl || 'That code did not match.',
          needsCode: true,
        });
        return;
      }
      if (svar.recovery) {
        audit('login-genoprettelseskode', row.username, ip);
        logSecurity(`genoprettelseskode brugt ip=${ip} - ${svar.tilbage} tilbage`);
      }
    }

    rateClear(bucket);
    audit('login', row.username, ip);
    const token = createSession(row.id);
    sendJson(res, 200, { user: { id: row.id, username: row.username } },
      { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
  },

  /* --- totrinsbekraeftelse -------------------------------------------- */

  'GET /api/v1/totp': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    // Aldrig hemmeligheden. Kun OM den er der, og hvor mange noedudgange der
    // er tilbage - det sidste skal man kunne se uden at finde papiret frem.
    sendJson(res, 200, {
      enabled: getSetting('totp_enabled', '') === '1',
      pending: !!getSetting('totp_secret', '') && getSetting('totp_enabled', '') !== '1',
      recoveryLeft: db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL').get().n,
    });
  },

  /*
   * Start opsaetningen: lav en hemmelighed og vis den ÉN gang.
   *
   * Den gemmes med det samme, men `totp_enabled` saettes foerst, naar en kode
   * er set. Ellers kunne man laase sig selv ude ved at lukke fanen midtvejs -
   * og der er ingen supportafdeling at ringe til paa sin egen server.
   */
  'POST /api/v1/totp/setup': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    await readJsonBody(req);
    if (getSetting('totp_enabled', '') === '1') {
      apiFejl(res, 400, 'already_on', 'Two-step is already on. Turn it off first.');
      return;
    }
    const hem = totp.nyHemmelighed();
    setSetting('totp_secret', hem);
    db.prepare("DELETE FROM settings WHERE key = 'totp_last'").run();
    audit('totp-opsaetning-startet', user.username, clientIp(req));
    const uri = totp.otpauth(hem, user.username, 'doda');
    /* QR'en laves paa SERVEREN og sendes som faerdig SVG. Alternativet var et
       bibliotek i browseren fra et fremmed domaene - og hemmeligheden skal
       ikke forbi nogen tredjepart for at blive tegnet. */
    let svg = '';
    try { svg = qr.tilSvg(uri, { px: 200 }); }
    catch (err) { logError(`qr fejlede: ${err.message}`); }
    sendJson(res, 200, { secret: hem, uri, qr: svg });
  },

  /*
   * Bekraeft med en kode - foerst DER er den slaaet til.
   *
   * Genoprettelseskoderne laves her og vises ÉN gang. De gemmes hashet, saa
   * de kan ikke hentes frem igen; vil man have nye, laver man nye.
   */
  'POST /api/v1/totp/enable': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const hem = getSetting('totp_secret', '');
    if (!hem) { apiFejl(res, 400, 'no_setup', 'Start the setup first.'); return; }
    const ip = clientIp(req);
    if (!rateAllow(`totp:${ip}`, 15, 900)) {
      apiFejl(res, 429, 'rate_limited', 'Too many attempts. Try again shortly.');
      return;
    }
    const vindue = totp.tjek(hem, typeof body.code === 'string' ? body.code : '');
    if (vindue === null) {
      logSecurity(`totp-opsaetning-fejl ip=${ip}`);
      apiFejl(res, 400, 'bad_code', 'That code did not match. Check the time on your phone.');
      return;
    }
    setSetting('totp_enabled', '1');
    setSetting('totp_last', String(vindue));
    const koder = totp.nyeKoder(10);
    db.exec('DELETE FROM recovery_codes');
    const ind = db.prepare('INSERT INTO recovery_codes (hash, created_at, used_at) VALUES (?,?,NULL)');
    for (const k of koder) ind.run(totp.hashKode(k), now());
    audit('totp-slaaet-til', user.username, ip);
    sendJson(res, 200, { enabled: true, recovery: koder });
  },

  /*
   * Slaa fra - men kun mod kodeordet.
   *
   * En aaben session er ikke nok: har nogen faaet fat i en ulaast skaerm,
   * skal de ikke kunne fjerne det andet trin med ét klik.
   */
  'POST /api/v1/totp/disable': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const row = db.prepare('SELECT password FROM users WHERE id = ?').get(user.id);
    if (!row || !verifyPassword(typeof body.password === 'string' ? body.password : '', row.password)) {
      logSecurity(`totp-fra-uden-kodeord ip=${clientIp(req)}`);
      apiFejl(res, 401, 'bad_password', 'That password is not right.');
      return;
    }
    db.prepare("DELETE FROM settings WHERE key IN ('totp_secret','totp_enabled','totp_last')").run();
    db.exec('DELETE FROM recovery_codes');
    audit('totp-slaaet-fra', user.username, clientIp(req));
    sendJson(res, 200, { enabled: false });
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
    // Overskredne faste planer rulles frem, foer der taelles - ellers viser
    // taellerne noget, der ikke passer med listerne.
    rulFrem();
    /*
     * Hvert tal spejler sin LISTE - ikke bare sin status.
     *
     * `GROUP BY status` med ét faelles defer-filter var naesten rigtigt og
     * derfor svaert at opdage: Inbox VISER ogsaa `queued` (en opgave kan have
     * faaet den, se p3_lists), mens Waiting og Someday henter UDEN
     * `hideDeferred` og altsaa ogsaa viser det udskudte. Taelleren sagde
     * dermed noget andet end listen, den staar ved siden af.
     *
     * En taeller, der ikke passer med det, man ser, naar man klikker, er
     * vaerre end ingen taeller. Andreas bad om tal paa resten af punkterne
     * 25-08-2026 - og saa skal de vaere rigtige.
     *
     * `kind = 'task'` overalt: noterne har deres eget punkt og deres eget tal.
     */
    const idag = iDag();
    const taelStatus = db.prepare(`SELECT COUNT(*) AS n FROM items
       WHERE deleted = 0 AND kind = 'task' AND status = ?`);
    const antal = {
      // Som listen: inbox OG queued, uden defer-filter.
      inbox: db.prepare(`SELECT COUNT(*) AS n FROM items
         WHERE deleted = 0 AND kind = 'task' AND status IN ('inbox','queued')`).get().n,
      // Som listen: kun det, der ikke er skjult til senere.
      next: db.prepare(`SELECT COUNT(*) AS n FROM items
         WHERE deleted = 0 AND kind = 'task' AND status = 'next'
           AND (defer_date IS NULL OR defer_date <= ?)`).get(idag).n,
      waiting: taelStatus.get('waiting').n,
      someday: taelStatus.get('someday').n,
      // Samme graense som Logbook - ellers ville toplinjen blive ved med at
      // taelle det, listen lige har lagt bag sig.
      done: (() => {
        const fra = logbookFra();
        return fra
          ? db.prepare(`SELECT COUNT(*) AS n FROM items WHERE deleted = 0 AND kind = 'task'
               AND status = 'done' AND completed_at > ?`).get(fra).n
          : taelStatus.get('done').n;
      })(),
    };
    sendJson(res, 200, {
      contexts: hentKontekster(),
      projects: hentProjekter(),
      areas: hentOmraader(),
      counts: antal,
      today: iDag(),
      reviewDue: gennemgangForfalder(),
      notesEnabled: getSetting('notes_off', '') !== '1',
      // Hvor mange noter der ER - saa indstillingen kan sige sandheden om,
      // hvad der sker med dem, i stedet for at lade brugeren gaette.
      noteCount: db.prepare("SELECT COUNT(*) AS n FROM items WHERE kind = 'note' AND deleted = 0").get().n,
      // Toplinjen tegnes ved opstart, saa valget maa med HER - Settings-siden
      // hentes foerst, naar man gaar derind, og saa ville tallet naa at blinke.
      hideDone: getSetting('hide_done', '') === '1',
    });
  },

  'GET /api/v1/items': (req, res, ctx) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const q = ctx.query;
    // Samme tekstvej som /next og /search - en fanget opgave lander i Inbox,
    // og saa skal den kunne SES fra en klient uden JSON-parser.
    if (q.get('format') === 'text') {
      sendTekst(res, tekstListe(hentItems({
        status: q.get('status'),
        kind: q.get('kind'),
        project: q.get('project'),
        context: q.get('context'),
        limit: q.get('limit'),
        skjulUdskudte: q.get('hideDeferred') === '1',
        nyesteFoerst: q.get('newest') === '1',
        efterDato: q.get('sort') === 'due',
      }), 'Nothing here.'));
      return;
    }
    sendJson(res, 200, {
      items: hentItems({
        status: q.get('status'),
        kind: q.get('kind'),
        project: q.get('project'),
        context: q.get('context'),
        limit: q.get('limit'),
        skjulUdskudte: q.get('hideDeferred') === '1',
        nyesteFoerst: q.get('newest') === '1',
        // `sort=due`: frister i kalenderorden foerst, resten nyest oeverst.
        efterDato: q.get('sort') === 'due',
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
    // `from` er skaermen, webappen staar paa. En klient uden skaerm (en
    // iOS-genvej, Claude) sender den ikke, og saa er inbox stadig svaret.
    const svar = fangst(tekst, opretNye, body.from);
    if (svar.fejl) { apiFejl(res, 400, 'no_text', svar.fejl); return; }
    if (svar.skalBekraeftes) {
      sendJson(res, 200, { needsConfirm: svar.skalBekraeftes, parsed: svar.tolket });
      return;
    }
    if (auth.viaToken) audit('fangst-via-api', auth.token.name, svar.item.title.slice(0, 80));
    const linje = svar.recurrence
      ? `Added: ${svar.item.title} — ${parse.beskrivGentagelse(svar.recurrence.rule)}`
      : `Added: ${svar.item.title}`;
    if (ctx.query.get('format') === 'text') {
      /* Hele tolkningen med, ikke bare titlen: skrev man `!i morgen`, vil man
         se, at den blev forstaaet - ellers opdages en tastefejl foerst i appen. */
      const dele = [linje];
      const t = svar.item;
      if (t.due_date) dele.push(`Due: ${t.due_date}${t.due_time ? ` ${t.due_time}` : ''}`);
      if (t.contexts && t.contexts.length) dele.push(`Contexts: ${t.contexts.map((c) => `#${c.name}`).join(' ')}`);
      if (t.project_id) {
        const pr = hentProjekter().find((x) => x.id === t.project_id);
        if (pr) dele.push(`Project: ${pr.name}`);
      }
      sendTekst(res, dele.join('\n'));
      return;
    }
    sendJson(res, 200, {
      item: svar.item,
      recurrence: svar.recurrence || null,
      parsed: svar.tolket,
      // Genveje viser gerne et svar. Giv dem én faerdig linje.
      message: svar.recurrence
        ? `Added: ${svar.item.title} — ${parse.beskrivGentagelse(svar.recurrence.rule)}`
        : `Added: ${svar.item.title}`,
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
    if (!felter.title && !felter.note) { apiFejl(res, 400, 'no_text', 'An item needs a title or a note.'); return; }
    const kontekstIder = Array.isArray(body.contexts)
      ? body.contexts.filter((id) => typeof id === 'string' && db.prepare('SELECT 1 FROM contexts WHERE id = ?').get(id))
      : [];
    sendJson(res, 200, { item: opretItem(felter, kontekstIder) });
  },

  'GET /api/v1/search': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const items = soegItems(ctx.query.get('q'));
    // Som /next: en klient uden JSON-parser skal kunne vise svaret direkte.
    // Raycasts script-kommandoer er ren `curl` og har hverken jq eller python
    // at regne med (Andreas, 25-08-2026).
    if (ctx.query.get('format') === 'text') { sendTekst(res, tekstListe(items, 'Nothing found.')); return; }
    sendJson(res, 200, { items });
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
      sendTekst(res, tekstListe(items, 'Nothing to do right now.'));
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

  /*
   * Start Logbook forfra.
   *
   * Der SLETTES ikke. Graensen er et tidsstempel, saa listen og taelleren
   * begynder herfra, mens opgaverne bliver liggende og kommer med i en
   * eksport. Fortrydes ved at nulstille graensen igen (`clear: true`).
   *
   * Andreas bad om begge dele 25-08-2026: den her til at rydde skaermen, og
   * DELETE herunder til at komme af med testdata for altid.
   */
  'POST /api/v1/logbook/reset': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    if (body && body.clear) {
      db.prepare("DELETE FROM settings WHERE key = 'logbook_reset'").run();
      audit('logbook-nulstilling-fjernet', null, clientIp(req));
      sendJson(res, 200, { reset: 0, hidden: 0 });
      return;
    }
    const t = now();
    const skjulte = db.prepare(`SELECT COUNT(*) AS n FROM items
       WHERE deleted = 0 AND status IN ('done','dropped') AND completed_at IS NOT NULL
         AND completed_at <= ?`).get(t).n;
    setSetting('logbook_reset', String(t));
    audit('logbook-nulstillet', null, clientIp(req));
    log(`logbook nulstillet - ${skjulte} afsluttede skjult (ikke slettet)`);
    sendJson(res, 200, { reset: t, hidden: skjulte });
  },

  /*
   * Slet de afsluttede opgaver for ALTID.
   *
   * `deleted = 1` og ikke DELETE FROM: synkroniseringen skal kunne fortaelle
   * andre enheder, at de er vaek (`/api/v1/changes` sender `deleted`-id'er).
   * Slettede raekker ryddes for alvor af `sweep()`.
   *
   * Kun `done` og `dropped` - det aabne arbejde roeres aldrig, uanset hvad
   * kalderen sender.
   */
  'DELETE /api/v1/logbook': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    await readJsonBody(req, auth.viaToken);
    const t = now();
    const r = db.prepare(`UPDATE items SET deleted = 1, updated_at = ?
       WHERE deleted = 0 AND status IN ('done','dropped')`).run(t);
    /* Graensen giver ikke laengere mening, naar der intet er at skjule - og
       stod den tilbage, ville nye afsluttede opgaver blive gemt vaek af den. */
    db.prepare("DELETE FROM settings WHERE key = 'logbook_reset'").run();
    audit('logbook-slettet', null, clientIp(req));
    log(`logbook slettet permanent - ${r.changes} opgave(r)`);
    sendJson(res, 200, { deleted: r.changes });
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

  /* Logbogen: kronologisk, filtrerbar - og med vilje UDEN statistik.
     Formalet er tilfredsstillelse og overblik ved den ugentlige gennemgang,
     ikke en produktivitetsscore (handover §5.8 + §10). */
  'GET /api/v1/logbook': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const hvor = ["i.deleted = 0", "i.status IN ('done','dropped')", 'i.completed_at IS NOT NULL'];
    const arg = [];
    // Nulstillingen gaelder BEGGE steder - listen her og tallet i toplinjen.
    // Se `logbookFra()`; stod graensen to steder, ville de skride fra hinanden.
    const fra = logbookFra();
    if (fra) { hvor.push('i.completed_at > ?'); arg.push(fra); }
    const siden = Number(ctx.query.get('since'));
    if (Number.isFinite(siden) && siden > 0) { hvor.push('i.completed_at >= ?'); arg.push(siden); }
    const projekt = ctx.query.get('project');
    if (projekt) { hvor.push('i.project_id = ?'); arg.push(projekt); }
    const raekker = db.prepare(`
      SELECT ${ITEM_FELTER} FROM items i
       WHERE ${hvor.join(' AND ')}
       ORDER BY i.completed_at DESC
       LIMIT ?`).all(...arg, Math.min(Number(ctx.query.get('limit')) || 200, 1000));
    sendJson(res, 200, { items: medVedhaeftningsantal(medKontekster(raekker)) });
  },

  /* Alt den ugentlige gennemgang skal bruge, i ÉT kald. Trinene skal kunne
     bladres igennem uden at vente pa serveren hver gang. */
  'GET /api/v1/review': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    rulFrem();
    const uge = now() - 7 * 86400;
    const projekter = hentProjekter().filter((p) => p.status === 'active');
    // Ugens tal. Det er FAKTA til gennemgangen, ikke en score: ingen streaks,
    // ingen grafer, ingen sammenligning med sidste uge (DESIGN.md §7). Har man
    // fanget tyve og afklaret to, er det den samtale, gennemgangen skal starte.
    //
    // "processed" er et skoen: fanget i denne uge og ikke laengere i inbox.
    // Der findes ingen historik at spoerge, og et tal, der ser praecist ud,
    // maa ikke vaere det uden at vaere det - derfor hedder det ogsaa
    // "captured and clarified" i UI'et.
    const uges = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM items WHERE deleted = 0 AND created_at >= ?) AS captured,
        (SELECT COUNT(*) FROM items WHERE deleted = 0 AND completed_at >= ? AND status = 'done') AS completed,
        (SELECT COUNT(*) FROM items WHERE deleted = 0 AND created_at >= ? AND status != 'inbox') AS processed`)
      .get(uge, uge, uge);

    let fokus = [];
    try { fokus = JSON.parse(getSetting('review_focus', '[]')); } catch { fokus = []; }

    sendJson(res, 200, {
      step: Number(getSetting('review_step', '0')) || 0,
      mode: getSetting('review_mode', 'simple'),
      focus: Array.isArray(fokus) ? fokus : [],
      week: uges,
      startedAt: Number(getSetting('review_started', '0')) || 0,
      lastDone: Number(getSetting('review_done', '0')) || 0,
      weekday: Number(getSetting('review_weekday', '0')) || 0,
      time: getSetting('review_time', '10:00'),
      // Standard FRA. Handover §5.12: saa faa notifikationer som muligt, og
      // en frisk installation skal ikke begynde at sende af sig selv.
      push: getSetting('review_push', '') === '1',
      inbox: hentItems({ status: 'inbox' }),
      // Netop de projekter, der er den klassiske GTD-fejl.
      stalled: projekter.filter((p) => !p.next_count && p.open_count > 0),
      projects: projekter,
      waiting: hentItems({ status: 'waiting' }),
      someday: hentItems({ status: 'someday' }),
      // Gentagelser der springes over gang pa gang - det er her man opdager,
      // at en vane ikke virker.
      skipped: hentGentagelser().filter((r) => r.skips > 0).sort((a, b) => b.skips - a.skips),
      done: hentItems({ status: 'done', nyesteFoerst: true, limit: 200 })
        .filter((i) => i.completed_at && i.completed_at >= uge),
    });
  },

  'POST /api/v1/review': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    if (body.action === 'start') {
      // Maaden ligger paa serveren ved siden af trinnet - ellers kunne man
      // genoptage en gennemgang og pludselig gaa en anden vej igennem.
      if (['speed', 'simple', 'focused'].includes(body.mode)) setSetting('review_mode', body.mode);
      if (Array.isArray(body.focus)) {
        const gyldige = body.focus.filter((id) => typeof id === 'string' && findProjektId(id)).slice(0, 50);
        setSetting('review_focus', JSON.stringify(gyldige));
      }
      setSetting('review_step', '1');
      setSetting('review_started', String(now()));
    } else if (body.action === 'focus') {
      // Valget af ugens projekter er sit eget trin i "focused".
      const gyldige = Array.isArray(body.focus)
        ? body.focus.filter((id) => typeof id === 'string' && findProjektId(id)).slice(0, 50) : [];
      setSetting('review_focus', JSON.stringify(gyldige));
    } else if (body.action === 'finish') {
      setSetting('review_step', '0');
      setSetting('review_done', String(now()));
      // Hvert projekt husker, hvornaar det sidst blev gennemgaet (§5.7).
      db.prepare("UPDATE projects SET reviewed_at = ? WHERE deleted = 0 AND status = 'active'").run(now());
    } else if (body.action === 'abandon') {
      setSetting('review_step', '0');
    } else if (Number.isFinite(Number(body.step))) {
      // Gennemgangen skal kunne afbrydes og genoptages fra SAMME sted, ogsaa
      // hvis browseren lukkes - derfor ligger trinnet pa serveren.
      // Loftet foelger den laengste maade (focused: valg + seks trin).
      setSetting('review_step', String(Math.max(0, Math.min(7, Number(body.step)))));
    }
    let fokusEfter = [];
    try { fokusEfter = JSON.parse(getSetting('review_focus', '[]')); } catch { fokusEfter = []; }
    sendJson(res, 200, {
      step: Number(getSetting('review_step', '0')) || 0,
      mode: getSetting('review_mode', 'simple'),
      focus: Array.isArray(fokusEfter) ? fokusEfter : [],
      lastDone: Number(getSetting('review_done', '0')) || 0,
    });
  },

  /* Eksport virker bade fra UI'et og via API'et - Andreas' krav. En genvej
     eller et script kan tage en kopi uden at aabne browseren. */
  'POST /api/webauthn/register/options': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    await readJsonBody(req);
    const spaerre = passkeySpaerre(req);
    if (spaerre) { apiFejl(res, 400, 'insecure_context', spaerre); return; }
    sendJson(res, 200, webauthn.registerOptions(req, user));
  },

  'POST /api/webauthn/register/verify': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    try {
      const c = webauthn.registerVerify(req, user, body);
      db.prepare(`
        INSERT OR REPLACE INTO credentials (id, user_id, name, public_key, alg, sign_count, created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(c.id, user.id, str(body.name, 60) || 'Passkey', c.publicKey, c.alg, c.signCount, now());
      audit('passkey-oprettet', user.username, clientIp(req));
      sendJson(res, 200, { credentials: hentCredentials(user.id) });
    } catch (err) {
      logSecurity(`passkey-registrering-fejl ip=${clientIp(req)}`);
      apiFejl(res, 400, 'passkey_failed', err.message);
    }
  },

  // Login kraever IKKE en session - det er hele pointen.
  'POST /api/webauthn/login/options': async (req, res) => {
    await readJsonBody(req);
    const spaerre = passkeySpaerre(req);
    if (spaerre) { apiFejl(res, 400, 'insecure_context', spaerre); return; }
    sendJson(res, 200, webauthn.loginOptions(req));
  },

  'POST /api/webauthn/login/verify': async (req, res) => {
    const body = await readJsonBody(req);
    const ip = clientIp(req);
    if (!rateAllow(`passkey:${ip}`, 20, 900)) {
      logSecurity(`login-spaerret ip=${ip}`);
      apiFejl(res, 429, 'rate_limited', 'Too many attempts - try again shortly.');
      return;
    }
    try {
      const { credential, signCount } = webauthn.loginVerify(req, body);
      const bruger = db.prepare('SELECT id, username FROM users WHERE id = ?').get(credential.user_id);
      if (!bruger) throw new Error('ukendt bruger');
      db.prepare('UPDATE credentials SET sign_count = ?, last_used_at = ? WHERE id = ?')
        .run(signCount, now(), credential.id);
      audit('login-passkey', bruger.username, ip);
      const token = createSession(bruger.id);
      sendJson(res, 200, { user: bruger },
        { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
    } catch (err) {
      logSecurity(`login-fejl ip=${ip}`);
      apiFejl(res, 401, 'passkey_failed', err.message);
    }
  },

  'GET /api/v1/passkeys': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { credentials: hentCredentials(user.id), blocked: passkeySpaerre(req) });
  },

  'GET /api/v1/export': (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const medFiler = ctx.query.get('files') === '1';
    // ?files=1 laeser ALT filindhold i hukommelsen som base85... base64, hvilket
    // fylder 4/3. Kokkeri gik ned ad praecis den vej (247,9 MB i ét svar), sa
    // her er der en haard spaerre med en besked, der peger pa den rigtige vej.
    if (medFiler) {
      const bytes = samletStoerrelse();
      if (bytes > 150 * 1024 * 1024) {
        apiFejl(res, 413, 'too_much_data',
          `Your attachments are ${Math.round(bytes / 1024 / 1024)} MB — too much for a single file. `
          + 'Export without files, and let the panel backup carry /data/files instead.');
        return;
      }
    }
    const data = JSON.stringify(byggEksport(medFiler), null, medFiler ? 0 : 1);
    const navn = `doda-${iDag()}${medFiler ? '-med-filer' : ''}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${navn}"`,
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  },

  'POST /api/v1/import': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      apiFejl(res, 400, 'bad_import', 'Send a doda export document, or one chunk of one.');
      return;
    }
    try {
      const tal = importer(body);
      audit('import', null, JSON.stringify(tal));
      sendJson(res, 200, { imported: tal, message: `Imported ${Object.entries(tal).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}` });
    } catch (err) {
      logError(`import: ${err.stack || err}`);
      apiFejl(res, 400, 'import_failed', `The import failed: ${err.message}`);
    }
  },

  /* Kalenderfeedets adresse. Tokenet vises kun til en indlogget bruger. */
  'GET /api/v1/calendar': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { token: icalToken(false) });
  },

  'POST /api/v1/calendar': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    if (body.action === 'revoke') {
      db.prepare("DELETE FROM settings WHERE key = 'ical_token'").run();
      audit('ical-token-tilbagekaldt', null, clientIp(req));
      sendJson(res, 200, { token: null });
      return;
    }
    // Nyt token: det gamle holder oejeblikkeligt op med at virke.
    db.prepare("DELETE FROM settings WHERE key = 'ical_token'").run();
    sendJson(res, 200, { token: icalToken(true) });
  },

  'GET /api/v1/recurrences': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    sendJson(res, 200, { recurrences: hentGentagelser() });
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
      // client_id IS NULL: kun MINE egne noegler. Et OAuth-token er ikke noget,
      // jeg har lavet i hand - det hoerer hjemme under "Connected apps", hvor
      // hele forbindelsen kan tilbagekaldes paa én gang.
      tokens: db.prepare(`
        SELECT id, name, prefix, scope, created_at, last_used_at FROM tokens
         WHERE revoked_at IS NULL AND client_id IS NULL ORDER BY created_at DESC`).all(),
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

  /* Connectorer, der har koblet sig pa gennem OAuth. Samme regel som for
     noeglerne: kun en rigtig session ma se og tilbagekalde dem - ellers
     kunne én laekket forbindelse rydde de andre af vejen. */
  /* --- notion ---------------------------------------------------- */

  'GET /api/v1/notion': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    // Kun OM der er et token, aldrig hvad det er.
    sendJson(res, 200, {
      connected: !!getSetting('notion_token', ''),
      workspace: getSetting('notion_workspace', ''),
    });
  },

  'POST /api/v1/notion': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const token = str(body.token, 200);
    if (!token) { apiFejl(res, 400, 'no_token', 'Paste the integration token from Notion.'); return; }

    // Gem foerst, saa proev - modulet laeser tokenet gennem getSetting.
    // Duer det ikke, ryddes det igen, saa en fejlindtastning ikke bliver
    // liggende og ligne en virkende forbindelse.
    const gammelt = getSetting('notion_token', '');
    setSetting('notion_token', token);
    const svar = await notion.proev();
    if (!svar.ok) {
      if (gammelt) setSetting('notion_token', gammelt);
      else db.prepare("DELETE FROM settings WHERE key = 'notion_token'").run();
      apiFejl(res, 400, 'bad_token', svar.fejl);
      return;
    }
    setSetting('notion_workspace', svar.workspace || '');
    audit('notion-forbundet', svar.workspace || null, clientIp(req));
    sendJson(res, 200, { connected: true, workspace: svar.workspace || '' });
  },

  /* --- Sagu (F8) ------------------------------------------------------ */


  'GET /api/v1/sagu': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    // Kun OM der er en noegle, aldrig hvad den er.
    sendJson(res, 200, {
      connected: saguForbundet(),
      url: getSetting('sagu_url', ''),
      notebooks: JSON.parse(getSetting('sagu_notebooks', '[]') || '[]'),
      // Hvor en note fra PALETTEN skal ligge. Dialogen spoerger hver gang;
      // paletten er ét tastetryk og kan ikke spoerge om noget.
      notebook: getSetting('sagu_notebook', ''),
    });
  },

  /*
   * Gem forbindelsen - men proev den FOERST.
   *
   * Samme raekkefoelge som Notion: gem, afproev, rul tilbage. Ellers ligger en
   * forkert noegle og LIGNER en virkende forbindelse, indtil man proever at
   * bruge den (RUNE-ERFARINGER, doda v16).
   */
  'POST /api/v1/sagu': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const raa = String(body.url || '').trim().replace(/\/+$/, '');
    let url = '';
    try {
      const u = new URL(raa);
      // Kun en OPRINDELSE: en sti ville lande midt i alle adresser, vi danner.
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.pathname === '/'
          && !u.search && !u.hash) url = u.origin;
    } catch { url = ''; }
    if (!url) {
      apiFejl(res, 400, 'bad_url', 'The Sagu address must be a plain web address like https://sagu.example.com.');
      return;
    }
    const noegle = str(body.key, 200);
    const gammelUrl = getSetting('sagu_url', '');
    const gammelKey = getSetting('sagu_key', '');
    // Tom noegle = behold den, der staar. Ellers kunne man ikke rette
    // adressen uden ogsaa at finde noeglen frem igen.
    if (!noegle && !gammelKey) {
      apiFejl(res, 400, 'no_key', 'Paste a Sagu API key the first time you connect.');
      return;
    }
    setSetting('sagu_url', url);
    if (noegle) setSetting('sagu_key', noegle);

    const svar = await sagu.proev();
    if (!svar.ok) {
      setSetting('sagu_url', gammelUrl);
      if (gammelKey) setSetting('sagu_key', gammelKey);
      else db.prepare("DELETE FROM settings WHERE key = 'sagu_key'").run();
      apiFejl(res, 400, 'bad_key', svar.fejl);
      return;
    }
    gemNotesboeger(svar.notebooks);
    audit('sagu-forbundet', url, clientIp(req));
    sendJson(res, 200, {
      connected: true, url, notes: svar.notes, notebooks: svar.notebooks || [],
    });
  },

  /*
   * Hent notesboegerne forfra.
   *
   * Listen blev kun hentet, naar man FORBANDT. Oprettede man en notesbog i
   * Sagu bagefter, kunne doda aldrig se den - og den eneste udvej var at
   * koble fra og forbinde igen, hvilket kraever at man finder noeglen frem
   * paa ny. En cache uden en maade at genopfriske den paa er en blindgyde.
   *
   * Noeglen roeres ikke: den staar allerede, og der er intet at gemme.
   */
  'POST /api/v1/sagu/refresh': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!saguForbundet()) {
      apiFejl(res, 400, 'not_connected', 'Connect Sagu first.');
      return;
    }
    const svar = await sagu.proev();
    // En fejl her aendrer INTET. Er Sagu nede, er den gamle liste stadig det
    // bedste, vi har - at tomme den ville tage notesboegerne fra brugeren,
    // fordi en fremmed server var utilgaengelig et oejeblik.
    if (!svar.ok) { apiFejl(res, 400, 'sagu_failed', svar.fejl); return; }
    gemNotesboeger(svar.notebooks);
    sendJson(res, 200, {
      connected: true,
      url: getSetting('sagu_url', ''),
      notebooks: JSON.parse(getSetting('sagu_notebooks', '[]') || '[]'),
      notebook: getSetting('sagu_notebook', ''),
    });
  },

  /* Hvilken notesbog en note fra paletten skal ligge i. */
  'POST /api/v1/sagu/notebook': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const id = str(body.notebookId, 64);
    const kendte = JSON.parse(getSetting('sagu_notebooks', '[]') || '[]');
    if (id && !kendte.some((b) => b.id === id)) {
      apiFejl(res, 400, 'unknown_notebook', 'Sagu does not have a notebook with that id.');
      return;
    }
    if (id) setSetting('sagu_notebook', id);
    else db.prepare("DELETE FROM settings WHERE key = 'sagu_notebook'").run();
    sendJson(res, 200, { notebook: id });
  },

  'DELETE /api/v1/sagu': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    await readJsonBody(req);
    // Linkene paa opgaverne bliver staaende: de er en kendsgerning om
    // opgaven, ikke en foelge af en indstilling.
    db.prepare("DELETE FROM settings WHERE key IN "
      + "('sagu_url','sagu_key','sagu_notebooks','sagu_notebook')").run();
    audit('sagu-frakoblet', null, clientIp(req));
    sendJson(res, 200, { connected: false });
  },

  /* Serveren proxier soegningen - noeglen forlader aldrig maskinen. */
  'GET /api/v1/sagu/search': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    if (!saguForbundet()) {
      apiFejl(res, 400, 'not_connected', 'Connect Sagu under Settings first.');
      return;
    }
    if (!rateAllow(`sagu:${clientIp(req)}`, 120, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many searches. Try again shortly.');
      return;
    }
    const r = await sagu.soeg(ctx.query.get('q') || '');
    if (r.fejl) { apiFejl(res, 502, 'sagu_failed', r.fejl); return; }
    sendJson(res, 200, { pages: r.pages, fallback: !!r.fallback });
  },

  /* Opretter en note i Sagu og giver adressen tilbage. */
  'POST /api/v1/sagu/note': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    if (!saguForbundet()) {
      apiFejl(res, 400, 'not_connected', 'Connect Sagu under Settings first.');
      return;
    }
    const body = await readJsonBody(req, auth.viaToken);
    const r = await sagu.opretNote(body.title, {
      // Dialogen sender en bog; paletten goer ikke, og saa gaelder valget
      // fra Settings. Uden det lander hurtige noter uden for enhver bog.
      notebookId: str(body.notebookId, 64) || getSetting('sagu_notebook', '') || null,
      tilbageUrl: str(body.backUrl, 400) || null,
      tilbageTitel: str(body.backTitle, 200) || null,
      // Beskrivelsen, naar en opgave bliver til en note. Samme graense som
      // `item.note` - teksten kommer derfra, og en kortere graense her ville
      // klippe den tavst midt over, netop som opgaven bliver slettet.
      krop: str(body.body, GRAENSER.note) || null,
    });
    if (r.fejl) { apiFejl(res, 502, 'sagu_failed', r.fejl); return; }
    audit('sagu-note-oprettet', r.page.title, clientIp(req));
    sendJson(res, 200, { page: r.page });
  },

  /**
   * De Sagu-noter, doda selv bruger.
   *
   * »Bruges sammen med doda« er praecis dem, der er LINKET fra en opgave eller
   * et projekt her - ikke alle noter i Sagu. Ellers ville Notes-skaermen vaere
   * en daarligere kopi af Sagus egen forside, som altid vil vaere et klik vaek.
   *
   * Titlerne tages fra `link_title`, der allerede staar i basen. Skaermen skal
   * kunne tegnes uden at spoerge Sagu - ogsaa naar Sagu er nede, eller man
   * sidder offline. Er en note doebt om i Sagu, retter `friskLinkTitel` det,
   * naar den bliver aabnet; det er ikke denne listes opgave.
   */
  'GET /api/v1/sagu/linked': (req, res) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    /*
     * Reglen for »er dette en Sagu-adresse« staar ÉT sted (app/sagu.js).
     * En `LIKE '%#note-%'` her ville vaere en anden regel ved siden af, og
     * to regler for det samme driver fra hinanden uden at nogen opdager det.
     */
    /*
     * Kun det LEVENDE (Andreas, 25-08-2026).
     *
     * En afsluttet opgave er faerdig, og dens note er en kendsgerning om
     * noget, der er overstaaet - den fylder en liste, man bruger til at finde
     * det, der stadig er i gang. Noterne selv bliver liggende i Sagu, og
     * opgaven kan stadig aabnes i Logbook med sit link; det er kun DENNE
     * oversigt, der holdes ren.
     *
     * `someday` er med: parkeret er ikke det samme som afsluttet.
     */
    const items = db.prepare(`SELECT id, title, kind, status, project_id, link_url, link_title
        FROM items WHERE deleted = 0 AND link_url IS NOT NULL
          AND status NOT IN ('done','dropped')
        ORDER BY updated_at DESC`).all().filter((r) => saguModul.erSaguUrl(r.link_url));
    const projects = db.prepare(`SELECT id, name, link_url, link_title
        FROM projects WHERE deleted = 0 AND link_url IS NOT NULL
          AND status NOT IN ('done','dropped')
        ORDER BY name`).all().filter((r) => saguModul.erSaguUrl(r.link_url));
    sendJson(res, 200, { url: saguForbundet() ? getSetting('sagu_url', '') : '', items, projects });
  },

  /**
   * Et billede fra en Sagu-note.
   *
   * Sagus billeder ligger bag dens noegle, og noten skriver dem som
   * `sagu:<id>`. Uden denne vej ville en note vises med huller, hvor
   * billederne staar. Noeglen bliver paa serveren - klienten ser kun `?id=`.
   *
   * `godkend(..., 'read')`: den, der ikke maa laese doda, maa heller ikke
   * bruge dodas noegle til at hente noget som helst fra Sagu.
   */
  'GET /api/v1/sagu/file': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    if (!saguForbundet()) { apiFejl(res, 400, 'not_connected', 'Connect Sagu under Settings first.'); return; }
    const id = String(ctx.query.get('id') || '').toLowerCase();
    // Proeven staar OGSAA i sagu.js. Her, fordi et daarligt id skal give en
    // laesbar 400 og ikke en netvaerksfejl langt nede.
    if (!/^[a-f0-9]{32}$/.test(id)) { apiFejl(res, 400, 'bad_id', 'That is not a Sagu file id.'); return; }

    const r = await sagu.hentFil(id);
    if (r.fejl) {
      // 404 og ikke 502: for den, der ser paa siden, er forskellen paa »findes
      // ikke« og »kunne ikke hentes« et billede, der ikke kommer.
      apiFejl(res, 404, 'no_file', 'That image could not be fetched from Sagu.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': r.mime,
      'Content-Length': r.data.length,
      /* Billedet aendrer sig ikke: id'et ER indholdet. En time i browseren
         sparer et kald gennem to servere, hver gang noten aabnes. */
      'Cache-Control': 'private, max-age=3600',
      // Et SVG fra en fremmed note maa ikke kunne noget som helst.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(r.data);
  },

  /* Notens kommentarer. Kun LAESNING - svaret hoerer hjemme i Sagu. */
  'GET /api/v1/sagu/comments': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    const id = saguModul.idFraUrl(ctx.query.get('url') || '');
    if (!id) { apiFejl(res, 400, 'bad_url', 'That is not a Sagu note address.'); return; }
    /*
     * Noten OG kommentarerne i ét kald.
     *
     * Ruden viste kun kommentarer, saa man kunne se, at nogen havde sagt
     * noget om en note, man ikke kunne laese. To kald ville koste en rundtur
     * mere for noget, der altid vises sammen.
     *
     * Selve noten hentes med `read`, som en `link`-noegle har - der kraeves
     * ikke en bredere noegle for at faa teksten frem.
     */
    const [r, n] = await Promise.all([sagu.kommentarer(id), sagu.note(id)]);
    if (r.fejl) { apiFejl(res, 502, 'sagu_failed', r.fejl); return; }
    // Fejler noten, men ikke kommentarerne, er kommentarerne stadig bedre end
    // en fejlbesked - saa `note` udelades bare.
    sendJson(res, 200, { comments: r.comments, note: n || null });
  },

  /*
   * Skriv en kommentar paa en Sagu-note.
   *
   * Muligt siden Sagu v8, hvor kravet blev saenket fra `write` til `capture`:
   * en kommentar aendrer ikke noten. Dodas `link`-noegle kan det derfor.
   */
  'POST /api/v1/sagu/comment': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const id = saguModul.idFraUrl(body.url || '');
    if (!id) { apiFejl(res, 400, 'bad_url', 'That is not a Sagu note address.'); return; }
    const tekst = str(body.text, 2000);
    if (!tekst) { apiFejl(res, 400, 'no_text', 'There is no comment to send.'); return; }
    // Lavere end laesningen: en kommentar gaar ud i verden og kan ikke tages
    // tilbage fra doda. Samme graense som Notion-kommentarerne.
    if (!rateAllow(`saguskriv:${clientIp(req)}`, 60, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many comments. Try again shortly.');
      return;
    }
    const r = await sagu.skrivKommentar(id, tekst);
    if (r.fejl) { apiFejl(res, 502, 'sagu_failed', r.fejl); return; }
    /*
     * Sagu udelader `comments` for en ren capture-noegle - saa ville
     * skrive-doeren vaere blevet en laese-kanal. Vores noegle faar listen,
     * men vi henter den selv, hvis den mangler, frem for at vise en tom rude
     * og lade det ligne, at kommentaren forsvandt.
     */
    let liste = r.comments;
    if (!liste) {
      const igen = await sagu.kommentarer(id);
      liste = igen.fejl ? [] : igen.comments;
    }
    sendJson(res, 200, { message: r.besked, comments: liste });
  },

  'DELETE /api/v1/notion': async (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    await readJsonBody(req);
    db.prepare("DELETE FROM settings WHERE key IN ('notion_token','notion_workspace')").run();
    audit('notion-frakoblet', null, clientIp(req));
    sendJson(res, 200, { connected: false });
  },

  /* Serveren proxier soegningen. Tokenet forlader aldrig maskinen mod
     browseren, og Notion ser kun ét kald fra doda - ikke fra en fane. */
  'GET /api/v1/notion/search': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    if (!getSetting('notion_token', '')) {
      apiFejl(res, 400, 'not_connected', 'Connect Notion under Settings first.');
      return;
    }
    if (!rateAllow(`notion:${clientIp(req)}`, 120, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many searches. Try again shortly.');
      return;
    }
    const r = await notion.soeg(ctx.query.get('q') || '');
    if (r.fejl) { apiFejl(res, 502, 'notion_failed', r.fejl); return; }
    sendJson(res, 200, { pages: r.pages });
  },

  /**
   * Henter en Notion-sides friske titel - hoejst én gang i doegnet pr. link.
   *
   * Omdoeber man siden i Notion, staar den gamle titel ellers i doda for
   * evigt. Stemplet er hele pointen: uden det ville hver eneste aabning af
   * en opgave vaere et kald til en fremmed tjeneste.
   *
   * Svarer {title: null}, naar der ikke var noget at lave - saa kan
   * frontenden kalde den frit uden at skulle vide, hvornaar det giver mening.
   */
  'POST /api/v1/link/refresh': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    const erProjekt = body.kind === 'project';
    const tabel = erProjekt ? 'projects' : 'items';
    const id = str(body.id, 64);
    if (!id) { apiFejl(res, 400, 'no_id', 'Which one?'); return; }

    const r = db.prepare(`SELECT link_url, link_title, link_checked_at FROM ${tabel} WHERE id = ?`).get(id);
    /*
     * Tjekket for nylig: gaa hjem, uanset hvem der ejer linket.
     *
     * Vinduet var et DOEGN. Doeber man en note om i Sagu, viste doda derfor
     * det gamle navn indtil i morgen - og den almindelige gang er »skift app,
     * ret noget, skift tilbage«, som tager to minutter. Sagu ramte det samme
     * paa opgavestatus (deres §33) og gik til 60 sekunder; her er reglen den
     * samme, saa de to tvillinger ikke opfoerer sig forskelligt.
     *
     * 60 sekunder er billigt, fordi kaldet sker ved optegning af ÉN opgave
     * eller ÉT projekt - ikke pr. raekke i en liste. Naar fanen kommer frem,
     * genindlaeser appen i forvejen, og saa er titlen frisk med det samme.
     *
     * Tallet er pinnet af en test. Saettes det op igen, skal det vaere et valg.
     */
    if (!r || (r.link_checked_at && now() - r.link_checked_at < 60)) {
      sendJson(res, 200, { title: null });
      return;
    }
    /*
     * To kilder, ét felt.
     *
     * `link_url` blev med vilje aldrig doebt `notion_url`, og det er dét, der
     * goer, at Sagu kan glide ind ved siden af uden en ny kolonne. Adressen
     * afgoer selv, hvem der skal spoerges - der er ingen tilstand at holde
     * styr paa.
     */
    /*
     * FORMEN afgoer foerst - ikke om en forbindelse er sat.
     *
     * En Sagu-adresse slutter paa `#note-<32 hex>`, og Notions id-genkendelse
     * leder efter 32 hex i enden. Uden en foerste sortering ville doda derfor
     * spoerge NOTION om en Sagu-note, saa snart Sagu ikke var forbundet - et
     * spildt kald mod en fremmed tjeneste med et id, der ikke er dens. En
     * test fandt det; oejet ville aldrig have set det.
     */
    const erSagu = saguModul.idFraUrl(r.link_url) !== null;
    const saguId = erSagu && saguForbundet() ? saguModul.idFraUrl(r.link_url) : null;
    const sideId = (!erSagu && getSetting('notion_token', ''))
      ? notionModul.idFraUrl(r.link_url) : null;
    if (!saguId && !sideId) { sendJson(res, 200, { title: null }); return; }

    // Stemples FOER opslaget. Er siden slettet eller delingen fjernet, skal
    // doda ikke proeve igen ved hver eneste aabning.
    db.prepare(`UPDATE ${tabel} SET link_checked_at = ? WHERE id = ?`).run(now(), id);
    const side = saguId ? await sagu.note(saguId) : await notion.side(sideId);
    if (!side || !side.title || side.title === r.link_title) {
      sendJson(res, 200, { title: null });
      return;
    }
    db.prepare(`UPDATE ${tabel} SET link_title = ? WHERE id = ?`).run(side.title, id);
    sendJson(res, 200, { title: side.title });
  },

  /**
   * Sidens indhold, som markdown.
   *
   * Hentes PAA FORLANGENDE, ikke ved hver aabning: en side kan vaere lang, og
   * Notion er kilden - doda skal ikke lave en kopi, der kan blive forkert.
   * Svaret ligger i hukommelsen et kvarter, saa det ikke koster et kald at
   * folde den ud og ind igen.
   */
  /*
   * Kommentarer paa en Notion-side.
   *
   * Laesning kraever `read`, skrivning `write` - som alt andet her. Og
   * kommentarer caches ALDRIG: en gammel kommentarliste er vaerre end ingen,
   * fordi den ser ud til at vaere hele samtalen.
   */
  /* En ny side i Notion. Foraelderen er den, brugeren har valgt i soegningen -
     doda kender ikke andre steder at laegge den, og det er med vilje: en side
     skal ligge et sted, ejeren selv har peget paa. */
  'POST /api/v1/notion/page': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    if (!getSetting('notion_token', '')) {
      apiFejl(res, 400, 'not_connected', 'Connect Notion under Settings first.');
      return;
    }
    const foraelder = notionModul.idFraUrl(body.parent || '') || String(body.parent || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(foraelder.replace(/-/g, ''))) {
      apiFejl(res, 400, 'not_notion', 'Pick the Notion page it should live under.');
      return;
    }
    const titel = str(body.title, 200);
    if (!titel) { apiFejl(res, 400, 'no_text', 'The new page needs a name.'); return; }
    if (!rateAllow(`notionny:${clientIp(req)}`, 30, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many new pages. Try again shortly.');
      return;
    }
    const r = await notion.opretSide(foraelder.replace(/-/g, ''), titel);
    if (r.fejl) { apiFejl(res, 502, 'notion_failed', r.fejl); return; }
    audit('notion-side-oprettet', r.page.id, clientIp(req));
    sendJson(res, 200, { page: r.page });
  },

  'GET /api/v1/notion/comments': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    if (!getSetting('notion_token', '')) {
      apiFejl(res, 400, 'not_connected', 'Connect Notion under Settings first.');
      return;
    }
    const sideId = notionModul.idFraUrl(ctx.query.get('url') || '');
    if (!sideId) { apiFejl(res, 400, 'not_notion', 'That link is not a Notion page.'); return; }
    if (!rateAllow(`notionkom:${clientIp(req)}`, 120, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many comment loads. Try again shortly.');
      return;
    }
    const r = await notion.kommentarer(sideId);
    if (r.fejl) { apiFejl(res, 502, 'notion_failed', r.fejl); return; }
    sendJson(res, 200, { comments: r.comments });
  },

  'POST /api/v1/notion/comment': async (req, res) => {
    const auth = godkend(req, res, 'write');
    if (!auth) return;
    const body = await readJsonBody(req, auth.viaToken);
    if (!getSetting('notion_token', '')) {
      apiFejl(res, 400, 'not_connected', 'Connect Notion under Settings first.');
      return;
    }
    const sideId = notionModul.idFraUrl(body.url || '');
    if (!sideId) { apiFejl(res, 400, 'not_notion', 'That link is not a Notion page.'); return; }
    const tekst = str(body.text, 2000);
    if (!tekst) { apiFejl(res, 400, 'no_text', 'There is no comment to send.'); return; }
    // Lavere end laesningen: en skrivning gaar ud i verden og kan ikke tages
    // tilbage fra doda.
    if (!rateAllow(`notionskriv:${clientIp(req)}`, 60, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many comments. Try again shortly.');
      return;
    }
    const r = await notion.kommenter(sideId, tekst);
    if (r.fejl) { apiFejl(res, 502, 'notion_failed', r.fejl); return; }
    audit('notion-kommentar', sideId, clientIp(req));
    sendJson(res, 200, { comment: r.comment });
  },

  'GET /api/v1/notion/page': async (req, res, ctx) => {
    const auth = godkend(req, res, 'read');
    if (!auth) return;
    if (!getSetting('notion_token', '')) {
      apiFejl(res, 400, 'not_connected', 'Connect Notion under Settings first.');
      return;
    }
    const sideId = notionModul.idFraUrl(ctx.query.get('url') || '');
    if (!sideId) { apiFejl(res, 400, 'not_notion', 'That link is not a Notion page.'); return; }
    if (!rateAllow(`notionpage:${clientIp(req)}`, 120, 3600)) {
      apiFejl(res, 429, 'rate_limited', 'Too many page loads. Try again shortly.');
      return;
    }

    const gemt = notionCache.get(sideId);
    if (gemt && now() - gemt.t < 900) { sendJson(res, 200, { markdown: gemt.md, cached: true }); return; }

    const r = await notion.indhold(sideId);
    if (r.fejl) { apiFejl(res, 502, 'notion_failed', r.fejl); return; }
    // Simpel udslusning: cachen er en bekvemmelighed, ikke et lager.
    if (notionCache.size > 50) notionCache.clear();
    notionCache.set(sideId, { md: r.markdown, t: now() });
    sendJson(res, 200, { markdown: r.markdown, cached: false });
  },

  /* --- push: abonnement, noegle og "hvad skulle jeg minde om" --------- */

  'GET /api/v1/push': (req, res) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    sendJson(res, 200, {
      publicKey: push.offentligNoegle(),
      devices: db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n,
      lead: Number(getSetting('push_lead', '0')),
    });
  },

  'POST /api/v1/push': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req, user.viaToken);
    if (typeof body.lead === 'string' || typeof body.lead === 'number') {
      setSetting('push_lead', String(Number(body.lead) || 0));
    }
    const endpoint = str(body.endpoint, 1000);
    if (endpoint) {
      if (!/^https:\/\//.test(endpoint)) {
        apiFejl(res, 400, 'bad_endpoint', 'A push endpoint must be https.');
        return;
      }
      // Id'et er hashen af endepunktet: samme enhed to gange bliver til én
      // raekke, uden at endepunktet skal sammenlignes i fuld laengde.
      // Gem appens egen adresse: den skal med i VAPID-JWT'ets `sub`, og
      // tickeren har ingen forespoergsel at udlede den af.
      setSetting('push_host', oauth.base(req));
      db.prepare(`INSERT INTO push_subs (id, endpoint, p256dh, auth, created_at)
                  VALUES (?,?,?,?,?)
                  ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh,
                    auth = excluded.auth, fails = 0`)
        .run(hashToken(endpoint), endpoint, str(body.p256dh, 200) || null,
          str(body.auth, 200) || null, now());
      audit('push-tilmeldt', null, clientIp(req));
    }
    sendJson(res, 200, {
      devices: db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n,
      lead: Number(getSetting('push_lead', '0')),
    });
  },

  'DELETE /api/v1/push': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req, user.viaToken);
    const endpoint = str(body.endpoint, 1000);
    if (endpoint) fjernAbonnement(hashToken(endpoint));
    else db.prepare('DELETE FROM push_subs').run();
    sendJson(res, 200, { devices: db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n });
  },

  /**
   * Hvad pushen handlede om.
   *
   * Service workeren henter det her, fordi selve pushen er TOM - saa ved
   * Apple og Google aldrig, hvad opgaverne hedder. Vinduet er de sidste fem
   * minutters stemplinger; er opgaven lukket i mellemtiden, staar den her
   * ikke laengere.
   */
  'GET /api/v1/due-now': (req, res) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const items = db.prepare(`
      SELECT id, title, due_time FROM items
       WHERE notified_at IS NOT NULL AND notified_at > ? AND deleted = 0
         AND status NOT IN ('done','dropped')
       ORDER BY due_time LIMIT 5`).all(now() - 300);
    /* Var det gennemgangen, der lige blev pushet? Service workeren faar en TOM
       push og skal selv finde ud af, hvad den skal vise. */
    const mindet = Number(getSetting('review_notified', '0')) || 0;
    sendJson(res, 200, { items, review: !!mindet && now() - mindet < 300 });
  },

  'GET /api/v1/connections': (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    sendJson(res, 200, { connections: hentForbindelser() });
  },

  'POST /api/v1/contexts': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req);
    const navn = str(body.name, 60);
    if (!navn) { apiFejl(res, 400, 'no_name', 'A context needs a name.'); return; }
    sendJson(res, 200, { context: findKontekst(navn) || opretKontekst(navn) });
  },

  'POST /api/v1/projects': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req);
    const navn = str(body.name, 120);
    if (!navn) { apiFejl(res, 400, 'no_name', 'A project needs a name.'); return; }
    sendJson(res, 200, { project: findProjekt(navn) || opretProjekt(navn) });
  },

  'GET /api/v1/settings': (req, res) => {
    const user = godkend(req, res, 'read');
    if (!user) return;
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    // Hemmelighederne ud. Ruten kraever kun scope "read", saa uden det her
    // kunne en noegle paa en telefon laese kalenderfeedets token, Notion-
    // tokenet og VAPID's private noegle - og saa er de ikke hemmelige
    // laengere (RUNE-ERFARINGER §6b).
    for (const row of rows) if (!HEMMELIGE_SETTINGS.has(row.key)) out[row.key] = row.value;
    sendJson(res, 200, { settings: out });
  },

  'POST /api/v1/settings': async (req, res) => {
    const user = godkend(req, res, 'write');
    if (!user) return;
    const body = await readJsonBody(req);
    // Whitelist - aldrig blind gennemskrivning af klientens noegler.
    const ALLOWED = new Set(['theme', 'review_weekday', 'focus_item', 'focus_started',
      'ical_alarm', 'notes_off', 'review_time', 'review_push',
      // Skjuler »N done« i toplinjen. En taeller, der kun kan vokse, er for
      // nogle en paamindelse og for andre stoej - derfor et valg.
      'hide_done']);
    const written = {};
    for (const [key, value] of Object.entries(body.settings || {})) {
      if (!ALLOWED.has(key)) continue;
      setSetting(key, str(String(value), 200));
      written[key] = getSetting(key);
    }
    sendJson(res, 200, { settings: written });
  },
};

/** Ren tekst ud - til klienter uden JSON-parser (iOS-genveje, Raycast). */
function sendTekst(res, krop) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(krop);
}

/**
 * En liste, en skaerm kan vise som den er.
 *
 * ÉT sted, saa /next og /search ser ens ud. Stod formateringen to steder,
 * ville de drive fra hinanden, og brugeren ville se to slags lister fra samme
 * app (RUNE-ERFARINGER, doda v60).
 */
function tekstListe(items, tomtSvar) {
  const linjer = items.map((i) => {
    const dele = [i.title];
    if (i.contexts && i.contexts.length) dele.push(i.contexts.map((c) => `#${c.name}`).join(' '));
    if (i.due_date) dele.push(i.due_date + (i.due_time ? ` ${i.due_time}` : ''));
    return `• ${dele.join('  ·  ')}`;
  });
  return linjer.length ? linjer.join('\n') : tomtSvar;
}

/**
 * Hvornaar Logbook sidst blev startet forfra - 0 hvis aldrig.
 *
 * ÉT sted, fordi graensen bruges to: listen i Logbook og `done`-tallet i
 * toplinjen. To udgaver af den samme regel skrider fra hinanden, uden at
 * nogen opdager det (RUNE-ERFARINGER, doda v60).
 */
function logbookFra() {
  return Number(getSetting('logbook_reset', '0')) || 0;
}

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

/**
 * Er den ugentlige gennemgang forfalden?
 *
 * Paamindelsen er BEVIDST kun et diskret baand i appen - ikke en push-besked.
 * Handover §5.12: sa faa notifikationer som overhovedet muligt, standard ingen.
 * De rigtige deadlines har allerede en vej ud: iCal-feedet, hvor telefonens
 * egen kalender giver besked. At bygge en push-kanal til ÉN ugentlig
 * paamindelse ville vaere at tilfoeje en hel infrastruktur for at raabe.
 */
function gennemgangForfalder() {
  const ugedag = Number(getSetting('review_weekday', '0')) || 0;
  if (!ugedag) return false;                       // slaaet fra
  if (parse.isoUgedag(new Date()) !== ugedag) return false;
  const sidst = Number(getSetting('review_done', '0')) || 0;
  // Seks dage, ikke syv: er den lavet i dag, skal den ikke minde igen.
  return now() - sidst > 6 * 86400;
}

/* ------------------------------------------------------ kalenderfeed */

/**
 * iCal-feed med KUN reelle deadlines.
 *
 * To ting er kritiske her (RUNE-ERFARINGER §4-5):
 *  - Endepunktet er UDEN login (kalender-apps kan ikke sende cookies), sa det
 *    ma ALDRIG scanne hele datasaettet. Kalendere poller hvert kvarter, og
 *    Kokkeris feed la og parsede hele biblioteket doegnet rundt. Her rammer
 *    forespoergslen items_forfald-indekset og henter kun poster MED en dato.
 *  - Adressen er hemmeligheden. Den kan tilbagekaldes, og et nyt token gor
 *    det gamle vaerdiloest med det samme.
 */
function icalToken(opret) {
  let t = getSetting('ical_token');
  if (!t && opret) {
    t = crypto.randomBytes(24).toString('base64url');
    setSetting('ical_token', t);
    audit('ical-token-oprettet', null, null);
  }
  return t;
}

function icalEscape(s) {
  return String(s || '').replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
}

function foldLinje(l) {
  // RFC 5545: linjer over 75 oktetter skal foldes, ellers afviser strenge
  // klienter hele filen.
  if (Buffer.byteLength(l) <= 74) return l;
  const dele = [];
  let rest = l;
  while (Buffer.byteLength(rest) > 74) {
    let n = 74;
    while (Buffer.byteLength(rest.slice(0, n)) > 74) n--;
    dele.push(dele.length ? ` ${rest.slice(0, n)}` : rest.slice(0, n));
    rest = rest.slice(n);
  }
  dele.push(` ${rest}`);
  return dele.join('\r\n');
}

/**
 * @param {string} base  Appens egen adresse - saa hver aftale kan pege
 *   TILBAGE til opgaven i doda. Kalenderen er der, hvor man ser deadlinen;
 *   det er ogsaa dér, man vil kunne springe hen og gore noget ved den.
 */
function byggIcal(base) {
  const raekker = db.prepare(`
    SELECT i.id, i.title, i.due_date, i.due_time, i.status, i.updated_at, p.name AS projekt
      FROM items i LEFT JOIN projects p ON p.id = i.project_id
     WHERE i.due_date IS NOT NULL AND i.deleted = 0
       AND i.status NOT IN ('done','dropped')
     ORDER BY i.due_date LIMIT 2000`).all();

  // -1 = ingen paamindelse. 0 = praecis paa tidspunktet.
  const alarm = Number(getSetting('ical_alarm', '15'));
  const stempel = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ud = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//doda//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icalEscape(APP_NAME)}`];

  for (const r of raekker) {
    const d = r.due_date.replace(/-/g, '');
    ud.push('BEGIN:VEVENT', `UID:${r.id}@doda`, `DTSTAMP:${stempel}`);
    if (r.due_time) {
      // Lokal tid MED tidszone-reference. Konverteres der til UTC her, driver
      // aftalen en time hen over sommertidsskiftet.
      const t = `${d}T${r.due_time.replace(':', '')}00`;
      ud.push(`DTSTART;TZID=Europe/Copenhagen:${t}`, `DTEND;TZID=Europe/Copenhagen:${t}`);
    } else {
      const slut = new Date(`${r.due_date}T12:00:00`);
      slut.setDate(slut.getDate() + 1);
      ud.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${parse.fmtDato(slut).replace(/-/g, '')}`);
    }
    ud.push(foldLinje(`SUMMARY:${icalEscape(r.title)}`));

    // Tilbage til opgaven i doda. URL: er den rigtige egenskab, men flere
    // klienter viser den ikke saerlig tydeligt - derfor staar adressen OGSAA
    // i beskrivelsen, hvor alle viser den.
    const linkTil = base ? `${base}/?item=${encodeURIComponent(r.id)}` : '';
    const beskrivelse = [r.projekt || '', linkTil].filter(Boolean).join('\n');
    if (beskrivelse) ud.push(foldLinje(`DESCRIPTION:${icalEscape(beskrivelse)}`));
    if (linkTil) ud.push(foldLinje(`URL:${linkTil}`));

    // Paamindelsen. Uden en VALARM har kalender-appen ingenting at give
    // besked paa, og et abonnement er tavst - det var derfor doda foeltes
    // som om den ikke kunne minde om noget.
    //
    // KUN paa opgaver med et klokkeslaet. En heldagsopgave ville ellers
    // ringe ved midnat, og "ingen roede taellere, ingen alarmfarver"
    // (DESIGN.md §2) gaelder ogsaa for stoej: en paamindelse man ikke bad
    // om, er den hurtigste vej til at slaa hele feedet fra.
    if (r.due_time && alarm >= 0) {
      ud.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        foldLinje(`DESCRIPTION:${icalEscape(r.title)}`),
        alarm === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-PT${alarm}M`,
        'END:VALARM');
    }
    ud.push('END:VEVENT');
  }
  ud.push('END:VCALENDAR');
  return `${ud.join('\r\n')}\r\n`;
}

/* --------------------------------------------------- eksport / import */

/** Alt i ét aabent format. Ingen indelasning. */
function byggEksport(medFiler) {
  const raa = (sql) => db.prepare(sql).all();
  const ud = {
    doda: 1,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries(raa('SELECT key, value FROM settings')
      // Hemmeligheder hoerer ikke i en eksportfil, brugeren maaske deler.
      .filter((r) => !HEMMELIGE_SETTINGS.has(r.key)).map((r) => [r.key, r.value])),
    areas: raa('SELECT * FROM areas'),
    contexts: raa('SELECT * FROM contexts'),
    projects: raa('SELECT * FROM projects WHERE deleted = 0'),
    items: raa('SELECT * FROM items WHERE deleted = 0'),
    item_contexts: raa('SELECT * FROM item_contexts'),
    recurrences: raa('SELECT * FROM recurrences WHERE deleted = 0'),
    attachments: raa('SELECT * FROM attachments WHERE deleted = 0'),
  };
  if (medFiler) {
    for (const a of ud.attachments) {
      const sti = filSti(a.id);
      try { a.data = fs.readFileSync(sti).toString('base64'); } catch { a.data = null; }
    }
  }
  return ud;
}

const IMPORT_TABELLER = {
  areas: ['id', 'name', 'seq', 'created_at', 'updated_at'],
  contexts: ['id', 'name', 'seq', 'created_at', 'updated_at'],
  projects: ['id', 'name', 'outcome', 'area_id', 'parent_id', 'status', 'seq', 'reviewed_at',
    'created_at', 'updated_at', 'deleted'],
  items: ['id', 'kind', 'status', 'title', 'note', 'project_id', 'area_id', 'starred', 'due_date', 'due_time',
    'defer_date', 'waiting_for', 'seq', 'recurrence_id', 'skipped', 'created_at', 'updated_at',
    'completed_at', 'deleted', 'dropped_with_project'],
  recurrences: ['id', 'rule', 'mode', 'template', 'next_due', 'next_time', 'paused', 'skips',
    'last_completed_at', 'created_at', 'updated_at', 'deleted'],
  item_contexts: ['item_id', 'context_id'],
  attachments: ['id', 'item_id', 'name', 'mime', 'size', 'sha', 'width', 'height', 'created_at', 'deleted'],
};

/**
 * Importerer én portion. Idempotent pa id, sa samme fil kan koeres to gange
 * uden dubletter - og i portioner, fordi en fuld backup let overstiger
 * body-graensen (Kokkeris 260 MB-backup var i praksis ubrugelig).
 */
function importer(data) {
  const tal = {};
  db.exec('BEGIN');
  try {
    for (const [tabel, kolonner] of Object.entries(IMPORT_TABELLER)) {
      const raekker = Array.isArray(data[tabel]) ? data[tabel] : null;
      if (!raekker || !raekker.length) continue;
      const huller = kolonner.map(() => '?').join(',');
      const ins = db.prepare(
        `INSERT OR REPLACE INTO ${tabel} (${kolonner.join(',')}) VALUES (${huller})`);
      let n = 0;
      for (const r of raekker.slice(0, 5000)) {
        if (!r || typeof r !== 'object') continue;
        // Whitelist pr. kolonne: importfilen bestemmer aldrig skemaet.
        try { ins.run(...kolonner.map((k) => (r[k] === undefined ? null : r[k]))); n++; }
        catch { /* fremmednoegle der ikke er importeret endnu - spring over */ }
      }
      tal[tabel] = n;
    }
    if (data.settings && typeof data.settings === 'object') {
      const OK = new Set(['theme', 'review_weekday', 'review_done', 'ical_alarm',
        'review_mode', 'review_focus', 'review_time', 'review_push']);
      for (const [k, v] of Object.entries(data.settings)) if (OK.has(k)) setSetting(k, String(v));
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }

  // Filindhold skrives EFTER commit: en halvskreven fil ma ikke rulle
  // databasen tilbage, og metadataene er det, der taeller.
  let filer = 0;
  if (Array.isArray(data.attachments)) {
    sikreFilesDir();
    for (const a of data.attachments) {
      if (!a || !a.data || !a.id) continue;
      const sti = filSti(a.id);
      if (!sti) continue;
      try { fs.writeFileSync(sti, Buffer.from(a.data, 'base64')); filer++; } catch { /* springes over */ }
    }
  }
  if (filer) tal.files = filer;
  return tal;
}

/* ------------------------------------------------------------- mcp */

/** Godkender uden at sende svar - MCP skal selv formulere 401'eren. */
function godkendMcp(req) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.match(/^Bearer\s+(\S+)$/i);
  const raa = bearer ? bearer[1] : String(req.headers['x-api-key'] || '');
  if (!raa) return null;
  const token = findToken(raa);
  if (!token) {
    logSecurity(`mcp-noegle-afvist ip=${clientIp(req)}`);
    return null;
  }
  if (!rateAllow(`api:${token.id}`, 600, 3600)) return null;
  stemplBrug(token);
  return { token, viaToken: true };
}

/* ------------------------------------------------------------ notion */

/* Tokenet bliver paa serveren og sendes ALDRIG til frontenden - kun et
   `connected: true` (RUNE-ERFARINGER §6b). Det er en hemmelighed, brugeren
   selv har indtastet, og den skal ikke kunne laeses ud af en browserfane. */
const notionModul = require('./notion.js');
const saguModul = require('./sagu.js');
const notion = notionModul.opret({
  hentToken: () => getSetting('notion_token', ''),
});

/*
 * Sagu - soesterappen, der skal afloese Notion som notearkiv (F8).
 *
 * Adresse + noegle, som Andreas selv saetter begge steder: der er ingen
 * navneoploesning mellem to runer, og en URL virker uanset topologi. Peges
 * den paa serverens LAN-adresse i stedet for paa tunnelen, forsvinder
 * ~150 ms uden en linje kode.
 */
const sagu = saguModul.opret({
  hentUrl: () => String(getSetting('sagu_url', '')).replace(/\/+$/, ''),
  hentNoegle: () => getSetting('sagu_key', ''),
});

const saguForbundet = () => !!(getSetting('sagu_url', '') && getSetting('sagu_key', ''));

/* Sidens indhold i hukommelsen et kvarter. IKKE i databasen: Notion er
   kilden, og en kopi ville kunne blive forkert uden at nogen opdagede det. */
const notionCache = new Map();

/* -------------------------------------------------------------- push */

const push = require('./push.js').opret({
  hentVapid() {
    const o = getSetting('vapid_public');
    const p = getSetting('vapid_private');
    return o && p ? { offentlig: o, privat: p } : null;
  },
  gemVapid(offentlig, privat) {
    setSetting('vapid_public', offentlig);
    setSetting('vapid_private', privat);
  },
  // Push-tjenesterne vil have en kontakt i JWT'ets `sub`. En mailadresse,
  // doda ikke ejer, ville vaere en loegn - saa vi bruger appens egen adresse,
  // gemt da brugeren tilmeldte sig. Tickeren har ingen request at spoerge.
  kontakt: () => getSetting('push_host') || 'https://localhost',
});

function hentAbonnementer() {
  return db.prepare('SELECT id, endpoint FROM push_subs').all();
}

function fjernAbonnement(id) {
  db.prepare('DELETE FROM push_subs WHERE id = ?').run(id);
}

/**
 * Minder om opgaver, hvis klokkeslaet er naaet.
 *
 * Koerer hvert minut. Vinduet er bevidst lille og ensidigt: fra
 * (tidspunkt - varsel) og hoejst en time frem. Har serveren vaeret nede en
 * hel dag, skal den IKKE vaekke folk med gaarsdagens paamindelser, naar den
 * starter igen - `notified_at` forhindrer gentagelser, men ikke en byge.
 */
/**
 * Skal der mindes om den ugentlige gennemgang lige nu?
 *
 * Baandet i appen har altid vaeret den primaere vej (§5.12), og det er den
 * fortsat: det her er slaaet FRA som standard. Men baandet kraever, at man
 * aabner doda - og gennemgangen er netop den ting, man glemmer at aabne noget
 * for. Andreas bad om muligheden 23-08-2026.
 *
 * `review_notified` er et TIDSSTEMPEL, ikke bare en dato. Datoen alene ville
 * raekke til »én paamindelse pr. dag«, men service workeren skal ogsaa kunne
 * se, om pushen lige er sendt - den henter selv, hvad den skal vise, og skal
 * kunne skelne gennemgangen fra en forfalden opgave.
 */
function gennemgangSkalMindes() {
  if (getSetting('review_push', '') !== '1') return false;
  if (!gennemgangForfalder()) return false;
  const sidst = Number(getSetting('review_notified', '0')) || 0;
  // Samme DAG er nok til at lade vaere - én paamindelse pr. gennemgang.
  if (sidst && parse.fmtDato(new Date(sidst * 1000)) === parse.fmtDato(new Date())) return false;
  const [t, m] = String(getSetting('review_time', '10:00')).split(':').map(Number);
  if (!Number.isFinite(t) || !Number.isFinite(m)) return false;
  const nu = new Date();
  const minutter = nu.getHours() * 60 + nu.getMinutes();
  const paa = t * 60 + m;
  // Samme ensidige vindue som opgaverne: har serveren vaeret nede, skal den
  // ikke vaekke nogen med formiddagens paamindelse om aftenen.
  return minutter >= paa && minutter - paa <= 60;
}

async function tjekPaamindelser() {
  try {
    const abon = hentAbonnementer();
    if (!abon.length) return;

    /*
     * Gennemgangen foerst, og med sin EGEN afsendelse: den har intet at goere
     * med, om der ogsaa er en opgave forfalden lige nu, og de to skal kunne
     * komme hver for sig.
     */
    if (gennemgangSkalMindes()) {
      // Stemples FOER afsendelsen - samme regel som opgaverne.
      setSetting('review_notified', String(now()));
      log(`paaminder om ugentlig gennemgang til ${abon.length} enhed(er)`);
      for (const a of abon) {
        const svar = await push.sendTil(a.endpoint);
        if (svar.borte) fjernAbonnement(a.id);
      }
    }
    const varsel = Number(getSetting('push_lead', '0'));
    if (varsel < 0) return;

    const nu = new Date();
    const iDagStr = parse.fmtDato(nu);
    const minutter = nu.getHours() * 60 + nu.getMinutes() + varsel;

    const forfaldne = db.prepare(`
      SELECT id, title, due_time FROM items
       WHERE due_date = ? AND due_time IS NOT NULL AND deleted = 0
         AND status NOT IN ('done','dropped') AND notified_at IS NULL`).all(iDagStr);

    const skalMindes = forfaldne.filter((r) => {
      const [t, m] = r.due_time.split(':').map(Number);
      const paa = t * 60 + m;
      return minutter >= paa && minutter - paa <= 60;
    });
    if (!skalMindes.length) return;

    // Stemples FOER afsendelsen. Fejler pushen, er en manglende paamindelse
    // bedre end en, der gentages hvert minut i en time.
    const t = now();
    for (const r of skalMindes) {
      db.prepare('UPDATE items SET notified_at = ? WHERE id = ?').run(t, r.id);
    }
    log(`paaminder om ${skalMindes.length} opgave(r) til ${abon.length} enhed(er)`);

    for (const a of abon) {
      const svar = await push.sendTil(a.endpoint);
      if (svar.borte) {
        fjernAbonnement(a.id);
        log('push-abonnement er borte - fjernet');
      } else if (svar.ok) {
        db.prepare('UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?').run(t, a.id);
      } else {
        db.prepare('UPDATE push_subs SET fails = fails + 1 WHERE id = ?').run(a.id);
        // Ti fejl i traek: enheden svarer ikke, og en doed raekke skal ikke
        // blive ved med at koste et kald i minuttet.
        db.prepare('DELETE FROM push_subs WHERE id = ? AND fails >= 10').run(a.id);
      }
    }
  } catch (err) {
    logError(`paamindelser fejlede: ${err.message}`);
  }
}

/* ------------------------------------------------------------- oauth */

/* Connectoren til claude.ai. Motoren star i app/oauth.js; herunder er kun
   det, den ikke kan vide noget om: databasen, samtykkesiden og ruterne. */

const oauth = require('./oauth.js').opret({
  gemKlient(k) {
    db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)')
      .run(k.id, k.name, k.redirect_uris, now());
    audit('oauth-klient-registreret', k.name, null);
  },

  hentKlient(id) {
    return db.prepare('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?')
      .get(String(id || '')) || null;
  },

  /**
   * Access- og refresh-token i ét.
   *
   * Access-tokenet gaar gennem opretToken, sa det ender i tokens-tabellen og
   * valideres af findToken praecis som en haandlavet noegle - bare med et
   * udloeb. Der er ingen anden vej ind i API'et.
   */
  udstedTokens(clientId, scope, userId) {
    const klient = db.prepare('SELECT name FROM oauth_clients WHERE id = ?').get(clientId);
    const t = now();
    const adgang = opretToken(klient ? klient.name : 'OAuth client', scope,
      { clientId, expiresAt: t + oauth.ADGANG_LEVETID });
    const refresh = `dodar_${crypto.randomBytes(32).toString('base64url')}`;
    db.prepare(`INSERT INTO oauth_refresh (hash, token_id, client_id, scope, user_id, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(hashToken(refresh), adgang.id, clientId, scope, userId, t);
    return {
      access_token: adgang.key,
      token_type: 'Bearer',
      expires_in: oauth.ADGANG_LEVETID,
      refresh_token: refresh,
      scope,
    };
  },

  findRefresh(raa) {
    if (typeof raa !== 'string' || !raa.startsWith('dodar_')) return null;
    return db.prepare(`
      SELECT hash, token_id, client_id, scope, user_id FROM oauth_refresh
       WHERE hash = ? AND revoked_at IS NULL`).get(hashToken(raa)) || null;
  },

  tilbagekaldRefresh(raa) {
    db.prepare('UPDATE oauth_refresh SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
      .run(now(), hashToken(String(raa || '')));
  },
});

/** Alt, en klient har faaet: access-tokens OG refresh-tokens. */
function tilbagekaldKlient(clientId) {
  const t = now();
  db.prepare('UPDATE tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL').run(t, clientId);
  db.prepare('UPDATE oauth_refresh SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL').run(t, clientId);
}

/**
 * Kun klienter, jeg rent faktisk har godkendt.
 *
 * En registrering er ikke en forbindelse: claude.ai registrerer sig paa ny,
 * hver gang den proever, og de forsoeg, jeg aldrig sagde ja til, har ingen
 * tokens. Uden EXISTS-tjekket ville listen fyldes med rakker, der bade er
 * uinteressante og ser tilbagekaldte ud.
 */
function hentForbindelser() {
  return db.prepare(`
    SELECT c.id, c.name, c.created_at,
           (SELECT MAX(t.last_used_at) FROM tokens t WHERE t.client_id = c.id) AS last_used_at,
           (SELECT COUNT(*) FROM tokens t
             WHERE t.client_id = c.id AND t.revoked_at IS NULL AND t.expires_at > ?) AS active,
           (SELECT COUNT(*) FROM oauth_refresh r
             WHERE r.client_id = c.id AND r.revoked_at IS NULL) AS refreshes,
           (SELECT t.scope FROM tokens t WHERE t.client_id = c.id ORDER BY t.created_at DESC LIMIT 1) AS scope
      FROM oauth_clients c
     WHERE EXISTS (SELECT 1 FROM tokens t WHERE t.client_id = c.id)
     ORDER BY c.created_at DESC`).all(now());
}

/**
 * Samtykkesiden.
 *
 * Ren HTML med en almindelig <form method="post"> - ingen JavaScript. CSP'en
 * tillader ikke inline scripts uden hash, og en side, der kun har to knapper,
 * har ingen grund til at have brug for dem.
 *
 * Tema-scriptet er den ENE undtagelse: det er ordret det samme som i
 * index.html, og har derfor allerede sin hash i CSP-headeren.
 */
function oauthSide(indhold) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>doda</title>
<meta name="color-scheme" content="light dark">
<script data-theme-init>${INLINE_SCRIPT_TEXT}</script>
<link rel="stylesheet" href="/style.css?v=${APP_VERSION_FIL}">
</head>
<body>
<div class="gate"><div class="card">${indhold}</div></div>
</body>
</html>`;
}

/**
 * @param {string} [formAction]  Ekstra oprindelse i CSP'ens form-action.
 *
 * `form-action` haandhaeves ogsa pa den OMDIRIGERING, indsendelsen foerer til,
 * ikke kun pa formularens egen adresse. Samtykkesiden POSTer til sig selv, men
 * svarer 302 til klientens redirect_uri - og med bare 'self' blokerer browseren
 * hele indsendelsen. Fejlen peger pa /oauth/authorize, sa det ser ud som om
 * knappen ikke virker: intet sker, ingen navigation, ingen serverlog.
 *
 * Derfor tilfoejes praecis den ene oprindelse, klienten er registreret med -
 * ikke https: i al almindelighed.
 */
function sendHtml(res, status, html, formAction) {
  securityHeaders(res);
  if (formAction) {
    res.setHeader('Content-Security-Policy',
      String(res.getHeader('Content-Security-Policy'))
        .replace("form-action 'self'", `form-action 'self' ${formAction}`));
  }
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function oauthFejlside(res, besked) {
  sendHtml(res, 400, oauthSide(`
    <h2 style="margin:0 0 10px">Connection refused</h2>
    <p class="lead">${escHtml(besked)}</p>
    <p class="gate-note">Nothing was granted. You can close this window.</p>`));
}

/**
 * Skjult felt, der binder samtykke-formularen til netop denne session.
 *
 * SameSite=Lax gor allerede en cross-site POST cookieloes, men det er den
 * eneste cookie-godkendte rute i appen, der ikke laeser en JSON-krop - og
 * RUNE-ERFARINGER siger: naar en sikkerhedsregel bor i én faelles funktion,
 * skal de ruter, der IKKE gaar gennem den, have deres egen.
 */
function samtykkeBevis(req) {
  const s = parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
  return crypto.createHmac('sha256', s).update('oauth-consent').digest('hex');
}

const OAUTH_FELTER = ['client_id', 'redirect_uri', 'response_type', 'scope',
  'state', 'code_challenge', 'code_challenge_method'];

function samtykkeHtml(req, q, o) {
  const skjulte = OAUTH_FELTER
    .map((n) => `<input type="hidden" name="${n}" value="${escHtml(q.get(n) || '')}">`).join('\n');
  const hvad = o.scope === 'read'
    ? 'read your tasks, notes, projects and contexts'
    : 'read <em>and change</em> your tasks, notes, projects and contexts';
  return oauthSide(`
    <div class="brand">doda</div>
    <p class="lead" style="text-align:center;margin:18px 0 22px">
      <strong>${escHtml(o.klient.name)}</strong> wants to connect to your doda.</p>
    <p class="lead" style="margin:0 0 6px">If you allow it, it can ${hvad}.</p>
    <p class="lead" style="margin:0 0 22px">It can never change your password, create
      access keys, or revoke connections — those need this browser.</p>
    <form method="post" action="/oauth/authorize">
      ${skjulte}
      <input type="hidden" name="bevis" value="${samtykkeBevis(req)}">
      <button class="btn primary" type="submit" name="godkend" value="ja" style="width:100%">Allow</button>
      <button class="btn" type="submit" name="godkend" value="nej" style="width:100%;margin-top:8px">Cancel</button>
    </form>
    <p class="gate-note">You can revoke this again under Settings → Connected apps.
      Signed in as <strong>${escHtml(parse.visNavn(o.bruger))}</strong>.</p>`);
}

/* CORS. De her fire endepunkter er offentlige opdagelses- og
   udvekslingspunkter uden ambient legitimation: der er ingen cookie at
   misbruge, og en klient i en browser skal kunne naa dem. */
function oauthCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '3600');
}

async function haandterOauth(req, res, urlPath, query) {
  const metode = req.method;

  if (metode === 'OPTIONS') {
    oauthCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  /* --- opdagelse. Begge stier serveres: RFC 9728 haenger ressourcens sti pa
     (/.well-known/oauth-protected-resource/mcp), mens flere klienter proever
     den nogne form foerst. To linjer her sparer en tavs opdagelsesfejl. --- */
  if (/^\/\.well-known\/oauth-protected-resource(\/.*)?$/.test(urlPath)) {
    oauthCors(res);
    sendJson(res, 200, oauth.beskyttetRessource(req));
    return;
  }
  if (/^\/\.well-known\/oauth-authorization-server(\/.*)?$/.test(urlPath)) {
    oauthCors(res);
    sendJson(res, 200, oauth.serverMetadata(req));
    return;
  }

  /* --- dynamisk klientregistrering (RFC 7591) --- */
  if (urlPath === '/oauth/register' && metode === 'POST') {
    oauthCors(res);
    // 60 i timen. En klient registrerer sig ved hvert forsoeg, ogsa dem der
    // afbrydes, sa graensen skal ligge langt over almindelig fumlen: rammes
    // den, findes klienten aldrig, og brugeren far "ukendt klient" pa
    // samtykkesiden - en fejl, der peger et helt andet sted hen end aarsagen.
    if (!rateAllow(`oauth-register:${clientIp(req)}`, 60, 3600)) {
      sendJson(res, 429, { error: 'temporarily_unavailable', error_description: 'Too many registrations. Try again later.' });
      return;
    }
    // tilgivende: der er ingen cookie i spil, sa JSON-kravet (en CSRF-barriere)
    // giver ingen mening her.
    const krop = await readJsonBody(req, true);
    const r = oauth.registrer(krop);
    if (r.fejl) {
      sendJson(res, 400, { error: 'invalid_redirect_uri', error_description: r.fejl });
      return;
    }
    sendJson(res, 201, r.klient);
    return;
  }

  /* --- samtykke --- */
  if (urlPath === '/oauth/authorize' && (metode === 'GET' || metode === 'POST')) {
    const bruger = sessionUser(req);
    if (!bruger) {
      if (metode !== 'GET') { oauthFejlside(res, 'Your session expired while approving. Start the connection again.'); return; }
      // Log ind foerst, og kom saa tilbage hertil. Frontenden sender kun
      // videre til stier, der begynder med /oauth/authorize - aldrig til et
      // fremmed sted (aaben viderestilling).
      const tilbage = `/?next=${encodeURIComponent(req.url)}`;
      res.writeHead(302, { Location: tilbage, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const q = metode === 'GET' ? query : null;
    const felter = q || new URLSearchParams();
    if (metode === 'POST') {
      const krop = await readJsonBody(req, true);
      for (const n of OAUTH_FELTER) felter.set(n, String(krop[n] || ''));
      // Laengden sammenlignes pa BUFFERE, ikke pa strenge: timingSafeEqual
      // kaster ved forskellig laengde, og et flerbyte-tegn ville give to
      // strenge af samme laengde, men to buffere af forskellig.
      const forventet = Buffer.from(samtykkeBevis(req));
      const givet = Buffer.from(String(krop.bevis || ''));
      if (givet.length !== forventet.length || !crypto.timingSafeEqual(givet, forventet)) {
        logSecurity(`oauth-samtykke-afvist ip=${clientIp(req)}`);
        oauthFejlside(res, 'That approval did not come from this browser session.');
        return;
      }
      if (String(krop.godkend || '') !== 'ja') {
        // Afvisning meldes tilbage til klienten, som protokollen kraever -
        // ellers star den og venter pa en kode, der aldrig kommer.
        const o = oauth.tjekAutorisation(felter);
        if (o.fejl || !o.redirect) { oauthFejlside(res, 'Connection cancelled.'); return; }
        const url = new URL(o.redirect);
        url.searchParams.set('error', 'access_denied');
        if (o.state) url.searchParams.set('state', o.state);
        audit('oauth-afvist', o.klient.name, clientIp(req));
        res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    }

    const o = oauth.tjekAutorisation(felter);
    if (o.fejl) { oauthFejlside(res, o.fejl); return; }

    if (metode === 'GET') {
      // Oprindelsen kommer fra en redirect_uri, der ALLEREDE er valideret mod
      // klientens registrerede liste - ikke fra det, browseren sendte.
      let maal = '';
      try { maal = new URL(o.redirect).origin; } catch { /* kan ikke ske efter tjekket */ }
      sendHtml(res, 200,
        samtykkeHtml(req, felter, Object.assign({ bruger: bruger.username }, o)), maal);
      return;
    }

    const url = oauth.giveTilladelse(o, bruger.id);
    audit('oauth-godkendt', o.klient.name, o.scope);
    logSecurity(`oauth-godkendt klient=${o.klient.name}`);
    res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  /* --- token --- */
  if (urlPath === '/oauth/token' && metode === 'POST') {
    oauthCors(res);
    if (!rateAllow(`oauth-token:${clientIp(req)}`, 120, 3600)) {
      sendJson(res, 429, { error: 'temporarily_unavailable', error_description: 'Too many token requests.' });
      return;
    }
    // OAuth-klienter sender application/x-www-form-urlencoded.
    const krop = await readJsonBody(req, true);
    const art = String(krop.grant_type || '');
    let r;
    if (art === 'authorization_code') r = oauth.byttKode(krop);
    else if (art === 'refresh_token') r = oauth.forny(krop);
    else { sendJson(res, 400, { error: 'unsupported_grant_type' }); return; }

    if (r.fejl) {
      logSecurity(`oauth-grant-afvist art=${art} ip=${clientIp(req)}`);
      sendJson(res, 400, { error: r.fejl, error_description: 'That code or refresh token is not valid any more.' });
      return;
    }
    sendJson(res, 200, r);
    return;
  }

  /* --- tilbagekaldelse (RFC 7009). Svarer altid 200: et ugyldigt token er
     allerede tilbagekaldt, og alt andet ville rebe, hvad der findes. --- */
  if (urlPath === '/oauth/revoke' && metode === 'POST') {
    oauthCors(res);
    const krop = await readJsonBody(req, true);
    const t = String(krop.token || '');
    if (t.startsWith('dodar_')) {
      db.prepare('UPDATE oauth_refresh SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
        .run(now(), hashToken(t));
    } else if (t.startsWith('doda_')) {
      db.prepare('UPDATE tokens SET revoked_at = ? WHERE hash = ? AND client_id IS NOT NULL AND revoked_at IS NULL')
        .run(now(), hashToken(t));
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'unknown endpoint' });
}

/* ---------------------------------------------------------- passkeys */

function hentCredentials(userId) {
  return db.prepare(`
    SELECT id, name, alg, sign_count, created_at, last_used_at
      FROM credentials WHERE user_id = ? ORDER BY created_at`).all(userId);
}

function findCredential(id) {
  return db.prepare('SELECT * FROM credentials WHERE id = ?').get(String(id || ''));
}

const webauthn = require('./webauthn.js').opret({
  appName: APP_NAME,
  hentCredentials,
  findCredential,
});

/**
 * Passkeys kraever et secure context. Panelet tilgas pa IP:port over http,
 * hvor WebAuthn slet ikke findes - derfor ma de ALDRIG erstatte kodeordet,
 * og derfor svarer vi med en forklaring i stedet for en kryptisk fejl
 * (RUNE-ERFARINGER, Tilmeld).
 */
/**
 * Andet trin: en engangskode ELLER en genoprettelseskode.
 *
 * To ting, der er lette at glemme, og som begge er rigtige fejl:
 *
 *  - **Den samme kode maa ikke bruges to gange.** Vinduet er 30 sekunder, og
 *    uden `totp_last` kan en opsnappet kode bruges igen inden for det halve
 *    minut. Derfor gemmes det vindue, der passede, og alt til og med det
 *    afvises bagefter.
 *  - **En genoprettelseskode er ENGANGS.** Den stemples brugt, ikke slettet,
 *    saa man bagefter kan se, at den blev brugt - og hvornaar.
 */
function tjekAndetTrin(raa) {
  const hem = getSetting('totp_secret', '');
  if (!hem) return { ok: false, fejl: 'ingen kode er sat op' };

  const vindue = totp.tjek(hem, raa);
  if (vindue !== null) {
    const sidst = Number(getSetting('totp_last', '0')) || 0;
    if (vindue <= sidst) return { ok: false, fejl: 'den kode er allerede brugt' };
    setSetting('totp_last', String(vindue));
    return { ok: true };
  }

  const h = totp.hashKode(raa);
  const r = db.prepare('SELECT hash, used_at FROM recovery_codes WHERE hash = ?').get(h);
  if (!r || r.used_at) return { ok: false };
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE hash = ?').run(now(), h);
  const tilbage = db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL').get().n;
  return { ok: true, recovery: true, tilbage };
}

function passkeySpaerre(req) {
  if (isHttps(req)) return null;
  const v = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  if (v === 'localhost' || v === '127.0.0.1') return null;
  return 'Passkeys need a secure connection (https). Sign in with your password here — '
    + 'that always works, and it is why doda never lets a passkey replace it.';
}

const mcp = require('./mcp.js').opret({
  version: 1,
  parse,
  // Kun det, vaerktoejerne har brug for. Modulet kender hverken databasen
  // eller http'en - sa kan det testes for sig.
  maa: (auth, scope) => SCOPE_TILLADER[auth.token.scope].has(scope),
  godkendMcp,
  // Pegepinden til autorisationsserveren. Stien med /mcp bagpaa er den
  // kanoniske i RFC 9728 (ressourcens sti haenges paa); den nogne form
  // serveres ogsaa, fordi flere klienter proever den foerst.
  oauthUdfordring: (req) => `Bearer realm="doda", `
    + `resource_metadata="${oauth.base(req)}/.well-known/oauth-protected-resource/mcp"`,
  fangst,
  hentItems,
  hentItem,
  opdaterItem,
  renseItem,
  hentProjekter,
  hentOmraader,
  hentKontekster,
  findKontekst,
  findProjekt,
  projektMedIndhold,
  hentGentagelser,
  readJsonBody,
  logError,
  soeg: (q) => soegItems(q),
  fuldfoer(item) {
    const faerdig = opdaterItem(item.id, { status: 'done', completed_at: now() });
    if (!item.recurrence_id) return { item: faerdig, next: null };
    const r = hentGentagelse(item.recurrence_id);
    if (!r) return { item: faerdig, next: null };
    const fra = r.mode === 'completion' ? iDag() : (item.due_date || iDag());
    return { item: faerdig, next: rykGentagelse(r, fra, false), recurrence: hentGentagelse(r.id) };
  },
});

/* Ruter med sti-parametre. Rakkefolgen er den, de proves i. */
const MOENSTRE = [
  {
    // Spring denne gang over. Det registreres - ikke som en fejl, men som
    // information til den ugentlige gennemgang (handover §5.6).
    metode: 'POST', re: /^\/api\/v1\/recurrences\/([\w-]{1,64})\/skip$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      const r = hentGentagelse(ctx.params[0]);
      if (!r) { apiFejl(res, 404, 'not_found', 'No such repeating task.'); return; }
      const aaben = aabenForekomst(r.id);
      if (aaben) opdaterItem(aaben.id, { status: 'dropped', completed_at: now(), skipped: 1 });
      rykGentagelse(r, aaben ? (aaben.due_date || r.next_due) : r.next_due, true);
      sendJson(res, 200, { recurrence: hentGentagelser().find((x) => x.id === r.id) });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/recurrences\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const body = await readJsonBody(req, auth.viaToken);
      const r = hentGentagelse(ctx.params[0]);
      if (!r) { apiFejl(res, 404, 'not_found', 'No such repeating task.'); return; }

      if (typeof body.paused === 'boolean') {
        // Pause bevarer reglen. Den aabne forekomst ryddes af vejen, sa den
        // ikke ligger og lyser i naeste-listen, mens gentagelsen er sat i bero.
        db.prepare('UPDATE recurrences SET paused = ?, updated_at = ? WHERE id = ?')
          .run(body.paused ? 1 : 0, now(), r.id);
        const aaben = aabenForekomst(r.id);
        if (body.paused && aaben) opdaterItem(aaben.id, { status: 'someday' });
        if (!body.paused) {
          const opdateret = hentGentagelse(r.id);
          // Den parkerede forekomst er stadig "aaben" (someday er ikke en
          // afslutning), sa den skal VAEKKES - ikke suppleres med en ny.
          // Ellers ville genoptag lave en dublet, og brugerens rettelser i
          // den parkerede ville gaa tabt.
          if (aaben) {
            opdaterItem(aaben.id, {
              status: 'next',
              due_date: opdateret.next_due,
              defer_date: opdateret.next_due,
            });
          } else opretForekomst(opdateret);
        }
      }

      if (typeof body.rule_text === 'string' && body.rule_text.trim()) {
        const regel = parse.tolkGentagelse(body.rule_text);
        if (!regel) {
          apiFejl(res, 400, 'bad_rule', `Could not understand "${body.rule_text}".`);
          return;
        }
        const naeste = parse.naesteForekomst(regel, parse.fmtDato(parse.plusDage(new Date(), -1)));
        db.prepare('UPDATE recurrences SET rule = ?, mode = ?, next_due = ?, next_time = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(regel), regel.mode, naeste, regel.time || null, now(), r.id);
        const aaben = aabenForekomst(r.id);
        if (aaben) opdaterItem(aaben.id, { due_date: naeste, defer_date: naeste, due_time: regel.time || null });
      }

      // Skabelonen: gaelder ALLE fremtidige forekomster.
      const t = Object.assign({}, r.template);
      if (typeof body.title === 'string' && body.title.trim()) t.title = str(body.title, GRAENSER.title);
      if (typeof body.note === 'string') t.note = str(body.note, GRAENSER.note);
      if (body.project_id === null || typeof body.project_id === 'string') t.project_id = body.project_id || null;
      if (Array.isArray(body.contexts)) t.contexts = body.contexts.filter((x) => typeof x === 'string');
      db.prepare('UPDATE recurrences SET template = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(t), now(), r.id);

      sendJson(res, 200, { recurrence: hentGentagelser().find((x) => x.id === r.id) });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/recurrences\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      db.prepare('UPDATE recurrences SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), ctx.params[0]);
      const aaben = aabenForekomst(ctx.params[0]);
      // Den aabne forekomst bliver staaende som en almindelig opgave - man
      // stopper en vane, man sletter ikke det, der ligger og venter.
      if (aaben) db.prepare('UPDATE items SET recurrence_id = NULL, defer_date = NULL WHERE id = ?').run(aaben.id);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    // Rå krop, ikke multipart: en multipart-parser er ~200 linjer, man selv
    // skal holde sikker. Browseren kan sende en File direkte som krop, og
    // navnet kan staa i adressen.
    metode: 'POST', re: /^\/api\/v1\/items\/([\w-]{1,64})\/files$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;

      // Upload er det ENESTE muterende endepunkt, der ikke gaar gennem
      // readJsonBody - og dermed det eneste uden Content-Type-barrieren.
      // SameSite=Lax daekker det i praksis, men resten af appen har to lag,
      // og denne skal ikke vaere undtagelsen. En HTML-formular kan ikke saette
      // en egen header, og fetch med én udloeser en preflight, vi aldrig svarer.
      // Noegle-adgang er fritaget: der er ingen ambient legitimation at misbruge.
      if (!auth.viaToken && req.headers['x-doda-upload'] !== '1') {
        apiFejl(res, 400, 'missing_header',
          'Uploads from a browser session must send the header X-Doda-Upload: 1.');
        return;
      }

      const item = hentItem(ctx.params[0]);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }

      if (samletStoerrelse() >= MAX_SAMLET) {
        apiFejl(res, 507, 'quota_full', 'Attachment storage is full. Delete some files first.');
        return;
      }
      const id = newId();
      const maal = filSti(id);
      if (!maal) { apiFejl(res, 500, 'server_error', 'Could not allocate a file.'); return; }

      sikreFilesDir();
      let info;
      try {
        info = await modtagFil(req, maal, MAX_FIL);
      } catch (err) {
        // Svar foerst, luk bagefter: resten af den store krop er vi ikke
        // interesserede i, men klienten skal naa at laese begrundelsen.
        res.setHeader('Connection', 'close');
        apiFejl(res, err.status || 400, err.status === 413 ? 'too_large' : 'upload_failed',
          err.message || 'The upload failed.');
        res.on('finish', () => req.destroy());
        return;
      }
      if (!info.size) {
        fs.unlink(maal, () => {});
        apiFejl(res, 400, 'empty_file', 'The file was empty.');
        return;
      }

      const navn = renseFilnavn(ctx.query.get('name'));
      // Klientens Content-Type er kun et HINT. Den bestemmer, om filen vises
      // inline - derfor whitelistes den, og alt ukendt bliver til en download.
      const raaMime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(raaMime) ? raaMime : 'application/octet-stream';
      const b = Number(ctx.query.get('w'));
      const h = Number(ctx.query.get('h'));

      db.prepare(`
        INSERT INTO attachments (id, item_id, name, mime, size, sha, width, height, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, item.id, navn, mime, info.size, info.sha,
          Number.isFinite(b) && b > 0 ? Math.round(b) : null,
          Number.isFinite(h) && h > 0 ? Math.round(h) : null, now());
      db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(now(), item.id);
      audit('fil-uploadet', navn, `${info.size} b`);
      sendJson(res, 200, { attachment: hentVedhaeftninger(item.id).find((a) => a.id === id) });
    },
  },
  {
    metode: 'GET', re: /^\/api\/v1\/files\/([a-f0-9]{32})$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted = 0').get(ctx.params[0]);
      if (!a) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }
      const sti = filSti(a.id);
      let stat;
      try { stat = fs.statSync(sti); } catch { apiFejl(res, 410, 'gone', 'The file is missing on disk.'); return; }

      // Indholdet kan aldrig aendre sig for et givet id - derfor immutable.
      // ETag lader browseren noejes med en 304.
      if (req.headers['if-none-match'] === `"${a.sha}"`) { res.writeHead(304); res.end(); return; }

      const inline = INLINE_MIME.has(a.mime);
      securityHeaders(res);
      res.writeHead(200, {
        // Alt der ikke er et almindeligt billede serveres som en ren
        // bytestroem og TVINGES til download. SVG er med vilje ikke pa
        // listen: den kan baere script og ville koere pa dodas eget domaene.
        'Content-Type': inline ? a.mime : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.name.replace(/["\\]/g, '')}"`,
        'Content-Length': stat.size,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: `"${a.sha}"`,
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(sti).pipe(res);
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/files\/([a-f0-9]{32})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken);
      const a = db.prepare('SELECT id, item_id, name FROM attachments WHERE id = ? AND deleted = 0').get(ctx.params[0]);
      if (!a) { apiFejl(res, 404, 'not_found', 'No such file.'); return; }
      // Raekken slettes haardt OG filen fjernes: en vedhaeftning uden
      // indhold er ubrugelig, og pladsen skal frigives med det samme.
      db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
      const sti = filSti(a.id);
      if (sti) fs.unlink(sti, () => {});
      db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(now(), a.item_id);
      audit('fil-slettet', a.name, null);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/passkeys\/(.{1,256})$/,
    async kald(req, res, ctx) {
      const user = requireUser(req, res);
      if (!user) return;
      await readJsonBody(req);
      // urlPath er ALLEREDE decodeURIComponent'et i dispatcheren - en
      // dekodning mere ville tolke %2520 som et mellemrum.
      db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
        .run(ctx.params[0], user.id);
      audit('passkey-fjernet', user.username, clientIp(req));
      sendJson(res, 200, { credentials: hentCredentials(user.id) });
    },
  },
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
      if (body.link_url === null || body.link_url === '') {
        saet.push('link_url = ?', 'link_title = ?');
        arg.push(null, null);
      } else if (typeof body.link_url === 'string') {
        const rent = rentLink(body.link_url);
        if (rent) {
          saet.push('link_url = ?', 'link_title = ?');
          arg.push(rent, typeof body.link_title === 'string' ? str(body.link_title, 200) : null);
        }
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
    // Tilbagekald en hel forbindelse: bade de access-tokens, den har faaet,
    // og retten til at forny dem. Klienten selv bliver staaende, sa navnet
    // stadig kan genkendes, hvis den proever igen.
    metode: 'DELETE', re: /^\/api\/v1\/connections\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const user = requireUser(req, res);
      if (!user) return;
      await readJsonBody(req);
      const k = db.prepare('SELECT name FROM oauth_clients WHERE id = ?').get(ctx.params[0]);
      if (!k) { apiFejl(res, 404, 'not_found', 'No such connection.'); return; }
      tilbagekaldKlient(ctx.params[0]);
      audit('oauth-tilbagekaldt', k.name, clientIp(req));
      logSecurity(`oauth-tilbagekaldt klient=${k.name}`);
      sendJson(res, 200, { connections: hentForbindelser() });
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
        if (!hentItem(ctx.params[0])) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
        saetKontekster(ctx.params[0], gyldige);
      }
      const item = opdaterItem(ctx.params[0], felter);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }

      // "Kun denne gang" er standard: aendringen rammer forekomsten alene.
      // Med applyToSeries opdateres skabelonen, sa den gaelder alle FREMTIDIGE
      // forekomster ogsaa (handover §5.6).
      if (item.recurrence_id && body.applyToSeries === true) {
        const r = hentGentagelse(item.recurrence_id);
        if (r) {
          const t = Object.assign({}, r.template);
          if (felter.title !== undefined) t.title = felter.title;
          if (felter.note !== undefined) t.note = felter.note;
          if (felter.project_id !== undefined) t.project_id = felter.project_id;
          if (Array.isArray(body.contexts)) t.contexts = item.contexts.map((c) => c.id);
          db.prepare('UPDATE recurrences SET template = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(t), now(), r.id);
        }
      }
      sendJson(res, 200, { item });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/items\/([\w-]{1,64})\/complete$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const item = hentItem(ctx.params[0]);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
      // Én fuldfoerelse pr. element. Er den allerede udfoert, er svaret det
      // samme - sa en genafsendt genvej ikke laver ravage (DESIGN.md §6).
      if (item.status === 'done') { sendJson(res, 200, { item }); return; }
      const faerdig = opdaterItem(item.id, { status: 'done', completed_at: now() });

      if (item.recurrence_id) {
        const r = hentGentagelse(item.recurrence_id);
        if (r) {
          // "Fra fuldfoerelse" regner fra i dag; "fast plan" fra forekomstens
          // egen dato. Det er hele forskellen mellem de to tilstande.
          const fra = r.mode === 'completion' ? iDag() : (item.due_date || iDag());
          const naeste = rykGentagelse(r, fra, false);
          sendJson(res, 200, { item: faerdig, next: naeste, recurrence: hentGentagelse(r.id) });
          return;
        }
      }
      sendJson(res, 200, { item: faerdig });
    },
  },
  {
    metode: 'POST', re: /^\/api\/v1\/items\/([\w-]{1,64})\/uncomplete$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      const item = hentItem(ctx.params[0]);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
      sendJson(res, 200, { item: opdaterItem(item.id, { status: 'next', completed_at: null }) });
    },
  },
  {
    metode: 'GET', re: /^\/api\/v1\/items\/([\w-]{1,64})$/,
    kald(req, res, ctx) {
      const auth = godkend(req, res, 'read');
      if (!auth) return;
      const item = hentItem(ctx.params[0]);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
      sendJson(res, 200, { item });
    },
  },
  {
    metode: 'DELETE', re: /^\/api\/v1\/items\/([\w-]{1,64})$/,
    async kald(req, res, ctx) {
      const auth = godkend(req, res, 'write');
      if (!auth) return;
      await readJsonBody(req, auth.viaToken); // haandhaever JSON-headeren ogsaa pa DELETE

      // Findes den? Det skal afgoeres FOER sletningen.
      //
      // opdaterItem() slutter med at laese raekken frisk gennem hentItem(),
      // som filtrerer deleted = 0 fra. Sletter man, returnerer den derfor
      // ALTID null - og ruten svarede 404 "not found" paa en sletning, der
      // lykkedes. Frontenden viste fejlen og sprang genindlaesningen over,
      // saa raekken blev staaende, selv om den var vaek i databasen.
      const item = hentItem(ctx.params[0]);
      if (!item) { apiFejl(res, 404, 'not_found', 'No such item.'); return; }
      // Bloed sletning: intet forsvinder for altid, og logbogen bliver sand.
      opdaterItem(ctx.params[0], { deleted: 1 });
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
    // Kalenderfeedet er UDEN login - en kalender-app kan ikke sende cookies.
    // Adressen ER hemmeligheden, og den kan tilbagekaldes.
    const ical = urlPath.match(/^\/ical\/([\w-]{16,64})\.ics$/);
    if (ical) {
      const gyldigt = icalToken(false);
      // timingSafeEqual kraever ens laengde - laengdeforskellen er i sig selv
      // harmloes at afsloere.
      const ok = gyldigt && gyldigt.length === ical[1].length
        && crypto.timingSafeEqual(Buffer.from(gyldigt), Buffer.from(ical[1]));
      if (!ok) {
        logSecurity(`ical-token-afvist ip=${clientIp(req)}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const krop = byggIcal(oauth.base(req));
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Length': Buffer.byteLength(krop),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : krop);
      return;
    }

    // OAuth ligger UDEN for /api/: de to .well-known-dokumenter har faste
    // stier, og resten skal kunne staa i en klient-konfiguration. De saetter
    // deres egne CORS-headere og ma derfor ikke gennem securityHeaders, som
    // ville lukke dem igen med Cross-Origin-Resource-Policy: same-origin.
    if (urlPath.startsWith('/oauth/') || urlPath.startsWith('/.well-known/oauth-')) {
      await haandterOauth(req, res, urlPath, query);
      return;
    }

    // MCP ligger pa /mcp - kort nok til at skrive i en klient-konfiguration.
    if (urlPath === '/mcp') {
      securityHeaders(res);
      await mcp.haandter(req, res, { query });
      return;
    }
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
    // OAuth-tokens fornys hver 8. time og hober sig ellers op. De beholdes
    // en maaned efter udloeb, sa "sidst brugt" pa forbindelsen ikke
    // forsvinder, foerste gang der ryddes op.
    db.prepare('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?').run(t - 30 * 86400);
    db.prepare('DELETE FROM oauth_refresh WHERE revoked_at IS NOT NULL AND revoked_at < ?').run(t - 30 * 86400);
    // Registreringer, jeg aldrig sagde ja til. En klient registrerer sig ved
    // hvert forsoeg, sa de her hober sig op uden at betyde noget.
    db.prepare(`DELETE FROM oauth_clients WHERE created_at < ?
                  AND NOT EXISTS (SELECT 1 FROM tokens t WHERE t.client_id = oauth_clients.id)`)
      .run(t - 7 * 86400);
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
sikreFilesDir();
computeInlineHash();
sweep();
setInterval(sweep, 6 * 3600 * 1000).unref();
// Ét minut er den groveste opdeling, der stadig foeles praecis - og den
// koster ingenting, naar der ikke er abonnenter (tjekket returnerer straks).
setInterval(tjekPaamindelser, 60 * 1000).unref();

server.listen(BIND_PORT, () => {
  // Den port, der FAKTISK blev bundet - ikke variablen. At skrive sit eget
  // oenske tilbage beviser ingenting: netop dét gjorde, at v2's portfejl ikke
  // kunne ses i den linje, serveren selv skrev. Med BIND_PORT=0 (som en test
  // kan bruge for at undgaa en optaget port) er det ogsaa det eneste sted,
  // portnummeret findes.
  log(`doda lytter paa port ${server.address().port} (data: ${DATA_DIR})`);
});
