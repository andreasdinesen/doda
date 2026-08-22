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

  // BADE @ og / peger pa et projekt. Paletten laerer brugeren "/ projects" i
  // legenden, og saa skal / ogsaa virke midt i en saetning - ellers lover
  // interfacet noget, parseren ikke holder.
  //
  // Det er ufarligt, fordi en markoer SKAL have mellemrum eller start foran
  // sig: "https://dr.dk/nyheder", "3/9" og "and/or" har alle et tegn foer
  // skraastregen og roeres derfor ikke.
  const MARKOERER = '#@!~/';

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
    // det, der redder "navn@eksempel.dk" og "https://x.dk/#top" fra at blive
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

      if (her.tegn === '#' || her.tegn === '@' || her.tegn === '/') {
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
        else ud.project = vaerdi;      // bade @ og /
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

  /**
   * Fjerner PRAECIS én markoer med en kendt vaerdi fra en tekst.
   *
   * Bruges naar en titel, der ALLEREDE findes, redigeres: dér ma kun det,
   * der faktisk kunne tolkes, forsvinde. tolkFangst spiser fx `!vigtigt` og
   * noejes med en advarsel - fint i paletten, hvor chippen ses med det samme,
   * men tavst datatab i en titel, man retter.
   *
   * @param {string} tegn  Ét eller flere markoer-tegn, fx '#' eller '@/'.
   */
  function fjernMarkoer(tekst, tegn, vaerdi) {
    if (!tekst || !vaerdi) return tekst;
    const undslip = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Vaerdier med mellemrum staar i anfoerselstegn: /"Sommerhus i Rørvig".
    const v = `(?:"${undslip(vaerdi)}"|${undslip(vaerdi)})`;
    // Samme regel som i tolkFangst: en markoer skal have linjestart eller et
    // mellemrum foran sig, ellers er navn@eksempel.dk et projekt.
    const re = new RegExp(`(^|\\s)[${undslip(tegn)}]${v}(?=\\s|$)`, 'i');
    return tekst.replace(re, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  return {
    tolkFangst,
    fjernMarkoer,
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

/* ---- shared/todoist.js ---- */
/* doda - laeser Todoists CSV-eksport.
 *
 * Todoist eksporterer ét projekt pr. fil ("Projektnavn.csv") med kolonnerne
 * TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, AUTHOR, RESPONSIBLE, DATE, …
 *
 * VIGTIGST: begreberne er BYTTET OM mellem de to apps.
 *   Todoist  @label   = en maerkat        -> doda  #kontekst
 *   Todoist  #projekt = et projekt        -> doda  @projekt
 * Oversaettes det ikke, ender alle maerkater som projekter og omvendt.
 *
 * Filen er UMD-pakket som resten af app/shared/ - saa kan bade serveren og
 * browseren bruge den, og der findes kun ÉN forstaaelse af formatet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.dodaTodoist = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** RFC 4180-agtig CSV: felter i anfoerselstegn kan indeholde komma og linjeskift. */
  function parseCsv(tekst) {
    const raekker = [];
    let felt = '';
    let raekke = [];
    let iCitat = false;
    const s = String(tekst || '').replace(/^﻿/, '');   // BOM fra Excel

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (iCitat) {
        if (c === '"') {
          if (s[i + 1] === '"') { felt += '"'; i++; }        // "" = et rigtigt "
          else iCitat = false;
        } else felt += c;
        continue;
      }
      if (c === '"') { iCitat = true; continue; }
      if (c === ',') { raekke.push(felt); felt = ''; continue; }
      if (c === '\r') continue;
      if (c === '\n') { raekke.push(felt); raekker.push(raekke); raekke = []; felt = ''; continue; }
      felt += c;
    }
    if (felt || raekke.length) { raekke.push(felt); raekker.push(raekke); }
    return raekker.filter((r) => r.some((f) => f !== ''));
  }

  /**
   * Oversaetter én Todoist-CSV til doda-elementer.
   *
   * @param {string} csv      filens indhold
   * @param {string} filnavn  bruges som projektnavn ("Arbejde.csv" -> "Arbejde")
   * @returns {{project, items, skipped, warnings}}
   */
  function laesProjekt(csv, filnavn) {
    const raekker = parseCsv(csv);
    if (!raekker.length) return { project: null, items: [], skipped: 0, warnings: ['The file was empty.'] };

    const head = raekker[0].map((h) => h.trim().toUpperCase());
    const i = (navn) => head.indexOf(navn);
    if (i('TYPE') < 0 || i('CONTENT') < 0) {
      return { project: null, items: [], skipped: 0, warnings: ['This does not look like a Todoist CSV export.'] };
    }

    const projekt = String(filnavn || 'Todoist').replace(/\.csv$/i, '').trim() || 'Todoist';
    const ud = { project: projekt, items: [], skipped: 0, warnings: [] };
    let fladlagt = 0;

    for (const r of raekker.slice(1)) {
      const type = (r[i('TYPE')] || '').trim().toLowerCase();
      let indhold = (r[i('CONTENT')] || '').trim();
      if (!indhold) { ud.skipped++; continue; }

      // Sektionsoverskrifter og tomme skillelinjer er layout, ikke opgaver.
      if (type === 'section' || (!type && !indhold)) { ud.skipped++; continue; }

      const erNote = type === 'note';
      const beskrivelse = i('DESCRIPTION') >= 0 ? (r[i('DESCRIPTION')] || '').trim() : '';
      const dato = i('DATE') >= 0 ? (r[i('DATE')] || '').trim() : '';
      const indent = i('INDENT') >= 0 ? Number(r[i('INDENT')] || 1) : 1;
      if (indent > 1) fladlagt++;

      // Todoists markdown-links [tekst](url) er de samme som dodas - de
      // faar lov at staa. Men maerkaterne skal byttes om.
      const maerkater = [];
      indhold = indhold.replace(/(^|\s)@([\p{L}\p{N}_-]+)/gu, (helt, foer, navn) => {
        maerkater.push(navn);
        return foer;
      }).replace(/\s{2,}/g, ' ').trim();

      // Et "#" i Todoist peger pa et projekt - men projektet kender vi
      // allerede fra filnavnet, sa referencen fjernes hellere end at blive
      // til en forkert kontekst.
      indhold = indhold.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1').replace(/\s{2,}/g, ' ').trim();
      if (!indhold) { ud.skipped++; continue; }

      ud.items.push({
        kind: erNote ? 'note' : 'task',
        title: indhold.slice(0, 500),
        note: beskrivelse.slice(0, 20000),
        contexts: maerkater,
        project: projekt,
        date: dato,
      });
    }

    if (fladlagt) {
      ud.warnings.push(`${fladlagt} subtask${fladlagt === 1 ? '' : 's'} flattened — doda has projects, not subtasks.`);
    }
    return ud;
  }

  /**
   * Bygger den fangst-linje, dodas egen parser forstaar.
   *
   * Dermed gaar Todoist-data gennem PRAECIS samme vej som alt andet: datoer,
   * gentagelser og kontekster tolkes af én parser, ikke to.
   */
  function somFangst(item) {
    const dele = [];
    if (item.kind === 'note') dele.push('*');
    dele.push(item.title);
    for (const c of item.contexts) dele.push(`#${c}`);
    if (item.project) dele.push(`@"${item.project.replace(/"/g, '')}"`);
    // Todoists "every day" og "17 Aug" laeses af dodas datotolkning som den er.
    if (item.date) dele.push(`!${item.date}`);
    let linje = dele.join(' ');
    if (item.note) linje += ` // ${item.note.replace(/\n/g, ' ')}`;
    return linje;
  }

  return { parseCsv, laesProjekt, somFangst };
}));

/* ---- p1_core.js ---- */
'use strict';
/* doda - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK (Andreas' oenske - aeoea er besvaerligt at taste),
   men koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 46;

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
  logProject: null,
  review: null,
  counts: {},
  today: '',
  filterContext: null,
  items: [],
  indlaeser: false,
  // Noter kan slaas fra (Settings). Bruger man Notion til reference, er
  // dodas noter ét sted for meget. Standard er TIL - en ny installation skal
  // ikke mangle noget, fordi ingen har taget stilling.
  notesEnabled: true,
  noteCount: 0,
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

/*
 * Brugernavnet VIST med stort begyndelsesbogstav.
 *
 * Selve navnet roeres ikke: det er det, man logger ind med, og det er noeglen
 * i databasen. Derfor maa denne funktion KUN bruges, hvor der tegnes - aldrig
 * hvor der sendes eller sammenlignes. Kun foerste bogstav, ikke hvert ord:
 * et brugernavn er ét ord, og `capitalize` ville lave "anna-lise" om til
 * noget, ejeren ikke selv har skrevet.
 */
