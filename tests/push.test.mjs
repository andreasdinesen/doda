/* Headerne paa en push. Koer: node --test tests/push.test.mjs
 *
 * Push er det sted i doda, hvor INTET fejler hoejlydt. Apple kvitterer 201,
 * ogsaa naar notifikationen aldrig naar frem - 201 betyder »modtaget«, ikke
 * »leveret« - saa en manglende header giver ingen fejl noget sted. Den kan
 * kun ses ved at kigge paa, hvad der bliver sendt.
 *
 * Derfor er headerne en egen funktion, og derfor proeves de her. `sendTil`
 * bruger PRAECIS den her funktion; det er ikke en afskrift.
 *
 * ── Hvad prøven IKKE daekker ─────────────────────────────────────────────
 *
 * Ingenting sendes. Selve turen til Apple kan ikke proeves uden Apple, og
 * det er den halvdel, fejlen bor i. Prøven kan kun holde fast i, at doda
 * sender det, den skal - ikke at det virker.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const P = require('../app/push.js');

/** En server-attrap: noeglerne bor i hukommelsen i stedet for i databasen. */
function nyPush(kontakt = 'https://doda.eksempel.dk') {
  let gemt = null;
  return P.opret({
    hentVapid: () => gemt,
    gemVapid: (offentlig, privat) => { gemt = { offentlig, privat }; },
    kontakt: () => kontakt,
  });
}

const APPLE = 'https://web.push.apple.com/QAAAAxxxxxxxxxxxx';

test('Urgency: high er med', () => {
  /* Uden headeren er hastegraden »normal« (RFC 8030 §5.3), og saa MAA
     push-tjenesten udsaette leveringen af hensyn til modtagerens stroem.
     En tom push, hvis eneste formaal er at vaekke service workeren, saa den
     kan vise en paamindelse, der forfalder NU, taaler ikke at blive udsat:
     kommer den en time senere, er den ikke laengere en paamindelse. */
  const h = nyPush().headere(APPLE);
  assert.equal(h.Urgency, 'high');
});

test('TTL og en tom krop', () => {
  const h = nyPush().headere(APPLE);
  assert.equal(h.TTL, '3600');
  assert.equal(h['Content-Length'], 0,
    'pushen er TOM med vilje - saa ved Apple aldrig, hvad opgaverne hedder');
});

test('Authorization er en VAPID-header, ikke et Bearer-token', () => {
  const h = nyPush().headere(APPLE);
  assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+,k=[\w-]+$/);
});

test('sub er instansens egen https-adresse - ikke en opdigtet mailto', () => {
  /* verdande brugte lang tid paa praecis den her: en `sub`, der pegede paa en
     mailadresse, ingen ejede, gav 403 fra Apple - og en 403 siger ikke, HVAD
     der er galt. Adressen skal vaere den, doda faktisk svarer paa. */
  const h = nyPush('https://doda.eksempel.dk').headere(APPLE);
  const krop = JSON.parse(Buffer.from(
    h.Authorization.slice('vapid t='.length).split('.')[1], 'base64url').toString('utf8'));
  assert.equal(krop.sub, 'https://doda.eksempel.dk');
  assert.match(krop.aud, /^https:\/\/web\.push\.apple\.com$/,
    'aud skal vaere push-tjenestens ORIGIN, ikke hele endepunktet');
  assert.ok(krop.exp > Math.floor(Date.now() / 1000), 'et udloebet JWT afvises');
});

test('hver push-tjeneste faar sit eget aud', () => {
  const p = nyPush();
  const aud = (ep) => JSON.parse(Buffer.from(
    p.headere(ep).Authorization.slice('vapid t='.length).split('.')[1],
    'base64url').toString('utf8')).aud;
  assert.equal(aud(APPLE), 'https://web.push.apple.com');
  assert.equal(aud('https://fcm.googleapis.com/fcm/send/abc'), 'https://fcm.googleapis.com');
});
