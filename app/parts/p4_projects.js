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

  friskLinkTitel('project', p.id, p, () => {
    const chip = host.querySelector('.page-head .chip.link');
    if (chip) chip.innerHTML = `${icon('link', 13)} ${esc(linkNavn(p))}`;
  });

  host.innerHTML = `<section class="page">
    <button class="btn ghost" id="backToProjects" style="margin-bottom:14px">← Projects</button>
    <div class="page-head">
      <h1>${esc(p.name)}</h1>
      <p class="lead">${omr ? esc(omr) : 'No area'}${p.status !== 'active' ? ` · ${esc(p.status)}` : ''}</p>
      ${p.outcome ? `<div class="outcome">${markdown(p.outcome)}</div>`
    : '<p class="lead" style="margin-top:10px;opacity:.7">No description of what “done” looks like yet.</p>'}
      ${p.link_url ? `<div class="chiprow" style="margin-top:14px">
        <a class="chip link" href="${esc(p.link_url)}" target="_blank" rel="noopener noreferrer"
           title="${esc(p.link_url)}">${icon('link', 13)} ${esc(linkNavn(p))}</a></div>` : ''}
      <div id="pNotion"></div>
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

    ${d.notes.length || state.notesEnabled ? `
      <h2 class="group meta">Notes <span class="group-count">${d.notes.length}</span></h2>
      ${d.notes.length ? `<div class="notes">${d.notes.map(noteKort).join('')}</div>`
    : '<p class="lead" style="padding:8px 14px">No notes. Capture one with <code>* text @' + esc(p.name) + '</code>.</p>'}` : ''}
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
  // Samme udfoldning som paa en opgave - ét sted, saa de to ikke kan drive
  // fra hinanden. Projektet HAR haft et link siden v17; det manglede bare
  // vejen til at se siden uden at forlade doda.
  notionRude(document.getElementById('pNotion'), p);
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
    <div class="field"><span>Link</span>
      <div class="chiprow" id="pLinkRow" style="margin-top:2px"></div></div>
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

  // Samme udkast-princip som detaljeruden: linket lever i `u`, indtil der
  // trykkes Save. Cancel maa ikke efterlade noget.
  const u = { link_url: nyt ? null : (p.link_url || null), link_title: nyt ? null : (p.link_title || null) };
  const tegnLink = () => {
    host.querySelector('#pLinkRow').innerHTML = u.link_url
      ? `<a class="chip link" href="${esc(u.link_url)}" target="_blank" rel="noopener noreferrer"
           title="${esc(u.link_url)}">${icon('link', 13)} ${esc(linkNavn(u))}</a>
         <button class="chip flat" id="pLinkEdit" type="button">edit link</button>`
      : '<button class="chip flat" id="pLinkEdit" type="button">+ link</button>';
    host.querySelector('#pLinkEdit').addEventListener('click', () => spoergOmLink(u, tegnLink, host.querySelector('#pName').value));
  };
  tegnLink();

  bindGemGenvej(host, host.querySelector('#pSave'));
  host.querySelector('#pSave').addEventListener('click', async () => {
    const felter = {
      name: host.querySelector('#pName').value,
      outcome: host.querySelector('#pOutcome').value,
      area_id: host.querySelector('#pArea').value || null,
      parent_id: host.querySelector('#pParent').value || null,
      link_url: u.link_url,
      link_title: u.link_title,
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
function spoergOmLink(o, naar, foreslaaetNavn) {
  /* To ting i én dialog: linke til en side, der findes - eller lave en ny.
     Tilstanden skifter kun, hvad et klik paa et soegeresultat betyder, saa
     der er ingen ny liste og ingen ny tilstand at holde styr paa. */
  let nyTilstand = false;
  /* Saettes af soegeblokken nedenfor. Uden den kan skiftet mellem »link« og
     »opret« ikke gentegne listen - og for Sagu er de to tilstande to HELT
     forskellige lister: noter, man soeger i, mod notesboeger, man vaelger. */
  let gentegnListe = null;
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px">
    <h2>Link to a page</h2>
    <p class="lead" style="margin:6px 0 16px">Paste the address of the page where this
      really lives — a Notion page, a document, an issue. It becomes a chip you can click.</p>
    <div class="field" id="lkSearchBox" hidden>
      <span id="lkKildeNavn">Search</span>
      <div class="pills" id="lkKilde" style="margin:2px 0 8px" hidden></div>
      <div class="pills" id="lkMode" style="margin:2px 0 8px">
        <button class="pill on" data-lkmode="link">Link to a page</button>
        <button class="pill" data-lkmode="new">Create a page inside</button>
      </div>
      <input class="input" id="lkQ" placeholder="Type part of a page name…"
        autocomplete="off" spellcheck="false">
      <div id="lkHits" class="notionhits"></div>
    </div>

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
  host.querySelectorAll('[data-lkmode]').forEach((el) => {
    el.addEventListener('click', () => {
      nyTilstand = el.dataset.lkmode === 'new';
      host.querySelectorAll('[data-lkmode]').forEach((x) => x.classList.toggle('on', x === el));
      const navn = host.querySelector('#lkName');
      if (nyTilstand && !navn.value && foreslaaetNavn) navn.value = foreslaaetNavn.slice(0, 200);
      // Sig hvad et klik nu goer. Uden det ser listen ens ud i begge tilstande.
      const h = host.querySelector('#lkHits');
      if (h) h.classList.toggle('opretter', nyTilstand);
      // Listen SKAL tegnes forfra. Foer blev den staaende, som den var, og i
      // Sagu betoed det, at notesboegerne aldrig kom frem: man klikkede
      // »Create a page inside« og fik den gamle soegeliste at se.
      if (gentegnListe) gentegnListe();
    });
  });

  /* Er Notion forbundet, kan man soege efter siden i stedet for at skifte
     vindue og kopiere en adresse. Er den ikke, er feltet der bare ikke -
     resten af dialogen virker uaendret. */
  (async () => {
    /*
     * To mulige kilder, ét felt.
     *
     * Notion bliver staaende, indtil migreringen til Sagu er koert faerdig -
     * og saa laenge begge er forbundet, skal man kunne vaelge. Er kun den ene
     * forbundet, er der intet at vaelge imellem, og saa staar der ikke en
     * halv kontrol og fylder.
     */
    let kilder = [];
    try { if ((await api('GET', '/api/v1/sagu')).connected) kilder.push('sagu'); } catch { /* ikke sat op */ }
    try { if ((await api('GET', '/api/v1/notion')).connected) kilder.push('notion'); } catch { /* ikke sat op */ }
    if (!kilder.length) { felt.focus(); felt.select(); return; }
    let kilde = kilder[0];

    const boks = host.querySelector('#lkSearchBox');
    const q = host.querySelector('#lkQ');
    const traf = host.querySelector('#lkHits');
    boks.hidden = false;
    q.focus();

    const NAVN = { sagu: 'Sagu', notion: 'Notion' };
    const saetKilde = (ny) => {
      kilde = ny;
      host.querySelector('#lkKildeNavn').textContent = `Search ${NAVN[kilde]}`;
      host.querySelectorAll('[data-kilde]').forEach((x) => x.classList.toggle('on', x.dataset.kilde === kilde));
      q.placeholder = kilde === 'sagu' ? 'Type part of a note title…' : 'Type part of a page name…';
    };
    if (kilder.length > 1) {
      const raekke = host.querySelector('#lkKilde');
      raekke.hidden = false;
      raekke.innerHTML = kilder.map((k) => `<button class="pill" data-kilde="${k}">${NAVN[k]}</button>`).join('');
      raekke.querySelectorAll('[data-kilde]').forEach((el) => el.addEventListener('click', () => {
        saetKilde(el.dataset.kilde);
        clearTimeout(timer);
        soeg(q.value.trim(), ++token);
      }));
    }
    saetKilde(kilde);

    let timer = null;
    let token = 0;
    let saguBoeger = [];
    try { saguBoeger = (await api('GET', '/api/v1/sagu')).notebooks || []; } catch { saguBoeger = []; }

    /**
     * Opretter noten i Sagu og saetter adressen i feltet.
     *
     * Knappen siger hvad den GOER, mens den goer det: en note i en fremmed app
     * kan ikke tages tilbage herfra (RUNE-ERFARINGER, doda v35).
     */
    const opretSaguNote = async (el) => {
      const navn = (host.querySelector('#lkName').value.trim()
        || foreslaaetNavn || 'Untitled').slice(0, 200);
      el.disabled = true;
      const gammelTekst = el.innerHTML;
      el.textContent = `Creating “${navn}” in ${el.dataset.title}…`;
      try {
        const d = await api('POST', '/api/v1/sagu/note', {
          title: navn,
          notebookId: el.dataset.bog || undefined,
          // Link BEGGE veje: noten faar en adresse tilbage til det, den kom fra.
          backUrl: location.origin,
          backTitle: navn,
        });
        felt.value = d.page.url;
        host.querySelector('#lkName').value = d.page.title;
        toast('Note created in Sagu');
        host.querySelector('#lkOk').focus();
      } catch (ex) {
        // En fejlet forbindelse er ikke en fejlet gemning: knappen kommer
        // tilbage, og beskeden siger hvad der skete.
        toast(ex.message);
        el.disabled = false;
        el.innerHTML = gammelTekst;
      }
    };

    /* En TOM soegning returnerer alt, integrationen kan se, sorteret efter
       sidst aendret. Det er ikke bare bekvemt - det er svaret paa "hvorfor
       kan doda ikke finde min side?": staar listen tom, er der ikke delt
       noget med DENNE integration. Uden den maa man gaette. */
    // Ventetiden er kun for tastede soegninger: hvert tastetryk er ellers et
    // kald HELE vejen til Notion. Den foerste visning skal vaere oejeblikkelig.
    const soeg = (v, mit) => {
      /*
       * Sagu OPRETTER i en notesbog, ikke inde i en anden note.
       *
       * Notions »lav en side inde i denne« findes ikke i Sagu: dér vaelger man
       * en notesbog. Listen bliver derfor notesboegerne i den tilstand - og
       * det er praecis planens accept: en note oprettet fra doda skal staa i
       * den RIGTIGE notesbog.
       */
      if (kilde === 'sagu' && nyTilstand) {
        // Feltet soeger ikke i denne tilstand, saa det skal vaere vaek - et
        // felt, der ikke goer noget, er en loegn om hvad man kan.
        q.hidden = true;
        const boeger = saguBoeger.length ? saguBoeger : [{ id: '', name: 'No notebook' }];
        traf.innerHTML = `<p class="lead" style="margin:0 0 8px">Pick the notebook
          “${esc((host.querySelector('#lkName').value.trim() || foreslaaetNavn
    || 'the note').slice(0, 60))}” should go in.</p>`
          + boeger.map((b) => `<button class="notionhit" data-bog="${esc(b.id)}"
            data-title="${esc(b.name)}">${icon('note', 13)} ${esc(b.name)}</button>`).join('');
        traf.querySelectorAll('[data-bog]').forEach((el) => el.addEventListener('click',
          () => opretSaguNote(el)));
        return;
      }
      q.hidden = false;
      timer = setTimeout(async () => {
        traf.innerHTML = `<p class="lead" style="margin:8px 0 0">${v ? 'Searching…' : 'Looking at what doda can see…'}</p>`;
        try {
          const d = await api('GET', `/api/v1/${kilde}/search?q=${encodeURIComponent(v)}`);
          // Et svar, brugeren er holdt op med at vente paa, maa ikke
          // overskrive et nyere (RUNE-ERFARINGER, paletten).
          if (mit !== token) return;
          traf.innerHTML = d.pages.length
            ? d.pages.map((s) => `<button class="notionhit" data-url="${esc(s.url)}"
                 data-title="${esc(s.title)}">${s.icon ? `${esc(s.icon)} ` : ''}${esc(s.title)}${
  s.kind ? `<span class="meta"> · ${esc(s.kind)}</span>` : ''}</button>`).join('')
            : (kilde === 'sagu'
              ? `<p class="lead" style="margin:8px 0 0">${v ? 'No note matches that.'
                : 'Type to search your notes in Sagu.'}</p>`
              : `<p class="lead" style="margin:8px 0 0">${v
                ? 'Nothing matches that.'
                : '<strong>doda cannot see any Notion pages.</strong>'} Notion only shows pages
               <strong>shared with this integration</strong> — open the page in Notion,
               ⋯ → Connections, and add the one you pasted the token from. Sharing a
               parent page covers everything under it.</p>`);
          traf.querySelectorAll('[data-url]').forEach((el) => {
            el.addEventListener('click', async () => {
              if (!nyTilstand) {
                felt.value = el.dataset.url;
                host.querySelector('#lkName').value = el.dataset.title;
                host.querySelector('#lkOk').focus();
                return;
              }
              // Opret en side UNDER den, der blev klikket paa.
              const navn = (host.querySelector('#lkName').value.trim()
                || foreslaaetNavn || 'Untitled').slice(0, 200);
              el.disabled = true;
              const gammelTekst = el.innerHTML;
              el.textContent = `Creating “${navn}” inside…`;
              try {
                const d = await api('POST', '/api/v1/notion/page',
                  { parent: el.dataset.url, title: navn });
                felt.value = d.page.url;
                host.querySelector('#lkName').value = d.page.title;
                toast('Page created in Notion');
                host.querySelector('#lkOk').focus();
              } catch (ex) {
                toast(ex.message);
                el.disabled = false;
                el.innerHTML = gammelTekst;
              }
            });
          });
        } catch (ex) {
          if (mit !== token) return;
          traf.innerHTML = `<p class="lead" style="margin:8px 0 0">${esc(ex.message)}</p>`;
        }
      }, v ? 300 : 0);
    };

    q.addEventListener('input', () => {
      clearTimeout(timer);
      soeg(q.value.trim(), ++token);
    });
    // Krogen ud til tilstandsknapperne, der ligger uden for denne blok.
    gentegnListe = () => { clearTimeout(timer); soeg(q.value.trim(), ++token); };
    // Vis med det samme, hvad der er adgang til - foer der er skrevet noget.
    soeg('', ++token);
  })();

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

/**
 * Henter det linkede dokuments friske titel og opdaterer visningen, hvis den
 * er aendret. Fejler det, sker der ingenting - en gammel titel er bedre end
 * en fejlbesked om en titel.
 *
 * Baade Notion og Sagu, og adressen afgoer selv hvem: `link_url` blev med
 * vilje aldrig doebt `notion_url`. Navnet paa funktionen foelger med, for et
 * navn, der siger Notion om noget, der ogsaa svarer for Sagu, er en
 * paastand, ingen kan efterproeve.
 */
async function friskLinkTitel(kind, id, o, naar) {
  try {
    const d = await api('POST', '/api/v1/link/refresh', { kind, id });
    if (!d.title || d.title === o.link_title) return;
    o.link_title = d.title;
    naar();
  } catch { /* titler er ikke noget at afbryde brugeren over */ }
}

/**
 * Kommentarerne paa siden - og en vej til at skrive en.
 *
 * Den ligger sammen med indholdet, fordi det er dér, man laeser sig frem til,
 * at der er noget at sige. Kommentaren gaar ud i verden og kan ikke tages
 * tilbage fra doda, saa knappen siger "Comment", ikke "Save", og feltet
 * ryddes foerst, naar Notion har kvitteret.
 */
async function notionKommentarer(host, o) {
  if (!host) return;
  host.innerHTML = '<p class="meta" style="margin-top:18px">Comments</p><p class="lead">Loading…</p>';
  let liste = [];
  try {
    const d = await api('GET', `/api/v1/notion/comments?url=${encodeURIComponent(o.link_url)}`);
    liste = d.comments || [];
  } catch (ex) {
    // En manglende tilladelse er ikke en fejl, brugeren skal jages af - men
    // den skal staa der, for ellers ser feltet ud til at vaere i stykker.
    host.innerHTML = `<p class="meta" style="margin-top:18px">Comments</p>
      <p class="lead">${esc(ex.message)}</p>`;
    return;
  }
  tegnNotionKommentarer(host, o, liste);
}

function tegnNotionKommentarer(host, o, liste) {
  host.innerHTML = `
    <p class="meta" style="margin-top:18px">Comments${liste.length ? ` · ${liste.length}` : ''}</p>
    ${liste.length ? `<div class="notionkom">${liste.map((k) => `
      <div class="notionkom-item">
        <div class="meta">${esc(k.author || 'Someone')}${k.created ? ` · ${esc(visTid(Math.floor(new Date(k.created).getTime() / 1000)))}` : ''}</div>
        <div>${linkify(k.text)}</div>
      </div>`).join('')}</div>` : '<p class="lead">No comments yet.</p>'}
    <div class="field" style="margin-top:12px">
      <textarea class="input" id="ntKomTekst" rows="2"
        placeholder="Write a comment — it goes straight into Notion"></textarea>
    </div>
    <button class="btn" id="ntKomSend">Comment</button>`;

  const felt = host.querySelector('#ntKomTekst');
  const knap = host.querySelector('#ntKomSend');
  const send = async () => {
    const t = felt.value.trim();
    if (!t) return;
    knap.disabled = true;
    knap.textContent = 'Sending…';
    try {
      const d = await api('POST', '/api/v1/notion/comment', { url: o.link_url, text: t });
      // Svaret ER kommentaren - den skal ikke hentes igen for at kunne ses.
      felt.value = '';
      tegnNotionKommentarer(host, o, liste.concat([d.comment]));
      toast('Sent to Notion');
    } catch (ex) {
      knap.disabled = false;
      knap.textContent = 'Comment';
      toast(ex.message);
    }
  };
  knap.addEventListener('click', send);
  /* Samme genvej som alle andre steder i appen (v31) - men den skal STOPPE
     her. Detaljeruden binder cmd+enter paa hele ruden til Save, saa uden
     stopPropagation ville tastetrykket baade sende kommentaren og gemme
     opgaven, og ruden lukkede foer svaret naaede hjem. Den, der har handlet
     paa tasten, ejer den (v29). */
  felt.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    send();
  });
}

/**
 * Viser en Notion-sides indhold inde i doda.
 *
 * Hentes foerst naar man beder om det: en side kan vaere lang, og Notion er
 * kilden - doda laver ikke en kopi, der kan blive forkert. Indholdet gaar
 * gennem dodas EGEN markdown-renderer, som escaper foerst; der bygges aldrig
 * HTML af fremmed indhold.
 */
/*
 * Om ruden er foldet sammen, huskes paa TVAERS af elementer - ikke pr. side.
 * "Jeg vil ikke have den foldet ud automatisk" er en vane, ikke en holdning
 * til én bestemt opgave; pr. element ville det ogsaa vokse i det uendelige i
 * localStorage og vaere umuligt at gennemskue. Standard er foldet UD: har man
 * haengt en side paa, er den det, man kom for.
 */
function notionFoldet() {
  try { return localStorage.getItem('doda_notion_fold') === '1'; } catch { return false; }
}

function saetNotionFoldet(fold) {
  try { localStorage.setItem('doda_notion_fold', fold ? '1' : '0'); } catch { /* privat tilstand */ }
}

/**
 * Ruden under en opgave: den linkede sides indhold.
 *
 * Adressen afgoer, hvem der skal spoerges - ikke en tilstand nogen skal
 * huske. `link_url` blev med vilje aldrig doebt `notion_url`, og det er
 * praecis dét, der goer, at Sagu kan glide ind ved siden af.
 */
function linkRude(host, o, foldSammen) {
  if (!host) return;
  if (saguModul_erSaguUrl(o.link_url)) { saguRude(host, o); return; }
  notionRude(host, o, foldSammen);
}

/** `#note-<32 hex>` er den adresse, Sagu selv aabner paa. */
function saguModul_erSaguUrl(url) {
  return /#note-[0-9a-f]{32}$/i.test(String(url || ''));
}

