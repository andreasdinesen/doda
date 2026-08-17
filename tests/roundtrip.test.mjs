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
import { DatabaseSync } from 'node:sqlite';
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

test('kalenderfeedet giver en påmindelse på opgaver MED klokkeslæt', async () => {
  // Uden VALARM er et abonnement tavst: kalender-appen har ingenting at give
  // besked på. Det var derfor doda føltes som om den ikke kunne minde om noget.
  await J('/api/v1/capture', { text: 'ring til tandlægen !tomorrow at 9', createNew: true });
  await J('/api/v1/capture', { text: 'hele dagen !tomorrow', createNew: true });
  const token = (await J('/api/v1/calendar', {})).token;

  const ics = await (await fetch(`${BASE}/ical/${token}.ics`)).text();
  const tandlaege = ics.split('BEGIN:VEVENT').find((b) => b.includes('tandlægen'));
  const heldag = ics.split('BEGIN:VEVENT').find((b) => b.includes('hele dagen'));

  assert.match(tandlaege, /BEGIN:VALARM/);
  assert.match(tandlaege, /TRIGGER:-PT15M/, 'standard er et kvarter før');
  assert.match(tandlaege, /ACTION:DISPLAY/);
  // En heldagsopgave må ALDRIG få en alarm - den ville ringe ved midnat.
  assert.ok(!heldag.includes('VALARM'), 'heldagsopgaver skal være tavse');

  // Brugerens valg slår igennem.
  await J('/api/v1/settings', { settings: { ical_alarm: '60' } });
  const igen = await (await fetch(`${BASE}/ical/${token}.ics`)).text();
  assert.match(igen.split('BEGIN:VEVENT').find((b) => b.includes('tandlægen')), /TRIGGER:-PT60M/);

  await J('/api/v1/settings', { settings: { ical_alarm: '-1' } });
  const slukket = await (await fetch(`${BASE}/ical/${token}.ics`)).text();
  assert.ok(!slukket.includes('VALARM'), '-1 skal slå påmindelser helt fra');
});