const visNavn = (n) => String(n == null ? '' : n).replace(/^./, (c) => c.toUpperCase());

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
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Browserens egen tekst er ubrugelig for et menneske: Safari siger
    // "Load failed", Chrome "Failed to fetch". Femten steder i appen viser
    // ex.message direkte i en toast, saa oversaettelsen hoerer hjemme HER -
    // ét sted - og ikke i hvert kaldssted.
    //
    // Ingen `status`: erNetvaerksfejl() skelner netop paa den, og
    // fangst-koen skal stadig kunne se, at det var nettet og ikke et afslag.
    throw Object.assign(new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
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

/* Det tema, man rent faktisk SER. "Follow system" er ikke en tredje farve -
   den er lys eller moerk, afhaengigt af maskinen, og knappen i sidebaren skal
   vise vejen til den modsatte af det, oejet ser. */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1"/>',
  guide: '<path d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v12a2 2 0 00-2-2H4z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v12a2 2 0 012-2h6z"/>',
  // Egen pil - IKKE repeat-ikonet, som i denne app betyder "gentagelse".
  sync: '<path d="M19.5 12a7.5 7.5 0 01-12.9 5.3"/><path d="M4.5 12a7.5 7.5 0 0112.9-5.3"/><path d="M17.5 3v4h-4"/><path d="M6.5 21v-4h4"/>',
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
  { id: 'waiting', label: 'Waiting For', icon: 'waiting', group: 2 },
  { id: 'someday', label: 'Someday', icon: 'someday', group: 2 },
  { id: 'repeat', label: 'Recurring', icon: 'repeat', group: 2 },
  { id: 'projects', label: 'Projects', icon: 'projects', group: 3 },
  { id: 'contexts', label: 'Contexts', icon: 'contexts', group: 3 },
  // Noter er reference, ikke arbejde - derfor her ved siden af projekter og
  // kontekster, og ikke oppe blandt handlingslisterne.
  { id: 'notes', label: 'Notes', icon: 'note', group: 3 },
  { id: 'log', label: 'Logbook', icon: 'log', group: 4 },
  { id: 'review', label: 'Review', icon: 'review', group: 4 },
  // group: 0 = staar IKKE i navigationen. Settings naas fra menuen paa
  // brugerknappen, hvor kontoen i forvejen bor - to indgange til det samme
  // sted er én for meget.
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
  // Guiden naas samme sted som Settings: menuen paa brugerknappen.
  { id: 'guide', label: 'Guide', icon: 'guide', group: 0 },
  // Fokusskaermen naas fra Focus-knappen paa en opgave. Den hoerer ikke i
  // navigationen: uden en opgave i fokus er der ingenting at gaa ind til.
  { id: 'focus', label: 'Focus', icon: 'clock', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

// Handover §6: "Pa mobil: de fire-fem vigtigste i bunden, resten i en menu."
// Fangst er ikke med her - den naas fra alle skaerme ved bare at skrive,
// og har sin egen knap i baandet.
const BUND = ['next', 'inbox', 'projects', 'repeat', 'review'];

const BESKRIVELSER = {
  next: 'What you can actually do right now, grouped by context.',
  inbox: 'Unprocessed items waiting for clarification.',
  waiting: 'Delegated — you are waiting on someone else.',
  someday: 'Parked without commitment.',
  repeat: 'Your recurring tasks, and when each one is next due.',
  projects: 'Anything that takes more than one step, grouped by area.',
  contexts: 'Where and how a task can be done.',
  notes: 'Everything you keep for reference. Never work you owe anyone.',
  log: 'What you have finished, in chronological order.',
  review: 'The weekly review, step by step.',
  settings: 'Appearance, account and access.',
  guide: 'How doda works — the whole thing, in the order you meet it.',
};

/*
 * Fangst-syntaksen staar bade i Settings og i guiden. Ét sted, ellers driver
 * de fra hinanden - og en legende, der lover mindre end parseren kan, betyder
 * at funktionen i praksis ikke findes (RUNE-ERFARINGER, doda v9).
 *
 * Raekkerne skal matche app/shared/parse.js: + og * er praefikser, # @ / ! ~
 * er markoerer, og " // " skiller beskrivelsen fra.
 */
function syntaksTabel() {
  return `<table class="syntax">
    <tr><td><code>+ text</code></td><td>task (also the default)</td></tr>
    <tr><td><code>* text</code></td><td>note</td></tr>
    <tr><td><code>#context</code></td><td>add a context</td></tr>
    <tr><td><code>@project</code> · <code>/project</code></td><td>file under a project — <code>/"two words"</code></td></tr>
    <tr><td><code>!date</code></td><td><code>!tomorrow</code>, <code>!friday</code>, <code>!3/9</code>, <code>!in 2 weeks</code></td></tr>
    <tr><td><code>~date</code></td><td>hide until that date</td></tr>
    <tr><td><code>text // more</code></td><td>everything after <code>//</code> becomes the description</td></tr>
  </table>`;
}

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister kommandobaren fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnGennemgangsbaand();
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
      ${!setup && state.config.passkeys && state.config.hasPasskeys ? `
        <div class="gate-or"><span>or</span></div>
        <button class="btn" id="gatePasskey" style="width:100%">Sign in with a passkey</button>` : ''}
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
      if (fortsaetTilConnector()) return;
      await hentState();
      render();
      // Kommer man fra kalenderen uden at vaere logget ind, skal elementet
      // aabnes NAAR man er - ikke tabes undervejs.
      aabnFraAdressen();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  const pk = document.getElementById('gatePasskey');
  if (pk) {
    pk.addEventListener('click', async () => {
      const err = document.getElementById('gateError');
      err.hidden = true;
      try {
        const d = await loginMedPasskey();
        state.user = d.user;
        if (fortsaetTilConnector()) return;
        await hentState();
        render();
        aabnFraAdressen();
      } catch (ex) {
        // Brugeren afbroed selv - det er ikke en fejl, der skal vises.
        if (ex.name === 'NotAllowedError') return;
        err.textContent = ex.message || 'The passkey did not work';
        err.hidden = false;
      }
    });
  }

  document.getElementById('gateUser').focus();
}

function navHtml() {
  // Slaaet fra betyder: ingen vej IND. Det, der allerede findes, forsvinder
  // ikke - noterne staar stadig paa deres projekt og kan soeges frem.
  const iNav = VIEWS.filter((v) => v.group > 0 && (v.id !== 'notes' || state.notesEnabled));
  const grupper = [...new Set(iNav.map((v) => v.group))];
  return grupper.map((g) => `<nav class="nav">${iNav.filter((v) => v.group === g).map((v) => {
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
      <div class="brand">${icon('logo', 24)} <span style="flex:1">doda</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn"
          ${state.view === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(visNavn(state.user.username))}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}${temaKnapHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="offline-mark meta" id="offlineMark" hidden></div>
        <div class="toprow">
          <button class="syncbtn meta" id="syncBtn" title="Sync now" aria-label="Sync now">
            ${icon('sync', 14)}<span id="syncLabel">just now</span></button>
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
        </div>
        <div class="omni-card" id="omniCard">
          <div class="omni-field">
            <span class="omni-icon">${icon('search', 22)}</span>
            <span class="omni-mode" id="omniMode" hidden></span>
            <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
              placeholder="Just type to Capture, Navigate and Find">
          </div>
          <div class="omni-panel" id="omniPanel" hidden></div>
          <div class="omni-legend meta" id="omniLegend"></div>
        </div>
        <div class="omni-chips" id="omniChips"></div>
      </div>
      <div id="reviewNudge"></div>
      <div id="pageHost"></div>
    </main>
  </div>
  <nav class="toc" id="tocRail" aria-label="On this page" hidden></nav>
  <div class="hint"><span class="key">A</span><span class="meta">type to capture</span></div>
  <nav class="bottomnav" id="bottomNav">
    ${BUND.map((id) => {
    const v = viewById(id);
    const antal = v.tael ? (state.counts[v.tael] || 0) : 0;
    return `<button class="bottomnav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 21)}<span>${esc(v.label.split(' ')[0])}</span>
        ${antal ? `<span class="bottomnav-count">${antal}</span>` : ''}
      </button>`;
  }).join('')}
    <button class="bottomnav-item" id="bottomCapture" aria-label="Capture">
      ${icon('plus', 21)}<span>Capture</span></button>
  </nav>`;
}

/*
 * Versionen, altid synlig. Det er SAMME tal som runens version: i panelet -
 * build_rune.py stempler APP_VERSION i index.html, sw.js og runen pa én gang.
 *
 * Serveren melder sit eget tal med i /api/public-config. Er de to forskellige,
 * er app.js i browserens cache aeldre end den, serveren udleverer, og sa er
 * det dét, brugeren skal vide - ikke versionsnummeret alene.
 */
function versionHtml() {
  const server = state.config.version;
  const gammel = server && server !== APP_VERSION;
  if (gammel) {
    return `<button class="version-line meta version-old" id="versionBtn"
      title="Your browser is running v${APP_VERSION}, but the server has v${server}. Click to reload.">
      v${APP_VERSION} · v${server} available — reload</button>`;
  }
  return `<div class="version-line meta">v${esc(String(APP_VERSION))}</div>`;
}

/* Ét klik mellem lyst og moerkt, uden at gaa i Settings. Knappen viser det
   tema, man skifter TIL - ikke det, man er i. Alle tre valg (inklusive
   "Follow system") bliver staaende under Settings. */
function temaKnapHtml() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return `<button class="temabtn" id="temaBtn" data-naeste="${naeste}"
    aria-label="Switch to ${naeste} theme" title="Switch to ${naeste} theme">
    ${icon(naeste === 'dark' ? 'moon' : 'sun', 16)}</button>`;
}

/* Temaet kan skiftes to steder (her og i Settings), og knappen skal foelge
   med begge veje - ellers viser den vej til det tema, man allerede er i. */
function opdaterTemaKnap() {
  const gammel = document.getElementById('temaBtn');
  if (!gammel) return;
  gammel.outerHTML = temaKnapHtml();
  bindTemaKnap();
}

function bindTemaKnap() {
  const el = document.getElementById('temaBtn');
  if (!el) return;
  el.addEventListener('click', () => {
    anvendTema(el.dataset.naeste);
    opdaterTemaKnap();
    // Er man PAA indstillingssiden, skal de tre knapper der ogsaa foelge med.
    if (state.view === 'settings') tegnSide();
  });
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

/* Et roligt baand, ikke en advarsel. Ingen roed farve, ingen tvang - og det
   kan lukkes for i dag med ét klik (handover princip 1). */
function tegnGennemgangsbaand() {
  const host = document.getElementById('reviewNudge');
  if (!host) return;
  let lukket = null;
  try { lukket = localStorage.getItem('doda_review_nudge'); } catch { /* privat */ }
  if (!state.reviewDue || state.view === 'review' || lukket === state.today) { host.innerHTML = ''; return; }

  const dag = new Date(`${state.today}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
  host.innerHTML = `<div class="nudge review-nudge">${icon('review', 17)}
    <span>It is ${esc(dag)} — the day you set aside for your weekly review.</span>
    <button class="btn ghost" id="nudgeGo">Start</button>
    <button class="btn ghost" id="nudgeNo">Not now</button></div>`;
  host.querySelector('#nudgeGo').addEventListener('click', () => gaaTil('review'));
  host.querySelector('#nudgeNo').addEventListener('click', () => {
    try { localStorage.setItem('doda_review_nudge', state.today); } catch { /* privat */ }
    host.innerHTML = '';
  });
}

function opdaterNav() {
  const host = document.getElementById('navHost');
  if (host) { host.innerHTML = navHtml(); bindNav(); }
  // Settings staar ikke i navigationen laengere - brugerknappen er indgangen,
  // og saa skal den ogsaa vise, naar man er der. Ellers er INTET markeret.
  const bruger = document.getElementById('userBtn');
  if (bruger) {
    if (state.view === 'settings') bruger.setAttribute('aria-current', 'page');
    else bruger.removeAttribute('aria-current');
  }
  // Bundlinjen har sin egen markering af den aktive side og sit eget tal.
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    if (el.dataset.view === state.view) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    const t = el.querySelector('.bottomnav-count');
    const v = viewById(el.dataset.view);
    const antal = v.tael ? (state.counts[v.tael] || 0) : 0;
    if (t && !antal) t.remove();
    else if (t) t.textContent = antal;
    else if (antal) el.insertAdjacentHTML('beforeend', `<span class="bottomnav-count">${antal}</span>`);
  });
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
  document.getElementById('userBtn').addEventListener('click', visBrugerMenu);
  document.getElementById('syncBtn').addEventListener('click', () => synk(true));
  saetNavSkjult(navErSkjult());
  document.getElementById('pinBtn').addEventListener('click', () => {
    const skjul = !document.body.classList.contains('navskjult');
    saetNavSkjult(skjul);
    // Foldes den vaek, mens man staar i den, skal overlayet ogsaa lukke.
    if (skjul) document.body.classList.remove('navopen');
  });
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  // "Fangst skal kunne naas fra alle skaerme med ét tryk" (handover §6).
  document.getElementById('bottomCapture').addEventListener('click', () => {
    const o = omniEl();
    if (o) { o.scrollIntoView({ block: 'start' }); o.focus(); }
  });
  // Er serverens version nyere end den indlaeste, sidder der en gammel
  // app.js i service workerens cache. Ryd den FOER genindlaesningen -
  // ellers serverer den bare den samme gamle fil igen.
  bindTemaKnap();
  const vBtn = document.getElementById('versionBtn');
  if (vBtn) {
    vBtn.addEventListener('click', async () => {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage('ryd');
        }
        if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }
  document.getElementById('navToggle').addEventListener('click', () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('navopen'));
  bindOmni();
}

/*
 * At gaa til en skaerm betyder at se den REN.
 *
 * Nulstillingen laa foer bag `if (skifter)`, og det gjorde et projekt til en
 * blindgyde: staar man inde i ét, er `state.view` allerede 'projects', saa
 * hverken sidebaren eller »← Projects« aendrede noget - `openProject` blev
 * staaende, og siden tegnede sig selv igen. Der skete tilsyneladende
 * ingenting. Samme fejl ramte et kontekstfilter i Next Actions og et
 * projektfilter i logbogen.
 *
 * Reglen nu: gaaTil() rydder ALTID undertilstanden, og `opt` saetter det, der
 * er ment. Et filter er noget, man vaelger - ikke noget, man arver.
 */
function gaaTil(view, opt) {
  const skifter = state.view !== view;
  // Var der noget at rydde, er skaermen aendret, selv om `view` er den samme.
  const havdeFilter = !!(state.openProject || state.filterContext
    || state.filterArea || state.logProject);
  state.view = view;
  state.openProject = null;
  state.filterContext = null;
  state.filterArea = null;
  state.logProject = null;
  if (opt && opt.context !== undefined) state.filterContext = opt.context;
  if (opt && opt.area !== undefined) state.filterArea = opt.area;
  document.body.classList.remove('navopen');
  opdaterNav();
  tegnGennemgangsbaand();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter || havdeFilter) window.scrollTo(0, 0);
}

/** Henter state og gentegner NAV og SIDE, men aldrig hele skallen. */
async function genindlaes() {
  await hentState();
  opdaterNav();
  tegnGennemgangsbaand();
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
    state.reviewDue = d.reviewDue;
    if (d.notesEnabled !== undefined) state.notesEnabled = d.notesEnabled;
    if (d.noteCount !== undefined) state.noteCount = d.noteCount;
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* ------------------------------------------------------ sidebaren */

/*
 * Sidebaren kan foldes helt vaek, sa der kun staar en hamburger tilbage
 * (som i tingdo). Skjult ligger den som et overlay over indholdet i stedet
 * for at skubbe det - ellers ville hele siden hoppe, hver gang man kiggede
 * i menuen.
 *
 * Valget huskes. Pa mobil styrer mediegraensen det i forvejen, og der
 * roerer flaget ingenting.
 */
function navErSkjult() {
  try { return localStorage.getItem('doda_nav_skjult') === '1'; } catch { return false; }
}

function saetNavSkjult(skjult) {
  try { localStorage.setItem('doda_nav_skjult', skjult ? '1' : '0'); } catch { /* privat */ }
  document.body.classList.toggle('navskjult', skjult);
  if (!skjult) document.body.classList.remove('navopen');
  // Brugermenuen haenger fast pa brugerknappen. Foldes sidebaren vaek, mens
  // menuen staar aaben, ville den blive svaevende tilbage over ingenting.
  const menu = document.getElementById('userMenu');
  if (menu) menu.remove();
  const knap = document.getElementById('pinBtn');
  if (knap) {
    const tekst = skjult ? 'Keep the menu open' : 'Hide the menu';
    knap.setAttribute('aria-label', tekst);
    knap.title = tekst;
    knap.classList.toggle('off', skjult);
  }
}

/* ------------------------------------------------------- gem-genvejen */

/*
 * ⌘+Enter (Ctrl+Enter) gemmer en aaben rude, saa man ikke skal efter musen
 * for at afslutte en redigering, man har tastet sig igennem.
 *
 * Genvejen bindes paa den ENKELTE rude med DENS knap - ikke globalt paa
 * `.modal .btn.primary`. Et spoergsmaal som »denne gang eller alle
 * fremtidige?« har ogsaa en primaer knap, og den maa et tastetryk ikke kunne
 * svare paa ved et uheld: den ville aendre hele serien. En rude, der ikke
 * gemmer noget, kalder simpelthen ikke det her.
 *
 * `preventDefault` er ikke pynt - uden den lægger beskrivelsesfeltet et
 * linjeskift ind i samme ombæring.
 */
function bindGemGenvej(host, knap) {
  if (!host || !knap) return;
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    knap.click();
  });
}

/* --------------------------------------------------- brugermenuen */

/* Log ud skal kunne naas uden at gaa i indstillingerne. Menuen er en lille
   popover over brugerknappen - samme sted, man i forvejen klikker. */
function visBrugerMenu() {
  const gammel = document.getElementById('userMenu');
  if (gammel) { gammel.remove(); return; }
  const anker = document.getElementById('userBtn');
  if (!anker) return;

  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'userMenu';
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(visNavn(state.user.username))}</div>
      <div class="meta">Signed in${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="guide">${icon('guide', 17)}<span>Guide</span></button>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item" data-go="shortcuts">${icon('log', 17)}<span>Keyboard shortcuts</span></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;

  const r = anker.getBoundingClientRect();
  host.style.left = `${Math.round(r.left)}px`;
  host.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'settings') gaaTil('settings');
      else if (hvad === 'guide') gaaTil('guide');
      else if (hvad === 'shortcuts') visGenveje();
      else {
        await api('POST', '/api/logout', {});
        state.user = null;
        // Koen og fokus hoerer til den bruger, der lige gik.
        try { localStorage.removeItem('doda_focus'); } catch { /* privat */ }
        render();
      }
    });
  });
  // Ét klik udenfor lukker igen. setTimeout, sa klikket der AABNEDE menuen
  // ikke lukker den med det samme.
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* --------------------------------------------------- sideoversigten */

/*
 * Notion-agtig oversigt i hoejre side: en stak streger, én pr. afsnit, som
 * folder sig ud med teksten, naar musen er over den.
 *
 * Den bor i <body>, ikke i #pageHost. Alt inde i pageHost bliver skiftet ud
 * ved hver optegning, og sa ville oversigten forsvinde - samme grund som
 * fokusbjaelken ligger fast i body (RUNE-ERFARINGER, F8).
 */
const tocState = { punkter: [], aktiv: -1 };

function byggToc() {
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  const host = document.getElementById('pageHost');
  // Kun sidens egne afsnit. En modal har ogsa h2'er, men den ligger i body
  // og bliver derfor ikke fanget her.
  const fundne = host ? [...host.querySelectorAll('h2')] : [];

  // Under to afsnit er der ingen oversigt at lave, og pa en telefon ville
  // en fast stribe i hoejre side ligge oven i indholdet.
  if (fundne.length < 2 || smalSkaerm()) {
    rail.hidden = true;
    rail.innerHTML = '';
    tocState.punkter = [];
    return;
  }

  tocState.punkter = fundne.map((el, i) => {
    if (!el.id) el.id = `afsnit-${i}`;
    // Tallet i .group-count hoerer til overskriften, ikke til navnet.
    const taeller = el.querySelector('.group-count');
    const navn = (taeller ? el.textContent.replace(taeller.textContent, '') : el.textContent).trim();
    return { el, navn: navn || `Section ${i + 1}` };
  });
  tocState.aktiv = -1;

  rail.innerHTML = tocState.punkter.map((p, i) => `
    <button class="toc-item" data-toc="${i}" title="${esc(p.navn)}">
      <span class="toc-dash"></span><span class="toc-tekst">${esc(p.navn)}</span>
    </button>`).join('');
  rail.hidden = false;

  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = tocState.punkter[Number(el.dataset.toc)];
      if (p) p.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  markerToc();
}

/** Afsnittet, der lige er rullet forbi toppen, er det man er i. */
function markerToc() {
  if (!tocState.punkter.length) return;
  let i = 0;
  for (let n = 0; n < tocState.punkter.length; n++) {
    if (tocState.punkter[n].el.getBoundingClientRect().top <= 140) i = n;
  }
  if (i === tocState.aktiv) return;
  tocState.aktiv = i;
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.classList.toggle('on', Number(el.dataset.toc) === i);
  });
}

// Én rAF pr. rulning: getBoundingClientRect pa hvert afsnit ved hvert
// scroll-tick ville ellers laese layout hundredvis af gange i sekundet.
let tocVenter = false;
window.addEventListener('scroll', () => {
  if (tocVenter || !tocState.punkter.length) return;
  tocVenter = true;
  requestAnimationFrame(() => { tocVenter = false; markerToc(); });
}, { passive: true });

// Skiftes der mellem telefon og desktop, skal oversigten med.
window.addEventListener('resize', () => { byggToc(); });

/* ------------------------------------------------------------ connector */

/**
 * Adressen at vende tilbage til, naar man er logget ind.
 *
 * Serveren sender ?next=/oauth/authorize?... hertil, naar en connector beder
 * om samtykke og der ingen session er. KUN den ene sti accepteres - alt andet
 * ville vaere en aaben viderestilling, og en connector-godkendelse er
 * praecis det sted, hvor man ikke skal kunne lokkes videre.
 */
function oauthNaeste() {
  try {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/oauth/authorize?') ? n : null;
  } catch { return null; }
}

/**
 * ?item=<id> aabner ét bestemt element.
 *
 * Kalenderfeedet peger herind, saa man kan springe fra en deadline i sin
 * kalender til opgaven i doda. Adressen ryddes bagefter: en genindlaesning
 * skal ikke aabne ruden igen, og id'et hoerer ikke hjemme i historikken.
 */
async function aabnFraAdressen() {
  let id = null;
  try { id = new URLSearchParams(location.search).get('item'); } catch { id = null; }
  if (!id || !state.user) return;
  try { history.replaceState(null, '', location.pathname); } catch { /* ligegyldigt */ }
  try {
    const d = await api('GET', `/api/v1/items/${encodeURIComponent(id)}`);
    // state.items skal kende elementet: detaljeruden slaar op i den, naar
    // den gemmer og gentegner.
    if (!state.items.some((x) => x.id === d.item.id)) state.items = [d.item, ...state.items];
    aabnElement(d.item);
  } catch (ex) {
    // Slettet, eller et id fra en gammel kalenderpost. Sig det roligt.
    toast(ex.status === 404 ? 'That item is gone — it was deleted.' : ex.message);
  }
}

/** Kaldes efter login. Returnerer true, hvis siden er paa vej et andet sted hen. */
function fortsaetTilConnector() {
  const n = oauthNaeste();
  if (!n) return false;
  location.replace(n);
  return true;
}

/* --------------------------------------------------------------- start */

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'doda';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    // Var jeg allerede logget ind, da connectoren sendte mig herhen, skal
    // jeg slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
    // Ét ja/nej, hentet én gang: er Sagu forbundet, faar `*` en raekke mere.
    if (state.user) tjekSagu();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} doda</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  registrerSW();
  lytPaaForbindelse();
  gendanFokus();
  aabnFraAdressen();
})();

/* ---- p2_omni.js ---- */
'use strict';
/* doda - kommandopaletten. Ét felt der bade soeger, opretter og navigerer.
   Oprettelse star altid oeverst og kan altid nas med Enter: soegning ma
   aldrig komme i vejen for fangst (handover §5.1). */

/* Foerste tegn vaelger en TILSTAND. Pillen inde i feltet og legenden i bunden
   viser hvilken - sa man aldrig er i tvivl om, hvad Enter kommer til at gore. */
/*
 * Er Sagu forbundet? Hentes ÉN gang, naar appen er tegnet.
 *
 * Ikke pr. tastetryk og ikke pr. optegning: svaret aendrer sig kun, naar man
 * selv har vaeret i Settings, og et kald pr. bogstav ville vaere en rundtur
 * for et ja/nej, der stod fast (RUNE-ERFARINGER, doda v27).
 */
let saguKlar = false;

async function tjekSagu() {
  try { saguKlar = !!(await api('GET', '/api/v1/sagu')).connected; } catch { saguKlar = false; }
}

const MODER = {
  // Legenden skal naevne ALT, parseren kan i den tilstand. Naevner den mindre,
  // findes funktionen i praksis ikke - det var praecis derfor "/projekt" var
  // ubrugt indtil v4, selv om paletten lovede det.
  '+': { id: 'task', pil: '+ New Task', ph: 'Task title… try !tomorrow at 9',
    legend: ['/ project', '# context', '! date', '~ hide until'], enter: 'Create' },
  '*': { id: 'note', pil: '* New Note', ph: 'Note title…', legend: ['/ project', '# context'], enter: 'Create' },
  '/': { id: 'project', pil: '/ Projects', ph: 'Find or create a project…', legend: [], enter: 'Open' },
  '#': { id: 'context', pil: '# Contexts', ph: 'Find or create a context…', legend: [], enter: 'Open' },
  ':': { id: 'area', pil: ': Areas', ph: 'Find or create an area…', legend: [], enter: 'Open' },
};

/* De tre navigations-tilstande er ens pa alt andet end hvad de hedder og
   hvor de gemmer. Ét sted, sa en ny slags ikke skal tilfoejes fem steder. */
const NAVIGATION = {
  '/': { kilde: () => state.projects, hvad: 'project', flertal: 'projects', ikon: 'projects', sti: '/api/v1/projects', felt: 'project' },
  '#': { kilde: () => state.contexts, hvad: 'context', flertal: 'contexts', ikon: 'contexts', sti: '/api/v1/contexts', felt: 'context' },
  ':': { kilde: () => state.areas, hvad: 'area', flertal: 'areas', ikon: 'someday', sti: '/api/v1/areas', felt: 'area' },
};

/* Legenden er en kravspecifikation (doda v9): naevner den "* note", skal den
   tilstand findes. Derfor bygges den efter tilstanden, ikke som en konstant. */
const standardLegend = () => ['+ task']
  .concat(state.notesEnabled ? [saguKlar ? '* note in Sagu' : '* note'] : [])
  .concat(['/ projects', '# contexts', ': areas']);

const omniState = {
  mode: null,          // et tegn fra MODER, eller null
  tolket: null,
  resultater: [],
  valgt: 0,
  raekker: [],
  bekraeft: null,      // {contexts:[], project} - ukendte navne der skal godkendes
  soegeTimer: null,
  soegeToken: 0,
  // Filer, der er trukket ind, men endnu ikke sendt. De VENTER paa titlen:
  // en fil maa ikke oprette noget bag om brugeren, og et Esc skal kunne
  // fortryde det hele uden at efterlade en opgave, ingen bad om.
  filer: [],
};

function omniEl() { return document.getElementById('omni'); }
function omniKort() { return document.getElementById('omniCard'); }

/* Tolkningen sker LOKALT med den samme parser, serveren bruger. Ingen
   netvaerkskald pr. tastetryk - chipsene skal foelge fingrene. */
function tolkNu(tekst) {
  const p = (typeof dodaParse !== 'undefined') ? dodaParse : null;
  if (!p) return null;
  // I note-tilstand tolkes teksten, som om praefikset stod der.
  return p.tolkFangst(omniState.mode === '*' ? `* ${tekst}` : tekst);
}

/* ------------------------------------------------ forslag mens man skriver */

/*
 * Skriver man `/dod` midt i en linje, skal de projekter, der matcher, kunne
 * ses - ellers er den eneste vej til det rigtige navn at huske det.
 *
 * Det er ikke en soegning: den kigger paa den MARKOER, markoeren staar i.
 * Reglerne foelger parseren (app/shared/parse.js), for ellers ville paletten
 * foreslaa noget, teksten bagefter bliver tolket anderledes:
 *   - markoeren skal staa ved linjestart eller efter et mellemrum
 *     (ellers ville "navn@eksempel.dk" udloese en projektliste)
 *   - navnet er ét ord af bogstaver, tal, _ og -
 *   - der maa ikke vaere naaet et mellemrum efter markoeren
 */
const MARKOER_KILDE = {
  '/': { hvad: 'project', kilde: () => state.projects, ikon: 'projects' },
  '@': { hvad: 'project', kilde: () => state.projects, ikon: 'projects' },
  '#': { hvad: 'context', kilde: () => state.contexts, ikon: 'contexts' },
};

/** Hvilken markoer staar markoeren (caret'en) i? Null, hvis ingen. */
function markoerVedCaret() {
  const el = omniEl();
  if (!el) return null;
  // Navigations-tilstandene har deres egen liste; der er intet inline at gaette paa.
  if (omniState.mode && !'+*'.includes(omniState.mode)) return null;
  const pos = el.selectionStart;
  if (pos === null || pos === undefined) return null;
  const foer = el.value.slice(0, pos);
  const m = foer.match(/(^|\s)([/@#])([\p{L}\p{N}_-]*)$/u);
  if (!m) return null;
  return { tegn: m[2], delvist: m[3], start: pos - m[3].length - 1, slut: pos };
}

/** Rækker til paletten: de navne, der matcher det halvskrevne. */
function forslagsRaekker() {
  const t = markoerVedCaret();
  if (!t) return [];
  const k = MARKOER_KILDE[t.tegn];
  if (!k) return [];
  const q = t.delvist.toLowerCase();
  // Det, der BEGYNDER med det skrevne, foerst. Med ren "indeholder"-sortering
  // foreslog "/hus" projektet Sommerhus foer "Hus og have" - og Tab satte det
  // forkerte navn ind. Naar man fuldfoerer et navn, vejer begyndelsen tungest.
  return k.kilde()
    .filter((x) => !q || x.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aa - bb || a.name.localeCompare(b.name);
    })
    .slice(0, 6)
    .map((x) => ({ type: 'forslag', navn: x.name, tegn: t.tegn, ikon: k.ikon, hvad: k.hvad, token: t }));
}

/**
 * Saetter det fulde navn ind i stedet for det halvskrevne.
 *
 * Navne med mellemrum saettes i anfoerselstegn - parseren laeser `@"To ord"`,
 * og uden dem ville kun det foerste ord blive til projektet.
 */
function fuldfoerMarkoer(raekke) {
  const el = omniEl();
  const t = raekke.token;
  const navn = /[\s]/.test(raekke.navn) ? `"${raekke.navn}"` : raekke.navn;
  const ind = `${t.tegn}${navn} `;
  el.value = el.value.slice(0, t.start) + ind + el.value.slice(t.slut);
  const nyPos = t.start + ind.length;
  el.focus();
  el.setSelectionRange(nyPos, nyPos);
  omniState.valgt = 0;
  opdaterOmni();
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

/* ------------------------------------------------------------ tilstand */

function saetMode(tegn) {
  // Er noter slaaet fra, findes note-tilstanden ikke. Uden det her ville
  // "*" aabne en tilstand, hvis resultat man bagefter ikke kunne finde.
  if (tegn === '*' && !state.notesEnabled) tegn = null;
  omniState.mode = tegn;
  const el = omniEl();
  const pil = document.getElementById('omniMode');
  if (!el || !pil) return;
  const m = tegn ? MODER[tegn] : null;
  pil.hidden = !m;
  pil.textContent = m ? m.pil : '';
  el.placeholder = m ? m.ph : 'Just type to Capture, Navigate and Find';
  omniKort().classList.toggle('moded', !!m);
}

function tegnLegend() {
  const host = document.getElementById('omniLegend');
  if (!host) return;
  const m = omniState.mode ? MODER[omniState.mode] : null;
  const dele = m ? m.legend : standardLegend();
  const enter = m ? m.enter : 'Select';
  host.innerHTML = `
    <span class="legend-keys">${dele.map((d) => {
    const mellemrum = d.indexOf(' ');
    return `<span class="legend-item"><kbd>${esc(d.slice(0, mellemrum))}</kbd>${esc(d.slice(mellemrum + 1))}</span>`;
  }).join('<span class="legend-dot">·</span>')}</span>
    <span class="legend-nav"><span class="legend-item">↑ ↓ Navigate</span>
      <span class="legend-item">↵ ${esc(enter)}</span></span>`;
}

/* ------------------------------------------------------------- chips */

function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = omniState.tolket;
  const raa = omniEl() ? omniEl().value.trim() : '';
  // Navigations-tilstandene har ingen tolkning at vise.
  if ((!raa && !omniState.filer.length) || (omniState.mode && !'+*'.includes(omniState.mode))) { host.innerHTML = ''; return; }
  if (!t) { host.innerHTML = omniState.filer.map((f) =>
    `<span class="chip">${esc(`📎 ${f.name}`)}</span>`).join(''); return; }

  const chips = [];
  // Ventende filer staar foerst: de er det mest overraskende i feltet.
  for (const f of omniState.filer) chips.push([`📎 ${f.name}`, 'accent']);
  /* Udfylder skaermen noget, skal det staa HER, foer man trykker Enter -
     ellers sker det bag om ryggen paa brugeren, og det er praecis den slags
     tavse hjaelpsomhed, en chip-raekke findes for at afsloere.
     Teksten vinder, saa chippen udebliver, naar man selv har skrevet det. */
  const skaerm = skaermensUdfyldning();
  if (skaerm && t.kind !== 'note'
    && !(skaerm.project && t.project) && !(skaerm.context && t.contexts.length)) {
    chips.push([`→ ${skaerm.vis}`, 'neutral']);
  }
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

/* ------------------------------------------------------------ raekker */

function byggRaekker() {
  const raa = omniEl().value.trim();
  const raekker = [];
  const mode = omniState.mode;

  // Navigation: vis det, man kan springe til - og tilbyd at oprette det,
  // der ikke findes endnu.
  if (NAVIGATION[mode]) {
    const n = NAVIGATION[mode];
    const kilde = n.kilde();
    const traf = kilde.filter((x) => !raa || x.name.toLowerCase().includes(raa.toLowerCase()));
    for (const x of traf.slice(0, 12)) {
      raekker.push({
        type: 'goto', mode, id: x.id, titel: x.name,
        under: mode === '/' ? `${x.open_count || 0} open` : n.hvad,
        ikon: n.ikon,
      });
    }

    // Oprettelsen staar NEDERST her, modsat fangst-tilstanden. I fangst er
    // det nye det normale; her er det at springe hen til noget, man har.
    // Med oprettelsen oeverst ville Enter lave en dublet, hver gang man
    // skrev de foerste bogstaver af et navn, der allerede findes.
    const findes = raa && kilde.some((x) => x.name.toLowerCase() === raa.toLowerCase());
    if (raa && !findes) raekker.push({ type: 'nyt', mode, navn: raa, ikon: n.ikon, hvad: n.hvad });

    if (!raekker.length) {
      raekker.push({ type: 'tom', titel: `No ${n.flertal} yet`,
        under: `Type a name to create your first one` });
    }
    return raekker;
  }

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
    /*
     * Er Sagu forbundet, er `*` en note I SAGU - ikke et valg mellem to steder.
     *
     * Frem til v43 stod Sagu-noten som en raekke MERE, saa foerste plads var
     * uroert og ét Enter fangede det samme som i gaar (handover §5.1). Men
     * naar noterne bor i Sagu, er to raekker to steder at lede efter den
     * samme note bagefter, og valget skal traeffes forfra hver gang. Andreas
     * bad om det 21-08-2026: er der koblet en note-app paa, hoerer noterne
     * DERTIL.
     *
     * De noter, der allerede ligger i doda, bliver liggende og kan stadig
     * naas under Notes - det er kun VEJEN IND, der lukkes (DESIGN §v35).
     */
    const iSagu = mode === '*' && saguKlar && (t && t.title ? t.title : raa).trim();
    if (!iSagu) {
      raekker.push({
        type: 'create',
        titel: t && t.title ? t.title : raa,
        under: mode === '*' ? 'NEW NOTE' : mode === '+' ? 'NEW TASK' : 'QUICK CAPTURE',
      });
    } else {
      raekker.push({
        type: 'sagunote',
        titel: t && t.title ? t.title : raa,
        // Hele linjen, som den blev skrevet. Noten i Sagu skal hedde det
        // tolkede (uden markoerer), men OPGAVEN i doda skal have @projekt,
        // #kontekst og !dato med - de gaar tabt, hvis kun titlen sendes.
        linje: raa,
        under: 'NEW NOTE IN SAGU · linked both ways',
      });
    }
  }

  // Forslagene staar UNDER oprettelsen. Ét Enter skal stadig fange - det er
  // appens aeldste regel (handover §5.1) - saa listen maa aldrig skubbe
  // oprettelsen ned fra foerste plads. Tab tager det oeverste forslag.
  for (const f of forslagsRaekker()) raekker.push(f);

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
    if (r.type === 'tom') {
      return `<div class="omni-row empty-row"><span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></div>`;
    }
    if (r.type === 'goto') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon(r.ikon)}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></button>`;
    }
    if (r.type === 'forslag') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon(r.ikon)}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.tegn)}${esc(r.navn)}</span>
        <span class="omni-row-sub">${esc(r.hvad)} · tab to insert</span></span></button>`;
    }
    if (r.type === 'nyt') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('plus')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.navn)}</span>
        <span class="omni-row-sub">NEW ${esc(r.hvad.toUpperCase())}</span></span></button>`;
    }
    // Quick Capture: den store, fremhaevede raekke.
    return `<button class="omni-row big${r.type === 'confirm' ? ' confirm' : ''}"${valgt} data-i="${i}">
      <span class="omni-plus">${icon(r.type === 'confirm' ? 'next' : 'plus', 20)}</span>
      <span class="omni-row-main"><span class="omni-row-title">${esc(r.titel)}</span>
      ${r.type === 'confirm' ? `<span class="omni-row-sub">${esc(r.under)}</span>` : ''}</span>
      ${r.type === 'confirm' ? '' : `<span class="omni-badge">${esc(r.under)}</span>`}
    </button>`;
  }).join('');
  panel.hidden = false;

  panel.querySelectorAll('button.omni-row').forEach((el) => {
    el.addEventListener('mouseenter', () => { omniState.valgt = Number(el.dataset.i); markerValgt(); });
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
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
  /*
   * Soeg paa den TOLKEDE titel, ikke paa den raa linje.
   *
   * Skrev man "test /dod", blev hele strengen sendt afsted - og de
   * resultater, der stod der, mens man skrev "test", forsvandt i samme
   * oejeblik man begyndte paa projektet. Markoererne hoerer til tolkningen,
   * ikke til det, man leder efter; brugeren har stadig kun skrevet "test".
   */
  const t = omniState.tolket;
  const q = ((t && t.title) || omniEl().value).trim();
  // Navigation soeger lokalt; kun fritekst og opgave-tilstand spoerger serveren.
  if (q.length < 2 || (omniState.mode && omniState.mode !== '+')) {
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

  if (raekke.type === 'item') { aabnElement(raekke.item); luk(); return; }
  if (raekke.type === 'tom') return;
  if (raekke.type === 'goto') { luk(); gaaTilNavigation(raekke.mode, raekke.id); return; }
  if (raekke.type === 'nyt') { await opretNavigation(raekke); return; }
  if (raekke.type === 'forslag') { fuldfoerMarkoer(raekke); return; }
  if (raekke.type === 'sagunote') { await opretSaguNote(raekke.titel, raekke.linje); return; }
  await fangstNu(raekke.type === 'confirm');
}

/**
 * Opretter en note i SAGU - og en opgave i doda, der peger paa den.
 *
 * »Link begge veje« er ikke pynt: uden opgaven er noten en oe, og uden noten
 * er opgaven en titel.
 *
 * RAEKKEFOELGEN ER VENDT (v45). Foer blev noten oprettet foerst, saa der
 * ingenting var oprettet, hvis Sagu fejlede. Men opgavens id findes ikke paa
 * det tidspunkt - og saa kunne linket tilbage kun pege paa doda som SAADAN
 * (`location.origin`). Noten sagde »From doda: [titel](https://doda.dk)«, og
 * det foerte til forsiden, ikke til opgaven. Halvdelen af »begge veje« var
 * altsaa aldrig rigtig der.
 *
 * Nu: opgaven foerst, saa noten med `?item=<id>` (DESIGN §v23), saa linket
 * den anden vej.
 *
 * Fejler Sagu nu, staar der en opgave uden link tilbage - og den BEHOLDES med
 * vilje. Siden v44 er `*` den eneste vej til en note, saa »intet oprettet«
 * ville betyde, at teksten var tabt. En opgave uden link lover ingenting; den
 * er bare en opgave. Det er den rigtige vej at fejle nu.
 */
async function opretSaguNote(raaTitel, raaLinje) {
  const titel = String(raaTitel || '').trim();
  if (!titel) return;
  /*
   * Opgaven foerst: dens id skal ind i notens link tilbage.
   *
   * Og den faar HELE linjen, ikke bare titlen. Foer v46 blev kun den tolkede
   * titel sendt, saa `* Blodprover @Doda #helbred !i morgen` gav en opgave
   * uden projekt, uden kontekst og uden dato - markoererne var pillet fra i
   * tolkningen og kom aldrig med videre. Noten i Sagu skal hedde det rene
   * (den har hverken projekter eller datoer), men opgaven skal have det hele.
   */
  const linje = String(raaLinje || '').trim() || titel;
  let it = null;
  try {
    it = (await api('POST', '/api/v1/capture', { text: linje, createNew: true })).item;
  } catch (ex) { toast(ex.message); return; }
  try {
    const d = await api('POST', '/api/v1/sagu/note', {
      title: titel,
      backUrl: it ? `${location.origin}/?item=${encodeURIComponent(it.id)}` : location.origin,
      backTitle: titel,
    });
    // Opgaven i doda peger paa noten. `link_url` er generisk - det er dét,
    // der goer, at Sagu kan bruge det samme felt som Notion.
    if (it) {
      await api('POST', `/api/v1/items/${it.id}`, {
        link_url: d.page.url,
        link_title: d.page.title,
      });
    }
    luk();
    await genindlaes();
    toast('Note created in Sagu', {
      label: 'Open',
      run: () => window.open(d.page.url, '_blank', 'noopener'),
    });
  } catch (ex) {
    /*
     * En fejlet forbindelse er ikke en fejlet fangst: feltet staar uroert, saa
     * man kan trykke igen.
     *
     * Foer v44 stod der ogsaa »eller vaelg den almindelige note ovenover« -
     * men den raekke findes ikke laengere, naar Sagu er forbundet. Uden en vej
     * ud ville en note vaere UMULIG at gemme, mens Sagu er nede, og teksten
     * ville staa i feltet uden noget sted at gaa hen. Derfor tilbydes doda som
     * det, den nu er: en noedudgang, ikke et valg, man skal traeffe hver gang.
     */
    /*
     * Opgaven er allerede oprettet og BLIVER staaende - teksten er reddet,
     * selv om Sagu ikke svarede. Beskeden skal sige begge dele, ellers ved
     * man ikke, om man skal skrive den igen.
     */
    luk();
    await genindlaes();
    toast(`${ex.message} — the task is in your inbox.`, it ? {
      label: 'Open',
      run: () => { window.location.href = `/?item=${encodeURIComponent(it.id)}`; },
    } : undefined);
  }
}

function gaaTilNavigation(mode, id) {
  if (mode === '/') gaaTilProjekt(id);
  else if (mode === '#') gaaTil('next', { context: id });
  else gaaTil('projects', { area: id });
}

/**
 * Opretter et projekt, en kontekst eller et omraade fra paletten - og gaar
 * derhen bagefter. Serveren er idempotent pa navnet, sa to hurtige Enter
 * ikke kan lave en dublet.
 */
async function opretNavigation(raekke) {
  const n = NAVIGATION[raekke.mode];
  if (!n) return;
  try {
    const svar = await api('POST', n.sti, { name: raekke.navn });
    const ny = svar[n.felt];
    luk();
    await genindlaes();
    if (ny && ny.id) gaaTilNavigation(raekke.mode, ny.id);
    toast(`${n.hvad.charAt(0).toUpperCase()}${n.hvad.slice(1)} “${raekke.navn}” created`);
  } catch (ex) {
    toast(ex.message);
  }
}

/*
 * Skaermen, man staar paa, udfylder det, teksten tier om (DESIGN.md §3).
 * Serveren har det sidste ord - den tjekker, at id'erne findes, og at
 * statussen er én, en skaerm overhovedet maa implicere.
 */
function skaermensUdfyldning() {
  if (state.view === 'waiting') return { status: 'waiting', vis: 'Waiting For' };
  if (state.view === 'someday') return { status: 'someday', vis: 'Someday' };
  if (state.view === 'projects' && state.openProject) {
    const p = state.projects.find((x) => x.id === state.openProject);
    return p ? { project: p.id, vis: `@${p.name}` } : null;
  }
  if (state.view === 'next' && state.filterContext) {
    const k = state.contexts.find((x) => x.id === state.filterContext);
    return k ? { context: k.id, vis: `#${k.name}` } : null;
  }
  return null;
}

async function fangstNu(bekraeftet) {
  let tekst = omniEl().value.trim();
  if (!tekst) return;
  // Tilstanden oversaettes til det praefiks, parseren og serveren forstar.
  if (omniState.mode === '*') tekst = `* ${tekst}`;

  // Kendes alle navne i forvejen, er der intet at bekraefte - saa skal ét
  // Enter vaere nok. Det er hele pointen med "fangst pa ét trin".
  const ukendte = ukendteNavne(omniState.tolket);
  const skalSpoerge = !bekraeftet && (ukendte.contexts.length > 0 || ukendte.project);

  try {
    const skaerm = skaermensUdfyldning();
    const krop = { text: tekst, createNew: !skalSpoerge };
    if (skaerm) krop.from = { status: skaerm.status, project: skaerm.project, context: skaerm.context };
    const svar = await api('POST', '/api/v1/capture', krop);
    if (svar.needsConfirm) {
      omniState.bekraeft = svar.needsConfirm;
      omniState.valgt = 0;
      tegnPanel();
      return;
    }
    const it = svar.item;
    const venter = omniState.filer.slice();
    luk();
    /* Filerne sendes FOERST nu: elementet skal findes, foer det kan have en
       vedhaeftning. Fejler en af dem, er opgaven stadig oprettet - og det er
       den rigtige rangorden: teksten er det vigtige, filen er tilbehoeret. */
    if (venter.length) {
      let sendt = 0;
      for (const f of venter) {
        try { await uploadFil(it.id, f); sendt++; } catch (ex) { toast(ex.message); }
      }
      if (sendt) toast(`${sendt} file${sendt === 1 ? '' : 's'} attached`);
    }
    // Staar man paa den skaerm, opgaven lander paa, skal den vaere der NU.
    // Ellers hentes state og liste som foer (p3_lists' indsaetStraks).
    if (indsaetStraks(it)) opfriskBagefter();
    else await genindlaes();
    toast(it.kind === 'note' ? 'Note saved' : `Added to ${statusNavn(it.status)}`, {
      label: 'Undo',
      run: async () => { await api('DELETE', `/api/v1/items/${it.id}`, {}); await genindlaes(); },
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
  saetMode(null);
  omniState.tolket = null;
  omniState.resultater = [];
  omniState.bekraeft = null;
  omniState.valgt = 0;
  omniState.filer = [];
  tegnChips();
  tegnPanel();
  tegnLegend();
}

function opdaterOmni() {
  const el = omniEl();

  // Foerste tegn kan vaelge en tilstand - men KUN naar feltet ellers er tomt.
  // Ellers ville "#hjem" midt i en saetning skifte tilstand, og den inline
  // genvejssyntaks ville holde op med at virke.
  if (!omniState.mode && el.value.length === 1 && MODER[el.value]) {
    saetMode(el.value);
    el.value = '';
  }

  omniState.tolket = tolkNu(el.value);
  omniState.bekraeft = null;   // en aendring i teksten gor bekraeftelsen ugyldig
  tegnChips();
  tegnLegend();
  tegnPanel();
  planlaegSoegning();
}

/*
 * En fil trukket ind paa kommandobaren er STARTEN paa en opgave.
 *
 * Den opretter ikke noget af sig selv: filen laegger sig som en chip og
 * venter paa, at man skriver en titel og trykker Enter - praecis som en
 * dato eller en kontekst gor. Er feltet tomt, foreslaas filnavnet som titel,
 * saa ét Enter er nok. Esc fortryder det hele uden at efterlade noget.
 */
function bindOmniFiler() {
  const kort = omniKort();
  const el = omniEl();
  if (!kort || !el) return;

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((n) => kort.addEventListener(n, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    stop(e);
    kort.classList.add('draaber');
  }));
  ['dragleave', 'dragend'].forEach((n) => kort.addEventListener(n, () => kort.classList.remove('draaber')));

  kort.addEventListener('drop', (e) => {
    const filer = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    if (!filer.length) return;
    stop(e);
    kort.classList.remove('draaber');
    omniState.filer = omniState.filer.concat(filer);
    // Filnavnet UDEN endelse er et bedre forslag end intet - men det maa
    // aldrig overskrive noget, brugeren allerede har skrevet.
    if (!el.value.trim()) el.value = filer[0].name.replace(/\.[^.]+$/, '');
    el.focus();
    opdaterOmni();
  });
}

function bindOmni() {
  const el = omniEl();
  if (!el) return;
  bindOmniFiler();
  saetMode(null);
  tegnLegend();

  el.addEventListener('input', opdaterOmni);
  el.addEventListener('focus', tegnPanel);
  // Flytter man markoeren ind i et halvskrevet navn uden at aendre teksten,
  // skal forslagene ogsaa komme frem. keyup daekker piletaster; click daekker mus.
  el.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') tegnPanel(); });
  el.addEventListener('click', tegnPanel);
  el.addEventListener('blur', () => {
    // Lille forsinkelse, sa et klik pa en raekke nar at blive registreret.
    setTimeout(() => {
      if (document.activeElement === el) return;
      const p = document.getElementById('omniPanel');
      if (p) p.hidden = true;
    }, 150);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    // Backspace i et tomt felt forlader tilstanden i stedet for ingenting.
    if (e.key === 'Backspace' && !el.value && omniState.mode) {
      e.preventDefault();
      saetMode(null);
      opdaterOmni();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!omniState.raekker.length) return;
      e.preventDefault();
      const n = omniState.raekker.length;
      omniState.valgt = (omniState.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    // Tab fuldfoerer et halvskrevet navn. Er oprettelsen valgt (det normale),
    // tages det oeverste forslag - ellers det, man har rullet ned til.
    if (e.key === 'Tab') {
      const valgt = omniState.raekker[omniState.valgt];
      const f = valgt && valgt.type === 'forslag'
        ? valgt : omniState.raekker.find((r) => r.type === 'forslag');
      if (!f) return;                     // intet at fuldfoere: lad Tab vaere Tab
      e.preventDefault();
      fuldfoerMarkoer(f);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); aktiver(); }
  });
}

/* Signaturen: begynd bare at skrive, sa aabner paletten.
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
  //
  // Se ogsaa paa haendelsens MAAL og ikke kun paa det, der har fokus NU:
  // en raekke, der flytter sig selv ud af listen (v27), er allerede vaek, naar
  // haendelsen naar herop, og saa er activeElement faldet tilbage til body.
  // Maalet ved stadig, hvor det kom fra - ogsaa efter det er taget ud af
  // dokumentet. (Raekken stopper i forvejen udbredelsen; det her er
  // spaerren for alt det, nogen bygger i morgen.)
  const fra = e.target;
  if (el && el.closest && el.closest('[data-keynav]')) return;
  if (fra && fra.closest && fra.closest('[data-keynav]')) return;

  const omni = omniEl();
  if (!omni) return;
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

/* Optegning + sideoversigten i hoejre side. Oversigten skal bygges EFTER
   indholdet, og der er mange veje ud af tegnSideIndhold - derfor ét sted
   her i stedet for et kald i hver gren. */
/*
 * En STILLE gentegning henter friske data uden at siden blinker: ingen
 * "Loading…"-skelet, og en fejl efterlader det, der staar, i fred.
 *
 * Baggrunden er den samme som ved offline-handlinger (RUNE-ERFARINGER, v11):
 * henter man data og taber forbindelsen, bliver listen ellers erstattet af en
 * fejlside - brugeren aabner appen paa sin telefon og ser sit arbejde
 * forsvinde. En baggrunds-synk maa kun kunne goere siden NYERE, aldrig tommere.
 */
let stilleGentegning = false;

async function tegnSide() {
  await tegnSideIndhold();
  byggToc();
}

async function tegnSideIndhold() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const view = viewById(state.view);

  if (view.id === 'settings') { host.innerHTML = sideSettings(); bindSettings(); return; }
  if (view.id === 'guide') { host.innerHTML = sideGuide(); bindGuide(); return; }
  if (view.id === 'contexts') { host.innerHTML = sideContexts(); bindContexts(); return; }
  if (view.id === 'repeat') { await sideRepeat(); return; }
  if (view.id === 'waiting') { await sideStatusliste('waiting', 'Waiting For'); return; }
  if (view.id === 'someday') { await sideStatusliste('someday', 'Someday'); return; }
  if (view.id === 'notes') { await sideNoter(); return; }
  if (view.id === 'log') { await sideLog(); return; }
  if (view.id === 'review') { await sideReview(); return; }
  if (view.id === 'focus') { host.innerHTML = sideFokus(); bindFokus(); tegnFokus(); return; }
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

  if (!stilleGentegning) {
    host.innerHTML = `<section class="page"><div class="page-head">
      <h1>${esc(view.label)}</h1><p class="lead">${esc(BESKRIVELSER[view.id])}</p>
    </div><div class="skeleton">Loading…</div></section>`;
  }

  try {
    if (view.id === 'inbox') {
      /* 'queued' med: den er noternes hvileplads, men en OPGAVE kan have
         faaet den (den var i statusvaelgeren indtil v36, og et genaabnet
         projekt vaekker sine opgaver dertil). Uden dette laa de usynlige i
         hver eneste liste. Inbox er det rigtige sted: de er uafklarede. */
      const d = await api('GET', '/api/v1/items?status=inbox,queued&kind=task');
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
    // Under en stille synk beholder vi det, der staar. Se noten ved flaget.
    if (stilleGentegning) return;
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
      <p class="hintline meta">↑↓ select · enter open · space done · n next · w waiting · s someday · x delete · esc leave</p>
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
    <p class="hintline meta">↑↓ select · enter open · space done · esc leave</p>
  </section>`;
}

/* -------------------------------------------------------- elementet */

function elementRaekke(it, i) {
  const projekt = it.project_id ? state.projects.find((p) => p.id === it.project_id) : null;
  // Venter der en offline-handling paa den, skal raekken sige det. Ellers
  // ser et tik ud til at blive glemt, indtil nettet kommer tilbage.
  const venter = afventende().get(it.id);
  const meta = [];
  if (venter) {
    meta.push(venter.type === 'complete' ? 'done — waiting to send'
      : venter.type === 'delete' ? 'deleted — waiting to send'
        : `→ ${statusNavn(venter.status)} — waiting to send`);
  }
  if (projekt) meta.push(esc(projekt.name));
  if (it.due_date) meta.push(`${visDato(it.due_date)}${it.due_time ? ` ${it.due_time}` : ''}`);
  if (it.contexts.length) meta.push(it.contexts.map((c) => `#${esc(c.name)}`).join(' '));

  return `<div class="item-row${venter ? ' venter' : ''}" tabindex="0" data-id="${esc(it.id)}" data-i="${i}">
    ${it.kind === 'note'
    // En note er reference, ikke arbejde (DESIGN.md §3). Den skal derfor
    // heller ikke TILBYDE at blive markeret udfoert - samme valg som i
    // detaljeruden, hvor noten far sit ikon i stedet for afkrydsningsringen.
    ? `<span class="tick note-mark" aria-hidden="true">${icon('note', 14)}</span>`
    : `<button class="tick${it.status === 'done' || (venter && venter.type === 'complete') ? ' on' : ''}" data-done="${esc(it.id)}"
      aria-label="Mark done" title="Mark done"></button>`}
    <div class="item-main">
      <div class="item-title">${linkify(it.title)}</div>
      ${meta.length ? `<div class="item-meta meta">${meta.join(' · ')}</div>` : ''}
    </div>
    ${it.link_url ? `<a class="item-flag" href="${esc(it.link_url)}" target="_blank" rel="noopener noreferrer"
      title="${esc(it.link_url)}" data-stop>${icon('link', 15)}</a>` : ''}
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

  // Et klik paa link-ikonet aabner linket - ikke elementet.
  document.querySelectorAll('.item-row [data-stop]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
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

/**
 * Piletasterne gaar IND i listen, uden at man skal klikke foerst.
 *
 * Raekkerne ejer bogstaverne (n/w/s/x), men kun naar de har fokus - og fokus
 * kunne foer kun komme fra et klik, som samtidig aabner opgaven. Der var
 * altsa ingen vej til at markere en raekke uden at aabne den.
 *
 * Kun piletaster maa gore det. Bogstaver hoerer til "begynd bare at skrive",
 * som er appens signatur (DESIGN.md §2) - ville j og k ogsa fange listen,
 * kunne man ikke laengere fange en opgave, der begynder med dem.
 */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  // Er man allerede inde i listen, klarer raekkens egen handler det.
  if (el && el.closest && el.closest('[data-keynav]')) return;

  const raekker = document.querySelectorAll('[data-keynav] .item-row');
  if (!raekker.length) return;
  e.preventDefault();
  (e.key === 'ArrowDown' ? raekker[0] : raekker[raekker.length - 1]).focus();
});

function naboRaekke(el, retning) {
  const alle = [...document.querySelectorAll('.item-row')];
  const i = alle.indexOf(el);
  return alle[i + retning] || alle[retning > 0 ? 0 : alle.length - 1];
}

async function raekkeTaster(e) {
  const el = e.currentTarget;
  const id = el.dataset.id;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  /*
   * Har RAEKKEN taget tasten, maa ingen anden ogsaa faa den.
   *
   * `preventDefault()` alene stopper ikke boblingen op til dokumentets
   * "begynd bare at skrive"-handler. Den har sit eget vaern (den traekker sig,
   * naar fokus staar inde i et [data-keynav]), men fra v27 fjerner en
   * statusaendring raekken MED DET SAMME - altsaa inde i denne handler - saa
   * fokus er faldet tilbage til siden, foer haendelsen naar derop. Vaernet saa
   * ingen liste, og "s" flyttede baade opgaven til Someday OG aabnede
   * paletten med et "s".
   *
   * Derfor stopper vi udbredelsen her: den, der har handlet paa tasten, ejer
   * den. Det er ikke en lappeloesning oven paa vaernet - det er den rigtige
   * ende at goere det i.
   */
  const mit = () => { e.preventDefault(); e.stopPropagation(); };

  if (e.key === 'ArrowDown' || e.key === 'j') { mit(); naboRaekke(el, 1).focus(); return; }
  if (e.key === 'ArrowUp' || e.key === 'k') { mit(); naboRaekke(el, -1).focus(); return; }
  // Ud af listen igen - sa ejer "begynd bare at skrive" bogstaverne pa ny.
  if (e.key === 'Escape') { mit(); el.blur(); return; }
  if (e.key === 'Enter') {
    mit();
    const it = state.items.find((x) => x.id === id);
    if (it) aabnElement(it);
    return;
  }

  // Naeste element far fokus, FOER raekken forsvinder ud af listen.
  const naeste = naboRaekke(el, 1);
  const husk = () => { sideState.fokusId = naeste && naeste.dataset.id !== id ? naeste.dataset.id : null; };

  if (e.key === ' ') {
    mit();
    const emne = state.items.find((x) => x.id === id);
    if (emne && emne.kind === 'note') return;   // en note kan ikke udfoeres
    husk();
    await fuldfoer(id);
    return;
  }
  const statusTaster = { n: 'next', w: 'waiting', s: 'someday' };
  if (statusTaster[e.key]) {
    mit();
    husk();
    await saetStatus(id, statusTaster[e.key]);
    return;
  }
  if (e.key === 'x') {
    mit();
    husk();
    await slet(id);
    return;
  }

  // Kontekst og projekt skal ogsaa kunne saettes uden mus (handover §7).
  // De aabner en lille vaelger i stedet for at gaette pa et navn.
  if (e.key === 'c' || e.key === 'p') {
    mit();
    const it = state.items.find((x) => x.id === id);
    if (it) vaelgHurtigt(it, e.key === 'c' ? 'context' : 'project');
  }
}

/**
 * Lille vaelger til tastaturafklaringen. Piletaster og Enter - og den
 * lukker sig selv, saa fokus kan gaa tilbage til raekken.
 */
function vaelgHurtigt(it, hvad) {
  const kilde = hvad === 'context' ? state.contexts : state.projects;
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" style="max-width:420px">
    <h2>${hvad === 'context' ? 'Set a context' : 'Set a project'}</h2>
    <p class="lead" style="margin:6px 0 14px">${esc(it.title)}</p>
    ${kilde.length ? `<select class="input" id="qkSel" size="${Math.min(kilde.length + 1, 8)}">
      <option value="">${hvad === 'context' ? '— remove all contexts —' : '— no project —'}</option>
      ${kilde.map((x) => `<option value="${esc(x.id)}">${hvad === 'context' ? '#' : ''}${esc(x.name)}</option>`).join('')}
    </select>` : `<p class="lead">No ${hvad === 'context' ? 'contexts' : 'projects'} yet — type
      ${hvad === 'context' ? '<code>#name</code>' : '<code>@Name</code>'} when you capture.</p>`}
    <div class="modal-foot"><span style="flex:1"></span>
      <button class="btn" id="qkCancel">Cancel</button>
      ${kilde.length ? '<button class="btn primary" id="qkOk">Set</button>' : ''}</div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => { host.remove(); const r = document.querySelector(`.item-row[data-id="${CSS.escape(it.id)}"]`); if (r) r.focus(); };
  host.querySelector('#qkCancel').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const sel = host.querySelector('#qkSel');
  if (!sel) return;
  sel.focus();
  const gem = async () => {
    const v = sel.value;
    try {
      await api('POST', `/api/v1/items/${it.id}`,
        hvad === 'context' ? { contexts: v ? [v] : [] } : { project_id: v || null });
      luk();
      await genindlaes();
      tegnSide();
      toast('Saved');
    } catch (ex) { toast(ex.message); }
  };
  host.querySelector('#qkOk').addEventListener('click', gem);
  sel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gem(); } });
  sel.addEventListener('dblclick', gem);
}

/**
 * Uden net laegges handlingen i koen i stedet for at fejle.
 *
 * Det er sikkert, fordi en opgave, man opretter offline, er USYNLIG indtil
 * den er sendt - koen gemmer kun teksten. Man kan derfor aldrig komme til at
 * koee en handling mod et id, serveren ikke kender.
 */
function offlineKoe(ex, post, besked) {
  if (!erNetvaerksfejl(ex)) { toast(ex.message); return; }
  laegIKoe(post);
  // IKKE tegnSide(): den henter fra serveren, og uden net (eller uden en
  // service worker-cache at falde tilbage paa) ville listen blive erstattet
  // af en fejlside. Man ville tikke af og se skaermen forsvinde. Raekken
  // afhaenger kun af elementet og koen, saa den kan gentegnes alene.
  gentegnRaekke(post.item);
  toast(`${besked} — waiting for a connection`);
}

/** Tegner én raekke om ud fra state - uden at spoerge serveren. */
function gentegnRaekke(id) {
  const el = document.querySelector(`.item-row[data-id="${CSS.escape(id)}"]`);
  const it = state.items.find((x) => x.id === id);
  if (!el || !it) return;
  el.outerHTML = elementRaekke(it, Number(el.dataset.i) || 0);
  bindListe();
}

/* --------------------------------------------- afklaring uden ventetid */

/*
 * Et tastetryk skal flytte raekken MED DET SAMME.
 *
 * Foer v27 ventede `n` paa tre rundture i traek, foer noget rykkede sig:
 * POST'en, `/state` og listen. Lokalt er det 24 ms og usynligt - men paa en
 * telefon gennem en tunnel er hver rundtur et par hundrede millisekunder, og
 * saa sidder man og trykker paa en tast, der tilsyneladende ikke virker.
 * Serveren er ikke langsom (den svarer paa under et millisekund); det er
 * ventetiden, der er lagt foran brugeren i stedet for bag ham.
 *
 * Derfor: fjern raekken af state og tegn listen om af state ALENE, send saa.
 * Lykkes det, opfriskes tal og liste stille i baggrunden. Gaar det galt,
 * saettes raekken tilbage, foer den almindelige fejl/offline-haandtering
 * loeber - saa kan `offlineKoe` gentegne raekken, som den plejer.
 */
const VIEW_STATUS = { inbox: 'inbox', next: 'next', waiting: 'waiting', someday: 'someday' };
const VIEW_TITEL = { waiting: 'Waiting For', someday: 'Someday' };

/** Tegner den aktuelle liste ud fra state, uden at spoerge serveren. */
function tegnListeFraState() {
  const host = document.getElementById('pageHost');
  if (!host) return false;
  if (state.view === 'inbox') host.innerHTML = sideInbox();
  else if (state.view === 'next') host.innerHTML = sideNext();
  else if (VIEW_TITEL[state.view]) { tegnStatusliste(state.view, VIEW_TITEL[state.view]); return true; }
  else return false;
  bindListe();          // genskaber ogsaa fokus via sideState.fokusId
  return true;
}

/**
 * Tager raekken ud af listen med det samme. Returnerer en fortryd-funktion,
 * eller null hvis skaermen ikke er én, vi kan tegne af state alene.
 */
function straksVaek(id) {
  if (!VIEW_STATUS[state.view]) return null;
  const i = state.items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [emne] = state.items.splice(i, 1);
  if (!tegnListeFraState()) { state.items.splice(i, 0, emne); return null; }
  return () => { state.items.splice(i, 0, emne); tegnListeFraState(); };
}

/**
 * Saetter et NYT element ind i listen med det samme, hvis det hoerer hjemme
 * paa den skaerm, man staar paa. Svaret fra /capture indeholder allerede hele
 * elementet, saa der er intet at hente igen - det var kun raekkefoelgen af
 * kald, der gjorde, at man sad og ventede paa sin egen opgave.
 *
 * Sorteringen kan vaere en anelse forkert, indtil den stille opfriskning
 * lander: bedre end at stirre paa en liste, hvor der ingenting skete.
 */
function indsaetStraks(it) {
  if (!it || VIEW_STATUS[state.view] !== it.status) return false;
  // "Skjul indtil" betyder skjult - ogsaa for det, man lige har skrevet.
  if (state.view === 'next' && it.defer_date && it.defer_date > state.today) return false;
  state.items.push(it);
  if (!tegnListeFraState()) { state.items.pop(); return false; }
  // Tallet i sidebaren skal ogsaa flytte sig nu, ikke om et sekund.
  const n = VIEW_STATUS[state.view];
  state.counts[n] = (state.counts[n] || 0) + 1;
  opdaterNav();
  return true;
}

/** Tal og liste hentes bagefter - stille, saa siden ikke blinker. */
function opfriskBagefter() {
  synk(false);
}

async function fuldfoer(id) {
  const it = state.items.find((x) => x.id === id);
  const fortryd = straksVaek(id);
  try {
    await api('POST', `/api/v1/items/${id}/complete`, {});
    if (!fortryd) await genindlaes();
    toast(`Done: ${it ? it.title : 'item'}`, {
      label: 'Undo',
      run: async () => { await api('POST', `/api/v1/items/${id}/uncomplete`, {}); await genindlaes(); },
    });
    if (fortryd) opfriskBagefter();
  } catch (ex) {
    if (fortryd) fortryd();
    offlineKoe(ex, { type: 'complete', item: id, titel: it ? it.title : '' },
      `Done: ${it ? it.title : 'item'}`);
  }
}

async function saetStatus(id, status) {
  const it = state.items.find((x) => x.id === id);
  // Bliver elementet paa skaermen (fx "n" paa noget, der allerede er next),
  // er der intet at fjerne - saa gaar den ad den gamle vej.
  const fortryd = VIEW_STATUS[state.view] === status ? null : straksVaek(id);
  try {
    await api('POST', `/api/v1/items/${id}`, { status });
    if (!fortryd) await genindlaes();
    toast(`Moved to ${statusNavn(status)}`);
    if (fortryd) opfriskBagefter();
  } catch (ex) {
    if (fortryd) fortryd();
    offlineKoe(ex, { type: 'status', item: id, status, titel: it ? it.title : '' },
      `Moved to ${statusNavn(status)}`);
  }
}

async function slet(id) {
  const it = state.items.find((x) => x.id === id);
  try {
    await api('DELETE', `/api/v1/items/${id}`, {});
    await genindlaes();
    toast('Deleted');
  } catch (ex) {
    offlineKoe(ex, { type: 'delete', item: id, titel: it ? it.title : '' }, 'Deleted');
  }
}

/* --------------------------------------------- genvejssyntaks i titlen */

/**
 * Tolker genvejssyntaks i en titel, man REDIGERER, og skriver resultatet ind
 * i udkastet. Returnerer den nye titel, eller null hvis intet blev fundet.
 *
 * Forskellen fra fangst er, at teksten allerede findes: derfor fjernes KUN
 * det, der faktisk kunne tolkes. "Husk !vigtigt" er en gyldig titel, og
 * parseren spiser ellers `!vigtigt` og noejes med en advarsel - i paletten
 * ser man chippen med det samme, men i en titel man retter, ville det vaere
 * tavst datatab.
 *
 * Navne, der ikke findes endnu, oprettes ikke her. De staar i udkastet som
 * `nytProjekt`/`nyeKontekster` og bliver foerst til noget ved Save - ruden
 * ma ikke aendre noget bag om et Cancel.
 *
 * `kunNavne` tager KUN @projekt og #kontekst og lader al `!`-tekst staa.
 * Gentagelses-ruden bruger det: den har sit eget regelfelt, saa en dato eller
 * en regel i titlen dér hverken kan eller skal lande noget sted - og en
 * parser, der spiste teksten alligevel, ville vaere tavst datatab.
 */
function anvendSyntaks(u, raa, kunNavne) {
  const p = (typeof dodaParse !== 'undefined') ? dodaParse : null;
  if (!p || !raa || !raa.trim()) return null;
  const r = p.tolkFangst(raa);
  let fandt = false;
  let titel = raa;

  const findProjekt = (navn) => state.projects.find((x) => x.name.toLowerCase() === navn.toLowerCase());
  const findKontekst = (navn) => state.contexts.find((x) => x.name.toLowerCase() === navn.toLowerCase());

  if (r.project) {
    const fundet = findProjekt(r.project);
    if (fundet) { u.project_id = fundet.id; u.nytProjekt = null; }
    else { u.project_id = null; u.nytProjekt = r.project; }
    titel = p.fjernMarkoer(titel, '@/', r.project);
    fandt = true;
  }
  for (const navn of r.contexts) {
    const fundet = findKontekst(navn);
    if (fundet) { if (!u.contexts.includes(fundet.id)) u.contexts.push(fundet.id); }
    else if (!u.nyeKontekster.some((n) => n.toLowerCase() === navn.toLowerCase())) u.nyeKontekster.push(navn);
    titel = p.fjernMarkoer(titel, '#', navn);
    fandt = true;
  }

  // Datoerne tages kun, naar ALT kunne tolkes. Er der en advarsel, staar der
  // en `!`-tekst tilbage, parseren ikke forstod - og saa skal titlen blive,
  // som brugeren skrev den.
  if (!kunNavne && !r.warnings.length) {
    if (r.due) { u.due_date = r.due.dato; u.due_time = r.due.tid || null; titel = r.title; fandt = true; }
    if (r.defer) { u.defer_date = r.defer; titel = r.title; fandt = true; }
  }

  if (!fandt) return null;
  return titel.replace(/\s{2,}/g, ' ').trim() || raa.trim();
}

/* ------------------------------------------------------ detaljeruden */

/* ------------------------------------------------------- detaljeruden */

/*
 * Layoutet foelger tingdo: titlen er en overskrift med en afkrydsningsring,
 * beskrivelsen star lige under som "Add details…", og felterne er CHIPS man
 * trykker pa - ikke en formular med etiketter.
 *
 * Pointen er, at intet er paakraevet. En opgave med bare en titel skal se
 * faerdig ud, ikke som en halvudfyldt blanket.
 */
async function aabnElement(listeItem) {
  // Listen baerer KUN et antal vedhaeftninger, aldrig metadataene - det er
  // hele pointen med §4-lektien. Ruden skal derfor hente det fulde element.
  let it = listeItem;
  if (listeItem.attachment_count && !listeItem.attachments) {
    try { it = (await api('GET', `/api/v1/items/${listeItem.id}`)).item; }
    catch { it = Object.assign({ attachments: [] }, listeItem); }
  } else if (!it.attachments) {
    it = Object.assign({ attachments: [] }, listeItem);
  }

  // Alt redigeres i et udkast og gemmes foerst ved Save - sa et fejlklik pa
  // en chip ikke aendrer noget bag om brugeren.
  const u = {
    title: it.title,
    note: it.note,
    status: it.status,
    project_id: it.project_id,
    due_date: it.due_date,
    due_time: it.due_time,
    defer_date: it.defer_date,
    contexts: it.contexts.map((c) => c.id),
    // Navne fra genvejssyntaksen, der ikke findes endnu. De oprettes foerst
    // ved Save - ruden ma ikke aendre noget bag om et Cancel.
    nytProjekt: null,
    nyeKontekster: [],
    // Siden sagen egentlig lever paa - fx en Notion-side.
    link_url: it.link_url || null,
    link_title: it.link_title || null,
  };

  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card detail" role="dialog" aria-modal="true" aria-label="Edit item">
    <div class="detail-head">
      ${it.kind === 'task' ? `<button class="tick big${u.status === 'done' ? ' on' : ''}" id="dTick"
        aria-label="Mark done" title="Mark done"></button>` : `<span class="detail-noteicon">${icon('note', 22)}</span>`}
      <textarea class="detail-title" id="dTitle" rows="1" placeholder="Title"
        aria-label="Title" spellcheck="false">${esc(u.title)}</textarea>
      <button class="detail-close" id="dClose" aria-label="Close">×</button>
    </div>

    <textarea class="detail-note" id="dNote" rows="1"
      placeholder="Add details…" aria-label="Details">${esc(u.note)}</textarea>
    <div class="note-preview" id="dPreview" hidden></div>
    <div class="chiprow" id="dChips"></div>

    <div class="detail-help" id="dHelp" hidden>
      <div class="meta">Getting started</div>
      <h2>What you can set here</h2>
      <p class="lead">Tap a chip to change it. Nothing here is <strong>required</strong>.</p>
      <dl class="helplist">
        <dt><span class="chip flat">no project</span></dt>
        <dd><strong>The outcome this task belongs to.</strong> Anything that takes more than one step is a project.</dd>
        <dt><span class="chip flat">inbox</span></dt>
        <dd><strong>Where this task goes next.</strong> Next Actions when you can do it,
          Waiting For when it is with someone else, Someday when it can wait.</dd>
        <dt><span class="chip flat">no date</span></dt>
        <dd><strong>The day it shows up in Next Actions.</strong> It stays out of your way
          until then, and nothing is ever marked late.</dd>
        <dt><span class="helphash">#</span></dt>
        <dd><strong>Context.</strong> Where or with what you get things done: #home, #computer,
          #calls. Type <code>#name</code> in the title to add one.</dd>
        <dt><span class="helphash">/</span></dt>
        <dd><strong>The same shortcuts work here as when you capture.</strong>
          <code>/project</code> or <code>@project</code> files it, <code>#context</code> adds one,
          <code>!friday</code> sets the date. The marker disappears from the title and turns
          into a chip — and anything doda cannot read is left exactly as you typed it.</dd>
        <dt><span class="meta">Focus</span></dt>
        <dd><strong>Everything else out of the way.</strong> This task on a screen of its own,
          with a timer that keeps running.</dd>
      </dl>
      <button class="btn primary" id="dGotIt">Got it</button>
    </div>

    <div id="dNotion"></div>

    ${vedhaeftningerHtml(it)}

    <div class="modal-foot">
      <button class="btn ghost" id="edDelete">Delete</button>
      ${it.kind === 'note' || state.notesEnabled
    ? `<button class="btn ghost" id="edConvert">${it.kind === 'note' ? 'Make it a task' : 'Make it a note'}</button>`
    : ''}
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
  host.querySelector('#dClose').addEventListener('click', luk);
  host.querySelector('#edCancel').addEventListener('click', luk);

  /* --- chips ---------------------------------------------------- */

  const visDatoKort = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const tegnChipsRow = () => {
    const projekt = u.nytProjekt || (u.project_id ? (state.projects.find((p) => p.id === u.project_id) || {}).name : null);
    const kontekster = state.contexts.filter((c) => u.contexts.includes(c.id));
    // Nye navne vises som chips med det samme, saa man kan se hvad Save laver.
    const nye = u.nyeKontekster.map((n) => `<span class="chip">#${esc(n)}</span>`).join('');
    host.querySelector('#dChips').innerHTML = `
      <button class="chip flat" data-edit="project">${esc(projekt || 'no project')}</button>
      <button class="chip flat" data-edit="status">${esc(statusNavn(u.status))}</button>
      <button class="chip flat${u.due_date ? ' set' : ''}" data-edit="due">${esc(visDatoKort(u.due_date) || 'no date')}</button>
      ${u.defer_date ? `<button class="chip flat set" data-edit="defer">hidden until ${esc(visDatoKort(u.defer_date))}</button>`
    : '<button class="chip flat" data-edit="defer">no hide-until</button>'}
      ${kontekster.map((c) => `<button class="chip" data-ctx="${esc(c.id)}">#${esc(c.name)}</button>`).join('')}${nye}
      <button class="chip flat" data-edit="contexts">${kontekster.length ? '+' : '# context'}</button>
      ${u.link_url
    ? `<a class="chip link" href="${esc(u.link_url)}" target="_blank" rel="noopener noreferrer"
         title="${esc(u.link_url)}">${icon('link', 13)} ${esc(linkNavn(u))}</a>
       <button class="chip flat" data-edit="link">edit link</button>`
    : '<button class="chip flat" data-edit="link">+ link</button>'}
      <span style="flex:1"></span>
      ${it.kind === 'task' && u.status !== 'done' ? `<button class="chip flat" id="dFocus">${icon('clock', 13)} Focus</button>` : ''}
      <button class="chip flat" id="dHelpBtn" aria-label="What is this?">?</button>`;
    bindChips();
  };

  /** Bytter en chip ud med det rigtige felt, og tilbage igen naar man er faerdig. */
  const redigerInline = (knap, felt) => {
    const el = document.createElement(felt.tag);
    el.className = 'chipedit';
    if (felt.tag === 'input') { el.type = 'date'; el.value = felt.value || ''; }
    else el.innerHTML = felt.options;
    knap.replaceWith(el);
    el.focus();
    if (el.showPicker) { try { el.showPicker(); } catch { /* ikke alle browsere */ } }
    const faerdig = () => { felt.onchange(el.value); tegnChipsRow(); };
    el.addEventListener('change', faerdig);
    el.addEventListener('blur', () => setTimeout(tegnChipsRow, 120));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); faerdig(); } });
  };

  function bindChips() {
    host.querySelectorAll('[data-edit]').forEach((knap) => {
      knap.addEventListener('click', () => {
        const hvad = knap.dataset.edit;
        if (hvad === 'project') {
          redigerInline(knap, {
            tag: 'select',
            options: `<option value="">— no project —</option>${state.projects.map((p) =>
              `<option value="${esc(p.id)}"${p.id === u.project_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`,
            onchange: (v) => { u.project_id = v || null; u.nytProjekt = null; },
          });
        } else if (hvad === 'status') {
          redigerInline(knap, {
            tag: 'select',
            /* 'queued' staar IKKE her. Den er dodas interne hvileplads for
               noter (og for opgaver, der vaekkes med et genaabnet projekt) og
               har ingen skaerm - en opgave sat dertil forsvandt fra Inbox,
               Next, Waiting, Someday OG logbogen og kunne kun soeges frem.
               Vil man parkere noget, hedder det Someday. Findes den paa et
               element i forvejen, vises den stadig, saa man kan komme VAEK
               fra den. */
            options: ['inbox', 'next', 'waiting', 'someday', 'done', 'dropped']
              .concat(u.status === 'queued' ? ['queued'] : []).map((s) =>
              `<option value="${s}"${s === u.status ? ' selected' : ''}>${esc(statusNavn(s))}</option>`).join(''),
            onchange: (v) => { u.status = v; },
          });
        } else if (hvad === 'due' || hvad === 'defer') {
          redigerInline(knap, {
            tag: 'input',
            value: hvad === 'due' ? u.due_date : u.defer_date,
            onchange: (v) => { if (hvad === 'due') u.due_date = v || null; else u.defer_date = v || null; },
          });
        } else if (hvad === 'link') {
          // Et link skrives, ikke vaelges - derfor en lille dialog og ikke
          // chip-vaelgeren.
          spoergOmLink(u, tegnChipsRow, u.title);
        } else {
          redigerInline(knap, {
            tag: 'select',
            options: `<option value="">— add a context —</option>${state.contexts
              .filter((c) => !u.contexts.includes(c.id))
              .map((c) => `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}`,
            onchange: (v) => { if (v) u.contexts.push(v); },
          });
        }
      });
    });
    // Klik pa en kontekst-chip fjerner den igen.
    host.querySelectorAll('[data-ctx]').forEach((el) => {
      el.addEventListener('click', () => {
        u.contexts = u.contexts.filter((x) => x !== el.dataset.ctx);
        tegnChipsRow();
      });
    });
    const f = host.querySelector('#dFocus');
    if (f) f.addEventListener('click', () => { luk(); startFokus(it); gaaTil('focus'); });
    host.querySelector('#dHelpBtn').addEventListener('click', () => {
      const h = host.querySelector('#dHelp');
      h.hidden = !h.hidden;
    });
  }
  tegnChipsRow();

  // Forklaringen vises, indtil den er set én gang - som i tingdo.
  try {
    if (!localStorage.getItem('doda_help_detail')) host.querySelector('#dHelp').hidden = false;
  } catch { /* privat tilstand */ }
  host.querySelector('#dGotIt').addEventListener('click', () => {
    host.querySelector('#dHelp').hidden = true;
    try { localStorage.setItem('doda_help_detail', '1'); } catch { /* ligegyldigt */ }
  });

  /* --- titel, beskrivelse, afkrydsning --------------------------- */

  // Er linket en Notion-side, tjekkes titlen stille i baggrunden - hoejst
  // én gang i doegnet pr. link, det klarer serveren. Fejler det, sker der
  // ingenting: en gammel titel er bedre end en fejlbesked om en titel.
  friskLinkTitel('item', it.id, u, () => tegnChipsRow());
  linkRude(host.querySelector('#dNotion'), u);

  const titelEl = host.querySelector('#dTitle');
  const noteEl = host.querySelector('#dNote');
  const preview = host.querySelector('#dPreview');

  /*
   * Titlen er et flerlinjet felt, saa en lang titel kan LAESES i sin helhed.
   * Som `input` kunne man kun se et vindue af den og skulle rulle sidelaens
   * for at finde ud af, hvad opgaven hed.
   *
   * Men den er stadig ÉN linje logisk set: et linjeskift ville blive gemt i
   * titlen, og parseren laeser alt efter det foerste linjeskift som
   * beskrivelse. Derfor spaerres Enter, og indsat tekst renses.
   */
  const voksTitel = () => {
    titelEl.style.height = 'auto';
    titelEl.style.height = `${titelEl.scrollHeight}px`;
  };
  voksTitel();
  titelEl.addEventListener('input', () => {
    if (titelEl.value.includes('\n')) {
      const pos = titelEl.selectionStart;
      titelEl.value = titelEl.value.replace(/\s*\n+\s*/g, ' ');
      titelEl.setSelectionRange(pos, pos);
    }
    u.title = titelEl.value;
    voksTitel();
  });
  titelEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return;   // cmd+enter gemmer
    e.preventDefault();
    titelEl.blur();      // saa koerer genvejssyntaksen, som den plejer
  });

  // Genvejssyntaksen skal virke HER ogsaa. Hjaelpeteksten i ruden lover
  // allerede "type # in the title to add one", og efter v4 lover paletten
  // baade @ og / for projekter - men titlen blev gemt raat.
  //
  // Tolkningen sker ved blur (og dermed ogsaa naar man klikker Save, som
  // blurrer feltet foerst): sa naar man at se markoeren forsvinde og chippen
  // dukke op, foer noget gemmes.
  titelEl.addEventListener('blur', () => {
    const ny = anvendSyntaks(u, titelEl.value);
    if (ny === null) return;
    titelEl.value = ny;
    u.title = ny;
    voksTitel();
    tegnChipsRow();
  });

  // Feltet vokser med teksten - en fast hoejde ville enten spilde plads
  // eller klemme en lang note sammen.
  const voks = () => { noteEl.style.height = 'auto'; noteEl.style.height = `${Math.max(noteEl.scrollHeight, 28)}px`; };
  /*
   * Feltet og previewet er TO udgaver af den samme note, saa der maa kun vaere
   * én af dem fremme. Foer skjulte vi kun previewet, naar feltet havde fokus -
   * men feltet blev aldrig skjult, og uden fokus stod noten derfor to gange:
   * raa i tekstfeltet og renderet nedenunder. Med en lang adresse i noten
   * fyldte kilden mere end selve opgaven.
   *
   * Nu: har noten indhold, og redigerer man den ikke, ser man den faerdige
   * udgave. Et klik paa den bringer feltet tilbage - undtagen paa et link,
   * som skal kunne foelges.
   */
  const tegnPreview = () => {
    const v = noteEl.value.trim();
    const vis = !!v && document.activeElement !== noteEl;
    preview.hidden = !vis;
    preview.innerHTML = v ? markdown(v) : '';
    noteEl.hidden = vis;
  };
  noteEl.addEventListener('input', () => { u.note = noteEl.value; voks(); });
  noteEl.addEventListener('focus', tegnPreview);
  noteEl.addEventListener('blur', tegnPreview);
  preview.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    // Feltet skal vaere synligt, foer det kan faa fokus - og scrollHeight er 0,
    // saa laenge det er skjult, saa hoejden maales foerst bagefter.
    noteEl.hidden = false;
    noteEl.focus();
    noteEl.setSelectionRange(noteEl.value.length, noteEl.value.length);
    voks();
  });
  voks();
  tegnPreview();

  const tick = host.querySelector('#dTick');
  if (tick) {
    tick.addEventListener('click', () => {
      u.status = u.status === 'done' ? 'next' : 'done';
      tick.classList.toggle('on', u.status === 'done');
      tegnChipsRow();
    });
  }

  /* --- gem, slet, konvertér -------------------------------------- */

  /**
   * Opretter de navne fra genvejssyntaksen, der ikke fandtes i forvejen.
   * Sker FOERST her - et Cancel maa ikke efterlade et tomt projekt.
   * Endepunkterne er idempotente pa navnet, sa to hurtige klik er ufarlige.
   */
  const opretNyeNavne = async () => {
    if (u.nytProjekt) {
      const svar = await api('POST', '/api/v1/projects', { name: u.nytProjekt });
      if (svar.project) { u.project_id = svar.project.id; u.nytProjekt = null; }
    }
    for (const navn of u.nyeKontekster.slice()) {
      const svar = await api('POST', '/api/v1/contexts', { name: navn });
      if (svar.context && !u.contexts.includes(svar.context.id)) u.contexts.push(svar.context.id);
    }
    u.nyeKontekster = [];
  };

  const gem = async (ekstra) => api('POST', `/api/v1/items/${it.id}`, Object.assign({
    title: u.title,
    note: u.note,
    status: u.status,
    project_id: u.project_id,
    due_date: u.due_date,
    due_time: u.due_time,
    defer_date: u.defer_date,
    contexts: u.contexts,
    link_url: u.link_url,
    link_title: u.link_title,
  }, ekstra || {}));

  bindGemGenvej(host, host.querySelector('#edSave'));
  host.querySelector('#edSave').addEventListener('click', async () => {
    // Klikkes der paa Save uden at forlade titelfeltet foerst, naar blur
    // ikke at koere. Tolk derfor ogsaa her - ellers gemmes "/doda" som tekst.
    const nyTitel = anvendSyntaks(u, titelEl.value);
    if (nyTitel !== null) { u.title = nyTitel; titelEl.value = nyTitel; }

    // Hoerer elementet til en gentagelse, skal brugeren tage stilling:
    // gaelder aendringen kun denne gang, eller alle fremtidige? (handover §5.6)
    let tilSerien = false;
    if (it.recurrence_id) {
      const svar = await spoergOmSerie(it.title);
      if (svar === null) return;
      tilSerien = svar;
    }
    try {
      await opretNyeNavne();
      await gem({ applyToSeries: tilSerien });
      luk();
      await genindlaes();
      tegnSide();
      toast('Saved');
    } catch (ex) { toast(ex.message); }
  });

  host.querySelector('#edDelete').addEventListener('click', async () => { luk(); await slet(it.id); });

  // Konvertering ma ALDRIG miste indhold: bade titel og beskrivelse foelger
  // med begge veje (handover §5.5). En note er reference og skal derfor ud af
  // handlingslisterne - den far status "queued", ikke "inbox".
  const konverter = host.querySelector('#edConvert');
  if (konverter) konverter.addEventListener('click', async () => {
    const tilNote = it.kind !== 'note';
    try {
      await gem({ kind: tilNote ? 'note' : 'task', status: tilNote ? 'queued' : (u.status === 'queued' ? 'inbox' : u.status) });
      luk();
      await genindlaes();
      tegnSide();
      toast(tilNote ? 'Converted to a note' : 'Converted to a task');
    } catch (ex) { toast(ex.message); }
  });

  // Efter upload eller sletning gentegnes KUN fillisten - brugerens ugemte
  // rettelser i titel og beskrivelse skal ikke gaa tabt.
  const genhentFiler = async () => {
    const frisk = (await api('GET', `/api/v1/items/${it.id}`)).item;
    it.attachments = frisk.attachments || [];
    host.querySelector('#fileList').innerHTML = it.attachments.map(filKort).join('');
    bindVedhaeftninger(host, it, genhentFiler);
    await genindlaes();
  };
  bindVedhaeftninger(host, it, genhentFiler);

  titelEl.focus();
  titelEl.setSelectionRange(titelEl.value.length, titelEl.value.length);
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
      ${syntaksTabel()}
      <p class="gate-note" style="text-align:left">Danish words work too: <code>!i morgen</code>, <code>!om 2 uger</code>.</p>
    </div>

    <div class="card"><h2>Notes</h2>
      <p class="lead" style="margin:6px 0 0">Keep your reference material somewhere else —
      Notion, say? Then doda's notes are one place too many. Turning them off hides the
      Notes screen, the <code>*</code> shortcut and <em>Make it a note</em>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn ${state.notesEnabled ? 'primary' : ''}" data-notes="on">Notes on</button>
        <button class="btn ${state.notesEnabled ? '' : 'primary'}" data-notes="off">Notes off</button>
      </div>
      <p class="gate-note" style="text-align:left">${state.noteCount
    ? `You have <strong>${state.noteCount} note${state.noteCount === 1 ? '' : 's'}</strong>. They are kept either way — they still show on their project and in search, and a single note can still be turned into a task.`
    : 'Nothing is deleted either way: this only hides the ways in.'}</p>
    </div>

    <div class="card"><h2>Passkeys</h2>
      <p class="lead" style="margin:6px 0 0">Sign in with Touch ID, Face ID or a security
      key instead of typing your password.</p>
      <div id="pkList" class="keylist">Loading…</div>
      <p class="gate-note" style="text-align:left"><strong>Your password always keeps
      working.</strong> The panel is reached over plain http on <code>IP:port</code>,
      where passkeys do not exist at all — so doda never lets one replace it.</p>
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

    <div class="card"><h2>Connected apps</h2>
      <p class="lead" style="margin:6px 0 0">Apps that asked for access themselves and
      that you approved — claude.ai connects this way. Revoking one stops it immediately;
      it has to ask you again.</p>
      <div id="connList" class="keylist">Loading…</div>
      <p class="gate-note" style="text-align:left">Add doda in Claude as a custom
      connector with the address <code>${esc(location.origin)}/mcp</code>. Claude finds
      the rest by itself and sends you here to approve it.</p>
    </div>

    <div class="card"><h2>Sagu</h2>
      <p class="lead" style="margin:6px 0 0">Sagu is the sister app where the notes live.
      Connect it, and you can search your notes when you link one to a task — or create a
      note in the right notebook without leaving doda. The two are tied together with
      <strong>links</strong>: nothing is synchronised, so neither can quietly overwrite
      the other.</p>
      <div id="saguBox">Loading…</div>
      <p class="gate-note" style="text-align:left">In Sagu: Settings → Access keys →
      create a <strong>link</strong> key. That one can search and create notes — and
      <strong>not delete anything</strong>. The key stays on this server and is never
      sent back to this browser.</p>
    </div>

    <div class="card"><h2>Notion</h2>
      <p class="lead" style="margin:6px 0 0">Connect Notion, and you can search your
      pages from inside doda when you link one to a task — and the chip gets the page's
      real title instead of a row of hex.</p>
      <div id="notionBox">Loading…</div>
      <p class="gate-note" style="text-align:left">Create an <strong>internal
      integration</strong> at notion.so/my-integrations, copy its secret, and paste it
      here. <strong>Notion only lets an integration see pages you share with it</strong> —
      open a page, ⋯ → Connections → add yours. Sharing a parent page covers everything
      under it. The token stays on the server and is never sent back to this browser.</p>
    </div>

    <div class="card"><h2>Notifications</h2>
      <p class="lead" style="margin:6px 0 0">A push notification when a task with a
      <strong>time</strong> comes due — also when doda is closed. The push itself is
      empty: your phone asks doda what to show, so the push service never learns what
      your tasks are called.</p>
      <div id="pushBox">Loading…</div>
      <p class="gate-note" style="text-align:left">If you already subscribe with your
      calendar, you do not need this — that reminder works without any permission at all.</p>
    </div>

    <div class="card"><h2>Calendar subscription</h2>
      <p class="lead" style="margin:6px 0 12px">A feed your calendar app can follow.
      It contains <strong>only real deadlines</strong> — never your whole task list.
      The address is the secret; revoking it stops the old one immediately.</p>
      <div id="calBox">Loading…</div>
    </div>

    <div class="card"><h2>Your data</h2>
      <p class="lead" style="margin:6px 0 14px">Everything in one open JSON file.
      Export it, wipe the database, import it back, and you have the same system.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="expData">Export data</button>
        <button class="btn" id="expAll">Export with files</button>
        <button class="btn" id="impBtn">Import…</button>
        <button class="btn" id="tdBtn">Import from Todoist…</button>
        <input type="file" id="impFile" accept="application/json,.json" hidden>
      </div>
      <p class="gate-note" style="text-align:left">Import is matched on id, so the same
      file can be run twice without creating duplicates. Large files are sent in
      portions, so nothing is rejected for being too big.</p>
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
      <p class="lead" style="margin:6px 0 14px">Signed in as <strong>${esc(visNavn(state.user.username))}</strong>.</p>
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

/* Samme keyrow-moenster som noeglerne. En forbindelse er bare en noegle, jeg
   ikke selv har skrevet ned - og den skal kunne rives over lige sa let. */
async function tegnForbindelser() {
  const host = document.getElementById('connList');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/connections');
    if (!d.connections.length) {
      host.innerHTML = '<p class="lead" style="margin:14px 0 0">Nothing connected yet.</p>';
      return;
    }
    host.innerHTML = d.connections.map((c) => {
      const aktiv = c.active > 0 || c.refreshes > 0;
      const brugt = c.last_used_at ? `last used ${visTid(c.last_used_at)}` : 'never used';
      return `
      <div class="keyrow">
        <div class="keyrow-main">
          <div class="keyrow-name">${esc(c.name)}</div>
          <div class="meta">${aktiv ? esc(SCOPE_TEKST[c.scope] || c.scope || 'connected') : 'revoked'} ·
            ${esc(brugt)} · added ${visTid(c.created_at)}</div>
        </div>
        ${aktiv ? `<button class="btn ghost" data-conn="${esc(c.id)}">Revoke</button>` : ''}
      </div>`;
    }).join('');
    host.querySelectorAll('[data-conn]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('DELETE', `/api/v1/connections/${el.dataset.conn}`, {});
        toast('Connection revoked — it stopped working immediately');
        tegnForbindelser();
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
  document.querySelectorAll('[data-notes]').forEach((el) => {
    el.addEventListener('click', async () => {
      const fra = el.dataset.notes === 'off';
      await api('POST', '/api/v1/settings', { settings: { notes_off: fra ? '1' : '0' } });
      // Staar man PAA notesiden, naar den slaas fra, skal man ikke blive
      // staaende paa noget, menuen ikke laengere har.
      if (fra && state.view === 'notes') state.view = 'next';
      await genindlaes();
      render();
      gaaTil('settings');
      toast(fra ? 'Notes are off' : 'Notes are on');
    });
  });
  bindNoegler();
  bindData();
  bindPush();
  bindSagu();
  bindNotion();
  tegnPasskeys();
  tegnForbindelser();
  document.querySelectorAll('[data-tema]').forEach((el) => {
    // Knappen i sidebaren skal med - ellers peger den paa det tema, man
    // lige har valgt.
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); opdaterTemaKnap(); tegnSide(); });
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

    ${/*
      * Overskriften skal ikke love en tom kasse.
      *
      * Er Sagu forbundet, laver `*` noten DÉR (§v44), og den haenger paa den
      * opgave, den oprettede - ikke paa projektet. Saa staar der »No notes.
      * Capture one with * text @Navn«, mens netop dét ikke laengere lagde
      * noget her. Er der ingen gamle doda-noter, er hele afsnittet vaek, og i
      * stedet siger opgavelisten sandheden: noterne hænger paa opgaverne.
      */ ''}
    ${d.notes.length ? `
      <h2 class="group meta">Notes <span class="group-count">${d.notes.length}</span></h2>
      <div class="notes">${d.notes.map(noteKort).join('')}</div>`
    : (state.notesEnabled && !saguKlar ? `
      <h2 class="group meta">Notes <span class="group-count">0</span></h2>
      <p class="lead" style="padding:8px 14px">No notes. Capture one with
        <code>* text @${esc(p.name)}</code>.</p>` : '')}
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
/**
 * Feltet, der skriver en kommentar til Sagu.
 *
 * Muligt siden Sagu v8. Knappen hedder »Comment« og ikke »Save«: den sender
 * noget ud i verden, som ikke kan tages tilbage herfra (samme valg som
 * Notion-kommentarerne, doda v34). Feltet ryddes FOERST, naar Sagu har
 * kvitteret - ellers ville teksten vaere vaek, hvis kaldet fejlede.
 */
function bindSaguKommentar(host, o) {
  const felt = host.querySelector('#sgKom');
  const knap = host.querySelector('#sgKomOk');
  const svar = host.querySelector('#sgKomSvar');
  if (!felt || !knap) return;

  const send = async () => {
    const tekst = felt.value.trim();
    if (!tekst) return;
    knap.disabled = true;
    knap.textContent = 'Sending…';
    try {
      const d = await api('POST', '/api/v1/sagu/comment', { url: o.link_url, text: tekst });
      felt.value = '';
      /*
       * Sagus egen linje vises ORDRET. Er moderationskoeen slaaet til, er
       * kommentaren ikke synlig endnu - og det er kun Sagu, der ved det. En
       * paenere formulering herfra ville skjule netop dét.
       */
      svar.textContent = d.message || 'Comment added.';
      tegnSaguKommentarer(host, o, d.comments || []);
    } catch (ex) {
      // Teksten staar der stadig - en fejlet forbindelse maa ikke koste det,
      // man lige har skrevet.
      svar.textContent = ex.message;
    } finally {
      knap.disabled = false;
      knap.textContent = 'Comment';
    }
  };

  knap.addEventListener('click', send);
  // Feltet ligger i detaljeruden, som binder Cmd+Enter til Save. Uden at
  // stoppe tasten ville ét tryk baade sende kommentaren OG lukke ruden
  // (RUNE-ERFARINGER, doda v29/v31/v34).
  felt.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    send();
  });
}

/** Tegner kommentarlisten forfra - efter en ny er kommet til. */
function tegnSaguKommentarer(host, o, liste) {
  const vaert = host.querySelector('.notionkom');
  const html = liste.map((k) => `
    <div class="notionkom-item">
      <div class="meta">${esc(k.author)}${k.guest ? ' · guest' : ''}${
  k.at ? ` · ${esc(visTid(k.at))}` : ''}</div>
      <div>${markdown(k.body)}</div>
    </div>`).join('');
  if (vaert) { vaert.innerHTML = html; return; }
  // Var der ingen kommentarer foer, findes ruden ikke - saa laves den her,
  // hvor "No comments on that note yet." staar.
  const tom = [...host.querySelectorAll('p.lead')].find((el) => /No comments/.test(el.textContent));
  if (tom && html) tom.outerHTML = `<div class="notionkom">${html}</div>`;
}

async function saguRude(host, o) {
  host.innerHTML = `<p class="meta" style="margin-top:18px">In Sagu</p>
    <p class="lead">Loading…</p>`;
  try {
    const d = await api('GET', `/api/v1/sagu/comments?url=${encodeURIComponent(o.link_url)}`);
    const liste = d.comments || [];
    /*
     * Selve noten staar oeverst.
     *
     * Foer viste ruden kun kommentarerne, saa man kunne se, at nogen havde
     * sagt noget om en note, man ikke kunne laese - og maatte skifte app for
     * at finde ud af, hvad sagen var. Det er samme rude som Notions
     * (DESIGN.md §v19); Sagu-halvdelen manglede den bare.
     */
    const tekst = (d.note && d.note.body) ? String(d.note.body).trim() : '';
    host.innerHTML = `<p class="meta" style="margin-top:18px">In Sagu${
  liste.length ? ` · ${liste.length} comment${liste.length === 1 ? '' : 's'}` : ''}</p>
      ${tekst ? `<div class="note-preview saguindhold">${markdown(tekst)}</div>`
    : '<p class="lead">That note is empty.</p>'}
      ${liste.length ? `<div class="notionkom">${liste.map((k) => `
        <div class="notionkom-item">
          <div class="meta">${esc(k.author)}${k.guest ? ' · guest' : ''}${
  k.at ? ` · ${esc(visTid(k.at))}` : ''}</div>
          <div>${markdown(k.body)}</div>
        </div>`).join('')}</div>` : '<p class="lead">No comments on that note yet.</p>'}
      <div class="komskriv">
        <textarea class="input" id="sgKom" rows="2" placeholder="Write a comment…"></textarea>
        <button class="btn" id="sgKomOk">Comment</button>
      </div>
      <p class="gate-note" id="sgKomSvar" style="text-align:left">The comment goes straight
        into the note in Sagu — it cannot be taken back from here.</p>`;
    bindSaguKommentar(host, o);
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
      <input class="input" id="rTitle" value="${esc(r.title)}">
      <p class="hintline meta" style="margin:6px 0 0">Type <code>#context</code> or
        <code>@project</code> here and it moves into the fields below. The rule has its
        own field — it is never read out of the title.</p></label>

    <label class="field"><span>Recurrence rule</span>
      <input class="input" id="rRule" value="${esc(r.rule.text)}"
        placeholder="every monday · every! 3 days · last workday of the month"></label>

    <label class="field"><span>Project</span>
      <select class="input" id="rProject"><option value="">— none —</option>
        ${state.projects.map((p) => `<option value="${esc(p.id)}"${p.id === r.project_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></label>

    <div class="field"><span>Contexts (every future one)</span>
      <div class="chiprow" id="rChips" style="margin-top:6px"></div></div>

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

  /* Kontekster paa skabelonen. Samme chip-moenster som detaljeruden: klik pa
     en chip fjerner den, plus-chippen tilfoejer. Serveren kunne modtage dem
     hele tiden - de manglede bare en vej ind. */
  const valgte = r.contexts.slice();
  // Navne fra titlen, der ikke findes endnu. De oprettes FOERST ved Save -
  // ruden maa ikke aendre noget bag om et Cancel (samme regel som detaljeruden).
  const nyeKontekster = [];
  let nytProjekt = null;

  const tegnKontekster = () => {
    const kendte = state.contexts.filter((c) => valgte.includes(c.id));
    host.querySelector('#rChips').innerHTML = `
      ${kendte.map((c) => `<button class="chip" data-fjern="${esc(c.id)}" title="Remove">#${esc(c.name)}</button>`).join('')}
      ${nyeKontekster.map((n) => `<button class="chip" data-fjernny="${esc(n)}" title="Remove">#${esc(n)} — new</button>`).join('')}
      <button class="chip flat" id="rAddCtx">${kendte.length || nyeKontekster.length ? '+' : '# context'}</button>`;
    host.querySelectorAll('[data-fjern]').forEach((el) => el.addEventListener('click', () => {
      const i = valgte.indexOf(el.dataset.fjern);
      if (i >= 0) valgte.splice(i, 1);
      tegnKontekster();
    }));
    host.querySelectorAll('[data-fjernny]').forEach((el) => el.addEventListener('click', () => {
      const i = nyeKontekster.indexOf(el.dataset.fjernny);
      if (i >= 0) nyeKontekster.splice(i, 1);
      tegnKontekster();
    }));
    host.querySelector('#rAddCtx').addEventListener('click', () => {
      const rest = state.contexts.filter((c) => !valgte.includes(c.id));
      if (!rest.length) { toast('No more contexts — type #name when you capture'); return; }
      const sel = document.createElement('select');
      sel.className = 'chipedit';
      sel.innerHTML = `<option value="">— add a context —</option>${rest.map((c) =>
        `<option value="${esc(c.id)}">#${esc(c.name)}</option>`).join('')}`;
      host.querySelector('#rAddCtx').replaceWith(sel);
      sel.focus();
      sel.addEventListener('change', () => { if (sel.value) valgte.push(sel.value); tegnKontekster(); });
      sel.addEventListener('blur', () => setTimeout(tegnKontekster, 120));
    });
  };
  tegnKontekster();

  /* Et projekt, der ikke findes endnu, skal kunne SES i vaelgeren. Ellers
     forsvinder @navn ud af titlen uden at lande et sted, brugeren kan se -
     og saa lyver ruden om, hvad den lige har gjort. */
  const projektEl = host.querySelector('#rProject');
  const saetProjekt = (id) => {
    projektEl.querySelectorAll('[data-nyt]').forEach((o) => o.remove());
    if (nytProjekt) {
      const o = document.createElement('option');
      o.value = '';
      o.dataset.nyt = '1';
      o.textContent = `${nytProjekt} — new`;
      projektEl.appendChild(o);
      o.selected = true;
      return;
    }
    projektEl.value = id || '';
  };
  projektEl.addEventListener('change', () => {
    // Vaelger man selv i listen, gaelder valget - ikke det navn, titlen naevnte.
    const valgt = projektEl.value;
    nytProjekt = null;
    saetProjekt(valgt);
  });

  /* Genvejssyntaks i titlen: #kontekst og @projekt flyttes ned i rudens egne
     felter, praecis som i detaljeruden. Reglen roeres IKKE - den har sit eget
     felt lige nedenunder, og to veje til den samme regel var netop det, ruden
     er skruet sammen for at undgaa (DESIGN.md §3).

     Tolkningen sker ved blur - saa naar man at se markoeren forsvinde og
     chippen dukke op, foer noget gemmes. */
  const titelEl = host.querySelector('#rTitle');
  const tolkTitel = () => {
    const u = {
      project_id: projektEl.value || null,
      nytProjekt,
      contexts: valgte,
      nyeKontekster,
      due_date: null,
      due_time: null,
      defer_date: null,
    };
    const ny = anvendSyntaks(u, titelEl.value, true);
    if (ny === null) return;
    titelEl.value = ny;
    nytProjekt = u.nytProjekt;
    saetProjekt(u.project_id);
    tegnKontekster();
  };
  titelEl.addEventListener('blur', tolkTitel);

  bindGemGenvej(host, host.querySelector('#rSave'));
  host.querySelector('#rSave').addEventListener('click', async () => {
    // Klikkes der paa Save uden at forlade titelfeltet foerst, naar blur ikke
    // at koere. Tolk derfor ogsaa her - ellers gemmes "@Hus" som tekst.
    tolkTitel();
    try {
      let projektId = projektEl.value || null;
      if (nytProjekt) {
        const svar = await api('POST', '/api/v1/projects', { name: nytProjekt });
        if (svar.project) { projektId = svar.project.id; nytProjekt = null; }
      }
      for (const navn of nyeKontekster.slice()) {
        const svar = await api('POST', '/api/v1/contexts', { name: navn });
        if (svar.context && !valgte.includes(svar.context.id)) valgte.push(svar.context.id);
      }
      nyeKontekster.length = 0;

      await api('POST', `/api/v1/recurrences/${r.id}`, {
        title: titelEl.value,
        rule_text: host.querySelector('#rRule').value,
        project_id: projektId,
        contexts: valgte,
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
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });

    /*
     * En PWA paa hjemmeskaermen bliver maaske ALDRIG genindlaest: den lukkes
     * ikke, den skjules. Uden et kald til update() opdager den derfor aldrig,
     * at der ligger en ny sw.js - og saa serverer den gamle cache videre i
     * det uendelige. Andreas' telefon stod paa v33, mens serveren var paa
     * v38, og fejl, der var rettet for laengst, blev ved med at vise sig.
     *
     * Registreringen ovenfor tjekker kun ved sideindlaesning. Her tjekker vi
     * ogsaa, hver gang appen kommer frem igen - samme oejeblik som den henter
     * data (DESIGN.md §v26). Det er ét kald, og det er gratis, naar der
     * ingen ny version er.
     */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* offline er fint */ });
    });

    /*
     * Naar en ny SW har taget over, koerer den GAMLE app.js stadig i siden -
     * skipWaiting() skifter arbejderen ud, ikke koden foran brugeren. Derfor
     * genindlaeser vi, men KUN hvis der var en controller i forvejen: ved
     * allerfoerste registrering fyrer controllerchange ogsaa (clients.claim),
     * og der ville en genindlaesning vaere stoej ved hver ny installation.
     */
    const havdeStyring = !!navigator.serviceWorker.controller;
    let genindlaeser = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!havdeStyring || genindlaeser) return;
      genindlaeser = true;
      window.location.reload();
    });
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
  afventendeCache = null;
}

/**
 * Laegger en handling i koen.
 *
 * En STRENG er en fangst - saadan sa koen ud foer v11, og der kan ligge
 * saadanne poster paa telefonen lige nu. De skal stadig sendes, saa formen
 * er bagudkompatibel og maa aldrig blive det modsatte.
 */
function laegIKoe(post) {
  const koe = laesOutbox();
  koe.push(Object.assign({ id: nyId(), ts: Date.now() },
    typeof post === 'string' ? { type: 'capture', text: post } : post));
  skrivOutbox(koe);
  opdaterOfflineMaerke();
}

/**
 * Hvilke elementer venter der en handling paa?
 *
 * Bruges til at vise raekken som afventende, saa et tik ikke ser ud til at
 * blive glemt, mens man er offline. Cachet, fordi elementRaekke() spoerger
 * én gang pr. raekke, og localStorage er ikke gratis.
 */
let afventendeCache = null;

function afventende() {
  if (!afventendeCache) {
    afventendeCache = new Map();
    for (const p of laesOutbox()) if (p.item) afventendeCache.set(p.item, p);
  }
  return afventendeCache;
}

/** Ét sted der ved, hvordan hver slags post sendes. */
function sendPost(post) {
  if (post.type === 'complete') return api('POST', `/api/v1/items/${post.item}/complete`, {});
  if (post.type === 'status') return api('POST', `/api/v1/items/${post.item}`, { status: post.status });
  if (post.type === 'delete') return api('DELETE', `/api/v1/items/${post.item}`, {});
  // Uden type er det en fangst fra en tidligere udgave.
  return api('POST', '/api/v1/capture', { text: post.text, createNew: true });
}

function beskrivPost(post) {
  if (post.type === 'complete') return `completing “${(post.titel || '').slice(0, 30)}”`;
  if (post.type === 'status') return `moving “${(post.titel || '').slice(0, 30)}”`;
  if (post.type === 'delete') return `deleting “${(post.titel || '').slice(0, 30)}”`;
  return `“${String(post.text || '').slice(0, 30)}…”`;
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
        await sendPost(post);
        sendt++;
      } catch (ex) {
        if (erNetvaerksfejl(ex)) break;
        // Et rigtigt afslag (fx en opgave, der er slettet i mellemtiden) ma
        // ikke blokere koen for evigt.
        toast(`Could not finish ${beskrivPost(post)}: ${ex.message}`);
      }
      koe = laesOutbox().slice(1);
      skrivOutbox(koe);
    }
  } finally {
    sender = false;
  }
  opdaterOfflineMaerke();
  if (sendt) {
    toast(`Sent ${sendt} change${sendt === 1 ? '' : 's'} made offline`);
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

/* ------------------------------------------------------------- synk */

/*
 * Paa hjemmeskaermen bliver appen ALDRIG genindlaest. Den ligger i baggrunden,
 * og naar man vender tilbage, staar der praecis det, der stod, da man gik -
 * ogsaa selv om man har fanget noget fra Siri eller rettet noget paa en anden
 * enhed imens. Foer v26 var den eneste vej til friske data at skifte skaerm,
 * fordi hvert sideskift henter sin egen liste. Det er ikke en indstilling,
 * brugeren skal kende: en app, der viser gamle tal, er en app, man holder op
 * med at stole paa.
 *
 * To ting loeser det, og de skal begge to vaere der:
 *   - AUTOMATISK, naar appen kommer frem igen (visibilitychange), naar den
 *     genskabes fra bfcache (pageshow), og naar forbindelsen vender tilbage.
 *   - EN SYNLIG KNAP, der ogsaa siger HVORNAAR der sidst blev hentet. Uden
 *     det svar kan man ikke vide, om der ikke er sket noget, eller om appen
 *     bare ikke har spurgt.
 */
const synkState = { sidst: Date.now(), koerer: false };

/** Hvor gammelt er det, man ser paa? Kort og uden falsk praecision. */
function synkAlder() {
  const sek = Math.round((Date.now() - synkState.sidst) / 1000);
  if (sek < 45) return 'just now';
  const min = Math.round(sek / 60);
  if (min < 60) return `${min} min ago`;
  const timer = Math.round(min / 60);
  return timer < 24 ? `${timer} h ago` : 'a while ago';
}

function tegnSynkMaerke() {
  const el = document.getElementById('syncLabel');
  if (!el) return;
  el.textContent = synkState.koerer ? 'syncing…' : synkAlder();
  const knap = document.getElementById('syncBtn');
  if (knap) knap.classList.toggle('koerer', synkState.koerer);
}

/**
 * Henter state og den aktuelle side igen.
 *
 * `manuel` = brugeren trykkede selv. Kun da kvitteres der; en automatisk synk
 * skal vaere lydloes, ellers popper der en toast op, hver gang telefonen
 * laases op.
 */
async function synk(manuel) {
  if (synkState.koerer) return;
  if (!navigator.onLine) {
    opdaterOfflineMaerke();
    if (manuel) toast('No connection — showing what was last loaded.');
    return;
  }
  synkState.koerer = true;
  tegnSynkMaerke();
  stilleGentegning = true;
  try {
    await genindlaes();
    synkState.sidst = Date.now();
  } finally {
    stilleGentegning = false;
    synkState.koerer = false;
    tegnSynkMaerke();
  }
  if (manuel) toast('Up to date');
}

function lytPaaForbindelse() {
  window.addEventListener('online', () => {
    opdaterOfflineMaerke();
    // Koeen foerst: det, man selv har lavet, skal ind, foer man henter ned.
    tomOutbox().then(() => synk(false));
  });
  window.addEventListener('offline', opdaterOfflineMaerke);

  /* Appen kommer frem igen. Vaerdien af et par sekunders spaerre er, at et
     tilladelses-ark eller en delefunktion, der blinker forbi, ikke udloeser
     en hentning - ikke at spare kald. */
  const naarSynlig = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - synkState.sidst < 3000) { tegnSynkMaerke(); return; }
    synk(false);
  };
  document.addEventListener('visibilitychange', naarSynlig);
  window.addEventListener('pageshow', naarSynlig);
  window.addEventListener('focus', naarSynlig);

  // Etiketten skal ikke lyve, mens appen ligger aaben: "just now" er forkert
  // ti minutter senere. Ét minut er rigeligt praecist til "min ago".
  setInterval(tegnSynkMaerke, 30000);

  opdaterOfflineMaerke();
  tegnSynkMaerke();
  tomOutbox();
  traekForNyt();
}

/*
 * Traek ned for at hente nyt - paa telefonen.
 *
 * Appen henter selv, naar den kommer frem igen (§v26), men staar den aaben,
 * mens noget aendrer sig et andet sted - en mail fra MsGraphBud, en note fra
 * en anden enhed - er der ingen maade at bede om det paa. Paa skrivebordet er
 * der synk-maerket oeverst at trykke paa; paa telefonen er det for lille og
 * for langt oppe.
 *
 * Ingen `preventDefault`: lytterne er passive, og vi rykker aldrig i selve
 * rulningen. Vi reagerer kun, naar siden ALLEREDE er i top og fingeren gaar
 * nedad - saa er der ikke noget at rulle, og browserens egen bounce er den
 * eneste bevaegelse, vi laegger os oven paa.
 */
function traekForNyt() {
  // En mus har ingen »traek ned fra toppen«. Kun touch.
  if (!('ontouchstart' in window)) return;

  const TAERSKEL = 72;      // hvor langt der skal traekkes
  const MAKS = 110;         // hvor langt maerket foelger med
  let startY = 0;
  let aktiv = false;
  let afstand = 0;
  let el = null;

  const maerke = () => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'traekny';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  };

  const vis = (d, tekst) => {
    const m = maerke();
    m.textContent = tekst;
    m.style.transform = `translate(-50%, ${Math.min(d, MAKS)}px)`;
    m.classList.add('paa');
  };

  const skjul = () => {
    if (!el) return;
    el.classList.remove('paa');
    el.style.transform = 'translate(-50%, 0)';
  };

  /* En aaben rude eller menu ejer skaermen. Traekker man dér, er det
     indholdet i ruden, man vil rulle - ikke appen, man vil genindlaese. */
  const optaget = () => document.body.classList.contains('navopen')
    || !!(document.getElementById('modalHost') || {}).firstChild;

  window.addEventListener('touchstart', (e) => {
    aktiv = !optaget() && window.scrollY <= 0 && e.touches.length === 1;
    startY = aktiv ? e.touches[0].clientY : 0;
    afstand = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!aktiv) return;
    // Ruller siden alligevel, er det ikke et traek - saa slip det.
    if (window.scrollY > 0) { aktiv = false; skjul(); return; }
    afstand = e.touches[0].clientY - startY;
    if (afstand <= 0) { skjul(); return; }
    vis(afstand, afstand >= TAERSKEL ? 'Release to refresh' : 'Pull to refresh');
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (!aktiv) return;
    aktiv = false;
    if (afstand < TAERSKEL) { skjul(); return; }
    // Maerket bliver staaende, mens der hentes - ellers ser det ud, som om
    // traekket ikke gjorde noget.
    vis(TAERSKEL, 'Refreshing…');
    Promise.resolve(synk(true)).finally(skjul);
  }, { passive: true });

  window.addEventListener('touchcancel', () => { aktiv = false; skjul(); }, { passive: true });
}

/* ------------------------------------------------------------ passkeys */

const kanPasskeys = () => !!(window.PublicKeyCredential && window.isSecureContext);

const fraB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')
  .padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const tilB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Opretter en passkey pa denne enhed. */
async function opretPasskey(navn) {
  const o = await api('POST', '/api/webauthn/register/options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.user.id = fraB64u(pk.user.id);
  pk.excludeCredentials = (pk.excludeCredentials || []).map((c) => ({ type: 'public-key', id: fraB64u(c.id) }));
  const cred = await navigator.credentials.create({ publicKey: pk });
  return api('POST', '/api/webauthn/register/verify', {
    challengeId: o.challengeId,
    name: navn,
    attestationObject: tilB64u(cred.response.attestationObject),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
  });
}

/** Logger ind uden brugernavn - noeglen ved selv, hvem den hoerer til. */
async function loginMedPasskey() {
  const o = await api('POST', '/api/webauthn/login/options', {});
  const pk = o.publicKey;
  pk.challenge = fraB64u(pk.challenge);
  pk.allowCredentials = [];
  const cred = await navigator.credentials.get({ publicKey: pk });
  return api('POST', '/api/webauthn/login/verify', {
    challengeId: o.challengeId,
    id: tilB64u(cred.rawId),
    authenticatorData: tilB64u(cred.response.authenticatorData),
    clientDataJSON: tilB64u(cred.response.clientDataJSON),
    signature: tilB64u(cred.response.signature),
  });
}

async function tegnPasskeys() {
  const host = document.getElementById('pkList');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/passkeys');
    const blokeret = d.blocked || (!kanPasskeys() && 'This browser cannot use passkeys.');
    host.innerHTML = `
      ${d.credentials.length ? d.credentials.map((c) => `
        <div class="keyrow">
          <div class="keyrow-main">
            <div class="keyrow-name">${esc(c.name)}</div>
            <div class="meta">${esc(c.alg)} · added ${esc(visTid(c.created_at))} ·
              ${c.last_used_at ? `last used ${esc(visTid(c.last_used_at))}` : 'never used'}</div>
          </div>
          <button class="btn ghost" data-pkdel="${esc(c.id)}">Remove</button>
        </div>`).join('') : '<p class="lead" style="margin:14px 0 0">No passkeys yet.</p>'}
      ${blokeret ? `<p class="gate-note" style="text-align:left">${esc(blokeret)}</p>`
    : '<button class="btn" id="pkAdd" style="margin-top:14px">Add a passkey</button>'}`;

    const tilfoej = host.querySelector('#pkAdd');
    if (tilfoej) {
      tilfoej.addEventListener('click', async () => {
        try {
          await opretPasskey(`${navigator.platform || 'This device'}`.slice(0, 60));
          await tegnPasskeys();
          toast('Passkey added');
        } catch (ex) {
          if (ex.name !== 'NotAllowedError') toast(ex.message || 'Could not add the passkey');
        }
      });
    }
    host.querySelectorAll('[data-pkdel]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('DELETE', `/api/v1/passkeys/${encodeURIComponent(el.dataset.pkdel)}`, {});
        await tegnPasskeys();
        toast('Passkey removed — it stopped working immediately');
      });
    });
  } catch (ex) { host.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }
}


/* ------------------------------------------------------------- push */

/*
 * Web Push. Kalenderfeedet er stadig den primaere vej (DESIGN.md) - den
 * virker uden tilladelser og uden noegler. Det her er til den, der ikke
 * abonnerer med sin kalender.
 *
 * Tre ting skal vaere sande, og appen skal sige HVILKEN der mangler:
 * https, en service worker, og paa iOS at appen ligger paa hjemmeskaermen.
 * En knap, der bare ikke virker, er det vaerste svar.
 */
function pushMuligt() {
  if (!window.isSecureContext) return 'Push needs https. Over plain http the browser has no notifications at all.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // iOS har kun PushManager i en app, der ER lagt paa hjemmeskaermen.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return ios
      ? 'On iPhone this works only when doda is added to your home screen: Share → Add to Home Screen, then open it from there.'
      : 'This browser has no push support.';
  }
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked for this site in your browser settings.';
  }
  return null;
}

async function slaaPushTil() {
  const reg = await navigator.serviceWorker.ready;
  // requestPermission SKAL komme fra et klik - derfor ligger den her og
  // ikke i en opstartsrutine.
  const svar = await Notification.requestPermission();
  if (svar !== 'granted') throw new Error('Notifications were not allowed.');

  const d = await api('GET', '/api/v1/push');
  const abon = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64uTilBytes(d.publicKey),
  });
  const j = abon.toJSON();
  return api('POST', '/api/v1/push', {
    endpoint: j.endpoint,
    p256dh: j.keys && j.keys.p256dh,
    auth: j.keys && j.keys.auth,
  });
}

async function slaaPushFra() {
  const reg = await navigator.serviceWorker.ready;
  const abon = await reg.pushManager.getSubscription();
  if (abon) {
    await api('DELETE', '/api/v1/push', { endpoint: abon.endpoint });
    await abon.unsubscribe();
  } else {
    await api('DELETE', '/api/v1/push', {});
  }
}

/** applicationServerKey vil have raa bytes, ikke base64url. */
function b64uTilBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
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
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      // CSRF-barriere: en fremmed formular kan ikke saette en egen header.
      'X-Doda-Upload': '1',
    },
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

/* ---- p8_review.js ---- */
'use strict';
/* doda - Waiting For, Someday, Logbook, den ugentlige gennemgang og
   fokustilstand med timer. */

/* ------------------------------------------------- Waiting For / Someday */

async function sideStatusliste(status, titel) {
  const d = await api('GET', `/api/v1/items?status=${status}`);
  state.items = d.items;
  tegnStatusliste(status, titel);
}

/* Tegner listen af state ALENE - saa den kan tegnes om uden at spoerge
   serveren, naar en raekke flyttes eller en ny fanges (p3_lists §straksVaek). */
function tegnStatusliste(status, titel) {
  const host = document.getElementById('pageHost');
  const d = { items: state.items };

  if (!d.items.length) {
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>${esc(titel)}</h1><p class="lead">${esc(BESKRIVELSER[state.view])}</p></div>
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">${status === 'waiting' ? 'Nobody owes you anything' : 'Nothing parked'}</p>
        <p>${status === 'waiting'
    ? 'Press <strong>w</strong> on a task to move it here when you have handed it off.'
    : 'Press <strong>s</strong> on a task to park it without any commitment.'}</p></div>
    </section>`;
    return;
  }

  host.innerHTML = `<section class="page">
    <div class="page-head"><h1>${esc(titel)}</h1><p class="lead">${esc(BESKRIVELSER[state.view])}</p></div>
    <div class="list" data-keynav>${d.items.map((it, i) => {
    const raekke = elementRaekke(it, i);
    if (status !== 'waiting') return raekke;
    // "Venter pa" giver kun mening, hvis man kan se HVEM (handover §4).
    return raekke.replace('</div>\n  </div>', `</div>
      <input class="waitwho" data-who="${esc(it.id)}" value="${esc(it.waiting_for || '')}"
        placeholder="Who?" aria-label="Waiting on whom">
  </div>`);
  }).join('')}</div>
    <p class="hintline meta">↑↓ select · enter open · n back to next · space done · esc leave</p>
  </section>`;
  bindListe();

  document.querySelectorAll('.waitwho[data-who]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('change', async () => {
      await api('POST', `/api/v1/items/${el.dataset.who}`, { waiting_for: el.value });
      toast('Saved');
    });
  });
}

/* --------------------------------------------------------------- logbog */

async function sideLog() {
  const host = document.getElementById('pageHost');
  const q = state.logProject ? `?project=${encodeURIComponent(state.logProject)}` : '';
  const d = await api('GET', `/api/v1/logbook${q}`);

  const filtre = state.projects.map((p) =>
    `<button class="pill${state.logProject === p.id ? ' on' : ''}" data-logp="${esc(p.id)}">${esc(p.name)}</button>`).join('');

  if (!d.items.length) {
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>Logbook</h1><p class="lead">${esc(BESKRIVELSER.log)}</p></div>
      ${state.projects.length ? `<div class="pills"><button class="pill${state.logProject ? '' : ' on'}" data-logp="">All</button>${filtre}</div>` : ''}
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">Nothing finished yet</p><p>It shows up here as you go.</p></div>
    </section>`;
    bindLog();
    return;
  }

  // Grupperet pr. dag. Ingen tal, ingen grafer, ingen score - se §10.
  const dage = new Map();
  for (const it of d.items) {
    const dag = new Date(it.completed_at * 1000).toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long' });
    if (!dage.has(dag)) dage.set(dag, []);
    dage.get(dag).push(it);
  }

  host.innerHTML = `<section class="page">
    <div class="page-head"><h1>Logbook</h1><p class="lead">${esc(BESKRIVELSER.log)}</p></div>
    ${state.projects.length ? `<div class="pills"><button class="pill${state.logProject ? '' : ' on'}" data-logp="">All</button>${filtre}</div>` : ''}
    ${[...dage.entries()].map(([dag, liste]) => `
      <h2 class="group meta">${esc(dag)}</h2>
      <div class="list">${liste.map(logRaekke).join('')}</div>`).join('')}
  </section>`;
  bindLog();
}

function logRaekke(it) {
  const projekt = it.project_id ? (state.projects.find((p) => p.id === it.project_id) || {}).name : null;
  const meta = [];
  if (projekt) meta.push(esc(projekt));
  if (it.status === 'dropped') meta.push('dropped');
  if (it.contexts.length) meta.push(it.contexts.map((c) => `#${esc(c.name)}`).join(' '));
  return `<div class="item-row log-row${it.status === 'dropped' ? ' dim' : ''}">
    <span class="logtick">${it.status === 'dropped' ? '·' : '✓'}</span>
    <div class="item-main">
      <div class="item-title">${linkify(it.title)}</div>
      ${meta.length ? `<div class="item-meta meta">${meta.join(' · ')}</div>` : ''}
    </div>
  </div>`;
}

function bindLog() {
  document.querySelectorAll('[data-logp]').forEach((el) => {
    el.addEventListener('click', () => { state.logProject = el.dataset.logp || null; tegnSide(); });
  });
}

/* ------------------------------------------------- ugentlig gennemgang */

const TRIN = [
  { id: 'inbox', t: 'Empty the inbox', n: 'Clarify everything that is still unprocessed.' },
  { id: 'projects', t: 'Review active projects', n: 'Does every project have a next action?' },
  { id: 'waiting', t: 'Review Waiting For', n: 'Is there anything you should chase?' },
  { id: 'someday', t: 'Review Someday', n: 'Has anything become relevant?' },
  { id: 'skipped', t: 'Review skipped repeats', n: 'A habit that keeps getting skipped is telling you something.' },
  { id: 'week', t: 'Look at the week', n: 'What you got done.' },
  { id: 'focus', t: 'Pick this week\u2019s projects', n: 'The few you actually intend to move. The rest keep running without you.' },
];

/*
 * Tre maader at gaa igennem paa - efter tingdo.
 *
 * Forskellen er UDELUKKENDE hvilke trin man moeder, og i hvilken orden.
 * Ét sted at aendre, og ingen "hvis speed"-forgreninger nede i trinnene.
 */
const MAADER = {
  speed: {
    navn: 'Speed Review',
    om: 'Inbox and next actions. Nothing else.',
    trin: ['inbox', 'projects'],
  },
  simple: {
    navn: 'Simple Review',
    om: 'Every list, one by one. Confirm a whole list at once when nothing has changed.',
    trin: ['inbox', 'projects', 'waiting', 'someday', 'skipped', 'week'],
  },
  focused: {
    navn: 'Focused Review',
    om: 'Pick the projects you will focus on this week, then walk through every list.',
    trin: ['focus', 'inbox', 'projects', 'waiting', 'someday', 'skipped', 'week'],
  },
};

const trinListe = (mode) => (MAADER[mode] || MAADER.simple).trin.map((id) => TRIN.find((x) => x.id === id));

async function sideReview() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/review');
  state.review = d;

  if (!d.step) {
    const dage = ['Never', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const u = d.week || { captured: 0, completed: 0, processed: 0 };
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>Review</h1><p class="lead">${esc(BESKRIVELSER.review)}</p></div>

      <blockquote class="reviewintro">
        <strong>The weekly review is how you stay on top of everything.</strong>
        You clear the inbox, check in on your projects, revisit Someday, and confirm
        nothing is slipping through the cracks. It usually takes 15 to 30 minutes.
      </blockquote>

      <div class="page-head" style="margin:32px 0 18px">
        <h1>Hi ${esc(visNavn(state.user.username))}.</h1>
        <p class="lead">A quick look at your week before you start.</p>
      </div>

      <!-- Fakta til samtalen, ikke en score: ingen streaks, ingen grafer,
           ingen sammenligning med sidste uge (DESIGN.md §7). -->
      <div class="weekstats">
        <div><span>Captured</span><b>${u.captured}</b></div>
        <div><span>Completed</span><b>${u.completed}</b></div>
        <div><span>Captured and clarified</span><b>${u.processed}</b></div>
      </div>

      <p class="lead" style="margin:30px 0 12px">How would you like to review?</p>
      <div class="modelist">
        ${Object.entries(MAADER).map(([id, m]) => `
          <button class="modecard" data-mode="${id}">
            <strong>${esc(m.navn)}</strong>
            <span class="lead">${esc(m.om)}</span>
            <span class="meta">${(MAADER[id].trin.length)} step${MAADER[id].trin.length === 1 ? '' : 's'}</span>
          </button>`).join('')}
      </div>
      <div class="card" style="margin-top:18px">
        <p class="gate-note" style="text-align:left;margin:0">You can stop halfway and pick
        up from the same step later — even on another device.
        ${d.lastDone ? `Last completed ${esc(visTid(d.lastDone))}.` : ''}</p>
      </div>
      <div class="card">
        <h2>Reminder</h2>
        <p class="lead" style="margin:6px 0 12px">A quiet nudge on the day you choose.
        Nothing else in doda will ever notify you.</p>
        <select class="input" id="revDay" style="max-width:240px">
          ${dage.map((n, i) => `<option value="${i}"${i === d.weekday ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
    </section>`;
    document.querySelectorAll('[data-mode]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('POST', '/api/v1/review', { action: 'start', mode: el.dataset.mode });
        tegnSide();
      });
    });
    document.getElementById('revDay').addEventListener('change', async (e) => {
      await api('POST', '/api/v1/settings', { settings: { review_weekday: e.target.value } });
      toast(e.target.value === '0' ? 'Reminder off' : 'Reminder set');
    });
    return;
  }

  // Trinnene kommer fra den valgte maade - ikke fra den faste liste.
  const trin = trinListe(d.mode);
  const i = Math.min(d.step, trin.length) - 1;
  const nu = trin[i];
  host.innerHTML = `<section class="page">
    <div class="page-head">
      <div class="meta">${esc((MAADER[d.mode] || MAADER.simple).navn)} ·
        Step ${d.step} of ${trin.length}</div>
      <h1>${esc(nu.t)}</h1>
      <p class="lead">${esc(nu.n)}</p>
      <div class="progress"><span style="width:${(d.step / trin.length) * 100}%"></span></div>
    </div>
    <div class="card">${reviewTrin(nu.id, d)}</div>
    <div class="reviewnav">
      <button class="btn ghost" id="revQuit">Continue later</button>
      <span style="flex:1"></span>
      ${d.step > 1 ? '<button class="btn" id="revBack">Back</button>' : ''}
      <button class="btn primary" id="revNext">${d.step === trin.length ? 'Finish' : 'Next step'}</button>
    </div>
  </section>`;

  const gaa = async (t) => { await api('POST', '/api/v1/review', { step: t }); tegnSide(); };

  // Ugens projekter gemmes med det samme, ikke ved "Next" - saa er et
  // "Continue later" midt i trinnet ikke spildt.
  document.querySelectorAll('[data-focus]').forEach((el) => {
    el.addEventListener('change', async () => {
      const valgt = [...document.querySelectorAll('[data-focus]')]
        .filter((x) => x.checked).map((x) => x.dataset.focus);
      d.focus = valgt;
      await api('POST', '/api/v1/review', { action: 'focus', focus: valgt });
    });
  });
  document.getElementById('revQuit').addEventListener('click', async () => {
    // "Fortsaet senere" beholder trinnet - kun "Finish" nulstiller det.
    gaaTil('next');
    toast('Paused — pick it up from the same step whenever');
  });
  if (d.step > 1) document.getElementById('revBack').addEventListener('click', () => gaa(d.step - 1));
  document.getElementById('revNext').addEventListener('click', async () => {
    if (d.step < trin.length) { gaa(d.step + 1); return; }
    await api('POST', '/api/v1/review', { action: 'finish' });
    await genindlaes();
    gaaTil('next');
    toast('Review done. Everything is where you left it.');
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.goto));
  });
}

/** Indholdet af ét trin. Slaar op paa trinnets ID, ikke paa dets nummer -
    ellers ville en ny maade flytte alle grenene. */
function reviewTrin(id, d) {
  const tom = (t) => `<p class="lead">${t}</p>`;
  const liste = (items, hvad) => (items.length
    ? `<div class="list">${items.slice(0, 40).map((x) => `<div class="item-row">
        <span class="proj-dot"></span><div class="item-main">
        <div class="item-title">${linkify(x.title)}</div>
        ${x.waiting_for ? `<div class="item-meta meta">waiting on ${esc(x.waiting_for)}</div>` : ''}</div></div>`).join('')}</div>`
    : tom(hvad));

  if (id === 'inbox') {
    return d.inbox.length
      ? `<p class="lead" style="margin-bottom:12px">${d.inbox.length} item${d.inbox.length === 1 ? '' : 's'} left.</p>
         ${liste(d.inbox, '')}
         <button class="btn" data-goto="inbox" style="margin-top:14px">Go to the inbox</button>`
      : tom('Inbox is empty. Nothing to clarify.');
  }
  if (id === 'projects') {
    return d.stalled.length
      ? `<p class="lead" style="margin-bottom:12px">${d.stalled.length} project${d.stalled.length === 1 ? ' has' : 's have'} open work but no next action:</p>
         <div class="list">${d.stalled.map((p) => `<div class="item-row">
           <span class="proj-dot"></span><div class="item-main"><div class="item-title">${esc(p.name)}</div>
           <div class="item-meta meta">${p.open_count} open</div></div></div>`).join('')}</div>
         <button class="btn" data-goto="projects" style="margin-top:14px">Go to projects</button>`
      : tom(`All ${d.projects.length} active projects have a next action. That is the whole point.`);
  }
  if (id === 'waiting') return liste(d.waiting, 'You are not waiting on anyone.');
  if (id === 'someday') return liste(d.someday, 'Nothing parked.');
  if (id === 'skipped') {
    return d.skipped.length
      ? `<div class="list">${d.skipped.map((r) => `<div class="item-row">
          <span class="rep-icon ${r.mode === 'completion' ? 'completion' : 'schedule'}">${icon('repeat', 16)}</span>
          <div class="item-main"><div class="item-title">${esc(r.title)}</div>
          <div class="item-meta meta">${esc(r.description)}</div></div>
          <span class="skipcount">${r.skips} skipped</span></div>`).join('')}</div>
         <button class="btn" data-goto="repeat" style="margin-top:14px">Go to recurring</button>`
      : tom('Nothing has been skipped. Your habits are holding.');
  }
  if (id === 'focus') {
    // Ugens projekter. Valget gemmes med det samme - trykker man "Continue
    // later" midt i en gennemgang, skal det ikke vaere spildt.
    const valgt = new Set(d.focus || []);
    return d.projects.length
      ? `<p class="lead" style="margin-bottom:12px">Tick the few you actually intend to
           move this week. The rest keep running without you.</p>
         <div class="list">${d.projects.map((p) => `
           <label class="item-row focusrow">
             <input type="checkbox" data-focus="${esc(p.id)}"${valgt.has(p.id) ? ' checked' : ''}>
             <div class="item-main"><div class="item-title">${esc(p.name)}</div>
             <div class="item-meta meta">${p.open_count} open${p.next_count ? '' : ' · no next action'}</div></div>
           </label>`).join('')}</div>`
      : tom('No active projects yet.');
  }
  return d.done.length
    ? `<p class="lead" style="margin-bottom:12px">${d.done.length} thing${d.done.length === 1 ? '' : 's'} finished this week.</p>
       ${liste(d.done, '')}`
    : tom('A quiet week. That is allowed too.');
}

/* ------------------------------------------------------- fokustilstand */

/* Timeren skal blive ved med at taelle, selv om man skifter skaerm
   (handover §5.3). Derfor gemmes STARTTIDSPUNKTET, ikke en tael-vaerdi -
   sa er den rigtig, uanset hvad der er sket imellemtiden. */
const fokus = { itemId: null, start: 0, timer: null };

function startFokus(it) {
  fokus.itemId = it.id;
  fokus.start = Date.now();
  // Titlen skal HOLDES her. state.items indeholder kun den aktuelle skaerms
  // elementer, saa saa snart man navigerer vaek, kan den ikke slaas op.
  fokus.titel = it.title;
  fokus.note = it.note || '';
  try {
    localStorage.setItem('doda_focus', JSON.stringify({
      id: it.id, start: fokus.start, title: it.title, note: fokus.note,
    }));
  } catch { /* privat tilstand */ }
  tegnFokus();
}

function stopFokus() {
  const paaSkaerm = state.view === 'focus';
  fokus.itemId = null;
  clearInterval(fokus.timer);
  fokus.timer = null;
  try { localStorage.removeItem('doda_focus'); } catch { /* ligegyldigt */ }
  const el = document.getElementById('focusBar');
  if (el) el.remove();
  // Bliver man staaende, ser man paa en skaerm uden en opgave.
  if (paaSkaerm) gaaTil('next');
}

function gendanFokus() {
  try {
    const g = JSON.parse(localStorage.getItem('doda_focus') || 'null');
    if (!g) return;
    fokus.itemId = g.id;
    fokus.start = g.start;
    fokus.titel = g.title;
    fokus.note = g.note || '';
    tegnFokus();
  } catch { /* ligegyldigt */ }
}

/** Sekunder som ur. Bruges baade af linjen og af skaermen, saa de ikke driver. */
function fokusUr(sek) {
  const m = String(Math.floor(sek / 60) % 60).padStart(2, '0');
  const s = String(sek % 60).padStart(2, '0');
  const t = Math.floor(sek / 3600);
  return `${t ? `${t}:` : ''}${m}:${s}`;
}

const fokusTitel = () => fokus.titel
  || (state.items.find((x) => x.id === fokus.itemId) || {}).title || 'Focus';

/**
 * Fokusskaermen: opgaven alene, som hjaelpeteksten i detaljeruden lover
 * ("This task on a screen of its own, with a timer that keeps running").
 *
 * Indtil v38 fandtes den ikke. Knappen lukkede bare ruden og satte en linje i
 * bunden - man landede i listen, altsaa netop det, fokus skulle fjerne. Teksten
 * var skrevet, funktionen var ikke bygget faerdig.
 */
function sideFokus() {
  if (!fokus.itemId) return '<div class="wrap"><p class="empty">Nothing in focus.</p></div>';
  const sek = Math.floor((Date.now() - fokus.start) / 1000);
  return `<div class="wrap focuspage">
    <div class="focusclock" id="focusBig">${esc(fokusUr(sek))}</div>
    <h1 class="focusname">${esc(fokusTitel())}</h1>
    ${fokus.note ? `<div class="note-preview focusnote">${markdown(fokus.note)}</div>` : ''}
    <div class="focusbtns">
      <button class="btn primary" id="fpDone">Done</button>
      <button class="btn" id="fpStop">Stop</button>
      <button class="btn ghost" id="fpBack">Keep it running</button>
    </div>
  </div>`;
}

function bindFokus() {
  const stop = document.getElementById('fpStop');
  if (stop) stop.addEventListener('click', stopFokus);
  const back = document.getElementById('fpBack');
  // Timeren loeber videre - man forlader kun skaermen, ikke fokus.
  if (back) back.addEventListener('click', () => gaaTil('next'));
  const done = document.getElementById('fpDone');
  if (done) {
    done.addEventListener('click', async () => {
      const id = fokus.itemId;
      stopFokus();
      await fuldfoer(id);
    });
  }
}

function tegnFokus() {
  if (!fokus.itemId) return;
  // Paa selve skaermen er linjen en dublet af det, man allerede kigger paa.
  const paaSkaerm = state.view === 'focus';
  let el = document.getElementById('focusBar');
  if (paaSkaerm && el) { el.remove(); el = null; }
  if (!paaSkaerm && !el) {
    el = document.createElement('div');
    el.className = 'focusbar';
    el.id = 'focusBar';
    document.body.appendChild(el);
  }
  const tegn = () => {
    const sek = Math.floor((Date.now() - fokus.start) / 1000);
    const stor = document.getElementById('focusBig');
    if (stor) stor.textContent = fokusUr(sek);
    const b = document.getElementById('focusBar');
    if (!b) return;
    b.innerHTML = `<span class="focustime">${esc(fokusUr(sek))}</span>
      <span class="focustitle">${esc(fokusTitel())}</span>
      <button class="btn ghost" id="focusDone">Done</button>
      <button class="btn ghost" id="focusStop">Stop</button>`;
    // Titlen foerer tilbage til skaermen - ellers er der ingen vej tilbage,
    // naar man foerst har navigeret vaek.
    b.querySelector('.focustitle').addEventListener('click', () => gaaTil('focus'));
    b.querySelector('#focusStop').addEventListener('click', stopFokus);
    b.querySelector('#focusDone').addEventListener('click', async () => {
      const id = fokus.itemId;
      stopFokus();
      await fuldfoer(id);
    });
  };
  tegn();
  clearInterval(fokus.timer);
  // Ét sekund er rigeligt: timeren regner fra starttidspunktet, sa den kan
  // ikke drive, selv om fanen har vaeret i baggrunden.
  fokus.timer = setInterval(tegn, 1000);
}

/* ------------------------------------------- kalender, eksport, import */

async function bindData() {
  const boks = document.getElementById('calBox');
  if (!boks) return;

  const tegnKalender = (token) => {
    if (!token) {
      boks.innerHTML = '<button class="btn" id="calMake">Create subscription address</button>';
      boks.querySelector('#calMake').addEventListener('click', async () => {
        const d = await api('POST', '/api/v1/calendar', {});
        tegnKalender(d.token);
        toast('Address created');
      });
      return;
    }
    const url = `${location.origin}/ical/${token}.ics`;
    boks.innerHTML = `<div class="keyshow" id="calUrl">${esc(url)}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn" id="calCopy">Copy address</button>
        <button class="btn ghost" id="calNew">Replace</button>
        <button class="btn ghost" id="calOff">Turn off</button>
      </div>
      <label class="field" style="margin-top:16px"><span>Remind me</span>
        <select class="input" id="calAlarm" style="max-width:280px">
          ${[['-1', 'No reminder'], ['0', 'At the time'], ['5', '5 minutes before'],
    ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before']]
    .map(([v, n]) => `<option value="${v}"${v === String(state.icalAlarm) ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>
      <p class="gate-note" style="text-align:left">Only tasks with a <strong>time</strong>
      get a reminder — a whole-day task would ring at midnight. This is how doda
      notifies you: your own calendar does it, so it works with the app closed and
      without asking permission for anything.</p>
      <p class="gate-note" style="text-align:left">In Apple Calendar:
      File → New Calendar Subscription, and paste this. On iPhone the subscription
      must have <strong>Remove Alarms</strong> switched off.</p>`;
    boks.querySelector('#calAlarm').addEventListener('change', async (e) => {
      state.icalAlarm = e.target.value;
      await api('POST', '/api/v1/settings', { settings: { ical_alarm: e.target.value } });
      // Kalender-apps henter feedet igen af sig selv - typisk hvert kvarter.
      toast(e.target.value === '-1' ? 'Reminders off'
        : 'Saved — your calendar picks it up at its next refresh');
    });
    boks.querySelector('#calCopy').addEventListener('click', () => kopiér(url));
    boks.querySelector('#calNew').addEventListener('click', async () => {
      const d = await api('POST', '/api/v1/calendar', {});
      tegnKalender(d.token);
      toast('New address — the old one stopped working');
    });
    boks.querySelector('#calOff').addEventListener('click', async () => {
      await api('POST', '/api/v1/calendar', { action: 'revoke' });
      tegnKalender(null);
      toast('Subscription turned off');
    });
  };
  try {
    const s = await api('GET', '/api/v1/settings');
    state.icalAlarm = (s.settings && s.settings.ical_alarm) || '15';
  } catch { state.icalAlarm = '15'; }
  try { tegnKalender((await api('GET', '/api/v1/calendar')).token); }
  catch (ex) { boks.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }

  const hent = (medFiler) => {
    // Browseren henter selv filen; en <a download> med samme oprindelse
    // faar Content-Disposition fra serveren.
    const a = document.createElement('a');
    a.href = `/api/v1/export${medFiler ? '?files=1' : ''}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  document.getElementById('expData').addEventListener('click', () => hent(false));
  document.getElementById('expAll').addEventListener('click', () => hent(true));

  document.getElementById('tdBtn').addEventListener('click', todoistImport);

  const felt = document.getElementById('impFile');
  document.getElementById('impBtn').addEventListener('click', () => felt.click());
  felt.addEventListener('change', async () => {
    const f = felt.files[0];
    felt.value = '';
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (!doc || doc.doda !== 1) { toast('That is not a doda export file.'); return; }
      toast('Importing…');
      const tal = await importerIPortioner(doc);
      await genindlaes();
      tegnSide();
      toast(`Imported ${Object.entries(tal).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch (ex) { toast(`Import failed: ${ex.message}`); }
  });
}

/**
 * Sender importen i portioner.
 *
 * En fuld backup overstiger let serverens body-graense. Kokkeris 260 MB-backup
 * blev afvist af serverens egen 25 MB-graense og var i praksis ubrugelig, uden
 * at nogen opdagede det (RUNE-ERFARINGER §4). Derfor: smaa portioner, og
 * strukturen (omraader, projekter, kontekster) FOERST, sa fremmednoeglerne
 * findes, naar elementerne kommer.
 */
async function importerIPortioner(doc) {
  const total = {};
  const laeg = (t) => { for (const [k, v] of Object.entries(t)) total[k] = (total[k] || 0) + v; };

  laeg((await api('POST', '/api/v1/import', {
    areas: doc.areas, contexts: doc.contexts, projects: doc.projects,
    recurrences: doc.recurrences, settings: doc.settings,
  })).imported);

  for (let i = 0; i < (doc.items || []).length; i += 100) {
    laeg((await api('POST', '/api/v1/import', { items: doc.items.slice(i, i + 100) })).imported);
  }
  laeg((await api('POST', '/api/v1/import', { item_contexts: doc.item_contexts })).imported);

  // Filerne kan vaere store - én ad gangen, sa en enkelt aldrig sprænger loftet.
  for (const a of doc.attachments || []) {
    laeg((await api('POST', '/api/v1/import', { attachments: [a] })).imported);
  }
  return total;
}

function kopiér(tekst) {
  try {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(tekst);
    else {
      const t = document.createElement('textarea');
      t.value = tekst;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    toast('Copied');
  } catch { toast('Could not copy — select the text manually'); }
}

/* ------------------------------------------------------ Todoist-import */

/**
 * Todoist eksporterer ét projekt pr. CSV-fil. Man kan traekke dem alle ind
 * pa én gang.
 *
 * Data gaar gennem dodas EGEN fangst-parser, sa datoer, gentagelser og
 * kontekster tolkes af én motor - ikke to, der kan komme i utakt.
 */
async function todoistImport() {
  const felt = document.createElement('input');
  felt.type = 'file';
  felt.accept = '.csv,text/csv';
  felt.multiple = true;
  felt.addEventListener('change', async () => {
    const filer = [...felt.files];
    if (!filer.length) return;

    const laest = [];
    for (const f of filer) {
      laest.push(Object.assign(dodaTodoist.laesProjekt(await f.text(), f.name), { filnavn: f.name }));
    }
    visTodoistForhaandsvisning(laest);
  });
  felt.click();
}

function visTodoistForhaandsvisning(laest) {
  const ialt = laest.reduce((n, f) => n + f.items.length, 0);
  const advarsler = laest.flatMap((f) => f.warnings.map((w) => `${f.filnavn}: ${w}`));
  const brugbare = laest.filter((f) => f.items.length);

  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true">
    <h2>Import from Todoist</h2>
    ${ialt ? `<p class="lead" style="margin:6px 0 16px">${ialt} item${ialt === 1 ? '' : 's'}
      from ${brugbare.length} project${brugbare.length === 1 ? '' : 's'}. Nothing is saved until you confirm.</p>`
    : '<p class="lead" style="margin:6px 0 16px">Nothing to import from those files.</p>'}

    ${brugbare.map((f) => {
    const kontekster = [...new Set(f.items.flatMap((i) => i.contexts))];
    return `<div class="card" style="margin-bottom:8px;padding:14px 18px">
        <div style="font-weight:650">${esc(f.project)}</div>
        <div class="meta" style="text-transform:none;letter-spacing:0;margin-top:4px">
          ${f.items.filter((i) => i.kind === 'task').length} tasks ·
          ${f.items.filter((i) => i.kind === 'note').length} notes
          ${kontekster.length ? ` · contexts: ${kontekster.map((c) => `#${esc(c)}`).join(' ')}` : ''}
          ${f.skipped ? ` · ${f.skipped} skipped` : ''}
        </div>
        <div class="meta" style="text-transform:none;letter-spacing:0;margin-top:8px;opacity:.75">
          ${f.items.slice(0, 3).map((i) => esc(i.title)).join(' · ')}${f.items.length > 3 ? ' …' : ''}
        </div>
      </div>`;
  }).join('')}

    ${advarsler.length ? `<div class="nudge" style="margin-top:8px">${icon('next', 17)}
      <span>${advarsler.map(esc).join('<br>')}</span></div>` : ''}

    <p class="gate-note" style="text-align:left">Todoist's <strong>@labels</strong> become
    doda <strong>#contexts</strong> — the two apps use the symbols the other way round.
    Priorities are dropped on purpose: doda has no priority levels.</p>

    <div class="modal-foot">
      <span style="flex:1"></span>
      <button class="btn" id="tdCancel">Cancel</button>
      <button class="btn primary" id="tdGo"${ialt ? '' : ' disabled'}>Import ${ialt || ''}</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.querySelector('#tdCancel').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#tdGo').addEventListener('click', async () => {
    const knap = host.querySelector('#tdGo');
    knap.disabled = true;
    let n = 0;
    let fejl = 0;
    for (const f of brugbare) {
      for (const it of f.items) {
        try {
          // Samme endepunkt som al anden fangst - ingen saerlig importvej
          // ind i dataene.
          await api('POST', '/api/v1/capture', { text: dodaTodoist.somFangst(it), createNew: true });
          n++;
        } catch { fejl++; }
      }
      knap.textContent = `Imported ${n}…`;
    }
    luk();
    await genindlaes();
    tegnSide();
    toast(fejl ? `Imported ${n}, ${fejl} failed` : `Imported ${n} items from Todoist`);
  });
}

/* -------------------------------------------------- genvejsoversigten */

/* Handover §7: "Vis en oversigt over genvejene med ?". Den skal kunne naas
   overalt - ogsaa fra en liste, hvor bogstaverne ellers er optaget. */
const GENVEJE = [
  ['Anywhere', [
    ['any key', 'Start capturing — the palette opens with what you typed'],
    ['↑ ↓', 'Step into the list below, without opening anything'],
    ['?', 'This list'],
    ['esc', 'Close whatever is open'],
    ['⌘ enter', 'Save the open task, project or repeat'],
  ]],
  ['In the palette', [
    ['+', 'New task'], ['*', 'New note'],
    ['/', 'Jump to a project'], ['#', 'Jump to a context'], [':', 'Jump to an area'],
    ['↑ ↓', 'Move between results'], ['enter', 'Create or open'],
    ['backspace', 'Leave the mode when the field is empty'],
  ]],
  ['In a list', [
    ['↑ ↓', 'Move between items (or j / k)'],
    ['esc', 'Leave the list — letters go back to capturing'],
    ['enter', 'Open the item'],
    ['space', 'Mark it done'],
    ['n', 'Next Actions'], ['w', 'Waiting For'], ['s', 'Someday'],
    ['c', 'Set a context'], ['p', 'Set a project'],
    ['x', 'Delete'],
  ]],
];

function visGenveje() {
  if (document.getElementById('shortcutSheet')) return;
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'shortcutSheet';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <h2>Keyboard shortcuts</h2>
    <p class="lead" style="margin:6px 0 18px">Clarifying the inbox never needs the mouse.</p>
    ${GENVEJE.map(([gruppe, liste]) => `
      <div class="meta" style="margin:16px 0 8px">${esc(gruppe)}</div>
      <table class="shortcuts">${liste.map(([tast, hvad]) =>
    `<tr><td><kbd>${esc(tast)}</kbd></td><td>${esc(hvad)}</td></tr>`).join('')}</table>`).join('')}
    <div class="modal-foot"><span style="flex:1"></span>
      <button class="btn primary" id="scClose">Close</button></div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.querySelector('#scClose').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.querySelector('#scClose').focus();
}

// ? skal virke OVERALT - ogsaa i en liste, hvor bogstaverne er optaget af
// afklaringen. Derfor fanges den her, foer listens egne taster.
document.addEventListener('keydown', (e) => {
  if (!state.user || e.key !== '?') return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  e.preventDefault();
  e.stopPropagation();
  visGenveje();
}, true);

/* ------------------------------------------------------------- noter */

/**
 * Alle noter, grupperet efter projekt.
 *
 * Noter er reference og dukker aldrig op i handlingslisterne (DESIGN.md §3).
 * Uden denne skaerm kunne en note UDEN projekt kun findes ved at soege efter
 * den - den stod bogstaveligt talt ingen steder i menuen.
 *
 * Den hedder "Notes" og ikke GTD's "Reference", fordi appen allerede kalder
 * dem noter overalt: `*` opretter en note, detaljeruden siger "Make it a
 * note", ikonet er en note. To ord for det samme er ét for meget.
 */
async function sideNoter() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/items?kind=note');
  state.items = d.items;

  const hoved = `<div class="page-head"><h1>Notes</h1>
    <p class="lead">${esc(BESKRIVELSER.notes)}</p></div>`;

  if (!d.items.length) {
    host.innerHTML = `<section class="page">${hoved}
      <div class="empty">${icon('note', 34)}
        <p class="empty-title">No notes yet</p>
        <p>Start a capture with <strong>*</strong> — <code>* wifi password 1234</code> —
        or open a task and press <strong>Make it a note</strong>.</p></div>
    </section>`;
    return;
  }

  // Samme gruppering som Next Actions, bare efter projekt. "No project" er
  // sidst: en note uden projekt er ikke en fejl, bare uplaceret.
  const grupper = new Map();
  for (const it of d.items) {
    const p = it.project_id ? (state.projects.find((x) => x.id === it.project_id) || {}).name : null;
    const noegle = p || 'No project';
    if (!grupper.has(noegle)) grupper.set(noegle, []);
    grupper.get(noegle).push(it);
  }
  const sorteret = [...grupper.entries()].sort((a, b) => {
    if (a[0] === 'No project') return 1;
    if (b[0] === 'No project') return -1;
    return a[0].localeCompare(b[0]);
  });

  let n = 0;
  host.innerHTML = `<section class="page">${hoved}
    <p class="meta" style="margin-bottom:12px">${d.items.length} note${d.items.length === 1 ? '' : 's'}</p>
    <div data-keynav>
      ${sorteret.map(([navn, liste]) => `
        <h2 class="group meta">${esc(navn)} <span class="group-count">${liste.length}</span></h2>
        <div class="list">${liste.map((it) => elementRaekke(it, n++)).join('')}</div>`).join('')}
    </div>
    <p class="hintline meta">↑↓ select · enter open · esc leave</p>
  </section>`;
  bindListe();
}


/* Push-kortet i Settings. Siger hvad der mangler, frem for at vise en knap,
   der ikke kan virke. */
async function bindPush() {
  const boks = document.getElementById('pushBox');
  if (!boks) return;

  const spaerre = pushMuligt();
  if (spaerre) {
    boks.innerHTML = `<p class="lead" style="margin:12px 0 0">${esc(spaerre)}</p>`;
    return;
  }

  const tegn = (d, tilmeldt) => {
    boks.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">
        <button class="btn ${tilmeldt ? '' : 'primary'}" id="pushBtn">
          ${tilmeldt ? 'Turn off on this device' : 'Turn on for this device'}</button>
        <span class="meta">${d.devices} device${d.devices === 1 ? '' : 's'} connected</span>
      </div>
      <label class="field" style="margin-top:14px"><span>Send it</span>
        <select class="input" id="pushLead" style="max-width:260px">
          ${[['0', 'At the time'], ['5', '5 minutes before'], ['15', '15 minutes before'],
    ['30', '30 minutes before'], ['60', '1 hour before']]
    .map(([v, n]) => `<option value="${v}"${Number(v) === d.lead ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>`;

    boks.querySelector('#pushBtn').addEventListener('click', async () => {
      const knap = boks.querySelector('#pushBtn');
      knap.disabled = true;
      try {
        if (tilmeldt) { await slaaPushFra(); toast('Notifications off for this device'); }
        else { await slaaPushTil(); toast('Notifications on — this device will be reminded'); }
        await bindPush();
      } catch (ex) { toast(ex.message); knap.disabled = false; }
    });
    boks.querySelector('#pushLead').addEventListener('change', async (e) => {
      await api('POST', '/api/v1/push', { lead: e.target.value });
      toast('Saved');
    });
  };

  try {
    const d = await api('GET', '/api/v1/push');
    const reg = await navigator.serviceWorker.ready;
    tegn(d, !!(await reg.pushManager.getSubscription()));
  } catch (ex) {
    boks.innerHTML = `<p class="lead" style="margin:12px 0 0">${esc(ex.message)}</p>`;
  }
}

/* Notion-kortet i Settings. Tokenet sendes op, aldrig ned. */
/**
 * Sagu-forbindelsen i Settings.
 *
 * Samme moenster som Notion: adressen og noeglen gaar IND, og kun `connected`
 * kommer ud. Serveren proever noeglen, FOER den gemmer den, og ruller tilbage
 * ved fejl - ellers ligger en forkert noegle og ligner en virkende
 * forbindelse (RUNE-ERFARINGER, doda v16).
 */
async function bindSagu() {
  const boks = document.getElementById('saguBox');
  if (!boks) return;

  const tegn = (d) => {
    boks.innerHTML = d.connected
      ? `<div class="keyrow" style="margin-top:12px">
           <div class="keyrow-main">
             <div class="keyrow-name">Connected · ${esc(d.url)}</div>
             <div class="meta">${(d.notebooks || []).length} notebook${
  (d.notebooks || []).length === 1 ? '' : 's'} doda can file a note in</div>
           </div>
           <div class="keyrow-btns">
             <button class="btn ghost" id="sgNy">Refresh</button>
             <button class="btn ghost" id="sgOff">Disconnect</button>
           </div>
         </div>
         <label class="field" style="margin-top:12px"><span>Quick notes go in</span>
           <select class="input" id="sgBog">
             <option value="">No notebook</option>
             ${(d.notebooks || []).map((b) => `<option value="${esc(b.id)}"${
  b.id === d.notebook ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
           </select></label>
         <p class="gate-note" style="text-align:left">A note made from the palette
         (<code>*</code>) cannot ask where it should live — one keystroke has no room for a
         question. This is where those land. Linking a note to a task still lets you pick.</p>`
      : `<form id="sgForm" class="keyform" style="margin-top:12px">
           <input class="input" id="sgUrl" placeholder="https://sagu.example.com"
             autocomplete="off" spellcheck="false" required>
           <input class="input" id="sgKey" type="password" autocomplete="off"
             placeholder="sagu_… (a link key)" required>
           <button class="btn primary" type="submit">Connect</button>
         </form>
         <p class="gate-error" id="sgErr" hidden></p>`;

    const ny = boks.querySelector('#sgNy');
    if (ny) {
      ny.addEventListener('click', async () => {
        const foer = (d.notebooks || []).length;
        ny.disabled = true;
        ny.textContent = 'Refreshing…';
        try {
          const frisk = await api('POST', '/api/v1/sagu/refresh', {});
          const efter = (frisk.notebooks || []).length;
          tegn(frisk);
          // Sig hvad der SKETE. "Refreshed" alene lader brugeren gaette, om
          // knappen overhovedet gjorde noget (RUNE-ERFARINGER, MsGraphBud v8).
          const d2 = efter - foer;
          toast(d2 > 0 ? `${d2} new notebook${d2 === 1 ? '' : 's'} — ${efter} in total`
            : d2 < 0 ? `${-d2} notebook${d2 === -1 ? '' : 's'} gone — ${efter} left`
              : `No change — still ${efter} notebook${efter === 1 ? '' : 's'}`);
        } catch (ex) {
          // Listen staar uroert: en fejl her maa ikke tage notesboegerne fra
          // brugeren, fordi Sagu var nede et oejeblik.
          ny.disabled = false;
          ny.textContent = 'Refresh';
          toast(ex.message);
        }
      });
    }
    const fra = boks.querySelector('#sgOff');
    if (fra) {
      fra.addEventListener('click', async () => {
        // Sig hvad der SKER med det, der allerede findes - ellers toer man
        // ikke trykke (RUNE-ERFARINGER, doda v35).
        if (!window.confirm('Disconnect Sagu? The links on your tasks stay exactly where '
          + 'they are — they just stop showing the note.')) return;
        try { tegn(await api('DELETE', '/api/v1/sagu', {})); } catch (ex) { toast(ex.message); }
      });
    }
    const bog = boks.querySelector('#sgBog');
    if (bog) {
      bog.addEventListener('change', async () => {
        try {
          await api('POST', '/api/v1/sagu/notebook', { notebookId: bog.value });
          toast(bog.value ? `Quick notes go in ${bog.options[bog.selectedIndex].text}`
            : 'Quick notes will not be filed in a notebook.');
        } catch (ex) { toast(ex.message); }
      });
    }
    const form = boks.querySelector('#sgForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fejl = boks.querySelector('#sgErr');
        fejl.hidden = true;
        const knap = form.querySelector('button');
        knap.disabled = true;
        knap.textContent = 'Testing…';
        try {
          tegn(await api('POST', '/api/v1/sagu', {
            url: boks.querySelector('#sgUrl').value.trim(),
            key: boks.querySelector('#sgKey').value.trim(),
          }));
        } catch (ex) {
          fejl.textContent = ex.message;
          fejl.hidden = false;
          knap.disabled = false;
          knap.textContent = 'Connect';
        }
      });
    }
  };

  try { tegn(await api('GET', '/api/v1/sagu')); } catch { boks.innerHTML = ''; }
}

async function bindNotion() {
  const boks = document.getElementById('notionBox');
  if (!boks) return;

  const tegn = (d) => {
    boks.innerHTML = d.connected
      ? `<div class="keyrow" style="margin-top:12px">
           <div class="keyrow-main">
             <div class="keyrow-name">Connected${d.workspace ? ` · ${esc(d.workspace)}` : ''}</div>
             <div class="meta" id="ntSeen">checking what doda can see…</div>
           </div>
           <button class="btn ghost" id="ntOff">Disconnect</button>
         </div>`
      : `<form id="ntForm" class="keyform" style="margin-top:12px">
           <input class="input" id="ntToken" type="password" autocomplete="off"
             placeholder="ntn_… (internal integration secret)" required>
           <button class="btn primary" type="submit">Connect</button>
         </form>
         <p class="gate-error" id="ntErr" hidden></p>`;

    /* Det vigtigste svar paa "hvorfor kan doda ikke finde min side?" er,
       hvor mange sider den overhovedet kan se. En tom soegning giver alt,
       integrationen har adgang til - saa staar tallet der, og man behoever
       ikke gaette paa, om delingen er gaaet igennem. */
    const set = boks.querySelector('#ntSeen');
    if (set) {
      api('GET', '/api/v1/notion/search?q=').then((s) => {
        const n = s.pages.length;
        set.innerHTML = n
          ? `can see ${n}${n >= 12 ? '+' : ''} page${n === 1 ? '' : 's'} · e.g. ${esc(s.pages[0].title)}`
          : 'can see <strong>no pages yet</strong> — share one with the integration in Notion';
      }).catch(() => { set.textContent = 'could not ask Notion right now'; });
    }

    const af = boks.querySelector('#ntOff');
    if (af) {
      af.addEventListener('click', async () => {
        await api('DELETE', '/api/v1/notion', {});
        tegn({ connected: false });
        toast('Notion disconnected');
      });
    }
    const form = boks.querySelector('#ntForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fejl = boks.querySelector('#ntErr');
        fejl.hidden = true;
        try {
          // Serveren proever tokenet mod Notion, FOER den siger ja. Et token,
          // der ikke virker, maa ikke blive liggende og ligne en forbindelse.
          const d2 = await api('POST', '/api/v1/notion', { token: boks.querySelector('#ntToken').value });
          tegn(d2);
          toast(`Connected to Notion${d2.workspace ? ` · ${d2.workspace}` : ''}`);
        } catch (ex) { fejl.textContent = ex.message; fejl.hidden = false; }
      });
    }
  };

  try { tegn(await api('GET', '/api/v1/notion')); }
  catch (ex) { boks.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }
}

/* ---- p9_guide.js ---- */
'use strict';
/* doda - skaermen "Guide": en samlet gennemgang af appen, bygget som tingdos
   egen /settings/guide/. Formen derfra, indholdet fra doda.

   Tingdos opbygning, som denne foelger: store DELE (»How it works«,
   kommandobaren, tastaturet), inde i dem GRUPPER med et lille versalt maerke
   (CAPTURE, ACT, ORGANISE ...), og inde i dem EMNER med en kort indledning,
   et par raekker med et maerke i venstre side, og af og til en »In short«.

   Fem regler for indholdet:

   1. Guiden ma ALDRIG love mere end koden kan. En hjaelpetekst er en
      kravspecifikation - det er derfor "/projekt" stod i paletten i fire
      versioner uden at virke (RUNE-ERFARINGER, doda v9). Alt herunder er
      skrevet ud fra app/shared/parse.js og skaermenes egen adfaerd.
   2. doda er ikke tingdo. Fokus TAGER ikke tid (der er ingen registrering),
      der er ingen "Scheduled"-liste, og gentagelser findes kun her. Skriv
      dodas virkelighed, ikke forlaeggets.
   3. Ingen tekst gentages, hvis den findes ét sted i forvejen: syntaksen
      kommer fra syntaksTabel(), genvejene fra GENVEJE - og en tast, der staar
      i tastatur-afsnittet, gentages ikke oppe i emnerne.
   4. ÉN paastand pr. raekke, én saetning pr. indledning. Teksten er det eneste
      i denne fil, der koster plads i install-scriptet: maalt med leave-one-out
      fylder guidens tekst 6.274 tegn og dens CSS 364. Hver begrundelse, der
      kan undvaeres, er derfor plads til en funktion senere.
   5. Hvert EMNE er en <h2>, saa sideoversigten i hoejre kant bygger sig selv
      (byggToc laeser netop h2 i #pageHost) - den er guidens indholdsfortegnelse
      og skulle ikke bygges. */

/*
 * Maerket i venstre side er enten en TAST eller MARKOER (monospace, ordret)
 * eller en TILSTAND (versal etiket, som chipsene i detaljeruden).
 *
 * Afgoerelsen skal traeffes paa teksten selv, ikke paa dens laengde: etiketten
 * er skrevet med versaler i kilden, og alt andet er noget, brugeren skal kunne
 * taste af. Med en laengderegel blev "!every monday" til en etiket - og
 * `text-transform: uppercase` gjorde den til "!EVERY MONDAY", altsaa en
 * syntaks, der ikke findes. Et maerke uden bogstaver ("+", "//", "~") er
 * altid en markoer.
 */
function guideMaerke(t) {
  const erEtiket = /[a-zA-Z]/.test(t) && t === t.toUpperCase();
  return erEtiket
    ? `<span class="guide-tag">${esc(t)}</span>`
    : `<code class="guide-key">${esc(t)}</code>`;
}

/*
 * Indledningen og knap-raekken har faste afstande: klasser, ikke 25 inline-styles.
 *
 * Et emne uden raekker faar intet kort - men skal stadig kunne have sin knap,
 * ellers forsvinder »Open Logbook«, i samme oejeblik raekken over den skaeres
 * vaek. En betingelse, der bortkaster to ting paa én gang, er en faelde.
 */
function guideEmne(e) {
  const krop = (e.raekker || []).map(([m, tekst]) => `<div class="guide-row">
        <div class="guide-badge">${guideMaerke(m)}</div>
        <div class="guide-text">${tekst}</div></div>`).join('')
    + (e.kort ? `<p class="guide-short"><strong>In short:</strong> ${e.kort}</p>` : '');
  const knapper = e.go ? guideGo(e.go) : '';
  return `<h2>${esc(e.titel)}</h2>
    <p class="lead guide-lead">${e.lead}</p>
    ${krop ? `<div class="card guide-card">${krop}${knapper}</div>` : knapper}`;
}

function guideGo(liste) {
  return `<div class="guide-go">${liste.map(([v, t]) =>
    `<button class="btn ghost" data-guide-go="${esc(v)}">${esc(t)}</button>`).join(' ')}</div>`;
}

/* ------------------------------------------------------------ indholdet */

const GUIDE_DELE = [
  {
    del: 'How doda works',
    lead: 'The method is Getting Things Done: one place you trust, so your head can stop keeping track.',
    grupper: [
      {
        gruppe: 'Capture',
        emner: [
          {
            titel: 'The inbox',
            lead: 'Capture first, decide later. A title is all it needs.',
            raekker: [
              ['any key', 'On any screen, start typing and the command bar opens with what you typed.'],
              ['+', 'A task, said explicitly. Plain text does the same.'],
              ['*', 'A note. It lands in Notes and never joins an action list.'],
              ['//', 'Everything after <code> // </code>, or after a line break, becomes the description.'],
              ['WHERE', 'The screen fills in what your text left out: on Waiting For or Someday it lands there, on a project page it joins that project, on a context-filtered list it carries that context. A chip says so before you press Enter, and anything you write yourself wins.'],
            ],
            kort: 'an empty inbox is the goal — not today, but over time.',
            go: [['inbox', 'Open Inbox']],
          },
          {
            titel: 'Emptying the inbox',
            lead: 'Open an item and ask one thing: is this actionable?',
            raekker: [
              ['YES', 'Give it a context and move it to Next Actions.'],
              ['NO', 'Then it is a Someday idea, a note, or nothing at all.'],
              ['REVIEW', 'The weekly review walks the inbox one item at a time.'],
            ],
          },
        ],
      },
      {
        gruppe: 'Act',
        emner: [
          {
            titel: 'Next Actions',
            lead: 'What you can do right now, grouped by context.',
            raekker: [
              ['#', 'The chips above the list narrow it to one context.'],
              ['~', '<code>~in 2 weeks</code> hides a task until then. Not late — just not yet.'],
              ['!', '<code>!friday</code> is a real deadline, and the only thing that reaches your calendar.'],
            ],
            go: [['next', 'Open Next Actions']],
          },
          {
            titel: 'What you can set on a task',
            lead: 'The fields are chips you press, and none of them are required.',
            raekker: [
              ['PROJECT', 'The outcome it belongs to.'],
              ['STATUS', 'Next Actions, Waiting For, Someday — or back to the inbox.'],
              ['DATE', 'A deadline, and separately a day to hide it until.'],
              ['#', 'Contexts. Typing <code>#name</code> in the title works here too.'],
              ['FOCUS', 'One task, everything else out of the way.'],
            ],
          },
        ],
      },
      {
        gruppe: 'Organise',
        emner: [
          {
            titel: 'Projects',
            lead: 'Any outcome that takes more than one step. Write <code>@Name</code> while capturing and it exists.',
            raekker: [
              ['DONE', 'A field for what done looks like — writing it is often where the next step appears.'],
              ['NEXT', 'A project with open work but no next action says so quietly.'],
              ['↑ ↓', 'Order tasks by hand. The buttons work with a thumb as well as a mouse.'],
              ['DROP', 'Dropping a project takes its open tasks with it; finished ones are never touched.'],
            ],
            go: [['projects', 'Open Projects']],
          },
          {
            titel: 'Areas',
            lead: 'A part of life you keep going. There is nothing to complete.',
            raekker: [
              [':', 'One level above projects: the half marathon ends, the health it serves does not.'],
              ['GROUP', 'Projects are grouped by area, so many projects still read as a few responsibilities.'],
            ],
            kort: 'a project is something you finish, an area is something you maintain.',
          },
          {
            titel: 'Contexts',
            lead: 'The situation you are in: <code>#calls</code>, <code>#computer</code>, <code>#errands</code>.',
            raekker: [
              ['#', 'Filter by situation, not by topic — topic is what projects are for.'],
              ['NEW', 'An unknown context is confirmed with one extra Enter, so a typo never becomes a list.'],
            ],
            kort: 'the project says why, the context says when.',
            go: [['contexts', 'Open Contexts']],
          },
        ],
      },
      {
        gruppe: 'Park and keep',
        emner: [
          {
            titel: 'Waiting For',
            lead: 'What you handed to someone else. You are waiting, not working.',
            raekker: [
              ['NAME', 'Put the person in the title, so the list reads as who owes you what.'],
              ['!', 'A follow-up date keeps the handoff in view.'],
            ],
          },
          {
            titel: 'Someday',
            lead: 'Parked without a commitment. Nothing here nags.',
            raekker: [
              ['s', 'Park it the moment you know it is not next.'],
              ['REVIEW', 'The weekly review is where this list is read again.'],
            ],
          },
          {
            titel: 'Notes',
            lead: 'Things you keep, not things you owe. Markdown, and never in an action list.',
            raekker: [
              ['*', 'Type <code>*</code> in the command bar to file one.'],
              ['SWAP', 'A note can become a task and go back again, losing nothing.'],
            ],
            go: [['notes', 'Open Notes']],
          },
          {
            titel: 'Recurring',
            lead: 'Todoist’s syntax, where a <code>!</code> right after <em>every</em> is the whole difference.',
            raekker: [
              ['!every monday', '<strong>Fixed schedule.</strong> It comes around on its date either way.'],
              ['!every! monday', '<strong>From completion.</strong> The next one appears when you finish this one.'],
              ['MORE', '<code>!every 3 days · !every mon, thu · !every weekday at 16 · !every month on the 3rd · !last workday of the month</code>'],
              ['SKIPS', 'An overdue schedule rolls forward and the skips are counted — that number is how you notice a habit is not working.'],
            ],
            kort: 'never more than one open occurrence, and it stays invisible until it is current.',
            go: [['repeat', 'Open Recurring']],
          },
        ],
      },
      {
        gruppe: 'Focus and review',
        emner: [
          {
            titel: 'Focus',
            lead: 'One task, everything else stepped back.',
            raekker: [
              ['TIMER', 'It starts itself and survives closing the app: what is kept is when you began.'],
              ['none', 'Nothing is recorded and nothing is reported.'],
              ['esc', 'Leave again. The task is unchanged.'],
            ],
          },
          {
            titel: 'The weekly review',
            lead: 'Six steps: inbox, projects, Waiting For, Someday, the skipped recurrences, the week.',
            raekker: [
              ['SPEED', 'Inbox and projects, nothing else.'],
              ['SIMPLE', 'Every list, one at a time.'],
              ['FOCUSED', 'Pick this week’s projects first, then go all the way through.'],
              ['PAUSE', 'Stop halfway and the step waits on the server — another device continues it.'],
            ],
            kort: 'pick a weekday and doda shows a quiet band that day. A band, not a push: the real deadlines already leave through your calendar.',
            go: [['review', 'Open Review']],
          },
          {
            titel: 'Logbook',
            lead: 'What you finished, day by day. No numbers, no graphs, no score — the point is overview, not measurement.',
            go: [['log', 'Open Logbook']],
          },
        ],
      },
    ],
  },
  {
    del: 'The command bar',
    lead: 'One field that finds, creates and navigates. Creating is always the top result, so searching never gets in the way of a thought.',
    grupper: [
      {
        gruppe: 'Using it',
        emner: [
          {
            titel: 'Open and close',
            lead: 'It opens by itself the moment you type, wherever you are.',
            raekker: [
              ['any key', 'Opens with the character you typed already in it.'],
              ['/', 'Opens it empty.'],
              ['esc', 'Closes it.'],
              ['⌫', 'On an empty field, leaves the mode you were in.'],
            ],
          },
          {
            titel: 'Modes',
            lead: 'The first character picks a mode, and the pill inside the field shows which.',
            raekker: [
              ['+', 'New task.'],
              ['*', 'New note.'],
              ['/', 'Projects — find, jump to, or create.'],
              ['#', 'Contexts — the same.'],
              [':', 'Areas — the same.'],
            ],
          },
          {
            titel: 'While you capture',
            lead: 'Markers can stand anywhere in the line, and the chips show how each was understood.',
            syntaks: true,
            kort: 'a marker has to touch its word (<code>#home</code>, not <code># home</code>) — that is what keeps <code>you@example.com</code> from becoming a project.',
          },
          {
            titel: 'Dates',
            lead: 'Both languages work, and a date doda cannot read never blocks the capture — the item is created anyway.',
            raekker: [
              ['!tomorrow', 'Also <code>!today</code>, <code>!friday</code>, <code>!next week</code>.'],
              ['!in 2 weeks', 'Days, weeks or months from today. <code>!om 2 uger</code> does the same.'],
              ['!3/9', '<code>!3/9-2027</code>, <code>!3 sep</code> and <code>!sep 3 at 9</code> all land.'],
              ['~', 'The same words, but for hiding a task until that day.'],
            ],
          },
          {
            titel: 'In a title you edit',
            lead: 'The markers keep working afterwards: they move into the fields when you leave the field.',
            raekker: [
              ['KEEP', 'Only what was understood is removed. “Remember !important” stays as you wrote it.'],
              ['NEW', 'A name that does not exist yet shows as “— new” and is created when you save.'],
              ['RULE', 'In a recurring task the rule is the one thing a title never touches.'],
            ],
          },
        ],
      },
    ],
  },
  {
    del: 'Keyboard',
    lead: 'The keys outside the command bar. Clarifying the inbox never needs the mouse.',
    grupper: [{
      gruppe: '',
      emner: [{
        titel: 'All the keys',
        lead: 'Press <code>?</code> anywhere to see this same list without leaving what you are doing.',
        genveje: true,
      }],
    }],
  },
  {
    del: 'Beyond the browser',
    lead: 'doda is one file on your own server, and everything it can do is reachable from outside it.',
    grupper: [
      {
        gruppe: 'Everyday',
        emner: [
          {
            titel: 'On your phone, and without a signal',
            lead: 'In Safari, <strong>Share → Add to Home Screen</strong>: full screen, own icon, no address bar.',
            raekker: [
              ['READ', 'Offline you can still read your lists as they were, and a mark says so.'],
              ['QUEUE', 'Capturing, ticking off, moving and deleting are queued and sent in order when there is a signal.'],
              ['https', 'Home screen and offline need https — a browser rule, not a choice.'],
            ],
          },
          {
            titel: 'Reminders',
            lead: 'They come through your calendar: Settings → Calendar subscription gives you an address it can follow.',
            raekker: [
              ['IPHONE', 'The subscription must have <em>Remove Alarms</em> switched <strong>off</strong>, or iOS strips the alarm silently.'],
              ['ONLY', 'The feed carries deadlines — never your whole list, and never your notes.'],
              ['PUSH', 'Web Push is there instead, under Notifications. On iPhone only once doda is on the home screen.'],
            ],
          },
          {
            titel: 'Files, links and Notion',
            lead: 'Drag files onto an open item, or press <strong>Add images or files</strong>.',
            raekker: [
              ['25 MB', 'The limit per file. Files live in the data folder, so the panel’s backup has them.'],
              ['SAFE', 'Only ordinary image formats are shown inline; everything else is a plain download.'],
              ['LINK', 'Connect Notion and you can search for a page from here, and unfold it. doda keeps no copy.'],
            ],
          },
        ],
      },
      {
        gruppe: 'For other clients',
        emner: [
          {
            titel: 'Keys, Siri and Claude',
            lead: 'The web interface uses the same <code>/api/v1/</code> API as everything else — there is no back door.',
            raekker: [
              ['SCOPE', 'Pick the narrowest key that solves the job: a capture key cannot read a single task.'],
              ['SIRI', 'The capture endpoint takes a plain line of text, so a Shortcut needs one field.'],
              ['MCP', 'Claude connects on <code>/mcp</code> with the same keys and scopes, and can be revoked under Connected apps.'],
            ],
          },
          {
            titel: 'Your data',
            lead: 'Settings → Your data. Everything is one open JSON file, and import matches on id, so the same file can run twice.',
            raekker: [
              ['SECRET', 'The calendar address is left out of an export — it is a file you might pass on.'],
              ['BACKUP', 'For a copy of everything, including the database, use the panel’s backup.'],
            ],
            go: [['settings', 'Open Settings']],
          },
        ],
      },
    ],
  },
];

function sideGuide() {
  return `<section class="page">
    <div class="page-head">
      <h1>Guide</h1>
      <p class="lead">${esc(BESKRIVELSER.guide)}</p>
    </div>
    ${GUIDE_DELE.map((d) => `
      <div class="guide-part">
        <div class="guide-part-name">${esc(d.del)}</div>
        <p class="lead" style="margin:0">${esc(d.lead)}</p>
      </div>
      ${d.grupper.map((g) => `
        ${g.gruppe ? `<div class="guide-group">${esc(g.gruppe)}</div>` : ''}
        ${g.emner.filter((e) => e.titel !== 'Notes' || state.notesEnabled).map((e) => {
    if (e.syntaks) {
      return `<h2>${esc(e.titel)}</h2><p class="lead guide-lead">${e.lead}</p>
        <div class="card">${syntaksTabel()}
          <p class="guide-short"><strong>In short:</strong> ${e.kort}</p></div>`;
    }
    if (e.genveje) {
      return `<h2>${esc(e.titel)}</h2><p class="lead guide-lead">${e.lead}</p>
        <div class="card">${GENVEJE.map(([gruppe, liste]) => `
          <div class="meta" style="margin:14px 0 8px">${esc(gruppe)}</div>
          <table class="shortcuts">${liste.map(([tast, hvad]) =>
    `<tr><td><kbd>${esc(tast)}</kbd></td><td>${esc(hvad)}</td></tr>`).join('')}</table>`).join('')}</div>`;
    }
    return guideEmne(e);
  }).join('')}`).join('')}`).join('')}
  </section>`;
}

function bindGuide() {
  document.querySelectorAll('[data-guide-go]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.guideGo));
  });
}
