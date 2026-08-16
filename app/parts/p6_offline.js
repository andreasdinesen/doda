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
}

function laegIKoe(tekst) {
  const koe = laesOutbox();
  koe.push({ id: nyId(), text: tekst, ts: Date.now() });
  skrivOutbox(koe);
  opdaterOfflineMaerke();
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
        await api('POST', '/api/v1/capture', { text: post.text, createNew: true });
        sendt++;
      } catch (ex) {
        if (erNetvaerksfejl(ex)) break;
        // Et rigtigt afslag (fx tom tekst) ma ikke blokere koen for evigt.
        toast(`Could not send “${post.text.slice(0, 30)}…”: ${ex.message}`);
      }
      koe = laesOutbox().slice(1);
      skrivOutbox(koe);
    }
  } finally {
    sender = false;
  }
  opdaterOfflineMaerke();
  if (sendt) {
    toast(`Sent ${sendt} thing${sendt === 1 ? '' : 's'} captured offline`);
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
