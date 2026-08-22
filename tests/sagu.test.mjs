/*
 * F8 - broen til Sagu, set fra doda.
 *
 * Testene koerer mod en **Sagu-attrap**: en lille http-server, der svarer som
 * Sagu goer, og som kan bedes om at svare forkert. Det er den eneste maade at
 * proeve de fejlstier, en rigtig Sagu ikke vil levere paa kommando - og
 * fejlstierne er dem, der faktisk sker i en bro.
 *
 * Attrappen er dog IKKE Sagu; den er min forstaaelse af Sagu. Derfor er der
 * en test til sidst, som koerer mod den rigtige app, naar den ligger ved
 * siden af (`SAGU_ROD`). Det var praecis dén slags gennemloeb, der fandt, at
 * et link i enden af en linje blev aedt af en aaben markoer.
 *
 *   node --test tests/sagu.test.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8937;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let dataDir;
let cookie = '';
let attrap;

const J = async (sti, krop, metode) => {
  const r = await fetch(BASE + sti, {
    method: metode || (krop === undefined ? 'GET' : 'POST'),
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
    body: krop === undefined ? undefined : JSON.stringify(krop),
  });
  const s = r.headers.get('set-cookie');
  if (s) cookie = s.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};

/**
 * En Sagu-attrap.
 *
 * `kald` taeller, saa »ikke ét kald pr. optegning« kan MAALES, og
 * `tilstand` kan skiftes undervejs, saa den samme test kan se baade en
 * virkende og en gaaen-i-stykker Sagu.
 */
function saguAttrap() {
  const kald = [];
  let tilstand = 'ok';
  const noter = new Map();
  let n = 0;
  // Notesboegerne skal kunne aendre sig UNDERVEJS: hele pointen med at hente
  // forfra er, at der er kommet en til i Sagu, siden man forbandt.
  let boeger = [{ id: 'b1', name: 'Handbook' }];
  const skrevne = [];
  let kunSkriv = false;      // svarer som en ren capture-noegle
  let modereres = false;     // moderationskoeen er slaaet til
  const s = createServer(async (req, res) => {
    kald.push(`${req.method} ${req.url.split('?')[0]}`);
    const send = (kode, krop) => {
      res.writeHead(kode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(krop));
    };
    if (tilstand === 'nede') { req.destroy(); return; }
    if (String(req.headers.authorization || '') !== 'Bearer sagu_rigtig') {
      send(401, { error: 'bad_key', message: 'No key.' });
      return;
    }
    if (tilstand === 'smal') {
      // Praecis Sagus egen form - det er DEN, broen skal kunne genkende.
      send(403, { error: 'wrong_scope', message: 'This key is "capture" and cannot read.' });
      return;
    }
    if (req.url.startsWith('/api/v1/state')) {
      send(200, { counts: { notes: 7 }, notebooks: boeger });
      return;
    }
    if (req.url.startsWith('/api/v1/search')) {
      send(200, { results: [...noter.values()], fallback: false });
      return;
    }
    const m = /^\/api\/v1\/notes\/([a-f0-9]{32})(\/comments)?$/.exec(req.url.split('?')[0]);
    if (m && req.method === 'GET') {
      // Kun selve noten fejler; kommentarerne svarer som de plejer.
      if (tilstand === 'note-nede' && !m[2]) { send(500, { error: 'boom', message: 'Nope.' }); return; }
      const note = noter.get(m[1]);
      if (!note) { send(404, { error: 'not_found', message: 'No such note.' }); return; }
      if (m[2]) { send(200, { comments: [{ author: 'Kollega', body: 'Er det rigtigt?', createdAt: 1, guest: true }] }); return; }
      send(200, { note });
      return;
    }
    const km = /^\/api\/v1\/notes\/([a-f0-9]{32})\/comments$/.exec(req.url.split('?')[0]);
    if (km && req.method === 'POST') {
      let raa = '';
      for await (const bid of req) raa += bid;
      const krop = JSON.parse(raa || '{}');
      if (!noter.get(km[1])) { send(404, { error: 'not_found', message: 'No such note.' }); return; }
      skrevne.push({ id: km[1], body: krop.body });
      /* Sagu v8: `comments` udelades for en ren capture-noegle - ellers ville
         skrive-doeren vaere blevet en laese-kanal. Attrappen kan begge dele. */
      const svar = { id: 'k1', message: modereres ? 'Comment added — it is waiting to be approved.' : 'Comment added.' };
      if (!kunSkriv) svar.comments = [{ author: 'Andreas', body: krop.body, createdAt: 2, guest: false }];
      send(200, svar);
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/api/v1/notes')) {
      let raa = '';
      for await (const bid of req) raa += bid;
      const krop = JSON.parse(raa || '{}');
      n += 1;
      const id = String(n).padStart(32, '0');
      noter.set(id, { id, title: krop.title, body: krop.body, notebook: krop.notebookId || '', icon: '' });
      send(200, { note: noter.get(id) });
      return;
    }
    send(404, { error: 'unknown_endpoint', message: 'No such endpoint.' });
  });
  return {
    async start() {
      await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
      return `http://127.0.0.1:${s.address().port}`;
    },
    luk: () => s.close(),
    kald,
    ryd: () => { kald.length = 0; },
    saet: (t) => { tilstand = t; },
    saetBoeger: (b) => { boeger = b; },
    saetKunSkriv: (v) => { kunSkriv = v; },
    saetModereres: (v) => { modereres = v; },
    skrevne,
    noter,
  };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-sagu-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    server.stderr.on('data', (b) => process.stderr.write(b));
  });
  await J('/api/register', { username: 'test', password: 'testtest123' });
  attrap = saguAttrap();
  attrap.url = await attrap.start();
});

