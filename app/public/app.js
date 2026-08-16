/* ---- shared/parse.js ---- */
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
    const t = String(frase || '').trim();
    return /^(every|hvert?)\s*!?\s*\S/i.test(t) || BARE_FORMER.test(t);
  }

  /**
   * Tolker en gentagelsesfrase til en regel.
   *
   * Syntaksen er Todoists (Andreas' valg): et `!` lige efter "every"/"hver"
   * betyder **fra fuldfoerelse** - naeste forekomst opstar foerst, nar den
   * forrige er markeret udfoert. Uden `!` er det en **fast plan**, der
   * forfalder pa sin dato, uanset om den forrige blev lavet.
   *
   * @returns regel-objekt eller null
   */
  // "last workday of the month" er en gentagelse i sig selv - den giver ingen
  // mening som engangsdato, og Todoist tillader den uden "every". Formerne
  // star ÉT sted, sa erGentagelse() og tolkGentagelse() ikke kan komme i utakt.
  const BARE_FORMER = /^(last|first|sidste|første|foerste)\s+(day|dag|workday|weekday|hverdag)\s+(of the|i)\s+(month|måneden|maaneden)$/i;

  function tolkGentagelse(frase, nu) {
    const raa = String(frase || '').trim();
    const m = raa.match(/^(every|hvert?)\s*(!?)\s*(.*)$/i);
    // Uden "every" accepteres kun de bare former - ellers ville "monday"
    // blive laest som en ugentlig gentagelse i stedet for en dato.
    if (!m && !BARE_FORMER.test(raa)) return null;

    const base = nu ? new Date(nu) : new Date();
    const iDag = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const mode = m && m[2] === '!' ? 'completion' : 'schedule';

    const k = findKlokkeslaet(m ? m[3] : raa);
    const tid = k.tid;
    let t = k.rest.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!t) return null;

    const regel = {
      mode, freq: null, interval: 1, weekdays: null, monthday: null,
      month: null, day: null, time: tid, text: raa, anchor: fmtDato(iDag),
    };

    // "other"/"anden" = hver anden. Ordenstal skrives ogsaa som "2." og "2nd".
    t = t.replace(/^(other|anden|andet)\s+/, '2 ');

    // "15th of the month" SKAL afgoeres foer intervallet trakkes ud - ellers
    // laeses tallet som "hver 15." noget, og dag-i-maaneden forsvinder.
    const dagIMaaned = t.match(/^(?:the\s+|den\s+)?(\d{1,2})[.]?(?:st|nd|rd|th)?\s+(?:of the month|i måneden|i maaneden)$/);
    if (dagIMaaned) {
      const dag = parseInt(dagIMaaned[1], 10);
      if (dag < 1 || dag > 31) return null;
      return Object.assign(regel, { freq: 'month', monthday: dag });
    }

    const antal = t.match(/^(\d+)[.]?(?:st|nd|rd|th)?\s+(.*)$/);
    if (antal) { regel.interval = Math.min(Math.max(parseInt(antal[1], 10), 1), 999); t = antal[2]; }

    // Maanedens sidste/foerste (hver)dag - staar uden "every" i praksis,
    // men vi tillader begge dele.
    if (/^(last|sidste) (workday|weekday|hverdag) (of the |i )?(month|måneden|maaneden)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: 'lastworkday' });
    }
    if (/^(first|første|foerste) (workday|weekday|hverdag) (of the |i )?(month|måneden|maaneden)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: 'firstworkday' });
    }
    if (/^(last|sidste) (day|dag) (of the |i )?(month|måneden|maaneden)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: 'last' });
    }

    // Ugedagsliste: "monday", "mon, thu", "mandag og torsdag"
    const stykker = t.split(/\s*(?:,|\band\b|\bog\b)\s*/).filter(Boolean);
    if (stykker.length && stykker.every((s) => UGEDAGE[s])) {
      const dage = [...new Set(stykker.map((s) => UGEDAGE[s]))].sort((a, b) => a - b);
      return Object.assign(regel, { freq: 'week', weekdays: dage });
    }
    if (/^(weekday|workday|hverdag)e?r?$/.test(t)) {
      return Object.assign(regel, { freq: 'week', weekdays: [1, 2, 3, 4, 5] });
    }
    if (/^(weekend|weekenden)$/.test(t)) {
      return Object.assign(regel, { freq: 'week', weekdays: [6, 7] });
    }

    // "month on the 3rd", "måned den 3.", "3rd of the month", "den 3. i måneden"
    let md = t.match(/^(?:month|måned|maaned)s?\s*(?:on the|den|d\.)\s*(\d{1,2})[.]?(?:st|nd|rd|th)?$/);
    if (!md) md = t.match(/^(?:the\s+|den\s+)?(\d{1,2})[.]?(?:st|nd|rd|th)?\s+(?:of the month|i måneden|i maaneden)$/);
    if (md) {
      const dag = parseInt(md[1], 10);
      if (dag < 1 || dag > 31) return null;
      return Object.assign(regel, { freq: 'month', monthday: dag });
    }

    // "year on 24/12", "år 24/12", "year on december 24"
    const aarlig = t.match(/^(?:year|år|aar)s?\s*(?:on|den|d\.)?\s*(.+)$/);
    if (aarlig) {
      // Foerst rent dag/maaned. tolkDato ville afvise "29/2" i et ikke-skudaar,
      // men for en AARLIG regel er aarstallet uden betydning.
      const dm = aarlig[1].trim().match(/^(\d{1,2})[/.](\d{1,2})$/);
      if (dm) {
        const dd = parseInt(dm[1], 10);
        const mm = parseInt(dm[2], 10);
        if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
        return Object.assign(regel, { freq: 'year', month: mm, day: dd });
      }
      const d = tolkDato(aarlig[1], iDag);
      if (!d) return null;
      const [, m2, d2] = d.dato.split('-').map(Number);
      return Object.assign(regel, { freq: 'year', month: m2, day: d2 });
    }

    if (/^(day|days|dag|dage)$/.test(t)) return Object.assign(regel, { freq: 'day' });
    if (/^(week|weeks|uge|uger)$/.test(t)) {
      // "hver 2. uge" uden ugedag: samme ugedag som i dag.
      return Object.assign(regel, { freq: 'week', weekdays: [isoUgedag(iDag)] });
    }
    if (/^(month|months|måned|måneder|maaned|maaneder)$/.test(t)) {
      return Object.assign(regel, { freq: 'month', monthday: iDag.getDate() });
    }
    if (/^(year|years|år|aar)$/.test(t)) {
      return Object.assign(regel, { freq: 'year', month: iDag.getMonth() + 1, day: iDag.getDate() });
    }

    return null;
  }

  /* ---------------------------------------------------------- motoren */

  function sidsteHverdag(aar, maaned0) {
    const d = new Date(aar, maaned0 + 1, 0);
    while (isoUgedag(d) > 5) d.setDate(d.getDate() - 1);
    return d;
  }

  function foersteHverdag(aar, maaned0) {
    const d = new Date(aar, maaned0, 1);
    while (isoUgedag(d) > 5) d.setDate(d.getDate() + 1);
    return d;
  }

  /** Mandagen i den uge, datoen ligger i. Bruges som fast maalepunkt. */
  function ugeStart(d) {
    return plusDage(d, -(isoUgedag(d) - 1));
  }

  /**
   * Naeste forekomst STRENGT efter `fra`.
   *
   * Al regning sker pa (ar, maned, dag) i lokal tid - aldrig pa
   * millisekunder. Det er dét, der gor, at "hver mandag kl. 8" ikke driver
   * en time hen over sommertidsskiftet (handover §5.6).
   */
  function naesteForekomst(regel, fra) {
    if (!regel || !regel.freq) return null;
    const [fy, fm, fd] = String(fra).split('-').map(Number);
    const efter = new Date(fy, fm - 1, fd);
    const interval = Math.max(regel.interval || 1, 1);

    if (regel.freq === 'day') return fmtDato(plusDage(efter, interval));

    if (regel.freq === 'week') {
      const dage = (regel.weekdays && regel.weekdays.length) ? regel.weekdays : [isoUgedag(efter)];
      const ankerUge = ugeStart(regel.anchor
        ? new Date(...regel.anchor.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))
        : efter);
      // Gennemloeb dag for dag. Loftet er interval uger + 7 dage, sa selv
      // "hver 52. uge" finder sit svar uden at kunne loebe loebsk.
      for (let i = 1; i <= interval * 7 + 7; i++) {
        const k = plusDage(efter, i);
        if (!dage.includes(isoUgedag(k))) continue;
        const uger = Math.round((ugeStart(k) - ankerUge) / (7 * 86400000));
        if (((uger % interval) + interval) % interval === 0) return fmtDato(k);
      }
      return null;
    }

    if (regel.freq === 'month') {
      // Start i INDEVAERENDE maaned: "hver maaned den 20." set fra den 13.
      // forfalder den 20. i denne maaned, ikke foerst i den naeste.
      for (let i = 0; i <= interval * 2 + 24; i++) {
        const p = new Date(efter.getFullYear(), efter.getMonth() + i, 1);
        // Kun hver interval'te maaned taeller.
        const maanederFra = (p.getFullYear() - efter.getFullYear()) * 12 + (p.getMonth() - efter.getMonth());
        if (maanederFra % interval !== 0) continue;
        let k;
        if (regel.monthday === 'last') k = new Date(p.getFullYear(), p.getMonth() + 1, 0);
        else if (regel.monthday === 'lastworkday') k = sidsteHverdag(p.getFullYear(), p.getMonth());
        else if (regel.monthday === 'firstworkday') k = foersteHverdag(p.getFullYear(), p.getMonth());
        else {
          const sidste = new Date(p.getFullYear(), p.getMonth() + 1, 0).getDate();
          // Den 31. i en maaned med 30 dage klemmes ned til den sidste -
          // aldrig ud i den naeste maaned.
          k = new Date(p.getFullYear(), p.getMonth(), Math.min(regel.monthday || 1, sidste));
        }
        if (k > efter) return fmtDato(k);
      }
      return null;
    }

    if (regel.freq === 'year') {
      for (let i = 0; i <= interval + 1; i++) {
        const aar = efter.getFullYear() + i;
        if ((aar - efter.getFullYear()) % interval !== 0) continue;
        const sidste = new Date(aar, regel.month, 0).getDate();
        const k = new Date(aar, regel.month - 1, Math.min(regel.day, sidste));
        if (k > efter) return fmtDato(k);
      }
      return null;
    }
    return null;
  }

  /** 1st, 2nd, 3rd, 4th … 11th-13th er undtagelserne. Interfacet er engelsk. */
  function ordenstal(n) {
    const r10 = n % 10;
    const r100 = n % 100;
    if (r10 === 1 && r100 !== 11) return `${n}st`;
    if (r10 === 2 && r100 !== 12) return `${n}nd`;
    if (r10 === 3 && r100 !== 13) return `${n}rd`;
    return `${n}th`;
  }

  /** Menneskelig beskrivelse af en regel - den, brugeren ser i chippen. */
  function beskrivGentagelse(regel) {
    if (!regel || !regel.freq) return '';
    const NAVNE = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const n = regel.interval > 1 ? `every ${regel.interval} ` : 'every ';
    let s;
    if (regel.freq === 'day') s = `${n}${regel.interval > 1 ? 'days' : 'day'}`;
    else if (regel.freq === 'week') {
      const d = (regel.weekdays || []).map((x) => NAVNE[x]);
      const alle = (regel.weekdays || []).join(',');
      if (alle === '1,2,3,4,5') s = 'every weekday';
      else if (alle === '6,7') s = 'every weekend';
      else s = `${n}${regel.interval > 1 ? 'weeks on ' : ''}${d.join(' and ')}`;
    } else if (regel.freq === 'month') {
      if (regel.monthday === 'last') s = `${n}${regel.interval > 1 ? 'months, ' : ''}last day of the month`;
      else if (regel.monthday === 'lastworkday') s = `${n}${regel.interval > 1 ? 'months, ' : ''}last workday of the month`;
      else if (regel.monthday === 'firstworkday') s = `${n}${regel.interval > 1 ? 'months, ' : ''}first workday of the month`;
      else s = `${n}${regel.interval > 1 ? 'months ' : 'month '}on the ${ordenstal(regel.monthday)}`;
    } else {
      s = `${n}${regel.interval > 1 ? 'years ' : 'year '}on ${regel.day}/${regel.month}`;
    }
    if (regel.time) s += ` at ${regel.time}`;
    return s + (regel.mode === 'completion' ? ' · from completion' : ' · fixed schedule');
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
    tolkGentagelse,
    naesteForekomst,
    beskrivGentagelse,
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

/* ---- p1_core.js ---- */
'use strict';
/* doda - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK (Andreas' oenske - aeoea er besvaerligt at taste),
   men koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 1;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen pa en iPad, hvor CSS'en tror den er
   overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'doda', needsSetup: false, secureContext: false },
  view: 'next',
  contexts: [],
  projects: [],
  areas: [],
  openProject: null,
  counts: {},
  today: '',
  filterContext: null,
  items: [],
  indlaeser: false,
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgas pa IP:port
// over http, hvor alt der opretter id'er ellers doer stille (RUNE-ERFARINGER §4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Gor URL'er og [tekst](url) klikbare.
 *
 * Teksten escapes FOERST, sa alt indhold er ufarligt, og der matches derefter
 * kun pa http(s). Det er med vilje: javascript: og data: ma aldrig kunne slippe
 * igennem fra en import, et API-kald eller en MCP-klient (DESIGN.md §3).
 */
function linkify(tekst) {
  let ud = esc(tekst);
  ud = ud.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
  ud = ud.replace(/(^|[\s(])(https?:\/\/[^\s<]{1,500})/g, (helt, foer, url) => {
    // Slutpunktum og lukkeparentes hoerer til saetningen, ikke til adressen.
    const hale = url.match(/[.,;:!?)]+$/);
    const ren = hale ? url.slice(0, -hale[0].length) : url;
    const vis = ren.replace(/^https?:\/\//, '').slice(0, 60);
    return `${foer}<a href="${ren}" target="_blank" rel="noopener noreferrer">${vis}</a>${hale ? hale[0] : ''}`;
  });
  return ud;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Saet headers EFTER en evt. merge - en shallow merge har foer slettet
    // Authorization, fordi hele header-objektet blev erstattet
    // (RUNE-ERFARINGER, Kokkeri v15).
    opts.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  // API'et svarer {error: kode, message: laesbar tekst}. Mennesket skal se
  // beskeden; koden er til klienter.
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error });
  }
  return data;
}

