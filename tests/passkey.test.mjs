/* Test af passkeys mod en RIGTIG server.
   Koer: node --test tests/passkey.test.mjs

   Authenticatoren er ~40 linjer software (RUNE-ERFARINGER §3): en ES256-noegle
   fra node:crypto plus handlavet authData. Det daekker routes, challenge,
   database og counter-tjek - ikke bare kryptobiblioteket. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8939;
// localhost er et secure context - saa passkeys er tilladt, praecis som i
// en rigtig browser.
const BASE = `http://localhost:${PORT}`;
const RP_ID = 'localhost';

let server;
let dataDir;
let cookie = '';

const J = async (sti, krop, metode) => {
  const r = await fetch(BASE + sti, {
    method: metode || (krop === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const s = r.headers.get('set-cookie');
  if (s) cookie = s.split(';')[0];
  return { status: r.status, krop: await r.json() };
};

/* ------------------------------------------------- software-authenticator */

const b64u = (b) => Buffer.from(b).toString('base64url');

function nyAuthenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(32);
  let taeller = 0;

  // COSE_Key for ES256: {1:2, 3:-7, -1:1, -2:x, -3:y}
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y, 'base64url'),
  ]);

  const authData = (flags, medNoegle, taellerVaerdi) => {
    const hoved = Buffer.concat([
      crypto.createHash('sha256').update(RP_ID).digest(),
      Buffer.from([flags]),
      Buffer.alloc(4),
    ]);
    hoved.writeUInt32BE(taellerVaerdi, 33);
    if (!medNoegle) return hoved;
    const laengde = Buffer.alloc(2);
    laengde.writeUInt16BE(credId.length);
    return Buffer.concat([hoved, Buffer.alloc(16), laengde, credId, cose]);
  };

  const clientData = (type, challenge) => b64u(JSON.stringify({
    type, challenge, origin: BASE, crossOrigin: false,
  }));

  return {
    credId: b64u(credId),
    opret(challenge) {
      const ad = authData(0x45, true, 0);   // UP | UV | AT
      // fmt:"none", attStmt:{}, authData
      const att = Buffer.concat([
        Buffer.from([0xa3, 0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65,
          0x67, 0x61, 0x74, 0x74, 0x53, 0x74, 0x6d, 0x74, 0xa0,
          0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61, 0x59]),
        (() => { const l = Buffer.alloc(2); l.writeUInt16BE(ad.length); return l; })(),
        ad,
      ]);
      return { attestationObject: b64u(att), clientDataJSON: clientData('webauthn.create', challenge) };
    },
    login(challenge, opt = {}) {
      taeller = opt.taeller !== undefined ? opt.taeller : taeller + 1;
      const ad = authData(opt.flags !== undefined ? opt.flags : 0x05, false, taeller);
      const cd = clientData('webauthn.get', challenge);
      const signeret = Buffer.concat([ad, crypto.createHash('sha256').update(Buffer.from(cd, 'base64url')).digest()]);
      const noegle = opt.forkertNoegle
        ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey : privateKey;
      return {
        id: b64u(credId),
        authenticatorData: b64u(ad),
        clientDataJSON: cd,
        signature: b64u(crypto.sign('sha256', signeret, noegle)),
      };
    },
  };
}

/* ------------------------------------------------------------------- */

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-pk-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir, TZ: 'Europe/Copenhagen' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fejl) => {
    const t = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(t); ok(); } });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
  await J('/api/register', { username: 'test', password: 'testtest123' });
});

after(() => {
  if (server) server.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let auth;

test('registrering af en passkey', async () => {
  auth = nyAuthenticator();
  const o = await J('/api/webauthn/register/options', {});
  assert.equal(o.status, 200);
  assert.equal(o.krop.publicKey.rp.id, RP_ID, 'rpId udledes af vaerten, ikke af en indstilling');
  assert.equal(o.krop.publicKey.attestation, 'none');
  assert.ok(o.krop.publicKey.challenge);

  const svar = auth.opret(o.krop.publicKey.challenge);
  const v = await J('/api/webauthn/register/verify',
    Object.assign({ challengeId: o.krop.challengeId, name: 'Min MacBook' }, svar));
  assert.equal(v.status, 200, JSON.stringify(v.krop));
  assert.equal(v.krop.credentials.length, 1);
  assert.equal(v.krop.credentials[0].name, 'Min MacBook');
  assert.equal(v.krop.credentials[0].alg, 'ES256');
});

test('login med passkey — uden brugernavn og uden session', async () => {
  cookie = '';                                   // som en helt frisk browser
  const o = await J('/api/webauthn/login/options', {});
  assert.equal(o.status, 200);
  assert.deepEqual(o.krop.publicKey.allowCredentials, [],
    'tom allowCredentials: login roeber ikke hvilke konti der findes');

  const v = await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o.krop.challengeId }, auth.login(o.krop.publicKey.challenge)));
  assert.equal(v.status, 200, JSON.stringify(v.krop));
  assert.equal(v.krop.user.username, 'test');

  // Sessionen virker bagefter.
  assert.equal((await J('/api/me')).krop.user.username, 'test');
});

