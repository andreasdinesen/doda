/* Test af den faelles parser. Koer: node tests/parse.test.mjs
   Fast "nu" = torsdag den 13. august 2026 kl. 10:00 lokal tid. */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const P = require('../app/shared/parse.js');

const NU = new Date(2026, 7, 13, 10, 0, 0); // torsdag 13/8-2026
const dato = (s) => P.tolkDato(s, NU);
const fangst = (s) => P.tolkFangst(s, { now: NU });

/* Interfacet er engelsk, sa engelsk er det primaere sprog i parseren.
   Dansk skal blive ved med at virke - derfor testes begge. */

test('engelsk: relative dage', () => {
  assert.equal(dato('today').dato, '2026-08-13');
  assert.equal(dato('tomorrow').dato, '2026-08-14');
  assert.equal(dato('tmr').dato, '2026-08-14');
  assert.equal(dato('day after tomorrow').dato, '2026-08-15');
  assert.equal(dato('yesterday').dato, '2026-08-12');
});

test('engelsk: ugedage', () => {
  assert.equal(dato('thursday').dato, '2026-08-13', 'i dag, naar i dag er torsdag');
  assert.equal(dato('friday').dato, '2026-08-14');
  assert.equal(dato('monday').dato, '2026-08-17');
  assert.equal(dato('on monday').dato, '2026-08-17');
  assert.equal(dato('next monday').dato, '2026-08-24');
  assert.equal(dato('fri').dato, '2026-08-14');
  assert.equal(dato('sun').dato, '2026-08-16');
});

test('engelsk: uge, måned, weekend', () => {
  assert.equal(dato('next week').dato, '2026-08-20');
  assert.equal(dato('next month').dato, '2026-09-13');
  assert.equal(dato('weekend').dato, '2026-08-15');
  assert.equal(dato('end of month').dato, '2026-08-31');
  assert.equal(dato('start of next month').dato, '2026-09-01');
});

test('engelsk: in N tidsenheder', () => {
  assert.equal(dato('in 3 days').dato, '2026-08-16');
  assert.equal(dato('in two weeks').dato, '2026-08-27');
  assert.equal(dato('in a month').dato, '2026-09-13');
});

test('engelsk: månedsnavne i begge ordstillinger', () => {
  assert.equal(dato('sep 3').dato, '2026-09-03');
  assert.equal(dato('3 sep').dato, '2026-09-03');
  assert.equal(dato('december 24').dato, '2026-12-24');
  assert.equal(dato('24 december').dato, '2026-12-24');
  assert.equal(dato('march 3rd').dato, '2027-03-03', 'passeret i år, sa naeste aar');
});

test('engelsk: klokkeslæt med at og am/pm', () => {
  assert.deepEqual(dato('tomorrow at 8'), { dato: '2026-08-14', tid: '08:00' });
  assert.deepEqual(dato('tomorrow at 8pm'), { dato: '2026-08-14', tid: '20:00' });
  assert.deepEqual(dato('monday at 9:30'), { dato: '2026-08-17', tid: '09:30' });
  assert.deepEqual(dato('friday at 12am'), { dato: '2026-08-14', tid: '00:00' });
});

test('engelsk: gentagelse genkendes', () => {
  assert.ok(P.erGentagelse('every monday'));
  assert.ok(P.erGentagelse('every! 3 days'));
  const r = fangst('vacuum !every sunday');
  assert.equal(r.title, 'vacuum');
  assert.equal(r.recurrenceText, 'every sunday');
});

test('relative dage', () => {
  assert.equal(dato('i dag').dato, '2026-08-13');
  assert.equal(dato('idag').dato, '2026-08-13');
  assert.equal(dato('i morgen').dato, '2026-08-14');
  assert.equal(dato('imorgen').dato, '2026-08-14');
  assert.equal(dato('overmorgen').dato, '2026-08-15');
  assert.equal(dato('i overmorgen').dato, '2026-08-15');
});

test('ugedage', () => {
  // 13/8-2026 er en torsdag.
  assert.equal(dato('torsdag').dato, '2026-08-13', 'i dag, naar i dag er torsdag');
  assert.equal(dato('fredag').dato, '2026-08-14');
  assert.equal(dato('mandag').dato, '2026-08-17');
  assert.equal(dato('på mandag').dato, '2026-08-17');
  assert.equal(dato('næste mandag').dato, '2026-08-24', 'naeste = en uge senere');
  assert.equal(dato('søndag').dato, '2026-08-16');
  assert.equal(dato('fre').dato, '2026-08-14');
});

test('uge, måned, weekend', () => {
  assert.equal(dato('næste uge').dato, '2026-08-20');
  assert.equal(dato('næste måned').dato, '2026-09-13');
  assert.equal(dato('weekend').dato, '2026-08-15');
  assert.equal(dato('ultimo måneden').dato, '2026-08-31');
  assert.equal(dato('primo næste måned').dato, '2026-09-01');
});

