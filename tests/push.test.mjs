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
import { createECDH, randomBytes, createHmac, createDecipheriv } from 'node:crypto';
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


/* ==================== nyttelasten (RFC 8291) ==================== */

/**
 * MODTAGERSIDEN, skrevet forfra.
 *
 * Det er hele pointen med den her prøve. En kryptering, der kun er enig med
 * sig selv, er ikke bevist - og der er ingen Apple at spoerge. Dekrypteringen
 * her deler ingen kode med `krypter()`: den foelger RFC 8188 og 8291, som en
 * browser ville goere det, og hvis de to er uenige, fejler den.
 */
function dekrypter(krop, uaPrivat, uaOffentlig, hemmelighed) {
  const salt = krop.subarray(0, 16);
  const idlen = krop[20];
  const asOffentlig = krop.subarray(21, 21 + idlen);
  const lukket = krop.subarray(21 + idlen);

  const delt = uaPrivat.computeSecret(asOffentlig);
  const hmac = (n, d) => createHmac('sha256', n).update(d).digest();
  const nul = Buffer.from([0]);
  const en = Buffer.from([1]);

  const prkNoegle = hmac(hemmelighed, delt);
  const ikm = hmac(prkNoegle, Buffer.concat([
    Buffer.from('WebPush: info', 'utf8'), nul, uaOffentlig, asOffentlig, en]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([
    Buffer.from('Content-Encoding: aes128gcm', 'utf8'), nul, en])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([
    Buffer.from('Content-Encoding: nonce', 'utf8'), nul, en])).subarray(0, 12);

  const tag = lukket.subarray(lukket.length - 16);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(tag);
  const klar = Buffer.concat([d.update(lukket.subarray(0, lukket.length - 16)), d.final()]);
  assert.equal(klar[klar.length - 1], 2, 'sidste record skal vaere markeret 0x02');
  return JSON.parse(klar.subarray(0, klar.length - 1).toString('utf8'));
}

/** Et abonnement, som en browser ville lave det. */
function nyEnhed() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privat: ecdh,
    offentlig: ecdh.getPublicKey(),
    hemmelighed: randomBytes(16),
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16),
  };
}

test('en krypteret nyttelast kan pakkes ud igen af modtageren', () => {
  const e = nyEnhed();
  const p = nyPush();
  const besked = { web_push: 8030, notification: { title: 'Ring til Nora', body: 'Due at 20:20' } };
  const krop = p.krypter(besked, e.p256dh, e.hemmelighed.toString('base64url'));
  assert.deepEqual(dekrypter(krop, e.privat, e.offentlig, e.hemmelighed), besked);
});

test('hovedet har den form, RFC 8188 kraever', () => {
  const e = nyEnhed();
  const krop = nyPush().krypter({ a: 1 }, e.p256dh, e.hemmelighed.toString('base64url'));
  assert.equal(krop.readUInt32BE(16), 4096, 'record size');
  assert.equal(krop[20], 65, 'noeglen er det UKOMPRIMEREDE punkt, 65 bytes');
  assert.equal(krop[21], 4, 'og den begynder med 0x04');
});

test('to pushes til samme enhed deler ALDRIG salt eller noegle', () => {
  // Genbrugt salt+noegle med samme nonce braekker AES-GCM helt. Hver push
  // laver derfor sit eget efemere noeglepar - ikke ét pr. abonnement.
  const e = nyEnhed();
  const p = nyPush();
  const a = p.krypter({ n: 1 }, e.p256dh, e.hemmelighed.toString('base64url'));
  const b = p.krypter({ n: 1 }, e.p256dh, e.hemmelighed.toString('base64url'));
  assert.notEqual(a.subarray(0, 16).toString('hex'), b.subarray(0, 16).toString('hex'), 'salt');
  assert.notEqual(a.subarray(21, 86).toString('hex'), b.subarray(21, 86).toString('hex'), 'noegle');
});

test('en forkert auth-hemmelighed kan ikke pakke den ud', () => {
  const e = nyEnhed();
  const krop = nyPush().krypter({ x: 1 }, e.p256dh, randomBytes(16).toString('base64url'));
  assert.throws(() => dekrypter(krop, e.privat, e.offentlig, e.hemmelighed));
});

