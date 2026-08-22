'use strict';
/* doda - service worker, offline-tilstand og fangst-koe.
 *
 * Fangst skal virke offline (handover §5.1). Koen ligger i appen, ikke i
 * service workeren: en SW, der gemte POST'er, ville sende dem i tilfaeldig
 * raekkefolge og uden at kunne fortaelle brugeren, hvad der skete. */

const OUTBOX_NOEGLE = 'doda_outbox';

/* ------------------------------------------------------- service worker */

async function registrerSW() {
  // Service workers kraever secure context. Panelet tilgas pa IP:port over
  // http - dér skal appen bare virke uden, ikke fejle (RUNE-ERFARINGER §4).
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  if (state.config.dev) {
    // Under udvikling ville en SW servere gammel kode i det uendelige.
    const alle = await navigator.serviceWorker.getRegistrations();
    for (const r of alle) await r.unregister();
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });

    /*
     * En PWA paa hjemmeskaermen bliver maaske ALDRIG genindlaest: den lukkes
     * ikke, den skjules. Uden et kald til update() opdager den derfor aldrig,
     * at der ligger en ny sw.js - og saa serverer den gamle cache videre i
     * det uendelige. Andreas' telefon stod paa v33, mens serveren var paa
     * v38, og fejl, der var rettet for laengst, blev ved med at vise sig.
     *
     * Registreringen ovenfor tjekker kun ved sideindlaesning. Her tjekker vi
     * ogsaa, hver gang appen kommer frem igen - samme oejeblik som den henter
     * data (DESIGN.md §v26). Det er ét kald, og det er gratis, naar der
     * ingen ny version er.
     */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* offline er fint */ });
    });

    /*
     * Naar en ny SW har taget over, koerer den GAMLE app.js stadig i siden -
     * skipWaiting() skifter arbejderen ud, ikke koden foran brugeren. Derfor
     * genindlaeser vi, men KUN hvis der var en controller i forvejen: ved
     * allerfoerste registrering fyrer controllerchange ogsaa (clients.claim),
     * og der ville en genindlaesning vaere stoej ved hver ny installation.
     */
    const havdeStyring = !!navigator.serviceWorker.controller;
    let genindlaeser = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!havdeStyring || genindlaeser) return;
      genindlaeser = true;
      window.location.reload();
    });
  } catch {
    /* Uden SW mister vi kun offline-laesning - appen virker uaendret. */
  }
}

/* ----------------------------------------------------------- fangst-koe */

function laesOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_NOEGLE) || '[]'); } catch { return []; }
}

function skrivOutbox(koe) {
  try { localStorage.setItem(OUTBOX_NOEGLE, JSON.stringify(koe.slice(0, 500))); } catch { /* fuldt lager */ }
  afventendeCache = null;
}

/**
 * Laegger en handling i koen.
 *
 * En STRENG er en fangst - saadan sa koen ud foer v11, og der kan ligge
 * saadanne poster paa telefonen lige nu. De skal stadig sendes, saa formen
 * er bagudkompatibel og maa aldrig blive det modsatte.
 */
function laegIKoe(post) {
  const koe = laesOutbox();
  koe.push(Object.assign({ id: nyId(), ts: Date.now() },
    typeof post === 'string' ? { type: 'capture', text: post } : post));
  skrivOutbox(koe);
  opdaterOfflineMaerke();
}

/**
 * Hvilke elementer venter der en handling paa?
 *
 * Bruges til at vise raekken som afventende, saa et tik ikke ser ud til at
 * blive glemt, mens man er offline. Cachet, fordi elementRaekke() spoerger
 * én gang pr. raekke, og localStorage er ikke gratis.
 */
let afventendeCache = null;

function afventende() {
  if (!afventendeCache) {
    afventendeCache = new Map();
    for (const p of laesOutbox()) if (p.item) afventendeCache.set(p.item, p);
  }
  return afventendeCache;
}

/** Ét sted der ved, hvordan hver slags post sendes. */
function sendPost(post) {
  if (post.type === 'complete') return api('POST', `/api/v1/items/${post.item}/complete`, {});
  if (post.type === 'status') return api('POST', `/api/v1/items/${post.item}`, { status: post.status });
  if (post.type === 'delete') return api('DELETE', `/api/v1/items/${post.item}`, {});
  // Uden type er det en fangst fra en tidligere udgave.
  return api('POST', '/api/v1/capture', { text: post.text, createNew: true });
}

function beskrivPost(post) {
  if (post.type === 'complete') return `completing “${(post.titel || '').slice(0, 30)}”`;
  if (post.type === 'status') return `moving “${(post.titel || '').slice(0, 30)}”`;
  if (post.type === 'delete') return `deleting “${(post.titel || '').slice(0, 30)}”`;
  return `“${String(post.text || '').slice(0, 30)}…”`;
}

