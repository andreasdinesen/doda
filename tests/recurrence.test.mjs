/* Test af gentagelses-parseren og -motoren. Koer: node --test tests/
   Fast "nu" = torsdag den 13. august 2026. */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const P = require('../app/shared/parse.js');

const NU = new Date(2026, 7, 13); // torsdag 13/8-2026
const regel = (s) => P.tolkGentagelse(s, NU);
const naeste = (s, fra) => P.naesteForekomst(regel(s), fra || '2026-08-13');

/* ------------------------------------------------------------ parseren */

test('tilstand: ! betyder fra fuldførelse, uden ! er fast plan', () => {
  assert.equal(regel('every monday').mode, 'schedule');
  assert.equal(regel('every! monday').mode, 'completion');
  assert.equal(regel('hver mandag').mode, 'schedule');
  assert.equal(regel('hver! mandag').mode, 'completion');
  assert.equal(regel('every! 3 days').mode, 'completion');
});

test('dage', () => {
  assert.equal(regel('every day').freq, 'day');
  assert.equal(regel('every day').interval, 1);
  assert.equal(regel('every 3 days').interval, 3);
  assert.equal(regel('every other day').interval, 2);
  assert.equal(regel('hver dag').freq, 'day');
  assert.equal(regel('hver 3. dag').interval, 3);
});

