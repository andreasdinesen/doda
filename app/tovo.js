/*
 * doda -> tovo. Broen til tidsregistreringen.
 *
 * tovo er soesterappen, hvor timerne bor. Indtil nu var de to med vilje
 * adskilt ("ingen kobling", tovos egne regler) - og det er de stadig paa den
 * maade, der betyder noget: der SYNKRONISERES ingenting. doda beder tovo om
 * at starte et ur, og tovo svarer. Ingen af dem holder den andens data ved
 * lige.
 *
 * ── Hvorfor tovo ikke skal aendres ────────────────────────────────────────
 *
 * Alt, broen bruger, fandtes i forvejen: `/api/v1/state` (projekter OG den
 * koerende timer i ét kald), `/api/v1/items` (opret en opgave uden at gaa
 * gennem parseren), `/api/v1/timer/start|stop|current`. Det er hele grunden
 * til, at fase 1 kun roerer doda.
 *
 * ── Den ene regel, der ikke maa brydes ────────────────────────────────────
 *
 * **doda OPRETTER en tovo-opgave og roerer den aldrig igen.**
 *
 * tovos `POST /api/v1/items` gemmer en HEL opgave: sender man et bart objekt
 * med kun titlen, slettes estimat, note, kolonne og links (tovos egen
 * lektie, `flet()`/`luk()`). En »ret lige titlen med«-funktion herfra ville
 * altsaa kunne rydde felter, doda ikke aner findes. Doeber man en opgave om
 * i doda, beholder tovo derfor den oprindelige titel - og det er det rigtige
 * for et LINK.
 *
 * ── Modulgraensen ─────────────────────────────────────────────────────────
 *
 * Som `sagu.js` og `notion.js`: modulet kender hverken database eller
 * http-lag og faar sin adresse og noegle gennem `srv`. Fejlstierne kan
 * dermed proeves uden en tovo at proeve imod - og fejlstierne er dem, der
 * faktisk sker.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');

/** En tovo, der ikke svarer, maa ikke kunne haenge doda. */
const TIMEOUT_MS = 10000;

/** Et svar fra en fremmed tjeneste maa ikke kunne fylde hukommelsen. */
const MAX_SVAR = 2 * 1024 * 1024;

