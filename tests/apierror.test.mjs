/* Fejlsvarenes FORM: hver eneste fejl fra /api/v1 skal have to lag - en kode
   til maskinen og en saetning til mennesket (RUNE-ERFARINGER, doda F2).
   Koer: node --test tests/apierror.test.mjs

   Baggrunden: fem ruter svarede stadig i den gamle form, {error: 'not found'}
   uden message. En iOS-genvej viser message direkte, og frontendens api()
   falder tilbage til error, nar den mangler - sa brugeren fik "not found" at
   se i stedet for en saetning. Fejlen er kosmetisk ét sted og systematisk i
   det oejeblik en klient forgrener pa koden: "not found" med mellemrum er
   ikke en kode, man kan skrive en if-saetning pa.

   Testen tjekker derfor bade de konkrete ruter OG den generelle form, sa en
   ny rute med et handskrevet fejlsvar ikke kan smutte igennem. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

let server;
let dataDir;
let BASE;
let cookie = '';

/** Sender et kald og giver bade status og krop tilbage. */
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
  dataDir = mkdtempSync(join(tmpdir(), 'doda-apierror-'));
  // BIND_PORT=0: styresystemet vaelger en ledig port, og vi laeser den ud af
  // serverens egen linje (RUNE-ERFARINGER, doda v7).
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

/* Hver raekke: hvad vi sender, og hvad maskinen skal kunne forgrene pa. */
const SAGER = [
  ['GET', '/api/v1/items/findes-ikke', undefined, 404, 'not_found'],
  ['POST', '/api/v1/items/findes-ikke', { title: 'x' }, 404, 'not_found'],
  // contexts-grenen har sit EGET opslag foer opdateringen - den var det femte sted.
  ['POST', '/api/v1/items/findes-ikke', { contexts: [] }, 404, 'not_found'],
  ['POST', '/api/v1/items/findes-ikke/complete', {}, 404, 'not_found'],
  ['POST', '/api/v1/items/findes-ikke/uncomplete', {}, 404, 'not_found'],
  ['DELETE', '/api/v1/items/findes-ikke', {}, 404, 'not_found'],
  ['POST', '/api/v1/items', {}, 400, 'no_text'],
  ['POST', '/api/v1/contexts', {}, 400, 'no_name'],
  ['POST', '/api/v1/projects', {}, 400, 'no_name'],
];

for (const [metode, sti, krop, status, kode] of SAGER) {
  test(`${metode} ${sti} svarer ${status} ${kode} med en laesbar besked`, async () => {
    const svar = await kald(metode, sti, krop);
    assert.equal(svar.status, status);
    assert.equal(svar.data.error, kode);
    assert.equal(typeof svar.data.message, 'string');
    assert.ok(svar.data.message.length > 0, 'beskeden ma ikke vaere tom');
  });
}

test('fejlkoder er maskinlaesbare - ingen mellemrum, ingen store bogstaver', async () => {
  for (const [metode, sti, krop] of SAGER) {
    const svar = await kald(metode, sti, krop);
    assert.match(svar.data.error, /^[a-z][a-z0-9_]*$/,
      `${metode} ${sti} svarede med koden ${JSON.stringify(svar.data.error)}`);
  }
});

test('beskeden er en saetning til et menneske, ikke koden om igen', async () => {
  for (const [metode, sti, krop] of SAGER) {
    const svar = await kald(metode, sti, krop);
    assert.notEqual(svar.data.message, svar.data.error,
      `${metode} ${sti} gentager bare koden i message`);
    assert.match(svar.data.message, /[.!?]$/,
      `${metode} ${sti}: "${svar.data.message}" slutter ikke som en saetning`);
  }
});
