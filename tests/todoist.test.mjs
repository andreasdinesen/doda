/* Test af Todoist-CSV-importen. Koer: node --test tests/todoist.test.mjs */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const T = require('../app/shared/todoist.js');
const P = require('../app/shared/parse.js');

const NU = new Date(2026, 7, 13);

// Et realistisk uddrag af en Todoist-eksport.
const CSV = `TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE
task,Call the accountant @phone,Ask about the VAT deadline,1,1,Andreas,,17 Aug,en,Europe/Copenhagen
task,"Buy milk, bread and coffee @errands",,4,1,Andreas,,,en,
task,Water the plants @home,,1,1,Andreas,,every 3 days,en,
task,Subtask under the first one,,1,2,Andreas,,,en,
note,Remember the login is in 1Password,,,,Andreas,,,,
section,Later,,,,,,,,
task,Task that mentions #Renovation and @tools,,1,1,Andreas,,,en,
task,"He said ""hello"" to me",,1,1,Andreas,,,en,
`;

test('CSV-parseren klarer anførselstegn, komma og fordoblede citater', () => {
  const r = T.parseCsv(CSV);
  assert.equal(r[0][0], 'TYPE');
  assert.equal(r[2][1], 'Buy milk, bread and coffee @errands', 'komma inde i et citat');
  const sidste = r[r.length - 1];
  assert.equal(sidste[1], 'He said "hello" to me', 'dobbelt citat bliver ét');
});

test('projektnavnet kommer fra filnavnet', () => {
  assert.equal(T.laesProjekt(CSV, 'Arbejde.csv').project, 'Arbejde');
  assert.equal(T.laesProjekt(CSV, 'Arbejde').project, 'Arbejde');
  assert.equal(T.laesProjekt(CSV, '').project, 'Todoist');
});

test('Todoists @mærkat bliver til dodas #kontekst — begreberne er byttet om', () => {
  const r = T.laesProjekt(CSV, 'Work.csv');
  const kald = r.items.find((i) => /accountant/.test(i.title));
  assert.deepEqual(kald.contexts, ['phone'], 'Todoists @phone er en maerkat, ikke et projekt');
  assert.equal(kald.title, 'Call the accountant', 'maerkaten skal ud af titlen');
  assert.equal(kald.project, 'Work', 'projektet kommer fra filen, ikke fra teksten');
});

test('Todoists #projekt-reference fjernes i stedet for at blive en forkert kontekst', () => {
  const r = T.laesProjekt(CSV, 'Work.csv');
  const it = r.items.find((i) => /mentions/.test(i.title));
  assert.equal(it.title, 'Task that mentions and');
  assert.deepEqual(it.contexts, ['tools'], 'kun @tools er en maerkat');
});

test('beskrivelse, noter og sektioner', () => {
  const r = T.laesProjekt(CSV, 'Work.csv');
  assert.equal(r.items.find((i) => /accountant/.test(i.title)).note, 'Ask about the VAT deadline');
  assert.ok(r.items.some((i) => i.kind === 'note' && /1Password/.test(i.title)));
  assert.ok(!r.items.some((i) => i.title === 'Later'), 'sektioner er layout, ikke opgaver');
  assert.equal(r.skipped, 1);
});

test('underopgaver fladlægges, og det siges højt', () => {
  const r = T.laesProjekt(CSV, 'Work.csv');
  assert.ok(r.items.some((i) => /Subtask/.test(i.title)), 'den skal med, bare uden indryk');
  assert.match(r.warnings.join(' '), /1 subtask flattened/);
});

test('fangst-linjen tolkes af dodas EGEN parser — datoer og gentagelser', () => {
  const r = T.laesProjekt(CSV, 'Work.csv');

  const kald = r.items.find((i) => /accountant/.test(i.title));
  const l1 = T.somFangst(kald);
  const t1 = P.tolkFangst(l1, { now: NU });
  assert.equal(t1.title, 'Call the accountant');
  assert.deepEqual(t1.contexts, ['phone']);
  assert.equal(t1.project, 'Work');
  assert.equal(t1.due.dato, '2026-08-17', 'Todoists "17 Aug" laeses af dodas datotolkning');
  assert.equal(t1.note, 'Ask about the VAT deadline');

  // "every 3 days" bliver en RIGTIG doda-gentagelse
  const vand = r.items.find((i) => /Water/.test(i.title));
  const t2 = P.tolkFangst(T.somFangst(vand), { now: NU });
  assert.equal(t2.recurrenceText, 'every 3 days');
  const g = P.tolkGentagelse(t2.recurrenceText, NU);
  assert.equal(g.freq, 'day');
  assert.equal(g.interval, 3);
  assert.equal(g.mode, 'schedule');
});

test('projektnavne med mellemrum overlever fangst-linjen', () => {
  const r = T.laesProjekt('TYPE,CONTENT,DATE\ntask,Fix the roof,\n', 'Summer house.csv');
  const t = P.tolkFangst(T.somFangst(r.items[0]), { now: NU });
  assert.equal(t.project, 'Summer house');
  assert.equal(t.title, 'Fix the roof');
});

test('en fil der ikke er Todoist-CSV afvises med en læsbar besked', () => {
  const r = T.laesProjekt('navn;pris\nkaffe;40\n', 'noget.csv');
  assert.equal(r.items.length, 0);
  assert.match(r.warnings[0], /does not look like a Todoist/);
});

test('tom fil vælter ikke importen', () => {
  assert.equal(T.laesProjekt('', 'tom.csv').items.length, 0);
  assert.equal(T.laesProjekt(null, 'tom.csv').items.length, 0);
});
