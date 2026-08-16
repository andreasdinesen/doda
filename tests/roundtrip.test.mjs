/* Acceptkriterie 6 i handoveren:
   »Jeg kan eksportere alt, slette databasen, importere igen og have det samme
   system tilbage.«

   Den test er hele pointen med at eje sine egne data, saa den koeres RIGTIGT:
   en server startes, fyldes, eksporteres, databasen SLETTES fysisk, serveren
   startes forfra, og importen kores i portioner som UI'et gor det.

   Koer: node --test tests/roundtrip.test.mjs */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8935;
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
  const s = r.headers.get('set-cookie');
  if (s) cookie = s.split(';')[0];
  return r.json();
};

async function start() {
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir, TZ: 'Europe/Copenhagen' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
}

async function stop() {
  if (!server) return;
  const doed = new Promise((r) => server.on('exit', r));
  server.kill('SIGTERM');
  await doed;
  server = null;
}

/** Et fingeraftryk af HELE systemet, som det ser ud udefra. */
async function fingeraftryk() {
  const st = await J('/api/v1/state');
  const items = (await J('/api/v1/items?status=inbox,next,queued,waiting,someday,done,dropped')).items;
  const rec = (await J('/api/v1/recurrences')).recurrences;
  return {
    contexts: st.contexts.map((c) => c.name).sort(),
    areas: st.areas.map((a) => a.name).sort(),
    projects: st.projects.map((p) => `${p.name}/${p.status}/${p.open_count}`).sort(),
    items: items.map((i) => [i.id, i.kind, i.status, i.title, i.note, i.due_date, i.due_time,
      i.defer_date, i.waiting_for, i.contexts.map((c) => c.name).sort().join('+'),
      i.attachment_count].join('|')).sort(),
    recurrences: rec.map((r) => `${r.title}|${r.description}|${r.next_due}|${r.skips}|${r.paused}`).sort(),
  };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-rt-'));
  await start();
  await J('/api/register', { username: 'test', password: 'testtest123' });
});

