'use strict';
/* doda - projekter, omrader, kontekster og markdown-noter. */

/* ---------------------------------------------------------- markdown */

/**
 * Minimal, sikker markdown. Samme princip som linkify: escape FOERST, og
 * byg derefter kun de tags, vi selv laver. Der er ingen vej fra brugerens
 * tekst til et tag, vi ikke har skrevet.
 */
function markdown(raa) {
  const blokke = String(raa || '').split(/\n{2,}/);
  return blokke.map((blok) => {
    const linjer = blok.split('\n');

    // Punktopstilling
    if (linjer.every((l) => /^\s*[-*+]\s+/.test(l))) {
      return `<ul>${linjer.map((l) => `<li>${inline(l.replace(/^\s*[-*+]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    // Nummereret liste
    if (linjer.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      return `<ol>${linjer.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    // Overskrift
    const h = blok.match(/^(#{1,3})\s+(.*)$/);
    if (h && linjer.length === 1) return `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
    // Citat
    if (linjer.every((l) => /^\s*>\s?/.test(l))) {
      return `<blockquote>${inline(linjer.map((l) => l.replace(/^\s*>\s?/, '')).join('\n'))}</blockquote>`;
    }
    return `<p>${inline(blok)}</p>`;
  }).join('');

  function inline(t) {
    let s = linkify(t);                       // escaper og laver links
    s = s.replace(/`([^`\n]{1,200})`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]{1,200})\*/g, '$1<em>$2</em>');
    return s.replace(/\n/g, '<br>');
  }
}

/* ------------------------------------------------------- projektliste */

async function sideProjects() {
  const aktive = state.projects.filter((p) => p.status === 'active' && !p.parent_id);
  const parkerede = state.projects.filter((p) => p.status === 'someday');
  const afsluttede = state.projects.filter((p) => p.status === 'done' || p.status === 'dropped');

  if (!state.projects.length) {
    return `<section class="page">
      ${projectHead()}
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">No projects yet</p>
        <p>Anything that takes more than one step is a project.
        Type <code>@Name</code> when you capture, and it appears here.</p></div>
    </section>`;
  }

  // Grupperet efter omrade. Projekter uden omrade forsvinder ikke - de star
  // under "No area" nederst.
  const grupper = new Map();
  for (const p of aktive) {
    const omr = p.area_id ? (state.areas.find((a) => a.id === p.area_id) || {}).name : null;
    const noegle = omr || 'No area';
    if (!grupper.has(noegle)) grupper.set(noegle, []);
    grupper.get(noegle).push(p);
  }
  const sorteret = [...grupper.entries()].sort((a, b) => {
    if (a[0] === 'No area') return 1;
    if (b[0] === 'No area') return -1;
    return a[0].localeCompare(b[0]);
  });

  return `<section class="page">
    ${projectHead()}
    ${sorteret.map(([navn, liste]) => `
      <h2 class="group meta">${esc(navn)} <span class="group-count">${liste.length}</span></h2>
      <div class="list">${liste.map(projektRaekke).join('')}</div>`).join('')}
    ${parkerede.length ? `
      <h2 class="group meta">Someday <span class="group-count">${parkerede.length}</span></h2>
      <div class="list">${parkerede.map(projektRaekke).join('')}</div>` : ''}
    ${afsluttede.length ? `
      <h2 class="group meta">Finished <span class="group-count">${afsluttede.length}</span></h2>
      <div class="list dim">${afsluttede.map(projektRaekke).join('')}</div>` : ''}
  </section>`;
}

function projectHead() {
  return `<div class="page-head">
    <h1>Projects</h1><p class="lead">${esc(BESKRIVELSER.projects)}</p>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn" id="newProject">${icon('plus', 15)} New project</button>
      <button class="btn ghost" id="manageAreas">Manage areas</button>
    </div></div>`;
}

function projektRaekke(p) {
  const underprojekter = state.projects.filter((x) => x.parent_id === p.id);
  const meta = [];
  if (p.open_count) meta.push(`${p.open_count} open`);
  if (underprojekter.length) meta.push(`${underprojekter.length} subproject${underprojekter.length === 1 ? '' : 's'}`);

  // Den klassiske GTD-fejl gores synlig - men roligt. Ingen roed farve,
  // ingen udrabstegn, ingen skaeldud (handover §5.4 + princip 1).
  const manglerNaeste = p.status === 'active' && !p.next_count && p.open_count > 0;

  return `<div class="item-row" tabindex="0" data-project="${esc(p.id)}">
    <span class="proj-dot"></span>
    <div class="item-main">
      <div class="item-title">${esc(p.name)}</div>
      ${meta.length ? `<div class="item-meta meta">${meta.join(' · ')}</div>` : ''}
    </div>
    ${manglerNaeste ? '<span class="flag-nonext">no next action</span>' : ''}
  </div>`;
}

/* ------------------------------------------------------ projektvisning */

async function sideProjekt(id) {
  const host = document.getElementById('pageHost');
  let d;
  try { d = await api('GET', `/api/v1/projects/${id}`); }
  catch (ex) { host.innerHTML = `<section class="page"><div class="empty"><p>${esc(ex.message)}</p></div></section>`; return; }

  state.items = d.tasks;
  const p = d.project;
  const omr = p.area_id ? (state.areas.find((a) => a.id === p.area_id) || {}).name : null;
  const manglerNaeste = p.status === 'active' && !p.next_count && p.open_count > 0;

  host.innerHTML = `<section class="page">
    <button class="btn ghost" id="backToProjects" style="margin-bottom:14px">← Projects</button>
    <div class="page-head">
      <h1>${esc(p.name)}</h1>
      <p class="lead">${omr ? esc(omr) : 'No area'}${p.status !== 'active' ? ` · ${esc(p.status)}` : ''}</p>
      ${p.outcome ? `<div class="outcome">${markdown(p.outcome)}</div>`
    : '<p class="lead" style="margin-top:10px;opacity:.7">No description of what “done” looks like yet.</p>'}
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn" id="editProject">Edit project</button>
        ${p.status === 'active' ? '<button class="btn ghost" data-pstatus="someday">Park as someday</button>' : ''}
        ${p.status !== 'active' ? '<button class="btn ghost" data-pstatus="active">Reactivate</button>' : ''}
        ${p.status !== 'done' ? '<button class="btn ghost" data-pstatus="done">Mark finished</button>' : ''}
      </div>
    </div>

    ${manglerNaeste ? `<div class="nudge">${icon('next', 17)}
      <span>This project has open work but no next action.
      Pick the one thing that moves it forward and press <strong>n</strong> on it.</span></div>` : ''}

    ${d.children.length ? `
      <h2 class="group meta">Subprojects <span class="group-count">${d.children.length}</span></h2>
      <div class="list">${d.children.map(projektRaekke).join('')}</div>` : ''}

    <h2 class="group meta">Tasks <span class="group-count">${d.tasks.length}</span></h2>
    ${d.tasks.length ? `<div class="list" data-keynav data-sortable>
        ${d.tasks.map((it, i) => projektOpgave(it, i, d.tasks.length)).join('')}</div>`
    : '<p class="lead" style="padding:8px 14px">Nothing here yet.</p>'}

    <h2 class="group meta">Notes <span class="group-count">${d.notes.length}</span></h2>
    ${d.notes.length ? `<div class="notes">${d.notes.map(noteKort).join('')}</div>`
    : '<p class="lead" style="padding:8px 14px">No notes. Capture one with <code>* text @' + esc(p.name) + '</code>.</p>'}
  </section>`;

  bindProjektvisning(p, d);
}

function projektOpgave(it, i, ialt) {
  const faerdig = it.status === 'done' || it.status === 'dropped';
  const meta = [statusNavn(it.status)];
  if (it.due_date) meta.push(visDato(it.due_date));
  if (it.contexts.length) meta.push(it.contexts.map((c) => `#${esc(c.name)}`).join(' '));

  return `<div class="item-row${faerdig ? ' dim' : ''}" tabindex="0" data-id="${esc(it.id)}" data-i="${i}">
    <button class="tick${it.status === 'done' ? ' on' : ''}" data-done="${esc(it.id)}" aria-label="Mark done"></button>
    <div class="item-main">
      <div class="item-title">${linkify(it.title)}</div>
      <div class="item-meta meta">${meta.join(' · ')}</div>
    </div>
    ${it.note ? `<span class="item-flag">${icon('note', 15)}</span>` : ''}
    <span class="movers">
      <button class="mover" data-move="up" data-id="${esc(it.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button class="mover" data-move="down" data-id="${esc(it.id)}" ${i === ialt - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
    </span>
  </div>`;
}

function noteKort(it) {
  return `<div class="notecard" data-id="${esc(it.id)}" tabindex="0">
    <div class="notecard-title">${esc(it.title)}</div>
    ${it.note ? `<div class="notecard-body">${markdown(it.note)}</div>` : ''}
  </div>`;
}

function bindProjektvisning(p, d) {
  document.getElementById('backToProjects').addEventListener('click', () => gaaTil('projects'));
  document.getElementById('editProject').addEventListener('click', () => redigerProjekt(p));

  document.querySelectorAll('[data-pstatus]').forEach((el) => {
    el.addEventListener('click', async () => {
      await api('POST', `/api/v1/projects/${p.id}`, { status: el.dataset.pstatus });
      await hentState();
      opdaterNav();
      sideProjekt(p.id);
      toast(el.dataset.pstatus === 'someday' ? 'Parked as someday' : `Project marked ${el.dataset.pstatus}`);
    });
  });

  document.querySelectorAll('.tick[data-done]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('POST', `/api/v1/items/${el.dataset.done}/complete`, {});
      await hentState();
      opdaterNav();
      sideProjekt(p.id);
    });
  });

  // Manuel raekkefoelge med knapper, ikke traek-og-slip: HTML5 drag & drop
  // virker ikke pa touch (RUNE-ERFARINGER §4), og det her er den ene vej,
  // der virker bade med mus, tastatur og tommelfinger.
  document.querySelectorAll('.mover[data-move]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ids = d.tasks.map((t) => t.id);
      const i = ids.indexOf(el.dataset.id);
      const j = el.dataset.move === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api('POST', '/api/v1/reorder', { kind: 'items', ids });
      sideProjekt(p.id);
    });
  });

  document.querySelectorAll('.item-row[data-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.mover, .tick')) return;
      const it = [...d.tasks].find((x) => x.id === el.dataset.id);
      if (it) aabnElement(it);
    });
    el.addEventListener('keydown', raekkeTaster);
  });

  document.querySelectorAll('.item-row[data-project]').forEach((el) => {
    el.addEventListener('click', () => gaaTilProjekt(el.dataset.project));
  });

  document.querySelectorAll('.notecard').forEach((el) => {
    el.addEventListener('click', () => {
      const it = d.notes.find((x) => x.id === el.dataset.id);
      if (it) aabnElement(it);
    });
  });
}

