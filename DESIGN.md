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

### Skallen (v7)

- **Sidebaren kan foldes helt væk** til en hamburger, som i tingdo. Skjult
  ligger den som et **overlay** over indholdet i stedet for at skubbe det —
  ellers hopper hele siden, hver gang man kigger i menuen. Nålen i sidebarens
  top slår det til og fra, og valget huskes i `localStorage`.
- **Sideoversigt i højre side**, Notion-agtig: én streg pr. `h2` på siden, som
  folder sig ud med teksten på hover og markerer det afsnit, man er i. Den bor
  i `<body>`, ikke i `#pageHost` — alt derinde skiftes ud ved hver optegning.
  Vises kun ved to afsnit eller flere, og aldrig under mobilgrænsen.
  **Gribefladen er større end stregerne**: uden en usynlig venstre-margen er
  hvert mål kun ~24×10 px, og man skal ramme præcist for at folde ud.
- **Versionsnummeret står altid nederst i sidebaren.** Serveren melder sit eget
  tal i `/api/public-config`; er de forskellige, kører browseren en gammel
  `app.js` fra cachen, og linjen bliver til en »reload«-knap, der rydder
  service workerens cache først.
- **Tema skiftes med ét klik** ved siden af versionen. Knappen viser det tema,
  man skifter *til*. Alle tre valg (inkl. »Follow system«) bliver i Settings.
- **Log ud hører hjemme i en menu på brugerknappen**, ikke kun i Settings.

### Noter har deres egen skærm — og den hedder »Notes«

GTD kalder ikke-handlingsbart materiale for **reference**, og tingdo har en
skærm af det navn. doda kalder det **Notes**, fordi appen allerede har valgt
ordet: `*` opretter en *note*, detaljeruden siger *Make it a note*, ikonet er en
note, og datamodellen hedder `kind = 'note'`. To ord for det samme er ét for
meget.

Uden skærmen kunne en note **uden projekt** kun findes ved at søge — den stod
bogstaveligt talt ingen steder i menuen. Noterne grupperes efter projekt med
»No project« sidst, præcis som Next Actions grupperer efter kontekst.

En note får **ikke** en afkrydsningsring i listen, men sit notikon: en note er
reference, ikke arbejde, og skal derfor ikke engang *tilbyde* at blive markeret
udført. Mellemrumstasten gør heller ingenting på en note.

### Offline dækker handlinger, ikke kun fangst (v11)

F6 lagde fangst-køen i appen, ikke i service workeren. Den dækkede kun
*oprettelse* — at tikke en opgave af uden net gav browserens egen fejltekst.
Nu er køen **typet**: `capture`, `complete`, `status` og `delete` sendes ad
samme vej, én ad gangen og i rækkefølge.

To ting gør det sikkert:

- **En opgave, du opretter offline, er usynlig indtil den er sendt** — køen
  gemmer kun teksten. Du kan derfor aldrig komme til at køe en handling mod et
  id, serveren ikke kender. Den værste fælde er lukket af arkitekturen, ikke af
  en kontrol.
- **Køen efter en handling må ikke gentegne siden fra serveren.** `tegnSide()`
  henter, og uden net (eller uden noget i service workerens cache) ville listen
  blive erstattet af en fejlside — man tikker af og ser skærmen forsvinde. Kun
  den ramte række tegnes om, ud fra state og køen.

Rækken viser hvad der venter (»done — waiting to send«) og er dæmpet. Formen på
en kø-post er **bagudkompatibel**: en post uden `type` er en fangst, som køen så
ud før v11, og der kan ligge sådanne på en telefon.

### Påmindelser går gennem kalenderen, ikke gennem push (v12)

F11 valgte at lade være med at bygge Web Push til den ugentlige gennemgang:
VAPID-nøgler, en push-tjeneste, en SW-handler og et permission-prompt er en hel
infrastruktur for at råbe én gang om ugen. Begrundelsen sagde, at **de rigtige
deadlines allerede havde en vej ud — iCal-feedet**.

