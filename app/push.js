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
 * 2. NYTTELAST - siden v87. Foer var pushen TOM: den vaekkede service
 *    workeren, som selv hentede, hvad den skulle vise. Det sparede ~70
 *    linjer kryptokode og holdt opgavetitlerne vaek fra Apple og Google.
 *
 *    Den foerste halvdel af begrundelsen holdt ikke i praksis. Seks forsoeg
 *    paa at faa en tom push frem paa iPhone slog fejl, og det led, der er
 *    tilbage, er netop dét: at iOS skal VAEKKE en worker og lade den koere
 *    JavaScript, foer noget kan vises. Med en nyttelast kan systemet vise
 *    notifikationen selv (Declarative Web Push) - uden en worker.
 *
 *    Den anden halvdel holder uaendret. Nyttelasten krypteres med
 *    abonnementets egne noegler, som kun findes paa enheden: push-tjenesten
 *    videresender en byteklump, den ikke kan laese. Det var aldrig
 *    tomheden, der beskyttede titlerne - det er krypteringen, og den er nu
 *    skrevet i stedet for undgaaet.
 *
 *    Den tomme push er stadig vejen, naar et abonnement mangler noegler.
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
   * Notifikationen, som den skal se ud - laagt fast HER, ikke i workeren.
   *
   * `web_push: 8030` er markoeren, der goer den deklarativ: kan browseren
   * laese den, viser SYSTEMET notifikationen uden at starte service workeren,
   * og det er praecis det led, seks forsoeg er strandet paa. Kan den ikke,
   * faar workeren nyttelasten i `event.data` og viser den samme tekst. Ét
   * kald daekker begge - det er derfor, det er en tilfoejelse og ikke et
   * skifte.
   *
   * `navigate` er paakraevet i formatet og skal vaere instansens egen
   * adresse - den samme, `sub` i VAPID-tokenet bruger.
   */
  function nyttelast({ titel, tekst }) {
    return {
      web_push: 8030,
      notification: {
        title: titel,
        body: tekst,
        navigate: srv.kontakt(),
        icon: './icon-192.png',
      },
    };
  }

  /**
   * Krypterer en payload til ét abonnement (RFC 8291 »aes128gcm«).
   *
   * ── Hvorfor der nu ER en payload ─────────────────────────────────────
   *
   * doda's push var TOM: service workeren blev vaekket og hentede selv, hvad
   * den skulle vise. Fem forsoeg paa at faa den til at komme frem paa iPhone
   * slog fejl, og det led, der er tilbage, er netop dét: at iOS skal vaekke
   * en worker og lade den koere JavaScript, foer noget kan vises.
   *
   * Med en payload kan systemet vise notifikationen SELV (Declarative Web
   * Push) - uden at starte workeren.
   *
   * ── Og hvorfor det ikke koster hemmeligheden ─────────────────────────
   *
   * Payloaden krypteres med abonnementets EGNE noegler (`p256dh`/`auth`),
   * som kun findes paa enheden. Apple videresender en byteklump, den ikke
   * kan laese; Safari dekrypterer den lokalt. Loeftet i README - at
   * push-tjenesten aldrig laerer, hvad opgaverne hedder - holder derfor
   * uaendret. Det er ikke en afvejning, det er den samme egenskab opnaaet
   * paa en anden maade.
   *
   * Én ting bliver anderledes: teksten laegges fast ved AFSENDELSEN. Lukkes
   * opgaven, inden pushen naar frem, kan notifikationen naa at vise noget,
   * der allerede er klaret. Derfor er TTL kort.
   */
  function krypter(payload, p256dh, auth) {
    const klartekst = Buffer.from(JSON.stringify(payload), 'utf8');
    const ua = Buffer.from(p256dh, 'base64url');      // 0x04 ‖ x ‖ y, 65 b
    const hemmelighed = Buffer.from(auth, 'base64url'); // 16 b
    if (ua.length !== 65 || hemmelighed.length !== 16) {
      throw new Error('abonnementets noegler har forkert laengde');
    }

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const as = ecdh.getPublicKey();                 // vores egen, 65 b
    const delt = ecdh.computeSecret(ua);            // 32 b

    const salt = crypto.randomBytes(16);
    const hmac = (noegle, data) => crypto.createHmac('sha256', noegle).update(data).digest();
    const nul = Buffer.from([0]);
    const en = Buffer.from([1]);

    // RFC 8291 §3.4: begge offentlige noegler indgaar i info-strengen, saa
    // noeglen er bundet til PRAECIS dette par - ikke bare til hemmeligheden.
    const prkNoegle = hmac(hemmelighed, delt);
    const noegleInfo = Buffer.concat([Buffer.from('WebPush: info', 'utf8'), nul, ua, as, en]);
    const ikm = hmac(prkNoegle, noegleInfo);

    // RFC 8188: herfra er det almindelig aes128gcm-indpakning.
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.concat([
      Buffer.from('Content-Encoding: aes128gcm', 'utf8'), nul, en])).subarray(0, 16);
    const nonce = hmac(prk, Buffer.concat([
      Buffer.from('Content-Encoding: nonce', 'utf8'), nul, en])).subarray(0, 12);

    // 0x02 markerer den SIDSTE record. Med 0x01 ville modtageren vente paa
    // mere og kassere det hele.
    const post = Buffer.concat([klartekst, Buffer.from([2])]);
    const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const lukket = Buffer.concat([c.update(post), c.final(), c.getAuthTag()]);

    const rs = Buffer.alloc(4);
    rs.writeUInt32BE(4096, 0);
    return Buffer.concat([salt, rs, Buffer.from([as.length]), as, lukket]);
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
  function headere(endpoint, krop) {
    const h = {
      Authorization: autorisation(endpoint),
      // Kort TTL, naar der er en payload: teksten er laagt fast ved
      // afsendelsen, og en paamindelse, der ligger i koe i en time, kan naa
      // at handle om noget, der er klaret. Uden payload henter workeren selv
      // det friske, og saa maa den gerne vente.
      TTL: krop ? '600' : '3600',
      Urgency: 'high',
      'Content-Length': krop ? krop.length : 0,
    };
    if (krop) {
      h['Content-Encoding'] = 'aes128gcm';
      h['Content-Type'] = 'application/octet-stream';
    }
    return h;
  }

  /**
   * Sender en tom push.
   *
   * @returns {Promise<{ok: boolean, borte: boolean}>} borte = abonnementet
   *   findes ikke laengere og skal slettes (404/410 er push-tjenesternes maade
   *   at sige, at brugeren har afinstalleret eller ryddet op).
   */
  function sendTil(endpoint, abon) {
    return new Promise((ok) => {
      let u;
      try { u = new URL(endpoint); } catch { ok({ ok: false, borte: true }); return; }
      if (u.protocol !== 'https:') { ok({ ok: false, borte: true }); return; }

      /*
       * Payloaden er en TILFOEJELSE, ikke et krav.
       *
       * Mangler abonnementet noegler - de aeldste raekker blev gemt, foer der
       * var brug for dem - sendes den tomme push som foer. En enhed maa ikke
       * holde op med at faa besked, fordi den blev tilmeldt for laenge siden.
       */
      let krop = null;
      if (abon && abon.payload && abon.p256dh && abon.auth) {
        try { krop = krypter(abon.payload, abon.p256dh, abon.auth); } catch { krop = null; }
      }

      const req = https.request({
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: headere(endpoint, krop),
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
      if (krop) req.write(krop);
      req.end();
    });
  }

  return { offentligNoegle, sendTil, headere, krypter, nyttelast };
}

module.exports = { opret };
