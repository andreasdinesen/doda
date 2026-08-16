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
| **Fase** | F1 · Fangst + Inbox + Næste — **færdig og testet lokalt** |
| **Næste** | F2 · API + adgangsnøgler + iOS Shortcuts |
| **Tilstand** | F0 pushet. F1 ikke committet — venter på Andreas' ja. |
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

### Faseoversigt

| # | Fase | Leverance | Status |
|---|---|---|---|
| **F0** | Fundament | Rune installerer, login virker, tom app-skal med tingdo-design | ✅ Færdig |
| **F1** | Fangst + Inbox + Næste | **Appen kan bruges dagligt.** Datamodel, parser, kommandobar, afklaring | ✅ Færdig |
| **F2** | API + adgangsnøgler + Shortcuts | iPhone/Siri kan fange og læse. Handover: *prioritér højt* | ⬜ |
| **F3** | Projekter, områder, kontekster, noter | Fuld GTD-struktur, markdown-noter | ⬜ |
| **F4** | Gentagelser | Todoist-syntaks med `!`, to tilstande, gentagelses-skærm | ⬜ |
| **F5** | MCP-server | Claude kan forbinde til appen | ⬜ |
| **F6** | PWA + offline | Hjemmeskærm, offline-læsning, fangst-kø | ⬜ |
| **F7** | Gennemgang, logbog, ventelister, fokus | Ugentlig gennemgang, Venter på, Engang måske, timer | ⬜ |
| **F8** | Kalenderfeed, eksport/import, backup | Data ind og ud, verificeret gendannelse | ⬜ |
| **F9** | Sikkerhedsgennemgang + udgivelse | Hærdning, README, v1 | ⬜ |

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

- [ ] Adgangsnøgler: kun `sha256` gemmes, vises én gang, scopes (`capture`/`read`/`full`), `sidst brugt`, øjeblikkelig tilbagekaldelse
- [ ] `POST /api/v1/capture` (kun titel påkrævet, samme genvejssyntaks i teksten)
- [ ] `GET /api/v1/next?context=`, `POST /api/v1/items/:id/complete`, noter, `GET /api/v1/changes?since=`
- [ ] Tilgivende input + fejlsvar en genvej kan vise
- [ ] `docs/SHORTCUTS.md` med konkrete værdier til iPhone

## F3 · Projekter, områder, kontekster, noter

- [ ] Projekter m. underprojekter, områder, »færdigt ser sådan ud«-felt
- [ ] Projektvisning: opgaver + noter sammen, visuelt adskilt
- [ ] Markering af projekt **uden næste handling** (synlig, uden skældud)
- [ ] Manuel rækkefølge i projekt
- [ ] Noter i markdown, fuldtekstsøgbare, konvertering note ⇄ opgave uden tab

## F4 · Gentagelser

**Mål:** Handover §5.6 — den vigtigste tilføjelse ift. tingdo.

- [ ] Todoist-parser: `!hver dag`, `!hver mandag,torsdag`, `!hver 2. uge`, `!hver måned den 3.`, `!sidste hverdag i måneden`, `!hvert år 24/12`
- [ ] `!hver!` = fra fuldførelse · `!hver` = fast plan (se DESIGN.md)
- [ ] Motor: **kun én åben forekomst**, usynlig indtil aktuel, pause/genoptag, spring over registreres
- [ ] »Kun denne gang« vs. »alle fremtidige« ved ændring
- [ ] Gentagelses-skærm: næste forfald + antal oversprungne
- [ ] DST-test: »hver mandag kl. 8« må ikke drive hen over sommertidsskift

## F5 · MCP-server

**Mål:** Claude (Code, Desktop, evt. claude.ai) kan læse og skrive i doda.

- [ ] `/mcp` — Streamable HTTP, JSON-RPC 2.0, håndskrevet uden pakker
- [ ] Auth: samme adgangsnøgler som F2, `Authorization: Bearer` + scope-tjek pr. værktøj
- [ ] Værktøjer: fang opgave, næste handlinger, fuldfør, søg, opret/læs note, projekter, gentagelser
- [ ] `docs/MCP.md` — opsætning i Claude Code og Claude Desktop
- [ ] Valgfrit senere: OAuth 2.1 + dynamisk klientregistrering, så claude.ai-webconnector virker

## F6 · PWA + offline

- [ ] Manifest + ikoner + hjemmeskærm på iOS
- [ ] Service worker med versioneret cache (**husk `?v=N`-stempling — se RUNE-ERFARINGER §5**)
- [ ] Offline-læsning af lister
- [ ] Fangst offline → lokal kø → sendes ved forbindelse

## F7 · Gennemgang, logbog, ventelister, fokus

- [ ] Guidet ugentlig gennemgang i 6 trin, kan afbrydes og genoptages
- [ ] Diskret påmindelse på valgt ugedag
- [ ] Logbog (kronologisk, filtrerbar, ingen statistik)
- [ ] Venter på (med hvem) · Engang måske
- [ ] Fokustilstand med timer, der kører videre på tværs af skærme

## F8 · Kalenderfeed, eksport/import, backup

- [ ] iCal-feed med **kun reelle deadlines**, hemmelig og tilbagekaldelig adresse, indekseret opslag (aldrig fuld scanning)
- [ ] Fuld eksport + import i åbent format (JSON), rundtur verificeret: eksportér alt → slet databasen → importér → samme system tilbage
- [ ] **Eksport og import skal virke begge veje: både fra UI'et og via API'et** — `GET /api/v1/export` (hele datasættet i ét svar) og `POST /api/v1/import`. Så kan en iOS-genvej, et script eller MCP tage en kopi uden at åbne browseren
- [ ] Import skal være idempotent på id, så samme fil kan køres to gange uden dubletter, og skal kunne køre i portioner (Kokkeris 260 MB-backup blev afvist af serverens egen body-grænse)
- [ ] Backup/gendan dokumenteret **og testet** — også på en stor database
- [ ] Valgfri tingdo-import som separat trin

## F9 · Sikkerhedsgennemgang + udgivelse

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