function gaaTilProjekt(id) {
  state.view = 'projects';
  state.openProject = id;
  opdaterNav();
  tegnSide();
  window.scrollTo(0, 0);
}

/* --------------------------------------------------- projekt-redigering */

function redigerProjekt(p) {
  const nyt = !p;
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true">
    <h2>${nyt ? 'New project' : 'Edit project'}</h2>
    <label class="field"><span>Name</span>
      <input class="input" id="pName" value="${esc(nyt ? '' : p.name)}"></label>
    <label class="field"><span>What does “done” look like?</span>
      <textarea class="input" id="pOutcome" rows="3"
        placeholder="Optional, but it is the difference between a project and a wish.">${esc(nyt ? '' : p.outcome)}</textarea></label>
    <div class="row2">
      <label class="field"><span>Area</span>
        <select class="input" id="pArea"><option value="">— none —</option>
          ${state.areas.map((a) => `<option value="${esc(a.id)}"${!nyt && a.id === p.area_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Part of</span>
        <select class="input" id="pParent"><option value="">— top level —</option>
          ${state.projects.filter((x) => nyt || x.id !== p.id).map((x) =>
    `<option value="${esc(x.id)}"${!nyt && x.id === p.parent_id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></label>
    </div>
    <div class="modal-foot">
      ${nyt ? '' : '<button class="btn ghost" id="pDelete">Delete</button>'}
      <span style="flex:1"></span>
      <button class="btn" id="pCancel">Cancel</button>
      <button class="btn primary" id="pSave">Save</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.querySelector('#pCancel').addEventListener('click', luk);

  host.querySelector('#pSave').addEventListener('click', async () => {
    const felter = {
      name: host.querySelector('#pName').value,
      outcome: host.querySelector('#pOutcome').value,
      area_id: host.querySelector('#pArea').value || null,
      parent_id: host.querySelector('#pParent').value || null,
    };
    try {
      let id = nyt ? null : p.id;
      if (nyt) {
        const r = await api('POST', '/api/v1/projects', { name: felter.name });
        id = r.project.id;
      }
      await api('POST', `/api/v1/projects/${id}`, felter);
      luk();
      await hentState();
      opdaterNav();
      state.openProject = id;
      tegnSide();
      toast(nyt ? 'Project created' : 'Saved');
    } catch (ex) { toast(ex.message); }
  });

  if (!nyt) {
    host.querySelector('#pDelete').addEventListener('click', async () => {
      await api('DELETE', `/api/v1/projects/${p.id}`, {});
      luk();
      await hentState();
      opdaterNav();
      state.openProject = null;
      gaaTil('projects');
      toast('Project deleted — its tasks were kept');
    });
  }
  host.querySelector('#pName').focus();
}

/* ------------------------------------------------------------ omrader */

function administrerOmraader() {
  const host = document.createElement('div');
  host.className = 'modal';
  const tegn = () => `
    <div class="modal-card" role="dialog" aria-modal="true">
      <h2>Areas</h2>
      <p class="lead" style="margin:6px 0 16px">Ongoing responsibilities that never
      get finished: Work, Home, Money, Health. Projects live inside them.</p>
      <div class="keylist">${state.areas.length ? state.areas.map((a) => `
        <div class="keyrow">
          <input class="input" data-area="${esc(a.id)}" value="${esc(a.name)}" style="flex:1">
          <button class="btn ghost" data-delarea="${esc(a.id)}">Delete</button>
        </div>`).join('') : '<p class="lead">No areas yet.</p>'}</div>
      <form id="areaForm" class="keyform" style="grid-template-columns:1fr auto">
        <input class="input" id="areaName" placeholder="New area" maxlength="80" required>
        <button class="btn primary" type="submit">Add</button>
      </form>
      <div class="modal-foot"><span style="flex:1"></span>
        <button class="btn" id="aClose">Done</button></div>
    </div>`;

  const bind = () => {
    host.innerHTML = tegn();
    host.querySelector('#aClose').addEventListener('click', async () => {
      host.remove();
      await genindlaes();
    });
    host.querySelector('#areaForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await api('POST', '/api/v1/areas', { name: host.querySelector('#areaName').value });
      await hentState();
      bind();
    });
    host.querySelectorAll('[data-area]').forEach((el) => {
      el.addEventListener('change', async () => {
        await api('POST', `/api/v1/areas/${el.dataset.area}`, { name: el.value });
        await hentState();
        toast('Area renamed');
      });
    });
    host.querySelectorAll('[data-delarea]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('DELETE', `/api/v1/areas/${el.dataset.delarea}`, {});
        await hentState();
        bind();
        toast('Area deleted — its projects were kept');
      });
    });
  };

  document.body.appendChild(host);
  bind();
  host.addEventListener('click', async (e) => {
    if (e.target === host) { host.remove(); await genindlaes(); }
  });
}

