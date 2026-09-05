/* Runens »Opdater doda«-script. Koer: node --test tests/opdatering.test.mjs
 *
 * Scriptet hives ud af den UDGIVNE runes/doda.yaml og koeres som det er.
 * Grunden er, at fejlen, der gjorde den her fil noedvendig, ikke kunne ses i
 * en afskrift: else-grenen - den, der KUN bruges ved opgraderingen fra en
 * doda uden app/kilde.js, altsaa praecis den ene gang, hele mekanikken
 * handler om - havde tre huller, mens hovedvejen var i orden (fundet af Sagu
 * v48, 05-09-2026, efter ti timers nedetid hos dem):
 *
 *   - fast temp-sti i /tmp, delt mellem to samtidige koersler
 *   - `rm -rf app` FOER `mv`, altsaa et vindue helt uden app/
 *   - `mv` fra /tmp: en kopi over to filsystemer, som kan afbrydes
 *
 * Vi skrev de tre ting ned som de baerende valg, byggede hovedvejen efter dem
 * - og lod dem staa i redningsvejen.
 *
 * ── Hvad prøven IKKE daekker ─────────────────────────────────────────────
 *
 * Transporten er skiftet ud: `require("https")` bliver til `require("http")`,
 * og codeload-adressen peger paa en lokal server. Alt ANDET koeres ordret,
 * inklusive laasen, forgreningen, udpakningen og byttet. Prøven siger altsaa
 * intet om TLS, omdirigeringer eller GitHubs svar - kun om det, scriptet selv
 * goer med filerne. Og den koerer paa macOS' bsdtar, ikke alpines busybox.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = 84;

/* ------------------------------------------------- scriptet, som det udgives */

/** Node har ingen YAML-laeser, og doda har nul afhaengigheder. Python3 +
 *  PyYAML er der allerede - build_rune.py kraever dem. */
function scriptFraRunen(noegle) {
  const r = spawnSync('python3', ['-c', `
import yaml, sys
d = yaml.safe_load(open('${join(ROD, 'runes', 'doda.yaml')}', encoding='utf8'))['gameskill']
sys.stdout.write(d['${noegle}']['script'] if '${noegle}' != 'startup' else d['startup']['command'])
`], { encoding: 'utf8' });
  assert.equal(r.status, 0, `kunne ikke laese runen: ${r.stderr}`);
  assert.ok(r.stdout.length > 100, 'scriptet fra runen er tomt');
  return r.stdout;
}

