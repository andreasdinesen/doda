/*
 * Foldbare gruppeoverskrifter (Next Actions og Projects).
 *
 * To ting kan gaa galt her, og ingen af dem kan ses i en browser-pane:
 *
 * 1. **Regnestykket bag foldningen.** Gemmer vi de UDFOLDEDE navne i stedet
 *    for de sammenfoldede, forsvinder en ny kontekst, i samme oejeblik den
 *    oprettes - og det opdager man foerst uger senere med en tom skaerm.
 * 2. **Tastaturet.** En raekke i en foldet gruppe staar stadig i dokumentet.
 *    Spoerger piletasterne efter `.item-row` frem for `synligeRaekker()`,
 *    lander fokus paa noget usynligt, og listen ser ud til at springe over
 *    sig selv. Programmatisk rulning og syntetiske taster kan ikke drives i
 *    Claude Codes browser-pane (RUNE-ERFARINGER §4), saa kilden er det
 *    eneste sted, den fejl kan fanges.
 *
 * Funktionerne hentes UD AF `app/public/app.js` - de skrives ikke af. En
 * prove paa en kopi beviser kun, at kopien virker (RUNE-ERFARINGER §4).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const KODE = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');

/** Klipper `function navn(...) { ... }` ud af kilden med balancerede tuborger. */
function hentFunktion(kode, navn) {
  const start = kode.indexOf(`function ${navn}(`);
  assert.notEqual(start, -1, `${navn} findes ikke i app.js`);
  let i = kode.indexOf('{', start);
  let dybde = 0;
  for (let j = i; j < kode.length; j++) {
    if (kode[j] === '{') dybde++;
    else if (kode[j] === '}' && --dybde === 0) return kode.slice(start, j + 1);
  }
  throw new Error(`kunne ikke finde slutningen paa ${navn}`);
}

/* Et lille localStorage, saa funktionerne kan koere i node. `esc` og `icon`
   er rene tegnehjaelpere og stubbes - det er foldningen, der proeves. */
function sandkasse(start = {}) {
  const gemt = { ...start };
  const localStorage = {
    getItem: (k) => (k in gemt ? gemt[k] : null),
    setItem: (k, v) => { gemt[k] = String(v); },
  };
  const kilde = `${hentFunktion(KODE, 'foldedeGrupper')}
    ${hentFunktion(KODE, 'saetGruppeFoldet')}
    ${hentFunktion(KODE, 'foldGrupper')}
    return { foldedeGrupper, saetGruppeFoldet, foldGrupper };`;
  // eslint-disable-next-line no-new-func
  const lav = new Function('localStorage', 'esc', 'icon', 'foldNr', kilde);
  return { ...lav(localStorage, (s) => String(s), () => '<svg/>', 0), gemt };
}

test('vi gemmer de SAMMENFOLDEDE navne - en ny gruppe er altid udfoldet', () => {
  const s = sandkasse();
  s.saetGruppeFoldet('next', 'YouTube', true);
  assert.equal(s.gemt.doda_fold_next, '["YouTube"]');

  // Den helt nye kontekst staar ikke i listen, og er derfor udfoldet.
  assert.equal(s.foldedeGrupper('next').has('Mail'), false);
  assert.equal(s.foldedeGrupper('next').has('YouTube'), true);

  s.saetGruppeFoldet('next', 'YouTube', false);
  assert.equal(s.gemt.doda_fold_next, '[]');
});

test('skaermene deler ikke noegle - Projects folder ikke Next Actions', () => {
  const s = sandkasse();
  s.saetGruppeFoldet('next', 'Mail', true);
  s.saetGruppeFoldet('projects', 'area:Hjem', true);
  assert.equal(s.foldedeGrupper('next').has('area:Hjem'), false);
  assert.equal(s.foldedeGrupper('projects').has('Mail'), false);
});

test('noget vrovl i localStorage maa ikke kunne braekke en liste', () => {
  for (const skidt of ['{', 'null', '"Mail"', '17']) {
    const s = sandkasse({ doda_fold_next: skidt });
    assert.equal(s.foldedeGrupper('next').size, 0, `vaerdien ${skidt}`);
  }
});

test('tallet staar paa overskriften, ogsaa naar gruppen er foldet sammen', () => {
  const s = sandkasse({ doda_fold_next: '["YouTube"]' });
  const gruppe = s.foldGrupper('next');

  const foldet = gruppe('YouTube', 'YouTube', 8, '<div class="item-row"></div>');
  assert.match(foldet, /aria-expanded="false"/);
  assert.match(foldet, /class="group-count">8</, 'tallet er hele pointen med at folde sammen');
  assert.match(foldet, /<div class="list" id="grp\d+" hidden>/);

  const aaben = gruppe('Mail', 'Mail', 2, '<div class="item-row"></div>');
  assert.match(aaben, /aria-expanded="true"/);
  assert.doesNotMatch(aaben, /hidden/);
});

test('to grupper faar aldrig samme id - knappen skal pege paa SIN liste', () => {
  const s = sandkasse();
  const a = s.foldGrupper('next')('Mail', 'Mail', 1, '');
  const b = s.foldGrupper('projects')('area:Mail', 'Mail', 1, '');
  const id = (html) => html.match(/aria-controls="(grp\d+)"/)[1];
  assert.notEqual(id(a), id(b));
});

test('piletasterne spoerger efter de SYNLIGE raekker, ikke efter alle', () => {
  /*
   * En raekke i en foldet gruppe er `hidden`, men den er der stadig. Gaar
   * nogen tilbage til et bart `querySelectorAll('.item-row')`, hopper fokus
   * ud i det usynlige - uden fejl, uden log, uden at noget ser forkert ud.
   */
  const nabo = hentFunktion(KODE, 'naboRaekke');
  assert.match(nabo, /synligeRaekker\(\)/);
  assert.doesNotMatch(nabo, /querySelectorAll\(\s*['"]\.item-row['"]\s*\)/);

  // Vejen IND i listen (dokumentets egen piletast-lytter) har samme krav.
  assert.match(KODE, /synligeRaekker\('\[data-keynav\] \.item-row'\)/);
  assert.doesNotMatch(KODE, /querySelectorAll\('\[data-keynav\] \.item-row'\)/);
});

test('vagten kan faktisk se en fejl - ellers beviser den ingenting', () => {
  const gammel = "function naboRaekke(el, retning) {\n  const alle = [...document.querySelectorAll('.item-row')];\n}";
  assert.doesNotMatch(gammel, /synligeRaekker\(\)/);
  assert.match(gammel, /querySelectorAll\(\s*['"]\.item-row['"]\s*\)/);
});

test('klikket haandteres ÉT sted - ellers folder ét klik frem og tilbage', () => {
  /*
   * `bindListe()` koeres ogsaa, naar en ENKELT raekke er tegnet om. En
   * lytter pr. foldeknap ville derfor hobe sig op, og gruppen ville folde
   * sig sammen og ud igen ved samme klik - altsaa se ud som om intet skete.
   */
  const lyttere = KODE.match(/\.foldknap\[data-fold\]/g) || [];
  assert.equal(lyttere.length, 1, 'kun den delegerede lytter maa kende foldeknapperne');
  assert.match(KODE, /document\.addEventListener\('click', \(e\) => \{\s*const knap = e\.target\.closest/);
});
