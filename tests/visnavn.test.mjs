/* Brugernavnet VISES med stort begyndelsesbogstav, men navnet selv er uroert:
   det er det, man logger ind med, og noeglen i databasen.

   Denne fil vogter to ting: at pyntningen goer det rigtige, og - vigtigere -
   at den kun bruges dér, hvor der TEGNES. Slap den ind i et API-kald, ville
   doda sende et navn, brugeren aldrig har oprettet, og login ville fejle paa
   en maade, der ikke pegede paa aarsagen. */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const fil = (...d) => readFileSync(join(ROD, ...d), 'utf8');

/* Funktionen hentes ud af kilden frem for at blive skrevet af her - ellers
   proever vi en kopi, og kopien kan holde op med at ligne originalen. */
const kilde = fil('app', 'parts', 'p1_core.js');
const linje = kilde.match(/^const visNavn = .+;$/m);
assert.ok(linje, 'visNavn skal findes i p1_core.js');
// eslint-disable-next-line no-new-func
const visNavn = new Function(`${linje[0]} return visNavn;`)();

test('foerste bogstav bliver stort - og resten roeres ikke', () => {
  assert.equal(visNavn('andreas'), 'Andreas');
  assert.equal(visNavn('Andreas'), 'Andreas');
  assert.equal(visNavn('anna-lise'), 'Anna-lise', 'kun foerste ord, ikke capitalize');
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

/* Den egentlige regel. Hver gang visNavn bruges, skal det staa inde i esc(),
   altsaa i noget, der bliver til HTML. Dukker den op et andet sted, er den
   paa vej ind i data. */
test('visNavn bruges KUN til at tegne - aldrig til at sende', () => {
  const filer = ['p1_core.js', 'p3_lists.js', 'p8_review.js'];
  let fundet = 0;
  for (const f of filer) {
    const t = fil('app', 'parts', f);
    for (const m of t.matchAll(/visNavn\(/g)) {
      // Selve definitionen taeller ikke med.
      if (/^const visNavn = /.test(t.slice(t.lastIndexOf('\n', m.index) + 1))) continue;
      fundet += 1;
      const foer = t.slice(Math.max(0, m.index - 4), m.index);
      assert.equal(foer, 'esc(', `visNavn( i ${f} stod uden esc( foran: "${foer}"`);
    }
  }
  assert.equal(fundet, 4, 'de fire visninger af brugernavnet skal alle vaere med');
});