function toast(besked, handling) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(besked)}</span>`;
  if (handling) {
    const knap = document.createElement('button');
    knap.className = 'toast-action';
    knap.textContent = handling.label;
    knap.addEventListener('click', () => { el.remove(); handling.run(); });
    el.appendChild(knap);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), handling ? 8000 : 3200);
}

/* --------------------------------------------------------------- tema */

function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('doda_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('doda_theme') || 'auto'; } catch { return 'auto'; }
}

/* -------------------------------------------------------------- ikoner */

const ICONS = {
  logo: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
  next: '<circle cx="12" cy="12" r="9"/><path d="M9.5 12h6M13 9.5l2.5 2.5-2.5 2.5"/>',
  inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4.5 13L6.8 5.6A1.5 1.5 0 018.2 4.5h7.6a1.5 1.5 0 011.4 1.1L19.5 13v4.5a2 2 0 01-2 2h-11a2 2 0 01-2-2z"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  someday: '<path d="M4 8.5h16v9.5a2 2 0 01-2 2H6a2 2 0 01-2-2z"/><path d="M4 8.5l1.4-3A1.5 1.5 0 016.8 4.5h10.4a1.5 1.5 0 011.4 1l1.4 3"/><path d="M10 12.5h4"/>',
  projects: '<path d="M6.5 20L12 4l5.5 16"/>',
  contexts: '<path d="M5 9.5h14M5 14.5h14M10.5 4.5L8.5 19.5M15.5 4.5l-2 15"/>',
  repeat: '<path d="M4.5 11a7.5 7.5 0 0112.6-5.4L20 8.5"/><path d="M20 4.5v4h-4"/><path d="M19.5 13a7.5 7.5 0 01-12.6 5.4L4 15.5"/><path d="M4 19.5v-4h4"/>',
  log: '<path d="M5 5.5A1.5 1.5 0 016.5 4H18v16H6.5A1.5 1.5 0 015 18.5z"/><path d="M9 9h6M9 13h4"/>',
  review: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10h15M9 4.5v3M15 4.5v3"/><path d="M9 14l2 2 3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6L6 18M18 18l-1.4-1.4M7.4 7.4L6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  calm: '<path d="M3 15c3 0 3-3 6-3s3 3 6 3 3-3 6-3"/><circle cx="12" cy="7" r="2.5"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  note: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M14 4.5V9h5"/><path d="M9 13h7M9 16h4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------- sider */

// Raekkefoelgen her er ogsaa sidebarens. Handover §6.
const VIEWS = [
  { id: 'next', label: 'Next Actions', icon: 'next', group: 1 },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', group: 1, tael: 'inbox' },
  { id: 'waiting', label: 'Waiting For', icon: 'waiting', group: 2, fase: 'F8' },
  { id: 'someday', label: 'Someday', icon: 'someday', group: 2, fase: 'F8' },
  { id: 'repeat', label: 'Recurring', icon: 'repeat', group: 2 },
  { id: 'projects', label: 'Projects', icon: 'projects', group: 3 },
  { id: 'contexts', label: 'Contexts', icon: 'contexts', group: 3 },
  { id: 'log', label: 'Logbook', icon: 'log', group: 4, fase: 'F8' },
  { id: 'review', label: 'Review', icon: 'review', group: 4, fase: 'F8' },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 5 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

const BESKRIVELSER = {
  next: 'What you can actually do right now, grouped by context.',
  inbox: 'Unprocessed items waiting for clarification.',
  waiting: 'Delegated — you are waiting on someone else.',
  someday: 'Parked without commitment.',
  repeat: 'Your recurring tasks, and when each one is next due.',
  projects: 'Anything that takes more than one step, grouped by area.',
  contexts: 'Where and how a task can be done.',
  log: 'What you have finished, in chronological order.',
  review: 'The weekly review, step by step.',
  settings: 'Appearance, account and access.',
};

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister kommandobaren fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnSide();
}

function gateHtml() {
  const setup = state.config.needsSetup;
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} doda</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Pick a username and a password, and you are in.' : 'Sign in to continue.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Username</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${setup ? 'Create account' : 'Sign in'}</button>
      </form>
      ${setup ? '<p class="gate-note">doda is a single-user app. Once this account exists, sign-up closes for good.</p>' : ''}
    </div>
  </div>`;
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    try {
      const data = await api('POST', state.config.needsSetup ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
      });
      state.user = data.user;
      state.config.needsSetup = false;
      await hentState();
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  document.getElementById('gateUser').focus();
}