test('en challenge kan kun bruges ÉN gang', async () => {
  const o = await J('/api/webauthn/login/options', {});
  const svar = auth.login(o.krop.publicKey.challenge);
  assert.equal((await J('/api/webauthn/login/verify', Object.assign({ challengeId: o.krop.challengeId }, svar))).status, 200);
  const igen = await J('/api/webauthn/login/verify', Object.assign({ challengeId: o.krop.challengeId }, svar));
  assert.equal(igen.status, 401, 'genafspilning skal afvises');
});

test('forkert signatur afvises', async () => {
  const o = await J('/api/webauthn/login/options', {});
  const v = await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o.krop.challengeId },
      auth.login(o.krop.publicKey.challenge, { forkertNoegle: true })));
  assert.equal(v.status, 401);
  assert.match(v.krop.message, /signatur/);
});

test('en fremmed challenge afvises', async () => {
  const o = await J('/api/webauthn/login/options', {});
  const v = await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o.krop.challengeId },
      auth.login(Buffer.from('noget helt andet').toString('base64url'))));
  assert.equal(v.status, 401);
});

test('manglende brugertilstedeværelse afvises', async () => {
  const o = await J('/api/webauthn/login/options', {});
  const v = await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o.krop.challengeId },
      auth.login(o.krop.publicKey.challenge, { flags: 0x00 })));
  assert.equal(v.status, 401);
});

test('counter der ikke vokser ser ud som en klon', async () => {
  const o1 = await J('/api/webauthn/login/options', {});
  await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o1.krop.challengeId }, auth.login(o1.krop.publicKey.challenge, { taeller: 50 })));

  const o2 = await J('/api/webauthn/login/options', {});
  const v = await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o2.krop.challengeId }, auth.login(o2.krop.publicKey.challenge, { taeller: 40 })));
  assert.equal(v.status, 401);
  assert.match(v.krop.message, /klonet/);
});

test('en nøgle der ikke findes afvises', async () => {
  const o = await J('/api/webauthn/login/options', {});
  const svar = auth.login(o.krop.publicKey.challenge, { taeller: 999 });
  svar.id = Buffer.from('findes-ikke').toString('base64url');
  const v = await J('/api/webauthn/login/verify', Object.assign({ challengeId: o.krop.challengeId }, svar));
  assert.equal(v.status, 401);
});

test('passkeys kan ALDRIG erstatte kodeordet', async () => {
  // Kodeordslogin skal blive ved med at virke, ogsaa naar der findes en passkey.
  cookie = '';
  const r = await J('/api/login', { username: 'test', password: 'testtest123' });
  assert.equal(r.status, 200, 'kodeordet er den vej, der altid virker');

  // Og appen fortaeller ARLIGT, om passkeys overhovedet er mulige her.
  const cfg = await J('/api/public-config');
  assert.equal(typeof cfg.krop.passkeys, 'boolean');
  assert.equal(cfg.krop.hasPasskeys, true);
});

test('nøglen kan fjernes igen, og så virker den ikke mere', async () => {
  const liste = (await J('/api/v1/passkeys')).krop.credentials;
  assert.equal(liste.length, 1);
  assert.ok(liste[0].last_used_at, 'sidst brugt skal vaere stemplet');

  const v = await J(`/api/v1/passkeys/${encodeURIComponent(liste[0].id)}`, {}, 'DELETE');
  assert.equal(v.status, 200);
  assert.equal(v.krop.credentials.length, 0);

  cookie = '';
  const o = await J('/api/webauthn/login/options', {});
  const ind = await J('/api/webauthn/login/verify',
    Object.assign({ challengeId: o.krop.challengeId }, auth.login(o.krop.publicKey.challenge, { taeller: 5000 })));
  assert.equal(ind.status, 401, 'en fjernet noegle skal holde op med at virke med det samme');
});
