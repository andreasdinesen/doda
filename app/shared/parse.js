/* doda - faelles parser for genvejssyntaks og dansk datosprog.
 *
 * Denne fil koeres BEGGE steder: serveren require'r den, og build_rune.py
 * praeplacerer den i app.js. Det er med vilje - fangst fra webappen, fra en
 * iOS-genvej og fra MCP skal tolke praecis den samme tekst (handover §5.10).
 * Retter du noget her, gaelder det alle veje ind i appen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.dodaParse = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Parseren er TOSPROGET. Interfacet er engelsk, saa engelsk er det primaere
     sprog - men de danske ord bliver ved med at virke, sa gammel vane og
     aeldre fangster ikke pludselig fejler. Det koster kun opslag i tabellerne.
     Se DESIGN.md §3. */

  const UGEDAGE = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
    mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7,
    mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6, lordag: 6, søndag: 7, sondag: 7,
    man: 1, tir: 2, ons: 3, tor: 4, fre: 5, lør: 6, lor: 6, søn: 7, son: 7,
  };

  const MAANEDER = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    januar: 1, februar: 2, marts: 3, maj: 5, juni: 6, juli: 7, oktober: 10,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12,
  };

  const TALORD = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1,
    en: 1, et: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10,
    elleve: 11, tolv: 12, anden: 2, andet: 2, tredje: 3, fjerde: 4, femte: 5,
  };

  /* ------------------------------------------------------------ datoer */

  // Datoer regnes i LOKAL tid og gemmes som YYYY-MM-DD. Aldrig som
  // UTC-tidsstempel - ellers driver "hver mandag kl. 8" hen over
  // sommertidsskiftet (DESIGN.md §4).
  function fmtDato(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dag = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dag}`;
  }

  function isoUgedag(d) {
    const n = d.getDay();
    return n === 0 ? 7 : n;
  }

  function plusDage(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function plusMaaneder(d, n) {
    const maal = new Date(d.getFullYear(), d.getMonth() + n, 1);
    // Klem dagen ned, saa 31. januar + 1 maaned bliver 28./29. februar
    // og ikke smutter over i marts.
    const sidste = new Date(maal.getFullYear(), maal.getMonth() + 1, 0).getDate();
    return new Date(maal.getFullYear(), maal.getMonth(), Math.min(d.getDate(), sidste));
  }

  function sidsteIMaaned(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function tal(ord) {
    if (/^\d+$/.test(ord)) return parseInt(ord, 10);
    return TALORD[ord] || null;
  }

  function findKlokkeslaet(tekst) {
    // "at 8", "at 8pm", "kl 8", "kl. 8.30", eller et bart "14:30".
    let m = tekst.match(/\b(?:at|kl\.?)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?\b/i);
    if (!m) m = tekst.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
    if (!m) return { tid: null, rest: tekst };
    let t = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const suffiks = (m[3] || '').toLowerCase();
    if (suffiks === 'pm' && t < 12) t += 12;
    if (suffiks === 'am' && t === 12) t = 0;
    if (t > 23 || min > 59) return { tid: null, rest: tekst };
    return {
      tid: `${String(t).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
      rest: (tekst.slice(0, m.index) + ' ' + tekst.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(),
    };
  }

  /**
   * Tolker en dansk datofrase. Returnerer {dato, tid} eller null.
   * Omfanget er bevidst lille - se DESIGN.md §3. Kan en frase ikke tolkes,
   * skal fangsten stadig lykkes; det er kaldsstedets ansvar.
   */
  function tolkDato(frase, nu) {
    const base = nu ? new Date(nu) : new Date();
    const iDag = new Date(base.getFullYear(), base.getMonth(), base.getDate());

    const k = findKlokkeslaet(String(frase || ''));
    const tid = k.tid;
    let t = k.rest.toLowerCase().trim().replace(/\.$/, '');
    if (!t) return tid ? { dato: fmtDato(iDag), tid } : null;

    const svar = (d) => ({ dato: fmtDato(d), tid });

    if (/^(today|i\s?dag)$/.test(t)) return svar(iDag);
    if (/^(tomorrow|tmr|i\s?morgen)$/.test(t)) return svar(plusDage(iDag, 1));
    if (/^(day\s+after\s+tomorrow|(i\s?)?overmorgen)$/.test(t)) return svar(plusDage(iDag, 2));
    if (/^(yesterday|i\s?går)$/.test(t)) return svar(plusDage(iDag, -1));

    if (/^next\s+week$|^næste\s+uge$/.test(t)) return svar(plusDage(iDag, 7));
    if (/^next\s+month$|^næste\s+måned$/.test(t)) return svar(plusMaaneder(iDag, 1));
    if (/^(end\s+of\s+(the\s+)?month|ultimo|sidste\s+dag\s+i)\s*(måneden|denne\s+måned)?$/.test(t)) {
      return svar(sidsteIMaaned(iDag));
    }
    if (/^(start\s+of\s+next\s+month|primo)\s*(måneden|næste\s+måned)?$/.test(t)) {
      const n = plusMaaneder(iDag, 1);
      return svar(new Date(n.getFullYear(), n.getMonth(), 1));
    }
    if (/^(the\s+)?weekend(en)?$/.test(t)) {
      const diff = (6 - isoUgedag(iDag) + 7) % 7;
      return svar(plusDage(iDag, diff === 0 ? 7 : diff));
    }

    // "in 3 days", "in two weeks", "om 3 dage", "om en måned"
    let m = t.match(/^(?:in|om)\s+(\S+)\s+(day|days|week|weeks|month|months|year|years|dag|dage|uge|uger|måned|måneder|år)$/);
    if (m) {
      const n = tal(m[1]);
      if (n === null) return null;
      if (/^(day|dag)/.test(m[2])) return svar(plusDage(iDag, n));
      if (/^(week|uge)/.test(m[2])) return svar(plusDage(iDag, n * 7));
      if (/^(month|måned)/.test(m[2])) return svar(plusMaaneder(iDag, n));
      return svar(plusMaaneder(iDag, n * 12));
    }

    // Ugedag. "monday" = naeste forekomst, i dag hvis i dag er mandag.
    // "next monday" = altid en uge senere end det. Reglen er et valg,
    // ikke en sandhed - den staar dokumenteret i DESIGN.md §3.
    m = t.match(/^(on\s+|this\s+|next\s+|på\s+|næste\s+|nu\s+på\s+)?([a-zæøå]+)$/);
    if (m && UGEDAGE[m[2]]) {
      const maal = UGEDAGE[m[2]];
      let diff = (maal - isoUgedag(iDag) + 7) % 7;
      if (/next|næste/.test(m[1] || '')) diff += 7;
      return svar(plusDage(iDag, diff));
    }

    // 3/9, 3/9-2027, 3/9/2027, 03.09.2027
    m = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
    if (m) {
      const dag = parseInt(m[1], 10);
      const maaned = parseInt(m[2], 10);
      if (dag < 1 || dag > 31 || maaned < 1 || maaned > 12) return null;
      let aar = m[3] ? parseInt(m[3], 10) : iDag.getFullYear();
      if (aar < 100) aar += 2000;
      const d = new Date(aar, maaned - 1, dag);
      if (d.getMonth() !== maaned - 1) return null; // fx 31/2
      // Uden aarstal: en dato der allerede er passeret, menes naeste aar.
      if (!m[3] && d < iDag) return svar(new Date(aar + 1, maaned - 1, dag));
      return svar(d);
    }

    // Maanedsnavn i begge ordstillinger: "3 sep" / "3. september" (dansk vane)
    // og "sep 3" / "december 24" (engelsk vane).
    let dag = null;
    let maanedsnavn = null;
    m = t.match(/^(\d{1,2})\.?\s+([a-zæøå]+)\.?(?:,?\s+(\d{4}))?$/);
    if (m) { dag = parseInt(m[1], 10); maanedsnavn = m[2]; }
    else {
      m = t.match(/^([a-zæøå]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\.?(?:,?\s+(\d{4}))?$/);
      if (m) { dag = parseInt(m[2], 10); maanedsnavn = m[1]; }
    }
    if (m && MAANEDER[maanedsnavn]) {
      const maaned = MAANEDER[maanedsnavn];
      const aar = m[3] ? parseInt(m[3], 10) : iDag.getFullYear();
      const d = new Date(aar, maaned - 1, dag);
      if (d.getMonth() !== maaned - 1) return null;
      if (!m[3] && d < iDag) return svar(new Date(aar + 1, maaned - 1, dag));
      return svar(d);
    }

    return null;
  }

  /* ------------------------------------------------------- gentagelser */

  // F1 genkender kun at der ER tale om en gentagelse, sa chippen kan sige det
  // aerligt. Selve grammatikken og motoren bygges i F4.
  function erGentagelse(frase) {
    return /^(every|hvert?)\s*!?\s*\S/i.test(String(frase || '').trim());
  }

  /* ------------------------------------------------------------ fangst */

  const MARKOERER = '#@!~';

  /**
   * Tolker en fangst-tekst til felter.
   *
   * @param {string} raa      teksten, fx "+ ring til lægen #telefon !i morgen"
   * @param {object} [opts]   {now: Date|number} til testbarhed
   * @returns {{kind, title, note, contexts, project, due, defer, recurrenceText, warnings}}
   */
  function tolkFangst(raa, opts) {
    opts = opts || {};
    const ud = {
      kind: 'task', title: '', note: '',
      contexts: [], project: null,
      due: null, defer: null,
      recurrenceText: null, warnings: [],
    };

    let tekst = String(raa == null ? '' : raa).replace(/\r\n/g, '\n');

    // Beskrivelse: alt efter foerste linjeskift, ellers efter foerste " // ".
    // Mellemrummene omkring // er vigtige - ellers spises "https://".
    const nl = tekst.indexOf('\n');
    if (nl >= 0) {
      ud.note = tekst.slice(nl + 1).trim();
      tekst = tekst.slice(0, nl);
    } else {
      const sep = tekst.indexOf(' // ');
      if (sep >= 0) {
        ud.note = tekst.slice(sep + 4).trim();
        tekst = tekst.slice(0, sep);
      }
    }

    // Type-praefiks.
    let m = tekst.match(/^\s*([+*])\s*/);
    if (m) {
      ud.kind = m[1] === '*' ? 'note' : 'task';
      tekst = tekst.slice(m[0].length);
    }

    // Find markoerer, der star ved start eller efter mellemrum. Guarden er
    // det, der redder "andreas@omlidt.dk" og "https://x.dk/#top" fra at blive
    // laest som projekt og kontekst.
    const fundne = [];
    const re = new RegExp(`(^|\\s)([${MARKOERER}])`, 'g');
    let fund;
    while ((fund = re.exec(tekst)) !== null) {
      fundne.push({ pos: fund.index + fund[1].length, tegn: fund[2] });
      re.lastIndex = fund.index + fund[0].length;
    }

    const spis = [];
    for (let i = 0; i < fundne.length; i++) {
      const her = fundne[i];
      const slut = i + 1 < fundne.length ? fundne[i + 1].pos : tekst.length;
      const raat = tekst.slice(her.pos + 1, slut);

      if (her.tegn === '#' || her.tegn === '@') {
        // Kontekst og projekt er ÉT ord, og det skal klaebe DIREKTE til
        // markoeren - medmindre projektet er sat i anfoerselstegn:
        // @"Sommerhus i Rørvig".
        //
        // Ingen trim her. "kurset i C # og F" er almindelig tekst, ikke
        // konteksten "og"; og trimmer man foerst og maaler laengden bagefter,
        // rammer fjernelsen ved siden af og spiser tegn ud af titlen.
        let vaerdi;
        let laengde;
        const citat = raat.match(/^"([^"]*)"/);
        if (citat) { vaerdi = citat[1].trim(); laengde = citat[0].length; }
        else {
          const ord = raat.match(/^[\p{L}\p{N}_-]+/u);
          vaerdi = ord ? ord[0] : '';
          laengde = vaerdi.length;
        }
        if (!vaerdi) continue;
        if (her.tegn === '#') { if (!ud.contexts.includes(vaerdi)) ud.contexts.push(vaerdi); }
        else ud.project = vaerdi;
        spis.push([her.pos, her.pos + 1 + laengde]);
        continue;
      }

      // ! og ~ tager hele frasen frem til naeste markoer, og der ma gerne
      // sta et mellemrum efter markoeren: bade "!i morgen" og "! i morgen".
      const vaerdi = raat.trim();
      if (!vaerdi) continue;
      if (her.tegn === '!') {
        if (erGentagelse(vaerdi)) {
          ud.recurrenceText = vaerdi;
          ud.warnings.push('gentagelse');
        } else {
          const d = tolkDato(vaerdi, opts.now);
          if (d) ud.due = d;
          else ud.warnings.push(`forstod ikke datoen "${vaerdi}"`);
        }
      } else {
        const d = tolkDato(vaerdi, opts.now);
        if (d) ud.defer = d.dato;
        else ud.warnings.push(`forstod ikke datoen "${vaerdi}"`);
      }
      spis.push([her.pos, slut]);
    }

    // Fjern de spiste stykker bagfra, sa indeksene holder.
    spis.sort((a, b) => b[0] - a[0]);
    for (const [fra, til] of spis) tekst = tekst.slice(0, fra) + tekst.slice(til);

    ud.title = tekst.replace(/\s+/g, ' ').trim();
    return ud;
  }

  return {
    tolkFangst,
    tolkDato,
    erGentagelse,
    fmtDato,
    isoUgedag,
    plusDage,
    plusMaaneder,
    sidsteIMaaned,
    UGEDAGE,
    MAANEDER,
  };
}));