function navHtml() {
  const grupper = [...new Set(VIEWS.map((v) => v.group))];
  return grupper.map((g) => `<nav class="nav">${VIEWS.filter((v) => v.group === g).map((v) => {
    const antal = v.tael ? (state.counts[v.tael] || 0) : 0;
    return `<button class="nav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon)}<span>${esc(v.label)}</span>
        ${antal ? `<span class="nav-count">${antal}</span>` : ''}
      </button>`;
  }).join('')}</nav>`).join('');
}

function shellHtml() {
  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} doda</div>
      <div id="navHost">${navHtml()}</div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn">${icon('settings')}<span>${esc(state.user.username)}</span></button>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="offline-mark meta" id="offlineMark" hidden></div>
        <div class="stats meta" id="statsHost">${statsHtml()}</div>
        <div class="omni">
          <span class="omni-icon">${icon('search', 20)}</span>
          <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
            placeholder="Search, capture, or jump to a project…">
          <div class="omni-panel" id="omniPanel" hidden></div>
        </div>
        <div class="omni-chips" id="omniChips"></div>
      </div>
      <div id="pageHost"></div>
    </main>
  </div>
  <div class="hint"><span class="key">A</span><span class="meta">type to capture</span></div>`;
}

function statsHtml() {
  const c = state.counts;
  const dele = [];
  if (c.inbox) dele.push(`${c.inbox} captured`);
  if (c.next) dele.push(`${c.next} next`);
  dele.push(`${state.projects.length} projects`);
  if (c.done) dele.push(`${c.done} done`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

function opdaterNav() {
  const host = document.getElementById('navHost');
  if (host) { host.innerHTML = navHtml(); bindNav(); }
  const stats = document.getElementById('statsHost');
  if (stats) stats.innerHTML = statsHtml();
}

function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
}

function bindShell() {
  bindNav();
  document.getElementById('userBtn').addEventListener('click', () => gaaTil('settings'));
  document.getElementById('navToggle').addEventListener('click', () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('navopen'));
  bindOmni();
}

function gaaTil(view, opt) {
  const skifter = state.view !== view;
  state.view = view;
  if (skifter) { state.filterContext = null; state.openProject = null; }
  if (opt && opt.context !== undefined) state.filterContext = opt.context;
  document.body.classList.remove('navopen');
  opdaterNav();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter) window.scrollTo(0, 0);
}

/** Henter state og gentegner NAV og SIDE, men aldrig hele skallen. */
async function genindlaes() {
  await hentState();
  opdaterNav();
  await tegnSide();
}

async function hentState() {
  try {
    const d = await api('GET', '/api/v1/state');
    state.contexts = d.contexts;
    state.projects = d.projects;
    state.areas = d.areas || [];
    state.counts = d.counts;
    state.today = d.today;
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* --------------------------------------------------------------- start */

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'doda';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    if (state.user) await hentState();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} doda</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  registrerSW();
  lytPaaForbindelse();
})();

/* ---- p2_omni.js ---- */
'use strict';
/* doda - kommandobaren. Ét felt der bade soeger og opretter.
   Oprettelse star altid oeverst og kan altid nas med Enter: soegning ma
   aldrig komme i vejen for fangst (handover §5.1). */

const omniState = {
  tolket: null,
  resultater: [],
  valgt: 0,
  raekker: [],
  bekraeft: null,   // {contexts:[], project} - ukendte navne der skal godkendes
  soegeTimer: null,
  soegeToken: 0,
};

function omniEl() { return document.getElementById('omni'); }

/* Tolkningen sker LOKALT med den samme parser, serveren bruger. Ingen
   netvaerkskald pr. tastetryk - chipsene skal foelge fingrene. */
function tolkNu(tekst) {
  const p = (typeof dodaParse !== 'undefined') ? dodaParse : null;
  if (!p) return null;
  return p.tolkFangst(tekst);
}

function ukendteNavne(tolket) {
  if (!tolket) return { contexts: [], project: null };
  const kendteK = new Set(state.contexts.map((c) => c.name.toLowerCase()));
  const kendteP = new Set(state.projects.map((p) => p.name.toLowerCase()));
  return {
    contexts: tolket.contexts.filter((n) => !kendteK.has(n.toLowerCase())),
    project: tolket.project && !kendteP.has(tolket.project.toLowerCase()) ? tolket.project : null,
  };
}

/* ------------------------------------------------------------- chips */

function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = omniState.tolket;
  const raa = omniEl() ? omniEl().value.trim() : '';
  if (!raa || !t) { host.innerHTML = ''; return; }

  const chips = [];
  chips.push([t.kind === 'note' ? 'Note' : 'Task', 'accent']);
  for (const c of t.contexts) chips.push([`#${c}`, 'accent']);
  if (t.project) chips.push([`@${t.project}`, 'accent']);
  if (t.due) chips.push([`⏰ ${visDato(t.due.dato)}${t.due.tid ? ` ${t.due.tid}` : ''}`, 'accent']);
  if (t.defer) chips.push([`hidden until ${visDato(t.defer)}`, 'neutral']);
  if (t.note) chips.push(['+ description', 'neutral']);

  // Gentagelsen skal staa SKREVET UD. Forskellen mellem "fast plan" og "fra
  // fuldfoerelse" er ét udrabstegn i teksten - chippen er det eneste sted,
  // valget bliver tydeligt for brugeren (DESIGN.md §3, handover §5.6).
  if (t.recurrenceText) {
    const g = (typeof dodaParse !== 'undefined') ? dodaParse.tolkGentagelse(t.recurrenceText) : null;
    chips.push(g ? [`↻ ${dodaParse.beskrivGentagelse(g)}`, 'accent']
      : [`↻ didn't understand "${t.recurrenceText}"`, 'neutral']);
  }

  for (const w of t.warnings) {
    if (w !== 'gentagelse') chips.push([w.replace('forstod ikke datoen', "didn't understand the date"), 'neutral']);
  }

  host.innerHTML = chips.map(([tekst, slags]) =>
    `<span class="chip${slags === 'neutral' ? ' neutral' : ''}">${esc(tekst)}</span>`).join('');
}

