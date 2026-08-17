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

test('billeder bliver til LINKS — dodas CSP tillader ikke fremmede billeder', () => {
  // img-src 'self' data: betyder, at et <img> mod Notions S3 ville vaere
  // tomt. Et link er aerligt; et blokeret billede ligner en fejl.
  assert.equal(md('image', { file: { url: 'https://s3/x.png' }, caption: rt('foto') }),
    '[foto](https://s3/x.png)');
  assert.equal(md('image', { external: { url: 'https://e/y.png' } }), '[image](https://e/y.png)');
  assert.equal(md('image', {}), '(image)');
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