/** En fejl UDEN status er et netvaerksbrud; med status er det et rigtigt svar. */
function erNetvaerksfejl(ex) {
  return !ex || !ex.status;
}

/**
 * Sender koen. Kaldes ved opstart, naar nettet kommer tilbage, og efter en
 * vellykket fangst.
 *
 * Én ad gangen og i raekkefoelge: to fangster, der blev skrevet i en bestemt
 * orden, skal lande i samme orden. Fejler en pa netvaerket, stopper vi og
 * proever igen senere - resten bliver staaende.
 */
let sender = false;

async function tomOutbox() {
  if (sender || !navigator.onLine) return;
  let koe = laesOutbox();
  if (!koe.length) return;
  sender = true;
  let sendt = 0;
  try {
    while (koe.length) {
      const post = koe[0];
      try {
        await sendPost(post);
        sendt++;
      } catch (ex) {
        if (erNetvaerksfejl(ex)) break;
        // Et rigtigt afslag (fx en opgave, der er slettet i mellemtiden) ma
        // ikke blokere koen for evigt.
        toast(`Could not finish ${beskrivPost(post)}: ${ex.message}`);
      }
      koe = laesOutbox().slice(1);
      skrivOutbox(koe);
    }
  } finally {
    sender = false;
  }
  opdaterOfflineMaerke();
  if (sendt) {
    toast(`Sent ${sendt} change${sendt === 1 ? '' : 's'} made offline`);
    await genindlaes();
  }
}

/* --------------------------------------------------------- offline-mærke */

function opdaterOfflineMaerke() {
  const host = document.getElementById('offlineMark');
  if (!host) return;
  const koe = laesOutbox().length;
  const offline = !navigator.onLine;
  host.hidden = !offline && !koe;
  if (host.hidden) return;
  host.innerHTML = offline
    ? `${icon('calm', 14)}<span>Offline${koe ? ` · ${koe} waiting to send` : ' · showing what was last loaded'}</span>`
    : `${icon('calm', 14)}<span>${koe} waiting to send</span>`;
}

/* ------------------------------------------------------------- synk */

/*
 * Paa hjemmeskaermen bliver appen ALDRIG genindlaest. Den ligger i baggrunden,
 * og naar man vender tilbage, staar der praecis det, der stod, da man gik -
 * ogsaa selv om man har fanget noget fra Siri eller rettet noget paa en anden
 * enhed imens. Foer v26 var den eneste vej til friske data at skifte skaerm,
 * fordi hvert sideskift henter sin egen liste. Det er ikke en indstilling,
 * brugeren skal kende: en app, der viser gamle tal, er en app, man holder op
 * med at stole paa.
 *
 * To ting loeser det, og de skal begge to vaere der:
 *   - AUTOMATISK, naar appen kommer frem igen (visibilitychange), naar den
 *     genskabes fra bfcache (pageshow), og naar forbindelsen vender tilbage.
 *   - EN SYNLIG KNAP, der ogsaa siger HVORNAAR der sidst blev hentet. Uden
 *     det svar kan man ikke vide, om der ikke er sket noget, eller om appen
 *     bare ikke har spurgt.
 */
const synkState = { sidst: Date.now(), koerer: false };

/** Hvor gammelt er det, man ser paa? Kort og uden falsk praecision. */
function synkAlder() {
  const sek = Math.round((Date.now() - synkState.sidst) / 1000);
  if (sek < 45) return 'just now';
  const min = Math.round(sek / 60);
  if (min < 60) return `${min} min ago`;
  const timer = Math.round(min / 60);
  return timer < 24 ? `${timer} h ago` : 'a while ago';
}

function tegnSynkMaerke() {
  const el = document.getElementById('syncLabel');
  if (!el) return;
  el.textContent = synkState.koerer ? 'syncing…' : synkAlder();
  const knap = document.getElementById('syncBtn');
  if (knap) knap.classList.toggle('koerer', synkState.koerer);
}

/**
 * Henter state og den aktuelle side igen.
 *
 * `manuel` = brugeren trykkede selv. Kun da kvitteres der; en automatisk synk
 * skal vaere lydloes, ellers popper der en toast op, hver gang telefonen
 * laases op.
 */
async function synk(manuel) {
  if (synkState.koerer) return;
  if (!navigator.onLine) {
    opdaterOfflineMaerke();
    if (manuel) toast('No connection — showing what was last loaded.');
    return;
  }
  synkState.koerer = true;
  tegnSynkMaerke();
  stilleGentegning = true;
  try {
    await genindlaes();
    synkState.sidst = Date.now();
  } finally {
    stilleGentegning = false;
    synkState.koerer = false;
    tegnSynkMaerke();
  }
  if (manuel) toast('Up to date');
}

