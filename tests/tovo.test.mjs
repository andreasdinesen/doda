/*
 * F10 - broen til tovo, set fra doda.
 *
 * Som Sagu-testen koerer den mod en **tovo-attrap**: en lille http-server,
 * der svarer som tovo goer, og som kan bedes om at svare forkert. Det er den
 * eneste maade at proeve de fejlstier, en rigtig tovo ikke vil levere paa
 * kommando - og fejlstierne er dem, der faktisk sker i en bro.
 *
 * Attrappen er dog IKKE tovo; den er min forstaaelse af tovo. Til sidst
 * ligger derfor en test, der koerer mod den rigtige app, naar den ligger ved
 * siden af (`TOVO_ROD`).
 *
 * De tre ting, der er dyre at faa galt, og som testene derfor holder fast i:
 *
 *  1. **Noeglen maa aldrig ud af serveren.** Hverken gennem forbindelses-
 *     ruten, GET /settings eller JSON-eksporten.
 *  2. **Den samme doda-opgave skal ramme den samme tovo-opgave.** Ellers
 *     ligger timerne paa to opgaver, og »hvor lang tid gik der?« kan ikke
 *     besvares. Det er dét, `tovo_task_id` er til, og det er dét, en
 *     gendannelse af en backup ikke maa kaste vaek.
 *  3. **Stop afslutter ikke opgaven.** Man kan vaere noedt til at holde op
 *     uden at blive faerdig (Andreas, 18-09-2026).
 *
 *   node --test tests/tovo.test.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8943;
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
 * En tovo-attrap.
 *
 * `kald` taeller, saa »ikke ét kald pr. optegning« kan MAALES. Den
 * haandhaever ogsaa tovos egen regel om ÉN koerende timer - uden den ville
 * testen for »start paa B stopper A« bevise noget om attrappen i stedet for
 * om broen.
 */
