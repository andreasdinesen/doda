/* Brugernavnet VISES med stort begyndelsesbogstav, men navnet selv er uroert:
   det er det, man logger ind med, og noeglen i databasen.

   Reglen bor i `app/shared/parse.js`, fordi den skal gaelde BEGGE flader -
   ogsaa de sider, SERVEREN tegner (samtykkesiden til en connector). Stod den
   kun i frontenden, ville appen sige »Andreas« og samtykkesiden »andreas« om
   den samme konto.

   Denne fil vogter tre ting: at pyntningen goer det rigtige, at den kun
   bruges dér, hvor der TEGNES, og at serveren faktisk bruger den. */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const fil = (...d) => readFileSync(join(ROD, ...d), 'utf8');
const require = createRequire(import.meta.url);
const { visNavn } = require(join(ROD, 'app', 'shared', 'parse.js'));

test('foerste bogstav bliver stort - og resten roeres ikke', () => {
  assert.equal(visNavn('andreas'), 'Andreas');
  assert.equal(visNavn('Andreas'), 'Andreas');
  assert.equal(visNavn('anna-lise'), 'Anna-lise', 'kun foerste tegn, ikke capitalize');
  assert.equal(visNavn('andreas dinesen'), 'Andreas dinesen');
  assert.equal(visNavn('æblegrød'), 'Æblegrød');
  assert.equal(visNavn('a'), 'A');
});

test('et navn uden bogstav i front braekker ikke', () => {
  assert.equal(visNavn('2pac'), '2pac');
  assert.equal(visNavn(''), '');
  assert.equal(visNavn(null), '');
  assert.equal(visNavn(undefined), '');
});

/* Den egentlige regel. Hver gang visNavn bruges, skal det staa inde i en
   escape - altsaa i noget, der bliver til HTML. Dukker den op et andet sted,
   er den paa vej ind i data, og saa sender doda et navn, brugeren aldrig har
   oprettet. */
test('visNavn bruges KUN til at tegne - aldrig til at sende', () => {
  const steder = [
    ['app', 'parts', 'p1_core.js'], ['app', 'parts', 'p3_lists.js'],
    ['app', 'parts', 'p8_review.js'], ['app', 'server.js'],
  ];
  let fundet = 0;
  for (const sti of steder) {
    const t = fil(...sti);
    for (const m of t.matchAll(/visNavn\(/g)) {
      const linje = t.slice(t.lastIndexOf('\n', m.index) + 1, m.index + 40);
      // Definitionen og fallback'en i p1_core taeller ikke med.
      if (/const visNavn|dodaParse\.visNavn|visNavn,$/.test(linje)) continue;
      fundet += 1;
      // Kaldet kan vaere `esc(visNavn(` eller `escHtml(parse.visNavn(` - det
      // afgoerende er, at en escape omslutter det.
      const foer = t.slice(Math.max(0, m.index - 24), m.index);
      assert.match(foer, /(esc|escHtml)\((parse\.)?$/,
        `visNavn( i ${sti.join('/')} stod uden escape foran: "${foer}"`);
    }
  }
  assert.ok(fundet >= 5, `forventede mindst 5 visninger, fandt ${fundet}`);
});

/* Samtykkesiden tegnes af SERVEREN. Den blev glemt, da reglen kom til i v41,
   saa appen sagde »Andreas« og samtykkesiden »andreas«. */
test('ogsaa siderne, serveren tegner, viser navnet med stort', () => {
  const s = fil('app', 'server.js');
  assert.match(s, /Signed in as <strong>\$\{escHtml\(parse\.visNavn\(/,
    'samtykkesiden skal bruge den delte regel');
});

test('reglen bor ét sted - i shared, saa begge flader deler den', () => {
  assert.match(fil('app', 'shared', 'parse.js'), /^\s*const visNavn = /m);
  // Frontenden maa gerne have en fallback, men ikke sin EGEN regel.
  const kerne = fil('app', 'parts', 'p1_core.js');
  assert.match(kerne, /dodaParse\.visNavn/, 'frontenden skal bruge den delte');
});
