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

test('kontekster på en gentagelse følger med til hver ny forekomst', async () => {
  // Serveren kunne modtage skabelonens kontekster hele tiden, men sendte dem
  // aldrig UD igen - saa ruden kunne hverken vise eller rette dem.
  const k = await J('/api/v1/contexts', { name: 'vaerksted' });
  const r = await J('/api/v1/capture', { text: 'smør kæden !every 2 days', createNew: true });
  const id = r.recurrence.id;

  const opdateret = await J(`/api/v1/recurrences/${id}`, { contexts: [k.context.id] });
  assert.deepEqual(opdateret.recurrence.contexts, [k.context.id],
    'kontekster skal komme retur, ellers kan UI\'et ikke vise dem');

  // Luk den aabne forekomst og se, at den NAESTE arver konteksten.
  await J(`/api/v1/items/${r.item.id}/complete`, {});
  const naeste = (await J('/api/v1/items?status=next')).items.find((x) => x.recurrence_id === id);
  assert.ok(naeste, 'der skal komme en ny forekomst');
  assert.deepEqual(naeste.contexts.map((c) => c.name), ['vaerksted']);
});

/*
 * »Fra fuldfoerelse« skal ogsaa flytte den DAG, reglen haenger paa.
 *
 * `every! month` har ingen dag i teksten, saa maanedsdagen udledes af ankeret
 * - datoen da reglen blev skrevet. Blev reglen lavet den 22., stod der
 * `monthday: 22` i den for altid, og selv om serveren regnede FRA i dag, gav
 * naesteForekomst den 22. i naeste maaned. Andreas fuldfoerte den 23. og fik
 * den 22. tilbage.
 */
test('fra fuldførelse: en månedlig regel flytter sig til den dag, jeg blev færdig', async () => {
  const r = await J('/api/v1/capture', { text: 'skift linser !every! month', createNew: true });

  // Sæt scenen: reglen blev skrevet en ANDEN dag i måneden end i dag.
  const iDag = new Date();
  const enAndenDag = iDag.getDate() === 1 ? 28 : iDag.getDate() - 1;
  medDb((db) => {
    const raekke = db.prepare('SELECT rule FROM recurrences WHERE id = ?').get(r.recurrence.id);
    const regel = JSON.parse(raekke.rule);
    regel.monthday = enAndenDag;
    db.prepare('UPDATE recurrences SET rule = ? WHERE id = ?')
      .run(JSON.stringify(regel), r.recurrence.id);
  });

  const svar = await J(`/api/v1/items/${r.item.id}/complete`, {});
  const dag = Number(svar.recurrence.next_due.slice(8, 10));
  assert.equal(dag, iDag.getDate(),
    `naeste skal falde paa den dag, jeg blev faerdig (${iDag.getDate()}), fik ${svar.recurrence.next_due}`);

  // Og reglen SELV skal vaere flyttet - ellers ville overskriften blive ved
  // med at sige "on the 22nd", mens forfaldet laa den 23.
  assert.equal(svar.recurrence.rule.monthday, iDag.getDate(),
    'reglen skal gemme den nye maanedsdag');
});

test('en fast plan flytter IKKE sin dag, selv om jeg blev færdig en anden dag', async () => {
  const r = await J('/api/v1/capture', { text: 'husleje !every month', createNew: true });
  const foer = r.recurrence.rule.monthday;
  medDb((db) => {
    const raekke = db.prepare('SELECT rule FROM recurrences WHERE id = ?').get(r.recurrence.id);
    const regel = JSON.parse(raekke.rule);
    regel.monthday = foer === 1 ? 28 : 1;
    db.prepare('UPDATE recurrences SET rule = ? WHERE id = ?')
      .run(JSON.stringify(regel), r.recurrence.id);
  });
  const svar = await J(`/api/v1/items/${r.item.id}/complete`, {});
  // Fast plan haenger paa sin egen dato - den maa ikke rykke sig, fordi nogen
  // blev faerdig paa et andet tidspunkt.
  assert.equal(svar.recurrence.rule.monthday, foer === 1 ? 28 : 1,
    'en fast plan gentolkes ikke');
});

