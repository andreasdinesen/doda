/* Integrationstest af OAuth 2.1-connectoren. Koerer mod en rigtig server over
   HTTP og gaar praecis den vej, claude.ai gaar: opdagelse -> registrering ->
   samtykke -> kode -> token -> /mcp.

   Koer: node --test tests/oauth.test.mjs */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8936;
const BASE = `http://127.0.0.1:${PORT}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let server;
let dataDir;
let cookie = '';

/* --------------------------------------------------------------- hjaelpere */

const b64u = (b) => Buffer.from(b).toString('base64url');
const udfordring = (verifier) => b64u(createHash('sha256').update(verifier).digest());

const api = async (sti, krop, metode) => {
  const r = await fetch(BASE + sti, {
    method: metode || (krop === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const s = r.headers.get('set-cookie');
  if (s) cookie = s.split(';')[0];
  return r.json();
};

/** Registrerer en klient, som claude.ai ville. Ingen cookie - klienten er udefra. */
async function registrer(navn, uris) {
  const r = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: navn, redirect_uris: uris || [REDIRECT] }),
  });
  // En 429 her ville ellers foerst vise sig tre trin senere som "ukendt
  // klient" paa samtykkesiden - samme vildledende sti som en rigtig bruger
  // faar. Sig det hoejt med det samme.
  if (r.status === 429) throw new Error('registreringsgraensen ramt - er den for lav?');
  return { status: r.status, krop: await r.json() };
}

function autoriseringsUrl(felter) {
  const q = new URLSearchParams(Object.assign({
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: 'full',
    code_challenge_method: 'S256',
  }, felter));
  return `/oauth/authorize?${q}`;
}

/** Gaar hele samtykkesiden igennem og returnerer redirect-adressen. */
async function samtykke(felter, godkend = 'ja') {
  const sti = autoriseringsUrl(felter);
  const vis = await fetch(BASE + sti, { headers: { cookie }, redirect: 'manual' });
  const html = await vis.text();
  if (vis.status !== 200) return { status: vis.status, html };

  const bevis = html.match(/name="bevis" value="([a-f0-9]+)"/);
  const krop = new URLSearchParams(Object.assign({}, felter, {
    response_type: 'code', redirect_uri: REDIRECT, scope: 'full',
    code_challenge_method: 'S256', bevis: bevis ? bevis[1] : '', godkend,
  }));
  const svar = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(krop),
    redirect: 'manual',
  });
  return { status: svar.status, html, sted: svar.headers.get('location') };
}

/** Henter en kode helt frem til redirect'en. */
async function hentKode(clientId, verifier) {
  const r = await samtykke({ client_id: clientId, code_challenge: udfordring(verifier) });
  assert.equal(r.status, 302, 'samtykke skulle give en omdirigering');
  return new URL(r.sted).searchParams.get('code');
}

const token = async (felter) => {
  const r = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams(felter)),
  });
  return { status: r.status, krop: await r.json() };
};

const mcp = async (noegle, metode = 'tools/list') => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      noegle ? { Authorization: `Bearer ${noegle}` } : {}),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metode, params: {} }),
  });
  return { status: r.status, auth: r.headers.get('www-authenticate'), krop: r.status === 401 ? await r.json() : await r.json() };
};

/* ------------------------------------------------------------- opsaetning */

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-oauth-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir, TZ: 'Europe/Copenhagen' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
  await api('/api/register', { username: 'test', password: 'testtest123' });
});

after(() => {
  if (server) server.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/* --------------------------------------------------------------- opdagelse */

test('/mcp uden token: 401 med WWW-Authenticate og resource_metadata', async () => {
  const r = await mcp(null);
  assert.equal(r.status, 401);
  // Uden den her header kan Claude slet ikke finde autorisationsserveren.
  assert.match(r.auth, /^Bearer realm="doda"/);
  const m = r.auth.match(/resource_metadata="([^"]+)"/);
  assert.ok(m, 'WWW-Authenticate skal pege paa ressource-metadataene');
  assert.match(m[1], /\/\.well-known\/oauth-protected-resource\/mcp$/);

  // og adressen skal rent faktisk svare.
  const doc = await (await fetch(m[1].replace(/^http:\/\/[^/]+/, BASE))).json();
  assert.equal(doc.resource, `${BASE}/mcp`);
});

test('begge .well-known svarer UDEN login og peger de rigtige steder hen', async () => {
  const r = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const res = await r.json();
  assert.equal(res.resource, `${BASE}/mcp`);
  assert.deepEqual(res.authorization_servers, [BASE]);

  // Samme dokument paa den sti, RFC 9728 udpeger (ressourcens sti haengt paa).
  assert.deepEqual(await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json(), res);

  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, BASE);
  assert.equal(as.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${BASE}/oauth/token`);
  assert.equal(as.registration_endpoint, `${BASE}/oauth/register`);
  // OAuth 2.1: kun S256, ingen implicit, ingen klienthemmelighed.
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.ok(!as.response_types_supported.includes('token'));
});

