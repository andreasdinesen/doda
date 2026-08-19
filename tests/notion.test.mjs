/* Notion-blokke -> markdown. Konverteren er ren, saa den kan testes uden at
   roere nettet. Koer: node --test tests/notion.test.mjs */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const N = require('../app/notion.js');

const rt = (s, a = {}, href = null) => [{ plain_text: s, annotations: a, href }];
const md = (type, v, dybde = 0) => N.blokTilMd({ type, [type]: v }, dybde);

test('overskrifter, lister og citater bliver til dodas egen markdown', () => {
  assert.equal(md('heading_1', { rich_text: rt('En') }), '# En');
  assert.equal(md('heading_2', { rich_text: rt('To') }), '## To');
  assert.equal(md('heading_3', { rich_text: rt('Tre') }), '### Tre');
  assert.equal(md('bulleted_list_item', { rich_text: rt('punkt') }), '- punkt');
  assert.equal(md('numbered_list_item', { rich_text: rt('nummer') }), '1. nummer');
  assert.equal(md('quote', { rich_text: rt('citat') }), '> citat');
  assert.equal(md('divider', {}), '---');
});

test('afkrydsning vises som tilstand, ikke som markdown doda ikke kan', () => {
  assert.equal(md('to_do', { rich_text: rt('gjort'), checked: true }), '- ☑ gjort');
  assert.equal(md('to_do', { rich_text: rt('ikke endnu'), checked: false }), '- ☐ ikke endnu');
});

test('annoteringer: kode vinder over fed, og links pakkes udenom', () => {
  assert.equal(N.tekst(rt('fed', { bold: true })), '**fed**');
  assert.equal(N.tekst(rt('skrå', { italic: true })), '*skrå*');
  // `**x**` inde i kode ville vaere forkert - kode er raa tekst.
  assert.equal(N.tekst(rt('kode', { code: true, bold: true })), '`kode`');
  assert.equal(N.tekst(rt('doda', {}, 'https://dr.dk')), '[doda](https://dr.dk)');
});

test('indlejring rykkes ind — men kun to niveauer, som dodas renderer kan vise', () => {
  assert.equal(md('bulleted_list_item', { rich_text: rt('barn') }, 1), '  - barn');
  assert.equal(md('bulleted_list_item', { rich_text: rt('dybt') }, 5), '    - dybt');
});