/* ================== push om den ugentlige gennemgang ================== */

/*
 * Baandet i appen er stadig den primaere vej (§5.12), og pushen er slaaet FRA
 * som standard.
 *
 * `due-now` er det, service workeren spoerger om, naar en TOM push vaekker
 * den - saa det er dér, man kan se, hvad den ville vise.
 *
 * BEMAERK hvad der IKKE er daekket: selve gaten (`gennemgangSkalMindes`)
 * koeres kun af paamindelseskoeren, og den kraever et rigtigt
 * push-abonnement med en VAPID-noegle og en endpoint, der svarer. Det, der
 * proeves her, er standardvaerdien, opbevaringen og det svar, service
 * workeren faar - ikke afsendelsen selv.
 */

const saetIndstilling = (n, v) => medDb((db) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(n, String(v), String(v));
});

test('en frisk installation har gennemgangs-push slået FRA', async () => {
  // §5.12: saa faa notifikationer som muligt, standard ingen.
  const r = await J('/api/v1/review');
  assert.equal(r.push, false, 'ingen maa begynde at sende af sig selv');
  assert.equal(r.time, '10:00', 'men et klokkeslaet skal der staa noget i');
});

test('due-now varsler ikke noget af sig selv', async () => {
  const d = await J('/api/v1/due-now');
  assert.equal(d.review, false);
});

test('due-now fortæller service workeren, at det var gennemgangen', async () => {
  // Saadan ser det ud lige efter, koeren har sendt.
  saetIndstilling('review_notified', Math.floor(Date.now() / 1000));
  const d = await J('/api/v1/due-now');
  assert.equal(d.review, true, 'service workeren skal kunne se det');
});

test('et gammelt varsel vises ikke igen', async () => {
  // Ti minutter siden: vinduet er fem, saa den er forbi.
  saetIndstilling('review_notified', Math.floor(Date.now() / 1000) - 600);
  const d = await J('/api/v1/due-now');
  assert.equal(d.review, false,
    'ellers ville en push om en forfalden OPGAVE vise gennemgangen i stedet');
});

test('gennemgangens klokkeslæt og kontakt kan gemmes og læses tilbage', async () => {
  await J('/api/v1/settings', { settings: { review_weekday: '7', review_time: '19:00', review_push: '1' } });
  const r = await J('/api/v1/review');
  assert.equal(r.time, '19:00');
  assert.equal(r.push, true);
  assert.equal(r.weekday, 7);
});

/* ==================== stjerne og område på en opgave =================== */

/*
 * Stjernen er ÉT flag, ikke niveauer - og pointen er, at den LOEFTER opgaven
 * i Next Actions. Et maerkat, der ikke flytter noget, ville bare vaere pynt.
 */
test('en stjernet opgave ligger øverst i Next Actions', async () => {
  const a = await J('/api/v1/capture', { text: 'foerst oprettet', createNew: true });
  const b = await J('/api/v1/capture', { text: 'sidst oprettet', createNew: true });
  for (const x of [a, b]) await J(`/api/v1/items/${x.item.id}`, { status: 'next' });

  const foer = (await J('/api/v1/items?status=next')).items.map((i) => i.title);
  assert.ok(foer.indexOf('foerst oprettet') < foer.indexOf('sidst oprettet'),
    'uden stjerne staar de i oprettelsesraekkefoelge');

  await J(`/api/v1/items/${b.item.id}`, { starred: true });
  const efter = (await J('/api/v1/items?status=next')).items.map((i) => i.title);
  assert.equal(efter[0], 'sidst oprettet', 'den stjernede skal loeftes til toppen');
});

test('stjernen kan tages af igen', async () => {
  const r = await J('/api/v1/capture', { text: 'en opgave med stjerne', createNew: true });
  await J(`/api/v1/items/${r.item.id}`, { starred: true });
  assert.equal((await J(`/api/v1/items/${r.item.id}`)).item.starred, 1);
  await J(`/api/v1/items/${r.item.id}`, { starred: false });
  assert.equal((await J(`/api/v1/items/${r.item.id}`)).item.starred, 0);
});

