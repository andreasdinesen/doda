# doda — beslutninger

Alle valg her er truffet én gang, så de ikke skal genforhandles hver session.
Ændres noget, rettes det **her** først.

---

## 1 · Teknologi

Samme gennemprøvede rune-skabelon som Bogreolen/Beanledger/Kokkeri:
**node:24-alpine · `node:http` + `node:sqlite` + `node:crypto` · nul npm-pakker.**

Det er også svaret på sikkerhedskravet: uden afhængigheder er der ingen transitiv
forsyningskæde at patche. Det eneste »underliggende program« er Node selv og
SQLite i imaget — se §5.

## 2 · Design (tingdo-inspireret)

Bemærk: RUNE-ERFARINGER §4 siger »design efter Yggdrasil Panel« (mørk, kølig).
**Det gælder ikke her** — Andreas vil have tingdos varme, lyse udtryk. Alt andet i
§4 (tokens, `data-theme`, `[hidden]`, 900 px-grænsen, `overflow-wrap`) holder uændret.

### Tokens

| Rolle | Lys | Mørk |
|---|---|---|
| Baggrund | `#EFE9E2` | `#141210` |
| Sidebar | `#E7E0D7` | `#1A1714` |
| Kort/panel | `#F7F3EE` | `#211D19` |
| Kant | `#DCD3C7` | `#312A23` |
| Tekst | `#1C1917` | `#EDE8E1` |
| Dæmpet tekst | `#8B8078` | `#95897C` |
| Accent (okker) | `#B07D14` | `#D9A441` |
| Accent, dæmpet | `#F0E4CB` | `#3A2E17` |

- **Ingen røde tællere. Ingen alarmfarver.** Handover-princip 1 og acceptkriterie 7.
  Der findes ingen `--danger`-token til statusvisning; kun til bekræftelsesknapper
  ved sletning.
- Radius: `--r-sm 8px`, `--r 14px`, `--r-lg 20px`, kommandobar `999px` (pille).
- Skygger: næsten ingen. `0 1px 2px rgba(0,0,0,.04)` på kort, en blødere ring på
  den åbne kommandobar.
- **Meta-labels i små kapitæler**: `text-transform: uppercase; letter-spacing:.12em;
  font-size:11px; color: var(--muted)` — tingdos »0 DONE · 2 CAPTURED«-stribe og
  sektionsoverskrifter.
- Skrift: systemstakken (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).
  **Ingen webfonts** — CSP forbyder eksterne kilder, og runen må ikke afhænge af CDN.
- Luft frem for linjer: sektioner adskilles med afstand og en enkelt 1px-kant, ikke bokse.

### Kommandobaren (appens signatur)

- Altid synlig øverst; klik eller `/` fokuserer den.
- **»Begynd bare at skrive«**: en global `keydown` fanger et printbart tegn uden
  modifikator, når intet felt har fokus, åbner baren og indsætter tegnet.
  Undtagelser: når en modal er åben, når `e.metaKey/ctrlKey/altKey`, og når
  `document.activeElement` er `input`/`textarea`/`[contenteditable]`.
- Under baren: **søgeresultater og »Opret …« side om side**. Oprettelse står altid
  øverst og kan altid nås med `Enter` — søgning må aldrig komme i vejen (handover §5.1).
- **Live-preview-chips** viser, hvordan teksten er tolket, mens der skrives:
  `#hjem` `@Køkken` `⏰ fre 21/8` `↻ hver mandag · fast plan`.
  Det er dem, der gør gentagelsestilstanden »tydelig for brugeren«.

## 3 · Genvejssyntaks

| Tegn | Betydning | Eksempel |
|---|---|---|
| *(intet)* | Opgave i Inbox | `ring til lægen` |
| `+` | Opgave (eksplicit) | `+ køb mælk` |
| `*` | Note | `* kontonummer 1234` |
| `#` | Kontekst (bekræftes hvis ny) | `#telefon` |
| `@` | Projekt | `@Sommerhus` |
| `!` | Dato / gentagelse | `!i morgen`, `!hver mandag` |
| `~` | Skjul indtil | `~1/9` |

### Beskrivelse og links

Hver opgave har ud over titlen et **beskrivelsesfelt** (flerlinjet, markdown,
gemmes i `items.body`). Både beskrivelsen og **selve titlen** må indeholde links:

- Rå URL'er (`https://…`) og `[tekst](url)` bliver klikbare.
- Kun `http:` og `https:` accepteres — `javascript:` og `data:` afvises i
  linkifiseringen, ellers er et link fra API'et eller en import en XSS-vej.
- Alle links får `target="_blank" rel="noopener noreferrer"`.
- I lister vises titlen på én linje; er der en beskrivelse, markeres det med et
  lille diskret tegn frem for at folde teksten ud.

### Dansk dato-tolkning — minimum i F1

`i dag` · `i morgen` · `i overmorgen` · `mandag`…`søndag` (næste forekomst) ·
`næste mandag` · `næste uge` · `næste måned` · `om N dage|uger|måneder` ·
`3/9` · `3/9-2027` · `3. sep` · `ultimo måneden`.
Kan ikke teksten tolkes, **oprettes opgaven alligevel** uden dato, og chippen siger
»forstod ikke datoen« — fangst må aldrig fejle på grund af en dato.

### Gentagelser — Todoist 1:1 (Andreas' valg)

`!` **efter »hver«** betyder *fra fuldførelse*. Uden er det fast plan.

```
!hver mandag          → fast plan: forfalder hver mandag, uanset om forrige blev lavet
!hver! mandag         → fra fuldførelse: næste opstår først når jeg har markeret udført
!hver dag             !hver! dag
!hver 2. uge          !hver! 3. dag
!hver måned den 3.    !hver år 24/12
!sidste hverdag i måneden
```

