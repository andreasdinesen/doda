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

/* Kommentarer kraever en SAERSKILT tilladelse paa integrationen i Notion.
   Et token, der kan laese sider fint, faar 403 paa kommentarer, indtil
   afkrydsningen er sat - saa fejlen skal pege paa knappen, ikke paa tokenet. */
const MANGLER_LOV = 'Your Notion integration may not read or write comments yet. '
  + 'Open it in Notion under Settings → Connections, and tick the comment '
  + 'capabilities. Then try again.';

/* --------------------------------------------------- sidens indhold */

const NAVNE = {
  image: '\u{1F5BC} image', file: '\u{1F4CE} file', video: '\u{1F3AC} video',
  pdf: '\u{1F4C4} pdf', audio: '\u{1F50A} audio',
};

/**
 * Adressen paa en blok INDE i sin side.
 *
 * `notion.so/<blok-id>` alene duer IKKE: Notion proever da at aabne blokken
 * som en side, og en billedblok er ikke en side - man faar en tom "Untitled".
 * Det rigtige er sidens id med blokken som anker, praecis som Notions egen
 * "Copy link to block" laver den.
 */
function blokUrl(sideId, blokId) {
  const rens = (s) => String(s || '').replace(/-/g, '');
  if (!sideId) return blokId ? `https://www.notion.so/${rens(blokId)}` : '';
  return `https://www.notion.so/${rens(sideId)}${blokId ? `#${rens(blokId)}` : ''}`;
}