/* Kolonnen har vaeret i skemaet siden F1, men der var ingen vej til at saette
   den - hverken i brugerfladen eller i API'et. */
test('en opgave kan få et område - og få det taget af igen', async () => {
  const omr = await J('/api/v1/areas', { name: 'Privat' });
  const id = (omr.area || omr.areas?.at(-1) || {}).id;
  assert.ok(id, `kunne ikke oprette omraade: ${JSON.stringify(omr)}`);

  const r = await J('/api/v1/capture', { text: 'en opgave med omraade', createNew: true });
  await J(`/api/v1/items/${r.item.id}`, { area_id: id });
  assert.equal((await J(`/api/v1/items/${r.item.id}`)).item.area_id, id);

  await J(`/api/v1/items/${r.item.id}`, { area_id: null });
  assert.equal((await J(`/api/v1/items/${r.item.id}`)).item.area_id, null,
    'null er et gyldigt valg: »intet omraade«');
});

test('": Område" ved fangst sætter opgavens område - og opretter det, hvis det er nyt', async () => {
  const r = await J('/api/v1/capture', { text: 'skift olie : Bilen', createNew: true });
  assert.equal(r.item.title, 'skift olie', 'markoeren skal ud af titlen');
  assert.ok(r.item.area_id, 'omraadet skal vaere sat');
  const omr = (await J('/api/v1/areas')).areas.find((a) => a.id === r.item.area_id);
  assert.equal(omr.name, 'Bilen', 'og oprettet med det navn, der blev skrevet');

  // Anden gang genbruges det samme omraade - ikke et nyt med samme navn.
  const r2 = await J('/api/v1/capture', { text: 'vask den : bilen', createNew: true });
  assert.equal(r2.item.area_id, r.item.area_id, 'store og smaa bogstaver er samme omraade');
});

test('et kolon uden mellemrum omkring rører ikke opgaven', async () => {
  const r = await J('/api/v1/capture', { text: 'Møde: husk kaffe', createNew: true });
  assert.equal(r.item.title, 'Møde: husk kaffe');
  assert.equal(r.item.area_id, null);
});

test('webappen bliver spurgt, før et nyt område oprettes', async () => {
  // createNew udelades: det er webappens vej, og den skal bekraefte selv.
  const r = await J('/api/v1/capture', { text: 'noget : HeltNytOmraade' });
  assert.ok(r.needsConfirm, 'der skal spoerges');
  assert.equal(r.needsConfirm.area, 'HeltNytOmraade');
  // Og intet er oprettet endnu.
  const omr = (await J('/api/v1/areas')).areas.find((a) => a.name === 'HeltNytOmraade');
  assert.equal(omr, undefined, 'omraadet maa ikke findes, foer man har sagt ja');
});

test('en gentagelse kan have en BESKRIVELSE - og hver forekomst faar den med', async () => {
  /*
   * »Der mangler add details til en recurring task« (Andreas, 25-08-2026).
   *
   * Skabelonen har altid haft en `note`, og `opretForekomst` har altid givet
   * den videre. Den blev bare aldrig sendt UD igen, saa ruden kunne hverken
   * vise eller rette den - praecis samme fejl, som kontekster havde haft samme
   * sted. Et felt, der kan SAETTES uden at kunne LAESES, er usynligt for den,
   * der bruger det.
   */
  const r = await J('/api/v1/capture', { text: 'vand blomsterne !every! 3 days', createNew: true });
  const id = r.item.recurrence_id;

  await J(`/api/v1/recurrences/${id}`, { note: 'Husk den bag sofaen\nog den paa badet' });

  // 1. Den skal kunne LAESES tilbage - ellers kan ruden ikke vise den.
  const rec = (await J('/api/v1/recurrences')).recurrences.find((x) => x.id === id);
  assert.equal(rec.note, 'Husk den bag sofaen\nog den paa badet', 'noten skal med UD igen');

  // 2. Og den skal foelge med til den naeste forekomst.
  const aaben = (await J('/api/v1/items?status=next')).items.find((x) => x.recurrence_id === id);
  await J(`/api/v1/items/${aaben.id}/complete`, {});
  const naeste = (await J('/api/v1/items?status=next')).items.find((x) => x.recurrence_id === id);
  assert.ok(naeste, 'der kommer en ny');
  assert.equal(naeste.note, 'Husk den bag sofaen\nog den paa badet', 'beskrivelsen foelger med');

  // 3. En tom beskrivelse skal kunne RYDDES igen - `if (body.note)` ville
  //    have gjort det umuligt at fjerne en, man havde skrevet.
  await J(`/api/v1/recurrences/${id}`, { note: '' });
  const ryddet = (await J('/api/v1/recurrences')).recurrences.find((x) => x.id === id);
  assert.equal(ryddet.note, '', 'den skal kunne fjernes igen');
});