test('om N tidsenheder', () => {
  assert.equal(dato('om 3 dage').dato, '2026-08-16');
  assert.equal(dato('om to uger').dato, '2026-08-27');
  assert.equal(dato('om en måned').dato, '2026-09-13');
  assert.equal(dato('om 2 måneder').dato, '2026-10-13');
});

test('eksplicitte datoer', () => {
  assert.equal(dato('3/9').dato, '2026-09-03');
  assert.equal(dato('3/9-2027').dato, '2027-09-03');
  assert.equal(dato('24/12/2026').dato, '2026-12-24');
  assert.equal(dato('3. september').dato, '2026-09-03');
  assert.equal(dato('24. dec').dato, '2026-12-24');
});

test('dato uden årstal, der allerede er passeret, rykker til næste år', () => {
  assert.equal(dato('1/2').dato, '2027-02-01');
  assert.equal(dato('1. feb').dato, '2027-02-01');
});

test('ugyldige datoer giver null i stedet for at gætte', () => {
  assert.equal(dato('31/2'), null);
  assert.equal(dato('40/1'), null);
  assert.equal(dato('på tirsdagsmøde'), null);
  assert.equal(dato('noget vrøvl her'), null);
});

test('klokkeslæt', () => {
  assert.deepEqual(dato('i morgen kl 8'), { dato: '2026-08-14', tid: '08:00' });
  assert.deepEqual(dato('i morgen kl. 8.30'), { dato: '2026-08-14', tid: '08:30' });
  assert.deepEqual(dato('mandag 14:30'), { dato: '2026-08-17', tid: '14:30' });
  assert.deepEqual(dato('kl 9'), { dato: '2026-08-13', tid: '09:00' }, 'bart klokkeslaet = i dag');
  assert.equal(dato('kl 25'), null, 'ugyldig time');
});

test('sommertid: en dato hen over skiftet forskydes ikke', () => {
  // Sommertiden slutter soendag 25. oktober 2026. Datoregning sker i lokal
  // tid netop for at undgaa, at det doegn bliver 23 eller 25 timer.
  const foer = new Date(2026, 9, 24, 12, 0, 0);
  assert.equal(P.tolkDato('om 2 dage', foer).dato, '2026-10-26');
  assert.equal(P.tolkDato('om 7 dage', foer).dato, '2026-10-31');
});

test('månedsskift klemmer dagen ned i stedet for at smutte over', () => {
  const d = new Date(2026, 0, 31, 12, 0, 0); // 31. januar
  assert.equal(P.tolkDato('om 1 måned', d).dato, '2026-02-28');
});

/* ------------------------------------------------------------- fangst */

test('bar tekst bliver en opgave i inbox', () => {
  const r = fangst('ring til lægen');
  assert.equal(r.kind, 'task');
  assert.equal(r.title, 'ring til lægen');
  assert.deepEqual(r.contexts, []);
  assert.equal(r.due, null);
});

test('præfikser', () => {
  assert.equal(fangst('+ køb mælk').kind, 'task');
  assert.equal(fangst('+ køb mælk').title, 'køb mælk');
  assert.equal(fangst('* kontonummer 1234').kind, 'note');
  assert.equal(fangst('* kontonummer 1234').title, 'kontonummer 1234');
});

test('kontekst, projekt og dato på én gang', () => {
  const r = fangst('ring til lægen #telefon @Sundhed !i morgen');
  assert.equal(r.title, 'ring til lægen');
  assert.deepEqual(r.contexts, ['telefon']);
  assert.equal(r.project, 'Sundhed');
  assert.deepEqual(r.due, { dato: '2026-08-14', tid: null });
});

test('flere kontekster, og dubletter tælles kun én gang', () => {
  const r = fangst('gør noget #hjem #computer #hjem');
  assert.deepEqual(r.contexts, ['hjem', 'computer']);
  assert.equal(r.title, 'gør noget');
});

test('projekt i anførselstegn kan indeholde mellemrum', () => {
  const r = fangst('mal skuret @"Sommerhus i Rørvig" #ude');
  assert.equal(r.project, 'Sommerhus i Rørvig');
  assert.deepEqual(r.contexts, ['ude']);
  assert.equal(r.title, 'mal skuret');
});

test('skjul indtil med ~', () => {
  const r = fangst('bestil dæk ~1/10 !15/10');
  assert.equal(r.defer, '2026-10-01');
  assert.deepEqual(r.due, { dato: '2026-10-15', tid: null });
  assert.equal(r.title, 'bestil dæk');
});

