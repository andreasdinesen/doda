# Handover — hvad der mangler i doda

**Til:** Claude Code i en ny session
**Skrevet:** 2026-08-17, efter v7 blev pushet.

> **Start med at læse, i denne rækkefølge:**
> 1. `~/ClaudeMacBook/RUNE-ERFARINGER.md` — fælles lærepenge for alle runer.
>    Læs den **før og efter** arbejdet, og skriv nye generelle lærdomme ind nederst.
> 2. `CLAUDE.md` i dette repo — konventioner og faste regler.
> 3. `DESIGN.md` — alle trufne beslutninger. Ændres noget, rettes det **her først**.
> 4. Denne fil.

---

## Tilstand lige nu

**v8 er udgivet.** Alt fra 16.–17. august er ude: connectoren til claude.ai
(v5 + v6-rettelsen), skallen (v7) og slette-rettelsen (v8). Arbejdsmappen er ren.

`node --test tests/*.mjs` → **139 grønne**. `python3 build_rune.py` → 94 % af loftet.

### To ting fra v8, der er værd at kende

**Slette-fejlen var usynlig, indtil genvejen blev brugbar.** `opdaterItem()`
slutter med at læse rækken frisk gennem `hentItem()`, som filtrerer
`deleted = 0` fra. Efter en sletning returnerede den derfor **altid** `null`, og
DELETE-ruten svarede 404 »not found« på en sletning, der lykkedes. Frontenden
viste fejlen og sprang `genindlaes()` over, så rækken blev stående, selvom den
var væk i databasen. Fejlen havde ligget der hele tiden — `x` kunne bare ikke
nås uden at åbne opgaven først, før v7 gjorde tastaturet brugbart.
**Generelt: en funktion, der returnerer rækken frisk efter en opdatering, kan
ikke rapportere en række, den lige har gjort usynlig.**

**Sideoversigten i højre side folder først ud efter et klik — det er ikke doda.**
Den eneste regel, der folder den ud, er `.toc:hover`; der findes ingen
klik-handler. Når et klik får den til at virke, er det hover, der endelig når
frem: macOS sender ikke `mousemove` til et browservindue, der ikke er aktivt.
Andreas skulle prøve at klikke ét sted i vinduet og derefter kun bevæge musen.
Melder han, at det stadig ikke virker, er næste skridt en klik-låst tilstand
(`.toc.aaben`) — den har han sagt nej til indtil videre.

## Pladsen i runen — vær opmærksom

Install-scriptet må højst fylde **126.000 tegn** (hævet fra 120.000 i v7 efter
aftale). Det fylder nu **119.575 (94 %)**, og build'et **fejler højt** ved
loftet — det er en assert, ikke en advarsel.

Den rigtige grænse er Linux' `MAX_ARG_STRLEN` på 131.072 b; margenen skal kun
dække panelets `{{VARIABEL}}`-udskiftninger, som er få og korte. **Hævningen er
en udsættelse, ikke en løsning** — der er plads til en funktion eller to.
`PLAN.md` har de målte muligheder, når den fejler igen. Kort:

- `app/public/icon-192.png` frigør **2.815 tegn**, men er iOS'
  `apple-touch-icon` — fjern den ikke, uden at Andreas har accepteret, at
  hjemmeskærms-ikonet på iPhone bliver et fallback.
- Serveren kan tegne ikonet ved opstart (~1.900 netto, ~40 linjers PNG-encoder).
- CSS'en (39 KB) er det største enkeltstående tekstaktiv.

## Faste regler, der IKKE må brydes

- **Commit og push kræver Andreas' udtrykkelige ja.** Et push er en udgivelse.
- **`APP_VERSION` bumpes kun ved udgivelse**, ét sted: `app/parts/p1_core.js`.
  Build stempler den i `index.html`, `sw.js` og runens `version:`.
- **Nul npm-pakker.** Det er både arkitektur og sikkerhedsvalg.
- `runes/doda.yaml` og `app/public/app.js` er **genererede** — redigér aldrig.
- Kør `python3 build_rune.py` efter hver ændring i `app/`.
- Interfacet er **engelsk**; kode, kommentarer og dokumenter er **dansk**.
- Lokal kørsel: `DODA_DEV=1 BIND_PORT=8910 DATA_DIR=/tmp/dodadata node app/server.js`
  (`DODA_DEV=1` slår asset-cachen fra — uden den ser man ikke sine egne ændringer).

---

## Fælder, der allerede er betalt for

Gentag dem ikke — og læs `RUNE-ERFARINGER.md`, hvor de står udførligt:

- **`PORT_<navn>` er HOST-porten.** Bind serveren til `BIND_PORT || 3000` og
  intet andet. v2 var utilgængelig af den grund, og **intet fejlede højlydt**.
- **Service workers kan ikke registreres i Claude Codes browser-panel.** Det
  fejler også mod en helt nøgen server. Test med en nøgen server først.
- **CSP'en kræver `worker-src 'self'`** — ellers blokerer man sin egen SW.
- **CORS og `Cross-Origin-Resource-Policy: same-origin` slås.** De offentlige
  OAuth-ruter går derfor uden om `securityHeaders()`.
- **Service workeren må kun cache app-skallen under `'./'`.** Uden `pathname ===
  '/'`-vagten endte samtykkesiden som det, man fik at se offline.
- **PNG komprimeres ikke af brotli.** Alt binært koster fuld pris i payloaden.
- **`programmatisk .focus()` udløser ikke fokus-hændelsen** i browser-panelet.
- **Skriv aldrig rå kontroltegn i et regex** — filen bliver binær, og `grep`
  holder op med at finde noget i den.

---

## Hvad der stadig venter på Andreas, ikke på dig

1. Bekræfte offline-læsning og hjemmeskærm **på sin telefon** — service
   worker-registreringen kunne ikke verificeres her.
2. Prøve **Todoist-importen** på en rigtig eksport.
3. Sende en **tingdo-eksport**, hvis den import stadig ønskes — formatet er ukendt.
4. **Prøve connectoren mod den rigtige claude.ai** — flowet er testet ende til
   ende mod en rigtig server lokalt, men ikke mod Anthropics klient. Går noget
   galt, er det næsten altid opdagelsen: `curl -si https://doda.hjorten.eu/mcp
   -d '{}' -H 'Content-Type: application/json' | grep -i www-authenticate`.
