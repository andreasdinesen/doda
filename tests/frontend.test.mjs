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

/*
 * Et ikonnavn, der ikke findes, er STILLE.
 *
 * `icon()` slutter af med `ICONS[name] || ''`, saa en tastefejl giver et tomt
 * <svg> - en knap uden ikon. Intet kastes, intet logges, og paa en knap, der
 * ogsaa har tekst, opdager man det maaske aldrig. Det er samme slags fejl som
 * v60's manglende navn, bare uden et brag.
 *
 * Vagten er billig, fordi begge ender staar i den byggede app.js: ICONS-
 * objektet og hvert eneste kald.
 */
test('hvert icon(...) peger paa et ikon, der findes', () => {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');

  const blok = kode.match(/const ICONS = \{([\s\S]*?)\n\};/);
  assert.ok(blok, 'kunne ikke finde ICONS i den byggede app.js');
  const findes = new Set([...blok[1].matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]));
  assert.ok(findes.size > 15, `fandt kun ${findes.size} ikoner - moensteret passer ikke`);

  const mangler = new Set();
  // Kun de LITTERALE kald. `icon(el.dataset.x)` kan ikke afgoeres her, og en
  // vagt, der gaetter, er en vagt, man slaar fra.
  for (const m of kode.matchAll(/\bicon\(\s*'([A-Za-z_$][\w$]*)'/g)) {
    if (!findes.has(m[1])) mangler.add(m[1]);
  }
  assert.deepEqual([...mangler], [],
    `icon('...') kaldes med navne, der ikke er i ICONS: ${[...mangler].join(', ')}`);
});

/*
 * Billedvagten SKAL sidde i fangfasen.
 *
 * doda har to delegerede klik-lyttere paa `document`. Link-lytteren
 * registreres, naar app.js laeses, og aabner i en hjemmeskaerms-app ethvert
 * `a[target="_blank"]` med `window.open`. Billedvagten saettes fra
 * `bindShell()` - altsaa senere. I boblefasen kom den derfor for sent: et
 * vedhaeftet billede aabnede sit eget vindue, og billedruden laa bag det
 * (Andreas, 10-09-2026).
 *
 * Det her er en FORM-paastand, ikke en maaling - den kan ikke se, om
 * rekkefoelgen stadig er den samme. Men den fanger netop det, der skete:
 * at `, true` forsvinder ved en oprydning, uden at nogen taenker over hvorfor
 * den stod der. Maalingen selv staar i DESIGN.md 7k.
 */
test('billedvagten lytter i fangfasen - ellers naar link-lytteren foerst', () => {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const start = kode.indexOf('function registrerBilledvagt(');
  assert.notEqual(start, -1, 'registrerBilledvagt findes ikke i den byggede app.js');
  const krop = kode.slice(start, kode.indexOf('\n}', start));

  assert.match(krop, /addEventListener\('click',/, 'vagten lytter ikke paa klik');
  assert.match(krop, /\}, true\);/,
    'lytteren skal registreres med capture (`, true`) - uden den aabner et '
    + 'vedhaeftet billede sit eget vindue, foer ruden naar at komme frem');
  assert.match(krop, /stopPropagation\(\)/,
    'uden stopPropagation naar haendelsen link-lytteren alligevel');
});

/*
 * Opgavens alder (§7m). »Hvor gammel er opgaven?« (Andreas, 13-09-2026)
 *
 * Grænserne er dér, den slags glider: »1 days ago«, »0 weeks ago«, eller et
 * døgn, der bliver til »24 hours ago« i stedet for »yesterday«. Funktionen er
 * ren, så den hentes ud af den byggede app.js og køres med et fast »nu«.
 */
test('alderen står i en enhed, der er til at forholde sig til', () => {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const start = kode.indexOf('function alder(');
  assert.ok(start > 0, 'alder() findes i den byggede app.js');
  const slut = kode.indexOf('\nfunction ', start + 10);
  // eslint-disable-next-line no-new-func
  const alder = new Function(`${kode.slice(start, slut)}; return alder;`)();

  const NU = 2_000_000_000;
  const H = 3600;
  const D = 86400;
  const tilfaelde = [
    [0, 'just now'],
    [59 * 60, 'just now'],
    [H, '1 hour ago'],
    [2 * H, '2 hours ago'],
    [23 * H, '23 hours ago'],
    [24 * H, 'yesterday'],            // ikke »24 hours ago«
    [47 * H, 'yesterday'],
    [2 * D, '2 days ago'],            // ikke »1 days ago«
    [13 * D, '13 days ago'],
    [14 * D, '2 weeks ago'],          // ikke »14 days ago« og aldrig »1 weeks«
    [59 * D, '8 weeks ago'],
    [60 * D, '2 months ago'],
    [364 * D, '12 months ago'],
    [365 * D, 'a year ago'],
    [730 * D, '2 years ago'],
  ];
  for (const [siden, forventet] of tilfaelde) {
    assert.equal(alder(NU - siden, NU), forventet, `${siden} s siden`);
  }

  // Et ur, der er en smule foran serverens, maa ikke give »-1 hours ago«.
  assert.equal(alder(NU + 30, NU), 'just now');
});