test('billeder peger på BLOKKEN i Notion — aldrig på filens egen adresse', () => {
  // To grunde. Dodas CSP (img-src 'self') gør, at billedet ikke kan vises.
  // Og Notions fil-adresser er signerede: de udløber efter en time og er
  // ~1500 tegn, så linket både dør og fylder hele ruden.
  const signeret = `https://prod-files-secure.s3.us-west-2.amazonaws.com/x?${'X'.repeat(1400)}`;
  const SIDE = '3bf981dd-94e6-802d-9dda-ee087333dc17';
  const BLOK = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
  const b1 = { type: 'image', id: BLOK, image: { file: { url: signeret } } };
  const ud = N.blokTilMd(b1, 0, SIDE);

  // SIDENS id med blokken som ANKER. Kun blok-id'et duer ikke: Notion
  // prøver da at åbne blokken som en side og viser en tom "Untitled".
  // Det var præcis den fejl, v21 havde.
  assert.equal(ud, '[🖼 image](https://www.notion.so/3bf981dd94e6802d9ddaee087333dc17'
    + '#aaaabbbbccccddddeeeeffff00001111)');
  assert.match(ud, /#/, 'uden anker aabner Notion en tom side');
  assert.ok(!ud.includes('amazonaws'), 'den signerede adresse må ikke stå der');
  assert.ok(ud.length < 130, `skal være kort, var ${ud.length} tegn`);

  // Billedteksten bruges som navn, når der er en.
  b1.image.caption = rt('Grønne hatte');
  assert.match(N.blokTilMd(b1, 0, SIDE), /^\[Grønne hatte\]/);

  // Uden noget at pege ind i er et link værre end ingenting.
  assert.equal(N.blokTilMd({ type: 'image', image: {} }, 0, null), '*(🖼 image)*');
});

test('lange bogmærke-adresser vises kort og peger på blokken', () => {
  // Dodas linkify stopper ved 500 tegn: en længere adresse ville blive
  // halvt til et link og halvt til rå tekst midt i teksten.
  const kort = { type: 'bookmark', id: 'aaaabbbbccccddddeeeeffff00001111', bookmark: { url: 'https://dr.dk/nyheder' } };
  assert.equal(N.blokTilMd(kort, 0), '[dr.dk/nyheder](https://dr.dk/nyheder)');

  const lang = { type: 'bookmark', id: 'aaaabbbbccccddddeeeeffff00001111', bookmark: { url: `https://e.dk/${'y'.repeat(400)}` } };
  const ud = N.blokTilMd(lang, 0, '3bf981dd94e6802d9ddaee087333dc17');
  // Det, der tæller, er HREF'en: visningsteksten må gerne vise starten af
  // adressen (den er jo forkortet), men selve linket skal pege på Notion.
  const href = ud.slice(ud.lastIndexOf('](') + 2, -1);
  assert.match(href, /^https:\/\/www\.notion\.so\/[0-9a-f]{32}#[0-9a-f]{32}$/);
  // 22 tegn vaert + 32 side + 1 anker + 32 blok = 87. Det er hele prisen,
  // og den er fast - modsat de 400+, den erstatter.
  assert.equal(href.length, 87);
  assert.ok(ud.length < 180, `hele linjen skal være kort, var ${ud.length} tegn`);
});

test('det doda ikke kan vise, siger den ærligt — den lader ikke som ingenting', () => {
  assert.match(md('table', {}), /open it in Notion/);
  assert.match(md('column_list', {}), /open it in Notion/);
  assert.equal(md('child_page', { title: 'Underside' }), '**Underside** (subpage)');
});

test('ukendte bloktyper mister ikke deres tekst', () => {
  // En bloktype, Notion tilføjer i morgen, skal ikke blive til ingenting.
  assert.equal(md('noget_helt_nyt', { rich_text: rt('vigtig tekst') }), 'vigtig tekst');
});

test('id kan trækkes ud af en Notion-adresse, og kun derfra', () => {
  assert.equal(N.idFraUrl('https://www.notion.so/Doda-app-projekt-3bf981dd94e6802d9ddaee087333dc17'),
    '3bf981dd94e6802d9ddaee087333dc17');
  assert.equal(N.idFraUrl('https://www.notion.so/x-3bf981dd94e6802d9ddaee087333dc17?pvs=4'),
    '3bf981dd94e6802d9ddaee087333dc17');
  assert.equal(N.idFraUrl('https://dr.dk/nyheder'), null);
  assert.equal(N.idFraUrl(''), null);
});

/* ------------------------------------------------- kommentar-ruterne (v34)

   Selve kaldet ud til Notion kan ikke testes uden et rigtigt token, men
   VAGTERNE kan: rækkefølgen af tjek afgør, hvilken besked brugeren får, og
   den er let at bytte rundt på uden at opdage det. Uden en forbindelse skal
   svaret pege på Settings - ikke på linket, og slet ikke på et tomt felt. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after } from 'node:test';

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
  return { status: r.status, data: await r.json() };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-notionkom-'));
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

const NOTION_URL = 'https://www.notion.so/En-side-1234567890abcdef1234567890abcd';

test('uden en Notion-forbindelse peger begge ruter paa Settings', async () => {
  const laes = await J(`/api/v1/notion/comments?url=${encodeURIComponent(NOTION_URL)}`);
  assert.equal(laes.status, 400);
  assert.equal(laes.data.error, 'not_connected');

  const skriv = await J('/api/v1/notion/comment', { url: NOTION_URL, text: 'hej' });
  assert.equal(skriv.status, 400);
  assert.equal(skriv.data.error, 'not_connected');
});

test('at oprette en side kraever ogsaa en forbindelse, en foraelder og et navn', async () => {
  const uden = await J('/api/v1/notion/page', { parent: NOTION_URL, title: 'Ny' });
  assert.equal(uden.data.error, 'not_connected');
});

test('forbindelsen tjekkes FOER linket og teksten', async () => {
  // Ellers ville en bruger uden forbindelse faa at vide, at hans link er
  // forkert - og lede det helt forkerte sted.
  const daarligtLink = await J('/api/v1/notion/comment', { url: 'https://dr.dk', text: 'hej' });
  assert.equal(daarligtLink.data.error, 'not_connected');
  const udenTekst = await J('/api/v1/notion/comment', { url: NOTION_URL, text: '   ' });
  assert.equal(udenTekst.data.error, 'not_connected');
});