test('noegler i forkert laengde afvises frem for at give noget ubrugeligt', () => {
  const p = nyPush();
  assert.throws(() => p.krypter({ x: 1 }, 'kort', randomBytes(16).toString('base64url')),
    /forkert laengde/);
});

test('med nyttelast: aes128gcm-headerne og en KORT TTL', () => {
  const krop = Buffer.alloc(120);
  const h = nyPush().headere(APPLE, krop);
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.equal(h['Content-Type'], 'application/octet-stream');
  assert.equal(h['Content-Length'], 120);
  assert.equal(h.Urgency, 'high');
  // Teksten er laagt fast ved afsendelsen: en paamindelse, der ligger i koe i
  // en time, kan naa at handle om noget, der er klaret.
  assert.equal(h.TTL, '600');
});

test('uden nyttelast er headerne som foer', () => {
  const h = nyPush().headere(APPLE);
  assert.equal(h['Content-Length'], 0);
  assert.equal(h['Content-Encoding'], undefined, 'en tom push maa ikke paastaa en kodning');
  assert.equal(h.TTL, '3600');
});

/* ==================== den deklarative form ==================== */

test('nyttelasten er deklarativ - saa systemet kan vise den uden en worker', () => {
  const n = nyPush('https://doda.eksempel.dk').nyttelast({
    titel: 'Ring til Nora', tekst: 'Due at 20:20',
  });
  // 8030 er RFC-nummeret for Web Push og markoeren, Safari kigger efter.
  // Uden den er det bare en almindelig push, og saa skal workeren vaekkes -
  // hvilket er hele det led, vi forsoeger at komme uden om.
  assert.equal(n.web_push, 8030);
  assert.equal(n.notification.title, 'Ring til Nora');
  assert.equal(n.notification.body, 'Due at 20:20');
  // navigate er paakraevet i formatet.
  assert.equal(n.notification.navigate, 'https://doda.eksempel.dk');
});

test('nyttelasten kan krypteres og laeses som deklarativ hos modtageren', () => {
  // Hele vejen: form -> kryptering -> modtager. Det er den kaede, en rigtig
  // push gaar igennem, og den eneste del, der ikke kan proeves her, er turen
  // til Apple.
  const e = nyEnhed();
  const p = nyPush('https://doda.eksempel.dk');
  const n = p.nyttelast({ titel: '2 tasks are due', tekst: 'Nora \u00b7 Kur' });
  const ud = dekrypter(p.krypter(n, e.p256dh, e.hemmelighed.toString('base64url')),
    e.privat, e.offentlig, e.hemmelighed);
  assert.equal(ud.web_push, 8030);
  assert.equal(ud.notification.title, '2 tasks are due');
});

test('alle adresser i nyttelasten er ABSOLUTTE', () => {
  /* Nyttelasten laeses af SYSTEMET, ikke af en side - der er ingen base at
     oploese en relativ adresse imod. v87 sendte `./icon-192.png`, og en
     streng parser kasserer saa hele notifikationen: Apple kvitterer med et
     apns-id, intet vises, og service workeren vaekkes heller ikke, fordi den
     deklarative vej allerede har slugt pushen (Andreas, 07-09-2026). */
  const n = nyPush('https://doda.eksempel.dk').nyttelast({ titel: 'x', tekst: 'y' });
  for (const [felt, vaerdi] of Object.entries(n.notification)) {
    if (felt === 'title' || felt === 'body') continue;
    assert.match(String(vaerdi), /^https:\/\//,
      `${felt} skal vaere en absolut adresse, ikke »${vaerdi}«`);
  }
});

test('et ikon er ikke vaerd at miste en notifikation for', () => {
  // Kan adressen ikke goeres absolut, udelades ikonet - notifikationen skal
  // stadig kunne vises.
  const n = nyPush('ikke-en-adresse').nyttelast({ titel: 'x', tekst: 'y' });
  assert.equal(n.notification.icon, undefined);
  assert.equal(n.web_push, 8030, 'resten af formen skal stadig vaere hel');
});