test('hvert tal i navigationen passer med den LISTE, det staar ved siden af', async () => {
  /*
   * »Den maa gerne vise hvor mange opgaver der er under hvert punkt«
   * (Andreas, 25-08-2026).
   *
   * Den gamle optaelling var `GROUP BY status` med ét faelles defer-filter -
   * naesten rigtigt, og derfor svaert at opdage:
   *
   *  - Inbox VISER ogsaa `queued` (en opgave kan have faaet den), men taelleren
   *    taalte kun `inbox`.
   *  - Waiting og Someday henter UDEN hideDeferred, men taelleren skjulte det
   *    udskudte.
   *
   * En taeller, der ikke passer med det, man ser, naar man klikker, er vaerre
   * end ingen taeller. Derfor proeves TALLET mod LISTEN - ikke mod et tal, jeg
   * selv har regnet ud.
   */
  const iMorgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // En udskudt opgave i hver af de lister, der viser udskudte.
  const a = (await J('/api/v1/capture', { text: 'venter paa svar', createNew: true })).item;
  await J(`/api/v1/items/${a.id}`, { status: 'waiting', defer_date: iMorgen });
  const b = (await J('/api/v1/capture', { text: 'maaske engang', createNew: true })).item;
  await J(`/api/v1/items/${b.id}`, { status: 'someday', defer_date: iMorgen });
  // En opgave i `queued` - Inbox viser den, saa den skal taelles med.
  const c = (await J('/api/v1/capture', { text: 'uafklaret', createNew: true })).item;
  await J(`/api/v1/items/${c.id}`, { status: 'queued' });
  // Og en udskudt `next` - den vises IKKE, saa den maa ikke taelles.
  const d = (await J('/api/v1/capture', { text: 'senere', createNew: true })).item;
  await J(`/api/v1/items/${d.id}`, { status: 'next', defer_date: iMorgen });

  const tal = (await J('/api/v1/state')).counts;

  // Praecis de kald, listerne selv laver (p3_lists.js / p8_review.js).
  const liste = async (q) => (await J(`/api/v1/items?${q}`)).items.length;
  assert.equal(tal.inbox, await liste('status=inbox,queued&kind=task'), 'Inbox');
  assert.equal(tal.next, await liste('status=next&hideDeferred=1'), 'Next Actions');
  assert.equal(tal.waiting, await liste('status=waiting'), 'Waiting For');
  assert.equal(tal.someday, await liste('status=someday'), 'Someday');

  // Og de to, der ville have vaeret forkerte foer:
  assert.ok(tal.waiting >= 1, 'en udskudt Waiting skal TAELLES med - listen viser den');
  assert.ok(tal.someday >= 1, 'og en udskudt Someday');
});

test('Recurring taeller de gentagelser, der faktisk laver opgaver', async () => {
  // Gentagelser har ingen status og kan ikke taelles med de andre. En pauset
  // laver ingen opgaver lige nu og hoerer derfor ikke med i tallet.
  const foer = (await J('/api/v1/state')).counts.repeat;
  const r = await J('/api/v1/capture', { text: 'luft hunden !every day', createNew: true });
  const id = r.item.recurrence_id;
  assert.equal((await J('/api/v1/state')).counts.repeat, foer + 1);

  await J(`/api/v1/recurrences/${id}`, { paused: true });
  assert.equal((await J('/api/v1/state')).counts.repeat, foer, 'en pauset taeller ikke med');
});