test('push: nøglen er stabil, abonnementer tælles, og due-now viser kun det åbne', async () => {
  const d = await J('/api/v1/push');
  assert.match(d.publicKey, /^[A-Za-z0-9_-]{80,}$/, 'VAPID-nøglen er base64url');
  // Den SKAL være den samme hver gang: skifter den, dør alle abonnementer.
  assert.equal((await J('/api/v1/push')).publicKey, d.publicKey);
  assert.equal(d.devices, 0);

  // Kun https må tages imod.
  const daarlig = await fetch(`${BASE}/api/v1/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ endpoint: 'http://usikker.example/x' }),
  });
  assert.equal(daarlig.status, 400);

  const ep = 'https://push.example.com/abc123';
  assert.equal((await J('/api/v1/push', { endpoint: ep, lead: 15 })).devices, 1);
  // Samme enhed to gange er stadig én enhed.
  assert.equal((await J('/api/v1/push', { endpoint: ep })).devices, 1);
  assert.equal((await J('/api/v1/push')).lead, 15);

  // due-now: kun det, der er stemplet for nylig OG stadig er åbent.
  const r = await J('/api/v1/capture', { text: 'skal mindes om !today at 09:00', createNew: true });
  // notified_at saettes af tickeren; her flyttes det direkte, praecis som
  // uret flyttes i engine.test.mjs. WAL taaler to processer.
  const d2 = new DatabaseSync(join(dataDir, 'doda.db'));
  d2.prepare('UPDATE items SET notified_at = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), r.item.id);
  d2.close();
  let nu = await J('/api/v1/due-now');
  assert.ok(nu.items.some((x) => x.id === r.item.id), 'den stemplede skal med');

  await J(`/api/v1/items/${r.item.id}/complete`, {});
  nu = await J('/api/v1/due-now');
  assert.ok(!nu.items.some((x) => x.id === r.item.id),
    'lukkes opgaven inden pushen naar frem, skal der ikke vises noget');

  assert.equal((await J('/api/v1/push', {}, 'DELETE')).devices, 0);
});

test('hemmeligheder forlader ALDRIG serveren — heller ikke med en read-nøgle', async () => {
  // Ruten kræver kun scope "read". Uden filteret kunne en nøgle på en telefon
  // læse kalenderfeedets token, Notion-tokenet og VAPID's private nøgle.
  const d2 = new DatabaseSync(join(dataDir, 'doda.db'));
  for (const [k, v] of [['ical_token', 'HEMMELIG-ICAL'], ['notion_token', 'secret_HEMMELIG'],
    ['vapid_private', 'HEMMELIG-VAPID'], ['theme', 'dark']]) {
    d2.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  }
  d2.close();

  const s = (await J('/api/v1/settings')).settings;
  assert.equal(s.theme, 'dark', 'almindelige indstillinger skal stadig komme med');
  for (const n of ['ical_token', 'notion_token', 'vapid_private']) {
    assert.equal(s[n], undefined, `${n} må ikke sendes ud`);
  }

  // Samme liste skal gælde eksporten - en fil man måske deler videre.
  const eks = await J('/api/v1/export');
  for (const n of ['ical_token', 'notion_token', 'vapid_private']) {
    assert.equal(eks.settings[n], undefined, `${n} må ikke stå i en eksport`);
  }

  // Og Notion-ruten fortæller kun OM der er et token.
  const n = await J('/api/v1/notion');
  assert.equal(n.connected, true);
  assert.ok(!JSON.stringify(n).includes('HEMMELIG'), 'tokenet må ikke lækkes gennem status-ruten');
});

test('Notion-titler: højst ét opslag i døgnet, og kun på Notion-links', async () => {
  const r = await J('/api/v1/capture', { text: 'noget med et link', createNew: true });
  const id = r.item.id;
  const d2 = new DatabaseSync(join(dataDir, 'doda.db'));
  const stempel = () => d2.prepare('SELECT link_checked_at FROM items WHERE id = ?').get(id).link_checked_at;

  // Uden Notion-token sker der ingenting - og der stemples ikke.
  d2.prepare("DELETE FROM settings WHERE key = 'notion_token'").run();
  d2.prepare("UPDATE items SET link_url = 'https://www.notion.so/Side-0123456789abcdef0123456789abcdef' WHERE id = ?").run(id);
  assert.equal((await J('/api/v1/notion/refresh', { kind: 'item', id })).title, null);
  assert.equal(stempel(), null, 'uden token er der intet at tjekke');

  // Med token proeves der - og der stemples, OGSAA naar Notion siger nej.
  // Ellers ville en slettet side blive slaaet op ved hver eneste aabning.
  d2.prepare("INSERT INTO settings (key, value) VALUES ('notion_token','ugyldigt') ON CONFLICT(key) DO UPDATE SET value = 'ugyldigt'").run();
  assert.equal((await J('/api/v1/notion/refresh', { kind: 'item', id })).title, null);
  const foerste = stempel();
  assert.ok(foerste > 0, 'der skal stemples, saa der ikke proeves igen med det samme');

  // Andet kald inden for doegnet roerer ikke Notion - stemplet staar stille.
  await J('/api/v1/notion/refresh', { kind: 'item', id });
  assert.equal(stempel(), foerste, 'hoejst ét opslag i doegnet');

  // Et link, der IKKE er Notion, roeres aldrig.
  const r2 = await J('/api/v1/capture', { text: 'et almindeligt link', createNew: true });
  d2.prepare("UPDATE items SET link_url = 'https://dr.dk/nyheder' WHERE id = ?").run(r2.item.id);
  assert.equal((await J('/api/v1/notion/refresh', { kind: 'item', id: r2.item.id })).title, null);
  assert.equal(d2.prepare('SELECT link_checked_at FROM items WHERE id = ?').get(r2.item.id).link_checked_at, null);
  d2.close();
});