function visDato(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dato = new Date(y, m - 1, d);
  const iDag = new Date(state.today ? `${state.today}T00:00:00` : Date.now());
  const dage = Math.round((dato - new Date(iDag.getFullYear(), iDag.getMonth(), iDag.getDate())) / 86400000);
  if (dage === 0) return 'today';
  if (dage === 1) return 'tomorrow';
  if (dage === -1) return 'yesterday';
  if (dage > 1 && dage < 7) return dato.toLocaleDateString('en-GB', { weekday: 'long' });
  return dato.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------ panelet */

function byggRaekker() {
  const raa = omniEl().value.trim();
  const raekker = [];
  if (!raa) return raekker;

  if (omniState.bekraeft) {
    const b = omniState.bekraeft;
    const nye = [...b.contexts.map((n) => `#${n}`), ...(b.project ? [`@${b.project}`] : [])];
    raekker.push({
      type: 'confirm',
      titel: `Create ${nye.join(' and ')}?`,
      under: 'Press Enter again to create them along with the task.',
    });
  } else {
    const t = omniState.tolket;
    raekker.push({
      type: 'create',
      titel: t && t.title ? t.title : raa,
      under: t && t.kind === 'note' ? 'New note' : 'New task in Inbox',
      ikon: t && t.kind === 'note' ? 'note' : 'plus',
    });
  }

  for (const item of omniState.resultater) raekker.push({ type: 'item', item });
  return raekker;
}

function tegnPanel() {
  const panel = document.getElementById('omniPanel');
  if (!panel) return;
  omniState.raekker = byggRaekker();
  if (!omniState.raekker.length) { panel.hidden = true; panel.innerHTML = ''; return; }
  if (omniState.valgt >= omniState.raekker.length) omniState.valgt = 0;

  panel.innerHTML = omniState.raekker.map((r, i) => {
    const valgt = i === omniState.valgt ? ' aria-selected="true"' : '';
    if (r.type === 'item') {
      const it = r.item;
      const faerdig = it.status === 'done' || it.status === 'dropped';
      return `<button class="omni-row${faerdig ? ' dim' : ''}"${valgt} data-i="${i}">
        ${icon(it.kind === 'note' ? 'note' : 'next')}
        <span class="omni-row-main"><span class="omni-row-title">${esc(it.title)}</span>
        <span class="omni-row-sub">${esc(statusNavn(it.status))}${it.contexts.length ? ` · ${it.contexts.map((c) => `#${c.name}`).join(' ')}` : ''}</span></span>
      </button>`;
    }
    return `<button class="omni-row${r.type === 'confirm' ? ' confirm' : ''}"${valgt} data-i="${i}">
      ${icon(r.ikon || 'plus')}
      <span class="omni-row-main"><span class="omni-row-title">${esc(r.titel)}</span>
      <span class="omni-row-sub">${esc(r.under)}</span></span>
    </button>`;
  }).join('');
  panel.hidden = false;

  panel.querySelectorAll('.omni-row').forEach((el) => {
    el.addEventListener('mouseenter', () => { omniState.valgt = Number(el.dataset.i); markerValgt(); });
    el.addEventListener('click', () => { omniState.valgt = Number(el.dataset.i); aktiver(); });
  });
}

function markerValgt() {
  document.querySelectorAll('#omniPanel .omni-row').forEach((el, i) => {
    if (i === omniState.valgt) el.setAttribute('aria-selected', 'true');
    else el.removeAttribute('aria-selected');
  });
}

const STATUS_NAVNE = {
  inbox: 'Inbox', next: 'Next', queued: 'Queued', waiting: 'Waiting for',
  someday: 'Someday', done: 'Done', dropped: 'Dropped',
};
const statusNavn = (s) => STATUS_NAVNE[s] || s;

/* ------------------------------------------------------------ soegning */

function planlaegSoegning() {
  clearTimeout(omniState.soegeTimer);
  const q = omniEl().value.trim();
  if (q.length < 2 || q.startsWith('*') || q.startsWith('+')) {
    omniState.resultater = [];
    tegnPanel();
    return;
  }
  omniState.soegeTimer = setTimeout(async () => {
    const token = ++omniState.soegeToken;
    try {
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
      // Et aeldre svar ma aldrig overskrive et nyere - ellers blinker
      // resultaterne tilbage til noget, brugeren er holdt op med at skrive.
      if (token !== omniState.soegeToken) return;
      omniState.resultater = d.items;
      tegnPanel();
    } catch { /* soegning ma aldrig staa i vejen for fangst */ }
  }, 140);
}

/* ------------------------------------------------------------ handling */

async function aktiver() {
  const raekke = omniState.raekker[omniState.valgt];
  if (!raekke) return;

  if (raekke.type === 'item') {
    aabnElement(raekke.item);
    luk();
    return;
  }
  await fangstNu(raekke.type === 'confirm');
}

async function fangstNu(bekraeftet) {
  const tekst = omniEl().value.trim();
  if (!tekst) return;

  // Kendes alle navne i forvejen, er der intet at bekraefte - saa skal ét
  // Enter vaere nok. Det er hele pointen med "fangst pa ét trin".
  const ukendte = ukendteNavne(omniState.tolket);
  const skalSpoerge = !bekraeftet && (ukendte.contexts.length > 0 || ukendte.project);

  try {
    const svar = await api('POST', '/api/v1/capture', { text: tekst, createNew: !skalSpoerge });
    if (svar.needsConfirm) {
      omniState.bekraeft = svar.needsConfirm;
      omniState.valgt = 0;
      tegnPanel();
      return;
    }
    const it = svar.item;
    luk();
    await genindlaes();
    toast(it.kind === 'note' ? 'Note saved' : `Added to ${statusNavn(it.status)}`, {
      label: 'Undo',
      run: async () => {
        await api('DELETE', `/api/v1/items/${it.id}`, {});
        await genindlaes();
      },
    });
  } catch (ex) {
    // Netvaerksbrud: gem lokalt og send, naar der er forbindelse igen.
    // Et rigtigt afslag fra serveren skal derimod vises som det er.
    if (erNetvaerksfejl(ex)) {
      laegIKoe(tekst);
      luk();
      toast('Saved offline — it will be sent when you are back');
      return;
    }
    toast(ex.message);
  }
}

function luk() {
  const el = omniEl();
  if (el) { el.value = ''; el.blur(); }
  omniState.tolket = null;
  omniState.resultater = [];
  omniState.bekraeft = null;
  omniState.valgt = 0;
  tegnChips();
  tegnPanel();
}

function opdaterOmni() {
  const el = omniEl();
  omniState.tolket = tolkNu(el.value);
  // En aendring i teksten gor en tidligere bekraeftelse ugyldig.
  omniState.bekraeft = null;
  tegnChips();
  tegnPanel();
  planlaegSoegning();
}

function bindOmni() {
  const el = omniEl();
  if (!el) return;
  el.addEventListener('input', opdaterOmni);
  el.addEventListener('focus', () => { if (el.value.trim()) tegnPanel(); });
  el.addEventListener('blur', () => {
    // Lille forsinkelse, sa et klik pa en raekke nar at blive registreret.
    setTimeout(() => { const p = document.getElementById('omniPanel'); if (p) p.hidden = true; }, 150);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!omniState.raekker.length) return;
      e.preventDefault();
      const n = omniState.raekker.length;
      omniState.valgt = (omniState.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); aktiver(); }
  });
}

