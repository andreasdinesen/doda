/* Versionsnummeret staar fem steder, og de SKAL vaere det samme tal.
   Koer: node --test tests/version.test.mjs

   APP_VERSION er kilden; build_rune.py stempler den i index.html, i sw.js og
   i runens version:. Serveren laeser den ud af index.html og melder den i
   /api/public-config, sa appen kan vise "v6" og opdage, at browseren koerer
   en aeldre app.js end den, serveren udleverer.

   Kommer bare ét af leddene ud af trit, viser panelet én version, appen en
   anden - og service workeren kan servere gammel kode i det uendelige
   (RUNE-ERFARINGER §5). Intet andet fejler hoejlydt. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

let server;
let dataDir;
let BASE;

const fil = (...dele) => readFileSync(join(ROD, ...dele), 'utf8');

/** Ét tal ud af en fil, med en laesbar fejl hvis moensteret ikke findes. */
function tal(tekst, re, hvor) {
  const m = tekst.match(re);
  assert.ok(m, `kunne ikke finde versionsnummeret i ${hvor}`);
  return Number(m[1]);
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'doda-version-'));
  // BIND_PORT=0: lad styresystemet vaelge en LEDIG port, og laes den ud af
  // serverens egen linje. Et fast portnummer goer testen afhaengig af, at
  // ingen efterladt proces fra en tidligere koersel sidder paa den - og saa
  // fejler den med "serveren startede ikke" i stedet for EADDRINUSE.
  server = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env, { BIND_PORT: '0', DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stoej = '';
  await new Promise((ok, fejl) => {
    // Tag serverens egen fejltekst med i beskeden. Uden den peger en timeout
    // paa "start" i stedet for paa aarsagen.
    const t = setTimeout(() => fejl(new Error(`serveren startede ikke:\n${stoej}`)), 10000);
    server.stdout.on('data', (b) => {
      stoej += b;
      const m = String(b).match(/doda lytter paa port (\d+)/);
      if (m) { clearTimeout(t); BASE = `http://127.0.0.1:${m[1]}`; ok(); }
    });
    server.stderr.on('data', (b) => { stoej += b; });
  });
});

after(() => {
  if (server) server.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('APP_VERSION, runen, index.html og sw.js er det SAMME tal', () => {
  const kilde = tal(fil('app', 'parts', 'p1_core.js'), /const APP_VERSION = (\d+);/, 'p1_core.js');

  // Runens version: staar under gameskill:, altsaa indrykket - og der er
  // andre "version"-ord laengere nede i install-scriptet (node --version).
  assert.equal(tal(fil('runes', 'doda.yaml'), /\n {2}version: ["']?(\d+)/, 'runes/doda.yaml'), kilde,
    'runens version: er det, panelet viser - den skal foelge APP_VERSION');
  assert.equal(tal(fil('app', 'public', 'index.html'), /app\.js\?v=(\d+)/, 'index.html'), kilde,
    'cache-bust i index.html skal foelge APP_VERSION (RUNE-ERFARINGER §5)');
  assert.equal(tal(fil('app', 'public', 'sw.js'), /const VERSION = (\d+);/, 'sw.js'), kilde,
    'service workerens cache-navn skal bumpes, ellers serveres gammel kode');
});

test('serveren melder samme version i /api/public-config', async () => {
  const kilde = tal(fil('app', 'parts', 'p1_core.js'), /const APP_VERSION = (\d+);/, 'p1_core.js');
  const d = await (await fetch(`${BASE}/api/public-config`)).json();
  assert.equal(d.version, kilde);
  // Uden login: appen skal kunne vise versionen paa login-siden ogsaa.
  assert.equal(typeof d.version, 'number');
});