Det var rigtigt tænkt, men feedet manglede en `VALARM`, så abonnementet var
tavst: kalender-appen havde ingenting at give besked på. Nu er den der.

- **Kun opgaver med et klokkeslæt** får en alarm. En heldagsopgave ville ringe
  ved midnat, og »ingen røde tællere, ingen alarmfarver« (§2) gælder også for
  støj: en påmindelse man ikke bad om, er den hurtigste vej til at slå hele
  feedet fra.
- Standard er **et kvarter før**; brugeren kan vælge fra »ingen« til »1 time
  før«. Valget ligger i `ical_alarm`.
- Det virker **med appen lukket**, uden tilladelser og uden nøgler — og det er
  telefonens egen notifikationsmekanisme, som brugeren allerede stoler på.

### Web Push (v13) — for den, der ikke abonnerer med sin kalender

Kalenderen er stadig den **primære** vej: den virker uden tilladelser, uden
nøgler og uden at doda skal kunne nå ud til noget. Push er alternativet.

To valg gør det lille nok til en rune uden pakker:

- **VAPID med `node:crypto`.** Et P-256-nøglepar og et ES256-JWT er alt, en
  push-tjeneste kræver. Den ene fælde: signaturen skal være **rå `r‖s`** (64 b)
  — Node giver DER som standard, så `dsaEncoding: 'ieee-p1363'` er ikke
  valgfri. Nøglen laves én gang og må aldrig skifte; gør den det, dør alle
  abonnementer.
- **Ingen nyttelast.** RFC 8291's kryptering (ECDH + HKDF + aes128gcm) er ~70
  linjer fedtet kryptokode, man selv skal holde rigtig. En tom push vækker
  service workeren, som selv henter fra serveren, hvad den skal vise. Gevinsten
  er større end de sparede linjer: **push-tjenesten ser aldrig, hvad opgaverne
  hedder.**

Dertil:

- En push **skal** ende i en synlig notifikation, ellers viser browseren sin
  egen »dette websted er opdateret i baggrunden«. Hver gren i service workeren
  slutter derfor med et `showNotification` — også når hentningen fejler.
- `notified_at` stemples **før** afsendelsen. Fejler pushen, er en manglende
  påmindelse bedre end en, der gentages hvert minut i en time.
- Vinduet er ensidigt og højst en time bredt: har serveren været nede et døgn,
  skal den ikke vække nogen med gårsdagens påmindelser, når den starter igen.
- UI'et siger **hvilken** forudsætning der mangler — https, browserunderstøttelse,
  eller på iOS at appen ligger på hjemmeskærmen. En knap, der bare ikke virker,
  er det værste svar.

### Gennemgangen har tre måder — og et ugeoverblik (v15)

Efter tingdo. Startsiden viser en kort forklaring, en hilsen og **ugens tal**,
og lader dig vælge hvordan du vil igennem:

| Måde | Trin |
|---|---|
| **Speed** | Inbox → projekter. Ikke andet. |
| **Simple** | Alle seks lister, én ad gangen. |
| **Focused** | Vælg ugens projekter først, gå så hele vejen igennem. |

Måderne er **udelukkende** en liste af trin-id'er (`MAADER`). Der er ingen
»hvis speed«-forgreninger nede i trinnene, og `reviewTrin()` slår op på trinnets
**id**, ikke dets nummer — ellers ville en ny måde flytte alle grenene.

Måden og ugens valgte projekter ligger på **serveren** ved siden af trinnet.
Genoptager man en gennemgang, skal man ikke pludselig gå en anden vej igennem,
og et afkrydset projekt skal ikke gå tabt ved »Continue later« — derfor gemmes
valget straks, ikke ved »Next«.