/* Signaturen: begynd bare at skrive, sa aabner kommandobaren.
   Undtagelserne er vigtigere end reglen - uden dem stjaeler den tastetryk
   fra ethvert felt i appen. */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  // Star fokus i en liste med tastaturafklaring, ejer LISTEN bogstaverne
  // (n = next, w = waiting, x = delete). preventDefault i raekkens egen
  // handler stopper ikke boblingen hertil - det skal dette tjek.
  if (el && el.closest && el.closest('[data-keynav]')) return;

  const omni = omniEl();
  if (!omni) return;

  if (e.key === '/') { e.preventDefault(); omni.focus(); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();
  omni.focus();
  omni.value += e.key;
  opdaterOmni();
});

/* ---- p3_lists.js ---- */
'use strict';
/* doda - listerne: Next Actions, Inbox, elementraekken og detaljeruden. */

const sideState = { fokusId: null };

/* --------------------------------------------------------- optegning */

async function tegnSide() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const view = viewById(state.view);

  if (view.id === 'settings') { host.innerHTML = sideSettings(); bindSettings(); return; }
  if (view.id === 'contexts') { host.innerHTML = sideContexts(); bindContexts(); return; }
  if (view.id === 'repeat') { await sideRepeat(); return; }
  if (view.id === 'projects') {
    if (state.openProject) { await sideProjekt(state.openProject); return; }
    host.innerHTML = await sideProjects();
    document.getElementById('newProject').addEventListener('click', () => redigerProjekt(null));
    document.getElementById('manageAreas').addEventListener('click', administrerOmraader);
    document.querySelectorAll('.item-row[data-project]').forEach((el) => {
      el.addEventListener('click', () => gaaTilProjekt(el.dataset.project));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') gaaTilProjekt(el.dataset.project); });
    });
    return;
  }
  if (view.fase) { host.innerHTML = sidePlaceholder(view); return; }

  host.innerHTML = `<section class="page"><div class="page-head">
      <h1>${esc(view.label)}</h1><p class="lead">${esc(BESKRIVELSER[view.id])}</p>
    </div><div class="skeleton">Loading…</div></section>`;

  try {
    if (view.id === 'inbox') {
      const d = await api('GET', '/api/v1/items?status=inbox');
      state.items = d.items;
      host.innerHTML = sideInbox();
    } else {
      const q = state.filterContext ? `&context=${encodeURIComponent(state.filterContext)}` : '';
      const d = await api('GET', `/api/v1/items?status=next&hideDeferred=1${q}`);
      state.items = d.items;
      host.innerHTML = sideNext();
    }
    bindListe();
  } catch (ex) {
    if (ex.status === 401) { state.user = null; render(); return; }
    host.innerHTML = `<section class="page"><div class="empty"><p>${esc(ex.message)}</p></div></section>`;
  }
}

function sidePlaceholder(view) {
  return `<section class="page">
    <div class="page-head"><h1>${esc(view.label)}</h1>
      <p class="lead">${esc(BESKRIVELSER[view.id] || '')}</p></div>
    <div class="empty">${icon('calm', 34)}
      <p class="empty-title">Coming in ${esc(view.fase)}</p>
      <p>The shell is ready. This screen gets built in that phase.</p></div>
  </section>`;
}

/* ------------------------------------------------------------ Inbox */

function sideInbox() {
  const items = state.items;
  return `<section class="page">
    <div class="page-head"><h1>Inbox</h1><p class="lead">${esc(BESKRIVELSER.inbox)}</p></div>
    ${items.length ? `
      <p class="meta" style="margin-bottom:12px">${items.length} item${items.length === 1 ? '' : 's'} · oldest first</p>
      <div class="list" data-keynav>${items.map((it, i) => elementRaekke(it, i)).join('')}</div>
      <p class="hintline meta">↑↓ move · enter open · space done · n next · w waiting · s someday · x delete</p>
    ` : tomInbox()}
  </section>`;
}

/* Tom inbox skal foeles som en beloenning, ikke som en tom kasse
   (handover §5.2). Ingen tal, ingen farve, ingen opfordring. */
function tomInbox() {
  return `<div class="empty">${icon('calm', 34)}
    <p class="empty-title">Inbox is empty</p>
    <p>Nothing is waiting on you. Type anywhere to capture the next thing.</p></div>`;
}

/* ----------------------------------------------------- Next Actions */