/* ------------------------------------------------------------ registrering */

test('registrering giver et client_id og kraever https', async () => {
  const ok = await registrer('Testklient');
  assert.equal(ok.status, 201);
  assert.match(ok.krop.client_id, /^doda-client-[0-9a-f]+$/);
  assert.equal(ok.krop.token_endpoint_auth_method, 'none');

  for (const daarlig of [['http://evil.example/cb'], [], ['ikke en url']]) {
    const r = await registrer('Ond', daarlig);
    assert.equal(r.status, 400, `${JSON.stringify(daarlig)} skulle afvises`);
  }
  // localhost er den eneste http-undtagelse - ellers kan man ikke proeve
  // med et lokalt vaerktoej uden certifikat.
  assert.equal((await registrer('Lokal', ['http://localhost:9000/cb'])).status, 201);
});

/* -------------------------------------------------------------- autorisation */

test('/authorize afviser ukendt klient, fremmed redirect og daarlig PKCE', async () => {
  const { krop: klient } = await registrer('Kontrol');
  const god = udfordring(randomBytes(32).toString('hex'));

  const proev = async (felter, sti) => {
    const r = await fetch(BASE + (sti || autoriseringsUrl(felter)), { headers: { cookie }, redirect: 'manual' });
    return { status: r.status, html: await r.text() };
  };

  assert.equal((await proev({ client_id: 'findes-ikke', code_challenge: god })).status, 400);

  // Ikke-registreret redirect_uri. NOEJAGTIG match - ingen praefiks.
  const fremmed = await proev(null, `/oauth/authorize?${new URLSearchParams({
    client_id: klient.client_id, response_type: 'code', scope: 'full',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback/evil',
    code_challenge: god, code_challenge_method: 'S256',
  })}`);
  assert.equal(fremmed.status, 400);
  assert.match(fremmed.html, /not registered/);

  // Manglende PKCE, og "plain" i stedet for S256.
  assert.equal((await proev({ client_id: klient.client_id, code_challenge: '' })).status, 400);
  assert.equal((await proev({
    client_id: klient.client_id, code_challenge: god, code_challenge_method: 'plain',
  })).status, 400);

  // ... men den rigtige forespoergsel viser samtykkesiden.
  const ok = await proev({ client_id: klient.client_id, code_challenge: god });
  assert.equal(ok.status, 200);
  assert.match(ok.html, /Kontrol/);
  assert.match(ok.html, /wants to connect/);
});

test('samtykkesiden kraever en session — ellers sendes man til login og tilbage', async () => {
  const { krop: klient } = await registrer('Uden session');
  const sti = autoriseringsUrl({ client_id: klient.client_id, code_challenge: udfordring('x'.repeat(43)) });
  const r = await fetch(BASE + sti, { redirect: 'manual' });   // ingen cookie
  assert.equal(r.status, 302);
  const sted = new URL(r.headers.get('location'), BASE);
  assert.equal(sted.pathname, '/');
  assert.equal(sted.searchParams.get('next'), sti);
});

