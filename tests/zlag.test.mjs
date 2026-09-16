/*
 * z-index-lagene staar ét sted: kommentarblokken oeverst i style.css.
 *
 * Proeven laeser hver `z-index:` i filen, finder den regel, den staar i, og
 * kraever, at blokken naevner netop den klasse med netop den vaerdi. Et nyt lag,
 * et flyttet lag eller en blok, der er skredet fra CSS'en, goer den roed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROD, 'app/public/style.css'), 'utf8');

const blokStart = css.indexOf('/* z-index-lagene');
const blokSlut = css.indexOf('*/', blokStart);
const blok = css.slice(blokStart, blokSlut);
const resten = css.slice(0, blokStart) + css.slice(blokSlut);

/** klasse -> vaerdi, som blokken siger. */
function dokumenteret() {
  const kort = new Map();
  for (const m of blok.matchAll(/^\s+(\d+)\s+(\.[\w-]+(?:,\s*\.[\w-]+)*)\s/gm)) {
    for (const k of m[2].split(/,\s*/)) kort.set(k, Number(m[1]));
  }
  return kort;
}

/** [{klasse, vaerdi, linje}] for hver z-index i selve CSS'en. */
function brugt() {
  const linjer = resten.split('\n');
  const ud = [];
  linjer.forEach((l, i) => {
    const m = l.match(/z-index:\s*(\d+)/);
    if (!m) return;
    let j = i;
    while (j >= 0 && !linjer[j].includes('{')) j--;
    const vaelger = linjer[j].slice(0, linjer[j].indexOf('{'));
    const klasser = vaelger.match(/\.[\w-]+/g) || [];
    ud.push({ klasse: klasser[klasser.length - 1], vaerdi: Number(m[1]), linje: i + 1 });
  });
  return ud;
}

test('blokken findes og naevner tolv forskellige vaerdier', () => {
  assert.ok(blokStart >= 0, 'z-index-blokken mangler i style.css');
  assert.equal(new Set(dokumenteret().values()).size, 12);
});

test('hver z-index i style.css staar i blokken med samme vaerdi', () => {
  const doc = dokumenteret();
  const brud = brugt()
    .filter((b) => doc.get(b.klasse) !== b.vaerdi)
    .map((b) => `${b.klasse} = ${b.vaerdi} (l. ${b.linje}), blokken siger ${doc.get(b.klasse)}`);
  assert.deepEqual(brud, []);
});

test('blokken naevner intet lag, CSS\'en ikke har', () => {
  const brugte = new Set(brugt().map((b) => `${b.klasse}=${b.vaerdi}`));
  const overskud = [...dokumenteret()].map(([k, v]) => `${k}=${v}`).filter((x) => !brugte.has(x));
  assert.deepEqual(overskud, []);
});