function sideNext() {
  const items = state.items;
  const filtre = state.contexts.map((c) => `
    <button class="pill${state.filterContext === c.id ? ' on' : ''}" data-ctx="${esc(c.id)}">#${esc(c.name)}</button>`).join('');

  if (!items.length) {
    return `<section class="page">
      <div class="page-head"><h1>Next Actions</h1><p class="lead">${esc(BESKRIVELSER.next)}</p></div>
      ${state.contexts.length ? `<div class="pills">
        <button class="pill${state.filterContext ? '' : ' on'}" data-ctx="">All</button>${filtre}</div>` : ''}
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">${state.filterContext ? 'Nothing here right now' : 'Nothing to do right now'}</p>
        <p>${state.filterContext ? 'No next actions in this context.' : 'Clarify something from your inbox, or capture something new.'}</p></div>
    </section>`;
  }

  // Grupperet efter kontekst. Et element uden kontekst horer under "No context"
  // - det skal ikke forsvinde, bare fordi det mangler et felt.
  const grupper = new Map();
  for (const it of items) {
    const noegler = it.contexts.length ? it.contexts.map((c) => c.name) : ['No context'];
    for (const n of noegler) {
      if (!grupper.has(n)) grupper.set(n, []);
      grupper.get(n).push(it);
    }
  }
  const sorteret = [...grupper.entries()].sort((a, b) => {
    if (a[0] === 'No context') return 1;
    if (b[0] === 'No context') return -1;
    return a[0].localeCompare(b[0]);
  });

  let n = 0;
  return `<section class="page">
    <div class="page-head"><h1>Next Actions</h1><p class="lead">${esc(BESKRIVELSER.next)}</p></div>
    ${state.contexts.length ? `<div class="pills">
      <button class="pill${state.filterContext ? '' : ' on'}" data-ctx="">All</button>${filtre}</div>` : ''}
    <div data-keynav>
      ${sorteret.map(([navn, liste]) => `
        <h2 class="group meta">${esc(navn)} <span class="group-count">${liste.length}</span></h2>
        <div class="list">${liste.map((it) => elementRaekke(it, n++)).join('')}</div>`).join('')}
    </div>
    <p class="hintline meta">↑↓ move · enter open · space done</p>
  </section>`;
}

/* -------------------------------------------------------- elementet */

function elementRaekke(it, i) {
  const projekt = it.project_id ? state.projects.find((p) => p.id === it.project_id) : null;
  const meta = [];
  if (projekt) meta.push(esc(projekt.name));
  if (it.due_date) meta.push(`${visDato(it.due_date)}${it.due_time ? ` ${it.due_time}` : ''}`);
  if (it.contexts.length) meta.push(it.contexts.map((c) => `#${esc(c.name)}`).join(' '));

  return `<div class="item-row" tabindex="0" data-id="${esc(it.id)}" data-i="${i}">
    <button class="tick${it.status === 'done' ? ' on' : ''}" data-done="${esc(it.id)}"
      aria-label="Mark done" title="Mark done"></button>
    <div class="item-main">
      <div class="item-title">${linkify(it.title)}</div>
      ${meta.length ? `<div class="item-meta meta">${meta.join(' · ')}</div>` : ''}
    </div>
    ${it.note ? `<span class="item-flag" title="Has a description">${icon('note', 15)}</span>` : ''}
    ${it.attachment_count ? `<span class="item-flag" title="${it.attachment_count} attachment(s)">${icon('link', 15)}</span>` : ''}
  </div>`;
}

/* ------------------------------------------------------- haendelser */

function bindListe() {
  document.querySelectorAll('.pill[data-ctx]').forEach((el) => {
    el.addEventListener('click', () => gaaTil('next', { context: el.dataset.ctx || null }));
  });

  document.querySelectorAll('.tick[data-done]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); fuldfoer(el.dataset.done); });
  });

  document.querySelectorAll('.item-row').forEach((el) => {
    el.addEventListener('click', () => {
      const it = state.items.find((x) => x.id === el.dataset.id);
      if (it) aabnElement(it);
    });
    el.addEventListener('keydown', raekkeTaster);
  });

  // Behold fokus efter en gentegning, sa tastaturafklaringen ikke starter
  // forfra ved hvert element.
  if (sideState.fokusId) {
    const el = document.querySelector(`.item-row[data-id="${CSS.escape(sideState.fokusId)}"]`);
    if (el) el.focus();
    else {
      const foerste = document.querySelector('.item-row');
      if (foerste) foerste.focus();
    }
    sideState.fokusId = null;
  }
}

function naboRaekke(el, retning) {
  const alle = [...document.querySelectorAll('.item-row')];
  const i = alle.indexOf(el);
  return alle[i + retning] || alle[retning > 0 ? 0 : alle.length - 1];
}

async function raekkeTaster(e) {
  const el = e.currentTarget;
  const id = el.dataset.id;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); naboRaekke(el, 1).focus(); return; }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); naboRaekke(el, -1).focus(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const it = state.items.find((x) => x.id === id);
    if (it) aabnElement(it);
    return;
  }

  // Naeste element far fokus, FOER raekken forsvinder ud af listen.
  const naeste = naboRaekke(el, 1);
  const husk = () => { sideState.fokusId = naeste && naeste.dataset.id !== id ? naeste.dataset.id : null; };

  if (e.key === ' ') { e.preventDefault(); husk(); await fuldfoer(id); return; }
  const statusTaster = { n: 'next', w: 'waiting', s: 'someday', q: 'queued' };
  if (statusTaster[e.key]) {
    e.preventDefault();
    husk();
    await saetStatus(id, statusTaster[e.key]);
    return;
  }
  if (e.key === 'x') {
    e.preventDefault();
    husk();
    await slet(id);
  }
}

async function fuldfoer(id) {
  const it = state.items.find((x) => x.id === id);
  try {
    await api('POST', `/api/v1/items/${id}/complete`, {});
    await genindlaes();
    toast(`Done: ${it ? it.title : 'item'}`, {
      label: 'Undo',
      run: async () => { await api('POST', `/api/v1/items/${id}/uncomplete`, {}); await genindlaes(); },
    });
  } catch (ex) { toast(ex.message); }
}

async function saetStatus(id, status) {
  try {
    await api('POST', `/api/v1/items/${id}`, { status });
    await genindlaes();
    toast(`Moved to ${statusNavn(status)}`);
  } catch (ex) { toast(ex.message); }
}

async function slet(id) {
  try {
    await api('DELETE', `/api/v1/items/${id}`, {});
    await genindlaes();
    toast('Deleted');
  } catch (ex) { toast(ex.message); }
}

/* ------------------------------------------------------ detaljeruden */