test('CSP: form-action skal tillade klientens redirect, ellers doer Allow-knappen tavst', async () => {
  // form-action haandhaeves ogsa pa den OMDIRIGERING, indsendelsen foerer til.
  // Med bare 'self' blokerer browseren hele POST'en, fejlen peger paa
  // /oauth/authorize, og der sker INTET: ingen navigation, ingen serverlog.
  // Det ramte v5 i praksis, og en test med en redirect tilbage til samme
  // vaert ville aldrig have fanget det.
  const { krop: klient } = await registrer('CSP-kontrol');
  const sti = autoriseringsUrl({ client_id: klient.client_id, code_challenge: udfordring('q'.repeat(43)) });
  const r = await fetch(BASE + sti, { headers: { cookie } });
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /form-action 'self' https:\/\/claude\.ai/);
  // Kun oprindelsen - ikke hele stien, og ikke https: i al almindelighed.
  assert.ok(!csp.includes('auth_callback'));

  // Og resten af appen skal vaere uroert.
  const app = await fetch(`${BASE}/`);
  assert.match(app.headers.get('content-security-policy'), /form-action 'self';/);
});

test('en POST uden gyldigt bevis afvises — samtykket skal komme fra denne browser', async () => {
  const { krop: klient } = await registrer('Forfalsket');
  const r = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams({
      client_id: klient.client_id, redirect_uri: REDIRECT, response_type: 'code',
      scope: 'full', code_challenge: udfordring('y'.repeat(43)), code_challenge_method: 'S256',
      bevis: 'deadbeef', godkend: 'ja',
    })),
    redirect: 'manual',
  });
  assert.equal(r.status, 400);
});

test('trykker jeg Cancel, faar klienten access_denied — ikke tavshed', async () => {
  const { krop: klient } = await registrer('Fortrudt');
  const r = await samtykke({
    client_id: klient.client_id, code_challenge: udfordring('z'.repeat(43)), state: 'abc123',
  }, 'nej');
  assert.equal(r.status, 302);
  const u = new URL(r.sted);
  assert.equal(u.searchParams.get('error'), 'access_denied');
  assert.equal(u.searchParams.get('state'), 'abc123');
  assert.equal(u.searchParams.get('code'), null);
});

/* --------------------------------------------------------------- token */

test('hele flowet: kode + verifier giver et token, der virker paa /mcp', async () => {
  const { krop: klient } = await registrer('Claude (fuld)');
  const verifier = randomBytes(32).toString('base64url');

  const r = await samtykke({
    client_id: klient.client_id, code_challenge: udfordring(verifier), state: 'staten',
  });
  assert.equal(r.status, 302);
  const u = new URL(r.sted);
  assert.equal(u.origin + u.pathname, REDIRECT);
  assert.equal(u.searchParams.get('state'), 'staten');

  const t = await token({
    grant_type: 'authorization_code', code: u.searchParams.get('code'),
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  });
  assert.equal(t.status, 200);
  assert.equal(t.krop.token_type, 'Bearer');
  assert.ok(t.krop.expires_in > 0);
  assert.match(t.krop.access_token, /^doda_/);
  assert.match(t.krop.refresh_token, /^dodar_/);

  // Tokenet gaar gennem samme vej som en haandlavet noegle: baade MCP ...
  const m = await mcp(t.krop.access_token);
  assert.equal(m.status, 200);
  assert.ok(m.krop.result.tools.length > 0);

  // ... og det almindelige API.
  const a = await fetch(`${BASE}/api/v1/state`, { headers: { Authorization: `Bearer ${t.krop.access_token}` } });
  assert.equal(a.status, 200);

  // ... men IKKE de ruter, der kraever en rigtig session. En connector maa
  // aldrig kunne lave sig en varig noegle eller skifte mit kodeord.
  for (const sti of ['/api/v1/tokens', '/api/v1/connections']) {
    const spaerret = await fetch(BASE + sti, { headers: { Authorization: `Bearer ${t.krop.access_token}` } });
    assert.equal(spaerret.status, 401, `${sti} skal kraeve en session`);
  }
});

