'use strict';
/* doda - vedhaeftninger: billeder og filer pa opgaver og noter.
 *
 * Filerne hentes ALDRIG med i listerne - elementet baerer kun et antal, og
 * billederne ligger bag deres egne URL'er med "immutable". Det er den dyre
 * lektie fra RUNE-ERFARINGER §4: et login-svar pa 247,9 MB, fordi billeder la
 * inde i de poster, listen hentede. */

const MAX_FIL = 25 * 1024 * 1024;
// Over denne kant skaleres billeder ned FOER upload. Node kan ikke skalere
// uden pakker, sa det skal ske i browseren.
const MAX_KANT = 2200;

function filStr(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const erBillede = (mime) => /^image\/(png|jpeg|gif|webp|avif)$/.test(mime);

/**
 * Skalerer store billeder ned i browseren.
 *
 * PNG bevares som PNG: en JPEG-fallback goer transparens SORT
 * (RUNE-ERFARINGER §4). Og PNG kan ikke kvalitets-komprimeres - skal den
 * mindre, skal den nedskaleres.
 */
async function forberedFil(fil) {
  if (!/^image\/(png|jpeg|webp)$/.test(fil.type)) return { blob: fil, w: null, h: null };

  const url = URL.createObjectURL(fil);
  try {
    const img = await new Promise((ok, fejl) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fejl;
      i.src = url;
    });
    const stoerst = Math.max(img.naturalWidth, img.naturalHeight);
    if (stoerst <= MAX_KANT && fil.size <= MAX_FIL) {
      return { blob: fil, w: img.naturalWidth, h: img.naturalHeight };
    }
    const f = MAX_KANT / stoerst;
    const w = Math.round(img.naturalWidth * f);
    const h = Math.round(img.naturalHeight * f);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const type = fil.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((ok) => c.toBlob(ok, type, type === 'image/jpeg' ? 0.86 : undefined));
    return { blob: blob || fil, w, h };
  } catch {
    return { blob: fil, w: null, h: null };   // uláeseligt billede sendes som det er
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadFil(itemId, fil) {
  const { blob, w, h } = await forberedFil(fil);
  if (blob.size > MAX_FIL) {
    throw new Error(`“${fil.name}” is ${filStr(blob.size)} — the limit is ${filStr(MAX_FIL)}.`);
  }
  const q = new URLSearchParams({ name: fil.name });
  if (w) { q.set('w', w); q.set('h', h); }
  const res = await fetch(`/api/v1/items/${itemId}/files?${q}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      // CSRF-barriere: en fremmed formular kan ikke saette en egen header.
      'X-Doda-Upload': '1',
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Upload failed (${res.status})`);
  return data.attachment;
}

/* ------------------------------------------------------------ visning */

function vedhaeftningerHtml(item) {
  const a = item.attachments || [];
  return `
  <div class="field"><span>Attachments</span>
    <div class="filedrop" id="fileDrop">
      <input type="file" id="fileInput" multiple hidden>
      <div class="files" id="fileList">${a.map(filKort).join('')}</div>
      <button type="button" class="btn ghost filebtn" id="filePick">
        ${icon('plus', 15)} Add images or files</button>
      <p class="filehint meta">Drag files here · up to ${filStr(MAX_FIL)} each ·
        large photos are scaled down before upload</p>
    </div>
  </div>`;
}

function filKort(a) {
  if (erBillede(a.mime)) {
    return `<a class="filecard image" href="/api/v1/files/${esc(a.id)}" target="_blank"
      rel="noopener noreferrer" title="${esc(a.name)}">
      <img src="/api/v1/files/${esc(a.id)}" alt="${esc(a.name)}" loading="lazy">
      <button type="button" class="filedel" data-del="${esc(a.id)}" aria-label="Remove">×</button>
    </a>`;
  }
  return `<div class="filecard doc">
    <a href="/api/v1/files/${esc(a.id)}" target="_blank" rel="noopener noreferrer" download>
      ${icon('note', 20)}
      <span class="filename">${esc(a.name)}</span>
      <span class="meta">${esc(filStr(a.size))}</span>
    </a>
    <button type="button" class="filedel" data-del="${esc(a.id)}" aria-label="Remove">×</button>
  </div>`;
}

/**
 * Kobler upload, traek-og-slip og sletning pa detaljeruden.
 * @param {HTMLElement} host   modalen
 * @param {object} item        elementet
 * @param {function} genhent   henter elementet og gentegner listen
 */
function bindVedhaeftninger(host, item, genhent) {
  const felt = host.querySelector('#fileInput');
  const drop = host.querySelector('#fileDrop');
  if (!felt) return;

  const send = async (filer) => {
    if (!filer || !filer.length) return;
    drop.classList.add('busy');
    let fejlet = 0;
    for (const f of [...filer].slice(0, 20)) {
      try { await uploadFil(item.id, f); } catch (ex) { fejlet++; toast(ex.message); }
    }
    drop.classList.remove('busy');
    await genhent();
    if (filer.length > fejlet) toast(`Attached ${filer.length - fejlet} file${filer.length - fejlet === 1 ? '' : 's'}`);
  };

  host.querySelector('#filePick').addEventListener('click', () => felt.click());
  felt.addEventListener('change', () => { send(felt.files); felt.value = ''; });

  // Traek-og-slip er et TILLAEG, ikke den eneste vej: pa touch findes det
  // ikke (RUNE-ERFARINGER §4), og der er knappen den rigtige indgang.
  ['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => {
    e.preventDefault();
    if (n === 'dragleave' && drop.contains(e.relatedTarget)) return;
    drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => send(e.dataTransfer && e.dataTransfer.files));

  host.querySelectorAll('.filedel[data-del]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await api('DELETE', `/api/v1/files/${el.dataset.del}`, {});
        await genhent();
        toast('Removed');
      } catch (ex) { toast(ex.message); }
    });
  });
}

