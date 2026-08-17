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
  const b1 = { type: 'image', id: '3bf981dd-94e6-802d-9dda-ee087333dc17', image: { file: { url: signeret } } };
  const ud = N.blokTilMd(b1, 0);
  assert.equal(ud, '[🖼 image](https://www.notion.so/3bf981dd94e6802d9ddaee087333dc17)');
  assert.ok(!ud.includes('amazonaws'), 'den signerede adresse må ikke stå der');
  assert.ok(ud.length < 100, `skal være kort, var ${ud.length} tegn`);

  // Billedteksten bruges som navn, når der er en.
  b1.image.caption = rt('Grønne hatte');
  assert.match(N.blokTilMd(b1, 0), /^\[Grønne hatte\]/);

  // Uden id er der ikke noget at pege på - så siges det bare.
  assert.equal(md('image', {}), '*(🖼 image)*');
});

test('lange bogmærke-adresser vises kort og peger på blokken', () => {
  // Dodas linkify stopper ved 500 tegn: en længere adresse ville blive
  // halvt til et link og halvt til rå tekst midt i teksten.
  const kort = { type: 'bookmark', id: 'aaaabbbbccccddddeeeeffff00001111', bookmark: { url: 'https://dr.dk/nyheder' } };
  assert.equal(N.blokTilMd(kort, 0), '[dr.dk/nyheder](https://dr.dk/nyheder)');

  const lang = { type: 'bookmark', id: 'aaaabbbbccccddddeeeeffff00001111', bookmark: { url: `https://e.dk/${'y'.repeat(400)}` } };
  const ud = N.blokTilMd(lang, 0);
  assert.match(ud, /…\]\(https:\/\/www\.notion\.so\//);
  assert.ok(ud.length < 140, `skal være kort, var ${ud.length} tegn`);
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