async function aabnElement(listeItem) {
  // Listen baerer KUN et antal vedhaeftninger, aldrig metadataene - det er
  // hele pointen med §4-lektien. Ruden skal derfor hente det fulde element,
  // ellers star filerne der ikke.
  let it = listeItem;
  if (listeItem.attachment_count && !listeItem.attachments) {
    try { it = (await api('GET', `/api/v1/items/${listeItem.id}`)).item; }
    catch { it = Object.assign({ attachments: [] }, listeItem); }
  } else if (!it.attachments) {
    it = Object.assign({ attachments: [] }, listeItem);
  }
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Edit item">
    <label class="field"><span>Title</span>
      <input class="input" id="edTitle" value="${esc(it.title)}"></label>

    <label class="field"><span>Description</span>
      <textarea class="input" id="edNote" rows="5"
        placeholder="Notes, links, anything. Markdown links work: [text](https://…)">${esc(it.note)}</textarea></label>
    <div id="edPreview" class="note-preview"${it.note ? '' : ' hidden'}></div>

    <div class="row2">
      <label class="field"><span>Status</span>
        <select class="input" id="edStatus">
          ${['inbox', 'next', 'queued', 'waiting', 'someday', 'done', 'dropped'].map((s) =>
    `<option value="${s}"${s === it.status ? ' selected' : ''}>${esc(statusNavn(s))}</option>`).join('')}
        </select></label>
      <label class="field"><span>Project</span>
        <select class="input" id="edProject">
          <option value="">— none —</option>
          ${state.projects.map((p) =>
    `<option value="${esc(p.id)}"${p.id === it.project_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
    </div>

    <div class="row2">
      <label class="field"><span>Due date</span>
        <input class="input" id="edDue" type="date" value="${esc(it.due_date || '')}"></label>
      <label class="field"><span>Hidden until</span>
        <input class="input" id="edDefer" type="date" value="${esc(it.defer_date || '')}"></label>
    </div>

    <div class="field"><span>Contexts</span>
      <div class="ctxpick">${state.contexts.length ? state.contexts.map((c) => `
        <label class="ctxopt"><input type="checkbox" value="${esc(c.id)}"
          ${it.contexts.some((x) => x.id === c.id) ? 'checked' : ''}>#${esc(c.name)}</label>`).join('')
    : '<span class="lead">No contexts yet — add one by typing #name when you capture.</span>'}</div>
    </div>

    ${vedhaeftningerHtml(it)}

    <div class="modal-foot">
      <button class="btn ghost" id="edDelete">Delete</button>
      <button class="btn ghost" id="edConvert">${it.kind === 'note' ? 'Make it a task' : 'Make it a note'}</button>
      <span style="flex:1"></span>
      <button class="btn" id="edCancel">Cancel</button>
      <button class="btn primary" id="edSave">Save</button>
    </div>
  </div>`;

  document.body.appendChild(host);
  const luk = () => { host.remove(); document.removeEventListener('keydown', esctast); };
  const esctast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', esctast);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const noteEl = host.querySelector('#edNote');
  const preview = host.querySelector('#edPreview');
  const tegnPreview = () => {
    const v = noteEl.value.trim();
    preview.hidden = !v;
    preview.innerHTML = v ? markdown(v) : '';
  };
  noteEl.addEventListener('input', tegnPreview);
  tegnPreview();

  host.querySelector('#edCancel').addEventListener('click', luk);

  host.querySelector('#edSave').addEventListener('click', async () => {
    // Hoerer elementet til en gentagelse, skal brugeren tage stilling:
    // gaelder aendringen kun denne gang, eller alle fremtidige? (handover §5.6)
    let tilSerien = false;
    if (it.recurrence_id) {
      const svar = await spoergOmSerie(it.title);
      if (svar === null) return;          // lukket uden at vaelge
      tilSerien = svar;
    }
    try {
      await api('POST', `/api/v1/items/${it.id}`, {
        applyToSeries: tilSerien,
        title: host.querySelector('#edTitle').value,
        note: noteEl.value,
        status: host.querySelector('#edStatus').value,
        project_id: host.querySelector('#edProject').value || null,
        due_date: host.querySelector('#edDue').value || null,
        defer_date: host.querySelector('#edDefer').value || null,
        contexts: [...host.querySelectorAll('.ctxpick input:checked')].map((x) => x.value),
      });
      luk();
      await genindlaes();
      toast('Saved');
    } catch (ex) { toast(ex.message); }
  });

  host.querySelector('#edDelete').addEventListener('click', async () => {
    luk();
    await slet(it.id);
  });

  // Konvertering ma ALDRIG miste indhold: bade titel og beskrivelse foelger
  // med begge veje (handover §5.5). En note er reference og skal derfor ud af
  // handlingslisterne - den far status "queued", ikke "inbox".
  host.querySelector('#edConvert').addEventListener('click', async () => {
    const tilNote = it.kind !== 'note';
    try {
      await api('POST', `/api/v1/items/${it.id}`, {
        title: host.querySelector('#edTitle').value,
        note: noteEl.value,
        kind: tilNote ? 'note' : 'task',
        status: tilNote ? 'queued' : (it.status === 'queued' ? 'inbox' : it.status),
      });
      luk();
      await genindlaes();
      toast(tilNote ? 'Converted to a note' : 'Converted to a task');
    } catch (ex) { toast(ex.message); }
  });

  // Efter upload eller sletning gentegnes KUN fillisten - brugerens ugemte
  // rettelser i titel og beskrivelse skal ikke gaa tabt. Navngivet funktion,
  // ikke arguments.callee: filen er strict mode.
  const genhentFiler = async () => {
    const frisk = (await api('GET', `/api/v1/items/${it.id}`)).item;
    it.attachments = frisk.attachments || [];
    host.querySelector('#fileList').innerHTML = it.attachments.map(filKort).join('');
    bindVedhaeftninger(host, it, genhentFiler);
    await genindlaes();
  };
  bindVedhaeftninger(host, it, genhentFiler);

  host.querySelector('#edTitle').focus();
}

/* ------------------------------------------------------ indstillinger */

function sideSettings() {
  const tema = nuvaerendeTema();
  const valg = [['auto', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']];
  return `<section class="page">
    <div class="page-head"><h1>Settings</h1><p class="lead">${esc(BESKRIVELSER.settings)}</p></div>

    <div class="card"><h2>Theme</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${valg.map(([v, l]) => `<button class="btn ${tema === v ? 'primary' : ''}" data-tema="${v}">${l}</button>`).join('')}
      </div></div>

    <div class="card"><h2>Capture syntax</h2>
      <table class="syntax">
        <tr><td><code>+ text</code></td><td>task (also the default)</td></tr>
        <tr><td><code>* text</code></td><td>note</td></tr>
        <tr><td><code>#context</code></td><td>add a context</td></tr>
        <tr><td><code>@project</code></td><td>file under a project — <code>@"two words"</code></td></tr>
        <tr><td><code>!date</code></td><td><code>!tomorrow</code>, <code>!friday</code>, <code>!3/9</code>, <code>!in 2 weeks</code></td></tr>
        <tr><td><code>~date</code></td><td>hide until that date</td></tr>
        <tr><td><code>text // more</code></td><td>everything after <code>//</code> becomes the description</td></tr>
      </table>
      <p class="gate-note" style="text-align:left">Danish words work too: <code>!i morgen</code>, <code>!om 2 uger</code>.</p>
    </div>

    <div class="card"><h2>Access keys</h2>
      <p class="lead" style="margin:6px 0 0">For iOS Shortcuts, Siri and anything else
      that talks to doda from outside. One key per device or purpose, so you can revoke
      a single one without touching the rest.</p>
      <div id="keyList" class="keylist">Loading…</div>
      <form id="keyForm" class="keyform">
        <input class="input" id="keyName" placeholder="What is it for? e.g. iPhone Shortcut" maxlength="60" required>
        <select class="input" id="keyScope">
          <option value="capture">Capture only — can add, cannot read</option>
          <option value="read">Read only</option>
          <option value="full">Full access</option>
        </select>
        <button class="btn primary" type="submit">Create key</button>
      </form>
      <p class="gate-note" style="text-align:left">A lost phone should not be able to
      read your whole system — prefer <strong>capture only</strong> unless you need more.</p>
    </div>

    <div class="card"><h2>Change password</h2>
      <p class="gate-error" id="pwMsg" hidden></p>
      <form id="pwForm" style="margin-top:12px">
        <label class="field"><span>Current password</span>
          <input class="input" id="pwCur" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>New password (at least 8 characters)</span>
          <input class="input" id="pwNew" type="password" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Change password</button>
      </form>
      <p class="gate-note" style="text-align:left">Every other session is signed out when the password changes.</p>
    </div>

    <div class="card"><h2>Account</h2>
      <p class="lead" style="margin:6px 0 14px">Signed in as <strong>${esc(state.user.username)}</strong>.</p>
      <button class="btn" id="logoutBtn">Sign out</button></div>

    <div class="card"><h2>About</h2>
      <p class="lead" style="margin-top:6px">doda version ${APP_VERSION}.
      ${state.config.secureContext ? 'Secure connection (https).' : 'Plain http — passkeys and notifications are unavailable here.'}</p></div>
  </section>`;
}

/* ------------------------------------------------------ adgangsnoegler */

const SCOPE_TEKST = {
  capture: 'capture only', read: 'read only', full: 'full access',
};

async function tegnNoegler() {
  const host = document.getElementById('keyList');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/tokens');
    if (!d.tokens.length) {
      host.innerHTML = '<p class="lead" style="margin:14px 0 0">No keys yet.</p>';
      return;
    }
    host.innerHTML = d.tokens.map((t) => `
      <div class="keyrow">
        <div class="keyrow-main">
          <div class="keyrow-name">${esc(t.name)}</div>
          <div class="meta">doda_${esc(t.prefix)}… · ${esc(SCOPE_TEKST[t.scope] || t.scope)} ·
            ${t.last_used_at ? `last used ${visTid(t.last_used_at)}` : 'never used'}</div>
        </div>
        <button class="btn ghost" data-revoke="${esc(t.id)}">Revoke</button>
      </div>`).join('');
    host.querySelectorAll('[data-revoke]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('DELETE', `/api/v1/tokens/${el.dataset.revoke}`, {});
        toast('Key revoked — it stopped working immediately');
        tegnNoegler();
      });
    });
  } catch (ex) { host.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }
}

function visTid(unix) {
  const d = new Date(unix * 1000);
  const timer = (Date.now() / 1000 - unix) / 3600;
  if (timer < 1) return 'just now';
  if (timer < 24) return `${Math.floor(timer)}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* Noeglen vises ÉN gang. Den findes ikke i klartekst nogen steder bagefter -
   heller ikke i databasen (handover §5.10). */
function visNyNoegle(noegle, navn) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true">
    <h2>Key created: ${esc(navn)}</h2>
    <p class="lead" style="margin:6px 0 16px">Copy it now — this is the only time it is
    ever shown. Only a hash of it is stored, so it cannot be recovered.</p>
    <div class="keyshow" id="keyValue">${esc(noegle)}</div>
    <div class="modal-foot">
      <span style="flex:1"></span>
      <button class="btn" id="keyCopy">Copy</button>
      <button class="btn primary" id="keyDone">Done</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  host.querySelector('#keyDone').addEventListener('click', () => host.remove());
  host.querySelector('#keyCopy').addEventListener('click', async () => {
    try {
      // navigator.clipboard kraever secure context - panelets IP:port er http.
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(noegle);
      else {
        const r = document.createRange();
        r.selectNodeContents(host.querySelector('#keyValue'));
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.execCommand('copy');
      }
      toast('Copied');
    } catch { toast('Could not copy — select the text manually'); }
  });
}

function bindNoegler() {
  const form = document.getElementById('keyForm');
  if (!form) return;
  tegnNoegler();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const d = await api('POST', '/api/v1/tokens', {
        name: document.getElementById('keyName').value,
        scope: document.getElementById('keyScope').value,
      });
      form.reset();
      visNyNoegle(d.key, d.name);
      tegnNoegler();
    } catch (ex) { toast(ex.message); }
  });
}

