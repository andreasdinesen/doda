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
| **Fase** | F9 · Kalenderfeed, eksport/import, backup — **færdig og testet lokalt** |
| **Næste** | F10 · Sikkerhedsgennemgang + udgivelse af v1 |
| **Tilstand** | F0–F8 pushet. F9 ikke committet — venter på Andreas' ja. |
| **Udgivet version** | — (`APP_VERSION = 1` er stadig ubrugt; bumpes først ved reel udgivelse) |
| **Sidst opdateret** | 2026-08-16 |

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
| **F10** | Sikkerhedsgennemgang + udgivelse | Hærdning, README, v1 | ⬜ |

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
- [ ] Valgfrit senere: OAuth 2.1 + dynamisk klientregistrering, så claude.ai-webconnector virker

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
- [ ] Vedhæftninger med i eksport/import (F9) og verificeret i backup-rundturen
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

## F10 · Sikkerhedsgennemgang + udgivelse

- [ ] `/security-review` på hele diffen
- [ ] Verificér CSP, headers, rate-limits, token-scopes, iCal-token
- [ ] README: kør, opdatér, tag backup, gendan — med den dokumenterede opdateringsvej
- [ ] Efter-læsning af RUNE-ERFARINGER.md punkt for punkt (fælden erfaringsfilen selv advarer om)
- [ ] `APP_VERSION = 1` → build → commit → **vent på Andreas' ja** → push

---

## Efter hver fase

1. Byg og test lokalt.
2. Kryds af heroppe + opdatér **Status lige nu**.
3. Skriv nye generelle lærdomme i `~/ClaudeMacBook/RUNE-ERFARINGER.md` (og commit dét repo).
4. Opsummer for Andreas — **bump ikke `APP_VERSION` og push ikke uden hans udtrykkelige ja.**
