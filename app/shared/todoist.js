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