test('e-mail og URL bliver IKKE læst som projekt og kontekst', () => {
  const r = fangst('skriv til navn@eksempel.dk om https://dr.dk/nyheder#sport');
  assert.equal(r.project, null);
  assert.deepEqual(r.contexts, []);
  assert.equal(r.title, 'skriv til navn@eksempel.dk om https://dr.dk/nyheder#sport');
});

test('beskrivelse efter " // ", og URL i beskrivelsen overlever', () => {
  const r = fangst('bestil billetter #computer // se https://billetlugen.dk/x og husk rabatkoden');
  assert.equal(r.title, 'bestil billetter');
  assert.equal(r.note, 'se https://billetlugen.dk/x og husk rabatkoden');
  assert.deepEqual(r.contexts, ['computer']);
});

test('beskrivelse efter linjeskift', () => {
  const r = fangst('læs rapporten !fredag\nLigger i Teams.\nAndet afsnit er det vigtige.');
  assert.equal(r.title, 'læs rapporten');
  assert.equal(r.note, 'Ligger i Teams.\nAndet afsnit er det vigtige.');
  assert.deepEqual(r.due, { dato: '2026-08-14', tid: null });
});

test('link i selve titlen bevares', () => {
  const r = fangst('læs https://example.com/artikel?a=1&b=2 #computer');
  assert.equal(r.title, 'læs https://example.com/artikel?a=1&b=2');
  assert.deepEqual(r.contexts, ['computer']);
});

test('uforståelig dato blokerer aldrig fangsten', () => {
  const r = fangst('husk noget !på tirsdagsmøde');
  assert.equal(r.title, 'husk noget');
  assert.equal(r.due, null);
  assert.match(r.warnings[0], /forstod ikke datoen/);
});

test('gentagelse genkendes (motoren bygges i F4)', () => {
  const r = fangst('støvsug !hver søndag');
  assert.equal(r.title, 'støvsug');
  assert.equal(r.recurrenceText, 'hver søndag');
  assert.ok(r.warnings.includes('gentagelse'));

  const r2 = fangst('vand planterne !hver! 3. dag');
  assert.equal(r2.recurrenceText, 'hver! 3. dag');
});

test('tom og mærkelig inddata vælter ikke parseren', () => {
  assert.equal(fangst('').title, '');
  assert.equal(fangst(null).title, '');
  assert.equal(fangst(undefined).title, '');
  assert.equal(fangst('   ').title, '');
  assert.equal(fangst('+').kind, 'task');
  assert.deepEqual(fangst('#').contexts, []);
  assert.equal(fangst('!').due, null);
});

test('en markør uden værdi er almindelig tekst, ikke en tom kontekst', () => {
  // Vigtigt for live-visningen: mens man skriver "køb mælk #ha..." star der
  // et oejeblik bare "#". Det ma hverken forsvinde eller blive til noget.
  assert.equal(fangst('#').title, '#');
  assert.equal(fangst('køb mælk #').title, 'køb mælk #');
  assert.equal(fangst('kurset i C # og F #').title, 'kurset i C # og F #');
});

test('markører midt i et ord rører ikke titlen', () => {
  const r = fangst('husk C#-kurset og a@b');
  assert.equal(r.title, 'husk C#-kurset og a@b');
  assert.deepEqual(r.contexts, []);
});

/* ------------------------------------------- / som projekt (som @) */

test('/ virker som projekt midt i en sætning — legenden lover det', () => {
  const r = fangst('Mal alle lister /doda');
  assert.equal(r.project, 'doda');
  assert.equal(r.title, 'Mal alle lister');

  const r2 = fangst('Test brug for /Doda #computer !i morgen');
  assert.equal(r2.project, 'Doda');
  assert.deepEqual(r2.contexts, ['computer']);
  assert.equal(r2.title, 'Test brug for');
  assert.deepEqual(r2.due, { dato: '2026-08-14', tid: null });

  assert.equal(fangst('mal skuret /"Sommerhus i Rørvig"').project, 'Sommerhus i Rørvig');
});

test('/ må ALDRIG æde URL’er, datoer eller almindelige skråstreger', () => {
  // Ingen af dem har mellemrum foer skraastregen.
  const u = fangst('læs https://dr.dk/nyheder/politik i dag');
  assert.equal(u.project, null);
  assert.equal(u.title, 'læs https://dr.dk/nyheder/politik i dag');

  assert.deepEqual(fangst('bestil dæk !3/9').due, { dato: '2026-09-03', tid: null });
  assert.equal(fangst('bestil dæk !3/9').project, null);

  assert.equal(fangst('skriv ja/nej på sedlen').project, null);
  assert.equal(fangst('skriv ja/nej på sedlen').title, 'skriv ja/nej på sedlen');

  assert.equal(fangst('bestil dæk ~1/10').defer, '2026-10-01');

  // En skraastreg med mellemrum omkring er tekst, ikke en markoer.
  assert.equal(fangst('vælg mellem A / B').project, null);
});

