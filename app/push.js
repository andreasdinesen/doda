'use strict';
/*
 * doda - Web Push. Paamindelser paa opgaver med klokkeslaet, ogsaa naar
 * appen er lukket.
 *
 * DESIGN.md siger, at kalenderfeedet er den primaere vej (v12): den virker
 * uden tilladelser og uden noegler. Push er til den, der IKKE abonnerer med
 * sin kalender - og paa iOS kun, naar appen ligger paa hjemmeskaermen.
 *
 * TO VALG GOER DET SMAAT NOK TIL EN RUNE UDEN PAKKER:
 *
 * 1. VAPID med node:crypto. Et P-256-noeglepar og et ES256-JWT er alt, hvad
 *    en push-tjeneste kraever for at tro paa afsenderen. Den ene faelde er,
 *    at signaturen skal vaere RAA r||s (64 b) - Node giver DER som standard,
 *    saa `dsaEncoding: 'ieee-p1363'` er ikke valgfri.
 *
 * 2. INGEN NYTTELAST. RFC 8291's kryptering (ECDH + HKDF + aes128gcm) er
 *    ~70 linjer fedtet kryptokode, man selv skal holde rigtig. En tom push
 *    vaekker service workeren, som saa henter fra serveren, hvad den skal
 *    vise. Gevinsten er stoerre end sparede linjer: Apples og Googles
 *    push-tjenester ser aldrig, hvad opgaverne hedder.
 */

const crypto = require('node:crypto');
const https = require('node:https');

const b64u = (b) => Buffer.from(b).toString('base64url');

function opret(srv) {
  /** Noeglerne laves ÉN gang og bliver liggende - skifter de, doer alle abonnementer. */
  function noegler() {
    const gemt = srv.hentVapid();
    if (gemt) {
      return {
        offentlig: gemt.offentlig,
        privat: crypto.createPrivateKey({ key: Buffer.from(gemt.privat, 'base64'), format: 'der', type: 'pkcs8' }),
      };
    }
    const par = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = par.publicKey.export({ format: 'jwk' });
    // Den offentlige noegle skal vaere det UKOMPRIMEREDE punkt: 0x04 ‖ x ‖ y.
    const raa = Buffer.concat([Buffer.from([4]),
      Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    const offentlig = b64u(raa);
    srv.gemVapid(offentlig, par.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
    return { offentlig, privat: par.privateKey };
  }

  function offentligNoegle() {
    return noegler().offentlig;
  }

  /** Ét JWT pr. push-tjeneste, gyldigt 12 timer. */
  function autorisation(endpoint) {
    const { offentlig, privat } = noegler();
    const u = new URL(endpoint);
    const hoved = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const krop = b64u(JSON.stringify({
      aud: u.origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: srv.kontakt(),
    }));
    const sig = crypto.sign('sha256', Buffer.from(`${hoved}.${krop}`),
      { key: privat, dsaEncoding: 'ieee-p1363' });   // raa r||s, ikke DER
    return `vapid t=${hoved}.${krop}.${b64u(sig)},k=${offentlig}`;
  }

  /**
   * Headerne paa en push. Egen funktion, saa de kan proeves.
   *
   * `Urgency` er den, der manglede. Uden headeren er hastegraden »normal«
   * (RFC 8030 §5.3), og saa MAA push-tjenesten udsaette leveringen af hensyn
   * til modtagerens stroem - Apple skriver det selv. En tom push, hvis eneste
   * formaal er at vaekke service workeren, saa den kan vise en paamindelse,
   * der forfalder NU, taaler ikke at blive udsat: kommer den en time senere,
   * er den ikke laengere en paamindelse.
   *
   * Det er ikke bevist, at det var DEN, der holdt notifikationerne vaek fra
   * iPhonen - Apple kvitterede med 201 hele vejen, og 201 betyder »modtaget«,
   * ikke »leveret«. Men det er en header, specifikationen siger skal vaere
   * der, naar leveringen ikke kan vente, og den var her ikke.
   */
  function headere(endpoint) {
    return {
      Authorization: autorisation(endpoint),
      TTL: '3600',
      Urgency: 'high',
      'Content-Length': 0,
    };
  }

  /**
   * Sender en tom push.
   *
   * @returns {Promise<{ok: boolean, borte: boolean}>} borte = abonnementet
   *   findes ikke laengere og skal slettes (404/410 er push-tjenesternes maade
   *   at sige, at brugeren har afinstalleret eller ryddet op).
   */
  function sendTil(endpoint) {
    return new Promise((ok) => {
      let u;
      try { u = new URL(endpoint); } catch { ok({ ok: false, borte: true }); return; }
      if (u.protocol !== 'https:') { ok({ ok: false, borte: true }); return; }

      const req = https.request({
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: headere(endpoint),
        timeout: 10000,
      }, (res) => {
        /*
         * Kroppen med, naar det gik galt. Apple og Google skriver HVORFOR de
         * afviste (»VapidPkHashMismatch«, »BadJwtToken«), og uden den er en
         * 400 bare en 400 - man kan ikke se, om det er noeglen, `sub` eller
         * uret, der er galt.
         */
        /*
         * Apples kvittering. `apns-id` er det eneste haandtag, der findes paa
         * en enkelt push - uden det kan man ikke skelne »den blev modtaget«
         * fra »den blev leveret«, og hele fejlsoegningen bestaar i netop den
         * forskel. Det er ikke en hemmelighed: det er Apples eget kvitterings-
         * nummer, ikke abonnementet.
         */
        const apnsId = res.headers['apns-id'] || null;
        const godt = res.statusCode >= 200 && res.statusCode < 300;
        if (godt) {
          res.resume();
          ok({ ok: true, borte: false, status: res.statusCode, apnsId });
          return;
        }
        let tekst = '';
        res.on('data', (d) => { if (tekst.length < 400) tekst += d; });
        res.on('end', () => ok({
          ok: false,
          borte: res.statusCode === 404 || res.statusCode === 410,
          status: res.statusCode,
          apnsId,
          besked: String(tekst).trim().slice(0, 200) || null,
        }));
      });
      req.on('timeout', () => { req.destroy(); ok({ ok: false, borte: false }); });
      req.on('error', () => ok({ ok: false, borte: false }));
      req.end();
    });
  }

  return { offentligNoegle, sendTil, headere };
}

module.exports = { opret };