/* --------------------------------------------------------- kontekster */

function sideContexts() {
  return `<section class="page">
    <div class="page-head"><h1>Contexts</h1><p class="lead">${esc(BESKRIVELSER.contexts)}</p></div>
    ${state.contexts.length ? `<div class="card"><div class="keylist">
      ${state.contexts.map((c) => `
        <div class="keyrow">
          <input class="input" data-ctxname="${esc(c.id)}" value="${esc(c.name)}" style="flex:1">
          <button class="btn ghost" data-ctxopen="${esc(c.id)}">Show tasks</button>
          <button class="btn ghost" data-ctxdel="${esc(c.id)}">Delete</button>
        </div>`).join('')}
    </div></div>` : `<div class="empty">${icon('calm', 34)}
      <p class="empty-title">No contexts yet</p>
      <p>Type <code>#computer</code> or <code>#errands</code> when you capture,
      and they show up here.</p></div>`}
    <p class="hintline meta">Deleting a context keeps the tasks — they just lose the label.</p>
  </section>`;
}

function bindContexts() {
  document.querySelectorAll('[data-ctxname]').forEach((el) => {
    el.addEventListener('change', async () => {
      try {
        await api('POST', `/api/v1/contexts/${el.dataset.ctxname}`, { name: el.value });
        await genindlaes();
        toast('Context renamed');
      } catch (ex) { toast(ex.message); await genindlaes(); }
    });
  });
  document.querySelectorAll('[data-ctxopen]').forEach((el) => {
    el.addEventListener('click', () => gaaTil('next', { context: el.dataset.ctxopen }));
  });
  document.querySelectorAll('[data-ctxdel]').forEach((el) => {
    el.addEventListener('click', async () => {
      await api('DELETE', `/api/v1/contexts/${el.dataset.ctxdel}`, {});
      await genindlaes();
      toast('Context deleted — the tasks were kept');
    });
  });
}