function tovoAttrap() {
  const kald = [];
  let tilstand = 'ok';
  const opgaver = new Map();
  let koerende = null;         // {taskId, startedAt}
  let n = 0;
  let projekter = [{ id: 'p1', name: 'Nordvind', customer: 'Nordvind A/S' }];
  // Registreret tid pr. opgave, som tovo ville have regnet den.
  const forbrug = new Map();
  const s = createServer(async (req, res) => {
    const sti = req.url.split('?')[0];
    kald.push(`${req.method} ${sti}`);
    const send = (kode, krop) => {
      res.writeHead(kode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(krop));
    };
    if (tilstand === 'nede') { req.destroy(); return; }
    if (String(req.headers.authorization || '') !== 'Bearer tovo_rigtig') {
      send(401, { error: 'invalid_key', message: 'That access key is not valid.' });
      return;
    }
    if (tilstand === 'smal') {
      // Praecis tovos egen form - det er DEN, broen skal kunne genkende.
      send(403, { error: 'wrong_scope', message: 'This key is "capture" and cannot read.' });
      return;
    }

    const timerSvar = () => {
      if (!koerende) return null;
      const o = opgaver.get(koerende.taskId);
      return {
        entry: { id: 'e1', taskId: koerende.taskId, startedAt: koerende.startedAt },
        taskTitle: o ? o.title : 'Deleted task',
        projectName: o && o.projectId ? 'Nordvind' : null,
        minutes: 0,
        tooLong: false,
      };
    };

    if (sti === '/api/v1/state') {
      send(200, { user: { username: 'andreas' }, projects: projekter, timer: timerSvar() });
      return;
    }
    if (sti === '/api/v1/timer/current') { send(200, { timer: timerSvar() }); return; }

    /*
     * `spent` pr. opgave - tovos EGNE ruter, regnet med `forbrugPaaOpgave`.
     * Broen spoerger ad dem for at slippe for at summere selv; attrappen
     * skal derfor have dem, ellers proever testen noget andet end koden gor.
     */
    const pm = /^\/api\/v1\/projects\/([\w-]+)$/.exec(sti);
    if (pm && req.method === 'GET') {
      const i = [...opgaver.values()].filter((t) => t.projectId === pm[1]);
      send(200, { project: { id: pm[1] }, tasks: i, spent: Object.fromEntries(i.map((t) => [t.id, forbrug.get(t.id) || 0])) });
      return;
    }
    if (sti === '/api/v1/no-project' && req.method === 'GET') {
      const i = [...opgaver.values()].filter((t) => !t.projectId);
      send(200, { tasks: i, spent: Object.fromEntries(i.map((t) => [t.id, forbrug.get(t.id) || 0])), minutes: 0 });
      return;
    }
    if (sti === '/api/v1/items' && req.method === 'POST') {
      let raa = '';
      for await (const bid of req) raa += bid;
      const krop = JSON.parse(raa || '{}');
      n += 1;
      const id = `t${n}`;
      opgaver.set(id, { id, title: krop.title, projectId: krop.projectId || null, note: krop.note || '' });
      send(200, { item: opgaver.get(id) });
      return;
    }
    if (sti === '/api/v1/timer/start' && req.method === 'POST') {
      let raa = '';
      for await (const bid of req) raa += bid;
      const krop = JSON.parse(raa || '{}');
      if (!opgaver.has(krop.taskId)) { send(404, { error: 'not_found', message: 'No such task.' }); return; }
      const stoppede = koerende && koerende.taskId !== krop.taskId ? koerende.taskId : null;
      // tovos unikke indeks tillader kun ÉN koerende timer. Attrappen skal
      // opfoere sig sadan, ellers beviser testen ingenting.
      koerende = { taskId: krop.taskId, startedAt: Math.floor(Date.now() / 1000) };
      send(200, { timer: timerSvar(), stopped: stoppede ? { id: 'e0', taskId: stoppede } : null });
      return;
    }
    if (sti === '/api/v1/timer/stop' && req.method === 'POST') {
      if (!koerende) { send(404, { error: 'no_timer', message: 'No timer is running.' }); return; }
      koerende = null;
      send(200, { entry: { id: 'e1' } });
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
    saetProjekter: (p) => { projekter = p; },
    slet: (id) => opgaver.delete(id),
    saetForbrug: (id, min) => forbrug.set(id, min),
    opgaver,
    koerer: () => koerende,
  };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-tovo-'));
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: String(PORT), DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  await new Promise((ok, fejl) => {
    const timer = setTimeout(() => fejl(new Error(`serveren startede ikke:\n${stderr}`)), 10000);
    server.stdout.on('data', (b) => { if (String(b).includes('doda lytter')) { clearTimeout(timer); ok(); } });
    server.stderr.on('data', (b) => { stderr += b; process.stderr.write(b); });
  });
  await J('/api/register', { username: 'test', password: 'testtest123' });
  attrap = tovoAttrap();
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

const forbind = (url, key) => J('/api/v1/tovo', { url, key });
const nyOpgave = async (titel, felter) => (await J('/api/v1/items',
  Object.assign({ title: titel, kind: 'task', status: 'next' }, felter || {}))).data.item;

/* ============================================== forbindelsen =========== */

test('en forkert noegle GEMMES ikke - forbindelsen rulles tilbage', async () => {
  const r = await forbind(attrap.url, 'tovo_forkert');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'bad_key');
  assert.equal((await J('/api/v1/tovo')).data.connected, false,
    'intet maa vaere gemt efter et afvist forsoeg');
});

test('en adresse, der ikke svarer, siger DET - ikke »forkert noegle«', async () => {
  const r = await forbind('http://127.0.0.1:9', 'tovo_rigtig');
  assert.equal(r.status, 400);
  assert.match(r.data.message, /Could not reach tovo/);
});

test('en for SMAL noegle siger hvad den mangler - ikke at den er forkert', async () => {
  // Blander man de to, skifter man en noegle ud, der er helt i orden. En
  // `capture`-noegle er den sandsynlige fejl her: den ligner enhver anden.
  attrap.saet('smal');
  const r = await forbind(attrap.url, 'tovo_rigtig');
  attrap.saet('ok');
  assert.equal(r.status, 400);
  assert.match(r.data.message, /cannot read|too narrow|full/);
});

test('kun en rigtig adresse godtages', async () => {
  for (const d of ['ikke en adresse', 'javascript:alert(1)', `${attrap.url}/api`]) {
    const r = await forbind(d, 'tovo_rigtig');
    assert.equal(r.status, 400, d);
    assert.equal(r.data.error, 'bad_url');
  }
});

test('forbindelsen lykkes og henter projekterne med det samme', async () => {
  const r = await forbind(attrap.url, 'tovo_rigtig');
  assert.equal(r.status, 200);
  assert.equal(r.data.connected, true);
  assert.equal(r.data.projects.length, 1);
  assert.equal(r.data.projects[0].name, 'Nordvind');
});

/* ============================================== hemmeligheden ========== */

test('noeglen forlader ALDRIG serveren', async () => {
  const via = [
    (await J('/api/v1/tovo')).data,
    (await J('/api/v1/settings')).data,
    (await J('/api/v1/export')).data,
  ];
  for (const svar of via) {
    assert.ok(!JSON.stringify(svar).includes('tovo_rigtig'),
      `noeglen stod i ${JSON.stringify(svar).slice(0, 120)}`);
  }
});

/* ============================================== tidtagningen =========== */

test('foerste start opretter opgaven i tovo og husker den', async () => {
  const it = await nyOpgave('Ring til Nordvind');
  const r = await J('/api/v1/tovo/start', { id: it.id });
  assert.equal(r.status, 200);
  assert.ok(r.data.taskId, 'doda skal faa et tovo-id tilbage');
  assert.equal(attrap.koerer().taskId, r.data.taskId);

  const igen = (await J(`/api/v1/items/${it.id}`)).data.item;
  assert.equal(igen.tovo_task_id, r.data.taskId, 'koblingen skal vaere gemt');
});

test('titlen sendes UTOLKET - tovos parser maa ikke aede den', async () => {
  // En doda-titel er ikke skrevet til tovos fangstlinje: dér betyder `#` et
  // maerkat og `~` et estimat. Gik oprettelsen gennem /capture, ville
  // opgaven hedde noget andet, end den goer i doda.
  const it = await nyOpgave('Møde @ 9 om #12 ~ kaffe');
  const r = await J('/api/v1/tovo/start', { id: it.id });
  assert.equal(attrap.opgaver.get(r.data.taskId).title, 'Møde @ 9 om #12 ~ kaffe');
  await J('/api/v1/tovo/stop', {});
});

test('anden start paa SAMME opgave genbruger tovo-opgaven', async () => {
  // Hele grunden til at koblingen findes: ellers ville timerne ligge paa
  // hver sin opgave, og der ville ikke vaere et samlet tal.
  const it = await nyOpgave('Skriv tilbud');
  const foerste = await J('/api/v1/tovo/start', { id: it.id });
  await J('/api/v1/tovo/stop', {});
  const anden = await J('/api/v1/tovo/start', { id: it.id });
  assert.equal(anden.data.taskId, foerste.data.taskId);
  assert.equal(attrap.opgaver.size >= 1, true);
  await J('/api/v1/tovo/stop', {});
});

test('stop afslutter IKKE opgaven - den kan fortsaettes i morgen', async () => {
  const it = await nyOpgave('Halvfaerdig opgave');
  await J('/api/v1/tovo/start', { id: it.id });
  const r = await J('/api/v1/tovo/stop', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.wasRunning, true);
  assert.equal(attrap.koerer(), null);

  const efter = (await J(`/api/v1/items/${it.id}`)).data.item;
  assert.equal(efter.status, 'next', 'opgaven skal staa aaben');
  assert.equal(efter.completed_at, null);

  // Og den kan tages op igen - paa den samme tovo-opgave.
  const igen = await J('/api/v1/tovo/start', { id: it.id });
  assert.equal(igen.data.taskId, efter.tovo_task_id);
  await J('/api/v1/tovo/stop', {});
});

test('to stop i traek er ikke en fejl', async () => {
  // Tryk to gange, eller stop fra telefonen imens, og en fejlbesked ville
  // vaere en roed skaerm for at have faaet praecis det, man bad om.
  const r = await J('/api/v1/tovo/stop', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.wasRunning, false);
});

test('start paa B stopper uret paa A - og svaret siger det', async () => {
  const a = await nyOpgave('Opgave A');
  const b = await nyOpgave('Opgave B');
  await J('/api/v1/tovo/start', { id: a.id });
  const r = await J('/api/v1/tovo/start', { id: b.id });
  assert.equal(r.data.stopped, true,
    'fladen skal kunne sige, at den anden blev stoppet');
  const bItem = (await J(`/api/v1/items/${b.id}`)).data.item;
  assert.equal(attrap.koerer().taskId, bItem.tovo_task_id);
  await J('/api/v1/tovo/stop', {});
});

test('er opgaven slettet i tovo, oprettes den igen i stedet for at fejle', async () => {
  const it = await nyOpgave('Slettes i tovo');
  const foerste = await J('/api/v1/tovo/start', { id: it.id });
  await J('/api/v1/tovo/stop', {});
  attrap.slet(foerste.data.taskId);

  const igen = await J('/api/v1/tovo/start', { id: it.id });
  assert.equal(igen.status, 200, 'en slettet opgave maa ikke laase knappen');
  assert.notEqual(igen.data.taskId, foerste.data.taskId);
  const efter = (await J(`/api/v1/items/${it.id}`)).data.item;
  assert.equal(efter.tovo_task_id, igen.data.taskId, 'den nye kobling skal gemmes');
  await J('/api/v1/tovo/stop', {});
});

test('en note kan man ikke tage tid paa', async () => {
  // En note er reference, ikke arbejde (DESIGN.md §3).
  const n = await nyOpgave('En note', { kind: 'note' });
  const r = await J('/api/v1/tovo/start', { id: n.id });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'not_a_task');
});

test('en tovo, der gaar ned undervejs, giver en besked - ikke en stakspor', async () => {
  const it = await nyOpgave('Mens tovo er nede');
  attrap.saet('nede');
  const r = await J('/api/v1/tovo/start', { id: it.id });
  attrap.saet('ok');
  assert.equal(r.status, 502);
  assert.match(r.data.message, /Could not reach tovo/);
});

/* ============================================== projektkoblingen ======= */

test('et doda-projekt kan pege paa et tovo-projekt', async () => {
  const p = (await J('/api/v1/projects', { name: 'Nordvind-sagen' })).data.project;
  const r = await J('/api/v1/tovo/project', { projectId: p.id, tovoProjectId: 'p1' });
  assert.equal(r.status, 200);
  const state = (await J('/api/v1/state')).data;
  assert.equal(state.projects.find((x) => x.id === p.id).tovo_project_id, 'p1');
});

test('et ukendt tovo-projekt afvises', async () => {
  const p = (await J('/api/v1/projects', { name: 'Et andet' })).data.project;
  const r = await J('/api/v1/tovo/project', { projectId: p.id, tovoProjectId: 'findes-ikke' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'unknown_project');
});

test('opgaven arver projektets tovo-projekt, naar den oprettes i tovo', async () => {
  const p = (await J('/api/v1/projects', { name: 'Med kobling' })).data.project;
  await J('/api/v1/tovo/project', { projectId: p.id, tovoProjectId: 'p1' });
  const it = await nyOpgave('Arbejde paa sagen', { project_id: p.id });
  const r = await J('/api/v1/tovo/start', { id: it.id });
  assert.equal(attrap.opgaver.get(r.data.taskId).projectId, 'p1',
    'uden dette lander timerne i tovos »no project«, og ugerapporten er ubrugelig');
  await J('/api/v1/tovo/stop', {});
});

test('forsvinder et tovo-projekt, ryddes koblingen ved naeste opfriskning', async () => {
  // Ellers ville doda blive ved med at vise et projektnavn, der er slettet,
  // mens tiden i virkeligheden landede i »no project« - og intet ville fejle.
  const p = (await J('/api/v1/projects', { name: 'Mister sit projekt' })).data.project;
  await J('/api/v1/tovo/project', { projectId: p.id, tovoProjectId: 'p1' });
  attrap.saetProjekter([{ id: 'p2', name: 'Et helt andet' }]);
  await J('/api/v1/tovo/refresh', {});
  attrap.saetProjekter([{ id: 'p1', name: 'Nordvind', customer: 'Nordvind A/S' }]);
  const state = (await J('/api/v1/state')).data;
  assert.equal(state.projects.find((x) => x.id === p.id).tovo_project_id, null);
});

/* ============================================== backup ================= */

test('en gendannelse beholder koblingen til tiden', async () => {
  /*
   * Importen er `INSERT OR REPLACE`. Staar `tovo_task_id` ikke i
   * kolonnelisten, bliver den NULL ved en gendannelse - tavst - og naeste
   * tidtagning opretter en dublet i tovo ved siden af den, timerne staar paa.
   */
  const it = await nyOpgave('Skal overleve en backup');
  const r = await J('/api/v1/tovo/start', { id: it.id });
  await J('/api/v1/tovo/stop', {});

  const eksport = (await J('/api/v1/export')).data;
  const raekke = eksport.items.find((x) => x.id === it.id);
  assert.equal(raekke.tovo_task_id, r.data.taskId, 'eksporten skal baere koblingen');

  // Samme fil ind igen - idempotent paa id, som importen er bygget til.
  await J('/api/v1/import', { items: [raekke] });
  const efter = (await J(`/api/v1/items/${it.id}`)).data.item;
  assert.equal(efter.tovo_task_id, r.data.taskId, 'koblingen maa ikke gaa tabt');
});

test('frakobling beholder koblingerne - kun knapperne forsvinder', async () => {
  const it = await nyOpgave('Overlever en frakobling');
  const r = await J('/api/v1/tovo/start', { id: it.id });
  await J('/api/v1/tovo/stop', {});
  await J('/api/v1/tovo', {}, 'DELETE');
  assert.equal((await J('/api/v1/tovo')).data.connected, false);
  const efter = (await J(`/api/v1/items/${it.id}`)).data.item;
  assert.equal(efter.tovo_task_id, r.data.taskId,
    'ryddes den, opretter en genforbindelse et nyt saet opgaver ved siden af de gamle');
  // Og timeren svarer pænt uden en forbindelse - ikke med en fejl.
  const t = await J('/api/v1/tovo/timer');
  assert.equal(t.status, 200);
  assert.equal(t.data.connected, false);
  await forbind(attrap.url, 'tovo_rigtig');
});

/* ============================================== den rigtige tovo ======= */

/*
 * Attrappen er min forstaaelse af tovo. Denne test er den eneste, der kan
 * modbevise den - og det er praecis dén slags gennemloeb, der fandt, at
 * tovos `/api/v1/items` gemmer en HEL opgave.
 */
const TOVO_ROD = process.env.TOVO_ROD || join(ROD, '..', 'tovo');
const harTovo = existsSync(join(TOVO_ROD, 'app', 'server.js'));

test('mod den rigtige tovo: start, stop og genoptag paa samme opgave',
  { skip: harTovo ? false : 'tovo ligger ikke ved siden af' }, async (t) => {
    const tovoData = mkdtempSync(join(tmpdir(), 'tovo-ved-doda-'));
    const tovoPort = 8944;
    const p = spawn('node', [join(TOVO_ROD, 'app', 'server.js')], {
      env: Object.assign({}, process.env,
        { BIND_PORT: String(tovoPort), DATA_DIR: tovoData, TOVO_DEV: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ud = '';
    try {
      await new Promise((ok, fejl) => {
        const timer = setTimeout(() => fejl(new Error(`tovo startede ikke:\n${ud}`)), 10000);
        p.stdout.on('data', (b) => { ud += b; if (/lytter/.test(String(b))) { clearTimeout(timer); ok(); } });
        p.stderr.on('data', (b) => { ud += b; });
      });
      const tovoBase = `http://127.0.0.1:${tovoPort}`;
      let tovoCookie = '';
      const T = async (sti, krop, metode, noegle) => {
        const r = await fetch(tovoBase + sti, {
          method: metode || (krop === undefined ? 'GET' : 'POST'),
          headers: Object.assign({ 'Content-Type': 'application/json' },
            noegle ? { Authorization: `Bearer ${noegle}` } : (tovoCookie ? { cookie: tovoCookie } : {})),
          body: krop === undefined ? undefined : JSON.stringify(krop),
        });
        const s = r.headers.get('set-cookie');
        if (s) tovoCookie = s.split(';')[0];
        return { status: r.status, data: await r.json().catch(() => null) };
      };
      await T('/api/register', { username: 'andreas', password: 'testtest123' });
      const noegle = (await T('/api/v1/keys', { name: 'doda', scope: 'full' })).data;
      const raa = noegle && (noegle.key || noegle.token || (noegle.created && noegle.created.key));
      assert.ok(raa, `kunne ikke faa en noegle ud af tovo: ${JSON.stringify(noegle)}`);

      assert.equal((await forbind(tovoBase, raa)).status, 200);
      const it = await nyOpgave('Rigtig tovo-opgave');
      const start = await J('/api/v1/tovo/start', { id: it.id });
      assert.equal(start.status, 200, JSON.stringify(start.data));
      assert.equal((await J('/api/v1/tovo/timer')).data.timer.taskId, start.data.taskId);

      assert.equal((await J('/api/v1/tovo/stop', {})).data.wasRunning, true);
      // Opgaven staar stadig aaben i doda - det er hele pointen med Stop.
      assert.equal((await J(`/api/v1/items/${it.id}`)).data.item.status, 'next');

      const igen = await J('/api/v1/tovo/start', { id: it.id });
      assert.equal(igen.data.taskId, start.data.taskId, 'samme tovo-opgave, anden tidspost');
      await J('/api/v1/tovo/stop', {});

      // To poster paa den samme opgave - det er sadan »fortsaet i morgen«
      // bliver til ét tal.
      const poster = await T(`/api/v1/entries?task=${start.data.taskId}`, undefined, 'GET', raa);
      assert.equal(poster.data.entries.length, 2);
    } finally {
      const doed = new Promise((r) => p.on('exit', r));
      p.kill('SIGTERM');
      await doed;
      rmSync(tovoData, { recursive: true, force: true });
      await forbind(attrap.url, 'tovo_rigtig');
    }
  });

/* ============================================== fase 2 ================= */

test('registreret tid hentes fra tovo - doda summerer ikke selv', async () => {
  /*
   * Tallet skal komme FAERDIGT fra tovo. tovo afrunder pr. tidspost efter en
   * indstilling, doda ikke kender, saa en sum lavet her kunne vise noget
   * andet end den timeseddel, der bliver skrevet af. Derfor spoerges der ad
   * tovos egne `spent`-ruter.
   */
  const p = (await J('/api/v1/projects', { name: 'Tidsprojekt' })).data.project;
  await J('/api/v1/tovo/project', { projectId: p.id, tovoProjectId: 'p1' });
  const it = await nyOpgave('Noget der tager tid', { project_id: p.id });
  const r = await J('/api/v1/tovo/start', { id: it.id });
  await J('/api/v1/tovo/stop', {});
  attrap.saetForbrug(r.data.taskId, 135);

  const svar = await J(`/api/v1/tovo/spent?id=${it.id}`);
  assert.equal(svar.status, 200);
  assert.equal(svar.data.minutes, 135);
});

test('en opgave uden projekt findes ogsaa - via »opgaver uden projekt«', async () => {
  const it = await nyOpgave('Ad hoc-arbejde');
  const r = await J('/api/v1/tovo/start', { id: it.id });
  await J('/api/v1/tovo/stop', {});
  attrap.saetForbrug(r.data.taskId, 42);
  assert.equal((await J(`/api/v1/tovo/spent?id=${it.id}`)).data.minutes, 42);
});

test('en opgave, der aldrig er taget tid paa, svarer null - ikke nul', async () => {
  // »0m registreret« er en paastand om en maaling, der ikke findes.
  const it = await nyOpgave('Aldrig timet');
  const svar = await J(`/api/v1/tovo/spent?id=${it.id}`);
  assert.equal(svar.status, 200);
  assert.equal(svar.data.minutes, null);
});

test('afkrydsning stopper uret paa DEN opgave', async () => {
  const it = await nyOpgave('Bliver faerdig');
  await J('/api/v1/tovo/start', { id: it.id });
  assert.ok(attrap.koerer(), 'uret skal koere foer proeven');
  await J(`/api/v1/items/${it.id}/complete`, {});
  // Stoppet er »bedste forsoeg« og sker uden await paa serveren - giv det et
  // oejeblik, og maal paa tovo-siden, ikke paa dodas svar.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(attrap.koerer(), null, 'uret skulle vaere stoppet');
});

test('afkrydsning af en ANDEN opgave lader uret koere videre', async () => {
  /*
   * Den vigtigste af de to. Et bart `stop()` ville lukke den tidtagning, der
   * koerer, uanset hvilken opgave man krydsede af - og man ville miste tid
   * paa noget, man var midt i.
   *
   * B skal have VAERET timet foer (»jeg arbejdede paa den i gaar«), ellers
   * naar koden aldrig frem til sammenligningen: `stopUretFor` traekker sig
   * med det samme for en opgave uden `tovo_task_id`, og proeven ville saa
   * bestaa med et bart `stop()` indsat. Maalt 18-09-2026 - foerste udgave af
   * den her proeve gjorde praecis det og beviste ingenting.
   */
  const a = await nyOpgave('Den der koerer');
  const b = await nyOpgave('Den der krydses af');

  // B timet og stoppet: nu HAR den et modstykke i tovo.
  await J('/api/v1/tovo/start', { id: b.id });
  await J('/api/v1/tovo/stop', {});
  const bItem = (await J(`/api/v1/items/${b.id}`)).data.item;
  assert.ok(bItem.tovo_task_id, 'forudsaetningen: B skal kende sin tovo-opgave');

  // A er den, der koerer NU.
  await J('/api/v1/tovo/start', { id: a.id });
  const aItem = (await J(`/api/v1/items/${a.id}`)).data.item;
  assert.equal(attrap.koerer().taskId, aItem.tovo_task_id);

  await J(`/api/v1/items/${b.id}/complete`, {});
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(attrap.koerer(), 'uret paa A maatte ikke stoppes');
  assert.equal(attrap.koerer().taskId, aItem.tovo_task_id);
  await J('/api/v1/tovo/stop', {});
});

test('»dropped« stopper ogsaa uret', async () => {
  const it = await nyOpgave('Laver den ikke alligevel');
  await J('/api/v1/tovo/start', { id: it.id });
  await J(`/api/v1/items/${it.id}`, { status: 'dropped' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(attrap.koerer(), null);
});

test('en tovo, der er nede, maa ikke kunne blokere en afkrydsning', async () => {
  const it = await nyOpgave('Krydses af mens tovo er nede');
  await J('/api/v1/tovo/start', { id: it.id });
  attrap.saet('nede');
  const t0 = Date.now();
  const r = await J(`/api/v1/items/${it.id}/complete`, {});
  const brugt = Date.now() - t0;
  attrap.saet('ok');
  assert.equal(r.status, 200, 'afkrydsningen skal lykkes uanset hvad tovo laver');
  assert.ok(brugt < 1000, `afkrydsningen tog ${brugt} ms - den maa ikke vente paa tovo`);
  assert.equal((await J(`/api/v1/items/${it.id}`)).data.item.status, 'done');
  await J('/api/v1/tovo/stop', {});
});

test('`%` i fangsten starter uret med det samme', async () => {
  const r = await J('/api/v1/capture', { text: 'Ring til kunden % /Tidsprojekt', createNew: true });
  assert.equal(r.status, 200);
  assert.match(r.data.message, /timer started/i);
  // Markoeren maa ikke blive staaende i titlen.
  assert.equal(r.data.item.title, 'Ring til kunden');
  assert.equal(attrap.koerer().taskId, r.data.item.tovo_task_id || attrap.koerer().taskId);
  assert.ok(r.data.timer, 'svaret skal baere timeren, saa fladen kan tegne ikonet');
  /*
   * `parsed.startTimer` er KONTRAKTEN med fladen. Paletten laeser den for at
   * vide, om den skal vise serverens besked i stedet for »Added to Inbox« -
   * den kan ikke bruge sin egen tolkning, fordi `luk()` har nulstillet den,
   * inden kvitteringen skrives. Foerste udgave gjorde netop det, og beskeden
   * om at uret var startet blev aldrig vist, mens uret faktisk koerte.
   */
  assert.equal(r.data.parsed.startTimer, true,
    'fladen laeser flaget HER - uden det kan kvitteringen ikke sige, at uret gik i gang');
  /*
   * Elementet i svaret skal kende sin tovo-opgave. Fladen laegger PRAECIS
   * dette objekt ind i listen, og ikonet sammenligner paa feltet - er det
   * null, staar den nye raekke slukket, mens uret koerer.
   */
  assert.ok(r.data.item.tovo_task_id, 'det returnerede element skal baere koblingen');
  assert.equal(r.data.item.tovo_task_id, attrap.koerer().taskId);
  await J('/api/v1/tovo/stop', {});
});

test('`100% faerdig` er tekst, ikke en timer', async () => {
  // Markoeren kraever mellemrum eller linjeslut EFTER tegnet. Uden det ville
  // enhver procentangivelse starte et ur.
  const r = await J('/api/v1/capture', { text: 'Rapporten er 100% faerdig', createNew: true });
  assert.equal(r.data.item.title, 'Rapporten er 100% faerdig');
  assert.equal(attrap.koerer(), null);
  assert.ok(!/timer started/i.test(r.data.message));
});

test('`%` paa en NOTE siger fra - den spises ikke', async () => {
  const r = await J('/api/v1/capture', { text: '* En note %', createNew: true });
  assert.equal(r.data.item.kind, 'note');
  assert.match(r.data.message, /ignored/i);
  assert.equal(attrap.koerer(), null);
});

test('`%` uden en forbundet tovo opretter opgaven og siger hvorfor', async () => {
  await J('/api/v1/tovo', {}, 'DELETE');
  const r = await J('/api/v1/capture', { text: 'Noget arbejde %', createNew: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.title, 'Noget arbejde', 'opgaven skal oprettes alligevel');
  assert.match(r.data.message, /not connected/i);
  await forbind(attrap.url, 'tovo_rigtig');
});

test('`%` paa en gentagelse starter uret paa foerste forekomst', async () => {
  // `fangst` returnerer her forekomsten, ikke en loes opgave. Uden at det
  // virker, ville `% !every monday` tavst droppe markoeren.
  const r = await J('/api/v1/capture', { text: 'Ugentlig status % !every monday', createNew: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.recurrence, 'der skal vaere oprettet en gentagelse');
  assert.match(r.data.message, /timer started/i);
  assert.equal(attrap.koerer().taskId, r.data.item.tovo_task_id);
  await J('/api/v1/tovo/stop', {});
});