**Om ugens tal og §7.** `§7` siger »ingen statistik/streaks/gamification«, og
logbogen har med vilje hverken tal eller grafer. Tallene her er en bevidst,
snæver undtagelse: de er **fakta til samtalen**, som gennemgangen skal starte
med (har jeg fanget tyve og afklaret to?), og de vises kun dér. Ingen streaks,
ingen grafer, ingen sammenligning med sidste uge, ingen score. »Captured and
clarified« hedder det, den er — et skøn, fordi der ikke findes historik at
spørge, og et tal må ikke se præcist ud uden at være det.

### Tastaturet ind i listerne

`↑`/`↓` går **ind** i listen uden at åbne noget. Før kunne fokus kun komme fra
et klik, og et klik åbner opgaven — så genvejstasterne (`n`, `w`, `s`, `x`) var
i praksis uopnåelige. `Esc` slipper listen igen, så bogstaverne går tilbage til
»begynd bare at skrive«. **Kun piletaster** må fange listen: gjorde `j`/`k` det
også, kunne man ikke længere fange en opgave, der begynder med dem.

### Paletten opretter også i `/`, `#` og `:`

De tre navigations-tilstande kunne kun søge. Nu står »NEW …« **nederst** i
listen — modsat fangst-tilstanden, hvor oprettelse står øverst. Grunden er, at
det normale her er at springe hen til noget, man har: med oprettelsen øverst
ville Enter lave en dublet, hver gang man skrev de første bogstaver af et navn,
der allerede findes. Er navnet en nøjagtig træffer, tilbydes oprettelse ikke.

## 2b · Sprog

**Interfacet er engelsk.** Andreas' valg undervejs i F1: æ, ø og å er besværlige at
taste i et felt, man bruger hundrede gange om dagen.

**Parseren er tosproget.** Engelsk er det primære (`!tomorrow`, `!next friday`,
`!every monday`), men de danske ord virker uændret (`!i morgen`, `!om 2 uger`,
`!hver mandag`). Det koster kun ekstra opslag i tabellerne og fjerner risikoen for,
at en indgroet vane pludselig fejler.

**Kode, kommentarer, README, PLAN og DESIGN er dansk.** Kun det, Andreas ser i appen,
er engelsk. Datoformatet i UI'et er `en-GB` (24-timers, dag før måned) — ikke `en-US`.

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
11. **OAuth 2.1 til claude.ai's connectors** (`app/oauth.js`, se `docs/OAUTH.md`).
    Valgene bag den:
    - Access-tokens får **ikke deres egen tabel**. De lægges i `tokens` med et
      `client_id` og et `expires_at`, så de valideres af `findToken` ad præcis
      samme vej som en håndlavet nøgle. Én validering, ét sted at tilbagekalde.
    - **Roterende refresh** og 8 timers levetid på access-tokenet. Koden er
      engangsbrug, lever ét minut og er bundet til både klient og redirect.
    - **PKCE med S256 er obligatorisk** — `plain` er ikke en beskyttelse.
      `redirect_uri` matches nøjagtigt; kun https udefra, `localhost` undtaget.
    - **Samtykkesiden har ingen JavaScript** (CSP'en tillader ikke inline
      scripts uden hash) og bærer et session-bundet bevis, fordi den er appens
      eneste cookie-godkendte rute uden en JSON-krop.
    - En connector kan **ikke administrere sig selv**: kodeordsskift, nøgler og
      tilbagekaldelse af forbindelser kræver stadig `requireUser()`.

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

**Enkeltbruger er en beslutning, ikke en forglemmelse.** Den er grunden til, at ingen
datatabel har en `user_id`, at `settings` er global, og at token-godkendelsen henter
brugeren med `LIMIT 1`. Andreas spurgte 2026-08-17, hvad flere brugere ville koste;
undersøgelsen ligger i `PLAN.md` under »Mulige udvidelser«. **Der er ikke truffet
nogen beslutning** — men rører du de tabeller, så læs den først, så antagelsen ikke
bliver brudt halvt.