test('@ og / betyder præcis det samme', () => {
  const a = fangst('køb maling @Sommerhus #ude');
  const b = fangst('køb maling /Sommerhus #ude');
  assert.equal(a.project, b.project);
  assert.equal(a.title, b.title);
  assert.deepEqual(a.contexts, b.contexts);
});

/* ------------------------------------ fjernMarkoer (redigering af en titel) */

test('fjernMarkoer tager kun DEN markør, den bliver bedt om', () => {
  assert.equal(P.fjernMarkoer('Hej med dig /doda', '@/', 'doda'), 'Hej med dig');
  assert.equal(P.fjernMarkoer('Hej med dig @doda', '@/', 'doda'), 'Hej med dig');
  assert.equal(P.fjernMarkoer('Ring til lægen #telefon', '#', 'telefon'), 'Ring til lægen');
  assert.equal(P.fjernMarkoer('mal skuret /"Sommerhus i Rørvig"', '@/', 'Sommerhus i Rørvig'), 'mal skuret');
  // Markøren midt i teksten, ikke kun i enden.
  assert.equal(P.fjernMarkoer('køb #ude maling til skuret', '#', 'ude'), 'køb maling til skuret');
});

test('fjernMarkoer rører ALDRIG noget uden mellemrum foran — samme regel som fangst', () => {
  // Det her er hele grunden til at den findes: i en titel man REDIGERER,
  // må intet forsvinde, som brugeren ikke har bedt om.
  assert.equal(P.fjernMarkoer('Send til navn@eksempel.dk', '@/', 'eksempel.dk'), 'Send til navn@eksempel.dk');
  assert.equal(P.fjernMarkoer('Husk C#-kurset', '#', '-kurset'), 'Husk C#-kurset');
  assert.equal(P.fjernMarkoer('Læs https://dr.dk/nyheder', '@/', 'nyheder'), 'Læs https://dr.dk/nyheder');
  // En værdi, der slet ikke står der, ændrer ingenting.
  assert.equal(P.fjernMarkoer('Ring til lægen', '#', 'telefon'), 'Ring til lægen');
  // Regex-tegn i navnet må ikke kunne bryde ud.
  assert.equal(P.fjernMarkoer('noget #a.b(c)', '#', 'a.b(c)'), 'noget');
  assert.equal(P.fjernMarkoer('noget #ab', '#', 'a.b'), 'noget #ab');
});

/*
 * Dansk klokkeslaet med PUNKTUM - og datoerne, der ligner det.
 *
 * En dansk iPhone skriver selv "21.36", saa en iOS-genvej, der indsaetter et
 * klokkeslaet, rammer det uden at vide det. Men `3.10` er ogsaa dansk for den
 * 3. oktober, og den betydning maa ikke gaa tabt.
 *
 * Reglen: staar tallet ALENE, er det en dato. Er der noget andet i frasen -
 * typisk »i dag« - er datoen allerede givet, og tallet er et klokkeslaet.
 */
const forfald = (s) => P.tolkFangst(`x !${s}`).due;

test('punktum er et klokkeslaet, NAAR datoen allerede er givet', () => {
  assert.deepEqual(forfald('i dag 21.36'), { dato: P.fmtDato(new Date()), tid: '21:36' });
  assert.equal(forfald('i dag 3.10').tid, '03:10');
  assert.equal(forfald('i morgen 8.05').tid, '08:05');
  // Med `kl` foran har det virket hele tiden - det skal det blive ved med.
  assert.equal(forfald('i dag kl 21.36').tid, '21:36');
  // Og kolon er stadig kolon.
  assert.equal(forfald('i dag 21:36').tid, '21:36');
});

test('et tal ALENE med punktum er en DATO - ikke et klokkeslaet', () => {
  // 3. oktober, ikke kl. 03:10.
  assert.equal(forfald('3.10').dato.slice(5), '10-03');
  assert.equal(forfald('3.10').tid, null);
  assert.equal(forfald('22.8').dato.slice(5), '08-22');
  assert.equal(forfald('1.12').dato.slice(5), '12-01');
});

test('en dato med aar rives ikke midt over', () => {
  // Uden en lookahead blev "3.10" plukket ud som tid, og ".2026" var ikke en
  // dato laengere - saa hele forfaldet forsvandt.
  const d = forfald('3.10.2026');
  assert.equal(d.dato, '2026-10-03');
  assert.equal(d.tid, null);
});

test('et umuligt klokkeslaet er ikke et klokkeslaet', () => {
  assert.equal(forfald('24.60'), null);
});