/**
 * Sagu-noten: kommentarerne, og en vej derhen.
 *
 * Kun LAESNING. Skal man svare, hoerer det hjemme i Sagu, hvor samtalen
 * staar - en opgaveapp, der kigger med, skal ikke ogsaa vaere et sted at
 * skrive. Og noten selv hentes IKKE: den kan vaere lang, Sagu er kilden, og
 * doda skal ikke lave en kopi, der kan blive forkert.
 */
async function saguRude(host, o) {
  host.innerHTML = `<p class="meta" style="margin-top:18px">In Sagu</p>
    <p class="lead">Loading comments…</p>`;
  try {
    const d = await api('GET', `/api/v1/sagu/comments?url=${encodeURIComponent(o.link_url)}`);
    const liste = d.comments || [];
    host.innerHTML = `<p class="meta" style="margin-top:18px">In Sagu${
  liste.length ? ` · ${liste.length} comment${liste.length === 1 ? '' : 's'}` : ''}</p>
      ${liste.length ? `<div class="notionkom">${liste.map((k) => `
        <div class="notionkom-item">
          <div class="meta">${esc(k.author)}${k.guest ? ' · guest' : ''}${
  k.at ? ` · ${esc(visTid(k.at))}` : ''}</div>
          <div>${markdown(k.body)}</div>
        </div>`).join('')}</div>` : '<p class="lead">No comments on that note yet.</p>'}
      <p class="gate-note" style="text-align:left">Read-only. Open the note in Sagu to reply.</p>`;
  } catch (ex) {
    // En fejlet forbindelse er ikke en fejlet opgave: ruden siger hvad der
    // skete, og resten af opgaven staar uroert.
    host.innerHTML = `<p class="meta" style="margin-top:18px">In Sagu</p>
      <p class="lead">${esc(ex.message)}</p>`;
  }
}