after(async () => {
  if (attrap) attrap.luk();
  if (server) {
    const doed = new Promise((r) => server.on('exit', r));
    server.kill('SIGTERM');
    await doed;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const forbind = (url, key) => J('/api/v1/sagu', { url, key });

/* ============================================== forbindelsen =========== */

test('en forkert noegle GEMMES ikke - forbindelsen rulles tilbage', async () => {
  const r = await forbind(attrap.url, 'sagu_forkert');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_key');
  assert.equal((await J('/api/v1/sagu')).data.connected, false,
    'intet maa vaere gemt efter et afvist forsoeg');
});

test('en adresse, der ikke svarer, siger DET - ikke »forkert noegle«', async () => {
  const r = await forbind('http://127.0.0.1:9', 'sagu_rigtig');
  assert.equal(r.status, 400);
  assert.match(r.data.message, /Could not reach Sagu/);
});

test('en for SMAL noegle siger hvad den mangler - ikke at den er forkert', async () => {
  // Blander man de to, skifter man en noegle ud, der er helt i orden.
  attrap.saet('smal');
  const r = await forbind(attrap.url, 'sagu_rigtig');
  attrap.saet('ok');
  assert.equal(r.status, 400);
  assert.match(r.data.message, /cannot read|too narrow/);
});

test('kun en rigtig adresse godtages', async () => {
  for (const d of ['ikke en adresse', 'javascript:alert(1)', `${attrap.url}/api`]) {
    const r = await forbind(d, 'sagu_rigtig');
    assert.equal(r.status, 400, d);
    assert.equal(r.data.error, 'bad_url');
  }
});

test('en rigtig noegle forbinder - og noeglen kan ALDRIG laeses tilbage', async () => {
  const r = await forbind(attrap.url, 'sagu_rigtig');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.notes, 7);
  assert.deepEqual(r.data.notebooks, [{ id: 'b1', name: 'Handbook' }]);

  const set = await J('/api/v1/sagu');
  assert.equal(set.data.connected, true);
  assert.equal(JSON.stringify(set.data).includes('sagu_rigtig'), false,
    'noeglen maa aldrig forlade serveren');

  // Heller ikke ad eksportens vej - de to lister skal vaere den SAMME
  // (RUNE-ERFARINGER, doda v16).
  const eksport = await J('/api/v1/export');
  assert.equal(JSON.stringify(eksport.data).includes('sagu_rigtig'), false,
    'og slet ikke i en eksportfil, brugeren maaske deler videre');
});

/* ============================================== noten ================== */

test('doda kan soege i Sagu - og traefferne siger hvor noten ligger', async () => {
  await J('/api/v1/sagu/note', { title: 'VPN access', notebookId: 'b1' });
  const r = await J('/api/v1/sagu/search?q=vpn');
  assert.equal(r.status, 200);
  const n = r.data.pages[0];
  assert.equal(n.title, 'VPN access');
  assert.match(n.url, /#note-[0-9a-f]{32}$/, 'adressen skal vaere den, Sagu selv aabner paa');
  assert.equal(n.kind, 'b1', 'traefferne skal sige hvor noten ligger');
});

test('en note oprettet fra doda lander i den RIGTIGE notesbog - med link tilbage', async () => {
  /*
   * Adressen peger paa den ENKELTE opgave, ikke paa doda som saadan.
   *
   * Frem til v45 sendte paletten bare `location.origin`, fordi noten blev
   * oprettet FOER opgaven og dens id derfor ikke fandtes endnu. Noten sagde
   * »From doda: [titel](https://doda.dk)«, som foerte til forsiden - halvdelen
   * af »linked both ways« var aldrig rigtig der.
   *
   * `?item=<id>` (DESIGN §v23) skal overleve turen: baade `?` og `=` er tegn,
   * et markdown-link kan braekke paa.
   */
  const r = await J('/api/v1/sagu/note', {
    title: 'Nyt afsnit om Mac',
    notebookId: 'b1',
    backUrl: 'https://doda.eksempel.dk/?item=abc123def456',
    backTitle: 'Nyt afsnit om Mac',
  });
  assert.equal(r.status, 200);
  const lavet = [...attrap.noter.values()].pop();
  assert.equal(lavet.notebook, 'b1', 'planens accept: i den rigtige notesbog');
  assert.match(lavet.body, /doda\.eksempel\.dk/, 'og med et link tilbage');
  assert.match(lavet.body, /\(https:\/\/doda\.eksempel\.dk\/\?item=abc123def456\)/,
    'hele adressen skal med - ellers peger noten paa forsiden');
  // Linket staar paa sin EGEN linje: et link i enden af en linje med aaben
  // syntaks bliver aedt (RUNE-ERFARINGER, Sagu F8).
  assert.ok(lavet.body.split('\n').some((l) => l.includes('doda.eksempel.dk')
    && !l.startsWith('# ')), 'linket maa ikke staa i overskriftslinjen');
});

test('en note fra PALETTEN lander i den valgte notesbog', async () => {
  /*
   * Paletten er ét tastetryk og kan ikke spoerge om noget.
   *
   * Uden et valg lander hurtige noter uden for enhver bog - og planens accept
   * siger »i den RIGTIGE notesbog«. Dialogen spoerger hver gang; paletten
   * bruger det, der er valgt i Settings.
   */
  assert.equal((await J('/api/v1/sagu/notebook', { notebookId: 'b1' })).status, 200);
  // Uden `notebookId` i kaldet - praecis som paletten sender.
  await J('/api/v1/sagu/note', { title: 'Fra paletten' });
  const lavet = [...attrap.noter.values()].pop();
  assert.equal(lavet.notebook, 'b1');

  // En bog, Sagu ikke har, afvises - ellers ville noterne lande i ingenting.
  assert.equal((await J('/api/v1/sagu/notebook', { notebookId: 'findes-ikke' })).status, 400);
  assert.equal((await J('/api/v1/sagu/notebook', { notebookId: '' })).status, 200, 'og den kan ryddes');
});

test('Sagu nede: en paen fejl - ikke en fejlet gemning', async () => {
  attrap.saet('nede');
  const r = await J('/api/v1/sagu/note', { title: 'mens Sagu er nede' });
  attrap.saet('ok');
  // 502, ikke 500: det er den ANDEN ende, der svigtede.
  assert.equal(r.status, 502);
  assert.match(r.data.message, /Could not reach Sagu/);
});

test('kommentarerne kan LAESES - og kun det', async () => {
  const id = [...attrap.noter.keys()][0];
  const url = `${attrap.url}/#note-${id}`;
  const r = await J(`/api/v1/sagu/comments?url=${encodeURIComponent(url)}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.comments[0].author, 'Kollega');
  assert.equal(r.data.comments[0].guest, true);

});

/* ========================= skriv en kommentar ========================== */

/* Indtil Sagu v8 kraevede kommentar-POST `write`, som kun en `full`-noegle
   har, saa doda var laese-kun. v8 saenkede det til `capture`: en kommentar
   AENDRER ikke noten. Andreas bad om det 21-08-2026. */

test('en kommentar kan skrives fra doda - og listen kommer tilbage', async () => {
  const id = [...attrap.noter.keys()][0];
  const url = `${attrap.url}/#note-${id}`;
  attrap.skrevne.length = 0;
  const r = await J('/api/v1/sagu/comment', { url, text: 'Husk linserne' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(attrap.skrevne.at(-1).body, 'Husk linserne');
  assert.equal(r.data.message, 'Comment added.');
  assert.equal(r.data.comments.at(-1).body, 'Husk linserne');
});

/* Er moderationskoeen slaaet til, er kommentaren IKKE synlig endnu. Kun Sagu
   ved det, saa dens egen linje skal frem ordret - ellers ser det ud, som om
   kommentaren forsvandt. */
test('Sagus egen besked sendes ordret videre', async () => {
  attrap.saetModereres(true);
  const id = [...attrap.noter.keys()][0];
  const r = await J('/api/v1/sagu/comment', { url: `${attrap.url}/#note-${id}`, text: 'hej' });
  attrap.saetModereres(false);
  assert.match(r.data.message, /waiting to be approved/);
});

/* Sagu udelader `comments` for en ren capture-noegle. Ruden maa ikke vise en
   tom liste og lade det ligne, at kommentaren forsvandt - doda henter selv. */
test('mangler listen i svaret, hentes den - i stedet for at vise ingenting', async () => {
  attrap.saetKunSkriv(true);
  const id = [...attrap.noter.keys()][0];
  const r = await J('/api/v1/sagu/comment', { url: `${attrap.url}/#note-${id}`, text: 'noget' });
  attrap.saetKunSkriv(false);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.comments) && r.data.comments.length > 0,
    'listen skal vaere hentet bagefter');
});

test('en tom kommentar sendes ikke', async () => {
  const id = [...attrap.noter.keys()][0];
  const r = await J('/api/v1/sagu/comment', { url: `${attrap.url}/#note-${id}`, text: '   ' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'no_text');
});

test('en kommentar fra en GAEST kan ikke blive til et tag i doda', async () => {
  /*
   * Kommentarerne paa en Sagu-note kan komme fra wikien - altsaa fra nogen
   * uden konto. Naar doda viser dem, er de fremmed indhold paa dodas eget
   * domaene, og de gaar gennem den SAMME renderer som Notion-sider: escape
   * foerst, match bagefter. Serveren maa derfor heller ikke selv udstede et
   * tag i JSON'en.
   */
  const id = [...attrap.noter.keys()][0];
  const r = await J(`/api/v1/sagu/comments?url=${encodeURIComponent(`${attrap.url}/#note-${id}`)}`);
  const raa = JSON.stringify(r.data);
  assert.ok(!/<script|<img|onerror=/i.test(raa), 'serveren maa ikke sende opmaerkning videre');
  // Og laengden er bundet: en fremmed tjeneste maa ikke kunne fylde skaermen.
  assert.ok(r.data.comments.every((c) => c.body.length <= 2000));
});

test('en adresse, der ikke er en Sagu-note, afvises', async () => {
  for (const u of ['https://dr.dk/nyheder', 'https://www.notion.so/Side-0123456789abcdef0123456789abcdef']) {
    const r = await J(`/api/v1/sagu/comments?url=${encodeURIComponent(u)}`);
    assert.equal(r.status, 400, u);
  }
});

/* ============================================== rundturen ============== */

/* Vinduet var et doegn, saa en omdoebt note viste sit gamle navn indtil i
   morgen. Det er 60 sekunder nu - kort nok til at »skift app, ret, skift
   tilbage« virker, langt nok til at en optegning ikke koster et kald.
   Tallet er PINNET her: saettes det op igen, skal det vaere et valg. */
test('titel-opfriskningen spoerger Sagu højst én gang i minuttet - ikke pr. opslag', async () => {
  const lavet = await J('/api/v1/sagu/note', { title: 'Skal doebes om' });
  const url = lavet.data.page.url;
  const opg = await J('/api/v1/capture', { text: 'en opgave med en note', createNew: true });
  await J(`/api/v1/items/${opg.data.item.id}`, { link_url: url, link_title: 'Skal doebes om' });

  // Nogen doeber noten om i Sagu.
  const id = url.match(/#note-([0-9a-f]{32})$/)[1];
  attrap.noter.get(id).title = 'Doebt om i Sagu';

  attrap.ryd();
  const foerste = await J('/api/v1/link/refresh', { kind: 'item', id: opg.data.item.id });
  assert.equal(foerste.data.title, 'Doebt om i Sagu', 'den friske titel skal slaa igennem');
  assert.equal(attrap.kald.length, 1, 'ét opslag');

  // Og anden gang inden for doegnet roeres Sagu ikke.
  attrap.ryd();
  await J('/api/v1/link/refresh', { kind: 'item', id: opg.data.item.id });
  assert.deepEqual(attrap.kald, [], 'hoejst ét opslag i vinduet');

  // Og vinduet er 60 sekunder - ikke et doegn. Uden den her kunne tallet
  // krybe op igen, uden at nogen opdagede det.
  const kilde = readFileSync(join(ROD, 'app', 'server.js'), 'utf8');
  assert.match(kilde, /now\(\) - r\.link_checked_at < 60\b/,
    'vinduet for titel-opfriskningen skal vaere 60 sekunder');
});

test('en noegle kan ikke saette forbindelsen', async () => {
  // Auth-ruterne staar uden for »ét API, to legitimationer«: ellers er én
  // laekket noegle nok til at pege doda paa en fremmed Sagu.
  const n = await J('/api/v1/tokens', { name: 'k', scope: 'full' });
  const noegle = n.data.key || n.data.token;
  const r = await fetch(`${BASE}/api/v1/sagu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegle}` },
    body: JSON.stringify({ url: 'https://kapret.eksempel.dk', key: 'x' }),
  });
  assert.equal(r.status, 401);
  assert.equal((await J('/api/v1/sagu')).data.url, attrap.url, 'uroert');
});

/* ====================================== mod den RIGTIGE Sagu =========== */

/**
 * Attrappen er min forstaaelse af Sagu - ikke Sagu.
 *
 * Ligger Sagu ved siden af, startes den rigtige app, og hele turen koeres
 * igennem den. Det var netop et gennemloeb mod den aegte modtager, der fandt,
 * at et link i enden af en linje blev aedt af en aaben markoer.
 */
const SAGU_ROD = process.env.SAGU_ROD || join(homedir(), 'ClaudeMacBook', 'sagu');

test('MOD DEN RIGTIGE SAGU: en note oprettes, findes og kan laeses tilbage',
  { skip: !existsSync(join(SAGU_ROD, 'app', 'server.js')) && 'Sagu ligger ikke ved siden af' },
  async () => {
    const saguData = mkdtempSync(join(tmpdir(), 'sagu-mod-doda-'));
    const p = spawn('node', [join(SAGU_ROD, 'app', 'server.js')], {
      env: Object.assign({}, process.env, { BIND_PORT: '0', DATA_DIR: saguData }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ud = '';
    try {
      const port = await new Promise((ok, nej) => {
        const timer = setTimeout(() => nej(new Error(`Sagu startede ikke:\n${ud}`)), 10000);
        p.stdout.on('data', (b) => {
          ud += b;
          const m = ud.match(/sagu lytter paa port (\d+)/);
          if (m) { clearTimeout(timer); ok(m[1]); }
        });
      });
      const saguBase = `http://127.0.0.1:${port}`;
      let saguCookie = '';
      const S = async (sti, krop, metode) => {
        const r = await fetch(saguBase + sti, {
          method: metode || (krop === undefined ? 'GET' : 'POST'),
          headers: Object.assign({ 'Content-Type': 'application/json' },
            saguCookie ? { cookie: saguCookie } : {}),
          body: krop === undefined ? undefined : JSON.stringify(krop),
        });
        const s = (r.headers.getSetCookie && r.headers.getSetCookie()) || [];
        for (const c of s) if (c.startsWith('sagu_session=')) saguCookie = c.split(';')[0];
        return r.json();
      };
      await S('/api/register', { username: 'ejer', password: 'kodeord-1234' });
      const bog = (await S('/api/v1/notebooks', { name: 'Handbook' })).notebook;
      // Præcis den noegle, planen foreskriver: den kan soege og oprette -
      // og ikke slette.
      const noegle = (await S('/api/v1/keys', { name: 'doda', scope: 'link' })).key;

      const forbundet = await forbind(saguBase, noegle);
      assert.equal(forbundet.status, 200, JSON.stringify(forbundet.data));
      assert.ok(forbundet.data.notebooks.some((b) => b.name === 'Handbook'),
        'notesboegerne skal komme med, saa noten kan lande det rigtige sted');

      const lavet = await J('/api/v1/sagu/note', {
        title: 'Fra doda til Sagu',
        notebookId: bog.id,
        backUrl: 'https://doda.eksempel.dk',
        backTitle: 'Fra doda til Sagu',
      });
      assert.equal(lavet.status, 200, JSON.stringify(lavet.data));

      // Staar den, hvor den skal - og siger noten det samme, naar man
      // spoerger Sagu selv?
      const id = lavet.data.page.url.match(/#note-([0-9a-f]{32})$/)[1];
      const note = (await S(`/api/v1/notes/${id}`)).note;
      assert.equal(note.title, 'Fra doda til Sagu');
      assert.equal(note.notebookId, bog.id, 'i den rigtige notesbog');
      assert.match(note.body, /doda\.eksempel\.dk/, 'med et link tilbage');

      // Og doda kan finde den igen.
      const fundet = await J('/api/v1/sagu/search?q=Fra%20doda');
      assert.ok(fundet.data.pages.some((x) => x.title === 'Fra doda til Sagu'));

      // Noeglen maa IKKE kunne slette. Det er planens accept, og den skal
      // maales - ikke antages.
      const slet = await fetch(`${saguBase}/api/v1/notes/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noegle}` },
      });
      assert.equal(slet.status, 403, 'en link-noegle maa kunne oprette, ikke slette');
    } finally {
      const doed = new Promise((r) => p.on('exit', r));
      p.kill('SIGTERM');
      await doed;
      rmSync(saguData, { recursive: true, force: true });
      // Ryd forbindelsen igen, saa den ikke peger paa en doed server.
      await J('/api/v1/sagu', {}, 'DELETE');
    }
  });

/* ======================================= hent notesboegerne forfra ===== */

/* Listen blev kun hentet, naar man FORBANDT. Oprettede man en notesbog i Sagu
   bagefter, kunne doda aldrig se den, og den eneste udvej var at koble fra og
   forbinde igen - hvilket kraever noeglen paa ny. En cache uden en maade at
   genopfriske den paa er en blindgyde. */

test('en ny notesbog i Sagu kommer med, naar der hentes forfra', async () => {
  // Proeven mod den rigtige Sagu kobler fra til sidst, saa forbindelsen
  // skal staa igen her.
  attrap.saet('ok');
  attrap.saetBoeger([{ id: 'b1', name: 'Handbook' }]);
  assert.equal((await forbind(attrap.url, 'sagu_rigtig')).status, 200);

  attrap.saetBoeger([{ id: 'b1', name: 'Handbook' }, { id: 'b2', name: 'Rejser' }]);
  const r = await J('/api/v1/sagu/refresh', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.notebooks.map((b) => b.id), ['b1', 'b2']);

  // Og den er GEMT - ikke bare returneret denne ene gang.
  const set = await J('/api/v1/sagu');
  assert.deepEqual(set.data.notebooks.map((b) => b.id), ['b1', 'b2']);
});

test('forsvinder den valgte notesbog, ryddes valget - ellers laa noterne i en slettet bog', async () => {
  await J('/api/v1/sagu/notebook', { notebookId: 'b2' });
  assert.equal((await J('/api/v1/sagu')).data.notebook, 'b2');

  attrap.saetBoeger([{ id: 'b1', name: 'Handbook' }]);
  await J('/api/v1/sagu/refresh', {});
  const set = await J('/api/v1/sagu');
  assert.equal(set.data.notebook, '', 'valget skal vaere ryddet');
  assert.deepEqual(set.data.notebooks.map((b) => b.id), ['b1']);
});

/* Den vigtigste: en fejl maa ikke koste brugeren hans liste. Var Sagu nede et
   oejeblik, ville en tom liste se ud, som om notesboegerne var slettet. */
test('er Sagu nede, staar den gamle liste UROERT', async () => {
  attrap.saetBoeger([{ id: 'b1', name: 'Handbook' }, { id: 'b9', name: 'Opskrifter' }]);
  await J('/api/v1/sagu/refresh', {});
  assert.equal((await J('/api/v1/sagu')).data.notebooks.length, 2);

  attrap.saet('nede');
  const r = await J('/api/v1/sagu/refresh', {});
  assert.equal(r.status, 400);
  attrap.saet('ok');

  const set = await J('/api/v1/sagu');
  assert.deepEqual(set.data.notebooks.map((b) => b.id), ['b1', 'b9'],
    'en fejl mod Sagu maa ikke tage notesboegerne fra brugeren');
});

/* ============================== notens indhold ========================= */

/* Ruden viste KUN kommentarer. Man kunne altsaa se, at nogen havde sagt noget
   om en note, man ikke kunne laese - og maatte skifte app for at finde ud af,
   hvad sagen var. Teksten hentes med `read`, som en link-noegle har. */

test('noten selv foelger med kommentarerne - i ét kald', async () => {
  attrap.saet('ok');
  assert.equal((await forbind(attrap.url, 'sagu_rigtig')).status, 200);
  await J('/api/v1/sagu/note', { title: 'Linsekontrol', notebookId: 'b1' });
  const lavet = [...attrap.noter.values()].pop();

  const r = await J(`/api/v1/sagu/comments?url=${encodeURIComponent(`${attrap.url}/#note-${lavet.id}`)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.comments), 'kommentarerne skal stadig vaere der');
  assert.equal(r.data.note.title, 'Linsekontrol');
  assert.match(r.data.note.body, /# Linsekontrol/, 'selve teksten skal med');
});

/* Fejler noten, men ikke kommentarerne, er kommentarerne stadig bedre end en
   fejlbesked - saa `note` udelades i stedet for at vaelte hele ruden. */
test('en note, der ikke kan hentes, vaelter ikke kommentarerne', async () => {
  const lavet = [...attrap.noter.values()].pop();
  const url = `${attrap.url}/#note-${lavet.id}`;
  attrap.saet('note-nede');
  const r = await J(`/api/v1/sagu/comments?url=${encodeURIComponent(url)}`);
  attrap.saet('ok');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.note, null, 'noten udelades');
  assert.ok(Array.isArray(r.data.comments), 'men kommentarerne staar der');
});

/* En adresse, der slet ikke peger paa en note, skal stadig give en LAESBAR
   fejl - ikke en tom rude, man ikke kan forklare. */
test('en ukendt note giver en laesbar fejl', async () => {
  const r = await J(`/api/v1/sagu/comments?url=${encodeURIComponent(`${attrap.url}/#note-${'f'.repeat(32)}`)}`);
  assert.equal(r.status, 502);
  assert.match(r.data.message, /No such note/);
});
