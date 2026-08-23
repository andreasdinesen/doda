/*
 * Totrinsbekraeftelse.
 *
 * To lag: selve algoritmen (RFC 6238) og de regler, serveren laegger ovenpaa.
 * Det foerste proeves mod RFC'ens EGNE testvektorer - en implementering, der
 * kun er enig med sig selv, er ikke bevist. Det andet er dét, der plejer at
 * vaere galt: genbrug af en kode, en noedudgang uden ende, og en kontakt, der
 * kan slaas fra af en, som gaar forbi en ulaast skaerm.
 */

import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}`;
const require = createRequire(import.meta.url);
const T = require(join(ROD, 'app', 'totp.js'));

let server;
let dataDir;
let cookie = '';

const J = async (sti, krop, metode) => {
  const r = await fetch(BASE + sti, {
    method: metode || (krop === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const saet = r.headers.get('set-cookie');
  if (saet) cookie = saet.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};

const kodeNu = (hem) => T.kodeFor(hem, Math.floor(Date.now() / 1000 / 30));

/*
 * Naeste kode, som om der var gaaet 30 sekunder.
 *
 * Serveren braender det vindue, en kode kom fra (ellers kunne en opsnappet
 * kode bruges igen inden for det halve minut) - og det er PRAECIS det, vi
 * vil have. Men saa kan to logins i samme test heller ikke bruge samme
 * vindue, og en test kan ikke vente et halvt minut.
 *
 * `nulstilVindue()` spoler kun URET frem; den roerer ikke selve reglen. Den
 * test, der proever genbrugs-spaerren, bruger den med vilje IKKE.
 */
const nulstilVindue = () => {
  const db = new DatabaseSync(join(dataDir, 'doda.db'));
  try { db.prepare("DELETE FROM settings WHERE key = 'totp_last'").run(); } finally { db.close(); }
};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-totp-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
  await J('/api/register', { username: 'test', password: 'testtest123' });
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/* ------------------------------------------------ algoritmen (RFC 6238) */

test('RFC 6238s egne testvektorer passer', () => {
  // Hemmeligheden fra RFC'ens Appendix B. Facit er 8-cifret; vi laver 6.
  const hem = T.base32(Buffer.from('12345678901234567890', 'utf8'));
  const facit = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [tid, otte] of facit) {
    assert.equal(T.kodeFor(hem, Math.floor(tid / 30)), otte.slice(-6), `T=${tid}`);
  }
});

test('base32 er uden polstring - ellers afviser apps hemmeligheden', () => {
  assert.ok(!T.nyHemmelighed().includes('='));
  assert.match(T.nyHemmelighed(), /^[A-Z2-7]{32}$/);
});

test('et vindue til hver side godtages - men ikke to', () => {
  const hem = T.nyHemmelighed();
  const nu = Date.now();
  const c = Math.floor(nu / 1000 / 30);
  assert.ok(T.tjek(hem, T.kodeFor(hem, c), nu) !== null, 'nu');
  assert.ok(T.tjek(hem, T.kodeFor(hem, c - 1), nu) !== null, 'vinduet foer');
  assert.ok(T.tjek(hem, T.kodeFor(hem, c + 1), nu) !== null, 'vinduet efter');
  assert.equal(T.tjek(hem, T.kodeFor(hem, c - 2), nu), null, 'to vinduer tilbage er for meget');
});

test('vrøvl er ikke en kode', () => {
  const hem = T.nyHemmelighed();
  for (const k of ['', '12345', '1234567', 'abcdef', null, undefined]) {
    assert.equal(T.tjek(hem, k), null, JSON.stringify(k));
  }
});

/* ------------------------------------------------- reglerne omkring den */

test('hemmeligheden forlader ALDRIG serveren efter opsætningen', async () => {
  const s = await J('/api/v1/totp/setup', {});
  assert.equal(s.status, 200);
  assert.match(s.data.secret, /^[A-Z2-7]{32}$/, 'ved opsaetningen SKAL den vises - én gang');

  // Men ikke i noget andet svar.
  const status = await J('/api/v1/totp');
  assert.equal(JSON.stringify(status.data).includes(s.data.secret), false);
  const set = await J('/api/v1/settings');
  assert.equal(JSON.stringify(set.data).includes(s.data.secret), false);
  // Og heller ikke ad eksportens vej - den fælde har ramt før (doda v16).
  const eks = await J('/api/v1/export');
  assert.equal(JSON.stringify(eks.data).includes(s.data.secret), false,
    'og slet ikke i en eksportfil, brugeren maaske deler videre');
});

test('den er ikke slået til, før en kode er set', async () => {
  const st = await J('/api/v1/totp');
  assert.equal(st.data.enabled, false, 'en halv opsaetning maa ikke laase nogen ude');
  assert.equal(st.data.pending, true);
});

test('en forkert kode slår den ikke til', async () => {
  const r = await J('/api/v1/totp/enable', { code: '000000' });
  assert.equal(r.status, 400);
  assert.equal((await J('/api/v1/totp')).data.enabled, false);
});

/* Fra her og ned er den slaaet TIL, og koderne gemmes mellem testene. */
let HEM = '';
let KODER = [];

test('en rigtig kode slår den til - og giver nødudgange med det samme', async () => {
  const s = await J('/api/v1/totp/setup', {});
  HEM = s.data.secret;
  const r = await J('/api/v1/totp/enable', { code: kodeNu(HEM) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  KODER = r.data.recovery;
  assert.equal(KODER.length, 10, 'uden noedudgange laaser en mistet telefon ejeren ude');
  assert.match(KODER[0], /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  // Ingen 0/O eller 1/I: de skal kunne skrives af fra papir uden at gaette.
  assert.ok(!KODER.join('').match(/[01OI]/), 'ingen tegn, der kan forveksles');
  assert.equal((await J('/api/v1/totp')).data.enabled, true);
});

test('login med kodeord alene rækker ikke længere', async () => {
  const gemt = cookie;
  cookie = '';
  const r = await J('/api/login', { username: 'test', password: 'testtest123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.needsCode, true, 'klienten skal vide, at der mangler ét trin');
  assert.equal(r.data.user, undefined, 'et halvt login maa ikke rœbe noget');
  cookie = gemt;
});

test('forkert kodeord afvises stadig FØR koden overhovedet kommer i spil', async () => {
  const gemt = cookie;
  cookie = '';
  const r = await J('/api/login', { username: 'test', password: 'forkert', code: kodeNu(HEM) });
  assert.equal(r.status, 401);
  assert.equal(r.data.needsCode, undefined, 'en rigtig kode maa ikke redde et forkert kodeord');
  cookie = gemt;
});

test('kodeord plus kode lukker ind', async () => {
  const gemt = cookie;
  cookie = '';
  nulstilVindue();
  const r = await J('/api/login', { username: 'test', password: 'testtest123', code: kodeNu(HEM) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.username, 'test');
  cookie = gemt;
});

/* Den fejl, der er lettest at lave: vinduet er 30 sekunder, saa en opsnappet
   kode kan bruges igen inden for det halve minut, hvis den ikke braendes. */
test('den SAMME kode kan ikke bruges to gange', async () => {
  const gemt = cookie;
  cookie = '';
  nulstilVindue();
  const k = kodeNu(HEM);
  const et = await J('/api/login', { username: 'test', password: 'testtest123', code: k });
  assert.equal(et.status, 200, 'foerste gang skal virke');
  // Ingen nulstilling her - det er netop spaerren, der proeves.
  cookie = '';
  const to = await J('/api/login', { username: 'test', password: 'testtest123', code: k });
  assert.equal(to.status, 401, 'anden gang maa ikke');
  assert.equal(to.data.error, 'bad_code');
  assert.match(to.data.message, /allerede brugt/);
  cookie = gemt;
});

test('en genoprettelseskode virker - og kun én gang', async () => {
  const gemt = cookie;
  cookie = '';
  nulstilVindue();
  const k = KODER[0];
  const et = await J('/api/login', { username: 'test', password: 'testtest123', code: k });
  assert.equal(et.status, 200, JSON.stringify(et.data));
  cookie = '';
  const to = await J('/api/login', { username: 'test', password: 'testtest123', code: k });
  assert.equal(to.status, 401, 'en noedudgang er ENGANGS');
  cookie = gemt;
  assert.equal((await J('/api/v1/totp')).data.recoveryLeft, 9, 'og der er én mindre tilbage');
});

test('en genoprettelseskode må gerne skrives med bindestreg eller uden, stort eller småt', async () => {
  const gemt = cookie;
  cookie = '';
  const k = KODER[1].toLowerCase().replace('-', ' ');
  const r = await J('/api/login', { username: 'test', password: 'testtest123', code: k });
  assert.equal(r.status, 200, 'den skrives af fra papir - formen maa ikke vaere en faelde');
  cookie = gemt;
});

/* En aaben session er ikke nok: har nogen faaet fat i en ulaast skaerm, skal
   de ikke kunne fjerne det andet trin med ét klik. */
test('den kan kun slås fra mod kodeordet', async () => {
  const uden = await J('/api/v1/totp/disable', {});
  assert.equal(uden.status, 401);
  const forkert = await J('/api/v1/totp/disable', { password: 'noget andet' });
  assert.equal(forkert.status, 401);
  assert.equal((await J('/api/v1/totp')).data.enabled, true, 'stadig slaaet til');

  const rigtig = await J('/api/v1/totp/disable', { password: 'testtest123' });
  assert.equal(rigtig.status, 200);
  const st = await J('/api/v1/totp');
  assert.equal(st.data.enabled, false);
  assert.equal(st.data.recoveryLeft, 0, 'noedudgangene skal vaek sammen med den');
});

test('når den er slået fra, rækker kodeordet igen', async () => {
  const gemt = cookie;
  cookie = '';
  const r = await J('/api/login', { username: 'test', password: 'testtest123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'test');
  cookie = gemt;
});