function notionRude(host, o, foldSammen) {
  if (!host) return;
  const erNotion = /(^|\.)notion\.(so|site)\//.test(String(o.link_url || ''))
    || /notion\.com\//.test(String(o.link_url || ''));
  if (!o.link_url || !erNotion) { host.innerHTML = ''; return; }

  host.innerHTML = `<button class="btn ghost" id="ntShow" style="margin-top:10px">
    ${icon('note', 15)} Show the Notion page</button>`;

  const vis = async () => {
    host.innerHTML = '<p class="lead" style="margin-top:12px">Loading the page…</p>';
    try {
      const d = await api('GET', `/api/v1/notion/page?url=${encodeURIComponent(o.link_url)}`);
      host.innerHTML = `
        <div class="notionpage">
          <div class="meta" style="margin-bottom:8px">From Notion${d.cached ? ' · cached' : ''}</div>
          ${d.markdown ? markdown(d.markdown) : '<p class="lead">That page is empty.</p>'}
        </div>
        <div id="ntKom"></div>
        <p class="gate-note" style="text-align:left">Read-only. Images stay in Notion —
        doda only shows content from its own server, so they appear as links.</p>
        <button class="btn ghost" id="ntHide">Hide</button>`;
      // "Hide" folder sammen - og saa staar knappen der igen, som foer.
      host.querySelector('#ntHide').addEventListener('click', () => {
        saetNotionFoldet(true);
        notionRude(host, o, true);
      });
      notionKommentarer(host.querySelector('#ntKom'), o);
    } catch (ex) {
      host.innerHTML = `<p class="lead" style="margin-top:12px">${esc(ex.message)}</p>
        <button class="btn ghost" id="ntAgain" style="margin-top:8px">Try again</button>`;
      host.querySelector('#ntAgain').addEventListener('click', () => notionRude(host, o, true));
    }
  };

  host.querySelector('#ntShow').addEventListener('click', () => { saetNotionFoldet(false); vis(); });
  // Kaldes den uden et udtrykkeligt valg, gaelder det, brugeren gjorde sidst.
  if (foldSammen === undefined ? !notionFoldet() : !foldSammen) vis();
}
