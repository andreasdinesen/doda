'use strict';
/*
 * doda - MCP-server (Model Context Protocol).
 *
 * Streamable HTTP + JSON-RPC 2.0, handskrevet. MCP ER bare JSON-RPC over
 * HTTP, sa der er ingen grund til en pakke - og dermed ingen forsyningskaede
 * at holde patchet. Se DESIGN.md §1.
 *
 * Godkendelse er de SAMME adgangsnoegler som resten af API'et, med samme
 * scopes. En capture-noegle kan bruge fangst-vaerktoejet og intet andet.
 */

const PROTOKOL = '2025-06-18';
const PROTOKOLLER = ['2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * @param {object} srv  Serverens egne funktioner (afhaengigheds-indsprojtning,
 *   sa modulet kan testes og ikke kender databasen).
 */
function opret(srv) {
  /* ---------------------------------------------------------- vaerktoejer */

  const VAERKTOEJER = [
    {
      name: 'capture',
      scope: 'capture',
      description:
        'Capture a task or note into doda. Accepts the same shortcut syntax as the app: '
        + '#context, @project, !date (e.g. !tomorrow, !friday, !in 2 weeks), ~hide-until-date, '
        + '!every monday for a repeating task (!every! monday counts from completion), '
        + '"* " prefix for a note, and " // " to start a description. '
        + 'Unknown contexts and projects are created automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The full capture line, including any shortcut syntax.' },
        },
        required: ['text'],
      },
      kald(a) {
        const svar = srv.fangst(String(a.text || ''), true);
        if (svar.fejl) return { fejl: svar.fejl };
        const i = svar.item;
        let s = `Captured: ${i.title}`;
        if (svar.recurrence) s += `\nRepeats: ${srv.parse.beskrivGentagelse(svar.recurrence.rule)}`;
        if (i.due_date) s += `\nDue: ${i.due_date}${i.due_time ? ` ${i.due_time}` : ''}`;
        if (i.contexts.length) s += `\nContexts: ${i.contexts.map((c) => `#${c.name}`).join(' ')}`;
        s += `\nStatus: ${i.status}\nid: ${i.id}`;
        return { tekst: s, data: { item: i, recurrence: svar.recurrence || null } };
      },
    },
    {
      name: 'list_next_actions',
      scope: 'read',
      description:
        'List what can actually be done right now: tasks with status "next" whose hide-until '
        + 'date has passed. This is the main screen of the app. Optionally filter to one context.',
      inputSchema: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'Context name, e.g. "computer". Optional.' },
          limit: { type: 'integer', description: 'Max results (default 100).' },
        },
      },
      kald(a) {
        let kontekstId = null;
        if (a.context) {
          const k = srv.findKontekst(String(a.context));
          if (!k) {
            return { fejl: `No context called "${a.context}". Known: ${srv.hentKontekster().map((c) => c.name).join(', ') || 'none'}.` };
          }
          kontekstId = k.id;
        }
        const items = srv.hentItems({
          status: 'next', skjulUdskudte: true, context: kontekstId, limit: a.limit || 100,
        });
        return { tekst: listeSomTekst(items, 'Nothing to do right now.'), data: { items } };
      },
    },
    {
      name: 'list_inbox',
      scope: 'read',
      description: 'List unprocessed items waiting for clarification, oldest first.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
      kald(a) {
        const items = srv.hentItems({ status: 'inbox', limit: a.limit || 100 });
        return { tekst: listeSomTekst(items, 'Inbox is empty.'), data: { items } };
      },
    },
    {
      name: 'search',
      scope: 'read',
      description:
        'Full-text search across tasks and notes, including their descriptions. '
        + 'Finished and dropped items are included but sorted last.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      kald(a) {
        const items = srv.soeg(String(a.query || ''));
        return { tekst: listeSomTekst(items, 'No matches.'), data: { items } };
      },
    },
    {
      name: 'complete_task',
      scope: 'write',
      description:
        'Mark a task as done. If it belongs to a repeating rule, the next occurrence is '
        + 'created automatically according to that rule.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      kald(a) {
        const item = srv.hentItem(String(a.id || ''));
        if (!item) return { fejl: `No item with id ${a.id}.` };
        if (item.status === 'done') return { tekst: `Already done: ${item.title}` };
        const faerdig = srv.fuldfoer(item);
        let s = `Done: ${faerdig.item.title}`;
        if (faerdig.next) s += `\nNext occurrence: ${faerdig.next.due_date}`;
        return { tekst: s, data: faerdig };
      },
    },
    {
      name: 'update_task',
      scope: 'write',
      description:
        'Change a task: title, description, status, project or dates. '
        + 'Statuses are inbox, next, queued, waiting, someday, done, dropped.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          note: { type: 'string', description: 'The description. Markdown, links allowed.' },
          status: { type: 'string', enum: ['inbox', 'next', 'queued', 'waiting', 'someday', 'done', 'dropped'] },
          due_date: { type: 'string', description: 'YYYY-MM-DD, or null to clear.' },
          defer_date: { type: 'string', description: 'Hide until this date. YYYY-MM-DD, or null to clear.' },
        },
        required: ['id'],
      },
      kald(a) {
        const felter = srv.renseItem(a);
        if (!Object.keys(felter).length) return { fejl: 'Nothing to change.' };
        const item = srv.opdaterItem(String(a.id || ''), felter);
        if (!item) return { fejl: `No item with id ${a.id}.` };
        return { tekst: `Updated: ${item.title} (${item.status})`, data: { item } };
      },
    },
    {
      name: 'list_projects',
      scope: 'read',
      description:
        'List projects with their area, open task count, and whether they are missing a '
        + 'next action — the classic GTD failure worth surfacing.',
      inputSchema: { type: 'object', properties: {} },
      kald() {
        const projekter = srv.hentProjekter();
        const omraader = srv.hentOmraader();
        if (!projekter.length) return { tekst: 'No projects yet.', data: { projects: [] } };
        const linjer = projekter.map((p) => {
          const omr = p.area_id ? (omraader.find((o) => o.id === p.area_id) || {}).name : null;
          const dele = [p.name];
          if (omr) dele.push(omr);
          dele.push(`${p.open_count} open`);
          if (p.status !== 'active') dele.push(p.status);
          else if (!p.next_count && p.open_count > 0) dele.push('NO NEXT ACTION');
          return `- ${dele.join('  ·  ')}  [id: ${p.id}]`;
        });
        return { tekst: linjer.join('\n'), data: { projects: projekter, areas: omraader } };
      },
    },
    {
      name: 'get_project',
      scope: 'read',
      description: 'Everything in one project: its tasks, its notes, and any subprojects.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Project id, or its exact name.' } },
        required: ['id'],
      },
      kald(a) {
        const navn = String(a.id || '');
        let d = srv.projektMedIndhold(navn);
        if (!d) {
          const fundet = srv.findProjekt(navn);
          if (fundet) d = srv.projektMedIndhold(fundet.id);
        }
        if (!d) return { fejl: `No project called "${navn}".` };
        let s = `# ${d.project.name}`;
        if (d.project.outcome) s += `\n\n${d.project.outcome}`;
        s += `\n\n## Tasks\n${listeSomTekst(d.tasks, '(none)')}`;
        s += `\n\n## Notes\n${d.notes.length ? d.notes.map((n) => `- ${n.title}${n.note ? `\n  ${n.note.replace(/\n/g, '\n  ')}` : ''}`).join('\n') : '(none)'}`;
        return { tekst: s, data: d };
      },
    },
    {
      name: 'list_repeating',
      scope: 'read',
      description:
        'List repeating tasks with their rule, next due date and how many times they have '
        + 'been skipped. A high skip count means the habit is not working.',
      inputSchema: { type: 'object', properties: {} },
      kald() {
        const r = srv.hentGentagelser();
        if (!r.length) return { tekst: 'Nothing repeats yet.', data: { recurrences: [] } };
        const linjer = r.map((x) => {
          const dele = [x.title, x.description, x.paused ? 'PAUSED' : `next ${x.next_due}`];
          if (x.skips) dele.push(`skipped ${x.skips}x`);
          return `- ${dele.join('  ·  ')}  [id: ${x.id}]`;
        });
        return { tekst: linjer.join('\n'), data: { recurrences: r } };
      },
    },
    {
      name: 'list_attachments',
      scope: 'read',
      description:
        'List the files attached to one task or note: name, type and size. '
        + 'Returns metadata only — file contents are never sent over MCP.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The task or note id.' } },
        required: ['id'],
      },
      kald(a) {
        const item = srv.hentItem(String(a.id || ''));
        if (!item) return { fejl: `No item with id ${a.id}.` };
        const filer = item.attachments || [];
        if (!filer.length) return { tekst: `“${item.title}” has no attachments.`, data: { attachments: [] } };
        return {
          tekst: filer.map((f) => `- ${f.name}  ·  ${f.mime}  ·  ${f.size} bytes`).join('\n'),
          data: { attachments: filer },
        };
      },
    },
    {
      name: 'list_contexts',
      scope: 'read',
      description: 'List the contexts that exist, with how many next actions each one holds.',
      inputSchema: { type: 'object', properties: {} },
      kald() {
        const kontekster = srv.hentKontekster().map((c) => Object.assign({}, c, {
          next_count: srv.hentItems({ status: 'next', skjulUdskudte: true, context: c.id }).length,
        }));
        if (!kontekster.length) return { tekst: 'No contexts yet.', data: { contexts: [] } };
        return {
          tekst: kontekster.map((c) => `- #${c.name}  ·  ${c.next_count} next`).join('\n'),
          data: { contexts: kontekster },
        };
      },
    },
  ];

  function listeSomTekst(items, tomtSvar) {
    if (!items.length) return tomtSvar;
    return items.map((i) => {
      const dele = [i.title];
      if (i.contexts && i.contexts.length) dele.push(i.contexts.map((c) => `#${c.name}`).join(' '));
      if (i.due_date) dele.push(`due ${i.due_date}${i.due_time ? ` ${i.due_time}` : ''}`);
      if (i.status !== 'next') dele.push(i.status);
      return `- ${dele.join('  ·  ')}  [id: ${i.id}]`;
    }).join('\n');
  }

  /* -------------------------------------------------------- json-rpc */

  const fejl = (id, kode, besked, data) => ({
    jsonrpc: '2.0', id: id === undefined ? null : id,
    error: Object.assign({ code: kode, message: besked }, data ? { data } : {}),
  });
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

  function behandl(besked, auth) {
    if (!besked || besked.jsonrpc !== '2.0' || typeof besked.method !== 'string') {
      return fejl(besked && besked.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = besked;

    if (method === 'initialize') {
      const oensket = params && params.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOKOLLER.includes(oensket) ? oensket : PROTOKOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'doda', title: 'doda', version: String(srv.version) },
        instructions:
          'doda is a personal GTD task and note app. Capture with the shortcut syntax '
          + '(#context, @project, !date, !every monday) rather than filling in fields one by one. '
          + 'The list of next actions is what the user can do right now; the inbox is what they '
          + 'have not clarified yet. Never invent ids — read them from a list first.',
      });
    }
    if (method === 'ping') return ok(id, {});
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;

    if (method === 'tools/list') {
      // Vis kun de vaerktoejer, noeglen faktisk ma bruge. Sa foreslaar Claude
      // ikke noget, der alligevel giver 403.
      return ok(id, {
        tools: VAERKTOEJER.filter((v) => srv.maa(auth, v.scope)).map((v) => ({
          name: v.name, description: v.description, inputSchema: v.inputSchema,
        })),
      });
    }

    if (method === 'tools/call') {
      const navn = params && params.name;
      const v = VAERKTOEJER.find((x) => x.name === navn);
      if (!v) return fejl(id, -32602, `Unknown tool: ${navn}`);
      if (!srv.maa(auth, v.scope)) {
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text: `This access key is "${auth.token.scope}" and cannot ${v.scope}. Create a key with a wider scope in doda under Settings → Access keys.` }],
        });
      }
      let svar;
      try {
        svar = v.kald((params && params.arguments) || {});
      } catch (err) {
        srv.logError(`mcp ${navn}: ${err && err.stack ? err.stack : err}`);
        return ok(id, { isError: true, content: [{ type: 'text', text: 'The tool failed. See the doda server log.' }] });
      }
      // Fejl fra vaerktoejet er IKKE protokolfejl - de skal tilbage som et
      // resultat med isError, sa modellen kan laese og rette op.
      if (svar.fejl) return ok(id, { isError: true, content: [{ type: 'text', text: svar.fejl }] });
      return ok(id, Object.assign(
        { content: [{ type: 'text', text: svar.tekst }] },
        svar.data ? { structuredContent: svar.data } : {},
      ));
    }

    return fejl(id, -32601, `Method not found: ${method}`);
  }

  /* ------------------------------------------------------------ http */

  async function haandter(req, res, ctx) {
    // GET og DELETE hoerer til den serverstyrede SSE-stroem, som denne server
    // ikke tilbyder - alt besvares i selve POST-svaret.
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'doda answers MCP on POST only.' }));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    // DNS-rebinding: en browser pa et fremmed site ma ikke kunne na den her.
    // Kommer der ingen Origin (Claude Code, Desktop), er der intet at tjekke.
    const origin = req.headers.origin;
    if (origin) {
      const vaert = req.headers['x-forwarded-host'] || req.headers.host || '';
      let ok2 = false;
      try { ok2 = new URL(origin).host === String(vaert).split(',')[0].trim(); } catch { ok2 = false; }
      if (!ok2) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_origin', message: 'Origin not allowed.' }));
        return;
      }
    }

    const auth = srv.godkendMcp(req);
    if (!auth) {
      // WWW-Authenticate faar MCP-klienter til at sige "ugyldig noegle" i
      // stedet for at prove igen i det uendelige.
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="doda"' });
      res.end(JSON.stringify({ error: 'invalid_key', message: 'Send a valid doda access key as "Authorization: Bearer doda_…".' }));
      return;
    }

    let krop;
    try {
      // tilladArray: JSON-RPC ma sende et bundt beskeder.
      krop = await srv.readJsonBody(req, true, true);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fejl(null, -32700, 'Parse error')));
      return;
    }

    const flere = Array.isArray(krop);
    const beskeder = flere ? krop : [krop];
    const svar = beskeder.map((b) => behandl(b, auth)).filter(Boolean);

    // Kun notifikationer i bundtet: kvitter uden krop, som protokollen kraever.
    if (!svar.length) { res.writeHead(202); res.end(); return; }

    const data = JSON.stringify(flere ? svar : svar[0]);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': PROTOKOL,
      'Content-Length': Buffer.byteLength(data),
    });
    res.end(data);
  }

  return { haandter, VAERKTOEJER, behandl };
}

module.exports = { opret, PROTOKOL };