/* --------------------------------------------------------------- billedrude
 *
 * Klik paa et billede aabner det stort, med »Copy image« over.
 *
 * Bygget som Sagus (RUNE-ERFARINGER §9e), fordi det ER Sagus billeder, man
 * ofte klikker paa: en note vist inde i doda skal ikke opfoere sig anderledes,
 * end den gjorde ovre i Sagu. Samme knapper, samme ikoner, samme veje ud.
 *
 * ── Billedet selv, ikke en adresse ────────────────────────────────────────
 *
 * Det nemme ville vaere at laegge `/api/v1/files/<id>` paa udklipsholderen.
 * Men en adresse kan ikke saettes ind i et dokument, en mail eller en besked
 * - og den kraever oven i koebet, at modtageren er logget ind. Det, man vil,
 * er at have billedet.
 *
 * ── PNG, uanset hvad filen er ─────────────────────────────────────────────
 *
 * Browserne tager kun `image/png` i udklipsholderen. En JPEG tegnes derfor om
 * paa et laerred foerst. Kilden er samme oprindelse (dodas egen filrute eller
 * Sagu-broen `/api/v1/sagu/file`), saa laerredet bliver ikke plettet, og
 * `toBlob` virker.
 *
 * ── Loeftet skal laves FOER await ─────────────────────────────────────────
 *
 * Safari kraever, at `ClipboardItem` oprettes i selve klik-haendelsen. Venter
 * man paa hentningen foerst, er brugerhandlingen udloebet, og skrivningen
 * afvises - uden at noget ser i stykker ud. Derfor faar `ClipboardItem` et
 * LOEFTE, ikke en faerdig blob.
 *
 * ── Og en aerlig vej ud ───────────────────────────────────────────────────
 *
 * `navigator.clipboard.write` findes ikke over ren http, og panelet naas paa
 * `IP:port`. Dér siger knappen det og peger paa »Open«, hvor telefonens og
 * computerens egen »kopiér billede« virker som altid.
 */

async function tilPngBlob(src) {
  const svar = await fetch(src, { credentials: 'same-origin' });
  if (!svar.ok) throw new Error('Could not read the image.');
  const blob = await svar.blob();
  if (blob.type === 'image/png') return blob;

  const bitmap = await createImageBitmap(blob);
  const laerred = document.createElement('canvas');
  laerred.width = bitmap.width;
  laerred.height = bitmap.height;
  laerred.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((ok, nej) => {
    laerred.toBlob((b) => (b ? ok(b) : nej(new Error('Could not convert the image.'))), 'image/png');
  });
}

async function kopierBillede(src, knap) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast('This browser cannot copy images here — use Open, then copy it from there.');
    return;
  }
  const foer = knap.innerHTML;
  knap.disabled = true;
  try {
    // Loeftet laves NU, inde i klikket - se forklaringen ovenfor.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': tilPngBlob(src) })]);
    knap.innerHTML = `${icon('tjek', 16)}<span>Copied</span>`;
    toast('Image copied — paste it wherever you need it.');
  } catch {
    /* Nogle browsere afviser et loefte og vil have en faerdig blob. Proev ÉN
       gang mere med den hentede blob, foer vi giver op - forskellen er
       usynlig for den, der bare vil have sit billede. */
    try {
      const blob = await tilPngBlob(src);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      knap.innerHTML = `${icon('tjek', 16)}<span>Copied</span>`;
      toast('Image copied — paste it wherever you need it.');
    } catch {
      toast('Could not copy it here — use Open, then copy it from there.');
      knap.innerHTML = foer;
    }
  }
  knap.disabled = false;
  setTimeout(() => { if (document.getElementById('lightbox')) knap.innerHTML = foer; }, 2500);
}