test('koden er ENGANGSBRUG', async () => {
  const { krop: klient } = await registrer('Genbrug');
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(klient.client_id, verifier);
  const felter = {
    grant_type: 'authorization_code', code: kode,
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  };
  assert.equal((await token(felter)).status, 200);
  const igen = await token(felter);
  assert.equal(igen.status, 400);
  assert.equal(igen.krop.error, 'invalid_grant');
});

test('forkert code_verifier afvises', async () => {
  const { krop: klient } = await registrer('Forkert PKCE');
  const kode = await hentKode(klient.client_id, randomBytes(32).toString('base64url'));
  const r = await token({
    grant_type: 'authorization_code', code: kode,
    client_id: klient.client_id, redirect_uri: REDIRECT,
    code_verifier: randomBytes(32).toString('base64url'),
  });
  assert.equal(r.status, 400);
  assert.equal(r.krop.error, 'invalid_grant');
});

test('en kode udstedt til klient A kan ikke indloeses af klient B', async () => {
  const a = (await registrer('Klient A')).krop;
  const b = (await registrer('Klient B')).krop;
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(a.client_id, verifier);

  const tyv = await token({
    grant_type: 'authorization_code', code: kode,
    client_id: b.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  });
  assert.equal(tyv.status, 400);
  assert.equal(tyv.krop.error, 'invalid_grant');

  // Og koden er brugt op af forsoeget - selv den rigtige klient faar den ikke.
  const ejeren = await token({
    grant_type: 'authorization_code', code: kode,
    client_id: a.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  });
  assert.equal(ejeren.status, 400);
});