test('»start Logbook forfra« SKJULER - og sletter ingenting', async () => {
  /*
   * »En indstilling hvor man kan resette logbook og taelleren af afsluttet
   * opgaver« (Andreas, 25-08-2026). Han valgte begge dele som to knapper:
   * den her kan fortrydes, DELETE herunder kan ikke.
   */
  const a = (await J('/api/v1/capture', { text: 'noget gammelt', createNew: true })).item;
  await J(`/api/v1/items/${a.id}/complete`, {});
  assert.ok((await J('/api/v1/logbook')).items.length >= 1);

  const svar = await J('/api/v1/logbook/reset', {});
  assert.ok(svar.hidden >= 1, 'den siger hvor mange der blev skjult');

  // Listen OG taelleren skal begge starte forfra - ellers siger toplinjen
  // noget andet end siden.
  assert.equal((await J('/api/v1/logbook')).items.length, 0, 'Logbook er tom');
  assert.equal((await J('/api/v1/state')).counts.done, 0, 'og taelleren med');

  // Men opgaven findes stadig - den skal med i en eksport.
  const eksport = await J('/api/v1/export');
  assert.ok(eksport.items.some((i) => i.id === a.id), 'intet er slettet');

  /*
   * Og noget afsluttet EFTER graensen kommer med igen.
   *
   * `completed_at` staar i hele sekunder, og testen naar det hele inden for
   * ét - saa uret kan ikke skelne »lige efter« fra »lige foer«. Derfor
   * flyttes den nye opgaves tidsstempel et minut frem i stedet for at vente:
   * det er GRAENSEN, der proeves, ikke uret.
   */
  const b = (await J('/api/v1/capture', { text: 'noget nyt', createNew: true })).item;
  await J(`/api/v1/items/${b.id}/complete`, {});
  medDb((db) => db.prepare('UPDATE items SET completed_at = ? WHERE id = ?')
    .run(svar.reset + 60, b.id));
  const efter = (await J('/api/v1/logbook')).items;
  assert.equal(efter.length, 1, 'kun det nye');
  assert.equal(efter[0].id, b.id);

  // Fortrydes: alt kommer tilbage.
  await J('/api/v1/logbook/reset', { clear: true });
  const ider = (await J('/api/v1/logbook')).items.map((i) => i.id);
  assert.ok(ider.includes(a.id) && ider.includes(b.id), 'begge er der igen');
});

test('»slet afsluttede« roerer ALDRIG det aabne arbejde', async () => {
  /*
   * Den farligste knap i appen. Den maa kun tage `done` og `dropped` - uanset
   * hvad kalderen sender - og resten af listerne skal staa uroert bagefter.
   */
  const aaben = (await J('/api/v1/capture', { text: 'stadig i gang', createNew: true })).item;
  await J(`/api/v1/items/${aaben.id}`, { status: 'next' });
  const venter = (await J('/api/v1/capture', { text: 'venter paa Per', createNew: true })).item;
  await J(`/api/v1/items/${venter.id}`, { status: 'waiting' });
  const faerdig = (await J('/api/v1/capture', { text: 'overstaaet', createNew: true })).item;
  await J(`/api/v1/items/${faerdig.id}/complete`, {});

  const r = await fetch(`${BASE}/api/v1/logbook`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie }, body: '{}',
  });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).deleted >= 1);

  assert.equal((await J('/api/v1/logbook')).items.length, 0, 'Logbook er tom');
  // Det aabne arbejde skal vaere praecis, som det var.
  const aabne = (await J('/api/v1/items?status=next')).items.map((i) => i.id);
  assert.ok(aabne.includes(aaben.id), 'en aaben opgave er uroert');
  const ventende = (await J('/api/v1/items?status=waiting')).items.map((i) => i.id);
  assert.ok(ventende.includes(venter.id), 'og en, der venter');

  // Slettede raekker skal MELDES som slettet, saa andre enheder foelger med.
  const aendringer = await J('/api/v1/changes?since=0');
  assert.ok(aendringer.deleted.includes(faerdig.id), 'synkroniseringen faar besked');
});