function visLightbox(src, alt) {
  const gammel = document.getElementById('lightbox');
  if (gammel) gammel.remove();

  const boks = document.createElement('div');
  boks.className = 'lightbox';
  boks.id = 'lightbox';
  boks.innerHTML = `
    <div class="lightbox-vaerktoej">
      <button class="lightbox-knap" id="lbKopi">${icon('copy', 16)}<span>Copy image</span></button>
      <a class="lightbox-knap" id="lbAaben" href="${esc(src)}" target="_blank"
         rel="noopener noreferrer">${icon('out', 16)}<span>Open</span></a>
      <button class="lightbox-luk" aria-label="Close">${icon('luk', 20)}</button>
    </div>
    <img src="${esc(src)}" alt="${esc(alt || '')}">
    ${/* IKKE `meta`: den klasse er dodas versal-etiket (11 px, uppercase,
         spatieret). En billedtekst er en SAETNING - saaledes blev »Skitse fra
         Sagu-noten« til »SKITSE FRA SAGU-NOTEN«, maalt i browseren. */ ''}
    ${alt ? `<div class="lightbox-tekst">${esc(alt)}</div>` : ''}`;
  document.body.appendChild(boks);

  const luk = () => {
    boks.remove();
    document.removeEventListener('keydown', paaTast);
  };
  const paaTast = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); luk(); } };
  // I fangfasen: detaljeruden lytter ogsaa paa Escape, og uden det her ville
  // ét tryk lukke BEGGE - saa var opgaven vaek under billedet.
  document.addEventListener('keydown', paaTast, true);

  boks.querySelector('.lightbox-luk').addEventListener('click', luk);
  const kopiKnap = boks.querySelector('#lbKopi');
  kopiKnap.addEventListener('click', (e) => { e.stopPropagation(); kopierBillede(src, kopiKnap); });
  // Et klik paa »Open« maa ikke ogsaa lukke ruden bagved.
  boks.querySelector('#lbAaben').addEventListener('click', (e) => e.stopPropagation());
  // Klik paa baggrunden lukker; klik paa selve billedet goer ikke.
  boks.addEventListener('click', (e) => { if (e.target === boks) luk(); });

  // Swipe. pointer-events virker ens paa mus, pen og finger - HTML5 drag
  // findes ikke paa touch (RUNE-ERFARINGER §4).
  let start = null;
  boks.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; });
  boks.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.hypot(dx, dy) > 80) luk();
  });
}

/**
 * Ét sted, der lytter - ikke en binding pr. tegning.
 *
 * Billeder dukker op syv steder i doda: Sagu-noter paa en opgave og paa et
 * projekt, notekort, et projekts udfald, forhaandsvisningen i detaljeruden,
 * en hentet Notion-side og vedhaeftninger. En binding pr. sted er praecis den
 * fejl, der er gaaet igen hele vejen gennem det her projekt - reglen kommer
 * ind ét sted og bliver glemt det ottende (v58, v60, v81, v84, v89).
 *
 * Delegering paa `document` gaelder ogsaa det, der bliver tegnet i morgen.
 */
let billedvagtSat = false;

function registrerBilledvagt() {
  /*
   * ÉN gang, ikke én pr. optegning.
   *
   * Kaldet sidder i `bindShell()`, som koerer ved hvert login og logout - og
   * `document` glemmer ikke en lytter, fordi #root bliver skrevet om. Uden
   * flaget ville hvert login laegge en lytter mere oven i, og hvert klik paa
   * et billede ville koere haandteringen to, tre, fire gange. Det ville
   * ingen se: `visLightbox()` fjerner den forrige rude, saa der staar stadig
   * kun én paa skaermen.
   */
  if (billedvagtSat) return;
  billedvagtSat = true;

  /*
   * FANGFASEN, ikke boblefasen.
   *
   * doda har i forvejen en delegeret lytter paa `document`, som i en
   * hjemmeskaerms-app aabner ethvert `a[target="_blank"]` med `window.open`
   * (iOS aabner dem ikke selv - se p1_core). Den er registreret, naar app.js
   * bliver laest, altsaa FOER den her, som saettes fra `bindShell()`.
   *
   * I boblefasen kom vi derfor for sent: vinduet med billedet var allerede
   * aabnet, og billedruden laa bag det. Andreas saa det som »den aabnede bare
   * billedet« (10-09-2026) - to gange, fordi han proevede igen.
   *
   * En lytter i fangfasen paa `document` koerer foer alt andet i stien, og
   * `stopPropagation()` her betyder, at haendelsen aldrig naar hverken
   * link-lytteren eller filkortets egne handlere.
   *
   * Det var IKKE til at se i min egen proeve: den koerte paa login-siden, som
   * ikke er standalone, saa link-lytteren sad over og trak sig tilbage med det
   * samme. En delegeret lytter skal proeves SAMMEN med de andre delegerede
   * lyttere - alene beviser den kun, at den kan koere alene.
   */
  document.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img.mdbillede, .filecard.image img');
    if (!img) return;
    // Vedhaeftningens billede ligger i et <a target="_blank">. Uden det her
    // aabner klikket en fane BAG billedruden.
    e.preventDefault();
    e.stopPropagation();
    visLightbox(img.getAttribute('src'), img.getAttribute('alt'));
  }, true);
}
