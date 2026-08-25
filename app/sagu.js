/*
 * doda -> Sagu (F8). Broen til notearkivet.
 *
 * Sagu er soesterappen, der skal afloese Notion som det sted, noterne bor.
 * `notion.js` ved siden af bliver staaende, indtil migreringen er koert
 * faerdig: to kilder til det samme felt er i orden, saa laenge feltet er
 * GENERISK. Det er `link_url`/`link_title` med vilje - de blev aldrig doebt
 * `notion_url`.
 *
 * ── Hvorfor det er billigere end Notion-integrationen ─────────────────────
 *
 * Samme maskine, ingen fremmed API-version, ingen »har du husket at dele
 * siden?«. Sagu har med vilje en SMAL doer: en `link`-noegle kan soege og
 * oprette - og ikke slette. Den rettighed findes, fordi den her bro skulle
 * bruge den.
 *
 * ── Modulgraensen ─────────────────────────────────────────────────────────
 *
 * Som `notion.js`: modulet kender hverken database eller http-lag og faar sin
 * adresse og noegle gennem `srv`. Det goer fejlstierne proevbare uden en
 * Sagu at proeve imod - og fejlstierne er dem, der faktisk sker.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');

/** En Sagu, der ikke svarer, maa ikke kunne haenge doda. */
const TIMEOUT_MS = 10000;

/** Et svar fra en fremmed tjeneste maa ikke kunne fylde hukommelsen. */
const MAX_SVAR = 2 * 1024 * 1024;

/**
 * Note-id'et i en Sagu-adresse.
 *
 * `#note-<32 hex>` er den adresse, Sagu SELV aabner paa - baade fra et link i
 * en note og fra en fremmed fane. Der er derfor ingen anden form at gaette
 * paa (samme rolle som `idFraUrl` i notion.js).
 */
