# doda — faldgruber, kendte huller og faste værn

> Reddet fra de gamle plan- og overdragelsesfiler (v1–v99) og tjekket mod koden ved v101.
> De generelle lærepenge (PORT_-fælden, CORS/CORP, `form-action`, browser-panelets
> `visibilityState`/`setTimeout`/tom `e.key`, `textarea`-mindstebredden, rå kontroltegn i
> regex, PNG i brotli, leave-one-out-målinger) står i `~/ClaudeMacBook/RUNE-ERFARINGER.md`
> og gentages ikke her.

## Det, der har kostet mest i denne kodebase

1. **Lover interfacet noget, skal koden holde det.** `/projekt` stod i paletten i fire
   versioner uden at virke. Læs en legende eller hjælpetekst som en kravspecifikation.
2. **Mål efter animationen, ikke under den** — `getBoundingClientRect()` lige efter en
   klasseændring lyver under en CSS-transition.
3. **Test *vejen* til en funktion.** Slette-fejlen (v8: `opdaterItem()` læste rækken
   gennem `hentItem()`, der filtrerer `deleted = 0`, og svarede 404 på en lykket sletning)
   lå i otte udgivelser, fordi testene kaldte `slet()` direkte.
4. **Se testen fejle på den gamle kode**, før du tror på den.
5. **En optimistisk opdatering, der fjerner det fokuserede element**, bryder ethvert værn,
   der spørger `document.activeElement` (v27→v29: `s` på den SIDSTE række). Afprøv med
   præcis én række tilbage.
6. **En nulstilling bag »kun hvis skærmen skifter« svigter i en undertilstand** (v32:
   et åbent projekt gjorde sidebaren og »← Projects« døde). Afprøv en navigation fra den
   skærm, den fører til.

**Arbejdsvane:** samler du flere `str.replace()` i ét Python-script, og en sen `assert`
fejler, kasseres *hele* filen — også de erstatninger, der lykkedes. Det skete tre gange.
Brug Edit-værktøjet, eller skriv filen efter hvert trin.

## Kendte huller (bevidste)

- **`%` virker ikke gennem MCP.** Parseren forstår markøren, men `app/mcp.js`'
  dispatcher kaldes synkront, og en tidtagning kræver en rundtur til tovo. Værktøjet
  SIGER det i stedet for at sluge markøren. Skal det lukkes, skal dispatcheren kunne await'e.
- **doda omdøber aldrig en opgave i tovo.** tovos `POST /api/v1/items` gemmer en HEL
  opgave, så en titel-only-skrivning ville slette estimat, note, kolonne og links
  (`app/tovo.js`). Det står i indstillingskortet.
- **Ingen tingdo-import** — formatet er ukendt. Kommer der en eksportfil, bygges den mod den.
- **Flere brugere** er undersøgt (2026-08-17), ikke besluttet. Undersøgelsen ligger i
  git-historikken (commit `0753b09`); se `DESIGN.md §7`.

## Faste værn i koden (rør dem ikke uden grund)

- **Adgangsnøgler** (`SCOPE_TILLADER` i server.js): `capture` kan kun oprette (403 på al
  læsning), `read` kun læse, `full` alt. **Ingen nøgle kan lave nye nøgler eller skifte
  kodeord** (401 `session_required`). Kun sha256 gemmes. MCP's `tools/list` viser kun det,
  scopet tillader, og scopet håndhæves igen ved kaldet.
- **Hemmelige indstillinger** skal i `HEMMELIGE_SETTINGS` — `GET /api/v1/settings` gav
  hemmeligheder til enhver `read`-nøgle indtil v16. Et endepunkt, der returnerer »alt i en
  tabel«, er en tidsindstillet lækage.
- **Upload** streamer uden om `readJsonBody` og har derfor sit eget CSRF-værn: en
  browsersession skal sende `X-Doda-Upload: 1` (nøgler er fritaget).
- **Vedhæftninger**: egen tabel og `/data/files/`, aldrig indhold i `items`; listerne får
  kun `attachment_count`. 25 MB pr. fil, 2 GB samlet. Kun billeder inline — PDF og SVG
  tvinges til `octet-stream` + `attachment` (en SVG kan bære script). Aldrig filindhold
  gennem MCP.
- **Eksport** `?files=1` har en hård spærre ved 150 MB med en besked, der peger på panelets
  backup (Kokkeri gik ned med 247,9 MB i ét svar). **Import** er idempotent på id og kører i
  portioner.
- **iCal-feedet** har kun ting med deadline, `TZID=Europe/Copenhagen` (ikke UTC), rammer
  indekset `items_forfald` (kalendere poller hvert kvarter), og et forkert token giver 404
  uden at røbe, at feedet findes.
- **Passkeys må ALDRIG erstatte kodeordet**: panelet tilgås på `IP:port` over http, hvor
  WebAuthn ikke findes. rpId/origin udledes pr. request af `X-Forwarded-Host` (første led
  i en liste).
- **Todoist-import** går gennem dodas egen fangst-parser: Todoists `@label` → dodas
  `#kontekst` (tegnene betyder det modsatte i de to apps), prioriteter droppes bevidst,
  underopgaver (`INDENT > 1`) fladlægges.

## Det, kun Andreas kan afprøve

- Connectoren mod den rigtige claude.ai (fejler det, er det næsten altid opdagelsen —
  tjek `WWW-Authenticate` på `/mcp`).
- Web Push på telefonen — på iPhone kun, når doda ligger på hjemmeskærmen.
- Kalenderpåmindelser: på iPhone skal abonnementets »Fjern påmindelser« være slået FRA,
  ellers stripper iOS `VALARM` uden at sige det.
- Notion: kommentarer er en særskilt tilladelse på integrationen, og siderne skal deles
  med den — et gyldigt token er ikke nok.