test('refresh ROTERER: den gamle holder op med at virke', async () => {
  const { krop: klient } = await registrer('Fornyelse');
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(klient.client_id, verifier);
  const foerste = (await token({
    grant_type: 'authorization_code', code: kode,
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;

  const ny = await token({
    grant_type: 'refresh_token', refresh_token: foerste.refresh_token, client_id: klient.client_id,
  });
  assert.equal(ny.status, 200);
  assert.notEqual(ny.krop.refresh_token, foerste.refresh_token);
  assert.notEqual(ny.krop.access_token, foerste.access_token);
  assert.equal((await mcp(ny.krop.access_token)).status, 200);

  // Den gamle er doed i samme oejeblik, den nye blev foedt.
  const gammel = await token({
    grant_type: 'refresh_token', refresh_token: foerste.refresh_token, client_id: klient.client_id,
  });
  assert.equal(gammel.status, 400);
  assert.equal(gammel.krop.error, 'invalid_grant');

  // Og en fremmed klient kan ikke forny en andens refresh.
  const b = (await registrer('Fremmed')).krop;
  assert.equal((await token({
    grant_type: 'refresh_token', refresh_token: ny.krop.refresh_token, client_id: b.client_id,
  })).status, 400);
});

test('access token UDLOEBER', async () => {
  const { krop: klient } = await registrer('Udloeb');
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(klient.client_id, verifier);
  const t = (await token({
    grant_type: 'authorization_code', code: kode,
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;
  assert.equal((await mcp(t.access_token)).status, 200);

  // Uret kan ikke flyttes gennem API'et - saa vi flytter udloebet i databasen
  // ved siden af. WAL taaler to processer (RUNE-ERFARINGER, F4).
  const d = new DatabaseSync(join(dataDir, 'doda.db'));
  d.exec(`UPDATE tokens SET expires_at = ${Math.floor(Date.now() / 1000) - 10} WHERE client_id = '${klient.client_id}'`);
  d.close();

  assert.equal((await mcp(t.access_token)).status, 401);
  // ... men refresh virker stadig: det er hele pointen med et kort access token.
  const ny = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: klient.client_id });
  assert.equal(ny.status, 200);
  assert.equal((await mcp(ny.krop.access_token)).status, 200);
});

/* ------------------------------------------------------ tilbagekaldelse */

test('scope: read giver et token, der kan laese, men ikke skrive', async () => {
  const { krop: klient } = await registrer('Kun laesning');
  const verifier = randomBytes(32).toString('base64url');
  const q = new URLSearchParams({
    client_id: klient.client_id, response_type: 'code', redirect_uri: REDIRECT,
    scope: 'read', code_challenge: udfordring(verifier), code_challenge_method: 'S256',
  });
  const vis = await fetch(`${BASE}/oauth/authorize?${q}`, { headers: { cookie } });
  const html = await vis.text();
  assert.match(html, /read your tasks/);

  const krop = new URLSearchParams(q);
  krop.set('bevis', html.match(/name="bevis" value="([a-f0-9]+)"/)[1]);
  krop.set('godkend', 'ja');
  const svar = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(krop), redirect: 'manual',
  });
  const t = (await token({
    grant_type: 'authorization_code', code: new URL(svar.headers.get('location')).searchParams.get('code'),
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;
  assert.equal(t.scope, 'read');

  const laes = await fetch(`${BASE}/api/v1/items?status=inbox`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  assert.equal(laes.status, 200);
  const skriv = await fetch(`${BASE}/api/v1/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'noget' }),
  });
  assert.equal(skriv.status, 403);
});

test('forbindelsen kan tilbagekaldes — og saa doer bade token og refresh', async () => {
  const { krop: klient } = await registrer('Til afvisning');
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(klient.client_id, verifier);
  const t = (await token({
    grant_type: 'authorization_code', code: kode,
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;
  assert.equal((await mcp(t.access_token)).status, 200);

  const liste = await api('/api/v1/connections');
  const min = liste.connections.find((c) => c.id === klient.client_id);
  assert.ok(min, 'forbindelsen skal staa paa listen');
  assert.equal(min.name, 'Til afvisning');
  assert.equal(min.active, 1);

  await api(`/api/v1/connections/${klient.client_id}`, {}, 'DELETE');

  // Oejeblikkeligt: ingen cache af noegler nogen steder.
  assert.equal((await mcp(t.access_token)).status, 401);
  assert.equal((await token({
    grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: klient.client_id,
  })).status, 400);

  const efter = (await api('/api/v1/connections')).connections.find((c) => c.id === klient.client_id);
  assert.equal(efter.active, 0);
  assert.equal(efter.refreshes, 0);
});

test('/oauth/revoke tager et refresh-token og svarer altid 200', async () => {
  const { krop: klient } = await registrer('Selvafmelding');
  const verifier = randomBytes(32).toString('base64url');
  const kode = await hentKode(klient.client_id, verifier);
  const t = (await token({
    grant_type: 'authorization_code', code: kode,
    client_id: klient.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  })).krop;

  const r = await fetch(`${BASE}/oauth/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: String(new URLSearchParams({ token: t.refresh_token })),
  });
  assert.equal(r.status, 200);
  assert.equal((await token({
    grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: klient.client_id,
  })).status, 400);

  // Et ukendt token er allerede tilbagekaldt - og svaret roeber ikke noget.
  assert.equal((await fetch(`${BASE}/oauth/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'token=dodar_findesikke',
  })).status, 200);
});

test('OAuth-tokens forurener ikke listen over mine egne adgangsnoegler', async () => {
  const d = await api('/api/v1/tokens');
  assert.ok(d.tokens.every((t) => !t.name.startsWith('Claude')),
    'de udstedte OAuth-tokens hoerer under Connected apps, ikke under Access keys');
});

test('ukendt grant_type og ukendt oauth-sti fejler paent', async () => {
  assert.equal((await token({ grant_type: 'password', username: 'test', password: 'testtest123' })).krop.error,
    'unsupported_grant_type');
  assert.equal((await fetch(`${BASE}/oauth/findes-ikke`)).status, 404);
});
