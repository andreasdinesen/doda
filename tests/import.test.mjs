/*
 * Gendannelsen - den dag, en backup skal bruges til noget.
 *
 * Eksporten er `SELECT *` og har alt med. Importen er `INSERT OR REPLACE`
 * med en EKSPLICIT kolonneliste, og den erstatter hele raekken. En kolonne,
 * der ikke staar paa listen, bliver derfor **NULL ved en gendannelse** -
 * uden at noget fejler, uden en linje i loggen, og uden at det kan ses paa
 * antallet af importerede raekker.
 *
 * Det stod forkert i lang tid: `link_url`/`link_title` manglede paa baade
 * opgaver og projekter, saa en gendannelse slettede hvert eneste Sagu- og
 * Notion-link. Og `items.notified_at` manglede - det ENESTE vaern mod at
 * sende dagens paamindelser en gang til.
 *
 * To proever, og de svarer paa hver sit:
 *
 *  1. **Rundturen.** En rigtig eksport fra én base, importeret i en TOM
 *     base i en anden proces. Det er den eneste form, der beviser noget om
 *     en gendannelse - at importere oven i sig selv ville lade en raekke,
 *     der allerede var rigtig, se rigtig ud bagefter.
 *  2. **Vagten.** Hvidlisten holdt op mod det VIRKELIGE skema, laest med
 *     `pragma_table_info`. Den fanger den naeste kolonne, nogen tilfoejer -
 *     proeve 1 kan kun fange dem, den selv kender navnet paa.
 *
 *   node --test tests/import.test.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Kolonner, der med VILJE ikke gendannes.
 *
 * Tom i dag. Listen findes, fordi vagten ellers kun har ét svar at give
 * ("tilfoej den"), og der kan komme en kolonne, hvor det rigtige er at lade
 * vaere. Formen er `'tabel.kolonne': 'grunden'` - og grunden er obligatorisk,
 * for en udeladelse uden en er ikke til at skelne fra en forglemmelse.
 */
const MED_VILJE_UDE = {};