function idFraUrl(url) {
  const m = String(url || '').match(/#note-([0-9a-f]{32})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Er adressen overhovedet en Sagu-note? Bruges til at vaelge rude i UI'et. */
function erSaguUrl(url, base) {
  if (!idFraUrl(url)) return false;
  if (!base) return true;
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

function opret(srv) {
  /** Ét sted der taler med Sagu. Returnerer {status, data}. */
  function kald(metode, sti, krop) {
    return new Promise((ok) => {
      const base = srv.hentUrl();
      const noegle = srv.hentNoegle();
      if (!base || !noegle) { ok({ status: 0, data: null, ingen: true }); return; }
      let u;
      try { u = new URL(base + sti); } catch { ok({ status: 0, data: null }); return; }
      const body = krop ? Buffer.from(JSON.stringify(krop)) : null;
      const lag = u.protocol === 'http:' ? http : https;
      const req = lag.request({
        method: metode,
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        headers: Object.assign({ Authorization: `Bearer ${noegle}` },
          body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
        timeout: TIMEOUT_MS,
      }, (res) => {
        const dele = [];
        let n = 0;
        res.on('data', (d) => { n += d.length; if (n <= MAX_SVAR) dele.push(d); });
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(Buffer.concat(dele).toString('utf8')); } catch { data = null; }
          ok({ status: res.statusCode, data });
        });
      });
      req.on('timeout', () => { req.destroy(); ok({ status: 0, data: null }); });
      req.on('error', () => ok({ status: 0, data: null }));
      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * Oversaetter et svar til noget, et MENNESKE kan handle paa.
   *
   * De tre fejl foerer til hver sin handling, og de maa ikke smelte sammen:
   * en adresse, der ikke svarer, er ikke det samme som en forkert noegle -
   * og en for SMAL noegle er hverken. Sagus egen besked sendes ordret videre,
   * fordi den allerede siger, hvilket scope noeglen har.
   */
  function fejlAf(r) {
    if (r.ingen) return 'Connect Sagu under Settings first.';
    if (r.status === 0) return 'Could not reach Sagu. Check the address, and that it is running.';
    if (r.status === 403 && r.data && r.data.error === 'wrong_scope') {
      return r.data.message || 'That Sagu key is too narrow — it needs the "link" scope.';
    }
    if (r.status === 401 || r.status === 403) {
      return 'Sagu refused the key. Create a new "link" key in Sagu and paste it again.';
    }
    return (r.data && r.data.message) || `Sagu answered ${r.status}.`;
  }

  /** Notens adresse, som Sagu selv aabner paa. */
  function noteUrl(id) {
    return `${String(srv.hentUrl() || '').replace(/\/+$/, '')}/#note-${id}`;
  }

  /**
   * Er forbindelsen i orden - og hvad kan noeglen?
   *
   * `/api/v1/state` kraever `read` og aendrer ingenting. Lykkes den, kan
   * noeglen baade naa Sagu og laese. Fejlstien er den vigtige: en levende
   * server svarer 401 paa en forkert noegle, en doed svarer slet ikke.
   */
  async function proev() {
    const r = await kald('GET', '/api/v1/state');
    if (r.status !== 200 || !r.data) return { ok: false, fejl: fejlAf(r) };
    const n = (r.data.counts && r.data.counts.notes) || 0;
    return {
      ok: true,
      notes: n,
      // Notesboegerne hentes med det samme: de skal kunne vaelges, naar en
      // note oprettes, og det er ét kald i forvejen.
      notebooks: (r.data.notebooks || []).map((b) => ({ id: b.id, name: b.name })).slice(0, 50),
    };
  }

  async function soeg(q) {
    const r = await kald('GET', `/api/v1/search?q=${encodeURIComponent(String(q || '').slice(0, 100))}`);
    if (r.status !== 200 || !r.data) return { fejl: fejlAf(r) };
    return {
      pages: (r.data.results || []).slice(0, 12).map((s) => ({
        id: s.id,
        url: noteUrl(s.id),
        title: s.title || 'Untitled',
        icon: s.icon || '',
        // Sig hvor den ligger. To noter kan hedde det samme, og en liste, man
        // ikke kan vaelge i, er ingen hjaelp.
        kind: s.notebook || '',
      })),
      // Faldt Sagus soegning tilbage til at laese teksten, er resultatet
      // URANGERET - og det maa ikke se ud som en rangering.
      fallback: !!r.data.fallback,
    };
  }

  /** Notens friske titel - til at opdage, at nogen har doebt den om. */
  async function note(id) {
    const r = await kald('GET', `/api/v1/notes/${encodeURIComponent(id)}`);
    if (r.status !== 200 || !r.data || !r.data.note) return null;
    return {
      id: r.data.note.id,
      title: r.data.note.title || '',
      /*
       * Selve teksten. Markdown ER sandheden i Sagus database (Sagu DESIGN §1),
       * saa der er intet at konvertere - doda kan tegne den, som den staar.
       *
       * Graensen er der, fordi en note kan vaere lang, og ruden i en
       * opgave er et VINDUE ind til noten, ikke noten. Skal man laese det
       * hele, er der et link til Sagu ved siden af.
       */
      body: String(r.data.note.body || '').slice(0, 20000),
    };
  }

  /**
   * Opretter en note i Sagu.
   *
   * `notebookId` er valgfri, men den er hele forskellen paa »en note et sted«
   * og »noten dér, hvor den hoerer hjemme« (planens accept). Kroppen faar et
   * link tilbage til opgaven, saa de to kan findes fra hinanden - og det sker
   * paa sin EGEN linje, fordi et link i enden af en linje med aaben syntaks
   * bliver aedt (RUNE-ERFARINGER, Sagu F8).
   */
  async function opretNote(raaTitel, opt) {
    const o = opt || {};
    const t = String(raaTitel || '').trim().slice(0, 200) || 'Untitled';
    /*
     * Brodteksten (v58). Naar en opgave bliver til en note, SKAL beskrivelsen
     * med: opgaven slettes bagefter, og uden den ville teksten vaere vaek for
     * altid. `*` sender ingen krop - dér findes teksten ikke endnu.
     *
     * Delene saettes sammen hver for sig, saa de tre tilfaelde (kun titel,
     * titel + tilbagelink, titel + tekst) giver praecis det samme som foer,
     * hvor de var det samme.
     */
    const brod = String(o.krop || '').trim();
    const tilbage = o.tilbageUrl
      ? `From doda: [${String(o.tilbageTitel || t).slice(0, 120)}](${o.tilbageUrl})\n`
      : '';
    const krop = `# ${t}\n`
      + (brod ? `\n${brod}\n` : '')
      + (tilbage ? `\n${tilbage}` : '');
    const r = await kald('POST', '/api/v1/notes', {
      title: t,
      body: krop,
      notebookId: o.notebookId || undefined,
    });
    if (r.status !== 200 || !r.data || !r.data.note) return { fejl: fejlAf(r) };
    return { page: { id: r.data.note.id, url: noteUrl(r.data.note.id), title: t } };
  }

  /**
   * Notens kommentarer.
   *
   * Kun LAESNING: en `link`-noegle maa ikke skrive kommentarer, og det er med
   * vilje. Skal man svare, hoerer det hjemme i Sagu, hvor samtalen staar -
   * ikke i en opgaveapp, der kigger med.
   */
  async function kommentarer(id) {
    const r = await kald('GET', `/api/v1/notes/${encodeURIComponent(id)}/comments`);
    if (r.status !== 200 || !r.data) return { fejl: fejlAf(r) };
    return {
      comments: (r.data.comments || []).slice(0, 50).map((c) => ({
        author: c.author || 'Unknown',
        body: String(c.body || '').slice(0, 2000),
        at: c.createdAt || 0,
        guest: !!c.guest,
        // Hvor kommentaren blev skrevet fra (Sagu v20). Hvidlisten her er en
        // SPAERRE mod at slaebe ukendte felter med - men den aeder ogsaa de
        // felter, kilden tilfoejer BAGEFTER, og fejlen er tavs: Sagu viste
        // "from tovo", og doda viste ingenting.
        via: String(c.via || '').slice(0, 40),
      })),
    };
  }

  /**
   * Skriver en kommentar paa en note.
   *
   * Sagu v8 saenkede kravet fra `write` til `capture`: en kommentar AENDRER
   * ikke noten, og det er samme skel, Sagu allerede traf i F11 - en side delt
   * til laesning maa gerne kommenteres. En `link`-noegle kan derfor det her.
   *
   * Svaret afhaenger af noeglen: en ren `capture`-noegle faar IKKE `comments`
   * med retur, for saa ville skrive-doeren vaere blevet en laese-kanal. Vores
   * noegle er capture+read og faar listen - men koden maa ikke bygge paa det,
   * saa `comments` er `null`, naar den mangler, og kalderen henter selv.
   *
   * `message` er en FAERDIG linje fra Sagu og skal vises ordret: er
   * moderationskoeen slaaet til, er kommentaren ikke synlig endnu, og det er
   * kun Sagu, der ved det.
   */
  async function skrivKommentar(id, tekst) {
    const r = await kald('POST', `/api/v1/notes/${encodeURIComponent(id)}/comments`,
      { body: String(tekst || '').slice(0, 2000) });
    if (r.status !== 200 || !r.data) return { fejl: fejlAf(r) };
    return {
      besked: String(r.data.message || 'Comment added.').slice(0, 200),
      comments: Array.isArray(r.data.comments)
        ? r.data.comments.slice(0, 50).map((c) => ({
          author: c.author || 'Unknown',
          body: String(c.body || '').slice(0, 2000),
          at: c.createdAt || 0,
          guest: !!c.guest,
          via: String(c.via || '').slice(0, 40),
        }))
        : null,
    };
  }

  /**
   * Et billede fra en note - RAA bytes, ikke JSON.
   *
   * `kald()` parser altid svaret som JSON og duer derfor ikke. Doda henter
   * filen med sin egen noegle og sender den videre, saa et billede i en
   * Sagu-note kan VISES i doda; uden det ville en note vaere tekst med huller
   * i (Andreas, 25-08-2026).
   *
   * KUN billeder slipper igennem, og det er ikke en smagssag: doda serverer
   * svaret fra sin EGEN oprindelse, saa en note, der kunne faa en `text/html`
   * igennem, ville kunne koere script i dodas navn. Mimetypen kommer fra
   * Sagus svar og proeves her, ikke af den, der kalder.
   */
  function hentFil(id) {
    return new Promise((ok) => {
      const base = srv.hentUrl();
      const noegle = srv.hentNoegle();
      if (!base || !noegle) { ok({ fejl: 'not_connected' }); return; }
      if (!/^[a-f0-9]{32}$/.test(String(id || ''))) { ok({ fejl: 'bad_id' }); return; }
      let u;
      try { u = new URL(base + '/api/v1/files/' + id); } catch { ok({ fejl: 'bad_url' }); return; }
      const lag = u.protocol === 'http:' ? http : https;
      const req = lag.request({
        method: 'GET',
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname,
        headers: { Authorization: `Bearer ${noegle}` },
        timeout: TIMEOUT_MS,
      }, (res) => {
        const mime = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (res.statusCode !== 200 || !/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(mime)) {
          res.resume();
          ok({ fejl: res.statusCode === 200 ? 'ikke_billede' : 'status_' + res.statusCode });
          return;
        }
        const dele = [];
        let n = 0;
        let brudt = false;
        res.on('data', (d) => {
          n += d.length;
          // For stor: afbryd i stedet for at samle et billede, ingen faar at se.
          if (n > MAX_SVAR) { brudt = true; req.destroy(); return; }
          dele.push(d);
        });
        res.on('end', () => {
          if (brudt) { ok({ fejl: 'for_stor' }); return; }
          ok({ mime, data: Buffer.concat(dele) });
        });
      });
      req.on('timeout', () => { req.destroy(); ok({ fejl: 'timeout' }); });
      req.on('error', () => ok({ fejl: 'netvaerk' }));
      req.end();
    });
  }

  return { proev, soeg, note, opretNote, kommentarer, skrivKommentar, noteUrl, kald, hentFil };
}

module.exports = { opret, idFraUrl, erSaguUrl };
