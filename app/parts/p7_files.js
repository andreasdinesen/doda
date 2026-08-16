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
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
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