function bindSettings() {
  bindNoegler();
  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); tegnSide(); });
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('POST', '/api/logout', {});
    state.user = null;
    render();
  });

  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pwMsg');
    msg.hidden = true;
    try {
      await api('POST', '/api/password', {
        current: document.getElementById('pwCur').value,
        next: document.getElementById('pwNew').value,
      });
      toast('Password changed');
      document.getElementById('pwForm').reset();
    } catch (ex) { msg.textContent = ex.message; msg.hidden = false; }
  });
}

/* ---- p4_projects.js ---- */
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

/* ---- p5_repeat.js ---- */
'use strict';
/* doda - skaermen "Recurring".
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
        <p class="empty-title">Nothing recurs yet</p>
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
    <h1>Recurring</h1>
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

    <label class="field"><span>Recurrence rule</span>
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
      <button class="btn ghost" id="rDelete">Stop recurring</button>
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
    await efter('Stopped recurring — the open one is now a normal task');
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
      <p class="lead" style="margin:6px 0 20px">“${esc(titel)}” is recurring.
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

/* ---- p6_offline.js ---- */
'use strict';
/* doda - service worker, offline-tilstand og fangst-koe.
 *
 * Fangst skal virke offline (handover §5.1). Koen ligger i appen, ikke i
 * service workeren: en SW, der gemte POST'er, ville sende dem i tilfaeldig
 * raekkefolge og uden at kunne fortaelle brugeren, hvad der skete. */

const OUTBOX_NOEGLE = 'doda_outbox';

/* ------------------------------------------------------- service worker */

async function registrerSW() {
  // Service workers kraever secure context. Panelet tilgas pa IP:port over
  // http - dér skal appen bare virke uden, ikke fejle (RUNE-ERFARINGER §4).
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  if (state.config.dev) {
    // Under udvikling ville en SW servere gammel kode i det uendelige.
    const alle = await navigator.serviceWorker.getRegistrations();
    for (const r of alle) await r.unregister();
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch {
    /* Uden SW mister vi kun offline-laesning - appen virker uaendret. */
  }
}

/* ----------------------------------------------------------- fangst-koe */

function laesOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_NOEGLE) || '[]'); } catch { return []; }
}

function skrivOutbox(koe) {
  try { localStorage.setItem(OUTBOX_NOEGLE, JSON.stringify(koe.slice(0, 500))); } catch { /* fuldt lager */ }
}

function laegIKoe(tekst) {
  const koe = laesOutbox();
  koe.push({ id: nyId(), text: tekst, ts: Date.now() });
  skrivOutbox(koe);
  opdaterOfflineMaerke();
}

/** En fejl UDEN status er et netvaerksbrud; med status er det et rigtigt svar. */
function erNetvaerksfejl(ex) {
  return !ex || !ex.status;
}

/**
 * Sender koen. Kaldes ved opstart, naar nettet kommer tilbage, og efter en
 * vellykket fangst.
 *
 * Én ad gangen og i raekkefoelge: to fangster, der blev skrevet i en bestemt
 * orden, skal lande i samme orden. Fejler en pa netvaerket, stopper vi og
 * proever igen senere - resten bliver staaende.
 */
let sender = false;

async function tomOutbox() {
  if (sender || !navigator.onLine) return;
  let koe = laesOutbox();
  if (!koe.length) return;
  sender = true;
  let sendt = 0;
  try {
    while (koe.length) {
      const post = koe[0];
      try {
        await api('POST', '/api/v1/capture', { text: post.text, createNew: true });
        sendt++;
      } catch (ex) {
        if (erNetvaerksfejl(ex)) break;
        // Et rigtigt afslag (fx tom tekst) ma ikke blokere koen for evigt.
        toast(`Could not send “${post.text.slice(0, 30)}…”: ${ex.message}`);
      }
      koe = laesOutbox().slice(1);
      skrivOutbox(koe);
    }
  } finally {
    sender = false;
  }
  opdaterOfflineMaerke();
  if (sendt) {
    toast(`Sent ${sendt} thing${sendt === 1 ? '' : 's'} captured offline`);
    await genindlaes();
  }
}

/* --------------------------------------------------------- offline-mærke */

function opdaterOfflineMaerke() {
  const host = document.getElementById('offlineMark');
  if (!host) return;
  const koe = laesOutbox().length;
  const offline = !navigator.onLine;
  host.hidden = !offline && !koe;
  if (host.hidden) return;
  host.innerHTML = offline
    ? `${icon('calm', 14)}<span>Offline${koe ? ` · ${koe} waiting to send` : ' · showing what was last loaded'}</span>`
    : `${icon('calm', 14)}<span>${koe} waiting to send</span>`;
}

function lytPaaForbindelse() {
  window.addEventListener('online', () => { opdaterOfflineMaerke(); tomOutbox(); });
  window.addEventListener('offline', opdaterOfflineMaerke);
  opdaterOfflineMaerke();
  tomOutbox();
}

/* ---- p7_files.js ---- */
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
