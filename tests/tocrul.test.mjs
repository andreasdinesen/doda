/*
 * Sideoversigtens rulle-lytter skal lytte BÅDE på window og på body.
 *
 * Under mobilgrænsen er det body, der ruller (DESIGN §6c), og rulle-hændelser
 * bobler ikke. En lytter kun på window hører så ingenting - og nul hændelser
 * ligner en bestået prøve (RUNE-ERFARINGER §4, test-quirk 3). Browser-panelet
 * kan ikke drive rigtig rulning, så prøven henter registreringen UD AF KILDEN,
 * kører den mod en attrap-DOM og fyrer hændelsen på body.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const kilde = readFileSync(join(ROD, 'app/parts/p1_core.js'), 'utf8');

function lyttere() {
  const l = {};
  return {
    l,
    addEventListener(type, fn) { (l[type] = l[type] || []).push(fn); },
  };
}

function koer() {
  const start = kilde.indexOf('let tocVenter');
  const slut = kilde.indexOf("window.addEventListener('resize'", start);
  assert.ok(start > 0 && slut > start, 'toc-rullelytteren blev ikke fundet i p1_core.js');
  const blok = kilde.slice(start, slut);

  const win = lyttere();
  const body = lyttere();
  const kald = { marker: 0 };
  const ctx = {
    window: win,
    document: { body },
    tocState: { punkter: [{}, {}], aktiv: -1 },
    markerToc: () => { kald.marker++; },
    requestAnimationFrame: (fn) => fn(),
  };
  vm.runInNewContext(blok, ctx);
  return { win, body, kald };
}

test('oversigten følger med, når BODY ruller (smal skærm)', () => {
  const { body, kald } = koer();
  assert.equal((body.l.scroll || []).length, 1, 'ingen scroll-lytter på body');
  body.l.scroll[0]();
  assert.equal(kald.marker, 1);
});

test('og stadig, når vinduet ruller (desktop)', () => {
  const { win, kald } = koer();
  assert.equal((win.l.scroll || []).length, 1, 'ingen scroll-lytter på window');
  win.l.scroll[0]();
  assert.equal(kald.marker, 1);
});
