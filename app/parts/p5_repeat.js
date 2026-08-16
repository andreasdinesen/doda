'use strict';
/* doda - skaermen "Repeating".
   Det er HER man opdager, at en vane ikke virker: naeste forfald ved siden af
   antallet af gange, den er sprunget over (handover §5.6). */

async function sideRepeat() {
  const host = document.getElementById('pageHost');
  let d;
  try { d = await api('GET', '/api/v1/recurrences'); }
  catch (ex) {
    host.innerHTML = `<section class="page"><div class="empty"><p>${esc(ex.message)}</p></div></section>`;
    return;
  }

  const aktive = d.recurrences.filter((r) => !r.paused);
  const pauserede = d.recurrences.filter((r) => r.paused);

  if (!d.recurrences.length) {
    host.innerHTML = `<section class="page">
      ${repeatHead()}
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">Nothing repeats yet</p>
        <p>Add <code>!every monday</code> when you capture — or
        <code>!every! 3 days</code> to count from the day you finish.</p></div>
    </section>`;
    return;
  }

  host.innerHTML = `<section class="page">
    ${repeatHead()}
    ${aktive.length ? `<div class="list">${aktive.map(gentagelsesRaekke).join('')}</div>` : ''}
    ${pauserede.length ? `
      <h2 class="group meta">Paused <span class="group-count">${pauserede.length}</span></h2>
      <div class="list dim">${pauserede.map(gentagelsesRaekke).join('')}</div>` : ''}
  </section>`;
  bindRepeat(d.recurrences);
}

function repeatHead() {
  return `<div class="page-head">
    <h1>Repeating</h1>
    <p class="lead">${esc(BESKRIVELSER.repeat)}</p>
    <div class="card" style="margin-top:18px;padding:14px 18px">
      <table class="syntax">
        <tr><td><code>!every monday</code></td><td><strong>Fixed schedule</strong> — comes
          around on its date, whether or not you did the last one</td></tr>
        <tr><td><code>!every! monday</code></td><td><strong>From completion</strong> — the next
          one only appears once you finish this one. Can never pile up.</td></tr>
      </table>
    </div></div>`;
}

function gentagelsesRaekke(r) {
  const forfald = [];
  forfald.push(r.paused ? 'paused' : `next ${visDato(r.next_due)}`);
  if (r.next_time) forfald.push(r.next_time);
  const projekt = r.project_id ? (state.projects.find((p) => p.id === r.project_id) || {}).name : null;
  if (projekt) forfald.push(esc(projekt));

  return `<div class="item-row repeat-row" data-rec="${esc(r.id)}" tabindex="0">
    <span class="rep-icon ${r.mode === 'completion' ? 'completion' : 'schedule'}">${icon('repeat', 16)}</span>
    <div class="item-main">
      <div class="item-title">${esc(r.title)}</div>
      <div class="item-meta meta">${esc(r.description)}</div>
      <div class="item-meta meta">${forfald.join(' · ')}</div>
    </div>
    ${r.skips ? `<span class="skipcount" title="Times this has been skipped">${r.skips} skipped</span>` : ''}
  </div>`;
}

function bindRepeat(alle) {
  document.querySelectorAll('.repeat-row').forEach((el) => {
    el.addEventListener('click', () => {
      const r = alle.find((x) => x.id === el.dataset.rec);
      if (r) aabnGentagelse(r);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const r = alle.find((x) => x.id === el.dataset.rec);
      if (r) aabnGentagelse(r);
    });
  });
}

/* -------------------------------------------------------- detaljerude */

