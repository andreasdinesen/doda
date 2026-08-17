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
    await navigator.serviceWorker.register('sw.js', { scope: './' });
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

function lytPaaForbindelse() {
  window.addEventListener('online', () => { opdaterOfflineMaerke(); tomOutbox(); });
  window.addEventListener('offline', opdaterOfflineMaerke);
  opdaterOfflineMaerke();
  tomOutbox();
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