function opret(srv) {
  /** Ét sted der taler med tovo. Returnerer {status, data}. */
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
   * De fire fejl foerer til hver sin handling og maa ikke smelte sammen: en
   * adresse, der ikke svarer, er ikke det samme som en forkert noegle - og en
   * for SMAL noegle er hverken. Sidstnaevnte er den sandsynlige her: tovos
   * `capture`-noegle kan hverken laese state eller starte et ur, og den fejl
   * ville ellers ligne "forkert noegle" og sende Andreas ud at lave en ny af
   * samme slags.
   */
  function fejlAf(r) {
    if (r.ingen) return 'Connect tovo under Settings first.';
    if (r.status === 0) return 'Could not reach tovo. Check the address, and that it is running.';
    if (r.status === 403 && r.data && r.data.error === 'wrong_scope') {
      return r.data.message || 'That tovo key is too narrow — it needs to be a "full" key.';
    }
    if (r.status === 401 || r.status === 403) {
      return 'tovo refused the key. Create a new "full" key in tovo and paste it again.';
    }
    if (r.status === 429) return 'tovo is rate-limiting this key. Try again in a moment.';
    return (r.data && r.data.message) || `tovo answered ${r.status}.`;
  }

  /* Kun de felter, doda faktisk viser. En hvidliste her betyder, at en ny
     noegle i tovos svar ikke tavst slaebes med ind i dodas tilstand. */
  function pakTimer(t) {
    if (!t || !t.entry) return null;
    return {
      entryId: String(t.entry.id || ''),
      taskId: String(t.entry.taskId || ''),
      // Starttidspunktet, ikke en taelling: fladen kan saa tikke selv uden at
      // spoerge igen, og tallet kan ikke drive (samme greb som fokusuret).
      startedAt: Number(t.entry.startedAt) || 0,
      title: String(t.taskTitle || '').slice(0, 200),
      project: t.projectName ? String(t.projectName).slice(0, 120) : null,
      minutes: Number(t.minutes) || 0,
      tooLong: !!t.tooLong,
    };
  }

  /**
   * Er forbindelsen i orden - og hvad findes der?
   *
   * `/api/v1/state` er ét kald og baerer BAADE projektlisten og den koerende
   * timer. Det er derfor ogsaa den, der bruges til at opfriske ikonet: at
   * hente timeren for sig ville vaere en rundtur mere efter noget, vi
   * alligevel faar.
   *
   * Fejlstien er den vigtige: en levende tovo svarer 401 paa en forkert
   * noegle, en doed svarer slet ikke (RUNE-ERFARINGER §6b).
   */
  async function proev() {
    const r = await kald('GET', '/api/v1/state');
    if (r.status !== 200 || !r.data) return { ok: false, fejl: fejlAf(r) };
    return {
      ok: true,
      user: r.data.user && r.data.user.username ? String(r.data.user.username).slice(0, 80) : '',
      projects: (r.data.projects || []).slice(0, 200).map((p) => ({
        id: String(p.id || ''),
        name: String(p.name || 'Untitled').slice(0, 120),
        customer: p.customer ? String(p.customer).slice(0, 120) : '',
      })),
      timer: pakTimer(r.data.timer),
    };
  }

  /**
   * Opretter opgaven i tovo og giver dens id tilbage.
   *
   * Gaar UDEN OM `/api/v1/capture`. Fangstlinjen ville tolke titlen, og en
   * doda-titel er ikke skrevet til tovos parser: »Ring til Nordvind om
   * #12 kl. 9-11« ville blive et maerkat og et estimat, og teksten ville
   * forsvinde ud af titlen. Et element oprettes derfor med felterne direkte.
   */
  async function opretOpgave(raaTitel, projectId) {
    const titel = String(raaTitel || '').trim().slice(0, 500) || 'Untitled';
    const r = await kald('POST', '/api/v1/items', {
      kind: 'task',
      title: titel,
      projectId: projectId || undefined,
      // Saa det kan ses i tovo, hvor opgaven kom fra. doda har ingen
      // adresser til enkelte opgaver, saa der er ikke et link at give.
      note: 'Created by doda.',
    });
    if (r.status !== 200 || !r.data || !r.data.item) return { fejl: fejlAf(r) };
    return { taskId: String(r.data.item.id || '') };
  }

  /**
   * Starter uret.
   *
   * `borte: true` naar tovo ikke kender opgaven laengere. Den er ikke en fejl
   * at vise - den er en besked til kalderen om at oprette opgaven igen og
   * proeve een gang til. Slettes en opgave i tovo, skal doda kunne komme
   * videre uden at Andreas skal koble noget fra og til.
   */
  async function start(taskId) {
    const r = await kald('POST', '/api/v1/timer/start', { taskId: String(taskId || '') });
    if (r.status === 404) return { borte: true };
    if (r.status !== 200 || !r.data) return { fejl: fejlAf(r) };
    return { timer: pakTimer(r.data.timer), stoppede: !!r.data.stopped };
  }

  /**
   * Stopper uret.
   *
   * At der ikke koerte noget er IKKE en fejl. Tryk to gange, eller stop fra
   * telefonen imens, og doda ville ellers vise en roed besked for at have
   * faaet praecis det, den bad om.
   */
  async function stop() {
    const r = await kald('POST', '/api/v1/timer/stop', {});
    if (r.status === 404) return { intet: true };
    if (r.status !== 200 || !r.data) return { fejl: fejlAf(r) };
    return { ok: true };
  }

  /**
   * Hvor lang tid der er registreret paa opgaven - i MINUTTER.
   *
   * Tallet regnes af **tovo**, ikke af doda. Det er ikke pedanteri: tovo
   * afrunder pr. tidspost efter en indstilling, doda ikke kender
   * (`beregn.js`, `afrund`), saa en sum lavet her ville kunne vise noget
   * andet end den timeseddel, der bliver skrevet af. To udregninger er to
   * sandheder - tovos egen foerste regel.
   *
   * Derfor spoerges der ad de ruter, der ALLEREDE baerer `spent` pr. opgave,
   * regnet med `forbrugPaaOpgave`: projektruden og »opgaver uden projekt«.
   * Der skal ingen ny rute i tovo til, og tallet kan ikke komme til at
   * afvige fra det, tovo selv viser.
   *
   * Projektet proeves foerst, naar vi kender det. Rammer opgaven ikke dér -
   * fordi den er flyttet i tovo, siden doda sidst saa efter - falder vi
   * tilbage til de projektloese. To rundture i det tilfaelde, ingen i det
   * normale.
   */
  async function forbrug(taskId, projectId) {
    const id = String(taskId || '');
    if (!id) return { fejl: 'no_task' };

    const laes = async (sti) => {
      const r = await kald('GET', sti);
      if (r.status !== 200 || !r.data || !r.data.spent) return null;
      return Object.prototype.hasOwnProperty.call(r.data.spent, id)
        ? { minutes: Number(r.data.spent[id]) || 0 }
        : null;
    };

    if (projectId) {
      const via = await laes(`/api/v1/projects/${encodeURIComponent(projectId)}`);
      if (via) return via;
    }
    const uden = await laes('/api/v1/no-project');
    if (uden) return uden;
    /*
     * Opgaven findes ikke nogen af stederne. Det er IKKE nul minutter - det
     * er »ved ikke«, og de to maa ikke blandes: »0m registreret« paa en
     * opgave, man lige har taget en time paa, ville vaere en paastand om
     * noget forkert. Kalderen viser ingenting.
     */
    return { ukendt: true };
  }

  /**
   * Stopper uret - men KUN hvis det koerer paa den her opgave.
   *
   * Bruges, naar en opgave krydses af. Et bart `stop()` ville stoppe det,
   * der koerer, uanset hvad: afslutter man opgave A, mens uret loeber paa B,
   * ville B's tidtagning blive lukket uden at nogen bad om det.
   *
   * Der laeses foerst og stoppes bagefter, saa der er et vindue paa et par
   * hundrede millisekunder, hvor nogen kan naa at skifte opgave fra en anden
   * enhed. tovo har ingen »stop hvis det er DEN her«-rute, og et vindue paa
   * et oejeblik er bedre end at stoppe den forkerte hver gang.
   */
  async function stopHvisDenne(taskId) {
    const id = String(taskId || '');
    if (!id) return { stoppet: false };
    const n = await timer();
    if (n.fejl) return { fejl: n.fejl };
    if (!n.timer || n.timer.taskId !== id) return { stoppet: false };
    const r = await stop();
    if (r.fejl) return { fejl: r.fejl };
    return { stoppet: !r.intet };
  }

  /** Kun den koerende timer. Til de steder, hvor projektlisten er ligegyldig. */
  async function timer() {
    const r = await kald('GET', '/api/v1/timer/current');
    if (r.status !== 200 || !r.data) return { fejl: fejlAf(r) };
    return { timer: pakTimer(r.data.timer) };
  }

  /**
   * tovos forside.
   *
   * Med VILJE ikke en adresse til den enkelte opgave. tovo har direkte
   * adresser til sine SIDER (`/today`, `/projects/<id>`), men ingen til en
   * opgave - `shared/ruter.js` laeser ikke noget forespoergselsled. Et
   * `?task=<id>` ville derfor lande paa Today og se ud som om, linket var
   * i stykker. Et link, der lyver om hvor det foerer hen, er vaerre end et
   * link til forsiden.
   */
  function hjemUrl() {
    return String(srv.hentUrl() || '').replace(/\/+$/, '');
  }

  return { proev, opretOpgave, start, stop, stopHvisDenne, timer, forbrug, hjemUrl, kald };
}

module.exports = { opret };