function aabnGentagelse(r) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true">
    <h2>${esc(r.title)}</h2>
    <p class="lead" style="margin:6px 0 18px">${esc(r.description)}</p>

    <label class="field"><span>Title (applies to every future one)</span>
      <input class="input" id="rTitle" value="${esc(r.title)}"></label>

    <label class="field"><span>Repeat rule</span>
      <input class="input" id="rRule" value="${esc(r.rule.text)}"
        placeholder="every monday · every! 3 days · last workday of the month"></label>

    <label class="field"><span>Project</span>
      <select class="input" id="rProject"><option value="">— none —</option>
        ${state.projects.map((p) => `<option value="${esc(p.id)}"${p.id === r.project_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></label>

    <div class="card" style="margin:4px 0 6px;padding:14px 18px">
      <div class="meta">Next due</div>
      <div style="font-weight:600;margin-top:2px">
        ${r.paused ? 'Paused' : esc(visDato(r.next_due)) + (r.next_time ? ` at ${esc(r.next_time)}` : '')}</div>
      ${r.skips ? `<div class="meta" style="margin-top:8px">Skipped ${r.skips} time${r.skips === 1 ? '' : 's'}${r.skips > 2 ? ' — is this one actually working for you?' : ''}</div>` : ''}
      ${r.last_completed_at ? `<div class="meta" style="margin-top:4px">Last done ${esc(visTid(r.last_completed_at))}</div>` : ''}
    </div>

    <div class="modal-foot" style="flex-wrap:wrap">
      <button class="btn ghost" id="rDelete">Stop repeating</button>
      <button class="btn ghost" id="rSkip"${r.paused ? ' disabled' : ''}>Skip this one</button>
      <button class="btn ghost" id="rPause">${r.paused ? 'Resume' : 'Pause'}</button>
      <span style="flex:1"></span>
      <button class="btn" id="rCancel">Cancel</button>
      <button class="btn primary" id="rSave">Save</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.querySelector('#rCancel').addEventListener('click', luk);

  const efter = async (besked) => { luk(); await genindlaes(); if (besked) toast(besked); };

  host.querySelector('#rSave').addEventListener('click', async () => {
    try {
      await api('POST', `/api/v1/recurrences/${r.id}`, {
        title: host.querySelector('#rTitle').value,
        rule_text: host.querySelector('#rRule').value,
        project_id: host.querySelector('#rProject').value || null,
      });
      await efter('Saved — applies to every future one');
    } catch (ex) { toast(ex.message); }
  });

  host.querySelector('#rSkip').addEventListener('click', async () => {
    await api('POST', `/api/v1/recurrences/${r.id}/skip`, {});
    await efter('Skipped — it is noted for your weekly review');
  });

  host.querySelector('#rPause').addEventListener('click', async () => {
    await api('POST', `/api/v1/recurrences/${r.id}`, { paused: !r.paused });
    await efter(r.paused ? 'Resumed' : 'Paused — the rule is kept');
  });

  host.querySelector('#rDelete').addEventListener('click', async () => {
    await api('DELETE', `/api/v1/recurrences/${r.id}`, {});
    await efter('Stopped repeating — the open one is now a normal task');
  });

  host.querySelector('#rTitle').focus();
}

/* ------------------------------------------- denne gang vs. alle fremtidige */

/**
 * Spoerger, om en aendring gaelder denne ene forekomst eller hele serien.
 * Bruges naar en opgave, der hoerer til en gentagelse, redigeres.
 */
function spoergOmSerie(titel) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'modal';
    host.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" style="max-width:440px">
      <h2>This one, or all future ones?</h2>
      <p class="lead" style="margin:6px 0 20px">“${esc(titel)}” repeats.
      Should the change stick to every future one, or only to this occurrence?</p>
      <div class="modal-foot">
        <span style="flex:1"></span>
        <button class="btn" id="sOne">Only this one</button>
        <button class="btn primary" id="sAll">All future ones</button>
      </div>
    </div>`;
    document.body.appendChild(host);
    const svar = (v) => { host.remove(); resolve(v); };
    host.querySelector('#sOne').addEventListener('click', () => svar(false));
    host.querySelector('#sAll').addEventListener('click', () => svar(true));
    host.addEventListener('click', (e) => { if (e.target === host) svar(null); });
  });
}
