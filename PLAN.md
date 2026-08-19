# doda — plan og status

> **Denne fil er den levende oversigt.** Den opdateres ved afslutningen af hver fase.
> Start en ny session med: »Læs PLAN.md og CLAUDE.md i ~/ClaudeMacBook/doda, og byg F<N>.«

**Hvad:** Personlig GTD-opgave- og noteapp som yggdrasil-rune. Én bruger.
**Forbillede:** tingdo.app (UI og fangst-oplevelse) + Todoist (gentagelses-syntaks).
**Kilde til krav:** `docs/HANDOVER.md` (Andreas' funktionsbeskrivelse).

---

## Status lige nu

| | |
|---|---|
| **Fase** | **v35 udgivet.** Kravbeskrivelsen er bygget; v9–v35 er Andreas' ønsker. |
| **Næste** | Ingen igangværende opgave. Se `HANDOVER-NAESTE.md`. |
| **Tilstand** | 178 tests grønne, install-script **118.463 / 126.000 (94 %)** |
| **Udgivet version** | **35** |
| **Sidst opdateret** | 2026-08-18 |

**Sprog:** interfacet er **engelsk** (Andreas' valg — æøå er besværligt at taste).
Parseren er tosproget: engelsk primært, dansk virker fortsat. Kode, kommentarer og
disse dokumenter er dansk.

**Verificeret i F0:** rune bygger · login og førstegangsopsætning · registrering lukket
efter første bruger (403) · CSRF-barriere (415) · rate-limit efter 15 forsøg (429) ·
sti-traversering afvist · sikkerhedslinjer matcher runens `events:`-regexer · CSP-hash
korrekt · alle tre temavalg målt på en mørk maskine · mobil 375 px uden vandret overløb.

**Verificeret i F1:** 32 parser-tests grønne på begge sprog · fangst med kontekst,
projekt, dato, klokkeslæt og beskrivelse i ét felt · bekræftelse af nye navne · `#`/`@`
rører ikke e-mails og URL'er · **8 XSS-angreb mod linkifiseringen afvist** (ingen
script-tags, ingen `on*`-attributter, `javascript:`/`data:` forbliver ren tekst) ·
tastaturafklaring (`n`/`w`/`s`/`x`/mellemrum) uden at fangstfeltet opsnapper tasterne ·
`~skjul indtil` holder opgaver ude af næste-listen · søgning dækker beskrivelser og
escaper LIKE-jokertegn · fortryd på både fangst og fuldførelse · mobil uden overløb.

**Verificeret i F2:** hele scope-matricen målt **uden cookie** (som en rigtig iPhone):
en `capture`-nøgle kan oprette, men får 403 på al læsning · en `read`-nøgle får 403 på
oprettelse · **ingen nøgle kan lave nye nøgler eller skifte kodeord** (401
`session_required`) · ugyldig nøgle giver 401 · tilbagekaldelse virker øjeblikkeligt
(200 → 401 på næste kald) · `sidst brugt`-stempel skrives · fangst virker med ren tekst
uden Content-Type, med formulardata og med `?text=` · CSRF-barrieren holder stadig for
cookie-adgang (415) · `?format=text` og kontekst ved navn · `changes?since=` inkl.
slettede id'er.

**Verificeret i F3:** projekter grupperet efter område · »no next action« vises kun ved
reelt åbent arbejde (noter tæller ikke med) · manuel sortering med knapper overlever
genindlæsning og er synlig på touch · **5 XSS-angreb mod markdown-rendereren afvist** ·
note ⇄ opgave begge veje uden at miste titel eller beskrivelse · droppet projekt tager
kun sine **åbne** opgaver med — den udførte beholder sin status, så logbogen forbliver
sand — og genåbning vækker præcis dem igen · dubletnavn på kontekst afvist (409) ·
slettet kontekst/område beholder opgaverne · seks sider målt på 375 px uden overløb.

**Verificeret i F4:** 63 tests grønne, heraf 11 **integrationstests mod en rigtig
server** (`tests/engine.test.mjs` starter serveren mod en midlertidig database og
flytter uret direkte i SQLite — nogle ting kan ikke provokeres gennem API'et alene).
Bevist: kun **én åben forekomst** gennem fem fuldførelser i træk · forekomsten er
usynlig indtil sin dato (`defer_date = due_date`) · »fra fuldførelse« regner fra i dag,
også når forekomsten er 30 dage forsinket · »fast plan« regner fra forfaldsdatoen ·
28 dages forsømmelse rulles frem og tælles som præcis 4 spring · **en »fra
fuldførelse«-regel ruller ALDRIG frem** og kan derfor aldrig hobe sig op · pause
bevarer reglen, rydder listen og samler ikke spring op · »kun denne gang« rører ikke
skabelonen, »alle fremtidige« gør · stop bevarer den åbne som en almindelig opgave ·
sommertid: ugentlige og daglige gentagelser driver ikke hen over hverken efterårs-
eller forårsskiftet.

**Verificeret i F5:** 86 tests grønne, heraf 23 mod MCP-serveren over HTTP uden
cookie — som en rigtig klient. `initialize` med versionsforhandling (ældre version
accepteres, ukendt falder tilbage) · notifikationer kvitteres 202 uden krop · batch
besvares som batch · `-32601`/`-32600`/`-32602` på de rigtige steder · **`tools/list`
viser kun det, nøglens scope tillader** (en `capture`-nøgle ser præcis ét værktøj), og
scopet håndhæves igen ved selve kaldet · 401 med `WWW-Authenticate` · fremmed `Origin`
afvist 403 (DNS-rebinding) · `GET`/`DELETE` → 405 · værktøjsfejl kommer som `isError`
med læsbar besked, ikke som protokolfejl.

**Verificeret i F6:** fangst-køen holder rækkefølgen gennem et netværksbrud og sender
alt ved genoprettelse · offline-mærket tæller det ventende · ikoner, manifest og
`sw.js` serveres · CSP har `worker-src 'self'` (uden den blokerer vores egen CSP
service workeren) · `sw.js` precacher **præcis** de `?v=`-URL'er, index.html henter,
og cache-navnet er versioneret.

⚠️ **Ikke verificeret lokalt:** selve service worker-registreringen. Claude Codes
browser-panel afviser `serviceWorker.register()` — også mod en helt nøgen server uden
headers, så det er panelet og ikke koden. **Andreas bør bekræfte på sin telefon eller
i en rigtig browser**, at appen kan lægges på hjemmeskærmen og læses uden net.

⚠️ **Pladsen i runen:** install-scriptet fylder nu 74 % af MAX_ARG_STRLEN-loftet.
Ikonerne kostede 24 K tegn, indtil de blev paletterede (70 KB → 18,5 KB). Bliver det
trangt i F9, kan ikonerne tegnes af serveren ved opstart i stedet for at ligge i
payloaden.

**Verificeret i F7:** **listerne får kun `attachment_count`** — filmetadata følger
udelukkende med det enkelte element (§4-lektien håndhævet i koden) · PNG serveres
inline, mens **PDF og SVG tvinges til `application/octet-stream` + `attachment`**, så
en uploadet SVG aldrig kan køre som en side på dodas domæne · `nosniff`, `immutable`
og ETag med virkende 304 · filnavne saniteres (`../../../etc/passwd` →
`-..-..-etc-passwd`), og stien på disken er altid det rene hex-id · tom fil afvist ·
for stor fil svarer 413 **før** forbindelsen lukkes · `files/` er med i runens `wipe`.

⚠️ Install-scriptet er nu på **78 %**. F8–F10 skal holde øje; ellers flyttes ikonerne
ud af payloaden og tegnes af serveren ved opstart.

**Verificeret i F8:** alle seks gennemgangstrin viser det rigtige indhold · gennemgangen
kan afbrydes og **genoptages fra samme trin** (trinnet ligger på serveren, så det virker
på tværs af enheder) · Venter på viser og gemmer *hvem* · logbogen grupperer pr. dag med
projektfilter og **uden et eneste tal, en graf eller en score** (handover §10) ·
fokustimeren overlever både skærmskift og en **fuld sideindlæsning**, fordi det er
starttidspunktet der gemmes, ikke en tæller · alle **ti** skærme målt på 375 px uden
vandret overløb.

⚠️ Install-scriptet er nu på **83 %**. F9 er den sidste fase med reel kode; bliver det
trangt, flyttes ikonerne ud af payloaden.

**Verificeret i F9 — acceptkriterie 6 er opfyldt:** `tests/roundtrip.test.mjs` fylder en
rigtig server med projekter, områder, kontekster, noter, gentagelser og en vedhæftning,
eksporterer alt, **sletter databasen og filmappen fysisk**, starter serveren forfra og
importerer i portioner som UI'et gør. Derefter sammenlignes et fingeraftryk af hele
systemet felt for felt — og **filens indhold hentes og sammenlignes byte for byte**.
Dertil: importen er idempotent (samme fil to gange giver ingen dubletter) · eksport og
import virker **både fra UI og via API-nøgle**, og en `read`-nøgle får 403 på import ·
iCal-feedet indeholder kun ting **med** en deadline (opgaver uden dato og noter lækker
ikke ud), bruger `TZID=Europe/Copenhagen` i stedet for at konvertere til UTC, svarer
uden login på en hemmelig adresse, og tilbagekaldelse virker øjeblikkeligt · forkert
token giver 404 uden at røbe at feedet findes.

**Målt på 5.000 elementer:** eksport 3,8 MB på under et sekund · `/next` på 5 ms ·
iCal-feedet på 2 ms (det rammer `items_forfald`-indekset og scanner aldrig datasættet —
kalendere poller hvert kvarter) · import i portioner à 100 på 0,1 s.
`?files=1` har en hård spærre ved 150 MB med en besked, der peger på panelets backup —
det er den vej, Kokkeri gik ned ad med 247,9 MB i ét svar.

**Verificeret i F10:** paletten matcher skitserne — legende i bunden, tilstands-pille
inde i feltet, okkerfarvet Quick Capture-række · `+` giver »+ New Task«, pladsholderen
skifter til »Task title…«, og legenden skrumper til `/ project · # context ↵ Create` ·
`/`, `#` og `:` slår op i projekter, kontekster og områder og springer dertil ·
tom liste skelner mellem »der findes ingen« og »din søgning gav intet« · den inline
genvejssyntaks virker uændret, fordi tilstanden kun vælges når feltet ellers er tomt ·
**10 tests af Todoist-importen**: CSV med citater og komma, `@label` → `#kontekst`
(begreberne er byttet om), `#projekt`-referencer fjernet, sektioner sprunget over,
underopgaver fladlagt med besked, og »every 3 days« bliver en rigtig doda-gentagelse,
fordi dataene går gennem dodas **egen** fangst-parser.

**Verificeret i F11:** 10 passkey-tests med en software-authenticator — login uden
brugernavn, challenge kun én gang (genafspilning afvist), forkert signatur/fremmed
challenge/manglende tilstedeværelse alle 401, counter der ikke vokser ser ud som en
klon, fjernet nøgle virker ikke mere · **og en test der hedder »passkeys kan ALDRIG
erstatte kodeordet«** · påmindelsesbånd på den valgte ugedag, som kan lukkes for i dag.

**Sikkerhedsgennemgangen fandt ét reelt hul:** upload-ruten var det eneste muterende
endepunkt uden Content-Type-barrieren, fordi den streamer i stedet for at gå gennem
`readJsonBody`. `SameSite=Lax` dækkede den i praksis, men resten af appen har to lag.
Nu kræver den `X-Doda-Upload: 1` fra en browser-session — en fremmed formular kan ikke
sætte en egen header, og fetch med én udløser en preflight, vi aldrig svarer.
API-nøgler er fritaget: der er ingen ambient legitimation at misbruge. Målt: **400**
uden headeren, **200** med, **200** med nøgle.

**Efterslæb fundet ved en gennemgang af handoveren efter v1** — tre punkter stod
eksplicit i beskrivelsen og var ikke bygget:

- [x] **§7: genvejsoversigt med `?`.** Fanges i capture-fasen, så den også virker,
      når fokus står i en liste, hvor bogstaverne er optaget af afklaringen
- [x] **§7: `c` sæt kontekst og `p` sæt projekt** direkte fra en liste. De var de to
      eneste af §7's ni handlinger uden en genvej
- [x] **§6: bundnavigation på mobil** — Next, Inbox, Projects, Recurring, Review plus
      en Capture-knap, så fangst kan nås fra alle skærme med ét tryk. Findes kun under
      mobilgrænsen; på desktop er sidebaren vejen

**Bevidste afvigelser fra handoveren** (ikke mangler, men valg der bør stå skrevet):

- **§5.14** siger, at områder, kontekster og projekter administreres i Indstillinger.
  De har i stedet deres egne skærme (Contexts, og Projects → Manage areas), fordi de
  er ting man arbejder i, ikke indstillinger man sætter én gang.
- **§5.12** ønsker en påmindelse om gennemgangen. Den er et bånd i appen, ikke en
  push-besked — se begrundelsen ovenfor.
- **§5.13** ønsker tingdo-import. Formatet er ukendt; i stedet er der Todoist-import.

**Pladsen løst:** ikonerne er skåret fra fire til to (192 dækker også apple-touch-icon,
512 er både `any` og `maskable`). Install-scriptet gik fra 92 % tilbage til **83 %**.

### Faseoversigt

| # | Fase | Leverance | Status |
|---|---|---|---|
| **F0** | Fundament | Rune installerer, login virker, tom app-skal med tingdo-design | ✅ Færdig |
| **F1** | Fangst + Inbox + Næste | **Appen kan bruges dagligt.** Datamodel, parser, kommandobar, afklaring | ✅ Færdig |
| **F2** | API + adgangsnøgler + Shortcuts | iPhone/Siri kan fange og læse. Handover: *prioritér højt* | ✅ Færdig |
| **F3** | Projekter, områder, kontekster, noter | Fuld GTD-struktur, markdown-noter | ✅ Færdig |
| **F4** | Gentagelser | Todoist-syntaks med `!`, to tilstande, gentagelses-skærm | ✅ Færdig |
| **F5** | MCP-server | Claude kan forbinde til appen | ✅ Færdig |
| **F6** | PWA + offline | Hjemmeskærm, offline-læsning, fangst-kø | ✅ Færdig |
| **F7** | Vedhæftninger | Billeder og filer på opgaver og noter | ✅ Færdig |
| **F8** | Gennemgang, logbog, ventelister, fokus | Ugentlig gennemgang, Venter på, Engang måske, timer | ✅ Færdig |
| **F9** | Kalenderfeed, eksport/import, backup | Data ind og ud, verificeret gendannelse | ✅ Færdig |
| **F10** | Kommandopalet + Todoist-import | Paletten som Andreas' skitser, og data ind fra Todoist | ✅ Færdig |
| **F11** | Passkeys, sikkerhedsgennemgang + udgivelse | Hærdning, README, v1 | ✅ Færdig |

Hver fase leveres som noget, der **virker og kan tages i brug**. Ingen fase efterlader
appen i en tilstand, hvor den ikke kan startes.

---

## F0 · Fundament

**Mål:** Runen kan installeres i panelet, man kan logge ind, og app-skallen står med
det færdige tingdo-design. Ingen opgavefunktioner endnu.

- [x] `build_rune.py` — brotli+base85-payload, `node --check`, MAX_ARG_STRLEN-assert, rundtur med den udgivne dekoder
- [x] `app/server.js` — HTTP-skelet, SQLite (WAL) med skema-migrationer, scrypt-auth, sessions, sikkerhedsheadere, statisk servering, audit + vedvarende rate-limit
- [x] Adgangskontrol — første bruger = ejer, registrering lukkes derefter automatisk (én-bruger-app)
- [x] `runes/doda.yaml` — `update:`-blok, `NODE_IMAGE`-variabel, `events:`, watchers, backup, wipe
- [x] `app/public/index.html` + `style.css` + `app/parts/p1_core.js` — design-tokens, tema, app-skal, sidebar, kommandobar med »begynd bare at skrive«
- [x] Lokal dev i `~/.claude/launch.json` + røgtest

## F1 · Fangst + Inbox + Næste handlinger

**Mål:** Den kan bruges. Handover §5.1–5.3.

- [x] Datamodel: `items` (typede kolonner + JSON-blob), `contexts`, `item_contexts`, `projects`, `areas`
- [x] Parser: `+` `*` `#` `@` `!` `~` + dansk dato-NLP (se DESIGN.md for omfang)
- [x] Kommandobar: »begynd bare at skrive« åbner den, søg og opret side om side, live-preview-chips
- [x] **Beskrivelsesfelt på opgaver** — flerlinjet, markdown, med klikbare links
- [x] **Links i selve opgavetitlen** — rå URL'er og `[tekst](url)` bliver klikbare i listerne, uden at titlen fylder. Links åbnes med `rel="noopener noreferrer"`, og kun `http(s):` tillades (aldrig `javascript:`)
- [x] Inbox med tastaturafklaring (ét element ad gangen, uden mus)
- [x] Næste handlinger grupperet efter kontekst, ét-tast-filter, markér udført fra listen
- [x] Tom inbox = roligt, bekræftende — aldrig rød tæller

## F2 · API + adgangsnøgler + iOS Shortcuts

**Mål:** Handover §5.10. Webgrænsefladen bruger **samme** API — ingen intern bagvej.

- [x] Adgangsnøgler: kun `sha256` gemmes, vises én gang, scopes (`capture`/`read`/`full`), `sidst brugt`, øjeblikkelig tilbagekaldelse
- [x] `POST /api/v1/capture` (kun titel påkrævet, samme genvejssyntaks i teksten)
- [x] `GET /api/v1/next?context=`, `POST /api/v1/items/:id/complete`, noter, `GET /api/v1/changes?since=`
- [x] Tilgivende input + fejlsvar en genvej kan vise
- [x] `docs/SHORTCUTS.md` med konkrete værdier til iPhone

## F3 · Projekter, områder, kontekster, noter

- [x] Projekter m. underprojekter, områder, »færdigt ser sådan ud«-felt
- [x] Projektvisning: opgaver + noter sammen, visuelt adskilt
- [x] Markering af projekt **uden næste handling** (synlig, uden skældud)
- [x] Manuel rækkefølge i projekt
- [x] Noter i markdown, fuldtekstsøgbare, konvertering note ⇄ opgave uden tab

## F4 · Gentagelser

**Mål:** Handover §5.6 — den vigtigste tilføjelse ift. tingdo.

- [x] Todoist-parser: `!hver dag`, `!hver mandag,torsdag`, `!hver 2. uge`, `!hver måned den 3.`, `!sidste hverdag i måneden`, `!hvert år 24/12`
- [x] `!hver!` = fra fuldførelse · `!hver` = fast plan (se DESIGN.md)
- [x] Motor: **kun én åben forekomst**, usynlig indtil aktuel, pause/genoptag, spring over registreres
- [x] »Kun denne gang« vs. »alle fremtidige« ved ændring
- [x] Gentagelses-skærm: næste forfald + antal oversprungne
- [x] DST-test: »hver mandag kl. 8« må ikke drive hen over sommertidsskift

## F5 · MCP-server

**Mål:** Claude (Code, Desktop, evt. claude.ai) kan læse og skrive i doda.

- [x] `/mcp` — Streamable HTTP, JSON-RPC 2.0, håndskrevet uden pakker
- [x] Auth: samme adgangsnøgler som F2, `Authorization: Bearer` + scope-tjek pr. værktøj
- [x] Værktøjer: fang opgave, næste handlinger, fuldfør, søg, opret/læs note, projekter, gentagelser
- [x] `docs/MCP.md` — opsætning i Claude Code og Claude Desktop
- [x] OAuth 2.1 + dynamisk klientregistrering, så claude.ai-webconnectoren virker — **bygget i v5**, rettet i v6 (`app/oauth.js`)

## F6 · PWA + offline

- [x] Manifest + ikoner + hjemmeskærm på iOS
- [x] Service worker med versioneret cache (**husk `?v=N`-stempling — se RUNE-ERFARINGER §5**)
- [x] Offline-læsning af lister
- [x] Fangst offline → lokal kø → sendes ved forbindelse

## F7 · Vedhæftninger

**Mål:** Billeder og filer på opgaver og noter. Andreas' ønske, tilføjet undervejs i F6.

**RUNE-ERFARINGER §4 er hele designet her** — det var Kokkeris dyreste lærestreg:
billeder inde i de items, listen henter, gav et login-svar på 247,9 MB.

- [x] Egen tabel `attachments` + egen `/data/files/`-mappe. **Aldrig** filindhold i
      `items` — elementet bærer kun et antal, så listerne er upåvirkede
- [x] Filerne på disk, ikke i SQLite: så streamer backup, og databasen forbliver lille
- [x] `GET /api/v1/files/:id` med **ETag + `Cache-Control: immutable`** og versioneret URL
- [x] Upload uden multipart-parser: rå krop + `?name=`/`Content-Type` (ingen npm-pakke)
- [x] Loft pr. fil (25 MB) og samlet kvote, med en læsbar fejl når den rammes
- [x] **Sikkerhed:** `nosniff` + `Content-Disposition: attachment` for alt undtagen
      billeder. SVG serveres ALDRIG inline (kan bære script). Filnavne saniteres —
      ingen sti-traversering, ingen kontroltegn
- [x] Billeder skaleres i **browseren** før upload (Node kan ikke skalere uden pakker)
- [x] Miniature i detaljeruden, klik åbner fuld visning; filer vises som en liste
- [x] Kamera/foto-valg på iPhone (`accept="image/*"`, `capture`), træk-og-slip på desktop
- [x] Vedhæftninger med i eksport/import og verificeret i rundturen — `?files=1` lægger indholdet med, og testen henter filen igen og sammenligner **byte for byte**
- [x] MCP: `list_attachments` — men **aldrig** filindhold gennem MCP

## F8 · Gennemgang, logbog, ventelister, fokus

- [x] Guidet ugentlig gennemgang i 6 trin, kan afbrydes og genoptages
- [x] Diskret påmindelse på valgt ugedag — ugedagen kan vælges og gemmes; **selve
      afsendelsen bygges i F10**, hvor notifikationsvejen afklares (handover §5.12)
- [x] Logbog (kronologisk, filtrerbar, ingen statistik)
- [x] Venter på (med hvem) · Engang måske
- [x] Fokustilstand med timer, der kører videre på tværs af skærme

## F9 · Kalenderfeed, eksport/import, backup

- [x] iCal-feed med **kun reelle deadlines**, hemmelig og tilbagekaldelig adresse, indekseret opslag (aldrig fuld scanning)
- [x] Fuld eksport + import i åbent format (JSON), rundtur verificeret: eksportér alt → slet databasen → importér → samme system tilbage
- [x] **Eksport og import skal virke begge veje: både fra UI'et og via API'et** — `GET /api/v1/export` (hele datasættet i ét svar) og `POST /api/v1/import`. Så kan en iOS-genvej, et script eller MCP tage en kopi uden at åbne browseren
- [x] Import skal være idempotent på id, så samme fil kan køres to gange uden dubletter, og skal kunne køre i portioner (Kokkeris 260 MB-backup blev afvist af serverens egen body-grænse)
- [x] Backup/gendan dokumenteret **og testet** — også på en stor database
- [ ] Valgfri tingdo-import — **ikke bygget**: jeg har ikke tingdos eksportformat.
      Send en eksportfil derfra, så bygger jeg importen mod den. Handoveren kalder
      det selv »hvis formatet er tilgængeligt«, og det er et separat, valgfrit trin

## F10 · Kommandopalet + Todoist-import

**Mål:** Paletten skal se ud og opføre sig som Andreas' skitser, og Todoist-data
skal kunne komme ind. Erstatter den planlagte tingdo-import, hvis format er ukendt.

### Paletten

- [x] Ét kort med inputfelt, resultater og en **tastaturlegende** i bunden
- [x] Pladsholder: »Just type to Capture, Navigate and Find«
- [x] **Tilstande via første tegn**: `+` opgave · `*` note · `/` projekter ·
      `#` kontekster · `:` områder. Tilstanden vises som en **pille inde i feltet**,
      pladsholderen skifter, og legenden viser kun det, der giver mening dér
- [x] Backspace i et tomt felt forlader tilstanden
- [x] **Quick Capture-rækken** fremhævet i okker med et cirkel-plus, som i skitsen
- [x] `/`, `#` og `:` navigerer: vælg et projekt, en kontekst eller et område og spring dertil
- [x] Den inline genvejssyntaks (`#kontekst` midt i en sætning) skal virke uændret

### Detaljeruden

- [x] Layout efter tingdo: titlen som **overskrift** med afkrydsningsring og ×,
      beskrivelsen som »Add details…« lige under, og felterne som **chips** man trykker på
- [x] En chip bliver til det rigtige felt ved klik og tilbage til en chip bagefter
- [x] Alt redigeres i et **udkast** og gemmes først ved Save — et fejlklik ændrer intet
- [x] Beskrivelsesfeltet vokser med teksten og viser markdown, når det ikke har fokus
- [x] »What you can set here«-forklaring, der vises indtil den er set én gang

### Todoist-import

- [x] Læs Todoists **CSV-eksport** (én fil pr. projekt, `Projekt.csv`)
- [x] Oversæt begreberne: Todoists `@label` → dodas **kontekst**, Todoists projekt →
      dodas projekt. **Bemærk at `@` og `#` betyder det modsatte i de to apps**
- [x] `DATE` med »every …« bliver til en rigtig doda-gentagelse gennem samme parser
- [x] `DESCRIPTION` → beskrivelse · `TYPE: note` → note · prioriteter **droppes**
      bevidst (handover §10: ingen prioritetsniveauer)
- [x] Underopgaver (`INDENT > 1`) fladlægges — doda har ikke underopgaver
- [x] Vis en **forhåndsvisning** før noget gemmes, og importér gennem det eksisterende
      idempotente import-endepunkt

## F11 · Passkeys, sikkerhedsgennemgang + udgivelse

### Passkeys

Samme håndskrevne WebAuthn-stak som Andreas' øvrige runer (RUNE-ERFARINGER §3):
CBOR-dekoder → `attestationObject`/`authData` → COSE→JWK → `crypto.verify`.
Ingen pakker.

- [x] `credentials`-tabel + `/api/webauthn/register|login/options|verify`
- [x] **rpId og origin udledes pr. request** af `X-Forwarded-Host`/`-Proto`, så det
      virker bag Cloudflare-tunnelen uden konfiguration. Husk at headeren kan være
      en liste — tag første led
- [x] **Discoverable credentials + tom `allowCredentials`**: »Log ind med passkey«
      kræver hverken brugernavn eller en forudgående forespørgsel
- [x] Counter-tjek: afvis kun hvis begge tællere er > 0 og den nye ≤ den gamle
- [x] Administration i Settings: opret, navngiv, se sidst brugt, fjern
- [x] **Passkeys må ALDRIG erstatte kodeordet.** Panelet tilgås på `IP:port` over
      http, hvor WebAuthn ikke findes — et passkey-only login ville låse Andreas ude
      af sin egen server. To spærrer: en server-side forklaring og
      `window.isSecureContext` i browseren
- [x] Test med en **software-authenticator** (ES256-nøgle + håndlavet `authData`),
      ikke med hardware — så dækker testen routes, challenge, database og scope

### Udgivelse

- [x] `/security-review` på hele diffen
- [x] Verificér CSP, headers, rate-limits, token-scopes, iCal-token
- [x] README: kør, opdatér, tag backup, gendan — med den dokumenterede opdateringsvej
- [x] Efter-læsning af RUNE-ERFARINGER.md punkt for punkt (fælden erfaringsfilen selv advarer om)
- [x] `APP_VERSION = 1` → build → commit → **vent på Andreas' ja** → push

---

## F12 · Connector til claude.ai (OAuth 2.1)

Webklienten kan ikke sende en fast nøgle i en header — den skal kunne registrere
sig selv og sende Andreas gennem et login. Se `docs/OAUTH.md`.

- [x] `app/oauth.js`: opdagelse, registrering (RFC 7591), PKCE-validering,
      engangs-koder, roterende refresh — ingen pakker, `srv`-indsprøjtning som `mcp.js`
- [x] Migration `m8`: `oauth_clients`, `oauth_refresh`, `client_id` + `expires_at` på `tokens`
- [x] Access-tokens går gennem `opretToken()`, og `findToken` fik et udløbstjek —
      **én valideringsvej for alle nøgler**
- [x] Syv ruter uden for `/api/`, med CORS uden om `securityHeaders()`
- [x] `/mcp` svarer 401 med `WWW-Authenticate: … resource_metadata="…"` — uden den
      kan Claude ikke opdage autorisationsserveren
- [x] Samtykkeside uden JavaScript, med session-bundet bevis mod CSRF
- [x] `?next=`-viderestilling efter login, låst til `/oauth/authorize?`
- [x] Settings → **Connected apps** med scope, sidst brugt og *Revoke*
- [x] 18 tests i `tests/oauth.test.mjs` mod en rigtig server, inkl. kode-tyveri
      mellem klienter, rotation og udløb (uret flyttes i databasen ved siden af)
- [x] `APP_VERSION = 5` → build → push
- [x] **v6:** `form-action` skal tillade klientens redirect-oprindelse, ellers
      blokerer browseren hele samtykke-POST'en, og *Allow* gør ingenting.
      Regressionstest på headeren — `fetch` i Node håndhæver ingen CSP, og et
      manuelt gennemløb med redirect til `localhost` er same-origin og opdager
      det derfor aldrig

---

## F13 · Skallen (v7)

Andreas' ønsker efter at have brugt v6. Beslutningerne står i `DESIGN.md §2`.

- [x] `↑`/`↓` går **ind** i listen uden at åbne noget — genvejstasterne var
      i praksis uopnåelige, fordi fokus kun kunne komme fra et klik, og et
      klik åbner opgaven. `Esc` slipper listen igen
- [x] **Sideoversigt i højre side** (Notion-agtig): streger, der folder sig ud
      på hover, markerer det afsnit man er i, og kan klikkes
- [x] Gribefladen gjort tre gange større — ~24×10 px var for lille at ramme
- [x] **Versionsnummer** nederst i sidebaren, samme tal som runens `version:`,
      med advarsel hvis serveren har en nyere
- [x] **Tema-knap** ved siden af versionen: ét klik mellem lyst og mørkt
- [x] **Log ud** i en menu på brugerknappen
- [x] Paletten kan **oprette** i `/`, `#` og `:`, ikke kun søge
- [x] **Sidebaren kan foldes væk** til en hamburger, som i tingdo
- [x] `tests/version.test.mjs`: de fem steder, versionen står, skal stemme
- [x] **Pladsen i runen** — loftet hævet til 126.000, og i v10 blev kommentarerne
      strippet ud af den udgivne kopi: 97 % → 74 %. Se nedenfor
- [x] `APP_VERSION = 7` → build → push
- [x] **v8:** sletning svarede 404 på noget, der lykkedes — `opdaterItem()`
      læser rækken frisk gennem `hentItem()`, som filtrerer `deleted = 0` fra.
      Fejlen havde ligget der hele tiden; den blev først synlig, da `x` kunne
      nås. Testen er bevist at kunne fejle på den gamle kode

### Pladsen i runen — løst

Install-scriptet fylder **93.308 af 126.000 tegn (74 %)**. Det var 97 %, indtil
build'et begyndte at strippe kommentarer ud af den **udgivne** kopi.

Målt undervejs, så det ikke skal gættes igen:

| Greb | Gav |
|---|---|
| brotli-parametre (`MODE_TEXT`, `SIZE_HINT`, `LGWIN 24`) | **0 bytes** — q11 er allerede i bund |
| Kommentar-strip i payloaden | **29.561 tegn (24 %)** |
| Linjenumre bevaret i strippen | koster kun 744 af de 29.561 |
| `icon-192.png` fjernet | 2.815 tegn — stadig i behold, iOS bruger den |

Hvad hver fil koster i payloaden (leave-one-out-måling):
`app.js` 44.918 · `server.js` 35.643 · `style.css` 9.716 · `mcp.js` 4.647 ·
`webauthn.js` 3.063 · `icon-192.png` 2.817 · `oauth.js` 2.135 · `sw.js` 1.413.
`parse.js` koster kun **180**, fordi den også ligger inde i `app.js` og brotli
genkender dubletten.

Bliver det trangt igen: `style.css` er det største, der ikke er kode, og
serveren kan stadig tegne ikonet ved opstart (~1.900 netto).

## F14–F23 · Andreas' ønsker efter udgivelsen

Kravbeskrivelsen var bygget ved v4. Alt herefter er kommet ét ad gangen fra
brug. Begrundelserne står i README's versionshistorik; her er sporet:

| v | Hvad |
|---|---|
| 9 | Genvejssyntaks når man **retter** en titel · kontekster på gentagelser |
| 10 | Ny skærm: **Notes** · payload-strip 97 % → 74 % |
| 11 | Offline dækker **handlinger**, ikke kun fangst |
| 12 | Påmindelser på opgaver med klokkeslæt (`VALARM` i feedet) |
| 13 | **Web Push** — VAPID uden pakker, push uden nyttelast |
| 14 | Link til en side (fx Notion) på opgaver, noter og projekter |
| 15 | Gennemgangen efter tingdo: ugeoverblik og tre måder |
| 16 | **Notion-integration** · lækage i `GET /api/v1/settings` lukket |
| 17–18 | Link på projekter · titler holder sig friske · databaser kan findes |
| 19–22 | Notion-sidens **indhold** vist i doda, og to rettelser af billed-links |
| 23 | Kalenderen peger **tilbage** til opgaven (`?item=<id>`) |

| 24 | Genvejssyntaks i gentagelsernes titelfelt (kun `#`/`@`) · ens fejlform i hele `/api/v1` |

| 25 | **Guide-siden** — hele appen forklaret, nået fra brugermenuen |
| 26 | **Automatisk synk** når appen kommer frem + synlig synk-knap med alder |
| 27 | **Optimistisk opdatering** — tastetryk og fangst svarer med det samme |
| 28 | **Skærmen udfylder** en ny opgave (Waiting/Someday/projekt/kontekst) |
| 29 | Rettelse: sidste række i en liste startede også en fangst (fra v27) |
| 30 | **Forslag** mens man skriver `/`, `@` eller `#` · søgning på tolket titel |
| 31 | **⌘+Enter gemmer** en opgave, en gentagelse eller et projekt |
| 32 | Rettelse: et projekt var en blindgyde — nulstilling lå bag »hvis skærmen skifter« |
| 33 | Titlen folder sig ud · Notion-siden på et projekt · to mobil-rettelser |
| 34 | **Kommentér en Notion-side** fra doda — læs og skriv, uden at gemme noget |
| 35 | **Noter kan slås fra** · en Notion-side kan **oprettes** fra link-vælgeren |

### Om guiden, og hvad den kostede

- **Guide-siden** (`app/parts/p9_guide.js`) — en samlet gennemgang af appen,
  nået fra menuen på brugerknappen. Bygget i tingdos form (dele → grupper →
  emner med mærker) efter at have læst forlægget gennem Andreas' egen Chrome;
  indholdet er dodas eget. 4 dele, 8 grupper, 25 emner, 72 rækker.
  Syntaksen kommer fra `syntaksTabel()` og genvejene fra `GENVEJE`, så guiden
  ikke kan drive fra Settings. Se `DESIGN.md §3`.
  Install-scriptet voksede 107.326 → **112.631 tegn (89 %)**.

  Målt med leave-one-out, så det ikke skal gættes igen: guidens **tekst**
  kostede 6.274 tegn, dens **CSS kun 364**. Én runde stramning af prosaen
  (én sætning pr. indledning, én påstand pr. række, ingen tast gentaget fra
  tastatur-afsnittet) tog teksten ned til ~4.700 — **1.566 tegn sparet uden
  at fjerne et eneste emne**. En anden runde på markup og småting gav **0**:
  de 30 tegn, teksten tabte, kom tilbage som kode. Næste greb ville være at
  skære hele emner væk — et indholdsvalg, ikke et teknisk.

---

## Efter hver fase

1. Byg og test lokalt.
2. Kryds af heroppe + opdatér **Status lige nu**.
3. Skriv nye generelle lærdomme i `~/ClaudeMacBook/RUNE-ERFARINGER.md` (og commit dét repo).
4. Opsummer for Andreas — **bump ikke `APP_VERSION` og push ikke uden hans udtrykkelige ja.**