/** En doda-server med sin egen, tomme datamappe. */
async function startDoda(port) {
  const dataDir = mkdtempSync(join(tmpdir(), 'doda-import-'));
  const p = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(port), DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ud = '';
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error(`serveren startede ikke:\n${ud}`)), 10000);
    p.stdout.on('data', (b) => { ud += b; if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    p.stderr.on('data', (b) => { ud += b; });
  });
  let cookie = '';
  const J = async (sti, krop, metode) => {
    const r = await fetch(`http://127.0.0.1:${port}${sti}`, {
      method: metode || (krop === undefined ? 'GET' : 'POST'),
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
      body: krop === undefined ? undefined : JSON.stringify(krop),
    });
    const s = r.headers.get('set-cookie');
    if (s) cookie = s.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  await J('/api/register', { username: 'test', password: 'testtest123' });
  return {
    J,
    dataDir,
    async luk() {
      const doed = new Promise((r) => p.on('exit', r));
      p.kill('SIGTERM');
      await doed;
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

let kilde;
let maal;

before(async () => {
  // To servere, to tomme baser. Portene ligger uden for de oevrige proevers.
  kilde = await startDoda(8951);
  maal = await startDoda(8952);
});

after(async () => {
  if (kilde) await kilde.luk();
  if (maal) await maal.luk();
});

/* ====================================================== 1 · rundturen === */

test('en gendannelse beholder links paa baade opgaver og projekter', async () => {
  const { J } = kilde;

  /* Et projekt med et link - som en Sagu-note, der er knyttet til det. */
  const projekt = (await J('/api/v1/projects', { name: 'Nordvind-sagen' })).data.project;
  await J(`/api/v1/projects/${projekt.id}`, {
    name: 'Nordvind-sagen',
    link_url: 'https://sagu.eksempel.dk/#note-0123456789abcdef0123456789abcdef',
    link_title: 'Noter til sagen',
  });

  /* En opgave med et link - og en paamindelse, der ER sendt. */
  const opgave = (await J('/api/v1/items', {
    title: 'Ring til Nordvind', kind: 'task', status: 'next', project_id: projekt.id,
  })).data.item;
  await J(`/api/v1/items/${opgave.id}`, {
    link_url: 'https://notion.eksempel.dk/En-side-abc123',
    link_title: 'Aftalen',
  });

  const eksport = (await J('/api/v1/export')).data;

  // Eksporten skal baere felterne - ellers proever vi noget andet end det,
  // vi tror (den er `SELECT *`, saa det er en forudsaetning, ikke en pointe).
  const raaOpgave = eksport.items.find((x) => x.id === opgave.id);
  const raaProjekt = eksport.projects.find((x) => x.id === projekt.id);
  assert.equal(raaOpgave.link_url, 'https://notion.eksempel.dk/En-side-abc123');
  assert.equal(raaProjekt.link_title, 'Noter til sagen');

  /* Ind i en TOM base, i en anden proces. */
  const svar = await maal.J('/api/v1/import', eksport);
  assert.equal(svar.status, 200, JSON.stringify(svar.data));

  const gendanOpgave = (await maal.J(`/api/v1/items/${opgave.id}`)).data.item;
  assert.equal(gendanOpgave.link_url, 'https://notion.eksempel.dk/En-side-abc123',
    'linket paa opgaven gik tabt i gendannelsen');
  assert.equal(gendanOpgave.link_title, 'Aftalen');

  const gendanProjekt = (await maal.J('/api/v1/state')).data.projects.find((x) => x.id === projekt.id);
  assert.equal(gendanProjekt.link_url, 'https://sagu.eksempel.dk/#note-0123456789abcdef0123456789abcdef',
    'linket paa projektet gik tabt i gendannelsen');
  assert.equal(gendanProjekt.link_title, 'Noter til sagen');
});

test('en gendannelse sender ikke dagens paamindelser igen', async () => {
  /*
   * `notified_at` er det eneste, der staar mellem en forfalden opgave og en
   * ny push (`paamind()` henter netop dem, hvor den er NULL). Gik den tabt i
   * en gendannelse, ville en backup, lagt ind midt paa dagen, fyre dagens
   * paamindelser af en gang til.
   *
   * Stemplet saettes direkte i basen: der er ingen rute til det, og det er
   * der ikke grund til at lave én til - serveren saetter det selv, naar den
   * har sendt.
   */
  const { J } = kilde;
  const opgave = (await J('/api/v1/items', {
    title: 'Allerede mindet om', kind: 'task', status: 'next',
    due_date: '2026-09-18', due_time: '09:00',
  })).data.item;

  const db = new DatabaseSync(join(kilde.dataDir, 'doda.db'));
  db.prepare('UPDATE items SET notified_at = ? WHERE id = ?').run(1789000000, opgave.id);
  db.close();

  const eksport = (await J('/api/v1/export')).data;
  const raa = eksport.items.find((x) => x.id === opgave.id);
  assert.equal(raa.notified_at, 1789000000, 'eksporten skal baere stemplet');

  await maal.J('/api/v1/import', { items: [raa] });

  const maalDb = new DatabaseSync(join(maal.dataDir, 'doda.db'));
  const efter = maalDb.prepare('SELECT notified_at FROM items WHERE id = ?').get(opgave.id);
  maalDb.close();
  assert.equal(efter.notified_at, 1789000000,
    'stemplet gik tabt - en gendannelse ville minde om det samme igen');
});

/* ======================================================== 2 · vagten ==== */

test('hvidlisten daekker HVER kolonne i de tabeller, den importerer', () => {
  /*
   * Listen laeses UD AF KILDEN, ikke skrevet af. En afskrift ville kun
   * bevise, at afskriften er rigtig (samme regel som tovos
   * `opdatering.test.mjs`, der koerer panelets eget script).
   *
   * Skemaet laeses ud af en base, serveren SELV har migreret - ikke ved at
   * lede i `CREATE TABLE`-teksten. `ALTER TABLE ... ADD COLUMN` i en senere
   * migration staar ikke i den foerste erklaering, og det er praecis dér,
   * alle fire manglende kolonner kom fra.
   */
  const src = readFileSync(join(ROD, 'app', 'server.js'), 'utf8');
  const m = /const IMPORT_TABELLER = (\{[\s\S]*?\n\});/.exec(src);
  assert.ok(m, 'IMPORT_TABELLER kunne ikke findes i app/server.js');
  // eslint-disable-next-line no-eval
  const hvidliste = eval(`(${m[1]})`);

  const db = new DatabaseSync(join(kilde.dataDir, 'doda.db'));
  const mangler = [];
  const ukendte = [];
  for (const [tabel, kolonner] of Object.entries(hvidliste)) {
    const rigtige = db.prepare('SELECT name FROM pragma_table_info(?)').all(tabel).map((r) => r.name);
    assert.ok(rigtige.length, `tabellen ${tabel} findes ikke i skemaet`);
    for (const k of rigtige) {
      if (!kolonner.includes(k) && !MED_VILJE_UDE[`${tabel}.${k}`]) mangler.push(`${tabel}.${k}`);
    }
    // Den anden vej: en kolonne paa listen, tabellen ikke har, faar importen
    // til at kaste ved hver eneste raekke - og `importer()` sluger fejlen
    // pr. raekke, saa hele tabellen ville blive sprunget over i stilhed.
    for (const k of kolonner) if (!rigtige.includes(k)) ukendte.push(`${tabel}.${k}`);
  }
  db.close();

  assert.deepEqual(mangler, [],
    `disse kolonner bliver NULL ved en gendannelse - foej dem til IMPORT_TABELLER: ${mangler.join(', ')}`);
  assert.deepEqual(ukendte, [],
    `disse kolonner findes ikke i skemaet: ${ukendte.join(', ')}`);
});

test('eksporten og importen er enige om, hvilke tabeller der er med', () => {
  /*
   * De to lister staar hvert sit sted. Tilfoejer man en tabel til eksporten
   * uden at tilfoeje den til importen, ligger dataene i filen og bliver
   * aldrig laest ind igen - og backuppen ser komplet ud.
   */
  const src = readFileSync(join(ROD, 'app', 'server.js'), 'utf8');
  const eksportBlok = /function byggEksport\([\s\S]*?\n\}/.exec(src)[0];
  const eksporterede = [...eksportBlok.matchAll(/^\s{4}(\w+): raa\(/gm)].map((x) => x[1]);
  const m = /const IMPORT_TABELLER = (\{[\s\S]*?\n\});/.exec(src);
  // eslint-disable-next-line no-eval
  const importerede = Object.keys(eval(`(${m[1]})`));

  assert.deepEqual(eksporterede.filter((t) => !importerede.includes(t)), [],
    'en tabel eksporteres uden at kunne importeres igen');
});
