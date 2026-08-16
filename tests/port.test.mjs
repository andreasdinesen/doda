/* Regressionstest for den fejl, der gjorde v2 utilgaengelig i panelet.
   Koer: node --test tests/port.test.mjs

   Panelet injicerer PORT_<navn> og <NAVN>_PORT med den HOST-port, det har
   allokeret - IKKE container-porten. Binder serveren sig til den inde i
   containeren, peger panelets mapping paa 3000, hvor der ikke lytter noget.
   Container-porten er den konstant, runen selv erklaerer i ports.default. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Starter serveren med et givet miljoe og returnerer den port, den lytter paa. */
async function lytterPaa(env) {
  const dir = mkdtempSync(join(tmpdir(), 'doda-port-'));
  const srv = spawn('node', [join(ROD, 'app', 'server.js')], {
    env: Object.assign({}, process.env,
      { DATA_DIR: dir, BIND_PORT: '', PORT_web: '', WEB_PORT: '' }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const linje = await new Promise((ok, fejl) => {
      const t = setTimeout(() => fejl(new Error('serveren startede ikke')), 10000);
      let ud = '';
      srv.stdout.on('data', (b) => {
        ud += b;
        const m = ud.match(/doda lytter paa port (\d+)/);
        if (m) { clearTimeout(t); ok(Number(m[1])); }
      });
      srv.stderr.on('data', (b) => process.stderr.write(b));
    });
    return linje;
  } finally {
    srv.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }
}

test('i containeren bindes container-porten — ikke panelets host-port', async () => {
  // Praecis som panelet koerer den: PORT_web og WEB_PORT sat til den
  // allokerede host-port, BIND_PORT slet ikke sat.
  const port = await lytterPaa({ PORT_web: '25012', WEB_PORT: '25012' });
  assert.equal(port, 3000,
    'serveren skal binde runens ports.default (3000), ikke host-porten 25012');
});

test('BIND_PORT vinder — den er til lokal kørsel', async () => {
  assert.equal(await lytterPaa({ BIND_PORT: '8943' }), 8943);
  // Ogsaa naar panelets variabler ogsaa er sat.
  assert.equal(await lytterPaa({ BIND_PORT: '8944', PORT_web: '25012' }), 8944);
});

test('uden noget miljø bindes 3000', async () => {
  assert.equal(await lytterPaa({}), 3000);
});

test('runens ports.default og serverens standard er det SAMME tal', async () => {
  // De to skal foelges ad. Skifter man den ene uden den anden, er appen
  // utilgaengelig, uden at noget fejler hoejlydt.
  const yaml = readFileSync(join(ROD, 'runes', 'doda.yaml'), 'utf8');
  const m = yaml.match(/name: web\n\s+default: (\d+)/) || yaml.match(/default: (\d+)\n\s+name: web/);
  assert.ok(m, 'kunne ikke finde web-portens default i runen');
  assert.equal(Number(m[1]), await lytterPaa({}),
    'runens ports.default skal matche serverens standardport');
});