/* ------------------------------------------------------- link til en side */

/**
 * Navnet paa et link. Er der ingen titel, bruges vaerten - en raa
 * Notion-adresse er 40 tegn hex og siger ingenting.
 */
function linkNavn(o) {
  if (o.link_title) return o.link_title;
  try {
    const v = new URL(o.link_url).hostname.replace(/^www\./, '');
    return v === 'notion.so' || v.endsWith('.notion.site') ? 'Notion' : v;
  } catch { return 'link'; }
}

/** Lille dialog: adressen og et valgfrit navn. Gemmes foerst med Save. */
function spoergOmLink(o, naar) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px">
    <h2>Link to a page</h2>
    <p class="lead" style="margin:6px 0 16px">Paste the address of the page where this
      really lives — a Notion page, a document, an issue. It becomes a chip you can click.</p>
    <label class="field"><span>Address</span>
      <input class="input" id="lkUrl" placeholder="https://www.notion.so/…"
        value="${esc(o.link_url || '')}" autocomplete="off" spellcheck="false"></label>
    <label class="field"><span>Name (optional)</span>
      <input class="input" id="lkName" placeholder="What to call it"
        value="${esc(o.link_title || '')}" maxlength="200"></label>
    <p class="gate-error" id="lkErr" hidden></p>
    <div class="modal-foot">
      ${o.link_url ? '<button class="btn ghost" id="lkDel">Remove link</button>' : ''}
      <span style="flex:1"></span>
      <button class="btn" id="lkCancel">Cancel</button>
      <button class="btn primary" id="lkOk">Set</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.querySelector('#lkCancel').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  const slet = host.querySelector('#lkDel');
  if (slet) slet.addEventListener('click', () => { o.link_url = null; o.link_title = null; luk(); naar(); });

  const felt = host.querySelector('#lkUrl');
  felt.focus();
  felt.select();

  host.querySelector('#lkOk').addEventListener('click', () => {
    const v = felt.value.trim();
    if (!v) { o.link_url = null; o.link_title = null; luk(); naar(); return; }
    // Samme regel som serveren: kun http(s). Sig det HER, saa man ikke
    // trykker Save og undrer sig over, at linket forsvandt.
    let ok = false;
    try { const u = new URL(v); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { ok = false; }
    if (!ok) {
      const fejl = host.querySelector('#lkErr');
      fejl.textContent = 'That is not a web address. It has to start with http:// or https://';
      fejl.hidden = false;
      return;
    }
    o.link_url = v;
    o.link_title = host.querySelector('#lkName').value.trim() || null;
    luk();
    naar();
  });
}
