/* doda - minimal, sikker markdown.
 *
 * Laa i app/parts/p4_projects.js, indtil Sagu-noterne kom til at fylde her: en
 * note skrevet i en note-app bruger afkrydsningslister, overskrifter midt i
 * teksten og billeder, og alt det stod som RAA markdown-kode (Andreas,
 * 25-08-2026). Med flere blokformer bliver en renderer af FREMMED tekst
 * hurtigt et sted, hvor fejl - ogsaa sikkerhedsfejl - kan gemme sig, og en
 * frontend-fil kan ikke proeves i Node.
 *
 * Derfor her, UMD-pakket som resten af app/shared/: én forstaaelse af
 * formatet, og tests der kan koere den.
 *
 * `esc` og `linkify` INJICERES i stedet for at blive kopieret herind. Samme
 * modulgraense som oauth.js og mcp.js (RUNE-ERFARINGER §9a): to steder, der
 * escaper hver for sig, driver fra hinanden, uden at nogen opdager det.
 *
 * SIKKERHEDEN hviler paa ét princip: escape FOERST, byg derefter kun de tags,
 * vi selv skriver. Der er ingen vej fra brugerens tekst til et tag, vi ikke
 * har lavet - heller ikke gennem et `alt`, en adresse eller en overskrift.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.dodaMarkdown = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AFKRYDS = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;
  const PUNKT = /^\s*[-*+]\s+(.*)$/;
  const NUMMER = /^\s*\d+[.)]\s+(.*)$/;
  const CITAT = /^\s*>\s?(.*)$/;
  const OVERSKRIFT = /^(#{1,4})\s+(.+)$/;
  const BILLEDE = /!\[([^\]\n]{0,120})\]\(([^)\s]{1,500})\)/g;

  /* Sagus egen filadresse. Kun 32 hex - alt andet er ikke en Sagu-fil, og en
     loesere proeve ville lade en NOTE bestemme, hvad serveren henter. */
  const SAGU_FIL = /^sagu:([a-f0-9]{32})$/i;

  /**
   * @param {string} raa       teksten
   * @param {function} esc     escaper < > & " - skal komme FOER alt andet
   * @param {function} linkify escaper OG laver links (dodas egen)
   * @param {function} [filUrl] `<id>` -> en adresse, doda selv kan hente.
   *                            Udelades den, vises billedet som en maerkat.
   */
  function render(raa, esc, linkify, filUrl) {
    const linjer = String(raa == null ? '' : raa).split('\n');
    const ud = [];
    let i = 0;

    while (i < linjer.length) {
      const l = linjer[i];
      if (!l.trim()) { i++; continue; }

      /*
       * Overskriften staar for sig selv, uanset hvad der FOELGER.
       *
       * Foer skulle den vaere alene i sin blok, og en note skrevet uden tom
       * linje under overskriften - den normale maade at skrive en liste af
       * noegler paa - fik derfor sine `##` vist som tekst.
       */
      const h = l.match(OVERSKRIFT);
      if (h) {
        const n = h[1].length + 2;
        ud.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>');
        i++;
        continue;
      }

      // Afkrydsning FOER punktliste: "- [ ] x" matcher begge, og den mest
      // specifikke skal vinde.
      if (AFKRYDS.test(l)) {
        const punkter = [];
        while (i < linjer.length && AFKRYDS.test(linjer[i])) {
          const m = linjer[i].match(AFKRYDS);
          punkter.push({ krydset: m[1] !== ' ', tekst: m[2] });
          i++;
        }
        ud.push('<ul class="tjekliste">' + punkter.map(function (p) {
          /*
           * DEAKTIVERET, og det er ikke dovenskab. Noten hoerer til i Sagu;
           * doda kigger med. Et felt, man kan klikke paa, uden at det bliver
           * gemt, er vaerre end et, man ikke kan klikke paa - man ville tro,
           * det var afkrydset.
           */
          return '<li class="tjek">'
            + '<input type="checkbox" disabled' + (p.krydset ? ' checked' : '') + '>'
            + '<span' + (p.krydset ? ' class="krydset"' : '') + '>' + inline(p.tekst) + '</span>'
            + '</li>';
        }).join('') + '</ul>');
        continue;
      }

      if (PUNKT.test(l)) {
        const punkter = [];
        while (i < linjer.length && PUNKT.test(linjer[i]) && !AFKRYDS.test(linjer[i])) {
          punkter.push(linjer[i].match(PUNKT)[1]);
          i++;
        }
        ud.push('<ul>' + punkter.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ul>');
        continue;
      }

      if (NUMMER.test(l)) {
        const punkter = [];
        while (i < linjer.length && NUMMER.test(linjer[i])) {
          punkter.push(linjer[i].match(NUMMER)[1]);
          i++;
        }
        ud.push('<ol>' + punkter.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ol>');
        continue;
      }

      if (CITAT.test(l)) {
        const rk = [];
        while (i < linjer.length && CITAT.test(linjer[i])) {
          rk.push(linjer[i].match(CITAT)[1]);
          i++;
        }
        ud.push('<blockquote>' + inline(rk.join('\n')) + '</blockquote>');
        continue;
      }

      const afsnit = [];
      while (i < linjer.length && linjer[i].trim()
        && !OVERSKRIFT.test(linjer[i]) && !PUNKT.test(linjer[i])
        && !NUMMER.test(linjer[i]) && !CITAT.test(linjer[i])) {
        afsnit.push(linjer[i]);
        i++;
      }
      ud.push('<p>' + inline(afsnit.join('\n')) + '</p>');
    }

    return ud.join('');

    /*
     * Billederne skaeres UD af teksten foerst - ikke erstattet af en
     * pladsholder.
     *
     * `linkify` matcher `[navn](adresse)`, og det moenster staar inde i
     * `![navn](adresse)`: uden dette blev et billede til et link med et loest
     * udraabstegn foran. En pladsholder ville skulle vaere et tegn, brugeren
     * ikke kan skrive; at dele strengen har ingen saadan forudsaetning.
     */
    function inline(t) {
      const s = String(t);
      let ud2 = '';
      let sidst = 0;
      BILLEDE.lastIndex = 0;
      let m;
      while ((m = BILLEDE.exec(s)) !== null) {
        ud2 += formater(s.slice(sidst, m.index));
        ud2 += billedTag(m[1], m[2]);
        sidst = m.index + m[0].length;
      }
      return ud2 + formater(s.slice(sidst));
    }

    function formater(t) {
      if (!t) return '';
      let s = linkify(t);
      s = s.replace(/`([^`\n]{1,200})`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*\n]{1,200})\*/g, '$1<em>$2</em>');
      return s.replace(/\n/g, '<br>');
    }

    /*
     * Et Sagu-billede vises RIGTIGT - gennem dodas egen server, som har
     * noeglen (Andreas bad om det 25-08-2026).
     *
     * Alt andet bliver en maerkat. En adresse ude i verden ville sende
     * brugerens IP til et fremmed websted, blot fordi noten naevnte det.
     * Maerkaten siger, at der ER et billede; noten selv er ét klik vaek.
     *
     * `alt` og adressen kom aldrig gennem escapen - de escapes her.
     */
    function billedTag(raaAlt, raaUrl) {
      const alt = esc(String(raaAlt || '').slice(0, 120));
      const m = String(raaUrl || '').match(SAGU_FIL);
      if (m && typeof filUrl === 'function') {
        const url = filUrl(m[1].toLowerCase());
        if (url) {
          return '<img class="mdbillede" src="' + esc(url) + '" alt="' + alt + '" loading="lazy">';
        }
      }
      return '<span class="mdbillede-maerkat">' + (alt || 'image') + '</span>';
    }
  }

  return { render };
}));