function lytPaaForbindelse() {
  window.addEventListener('online', () => {
    opdaterOfflineMaerke();
    // Koeen foerst: det, man selv har lavet, skal ind, foer man henter ned.
    tomOutbox().then(() => synk(false));
  });
  window.addEventListener('offline', opdaterOfflineMaerke);

  /* Appen kommer frem igen. Vaerdien af et par sekunders spaerre er, at et
     tilladelses-ark eller en delefunktion, der blinker forbi, ikke udloeser
     en hentning - ikke at spare kald. */
  const naarSynlig = () => {
    if (document.visibilityState !== 'visible') return;
    // Er der kommet en ny udgave, mens appen laa i baggrunden? Det er netop
    // dét oejeblik, en telefon vender tilbage efter en opdatering.
    if (state.user) tjekVersion();
    if (Date.now() - synkState.sidst < 3000) { tegnSynkMaerke(); return; }
    synk(false);
  };
  document.addEventListener('visibilitychange', naarSynlig);
  window.addEventListener('pageshow', naarSynlig);
  window.addEventListener('focus', naarSynlig);

  // Etiketten skal ikke lyve, mens appen ligger aaben: "just now" er forkert
  // ti minutter senere. Ét minut er rigeligt praecist til "min ago".
  setInterval(tegnSynkMaerke, 30000);

  opdaterOfflineMaerke();
  tegnSynkMaerke();
  tomOutbox();
  traekForNyt();
  visOpdaterBaand();
}

/*
 * Traek ned for at hente nyt - paa telefonen.
 *
 * Appen henter selv, naar den kommer frem igen (§v26), men staar den aaben,
 * mens noget aendrer sig et andet sted - en mail fra MsGraphBud, en note fra
 * en anden enhed - er der ingen maade at bede om det paa. Paa skrivebordet er
 * der synk-maerket oeverst at trykke paa; paa telefonen er det for lille og
 * for langt oppe.
 *
 * Ingen `preventDefault`: lytterne er passive, og vi rykker aldrig i selve
 * rulningen. Vi reagerer kun, naar siden ALLEREDE er i top og fingeren gaar
 * nedad - saa er der ikke noget at rulle, og browserens egen bounce er den
 * eneste bevaegelse, vi laegger os oven paa.
 */
function traekForNyt() {
  // En mus har ingen »traek ned fra toppen«. Kun touch.
  if (!('ontouchstart' in window)) return;

  const TAERSKEL = 72;      // hvor langt der skal traekkes
  const MAKS = 110;         // hvor langt maerket foelger med
  let startY = 0;
  let aktiv = false;
  let afstand = 0;
  let el = null;

  const maerke = () => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'traekny';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  };

  const vis = (d, tekst) => {
    const m = maerke();
    m.textContent = tekst;
    m.style.transform = `translate(-50%, ${Math.min(d, MAKS)}px)`;
    m.classList.add('paa');
  };

  const skjul = () => {
    if (!el) return;
    el.classList.remove('paa');
    el.style.transform = 'translate(-50%, 0)';
  };

  /* En aaben rude eller menu ejer skaermen. Traekker man dér, er det
     indholdet i ruden, man vil rulle - ikke appen, man vil genindlaese. */
  const optaget = () => document.body.classList.contains('navopen')
    || !!(document.getElementById('modalHost') || {}).firstChild;

  window.addEventListener('touchstart', (e) => {
    aktiv = !optaget() && window.scrollY <= 0 && e.touches.length === 1;
    startY = aktiv ? e.touches[0].clientY : 0;
    afstand = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!aktiv) return;
    // Ruller siden alligevel, er det ikke et traek - saa slip det.
    if (window.scrollY > 0) { aktiv = false; skjul(); return; }
    afstand = e.touches[0].clientY - startY;
    if (afstand <= 0) { skjul(); return; }
    vis(afstand, afstand >= TAERSKEL ? 'Release to refresh' : 'Pull to refresh');
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (!aktiv) return;
    aktiv = false;
    if (afstand < TAERSKEL) { skjul(); return; }
    // Maerket bliver staaende, mens der hentes - ellers ser det ud, som om
    // traekket ikke gjorde noget.
    vis(TAERSKEL, 'Refreshing…');
    Promise.resolve(synk(true)).finally(skjul);
  }, { passive: true });

  window.addEventListener('touchcancel', () => { aktiv = false; skjul(); }, { passive: true });
}

/* ------------------------------------------------------------ passkeys */

const kanPasskeys = () => !!(window.PublicKeyCredential && window.isSecureContext);

const fraB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')
  .padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const tilB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Opretter en passkey pa denne enhed. */