/** En adresse, der kan STAA der - ikke en, der fylder en hel rude. */
function kortUrl(url) {
  const s = String(url || '').replace(/^https?:\/\//, '');
  return s.length <= 70 ? s : `${s.slice(0, 60)}…`;
}

/** Rich text -> markdown. Annoteringerne er flag, ikke en traestruktur. */
function tekst(dele) {
  return (dele || []).map((d) => {
    let s = d.plain_text || '';
    if (!s) return '';
    const a = d.annotations || {};
    // Kode foerst: **fed** inde i `kode` ville vaere forkert.
    if (a.code) s = `\`${s}\``;
    else {
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `*${s}*`;
    }
    if (d.href) s = `[${s}](${d.href})`;
    return s;
  }).join('');
}

/**
 * Én blok -> markdown, i det format dodas EGEN renderer forstaar.
 *
 * Der bygges aldrig HTML her. Resultatet gaar gennem markdown(), som
 * escaper foerst og kun laver de tags, den selv kender - saa er der ingen
 * vej fra en fremmed side til et tag, doda ikke har skrevet.
 */
function blokTilMd(b, dybde, sideId) {
  const ind = '  '.repeat(Math.min(dybde, 2));
  const v = b[b.type] || {};
  const rt = () => tekst(v.rich_text);
  switch (b.type) {
    case 'paragraph': return rt();
    case 'heading_1': return `# ${rt()}`;
    case 'heading_2': return `## ${rt()}`;
    case 'heading_3': return `### ${rt()}`;
    case 'bulleted_list_item': return `${ind}- ${rt()}`;
    case 'numbered_list_item': return `${ind}1. ${rt()}`;
    case 'to_do': return `${ind}- ${v.checked ? '\u2611' : '\u2610'} ${rt()}`;
    case 'quote': return `> ${rt()}`;
    case 'callout': return `> ${v.icon && v.icon.emoji ? `${v.icon.emoji} ` : ''}${rt()}`;
    case 'toggle': return `**${rt()}**`;
    case 'divider': return '---';
    case 'code':
      // doda's markdown har ingen kodeblokke - hver linje som inline kode
      // er ikke smukt, men det er laesbart og forbliver sikkert.
      return tekst(v.rich_text).split('\n').map((l) => `\`${l}\``).join('\n');
    case 'child_page': return `**${v.title || 'Untitled'}** (subpage)`;
    case 'child_database': return `**${v.title || 'Untitled'}** (database)`;
    /*
     * Filer peger paa BLOKKEN i Notion - aldrig paa filens egen adresse.
     *
     * To grunde, og den anden er den vigtigste:
     *  1. Dodas CSP er img-src 'self', saa billedet kan alligevel ikke vises.
     *  2. Notions fil-adresser er SIGNEREDE og udloeber efter en time. Et link
     *     til en af dem er doedt i morgen - og de er ~1500 tegn, hvilket baade
     *     fylder hele ruden og spraenger dodas link-genkendelse (som stopper
     *     ved 500), saa halen loeber ud som raa tekst.
     * Adressen er sidens id MED blokken som anker. Kun blok-id'et alene duer
     * ikke: Notion proever da at aabne blokken som en side og viser en tom
     * "Untitled" - se blokUrl().
     */
    case 'image': case 'file': case 'video': case 'pdf': case 'audio': {
      const navn = tekst(v.caption) || NAVNE[b.type] || b.type;
      const url = blokUrl(sideId, b.id);
      // Uden en side at pege ind i er et link vaerre end ingenting: det
      // ville aabne en tom side og ligne en fejl i Notion.
      return url ? `[${navn}](${url})` : `*(${navn})*`;
    }
    case 'bookmark': case 'embed': case 'link_preview':
      if (!v.url) return '';
      // En lang adresse vises kort OG peger paa blokken - ellers er linket
      // baade ulaeseligt og for langt til at blive genkendt.
      return v.url.length > 300
        ? `[${kortUrl(v.url)}](${blokUrl(sideId, b.id) || v.url})`
        : `[${kortUrl(v.url)}](${v.url})`;
    case 'table': case 'column_list': case 'synced_block':
      return `*(${b.type.replace(/_/g, ' ')} — open it in Notion)*`;
    default: return rt();
  }
}

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

  /**
   * Sidens indhold som markdown.
   *
   * Loftet er bevidst: en fremmed side kan vaere hvor stor som helst, og
   * doda skal ikke kunne vaeltes af en, nogen har delt.
   */
  async function indhold(id, dybde = 0, budget = { blokke: 300 }, sideId = id) {
    const ud = [];
    let markoer = null;
    do {
      const q = `?page_size=100${markoer ? `&start_cursor=${encodeURIComponent(markoer)}` : ''}`;
      const r = await kald('GET', `/blocks/${encodeURIComponent(id)}/children${q}`);
      if (r.status !== 200 || !r.data) {
        return { fejl: (r.data && r.data.message) || 'Could not read that page.' };
      }
      for (const b of r.data.results || []) {
        if (budget.blokke-- <= 0) { ud.push('*(the rest is in Notion)*'); markoer = null; break; }
        // sideId er ROD-siden hele vejen ned: et billede i en indlejret
        // blok skal stadig aabne den side, det staar paa.
        const md = blokTilMd(b, dybde, sideId);
        if (md) ud.push(md);
        // Ét niveau ned. Dybere ville koste et kald pr. blok, og dodas
        // markdown kan alligevel ikke vise dyb indlejring.
        if (b.has_children && dybde < 1 && b.type !== 'child_page' && b.type !== 'child_database') {
          const boern = await indhold(b.id, dybde + 1, budget, sideId);
          if (boern.markdown) ud.push(boern.markdown);
        }
      }
      markoer = r.data.has_more ? r.data.next_cursor : null;
    } while (markoer);

    return { markdown: ud.join('\n\n') };
  }

  /** Titlen paa én kendt side - til at genopfriske en chip. */
  async function side(id) {
    const r = await kald('GET', `/pages/${encodeURIComponent(id)}`);
    if (r.status !== 200 || !r.data) return null;
    return { id: r.data.id, url: r.data.url || '', title: titel(r.data) || 'Untitled' };
  }

  /**
   * Kommentarerne paa en side.
   *
   * Notion kraever, at integrationen har faaet lov at LAESE kommentarer -
   * det er en afkrydsning i Notion, ikke noget doda kan give sig selv. Uden
   * den svarer API'et 403 `restricted_resource`, og den fejl skal siges med
   * rene ord, ellers leder brugeren efter fejlen i sit token, som er i orden.
   */
  async function kommentarer(id) {
    const r = await kald('GET', `/comments?block_id=${encodeURIComponent(id)}&page_size=50`);
    if (r.status === 403) return { fejl: MANGLER_LOV };
    if (r.status !== 200 || !r.data) {
      return { fejl: (r.data && r.data.message) || 'Could not read the comments.' };
    }
    return {
      comments: (r.data.results || []).map((k) => ({
        id: k.id,
        text: tekst(k.rich_text || []).slice(0, 2000),
        // En integration har intet navn paa en person; er der ingen, siger vi
        // det ikke, i stedet for at finde paa et.
        author: (k.created_by && k.created_by.name) || '',
        created: k.created_time || '',
      })).filter((k) => k.text),
    };
  }

  /** Skriver en kommentar paa siden. Notion svarer med den, den lavede. */
  async function kommenter(id, raa) {
    const t = String(raa || '').trim().slice(0, 2000);
    if (!t) return { fejl: 'There is no comment to send.' };
    const r = await kald('POST', '/comments', {
      parent: { page_id: id },
      rich_text: [{ text: { content: t } }],
    });
    if (r.status === 403) return { fejl: MANGLER_LOV };
    if (r.status !== 200 || !r.data) {
      return { fejl: (r.data && r.data.message) || 'Notion would not take that comment.' };
    }
    return {
      comment: {
        id: r.data.id,
        text: tekst(r.data.rich_text || []) || t,
        author: (r.data.created_by && r.data.created_by.name) || '',
        created: r.data.created_time || '',
      },
    };
  }

  return { proev, soeg, side, indhold, kommentarer, kommenter };
}

/** Side-id'et ligger i enden af en Notion-adresse: 32 tegn hex. */
function idFraUrl(url) {
  const m = String(url || '').match(/([0-9a-f]{32})(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

module.exports = { opret, idFraUrl, blokTilMd, tekst };