after(async () => {
  await stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('rundtur: eksportér alt, slet databasen, importér — samme system tilbage', async () => {
  /* --- 1. Fyld systemet med noget af hver slags ------------------- */
  const omraade = (await J('/api/v1/areas', { name: 'Work' })).area;
  for (const t of [
    'write the report #computer @Q3 !friday at 9 // draft in [OneNote](https://onenote.com/x)',
    'call the accountant #phone @Q3',
    '* account number 1234-5678 @Q3',
    'buy coffee #errands',
    'fix the shed #home @"Summer house"',
    'water the plants !every! 3 days',
    'pay rent !every month on the 1st',
  ]) await J('/api/v1/capture', { text: t, createNew: true });

  const st0 = await J('/api/v1/state');
  const q3 = st0.projects.find((p) => p.name === 'Q3');
  await J(`/api/v1/projects/${q3.id}`, { area_id: omraade.id, outcome: '## Done when\n\n- **approved**' });

  const inbox = (await J('/api/v1/items?status=inbox')).items;
  await J(`/api/v1/items/${inbox[0].id}`, { status: 'next' });
  await J(`/api/v1/items/${inbox[1].id}`, { status: 'waiting', waiting_for: 'Mette' });
  await J(`/api/v1/items/${inbox[2].id}`, { status: 'someday' });
  await J(`/api/v1/items/${inbox[3].id}/complete`, {});

  // En vedhaeftning, sa filerne ogsaa kommer med rundturen
  const medFil = (await J('/api/v1/items?status=next')).items[0];
  const bytes = Buffer.from('dette er en testfil med indhold', 'utf8');
  await fetch(`${BASE}/api/v1/items/${medFil.id}/files?name=notat.txt`, {
    method: 'POST',
    // X-Doda-Upload er CSRF-barrieren pa upload-ruten: en session SKAL sende
    // den, en API-noegle behoever ikke.
    headers: { 'Content-Type': 'text/plain', 'X-Doda-Upload': '1', cookie },
    body: bytes,
  });

  const foer = await fingeraftryk();
  assert.ok(foer.items.length >= 7, 'der skal vaere noget at eksportere');
  assert.ok(foer.recurrences.length === 2);

  /* --- 2. Eksportér ALT, inklusive filindhold ---------------------- */
  const eksport = await (await fetch(`${BASE}/api/v1/export?files=1`, { headers: { cookie } })).json();
  assert.equal(eksport.doda, 1);
  assert.ok(eksport.attachments.length === 1);
  assert.ok(eksport.attachments[0].data, 'filindholdet skal vaere med');
  // Hemmeligheder ma ikke ligge i en fil, man deler.
  assert.ok(!('ical_token' in eksport.settings), 'ical-tokenet ma ikke eksporteres');

  /* --- 3. Slet databasen HELT ------------------------------------- */
  await stop();
  for (const f of readdirSync(dataDir)) {
    if (f.startsWith('doda.db')) rmSync(join(dataDir, f), { force: true });
  }
  rmSync(join(dataDir, 'files'), { recursive: true, force: true });
  assert.ok(!existsSync(join(dataDir, 'doda.db')), 'databasen skal vaere vaek');

  /* --- 4. Start forfra og importér i portioner, som UI'et gor ------ */
  cookie = '';
  await start();
  const frisk = await J('/api/public-config');
  assert.equal(frisk.needsSetup, true, 'en tom database skal bede om opsaetning');
  await J('/api/register', { username: 'test', password: 'testtest123' });

  const send = async (d) => (await J('/api/v1/import', d)).imported;
  await send({
    areas: eksport.areas, contexts: eksport.contexts, projects: eksport.projects,
    recurrences: eksport.recurrences, settings: eksport.settings,
  });
  for (let i = 0; i < eksport.items.length; i += 100) {
    await send({ items: eksport.items.slice(i, i + 100) });
  }
  await send({ item_contexts: eksport.item_contexts });
  for (const a of eksport.attachments) await send({ attachments: [a] });

  /* --- 5. Er det samme system? ------------------------------------ */
  const efter = await fingeraftryk();
  assert.deepEqual(efter.contexts, foer.contexts, 'kontekster');
  assert.deepEqual(efter.areas, foer.areas, 'omraader');
  assert.deepEqual(efter.projects, foer.projects, 'projekter');
  assert.deepEqual(efter.recurrences, foer.recurrences, 'gentagelser');
  assert.deepEqual(efter.items, foer.items, 'elementerne, felt for felt');

  // Og filen skal kunne hentes igen med praecis samme indhold.
  const fuld = (await J(`/api/v1/items/${medFil.id}`)).item;
  assert.equal(fuld.attachments.length, 1);
  const hentet = await (await fetch(`${BASE}/api/v1/files/${fuld.attachments[0].id}`, { headers: { cookie } })).text();
  assert.equal(hentet, bytes.toString('utf8'), 'filens INDHOLD skal vaere det samme');
});

test('importen er idempotent — samme fil to gange giver ikke dubletter', async () => {
  const eksport = await (await fetch(`${BASE}/api/v1/export`, { headers: { cookie } })).json();
  const foer = await fingeraftryk();
  await J('/api/v1/import', eksport);
  await J('/api/v1/import', eksport);
  assert.deepEqual(await fingeraftryk(), foer);
});

test('kalenderfeedet: kun reelle deadlines, og adressen kan tilbagekaldes', async () => {
  const token = (await J('/api/v1/calendar', {})).token;
  assert.ok(token && token.length >= 16);

  const r = await fetch(`${BASE}/ical/${token}.ics`);   // UDEN cookie
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  const ics = await r.text();

  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /SUMMARY:write the report/);
  assert.match(ics, /DTSTART;TZID=Europe\/Copenhagen:\d{8}T090000/,
    'klokkeslet skal med tidszone, ikke konverteres til UTC');
  // Kun ting MED en dato - resten af opgavelisten ma ikke laekke ud.
  assert.ok(!/SUMMARY:buy coffee/.test(ics), 'opgaver uden deadline hoerer ikke i kalenderen');
  assert.ok(!/SUMMARY:account number/.test(ics), 'noter hoerer slet ikke i kalenderen');

  // Forkert token: 404, ikke et hint om at feedet findes
  assert.equal((await fetch(`${BASE}/ical/${'x'.repeat(token.length)}.ics`)).status, 404);

  // Tilbagekaldelse virker OEJEBLIKKELIGT
  await J('/api/v1/calendar', { action: 'revoke' });
  assert.equal((await fetch(`${BASE}/ical/${token}.ics`)).status, 404);
});

test('eksport og import virker også via API-nøgle, ikke kun fra UI', async () => {
  const noegle = (await J('/api/v1/tokens', { name: 'backup', scope: 'full' })).key;
  const r = await fetch(`${BASE}/api/v1/export`, {
    headers: { Authorization: `Bearer ${noegle}` },
    credentials: 'omit',
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="doda-/);
  const doc = await r.json();
  assert.equal(doc.doda, 1);

  const ind = await fetch(`${BASE}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noegle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contexts: doc.contexts }),
  });
  assert.equal(ind.status, 200);

  // En laesenoegle ma ikke kunne importere.
  const laes = (await J('/api/v1/tokens', { name: 'kun laes', scope: 'read' })).key;
  const afvist = await fetch(`${BASE}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${laes}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contexts: [] }),
  });
  assert.equal(afvist.status, 403);
});