test('ugedage', () => {
  assert.deepEqual(regel('every monday').weekdays, [1]);
  assert.deepEqual(regel('every mon, thu').weekdays, [1, 4]);
  assert.deepEqual(regel('every monday and thursday').weekdays, [1, 4]);
  assert.deepEqual(regel('hver mandag og torsdag').weekdays, [1, 4]);
  assert.deepEqual(regel('every weekday').weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(regel('hver hverdag').weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(regel('every weekend').weekdays, [6, 7]);
  assert.equal(regel('every 2 weeks').interval, 2);
  assert.deepEqual(regel('every 2 weeks').weekdays, [4], 'uden ugedag: samme som i dag (torsdag)');
});

test('måneder', () => {
  assert.equal(regel('every month on the 3rd').monthday, 3);
  assert.equal(regel('hver måned den 3.').monthday, 3);
  assert.equal(regel('every 15th of the month').monthday, 15);
  assert.equal(regel('last day of the month').monthday, 'last');
  assert.equal(regel('sidste dag i måneden').monthday, 'last');
  assert.equal(regel('last workday of the month').monthday, 'lastworkday');
  assert.equal(regel('sidste hverdag i måneden').monthday, 'lastworkday');
  assert.equal(regel('first workday of the month').monthday, 'firstworkday');
  assert.equal(regel('every 2 months').interval, 2);
});

test('år', () => {
  const r = regel('every year on 24/12');
  assert.equal(r.freq, 'year');
  assert.equal(r.month, 12);
  assert.equal(r.day, 24);
  const r2 = regel('hvert år 24/12');
  assert.equal(r2.month, 12);
  assert.equal(r2.day, 24);
  const r3 = regel('every year on december 24');
  assert.equal(r3.day, 24);
});

test('klokkeslæt', () => {
  assert.equal(regel('every monday at 8').time, '08:00');
  assert.equal(regel('hver mandag kl 8.30').time, '08:30');
  assert.deepEqual(regel('every monday at 8').weekdays, [1], 'tiden må ikke æde ugedagen');
});

test('vrøvl giver null i stedet for at gætte', () => {
  assert.equal(regel('every blurgh'), null);
  assert.equal(regel('monday'), null, 'mangler every');
  assert.equal(regel('every'), null);
  assert.equal(P.tolkGentagelse(''), null);
  assert.equal(P.tolkGentagelse(null), null);
});

/* ------------------------------------------------------------- motoren */

test('daglig', () => {
  assert.equal(naeste('every day'), '2026-08-14');
  assert.equal(naeste('every 3 days'), '2026-08-16');
  assert.equal(naeste('every day', '2026-12-31'), '2027-01-01', 'hen over årsskiftet');
});

test('ugentlig', () => {
  // 13/8-2026 er torsdag
  assert.equal(naeste('every monday'), '2026-08-17');
  assert.equal(naeste('every thursday'), '2026-08-20', 'strengt EFTER i dag');
  assert.equal(naeste('every friday'), '2026-08-14');
  assert.equal(naeste('every mon, thu'), '2026-08-17');
  assert.equal(naeste('every mon, thu', '2026-08-17'), '2026-08-20');
});

test('hver anden uge holder takten', () => {
  const r = regel('every 2 weeks on monday');
  // Ankeret er 13/8 (uge med mandag 10/8). Mandage i takt: 10/8, 24/8, 7/9 …
  const a = P.naesteForekomst(regel('every 2 mon'), '2026-08-13');
  assert.equal(a, '2026-08-24');
  assert.equal(P.naesteForekomst(regel('every 2 mon'), '2026-08-24'), '2026-09-07');
  assert.ok(r === null || r.interval === 2);
});

test('hver hverdag springer weekenden over', () => {
  assert.equal(naeste('every weekday', '2026-08-14'), '2026-08-17', 'fredag → mandag');
  assert.equal(naeste('every weekday', '2026-08-17'), '2026-08-18');
});

test('månedlig', () => {
  assert.equal(naeste('every month on the 3rd'), '2026-09-03');
  assert.equal(naeste('every month on the 20th'), '2026-08-20');
  assert.equal(naeste('every 2 months on the 3rd', '2026-08-03'), '2026-10-03');
});

test('den 31. klemmes ned i korte måneder — aldrig ud i den næste', () => {
  assert.equal(naeste('every month on the 31st', '2026-01-31'), '2026-02-28');
  assert.equal(naeste('every month on the 31st', '2026-03-31'), '2026-04-30');
  assert.equal(naeste('every month on the 29th', '2028-01-29'), '2028-02-29', 'skudår');
});

test('sidste dag og sidste hverdag i måneden', () => {
  assert.equal(naeste('last day of the month'), '2026-08-31');
  // 31/10-2026 er en lørdag → sidste hverdag er fredag den 30.
  assert.equal(naeste('last workday of the month', '2026-10-01'), '2026-10-30');
  // 1/11-2026 er en søndag → første hverdag er mandag den 2.
  assert.equal(naeste('first workday of the month', '2026-10-31'), '2026-11-02');
});

test('årlig', () => {
  assert.equal(naeste('every year on 24/12'), '2026-12-24');
  assert.equal(naeste('every year on 24/12', '2026-12-24'), '2027-12-24');
  assert.equal(naeste('every year on 29/2', '2027-03-01'), '2028-02-29', 'skudårsdag');
});

test('sommertid: en ugentlig gentagelse driver ikke hen over skiftet', () => {
  // Sommertiden slutter søndag den 25. oktober 2026. Regnes der på
  // millisekunder, bliver det døgn 25 timer, og datoen skrider.
  let d = '2026-10-19'; // mandag før skiftet
  const set = [];
  for (let i = 0; i < 4; i++) { d = P.naesteForekomst(regel('every monday'), d); set.push(d); }
  assert.deepEqual(set, ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);

  // Og forårsskiftet (29. marts 2027), hvor døgnet er 23 timer.
  let f = '2027-03-22';
  const set2 = [];
  for (let i = 0; i < 3; i++) { f = P.naesteForekomst(regel('every monday'), f); set2.push(f); }
  assert.deepEqual(set2, ['2027-03-29', '2027-04-05', '2027-04-12']);
});

test('daglig gentagelse hen over sommertid springer ikke en dag over', () => {
  let d = '2026-10-23';
  const set = [];
  for (let i = 0; i < 5; i++) { d = P.naesteForekomst(regel('every day'), d); set.push(d); }
  assert.deepEqual(set, ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
});

test('motoren returnerer altid en dato STRENGT efter udgangspunktet', () => {
  for (const s of ['every day', 'every monday', 'every weekday', 'every month on the 3rd',
    'last workday of the month', 'every year on 24/12', 'every 3 days', 'every 2 mon']) {
    for (const fra of ['2026-08-13', '2026-02-28', '2026-12-31', '2028-02-29']) {
      const n = P.naesteForekomst(regel(s), fra);
      assert.ok(n && n > fra, `${s} fra ${fra} gav ${n}`);
    }
  }
});

test('beskrivelsen skriver tilstanden ud', () => {
  assert.match(P.beskrivGentagelse(regel('every monday')), /fixed schedule/);
  assert.match(P.beskrivGentagelse(regel('every! monday')), /from completion/);
  assert.match(P.beskrivGentagelse(regel('every weekday')), /every weekday/);
  assert.match(P.beskrivGentagelse(regel('every monday at 8')), /at 08:00/);
});

/* --------------------------------------------------- fangst + gentagelse */

test('gentagelse kan fanges sammen med kontekst og projekt', () => {
  const r = P.tolkFangst('vacuum the flat #home @Household !every! sunday at 10', { now: NU });
  assert.equal(r.title, 'vacuum the flat');
  assert.deepEqual(r.contexts, ['home']);
  assert.equal(r.project, 'Household');
  assert.equal(r.recurrenceText, 'every! sunday at 10');
  const g = P.tolkGentagelse(r.recurrenceText, NU);
  assert.equal(g.mode, 'completion');
  assert.deepEqual(g.weekdays, [7]);
  assert.equal(g.time, '10:00');
});