Dette **afviger bevidst** fra handover §5.6, der gjorde »efter fuldførelse« til
standard. Andreas har valgt Todoist-kompatibilitet, fordi han kender syntaksen —
og synligheden løses i stedet af preview-chippen, der altid skriver tilstanden ud.

## 4 · Datamodel

Ikke den generiske `items`-blob fra Kokkeri. Alt, der **forespørges eller filtreres**,
får en rigtig kolonne med indeks; kun blødt indhold (markdown, ekstrafelter) ligger i
`data` som JSON. Grunden er RUNE-ERFARINGER §4: endepunkter uden login (iCal) og
lister må aldrig scanne hele datasættet.

```
items      id, kind(task|note), status, title, body(JSON), project_id, area_id,
           due_date, due_time, defer_date, waiting_for, seq,
           recurrence_id, occurrence_of, skipped,
           created_at, updated_at, completed_at, deleted
projects   id, name, outcome, area_id, status, parent_id, seq, reviewed_at
areas      id, name, seq
contexts   id, name, seq
item_contexts  item_id, context_id
recurrences    id, rule(JSON), mode(schedule|completion), paused,
               template(JSON), next_due, skips, last_completed_at
tokens     id, name, hash, prefix, scope, created_at, last_used_at, revoked_at
audit      id, at, event, subject, detail
settings   key, value
```

### Datoer og tidszone

Deadlines gemmes som **lokal dato + valgfrit klokkeslæt** (`YYYY-MM-DD` + `HH:MM`),
aldrig som UTC-tidsstempel. Instantet beregnes først ved iCal-eksport og
notifikationer, i `Europe/Copenhagen`. Det er den eneste måde, »hver mandag kl. 8«
kan overleve sommertidsskiftet uden at drive (handover §5.6).

## 5 · Sikkerhed og opdatérbarhed

Andreas' to eksplicitte krav. Konkret:

1. **Nul afhængigheder** → ingen tredjeparts-CVE'er at jagte.
2. **`docker.image: "{{NODE_IMAGE}}"`** med default `node:24-alpine`. Skemaet
   templater `docker.image`, så Node-versionen bliver et **felt i panelet**: findes
   der en CVE, kan Andreas skifte til `node:24.9.1-alpine` eller `node:26-alpine`
   uden at røre en linje kode. Flydende tag som standard betyder desuden, at en
   geninstallation henter seneste patch.
3. **`update:`-blok i runen** (ny panelfunktion) — »Opdatér app«-knap der skriver
   app-filerne igen og lader `/data` stå. Adskilt fra geninstallation.
4. **Adgangsnøgler**: kun `sha256(nøgle)` i databasen, sammenlignet med
   `timingSafeEqual`. Vises én gang. Scopes `capture` (kun oprette) / `read` / `full`.
   `sidst brugt`-stempel. Tilbagekaldelse virker øjeblikkeligt (ingen cache).
5. **Streng CSP uden `unsafe-inline`**. Tema-scriptet skal køre før første paint og
   er derfor inline — `build_rune.py` beregner dets sha256 og stempler hashen ind i
   CSP-headeren. Ingen `eval`, ingen eksterne kilder.
   Desuden: `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`,
   `base-uri 'none'`, restriktiv `Permissions-Policy`.
6. **Vedvarende rate-limit i databasen** (ikke in-memory som i Bogreolen) på login
   og på nøgle-brug — så en panel-genstart ikke nulstiller en igangværende angrebs-tælling.
7. **Audit-tabel** + `events:`-blok i runen, så fejllogin ruller op i panelets
   sikkerhedshistorik pr. IP.
8. `Content-Type: application/json` kræves på POST/DELETE (CSRF-barriere oven på
   `SameSite=Lax`). Body-loft, feltlængde-loft, whitelisting server-side.
9. **iCal-feedet slår op på et udtryks-indeks** og læser aldrig hele datasættet —
   kalender-apps poller hvert kvarter (RUNE-ERFARINGER §4, Kokkeris dyre lektie).
10. Passkeys **må aldrig erstatte kodeordet**: panelet tilgås på `IP:port` over http,
    hvor WebAuthn ikke findes. Kodeordslogin skal altid virke.

## 6 · Handoverens åbne spørgsmål (§11) — mine svar

**Hvor meget dansk dato-sprog?** Se §3. Bevidst lille start, udvides efter brug.
Uforståelig dato blokerer aldrig en fangst.

**Note til flere projekter?** Ét projekt. Andreas' egen hældning, og det holder
datamodellen og projektvisningen enkel.

**Dobbelt-fuldførelse samme dag?** Løst strukturelt frem for med en advarsel:
en forekomst kan kun fuldføres én gang (fuldførelse er bundet til forekomstens id),
og den **nye** forekomst er skjult indtil sin forfaldsdato. Ligger den i fremtiden,
kan den slet ikke rammes ved et uheld. Dertil et 10-sekunders fortryd i toasten,
som ruller både fuldførelsen og den nye forekomst tilbage.

**Hvad sker der med et droppet projekts opgaver?** Åbne opgaver får status
`Droppet` med samme tidsstempel og et `droppet_med_projekt`-flag — så de kan
rulles tilbage samlet, hvis projektet genåbnes. Allerede udførte opgaver røres ikke
(logbogen skal blive ved med at være sand). Noter beholdes urørt; de er reference,
ikke forpligtelse.

## 7 · Uden for scope

Handover §10 gælder uændret: ingen flere brugere, ingen prioritetsniveauer, ingen
statistik/streaks/gamification, ingen tovejs-sync, ingen notifikationer ud over
deadlines og gennemgangspåmindelsen.