async function opretPasskey(navn) {
  const o = await api('POST', '/api/webauthn/register/options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.user.id = fraB64u(pk.user.id);
  pk.excludeCredentials = (pk.excludeCredentials || []).map((c) => ({ type: 'public-key', id: fraB64u(c.id) }));
  const cred = await navigator.credentials.create({ publicKey: pk });
  return api('POST', '/api/webauthn/register/verify', {
    challengeId: o.challengeId,
    name: navn,
    attestationObject: tilB64u(cred.response.attestationObject),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
  });
}

/** Logger ind uden brugernavn - noeglen ved selv, hvem den hoerer til. */
async function loginMedPasskey() {
  const o = await api('POST', '/api/webauthn/login/options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.allowCredentials = [];
  const cred = await navigator.credentials.get({ publicKey: pk });
  return api('POST', '/api/webauthn/login/verify', {
    challengeId: o.challengeId,
    id: tilB64u(cred.rawId),
    authenticatorData: tilB64u(cred.response.authenticatorData),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
    signature: tilB64u(cred.response.signature),
  });
}

async function tegnPasskeys() {
  const host = document.getElementById('pkList');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/passkeys');
    const blokeret = d.blocked || (!kanPasskeys() && 'This browser cannot use passkeys.');
    host.innerHTML = `
      ${d.credentials.length ? d.credentials.map((c) => `
        <div class="keyrow">
          <div class="keyrow-main">
            <div class="keyrow-name">${esc(c.name)}</div>
            <div class="meta">${esc(c.alg)} · added ${esc(visTid(c.created_at))} ·
              ${c.last_used_at ? `last used ${esc(visTid(c.last_used_at))}` : 'never used'}</div>
          </div>
          <button class="btn ghost" data-pkdel="${esc(c.id)}">Remove</button>
        </div>`).join('') : '<p class="lead" style="margin:14px 0 0">No passkeys yet.</p>'}
      ${blokeret ? `<p class="gate-note" style="text-align:left">${esc(blokeret)}</p>`
    : '<button class="btn" id="pkAdd" style="margin-top:14px">Add a passkey</button>'}`;

    const tilfoej = host.querySelector('#pkAdd');
    if (tilfoej) {
      tilfoej.addEventListener('click', async () => {
        try {
          await opretPasskey(`${navigator.platform || 'This device'}`.slice(0, 60));
          await tegnPasskeys();
          toast('Passkey added');
        } catch (ex) {
          if (ex.name !== 'NotAllowedError') toast(ex.message || 'Could not add the passkey');
        }
      });
    }
    host.querySelectorAll('[data-pkdel]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('DELETE', `/api/v1/passkeys/${encodeURIComponent(el.dataset.pkdel)}`, {});
        await tegnPasskeys();
        toast('Passkey removed — it stopped working immediately');
      });
    });
  } catch (ex) { host.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }
}


/* ------------------------------------------------------------- push */

/*
 * Web Push. Kalenderfeedet er stadig den primaere vej (DESIGN.md) - den
 * virker uden tilladelser og uden noegler. Det her er til den, der ikke
 * abonnerer med sin kalender.
 *
 * Tre ting skal vaere sande, og appen skal sige HVILKEN der mangler:
 * https, en service worker, og paa iOS at appen ligger paa hjemmeskaermen.
 * En knap, der bare ikke virker, er det vaerste svar.
 */
function pushMuligt() {
  if (!window.isSecureContext) return 'Push needs https. Over plain http the browser has no notifications at all.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // iOS har kun PushManager i en app, der ER lagt paa hjemmeskaermen.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return ios
      ? 'On iPhone this works only when doda is added to your home screen: Share → Add to Home Screen, then open it from there.'
      : 'This browser has no push support.';
  }
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked for this site in your browser settings.';
  }
  return null;
}

async function slaaPushTil() {
  const reg = await navigator.serviceWorker.ready;
  // requestPermission SKAL komme fra et klik - derfor ligger den her og
  // ikke i en opstartsrutine.
  const svar = await Notification.requestPermission();
  if (svar !== 'granted') throw new Error('Notifications were not allowed.');

  const d = await api('GET', '/api/v1/push');
  const abon = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64uTilBytes(d.publicKey),
  });
  const j = abon.toJSON();
  return api('POST', '/api/v1/push', {
    endpoint: j.endpoint,
    p256dh: j.keys && j.keys.p256dh,
    auth: j.keys && j.keys.auth,
  });
}

async function slaaPushFra() {
  const reg = await navigator.serviceWorker.ready;
  const abon = await reg.pushManager.getSubscription();
  if (abon) {
    await api('DELETE', '/api/v1/push', { endpoint: abon.endpoint });
    await abon.unsubscribe();
  } else {
    await api('DELETE', '/api/v1/push', {});
  }
}

/** applicationServerKey vil have raa bytes, ikke base64url. */
function b64uTilBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
