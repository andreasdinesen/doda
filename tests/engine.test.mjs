/* Integrationstest: starter en RIGTIG server mod en midlertidig database og
   koerer gentagelses-motoren igennem over HTTP.
   Koer: node --test tests/engine.test.mjs

   Nogle ting kan ikke provokeres gennem API'et alene - man kan ikke bede
   serveren om at sette en forfaldsdato tilbage i tiden. Derfor abnes SQLite
   direkte ved siden af (WAL taler to laesere/skrivere) for at flytte uret. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8933;
const BASE = `http://127.0.0.1:${PORT}`;

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
  return r.json();
};

/** Aabner databasen ved siden af serveren og flytter uret. */
function medDb(fn) {
  const db = new DatabaseSync(join(dataDir, 'doda.db'));
  try { return fn(db); } finally { db.close(); }
}

const iso = (dageSiden) => {
  const d = new Date();
  d.setDate(d.getDate() - dageSiden);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-test-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir, TZ: 'Europe/Copenhagen' }),
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
  if (server) server.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------- */

test('fangst med gentagelse laver en gentagelse, ikke en løs opgave', async () => {
  const r = await J('/api/v1/capture', { text: 'water the plants !every! 3 days', createNew: true });
  assert.ok(r.recurrence, 'svaret skal baere gentagelsen');
  assert.equal(r.recurrence.mode, 'completion');
  assert.equal(r.item.recurrence_id, r.recurrence.id);
  // Regel 2: usynlig indtil sin dato - defer_date = due_date.
  assert.equal(r.item.defer_date, r.item.due_date);
  assert.match(r.message, /from completion/);
});

test('kun ÉN åben forekomst — også efter gentagne fuldførelser', async () => {
  const r = await J('/api/v1/capture', { text: 'take out the bins !every! 2 days', createNew: true });
  const id = r.recurrence.id;

  for (let i = 0; i < 5; i++) {
    const aabne = (await J('/api/v1/items?status=next')).items.filter((x) => x.recurrence_id === id);
    assert.equal(aabne.length, 1, `runde ${i}: der må aldrig ligge flere end én`);
    await J(`/api/v1/items/${aabne[0].id}/complete`, {});
  }
  const tilSidst = (await J('/api/v1/items?status=next')).items.filter((x) => x.recurrence_id === id);
  assert.equal(tilSidst.length, 1);
});

test('fra fuldførelse regner fra I DAG, ikke fra forfaldsdatoen', async () => {
  const r = await J('/api/v1/capture', { text: 'clean the filter !every! 10 days', createNew: true });
  // Snyd forekomsten til at have vaeret forfalden for 30 dage siden.
  medDb((db) => {
    db.prepare('UPDATE items SET due_date = ?, defer_date = ? WHERE recurrence_id = ?')
      .run(iso(30), iso(30), r.recurrence.id);
  });
  const svar = await J(`/api/v1/items/${r.item.id}/complete`, {});
  // Havde den regnet fra forfaldsdatoen, ville naeste ligge i FORTIDEN.
  assert.ok(svar.recurrence.next_due > iso(0),
    `naeste skal ligge i fremtiden, fik ${svar.recurrence.next_due}`);
  assert.equal(svar.recurrence.next_due, iso(-10), 'praecis 10 dage fra i dag');
});

test('fast plan regner fra forfaldsdatoen — ikke fra hvornår jeg blev færdig', async () => {
  const r = await J('/api/v1/capture', { text: 'weekly report !every monday', createNew: true });
  const forfald = r.recurrence.next_due;
  const svar = await J(`/api/v1/items/${r.item.id}/complete`, {});
  // Praecis syv dage efter den forrige forfaldsdato, uanset hvornaar jeg
  // trykkede faerdig.
  const forventet = new Date(`${forfald}T12:00:00`);
  forventet.setDate(forventet.getDate() + 7);
  assert.equal(svar.recurrence.next_due,
    `${forventet.getFullYear()}-${String(forventet.getMonth() + 1).padStart(2, '0')}-${String(forventet.getDate()).padStart(2, '0')}`);
});

test('overskredet fast plan rulles frem, og hvert spring TÆLLES', async () => {
  const r = await J('/api/v1/capture', { text: 'water the office plant !every 7 days', createNew: true });
  const id = r.recurrence.id;
  // Sat 28 dage tilbage = fire missede forekomster.
  medDb((db) => {
    db.prepare('UPDATE recurrences SET next_due = ? WHERE id = ?').run(iso(28), id);
    db.prepare('UPDATE items SET due_date = ?, defer_date = ? WHERE recurrence_id = ?').run(iso(28), iso(28), id);
  });
  await J('/api/v1/state');            // rulFrem() koeres her

  const rec = (await J('/api/v1/recurrences')).recurrences.find((x) => x.id === id);
  assert.ok(rec.next_due >= iso(0), `skal vaere rullet frem til i dag eller senere, fik ${rec.next_due}`);
  assert.equal(rec.skips, 4, 'fire missede gange skal vaere talt');
  // Regel 1 gaelder stadig.
  const aabne = (await J('/api/v1/items?status=next')).items.filter((x) => x.recurrence_id === id);
  assert.equal(aabne.length, 1);
});

