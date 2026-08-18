/* Skaermen, brugeren staar paa, maa UDFYLDE en fangst - aldrig bestemme.
   Koer: node --test tests/capturefrom.test.mjs

   `POST /api/v1/capture` tager et valgfrit `from: {status, project, context}`,
   som webappen saetter ud fra den aabne skaerm. Reglerne er:

     - teksten vinder ALTID (skriver man @NogetAndet, gaelder det)
     - kun "waiting" og "someday" kan en skaerm implicere - aldrig "next",
       og aldrig noget, der ikke er en status
     - en note er reference og maa ikke faa en status af en skaerm
     - ukendte id'er ignoreres, i stedet for at faa fangsten til at fejle:
       fangst maa aldrig kunne afvises paa noget, brugeren ikke skrev
     - en klient UDEN skaerm (iOS-genvej, Claude) sender ingenting og faar
       inbox, praecis som foer

   Sidste punkt er grunden til, at det staar i en test: reglen er usynlig i
   webappen, og en fremmed klient er den eneste, der kan bryde den. */

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

async function J(sti, krop, metode) {
  const r = await fetch(BASE + sti, {
    method: metode || (krop === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const saet = r.headers.get('set-cookie');
  if (saet) cookie = saet.split(';')[0];
  return r.json();
}

/** Fanger med en skaerm bagved og giver det oprettede element tilbage. */
const fang = async (text, from) => (await J('/api/v1/capture', { text, createNew: true, from })).item;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-from-'));
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
  await J('/api/register', { username: 'test', password: 'testtest123' });
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('uden en skaerm lander fangsten i inbox, som den altid har', async () => {
  const it = await fang('ring til tandlaegen');
  assert.equal(it.status, 'inbox');
  assert.equal(it.project_id, null);
});

test('Waiting For og Someday udfylder statussen', async () => {
  assert.equal((await fang('svar fra kommunen', { status: 'waiting' })).status, 'waiting');
  assert.equal((await fang('laere at sejle', { status: 'someday' })).status, 'someday');
});

test('en skaerm kan IKKE implicere next - eller noget, der ikke er en status', async () => {
  for (const forsoeg of ['next', 'done', 'queued', 'inbox', 'noget-vaas', '', 42, null]) {
    const it = await fang(`forsoeg ${String(forsoeg)}`, { status: forsoeg });
    assert.equal(it.status, 'inbox', `status ${JSON.stringify(forsoeg)} slap igennem`);
  }
});

test('en note faar aldrig en status af skaermen - den er reference', async () => {
  const it = await fang('* kontonummer 1234', { status: 'someday' });
  assert.equal(it.kind, 'note');
  assert.equal(it.status, 'queued');
});

test('projekt og kontekst udfyldes, naar teksten tier', async () => {
  const p = (await J('/api/v1/projects', { name: 'Sommerhus' })).project;
  const k = (await J('/api/v1/contexts', { name: 'hjem' })).context;
  const it = await fang('male vinduerne', { project: p.id, context: k.id });
  assert.equal(it.project_id, p.id);
  assert.deepEqual(it.contexts.map((c) => c.name), ['hjem']);
});

test('teksten vinder over skaermen', async () => {
  const andet = (await J('/api/v1/projects', { name: 'Baadhus' })).project;
  const gammel = (await J('/api/v1/projects', { name: 'Sommerhus' })).project;
  const k = (await J('/api/v1/contexts', { name: 'telefon' })).context;
  const kHjem = (await J('/api/v1/contexts', { name: 'hjem' })).context;

  const it = await fang('@Baadhus #telefon rydde op', { project: gammel.id, context: kHjem.id });
  assert.equal(it.project_id, andet.id, 'skaermen overskrev projektet, brugeren skrev');
  assert.deepEqual(it.contexts.map((c) => c.id), [k.id], 'skaermen overskrev konteksten, brugeren skrev');
});

test('ukendte id\'er ignoreres - en fangst maa aldrig fejle paa dem', async () => {
  const it = await fang('noget helt andet', { project: 'findes-ikke', context: 'findes-heller-ikke' });
  assert.equal(it.status, 'inbox');
  assert.equal(it.project_id, null);
  assert.deepEqual(it.contexts, []);
});

test('en gentagelse arver ogsaa skaermens projekt', async () => {
  const p = (await J('/api/v1/projects', { name: 'Have' })).project;
  const svar = await J('/api/v1/capture', { text: 'slaa graesset !every monday', createNew: true, from: { project: p.id } });
  assert.ok(svar.recurrence, 'der blev ikke lavet en gentagelse');
  assert.equal(svar.recurrence.template.project_id, p.id);
});
