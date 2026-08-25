/*
 * F22 - markdown-rendereren.
 *
 * Den tegner FREMMED tekst: en Sagu-note er skrevet i en anden app, og doda
 * kigger med. Derfor er escapen ikke en detalje, og derfor bor rendereren i
 * app/shared/, hvor den kan proeves - en frontend-fil kan ikke koeres i Node.
 *
 *   node --test tests/markdown.test.mjs
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const M = require('../app/shared/markdown.js');

/* Dodas egne, i deres enkleste form - det er DEM, der skal injiceres. */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkify = (t) => esc(t).replace(
  /\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
  (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
const filUrl = (id) => `/api/v1/sagu/file?id=${id}`;

const md = (t) => M.render(t, esc, linkify, filUrl);
const HEX = 'a'.repeat(32);

test('afkrydsninger bliver til felter - ikke til raa markdown', () => {
  /*
   * »Naar doda viser sagu noter, saa burde den vise noter renderet og ikke i
   * den rene markdown - fx checkfelter« (Andreas, 25-08-2026).
   */
  const ud = md('- [ ] noget aabent\n- [x] noget lukket');
  assert.match(ud, /<ul class="tjekliste">/);
  assert.match(ud, /<input type="checkbox" disabled><span>noget aabent<\/span>/);
  assert.match(ud, /<input type="checkbox" disabled checked><span class="krydset">noget lukket/);
  // Ingen raa markdown tilbage.
  assert.ok(!ud.includes('[ ]') && !ud.includes('[x]'), 'firkantparenteserne skal vaere vaek');
});

test('feltet er DEAKTIVERET - noten hoerer til i Sagu', () => {
  // Et felt, man kan klikke paa, uden at det gemmes, er vaerre end et, man
  // ikke kan klikke paa: man ville tro, det var afkrydset.
  const ud = md('- [ ] proev at trykke');
  assert.match(ud, /<input type="checkbox" disabled/);
});

test('en overskrift behoever ikke staa alene i sin blok', () => {
  /*
   * Den gamle regel var `linjer.length === 1`. En note med
   *
   *     ## API key til iphone
   *     doda_wZhq...
   *
   * - altsaa den normale maade at skrive en liste af noegler paa - fik derfor
   * sine `##` vist som tekst.
   */
  const ud = md('## API key til iphone\ndoda_wZhqTn_ZiGDFzh15');
  assert.match(ud, /<h4>API key til iphone<\/h4>/);
  assert.match(ud, /<p>doda_wZhqTn_ZiGDFzh15<\/p>/);
  assert.ok(!ud.includes('## '), 'ingen raa havelaage tilbage');
});

test('en liste behoever ikke staa alene: overskrift, felter og billede i ét', () => {
  // Den gamle brugte `linjer.every(...)`, saa ét billede midt i en liste
  // gjorde HELE blokken til ét afsnit med raa markdown.
  const ud = md(`## Opgaver\n- [ ] noget\n![skaerm.png](sagu:${HEX})\n- [x] andet`);
  assert.match(ud, /<h4>Opgaver<\/h4>/);
  assert.equal((ud.match(/<ul class="tjekliste">/g) || []).length, 2, 'billedet deler listen i to');
  assert.match(ud, /<img class="mdbillede" src="\/api\/v1\/sagu\/file\?id=a{32}"/);
});

test('et Sagu-billede vises; alt andet bliver en maerkat', () => {
  /*
   * Sagus billeder ligger bag dens noegle og hentes gennem dodas egen server.
   * En adresse ude i verden hentes IKKE: den ville sende brugerens IP til et
   * fremmed websted, blot fordi noten naevnte det.
   */
  assert.match(md(`![et navn](sagu:${HEX})`), /<img class="mdbillede"[^>]*alt="et navn"/);
  const ude = md('![sporing](https://fremmed.example/pixel.png)');
  assert.ok(!ude.includes('<img'), 'ingen hentning ud i verden');
  assert.match(ude, /<span class="mdbillede-maerkat">sporing<\/span>/);
});

test('et billede bliver ikke til et link med et loest udraabstegn', () => {
  /*
   * `linkify` matcher `[navn](adresse)`, og det moenster staar INDE i
   * `![navn](adresse)`. Uden at skaere billedet ud foerst gav en http-adresse
   * »!<a href=...>navn</a>«.
   */
  const ud = md('![billede](https://eksempel.dk/a.png)');
  assert.ok(!ud.includes('!<a'), 'intet loest udraabstegn foran et anker');
  assert.ok(!ud.includes('<a '), 'et billede er ikke et link');
});

test('kun 32 hex er en Sagu-fil - en note bestemmer ikke, hvad serveren henter', () => {
  // Ellers kunne en note pege dodas server hvorhen som helst.
  for (const slem of ['sagu:../../etc/passwd', 'sagu:' + 'a'.repeat(31), 'sagu:xyz',
    'sagu:' + 'a'.repeat(32) + 'b', 'SAGU:javascript:alert(1)']) {
    const ud = md(`![x](${slem})`);
    assert.ok(!ud.includes('<img'), `${slem} maa ikke blive til et billede`);
  }
  // Store bogstaver i et gyldigt id er stadig gyldigt - og saenkes.
  assert.match(md(`![x](sagu:${'A'.repeat(32)})`), /id=a{32}"/);
});

test('ESCAPEN holder - ogsaa gennem alt, adresser og overskrifter', () => {
  /*
   * Rendereren bygger kun de tags, den selv skriver. Der maa ikke findes en
   * vej fra en fremmed note til et tag, doda ikke har lavet.
   */
  const proever = [
    '<script>alert(1)</script>',
    '## <img src=x onerror=alert(1)>',
    '- [ ] <b>fed</b>',
    '> <iframe src="evil"></iframe>',
    `![" onerror="alert(1)](sagu:${HEX})`,
    '**<script>x</script>**',
  ];
  /*
   * Proeven er en HVIDLISTE over tags, ikke en jagt paa ordet »onerror«.
   *
   * Foerste udgave ledte efter tegnfoelger i hele svaret og faldt over
   * `&lt;img src=x onerror=alert(1)&gt;` - som er praecis dét, escapen skal
   * lave: harmloes TEKST. En proeve, der ikke kan skelne et tag fra teksten om
   * et tag, siger intet om sikkerheden.
   */
  const TILLADTE = new Set(['p', 'br', 'ul', 'ol', 'li', 'blockquote', 'code', 'strong', 'em',
    'h3', 'h4', 'h5', 'h6', 'a', 'img', 'input', 'span']);
  for (const p of proever) {
    const ud = md(p);
    const tags = [...ud.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
    for (const t of tags) {
      assert.ok(TILLADTE.has(t), `uventet tag <${t}> fra: ${p} -> ${ud}`);
    }
  }

  // Og det farlige skal staa som TEKST - altsaa escaped.
  assert.match(md('<script>alert(1)</script>'), /&lt;script&gt;/);
  assert.match(md('## <img src=x onerror=alert(1)>'), /<h4>&lt;img src=x onerror=alert\(1\)&gt;<\/h4>/);

  // Et `alt`, der proever at bryde ud af sin egen attribut.
  const alt = md(`![" onerror="alert(1)](sagu:${HEX})`);
  assert.ok(!/onerror="alert/.test(alt), 'anfoerselstegnet i alt skal vaere escaped');
  assert.match(alt, /alt="&quot;/);
});

test('almindelig markdown virker som foer', () => {
  assert.match(md('- et\n- to'), /<ul><li>et<\/li><li>to<\/li><\/ul>/);
  assert.match(md('1. et\n2. to'), /<ol><li>et<\/li><li>to<\/li><\/ol>/);
  assert.match(md('> citat'), /<blockquote>citat<\/blockquote>/);
  assert.match(md('**fed** og *kursiv* og `kode`'),
    /<strong>fed<\/strong> og <em>kursiv<\/em> og <code>kode<\/code>/);
  assert.match(md('[doda](https://doda.dk)'), /<a href="https:\/\/doda\.dk"/);
  assert.equal(md(''), '');
  assert.equal(md(null), '');
});
