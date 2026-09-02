/*
 * F21 - en vagt mod navne, der ikke findes.
 *
 * doda har ingen frontend-tests: app.js kraever en browser. Det betyder, at en
 * sidefunktion kan referere til en variabel, der ikke eksisterer, uden at
 * NOGET opdager det - hverken `node --check` (det er gyldig syntaks) eller de
 * 263 andre tests (de proever serveren og parseren).
 *
 * Det skete i v60: en erstatning i `sideNoter()` slugte linjen `const hoved =
 * ...`, mens tre `${hoved}` blev staaende. Siden kastede ReferenceError og
 * blev aldrig tegnet - man trykkede paa »Notes«, og der skete ingenting.
 * Bygningen var groen, testene var groenne, og fejlen naaede telefonen.
 *
 * Kontrollen er GROV med vilje: den leder efter navne, der bruges i en
 * `${...}` og ikke optraeder ét eneste andet sted i filen. Et navn, der
 * hverken er deklareret, importeret eller er en parameter, KAN ikke findes.
 * Den fanger ikke alt - men den fanger netop dét, der skete, og den koster
 * ingenting.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Browser-globale, Node ikke kender. Standard-JS (encodeURIComponent, JSON,
   Math ...) filtreres af `globalThis` selv, saa listen her bliver ikke lang. */
const BROWSER = new Set(['document', 'window', 'location', 'navigator', 'localStorage',
  'sessionStorage', 'history', 'CSS', 'Notification', 'IntersectionObserver']);

test('ingen sidefunktion bruger et navn, der ikke findes', () => {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');

  const brugt = new Map();
  for (const m of kode.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\b/g)) {
    brugt.set(m[1], (brugt.get(m[1]) || 0) + 1);
  }

  const doede = [];
  for (const [navn, iTemplates] of brugt) {
    if (BROWSER.has(navn) || typeof globalThis[navn] !== 'undefined') continue;
    const ialt = (kode.match(new RegExp(`\\b${navn}\\b`, 'g')) || []).length;
    // Optraeder navnet KUN inde i ${...}, er det hverken deklareret eller
    // parameter noget sted - saa kaster siden, i det oejeblik den tegnes.
    if (ialt <= iTemplates) doede.push(`${navn} (brugt ${iTemplates} gange, aldrig defineret)`);
  }

  assert.deepEqual(doede, [], 'navne uden nogen definition i app.js');
});

test('vagten kan faktisk se en fejl - ellers beviser den ingenting', () => {
  /*
   * Uden denne ville testen ovenfor bestaa, selv hvis moensteret var forkert
   * skrevet og aldrig fandt noget. En groen test, der ikke KAN blive roed,
   * er en test, der lyver (RUNE-ERFARINGER, doda v56).
   */
  const kode = 'function side() { return `<h1>${forsvundet}</h1>`; }';
  const brugt = [...kode.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]);
  assert.deepEqual(brugt, ['forsvundet']);
  const ialt = (kode.match(/\bforsvundet\b/g) || []).length;
  assert.equal(ialt, 1, 'navnet staar kun i sin egen template - altsaa udefineret');
});

test('kun filnavne, et menneske ville skrive, foreslås som titel', () => {
  /*
   * »Når jeg dropper et billede og skriver en tekst, står filnavnet der
   * stadig« (Andreas, 02-09-2026). Navnet indsættes markeret, så det man
   * skriver erstatter det — men klikker man i feltet i stedet for bare at
   * taste, ophæves markeringen, og id'et blev stående i titlen.
   *
   * En markering, ét klik kan ophæve, er ikke et værn. Det rigtige er ikke at
   * foreslå et navn, ingen ville skrive: »352CCE7E-8578-4F56-…« er hvad en
   * iPhone kalder et foto, og det er aldrig en titel.
   *
   * Funktionen er ren og bor i frontenden. Den hentes derfor UD af kilden og
   * køres her — så reglerne kan låses fast uden en browser.
   */
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const start = kode.indexOf('function menneskeligtFilnavn');
  assert.ok(start > 0, 'funktionen findes i den byggede app.js');
  const slut = kode.indexOf('\nfunction ', start + 10);
  // eslint-disable-next-line no-new-func
  const menneskeligt = new Function(`${kode.slice(start, slut)}; return menneskeligtFilnavn;`)();

  for (const n of [
    '352CCE7E-8578-4F56-BDBB-CDC14373DA19_1_105_c.jpg',   // iPhone-foto
    'E11FD04A-FD2E-45C0-99C4-6EC09CA3BAA2_4_5005_c.heic',
    'IMG_4821.jpg', 'DSC00123.JPG', 'PXL_20260902_184512.jpg',
    'Screenshot 2026-09-02 at 21.42.png', 'Skærmbillede 2026-09-02.png',
    'a1.png',                                              // for kort til at sige noget
    '20260902.pdf',                                        // rene tal
  ]) assert.equal(menneskeligt(n), false, `${n} burde springes over`);

  for (const n of [
    'faktura-2026.pdf', 'Kontrakt med Toni.docx', 'noter fra mødet.md',
    'Årsregnskab.xlsx', 'tilbud fra Aagaard.pdf',
  ]) assert.equal(menneskeligt(n), true, `${n} er et brugbart forslag`);
});
