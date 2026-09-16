/* Et filnavn, der ikke er ASCII, skal kunne HENTES igen.
   Koer: node --test tests/filnavn.test.mjs

   Baggrunden: en http-header kan kun baere latin-1. Node kaster
   ERR_INVALID_CHAR paa alt over U+00FF, og hele svaret bliver en 500. Filen
   kunne altsaa uploades med japansk, emoji - eller bare den tankestreg, macOS
   selv saetter ind i et kopieret navn - og var derefter UMULIG at hente.
   Uploaden kvitterede 200, navnet stod rigtigt i listen, og foerst klikket gav
   en tavs 500.

   Proeven ligger paa ENDEPUNKTET, ikke paa `disposition()` alene. En enhedstest
   kan ikke fange et forkert kaldested (RUNE-ERFARINGER §9d, Sagus QR-kode), og
   det var praecis limen, der fejlede her. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Tankestregen er den vigtigste af de tre: den er U+2013, den ser ud som en
   bindestreg, og macOS saetter den selv ind. De to andre viser, at det ikke
   kun er de tegn, der ligner noget dansk. */
const NAVN = 'Møde–referat 日本 ☕.txt';

let server;
let dataDir;
let BASE;
let cookie = '';

async function kald(metode, sti, krop) {
  const r = await fetch(BASE + sti, {
    method: metode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const saet = r.headers.get('set-cookie');
  if (saet) cookie = saet.split(';')[0];
  let data = {};
  try { data = await r.json(); } catch { /* tomt svar er i orden */ }
  return { status: r.status, data };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-filnavn-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: '0', DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stoej = '';
  await new Promise((ok, fejl) => {
    const t = setTimeout(() => fejl(new Error(`serveren startede ikke:\n${stoej}`)), 10000);
    server.stdout.on('data', (b) => {
      stoej += b;
      const m = String(b).match(/doda lytter paa port (\d+)/);
      if (m) { clearTimeout(t); BASE = `http://127.0.0.1:${m[1]}`; ok(); }
    });
    server.stderr.on('data', (b) => { stoej += b; });
  });
  await kald('POST', '/api/register', { username: 'test', password: 'testtest123' });
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('en fil med et navn uden for latin-1 kan baade laegges op og hentes ned', async () => {
  const opgave = await kald('POST', '/api/v1/capture', { text: 'Bilag' });
  assert.equal(opgave.status, 200);
  const itemId = opgave.data.item.id;

  const op = await fetch(`${BASE}/api/v1/items/${itemId}/files?name=${encodeURIComponent(NAVN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-Doda-Upload': '1', cookie },
    body: 'hej',
  });
  assert.equal(op.status, 200);
  const { attachment } = await op.json();
  assert.equal(attachment.name, NAVN, 'navnet skal gemmes, som brugeren skrev det');

  const ned = await fetch(`${BASE}/api/v1/files/${attachment.id}`, { headers: { cookie } });
  assert.equal(ned.status, 200, 'hentningen maa ikke vaere en 500 - det var den indtil videre');
  assert.equal(await ned.text(), 'hej');

  /* Begge halvdele skal med: `filename=` er den ASCII-erstatning, alt kan
     laese, og `filename*=` er det rigtige navn. Vinder kun den foerste, faar
     brugeren en laeselig fil - vinder ingen af dem, faar han en fejlside. */
  const cd = ned.headers.get('content-disposition') || '';
  assert.match(cd, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
  assert.ok(cd.includes(encodeURIComponent(NAVN).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)),
    `det rigtige navn mangler i filename*: ${cd}`);
});

test('et ASCII-navn ser stadig ud, som det altid har gjort', async () => {
  const opgave = await kald('POST', '/api/v1/capture', { text: 'Bilag 2' });
  const itemId = opgave.data.item.id;
  const op = await fetch(`${BASE}/api/v1/items/${itemId}/files?name=note.txt`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-Doda-Upload': '1', cookie },
    body: 'hej',
  });
  const { attachment } = await op.json();
  const ned = await fetch(`${BASE}/api/v1/files/${attachment.id}`, { headers: { cookie } });
  assert.equal(ned.status, 200);
  assert.match(ned.headers.get('content-disposition') || '', /filename="note\.txt"/);
});
