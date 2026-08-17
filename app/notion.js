'use strict';
/*
 * doda - Notion. Soeg efter en side inde fra doda og haeng den paa en opgave,
 * en note eller et projekt.
 *
 * Linket i sig selv kraever INGEN integration (v14): man kan altid indsaette
 * en adresse. Det her giver to ting oveni - man kan finde siden uden at skifte
 * vindue, og chippen faar sidens RIGTIGE titel i stedet for 40 tegn hex.
 *
 * VIGTIGT OM NOTION: en intern integration ser kun de sider, den er delt med.
 * Et gyldigt token er ikke nok - brugeren skal dele siden (eller dens
 * overordnede) med integrationen inde i Notion. Derfor svarer en tom soegning
 * ikke "ingen traeffere", men "har du husket at dele siderne?".
 *
 * Hemmeligheden bliver paa serveren og sendes ALDRIG til frontenden
 * (RUNE-ERFARINGER §6b) - kun et `connected: true`.
 */

const https = require('node:https');

const VERSION = '2022-06-28';   // Notion kraever en eksplicit API-version

function opret(srv) {
  /** Ét sted der taler med Notion. Returnerer {status, data}. */
  function kald(metode, sti, krop) {
    return new Promise((ok) => {
      const token = srv.hentToken();
      if (!token) { ok({ status: 0, data: null }); return; }
      const body = krop ? Buffer.from(JSON.stringify(krop)) : null;
      const req = https.request({
        method: metode,
        hostname: 'api.notion.com',
        path: `/v1${sti}`,
        headers: Object.assign({
          Authorization: `Bearer ${token}`,
          'Notion-Version': VERSION,
        }, body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
        timeout: 12000,
      }, (res) => {
        const dele = [];
        let n = 0;
        res.on('data', (d) => {
          n += d.length;
          // Et svar fra en fremmed tjeneste maa ikke kunne fylde hukommelsen.
          if (n <= 2 * 1024 * 1024) dele.push(d);
        });
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
   * Titlen paa en side.
   *
   * Titel-egenskaben kan hedde hvad som helst i en database - det er dens
   * TYPE, der afgoer det, ikke dens navn. Derfor ledes der efter type
   * 'title' frem for efter noeglen "title" eller "Name".
   */
  function titel(side) {
    const egenskaber = (side && side.properties) || {};
    for (const v of Object.values(egenskaber)) {
      if (v && v.type === 'title' && Array.isArray(v.title)) {
        const s = v.title.map((d) => d.plain_text || '').join('').trim();
        if (s) return s.slice(0, 200);
      }
    }
    // Databaser har titlen et andet sted end sider.
    if (side && Array.isArray(side.title)) {
      const s = side.title.map((d) => d.plain_text || '').join('').trim();
      if (s) return s.slice(0, 200);
    }
    return '';
  }

  /** Er tokenet gyldigt, og hvilket arbejdsrum hoerer det til? */
  async function proev() {
    const r = await kald('GET', '/users/me');
    if (r.status === 200 && r.data) {
      return { ok: true, workspace: (r.data.bot && r.data.bot.workspace_name) || r.data.name || '' };
    }
    if (r.status === 401) return { ok: false, fejl: 'Notion says that token is not valid.' };
    if (r.status === 0) return { ok: false, fejl: 'Could not reach Notion.' };
    return { ok: false, fejl: (r.data && r.data.message) || `Notion answered ${r.status}.` };
  }

  async function soeg(q) {
    // INTET object-filter: en database er lige saa gyldig at linke til som en
    // side, og titlen paa begge kan laeses af titel() nedenfor. Med
    // filter: {value:'page'} kunne man ikke finde et projekt, der ligger som
    // en database - og det er ikke til at gennemskue for den, der soeger.
    const r = await kald('POST', '/search', {
      query: String(q || '').slice(0, 100),
      page_size: 12,
    });
    if (r.status !== 200 || !r.data) {
      return { fejl: (r.data && r.data.message) || 'Could not reach Notion.' };
    }
    const sider = (r.data.results || []).map((s) => ({
      id: s.id,
      url: s.url || '',
      title: titel(s) || 'Untitled',
      icon: (s.icon && s.icon.type === 'emoji' && s.icon.emoji) || '',
      // Sig hvad det ER. En database og en side ser ens ud i en liste, og
      // man skal kunne se forskel, foer man vaelger.
      kind: s.object === 'database' ? 'database' : 'page',
    })).filter((s) => s.url);
    return { pages: sider };
  }

  /** Titlen paa én kendt side - til at genopfriske en chip. */
  async function side(id) {
    const r = await kald('GET', `/pages/${encodeURIComponent(id)}`);
    if (r.status !== 200 || !r.data) return null;
    return { id: r.data.id, url: r.data.url || '', title: titel(r.data) || 'Untitled' };
  }

  return { proev, soeg, side };
}

/** Side-id'et ligger i enden af en Notion-adresse: 32 tegn hex. */
function idFraUrl(url) {
  const m = String(url || '').match(/([0-9a-f]{32})(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

module.exports = { opret, idFraUrl };
