/* doda henter sin egen kode (F26). Koer: node --test tests/kilde.test.mjs

   Det, der kan gaa galt her, er ikke hentningen - det er REGLERNE omkring
   den, og de er alle sammen af den slags, der ikke fejler hoejlydt:

   - »seneste« maa ikke kunne blive til en tilfaeldig tag. GitHub sorterer
     tags alfabetisk, og alfabetisk er v9 nyere end v80.
   - En laas maa ikke kunne tolkes vaek. Skriver man »v81«, skal doda sige
     fra - ikke gaette paa 81 og heller ikke stille og roligt hente den
     nyeste.
   - Der maa ikke byttes til noget, der ikke er en hel doda, eller til kode,
     der ikke er den, taggen lover.

   Hentningen selv (https, gunzip, tar) proeves IKKE her: den kraever GitHub.
   Det er et bevidst hul - og derfor er alt det, der KAN proeves uden net,
   skilt ud i rene funktioner. */

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const K = require('../app/kilde.js');
const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/* --------------------------------------------------------- KODE_VERSION */

test('tom, seneste og latest betyder alle det samme', () => {
  for (const v of ['', '   ', 'seneste', 'latest', 'Seneste', 'LATEST']) {
    const o = K.oensket(v);
    assert.equal(o.laast, false, `»${v}« skulle ikke laase`);
    assert.equal(o.tekst, 'seneste');
    assert.equal(o.fejl, undefined);
  }
});

test('et tal laaser til praecis den udgave', () => {
  const o = K.oensket('81');
  assert.equal(o.laast, true);
  assert.equal(o.version, 81);
  assert.equal(o.tekst, '81');
});

test('noget, der ligner et tal, laaser IKKE - det siger fra', () => {
  // »v81« er det, man skriver, naar man taenker paa taggen. Blev det tolket
  // som 81, ville doda gaette; blev det tolket som »seneste« i stilhed,
  // ville laasen forsvinde uden at nogen fik det at vide.
  for (const v of ['v81', '81.2', '81 ', 'nyeste', '-1']) {
    const o = K.oensket(v);
    if (v === '81 ') { assert.equal(o.laast, true); continue; } // trimmes
    assert.equal(o.laast, false, `»${v}« maa ikke laase`);
    assert.equal(o.tekst, 'seneste');
    assert.ok(o.fejl, `»${v}« skal give en forklaring`);
    assert.match(o.fejl, /KODE_VERSION/);
  }
});

/* ------------------------------------------------------------ nyeste tag */

/** En hentJson, der svarer med faste sider i stedet for at ringe til GitHub. */
const faestet = (sider) => async (url) => {
  const m = /[?&]page=(\d+)/.exec(url);
  return sider[Number(m[1]) - 1] || [];
};

test('det hoejeste vN vinder - ikke det foerste, GitHub naevner', async () => {
  // Praecis den raekkefoelge, en alfabetisk sortering giver. Tog vi bare
  // liste[0], ville v9 blive til »nyeste«, og hver server ville rulle 72
  // udgaver tilbage ved naeste genstart.
  const svar = [[{ name: 'v9' }, { name: 'v81' }, { name: 'v8' }, { name: 'v80' }]];
  assert.equal(await K.nyesteTag(faestet(svar)), 81);
});

test('der bladres, indtil en side ikke er fuld', async () => {
  const side1 = Array.from({ length: 100 }, (_, i) => ({ name: `v${i + 1}` }));
  const side2 = [{ name: 'v101' }, { name: 'v102' }];
  assert.equal(await K.nyesteTag(faestet([side1, side2])), 102);
});

test('tags, der ikke er udgivelser, taeller ikke med', async () => {
  const svar = [[{ name: 'start' }, { name: 'v3' }, { name: 'v10-rc1' }, { name: 'V99' }]];
  assert.equal(await K.nyesteTag(faestet(svar)), 3);
});

test('en tagliste helt uden vN er en fejl, ikke et nul', async () => {
  await assert.rejects(() => K.nyesteTag(faestet([[{ name: 'start' }]])),
    /ingen vN-tag/);
});

/* ------------------------------------------------------- tjek foer bytte */

function traeMed(version, { udelad = [] } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'doda-kilde-'));
  const filer = {
    'server.js': '// doda\n',
    'public/index.html': `<link rel="stylesheet" href="/style.css?v=${version}">\n`
      + `<script src="/app.js?v=${version}"></script>\n`,
    'public/app.js': '// app\n',
    'shared/parse.js': '// parse\n',
  };
  for (const [navn, indhold] of Object.entries(filer)) {
    if (udelad.includes(navn)) continue;
    mkdirSync(join(d, dirname(navn)), { recursive: true });
    writeFileSync(join(d, navn), indhold);
  }
  return d;
}

test('et helt trae med det rigtige stempel godtages', () => {
  const d = traeMed(82);
  try { K.tjekTrae(d, 82); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('en halv hentning byttes ikke ind', () => {
  for (const mangler of ['server.js', 'public/app.js', 'shared/parse.js']) {
    const d = traeMed(82, { udelad: [mangler] });
    try {
      assert.throws(() => K.tjekTrae(d, 82), new RegExp(mangler.replace('/', '\\/')));
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('en tag, der indeholder en anden version, afvises', () => {
  // Det sker, naar en tag er flyttet oven paa en anden commit. Koden ville
  // koere - men ingen kunne navngive den, og »v82« i panelet ville luge.
  const d = traeMed(80);
  try {
    assert.throws(() => K.tjekTrae(d, 82), /v82 indeholder kode stemplet v80/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/* ----------------------------------------------------- hvad ligger der nu */

test('maerket laeses, naar det findes', () => {
  const d = traeMed(82);
  try {
    writeFileSync(join(d, '.kode-version'), JSON.stringify({
      version: 70, oensket: '70', hentet: '2026-09-03T10:00:00.000Z', kilde: 'github',
    }));
    const m = K.installeret(d);
    assert.equal(m.version, 70);
    assert.equal(m.kilde, 'github');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('uden maerke staar tallet i index.html', () => {
  // Den vej gaelder for hver eneste doda, der er installeret foer v82: runens
  // install-script skriver ikke noget maerke. Uden dette fallback ville
  // foerste genstart hente koden igen, ogsaa naar den allerede var den rette.
  const d = traeMed(81);
  try {
    const m = K.installeret(d);
    assert.equal(m.version, 81);
    assert.equal(m.kilde, 'install');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('den rigtige app/ kan navngive sig selv', () => {
  const m = K.installeret(join(ROD, 'app'));
  assert.ok(m && Number.isInteger(m.version), 'app/ skulle kunne laeses');
});
