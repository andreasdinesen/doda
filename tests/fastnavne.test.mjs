/*
 * Et fast placeret element maa ikke hedde noget, nogen kan komme til at
 * genbruge.
 *
 * Baggrunden (18-09-2026): klassen `.hint` var `position: fixed` og tegnede
 * maerket »A · type to capture« i skaermens nederste hoejre hjoerne. Men
 * `hint` er et almindeligt ord, saa den blev naturligt grebet to steder mere
 * som underetiket inde i en <label>:
 *
 *   - loginruden, hjaelpeteksten til totrinskoden
 *   - gennemgangens indstillinger, teksten om push
 *
 * Begge steder blev teksten revet ud af sin rude og tegnet nede i hjoernet -
 * den anden af dem 799 px bred, tvaers over bunden af Review-siden, oven i
 * det rigtige maerke. Intet fejlede. Markupen saa rigtig ud. Den eneste maade
 * at opdage det paa var at kigge.
 *
 * Proeven er BEVIDST smal: der findes ingen generel maade at maale »den her
 * klasse betyder to ting«. Men reglen bagved kan skrives ned, og det er den,
 * der staar her - saa den naeste faste klasse ikke faar et navn af samme
 * slags.
 *
 *   node --test tests/fastnavne.test.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Ord, der er for almindelige til at baere et `position: fixed`.
 *
 * Kriteriet er ikke smag: det er, om nogen kan finde paa at skrive ordet i
 * en <label> uden foerst at slaa op, hvad det goer. `.modal`, `.sidebar` og
 * `.lightbox` staar med vilje IKKE her - de navngiver en bestemt ting, og
 * skriver man dem, mener man dem.
 */
const FOR_GENERISKE = ['hint', 'label', 'note', 'text', 'box', 'small', 'info', 'tip', 'help'];

/**
 * Klasserne i hver CSS-regel, der saetter `position: fixed`.
 *
 * KOMMENTARERNE SKAL VAEK FOERST. Reglens »selektor« er her alt mellem den
 * forrige `}` og den naeste `{` - altsaa ogsaa den kommentarblok, der staar
 * over reglen. Uden strimlingen blev `.fieldhint`, naevnt i kommentaren over
 * `.capturehint`, laest som en del af DEN regels selektor, og proeven
 * paastod, at den nye klasse var fast placeret. Den fejl fandt proeven selv,
 * foerste gang den koerte - i sig selv, ikke i CSS'en.
 */
function fasteKlasser(raaCss) {
  const css = raaCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const ud = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/position:\s*fixed/.test(m[2])) continue;
    for (const k of m[1].matchAll(/\.([A-Za-z][\w-]*)/g)) ud.add(k[1]);
  }
  return ud;
}

test('ingen fast placeret klasse hedder noget for almindeligt', () => {
  const css = readFileSync(join(ROD, 'app/public/style.css'), 'utf8');
  const fundne = [...fasteKlasser(css)].filter((k) => FOR_GENERISKE.includes(k.toLowerCase()));
  assert.deepEqual(fundne, [],
    `»${fundne.join(', ')}« er fast placeret og hedder noget, der bliver genbrugt. `
    + 'Giv den et navn, der siger hvad den ER (som .capturehint), og lav en egen '
    + 'klasse til det, den blev forvekslet med (som .fieldhint).');
});

test('klassen .hint findes ikke laengere - hverken i CSS eller i markupen', () => {
  /*
   * Den specifikke halvdel. Den fanger, at nogen skriver den gamle klasse
   * igen - fx ved at kopiere en linje fra en aeldre udgave af filen, hvilket
   * er praecis den vej, den anden forekomst kom ind ad.
   *
   * `\b` alene duer ikke: `.hintline`, `.filehint` og `.focushint` findes og
   * er helt i orden. Der maa altsaa matches paa hele klassenavnet.
   */
  const css = readFileSync(join(ROD, 'app/public/style.css'), 'utf8')
    // Kommentarerne NAEVNER `.hint` - det er hele forklaringen paa, hvorfor
    // den ikke maa komme igen. De skal derfor ikke taelle med som brug.
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.equal(/(^|[\s,>+~])\.hint(?![\w-])/m.test(css), false,
    'style.css definerer .hint igen - se kommentaren ved .capturehint');

  const js = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const brug = [...js.matchAll(/class="([^"]*)"/g)]
    .filter((m) => m[1].split(/\s+/).includes('hint'));
  assert.equal(brug.length, 0,
    `markupen bruger class="hint" ${brug.length} sted(er) - brug .fieldhint til en `
    + 'underetiket, eller .capturehint hvis du mener maerket i hjoernet');
});

test('underetiketterne bruger .fieldhint - og den er IKKE fast placeret', () => {
  // Uden den sidste halvdel ville proeven bestaa, hvis nogen gav .fieldhint
  // det samme `position: fixed` - altsaa flyttede fejlen med over i det nye navn.
  const css = readFileSync(join(ROD, 'app/public/style.css'), 'utf8');
  assert.ok(/\.fieldhint\s*[,{]/.test(css), 'style.css mangler .fieldhint');
  assert.equal(fasteKlasser(css).has('fieldhint'), false,
    '.fieldhint er blevet fast placeret - saa er fejlen flyttet, ikke rettet');

  /*
   * `.field span` (0-1-1) saetter font-weight og font-size paa ALT inde i en
   * etiket og slaar et bart `.fieldhint` (0-1-0). Foerste udgave af rettelsen
   * gjorde netop det: kun `color` slog igennem, og teksten var stadig fed og
   * lige saa stor som etiketten over den. Selektoren SKAL derfor vaere mindst
   * lige saa specifik - det opdages ellers kun ved at maale i en browser.
   */
  assert.ok(/\.field\s+\.fieldhint\s*[,{]/.test(css),
    'CSS\'en mangler `.field .fieldhint` - uden den vinder `.field span`, '
    + 'og hjaelpeteksten bliver fed og lige saa stor som sin egen etiket');

  const js = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const antal = [...js.matchAll(/class="([^"]*)"/g)]
    .filter((m) => m[1].split(/\s+/).includes('fieldhint')).length;
  assert.equal(antal, 2, 'de to underetiketter (login-koden og gennemgangens push) skal bruge .fieldhint');
});