test('?format=text giver en liste, en skaerm uden JSON-parser kan vise', async () => {
  /*
   * »Kan det laves saa det ogsaa virker med Raycast uden MCP« (Andreas,
   * 25-08-2026). Raycasts script-kommandoer er ren `curl` - der er hverken jq
   * eller python at regne med paa en frisk Mac.
   *
   * /next havde vejen i forvejen (den blev lavet til iOS-genveje). Nu har
   * /search, /items og /capture den ogsaa, og formateringen bor ét sted, saa
   * de fire ikke kan komme til at se forskellige ud.
   */
  const tekst = async (sti) => {
    const r = await fetch(`${BASE}${sti}`, { headers: { cookie } });
    return { status: r.status, ct: r.headers.get('content-type'), krop: await r.text() };
  };

  const r = await J('/api/v1/capture', { text: 'køb "grøn" kaffe & filtre #Indkøb', createNew: true });
  await J(`/api/v1/items/${r.item.id}`, { status: 'next' });

  const naeste = await tekst('/api/v1/next?format=text');
  assert.match(naeste.ct, /^text\/plain/, 'ren tekst, ikke JSON');
  assert.match(naeste.krop, /^• /m, 'punkttegn foran hver linje');
  // Anfoerselstegn og & skal staa, som brugeren skrev dem - ikke escapet til
  // HTML eller JSON undervejs.
  assert.match(naeste.krop, /køb "grøn" kaffe & filtre/, 'teksten er uroert');
  assert.match(naeste.krop, /#Indkøb/);

  // Samme formatering fra /search og /items - ellers ser de forskellige ud.
  const fundet = await tekst(`/api/v1/search?format=text&q=${encodeURIComponent('grøn')}`);
  assert.match(fundet.krop, /^• køb "grøn" kaffe & filtre/m);
  // `m`-flag: listen har flere raekker fra de andre tests, og linjen skal bare
  // VAERE der - ikke staa foerst.
  const liste = await tekst('/api/v1/items?format=text&status=next&kind=task');
  assert.match(liste.krop, /^• køb "grøn" kaffe & filtre/m);

  // Tomme svar skal vaere en saetning, ikke en tom side.
  assert.equal((await tekst('/api/v1/search?format=text&q=findesikkenoget')).krop, 'Nothing found.');
});

test('capture i ren tekst siger, hvad der blev FORSTAAET', async () => {
  /*
   * Ikke bare »Added«. Skrev man `!i morgen 14:00`, vil man se, at datoen blev
   * laest - ellers opdages en tastefejl foerst naeste gang, man aabner appen.
   */
  /*
   * Med en NOeGLE, ikke en cookie - det er dét, Raycast goer.
   *
   * Foerste udgave brugte cookien og fik 415: uden en noegle kraever serveren
   * en rigtig JSON-krop, mens et kald med `Bearer` er tilgivende, netop fordi
   * en klient med ét tekstfelt ikke kan bygge JSON (handover §5.10). Testen
   * skal proeve den vej, klienten faktisk gaar.
   */
  const noegle = (await J('/api/v1/tokens', { name: 'raycast-test', scope: 'capture' })).key;
  const r = await fetch(`${BASE}/api/v1/capture?format=text&text=${
    encodeURIComponent('ring til tandlægen #Opkald !i morgen 14:00')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${noegle}` },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/plain/);
  const krop = await r.text();
  assert.match(krop, /^Added: ring til tandlægen$/m);
  assert.match(krop, /^Due: \d{4}-\d{2}-\d{2} 14:00$/m, 'datoen OG klokkeslættet');
  assert.match(krop, /^Contexts: #Opkald$/m);
});