/** Samme script - kun transporten peger et andet sted hen. */
function modLokalServer(script, port) {
  return script
    .replaceAll('require("https")', 'require("http")')
    .replace(/https:\/\/codeload\.github\.com\/[^"]+/, `http://127.0.0.1:${port}/arkiv.tar.gz`);
}

/* -------------------------------------------------------------- arkivet */

/** Et gzippet tar, der ser ud som GitHubs: <repo>-<ref>/app/... */
function byggArkiv(filer) {
  const d = mkdtempSync(join(tmpdir(), 'doda-arkiv-'));
  const rod = join(d, `doda-${VERSION}`);
  for (const [navn, indhold] of Object.entries(filer)) {
    const sti = join(rod, navn);
    mkdirSync(dirname(sti), { recursive: true });
    writeFileSync(sti, indhold);
  }
  const ud = join(d, 'arkiv.tar.gz');
  const r = spawnSync('tar', ['czf', ud, '-C', d, `doda-${VERSION}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar fejlede: ${r.stderr}`);
  const bytes = readFileSync(ud);
  rmSync(d, { recursive: true, force: true });
  return bytes;
}

const HEL_APP = {
  'app/server.js': '// ny server\n',
  'app/kilde-ikke-med.txt': 'x\n',
  'app/public/index.html': `<script src="/app.js?v=${VERSION}"></script>\n`,
  'app/public/app.js': '// ny app\n',
};

/* ------------------------------------------------------- den lokale server */

let server;
let port;
let arkiv = byggArkiv(HEL_APP);
let forsinkelseMs = 0;

before(async () => {
  server = createServer(async (req, res) => {
    if (forsinkelseMs) await new Promise((ok) => { setTimeout(ok, forsinkelseMs); });
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(arkiv);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});

after(() => { if (server) server.close(); });

/* ------------------------------------------------------------- en arbejdsmappe */

/** En rune-rod med en GAMMEL app/ i - altsaa en doda fra foer v82, uden
 *  kilde.js. Det er den tilstand, else-grenen findes for. */
function rod({ medKilde = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'doda-rod-'));
  mkdirSync(join(d, 'app', 'public'), { recursive: true });
  writeFileSync(join(d, 'app', 'server.js'), '// gammel server\n');
  writeFileSync(join(d, 'app', 'public', 'index.html'), '<script src="/app.js?v=81"></script>\n');
  writeFileSync(join(d, 'app', 'skal-vaek.js'), '// slettet i den nye udgave\n');
  if (medKilde) writeFileSync(join(d, 'app', 'kilde.js'), 'process.exit(0);\n');
  return d;
}

function koer(dir, script) {
  return new Promise((ok) => {
    const p = spawn('sh', ['-c', script], { cwd: dir, encoding: 'utf8' });
    let ud = '';
    p.stdout.on('data', (b) => { ud += b; });
    p.stderr.on('data', (b) => { ud += b; });
    p.on('close', (kode) => ok({ kode, ud }));
  });
}

const opdaterScript = () => modLokalServer(scriptFraRunen('update'), port);

/* ============================================================== prøverne */

test('en opdatering skifter app/ ud og efterlader ingenting', async () => {
  const d = rod();
  try {
    const { kode, ud } = await koer(d, opdaterScript());
    assert.equal(kode, 0, ud);
    assert.equal(readFileSync(join(d, 'app', 'server.js'), 'utf8'), '// ny server\n');

    // Alt midlertidigt skal vaere vaek - ogsaa laasen.
    const rester = readdirSync(d).filter((n) => n !== 'app');
    assert.deepEqual(rester, [], `rester i arbejdsmappen: ${rester.join(', ')}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('filer, der er slettet i den nye udgave, bliver ikke liggende', async () => {
  // Det var dét, `rm -rf app` var der for. Naar den gamle mappe FLYTTES vaek
  // i stedet for at slettes, skal egenskaben stadig holde - ellers har vi
  // byttet én fejl for en anden (Beanledger v30).
  const d = rod();
  try {
    const { kode, ud } = await koer(d, opdaterScript());
    assert.equal(kode, 0, ud);
    assert.equal(existsSync(join(d, 'app', 'skal-vaek.js')), false,
      'en fil, der ikke er med i den nye udgave, laa der stadig');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('/tmp roeres ikke', async () => {
  const d = rod();
  try {
    await koer(d, opdaterScript());
    assert.equal(existsSync('/tmp/doda-hent'), false,
      'scriptet brugte stadig en fast sti i /tmp - to samtidige koersler ville dele den');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('et ufuldstaendigt arkiv byttes IKKE ind', async () => {
  const d = rod();
  const rigtigt = arkiv;
  arkiv = byggArkiv({ 'app/laesmig.txt': 'ingen server.js her\n' });
  try {
    const { kode, ud } = await koer(d, opdaterScript());
    assert.notEqual(kode, 0, 'scriptet skulle vaere faldet');
    assert.match(ud, /ingen app\/server\.js/);
    // Det vigtige: den gamle app er urوert, ikke halvt slettet.
    assert.equal(readFileSync(join(d, 'app', 'server.js'), 'utf8'), '// gammel server\n');
  } finally {
    arkiv = rigtigt;
    rmSync(d, { recursive: true, force: true });
  }
});

test('to samtidige opdateringer: praecis én kommer igennem', async () => {
  /* Andreas trykkede paa knappen to gange med otte sekunders mellemrum.
     Forsinkelsen paa serveren er det, der goer prøven aegte: uden den er
     hentningen saa hurtig, at de to koersler kan naa at gaa fri af hinanden,
     og prøven bestaar ved et tilfaelde - ogsaa uden en laas. */
  const d = rod();
  forsinkelseMs = 600;
  try {
    const s = opdaterScript();
    const [a, b] = await Promise.all([koer(d, s), koer(d, s)]);
    const gode = [a, b].filter((r) => r.kode === 0);
    const daarlige = [a, b].filter((r) => r.kode !== 0);

    assert.equal(gode.length, 1, `forventede én igennem, fik ${gode.length}\n${a.ud}\n---\n${b.ud}`);
    assert.equal(daarlige.length, 1);
    // Taberen skal falde paa LAASEN - ikke paa en fil, den anden lige flyttede.
    assert.match(daarlige[0].ud, /en anden opdatering er allerede i gang/);
    assert.doesNotMatch(daarlige[0].ud, /mv:|tar:|No such file/,
      'taberen naaede ind i selve udskiftningen - saa holdt laasen ikke');

    // Og app/ skal vaere HEL bagefter - ikke en blanding af to koersler.
    assert.equal(readFileSync(join(d, 'app', 'server.js'), 'utf8'), '// ny server\n');
    assert.deepEqual(readdirSync(d).filter((n) => n !== 'app'), []);
  } finally {
    forsinkelseMs = 0;
    rmSync(d, { recursive: true, force: true });
  }
});

test('laasen frigives, ogsaa naar hentningen fejler', async () => {
  /* En fejlet hentning er den ALMINDELIGE fejl - nettet blinker, taggen
     mangler. Overlever laasen den, er knappen doed for altid. */
  const d = rod();
  const rigtigt = arkiv;
  arkiv = byggArkiv({ 'app/laesmig.txt': 'ingen server.js\n' });
  try {
    const foerste = await koer(d, opdaterScript());
    assert.notEqual(foerste.kode, 0);
    assert.equal(existsSync(join(d, '.doda-laas')), false, 'laasen overlevede en fejlet koersel');

    arkiv = rigtigt;
    const anden = await koer(d, opdaterScript());
    assert.equal(anden.kode, 0, `knappen var doed efter en fejl:\n${anden.ud}`);
  } finally {
    arkiv = rigtigt;
    rmSync(d, { recursive: true, force: true });
  }
});

/* --------------------------------------------------------------- startup */

test('startup rydder en strandet laas', async () => {
  // trap'en naar ikke at koere ved et haardt drab.
  const d = rod();
  try {
    mkdirSync(join(d, '.doda-laas'));
    mkdirSync(join(d, '.doda-ny'));
    // Kun de foerste linjer: resten starter en server, vi ikke vil have.
    const start = scriptFraRunen('startup').split('node app/kilde.js')[0];
    const { ud } = await koer(d, start);
    assert.match(ud, /strandet opdateringslaas er ryddet/);
    assert.equal(existsSync(join(d, '.doda-laas')), false);
    assert.equal(existsSync(join(d, '.doda-ny')), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('startup saetter app/ tilbage, hvis en udskiftning blev afbrudt', async () => {
  const d = rod();
  try {
    // Praecis tilstanden mellem de to omdoebninger.
    spawnSync('mv', [join(d, 'app'), join(d, '.doda-gammel')]);
    const start = scriptFraRunen('startup').split('node app/kilde.js')[0];
    const { ud } = await koer(d, start);
    assert.match(ud, /sat tilbage efter en afbrudt udskiftning/);
    assert.equal(readFileSync(join(d, 'app', 'server.js'), 'utf8'), '// gammel server\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/* ------------------------------------------------- kan prøven overhovedet fejle? */

test('SABOTAGE: uden laasen griber de to koersler ind i hinanden', async () => {
  /* Uden den her ved vi ikke, om samtidigheds-prøven ovenfor maaler noget.
     Her fjernes laasen fra det UDGIVNE script - ikke fra en afskrift - og
     saa skal den maling, prøven bygger paa, aendre sig. */
  const d = rod();
  forsinkelseMs = 600;
  try {
    const uden = opdaterScript()
      .replace(/if ! mkdir \.doda-laas[\s\S]*?\nfi\n/, '')
      .replace(/^trap .*\n/m, '');
    assert.ok(!uden.includes('.doda-laas'), 'sabotagen ramte ikke laasen');

    const [a, b] = await Promise.all([koer(d, uden), koer(d, uden)]);

    // Ingen af dem kan naevne laasen - den findes ikke laengere.
    assert.equal([a, b].filter((r) => /allerede i gang/.test(r.ud)).length, 0);

    /* Og de GREB ind i hinandens filer: den ene fejler paa en sti, den anden
       lige har flyttet (maalt: »mv: rename app to .doda-gammel: No such file
       or directory«).
       At app/ i praecis DEN fletning endte hel, er ikke en beroligelse - det
       er en anden raekkefoelge. Naar de to koersler kan se hinandens
       midlertidige mapper, er skaden et spoergsmaal om timing, ikke om held.
       Det er dét, laasen fjerner, og dét, prøven ovenfor maaler. */
    assert.ok([a, b].some((r) => r.kode !== 0 && /mv:|tar:|No such file/.test(r.ud)),
      'uden laas skulle de to koersler kollidere paa filsystemet - goer de '
      + 'ikke det, maaler samtidigheds-prøven ovenfor noget andet, end den tror');
  } finally {
    forsinkelseMs = 0;
    rmSync(d, { recursive: true, force: true });
  }
});