/*
 * `stopFokus` maa ALDRIG gaa gennem `slaaTimer`.
 *
 * `slaaTimer` er en VIPPE: den laeser tilstanden og afgoer selv, om der skal
 * startes eller stoppes. `stopFokus` rydder `fokus`, FOER den beder om at
 * stoppe - og saa kan vippen ikke laengere se, at uret hoerte til den opgave.
 * Den gaettede saa »start«, og »Stop« paa fokuslinjen SATTE TIDTAGNINGEN I
 * GANG i stedet for at standse den.
 *
 * Det ramte kun, naar opgaven ikke stod i den liste, man havde paa skaermen -
 * altsaa netop naar man havde forladt fokusskaermen og trykkede Stop paa
 * baandet. Fundet ved at laese diffen, ikke ved at bruge appen (18-09-2026).
 *
 * Kontrollen er en KILDEKONTROL, fordi beslutningen ikke kan drives i node:
 * den afhaenger af DOM, state og en fremmed server. Men reglen kan skrives
 * ned, og det er den, der staar her: er svaret allerede afgjort af
 * kaldsstedet, bruger man `stopTimerNu()`. En vippe hoerer kun hjemme, hvor
 * man faktisk mener »skift«.
 */
test('stopFokus stopper uret direkte - ikke gennem vippen', () => {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const m = /function stopFokus\([\s\S]*?\n\}/.exec(kode);
  assert.ok(m, 'stopFokus kunne ikke findes i app.js');
  /*
   * KOMMENTARERNE SKAL VAEK FOERST. Funktionens egen kommentar forklarer, at
   * den IKKE bruger `slaaTimer()` - og uden strimlingen laeser kontrollen
   * netop den saetning som et kald og faelder den rigtige kode. Det er anden
   * gang samme dag, en kildekontrol af min egen er faldet i det (foerste
   * gang: CSS-parseren i fastnavne.test.mjs).
   */
  const krop = m[0].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

  assert.equal(/\bslaaTimer\s*\(/.test(krop), false,
    'stopFokus kalder slaaTimer() - den er en vippe og kan gaette "start", '
    + 'naar fokus-tilstanden er ryddet. Brug stopTimerNu().');
  assert.ok(/\bstopTimerNu\s*\(/.test(krop),
    'stopFokus skal stoppe uret med stopTimerNu()');

  // Og vippen skal stadig findes, saa reglen ikke er "ingen af delene".
  assert.ok(/function stopTimerNu\b/.test(kode) && /function slaaTimer\b/.test(kode),
    'begge funktioner skal findes - de svarer paa hver sit spoergsmaal');
});

/*
 * Faelles tastaturgenveje (v102, 10-10-2026).
 *
 * doda, tovo, qlk og Sagu bruger samme bogstaver paa en raekke: ⌫ = slet,
 * # = kontekst/tag, m = flyt. `x`, `c` og `p` er frigjort - `x` er »markér« og
 * `c` er »kopiér« i de andre apps, og en gammel tast, der stadig sletter, er
 * netop den slags overraskelse, reglen skal fjerne.
 *
 * `raekkeTaster` koerer her for alvor: funktionen hentes ud af den byggede
 * app.js og faar stubbe for det, den kalder. Det er adfaerd, ikke moenster -
 * en kildekontrol ville ikke se, om `#` stadig gik til den rigtige vaelger.
 */
function raekkeHarness() {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const start = kode.indexOf('async function raekkeTaster(');
  assert.ok(start > 0, 'raekkeTaster findes i den byggede app.js');
  const slut = kode.indexOf('\n}\n', start) + 2;
  const kald = [];
  const it = { id: 'a1', kind: 'task', title: 'Test' };
  const nabo = { dataset: { id: 'a2' }, focus() { kald.push(['focus', 'a2']); } };
  // eslint-disable-next-line no-new-func
  const lav = new Function('stubbe', `
    const { state, sideState, naboRaekke, fuldfoer, saetStatus, slet, slaaTimer,
            tovoKanTage, vaelgHurtigt, aabnElement } = stubbe;
    ${kode.slice(start, slut)}
    return raekkeTaster;`);
  const raekkeTaster = lav({
    state: { items: [it] },
    sideState: {},
    naboRaekke: () => nabo,
    fuldfoer: async (id) => kald.push(['fuldfoer', id]),
    saetStatus: async (id, s) => kald.push(['status', id, s]),
    slet: async (id) => kald.push(['slet', id]),
    slaaTimer: async (id) => kald.push(['timer', id]),
    tovoKanTage: () => true,
    vaelgHurtigt: (x, hvad) => kald.push(['vaelg', x.id, hvad]),
    aabnElement: (x) => kald.push(['aabn', x.id]),
  });
  const tryk = async (key, ekstra = {}) => {
    kald.length = 0;
    let stoppet = false;
    await raekkeTaster({
      key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...ekstra,
      currentTarget: { dataset: { id: 'a1' }, blur() {} },
      preventDefault() { stoppet = true; }, stopPropagation() {},
    });
    return { kald: [...kald], stoppet };
  };
  return tryk;
}

test('raekketaster: ⌫ sletter, # saetter kontekst, m flytter til projekt', async () => {
  const tryk = await raekkeHarness();

  for (const key of ['Backspace', 'Delete']) {
    const r = await tryk(key);
    assert.deepEqual(r.kald, [['slet', 'a1']], `${key} skal slette`);
    assert.ok(r.stoppet, `${key} skal preventDefault'es - ellers kan browseren gaa tilbage`);
  }
  // `#` kommer med Shift paa mange tastaturer - det maa ikke afvise den.
  assert.deepEqual((await tryk('#', { shiftKey: true })).kald, [['vaelg', 'a1', 'context']]);
  assert.deepEqual((await tryk('m')).kald, [['vaelg', 'a1', 'project']]);
  assert.deepEqual((await tryk('t')).kald, [['timer', 'a1']]);
  assert.deepEqual((await tryk('s')).kald, [['status', 'a1', 'someday']], 's er Someday i doda');
  assert.deepEqual((await tryk(' ')).kald, [['fuldfoer', 'a1']]);
});

test('raekketaster: de gamle x, c og p goer ingenting laengere', async () => {
  const tryk = await raekkeHarness();
  for (const key of ['x', 'c', 'p']) {
    const r = await tryk(key);
    assert.deepEqual(r.kald, [], `${key} maa ikke laengere goere noget paa en raekke`);
    assert.equal(r.stoppet, false, `${key} maa ikke aedes, naar den ingenting goer`);
  }
  // Og en modifikator-tast (fx ⌘⌫ eller ⌘K) tilhoerer ikke raekken.
  assert.deepEqual((await tryk('Backspace', { metaKey: true })).kald, []);
});

test('genvejsoversigten viser de nye taster - og ⌘ kun paa Mac', () => {
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8');
  const fra = kode.indexOf('function modTast(');
  assert.ok(fra > 0, 'modTast findes i den byggede app.js');
  const til = kode.indexOf('\n];\n', kode.indexOf('const GENVEJE = [', fra)) + 3;
  const hent = (platform) => {
    // eslint-disable-next-line no-new-func
    return new Function('window', `${kode.slice(fra, til)}; return GENVEJE;`)({ navigator: { platform } });
  };

  const mac = hent('MacIntel');
  assert.deepEqual(mac.map(([g]) => g), ['Anywhere', 'In the palette (search field)', 'In a list']);
  const taster = (g, gruppe) => g.find(([n]) => n === gruppe)[1].map(([t]) => t);
  assert.ok(taster(mac, 'Anywhere').includes('⌘K'));
  assert.ok(taster(mac, 'Anywhere').includes('⌘ enter'));
  const liste = taster(mac, 'In a list');
  for (const t of ['⌫', '#', 'm', 't', 'n', 'w', 's']) assert.ok(liste.includes(t), `${t} mangler i listen`);
  for (const t of ['x', 'c', 'p', 'q']) assert.ok(!liste.includes(t), `${t} er ikke laengere en listetast`);

  const pc = hent('Win32');
  assert.ok(taster(pc, 'Anywhere').includes('Ctrl+K'));
  assert.ok(taster(pc, 'Anywhere').includes('Ctrl+enter'));
  assert.ok(!JSON.stringify(pc).includes('⌘'), 'paa en pc maa oversigten ikke vise ⌘');
});

test('⌘K/Ctrl+K fokuserer paletten - foer undtagelserne for felter', () => {
  /*
   * KILDEKONTROL: lytteren haenger paa `document` og kraever DOM. Det, der
   * laases fast, er raekkefoelgen - Cmd+K skal tjekkes FOER »er fokus i et
   * felt?«, ellers virker den ikke midt i en saetning, som reglen lover.
   */
  const kode = readFileSync(join(ROD, 'app/public/app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  const k = kode.search(/\(e\.metaKey \|\| e\.ctrlKey\)[^\n]*e\.key === 'k'/);
  assert.ok(k > 0, 'ingen Cmd/Ctrl+K-genvej i app.js');
  const blok = kode.slice(k, kode.indexOf('return;\n  }', k));
  assert.match(blok, /omni\.focus\(\)/);
  assert.match(blok, /omni\.select\(\)/);
  assert.match(blok, /tegnPanel\(\)/);
  const feltTjek = kode.indexOf("el.tagName === 'INPUT'", k);
  const lytter = kode.lastIndexOf("document.addEventListener('keydown'", k);
  assert.ok(feltTjek > k && kode.lastIndexOf("document.addEventListener('keydown'", feltTjek) === lytter,
    'Cmd+K skal staa foer felt-undtagelsen i samme lytter');
});
