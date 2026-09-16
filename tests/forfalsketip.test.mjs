/*
 * Klient-IP'en mod den RIGTIGE server: en forfalsket vaerdi forrest i
 * X-Forwarded-For maa ikke give en ny spand.
 *
 * Serveren koerer lokalt, saa socket-adressen er loopback - praecis som bag
 * tunnelen. Hvert kald sender »<ny opdigtet>, 203.0.113.50«: den forreste
 * vaelger klienten, den bageste har proxyen sat. Med den gamle regel (foerste
 * vaerdi) fik hvert forsoeg sin egen spand, og login-spaerringen ramte aldrig.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const RIGTIG = '203.0.113.50';
let BASE = '';
let server;
let dataDir;
let udskrift = '';

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-forfalsket-'));
  // BIND_PORT=0: styresystemet vaelger en ledig port (RUNE-ERFARINGER, doda v7).
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: '0', DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // logSecurity skriver paa stderr.
  server.stderr.on('data', (b) => { udskrift += b; });
  await new Promise((ok, fejl) => {
    const t = setTimeout(() => fejl(new Error(`serveren startede ikke:\n${udskrift}`)), 10000);
    server.stdout.on('data', (b) => {
      const m = String(b).match(/doda lytter paa port (\d+)/);
      if (m) { clearTimeout(t); BASE = `http://127.0.0.1:${m[1]}`; ok(); }
    });
  });
  const r = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test', password: 'testtest123' }),
  });
  assert.equal(r.status, 200);
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('login spaerres, selv om hvert forsoeg sender en ny opdigtet IP', async () => {
  const koder = [];
  for (let i = 0; i < 16; i++) {
    const r = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i + 1}, ${RIGTIG}` },
      body: JSON.stringify({ username: 'test', password: 'forkert-kodeord' }),
    });
    koder.push(r.status);
    await r.arrayBuffer();
  }
  assert.deepEqual(koder.slice(0, 15), Array(15).fill(401));
  assert.equal(koder[15], 429);
});

test('[sikkerhed]-linjerne skriver den rigtige adresse - aldrig den opdigtede', () => {
  const linjer = udskrift.split('\n').filter((l) => l.includes('[sikkerhed]'));
  assert.ok(linjer.some((l) => l.includes('login-fejl')), 'ingen login-fejl-linje');
  assert.ok(linjer.some((l) => l.includes('login-spaerret')), 'ingen spaerre-linje');
  // Samme moenster som panelets events.
  const ips = new Set(linjer.map((l) => (l.match(/ip=(\S+)/) || [])[1]));
  assert.deepEqual([...ips], [RIGTIG]);
});