test('fra fuldførelse rulles ALDRIG frem — den kan ikke hobe sig op', async () => {
  const r = await J('/api/v1/capture', { text: 'deep clean !every! 7 days', createNew: true });
  const id = r.recurrence.id;
  medDb((db) => {
    db.prepare('UPDATE recurrences SET next_due = ? WHERE id = ?').run(iso(60), id);
    db.prepare('UPDATE items SET due_date = ?, defer_date = ? WHERE recurrence_id = ?').run(iso(60), iso(60), id);
  });
  await J('/api/v1/state');

  const rec = (await J('/api/v1/recurrences')).recurrences.find((x) => x.id === id);
  assert.equal(rec.next_due, iso(60), 'den venter paa mig - den skal IKKE rulle');
  assert.equal(rec.skips, 0, 'og der er intet at springe over');
});

test('spring over registreres og rykker til næste', async () => {
  const r = await J('/api/v1/capture', { text: 'call grandma !every sunday', createNew: true });
  const foer = r.recurrence.next_due;
  const svar = await J(`/api/v1/recurrences/${r.recurrence.id}/skip`, {});
  assert.equal(svar.recurrence.skips, 1);
  assert.ok(svar.recurrence.next_due > foer);
  const aabne = (await J('/api/v1/items?status=next')).items.filter((x) => x.recurrence_id === r.recurrence.id);
  assert.equal(aabne.length, 1, 'der skal straks ligge en ny');
});

test('pause bevarer reglen og rydder listen; genoptag bringer den tilbage', async () => {
  const r = await J('/api/v1/capture', { text: 'water the balcony !every 2 days', createNew: true });
  const id = r.recurrence.id;

  await J(`/api/v1/recurrences/${id}`, { paused: true });
  let rec = (await J('/api/v1/recurrences')).recurrences.find((x) => x.id === id);
  assert.equal(rec.paused, true);
  assert.ok(rec.rule.freq, 'reglen skal vaere bevaret');
  let aabne = (await J('/api/v1/items?status=next')).items.filter((x) => x.recurrence_id === id);
  assert.equal(aabne.length, 0, 'den maa ikke ligge og lyse i naeste-listen');

  // En pauset gentagelse maa heller ikke rulle frem imens.
  medDb((db) => db.prepare('UPDATE recurrences SET next_due = ? WHERE id = ?').run(iso(20), id));
  await J('/api/v1/state');
  rec = (await J('/api/v1/recurrences')).recurrences.find((x) => x.id === id);
  assert.equal(rec.skips, 0, 'pause maa ikke samle spring op');

  await J(`/api/v1/recurrences/${id}`, { paused: false });
  aabne = (await J('/api/v1/items?status=next')).items.filter((x) => x.recurrence_id === id);
  assert.equal(aabne.length, 1, 'genoptag skal lave en ny forekomst');
});

test('“kun denne gang” rører ikke skabelonen — “alle fremtidige” gør', async () => {
  const r = await J('/api/v1/capture', { text: 'original title !every! 5 days', createNew: true });
  const id = r.recurrence.id;

  // Kun denne gang
  await J(`/api/v1/items/${r.item.id}`, { title: 'just this once' });
  await J(`/api/v1/items/${r.item.id}/complete`, {});
  let naeste = (await J('/api/v1/items?status=next')).items.find((x) => x.recurrence_id === id);
  assert.equal(naeste.title, 'original title', 'skabelonen skal vaere uroert');

  // Alle fremtidige
  await J(`/api/v1/items/${naeste.id}`, { title: 'from now on', applyToSeries: true });
  await J(`/api/v1/items/${naeste.id}/complete`, {});
  naeste = (await J('/api/v1/items?status=next')).items.find((x) => x.recurrence_id === id);
  assert.equal(naeste.title, 'from now on');
});

test('stop gentagelsen: den åbne bliver en helt almindelig opgave', async () => {
  const r = await J('/api/v1/capture', { text: 'temporary habit !every day', createNew: true });
  await J(`/api/v1/recurrences/${r.recurrence.id}`, {}, 'DELETE');
  const item = (await J(`/api/v1/items/${r.item.id}`)).item;
  assert.equal(item.recurrence_id, null);
  assert.equal(item.defer_date, null, 'den skal ikke laengere vaere skjult');
  assert.equal(item.status, 'next');
});

test('vrøvl som regel afvises med en læsbar besked', async () => {
  const r = await J('/api/v1/capture', { text: 'do something !every blurgh', createNew: true });
  assert.ok(r.error || r.message, 'skal svare noget');
  if (r.error) assert.match(r.message, /repeat rule/i);
});

/* ------------------------------------------------------------ sletning */

test('sletning svarer 200 — ikke 404 på noget, der lige BLEV slettet', async () => {
  // opdaterItem() laeser raekken frisk gennem hentItem(), som filtrerer
  // deleted = 0 fra. Ruten returnerede derfor altid null og svarede 404
  // "not found" paa en sletning, der lykkedes - hvorefter frontenden viste
  // fejlen og sprang genindlaesningen over, saa raekken blev staaende.
  // Fejlen var usynlig, indtil x-genvejen blev mulig at naa (v7).
  const r = await J('/api/v1/capture', { text: 'noget der skal slettes', createNew: true });
  const id = r.item.id;

  const svar = await fetch(`${BASE}/api/v1/items/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie },
  });
  assert.equal(svar.status, 200, 'en sletning der lykkes skal svare 200');
  assert.deepEqual(await svar.json(), { ok: true });

  // ... og den skal vaere vaek af listen bagefter.
  const inbox = await J('/api/v1/items?status=inbox');
  assert.ok(!inbox.items.some((x) => x.id === id), 'den slettede maa ikke staa i listen');

  // Anden gang ER den ikke fundet - og saa er 404 det rigtige svar.
  const igen = await fetch(`${BASE}/api/v1/items/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie },
  });
  assert.equal(igen.status, 404);
  assert.equal((await igen.json()).error, 'not_found');
});
