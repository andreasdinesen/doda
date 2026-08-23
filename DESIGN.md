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

**Gennemgangen kan nu også pushe — slået fra (v53).** Argumentet ovenfor holdt,
så længe push-infrastrukturen ikke fandtes: at bygge en hel kanal for ÉN
ugentlig påmindelse ville være at tilføje meget for at råbe lidt. Men kanalen
**blev** bygget i v13, og så koster det en gren, ikke en infrastruktur.

Andreas bad om den 23-08-2026. Princippet holdes, hvor det tæller: **den er
slukket, indtil man selv tænder den**, og båndet i appen er stadig det, man får
uden at bede om noget.

- Gennemgangen fik et **klokkeslæt** (`review_time`). En påmindelse uden et
  tidspunkt ville komme ved midnat.
- Kontakten vises kun, når der ER en gennemgangsdag: en påmindelse uden noget
  at minde om er en kontakt, der ikke kan gøre noget.
- `review_notified` er et **tidsstempel**, ikke en dato. Datoen ville række til
  »én gang om dagen«, men service workeren skal også kunne se, om pushen lige
  er sendt — den henter selv, hvad den skal vise, og skal kunne skelne
  gennemgangen fra en forfalden opgave.
- Notifikationen lander på `?view=review`, ikke på forsiden. **En besked, der
  beder om en handling, skal lande dér, hvor handlingen sker.**

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

### Notion-integrationen (v16) — og hvad den IKKE er

Linket i sig selv kræver ingen integration (v14). Tokenet giver to ting oveni:
man kan **søge** efter siden uden at skifte vindue, og chippen får sidens
**rigtige titel** i stedet for 40 tegn hex.

- **Tokenet bliver på serveren.** `GET /api/v1/notion` svarer kun
  `connected: true` — aldrig værdien. Søgningen proxies gennem doda, så
  hemmeligheden aldrig er i en browserfane (RUNE-ERFARINGER §6b).
- **Tokenet prøves mod Notion, før det gemmes.** Duer det ikke, ryddes det
  igen — et token, der ikke virker, må ikke blive liggende og *ligne* en
  forbindelse.
- **Notion viser kun sider, integrationen er delt med.** Et gyldigt token er
  ikke nok. Derfor siger en tom søgning ikke »ingen træffere«, men peger på
  delingen — det er den fejl, alle laver første gang.
- Titlen findes ved at lede efter egenskaben med **type `title`**, ikke efter
  nøglen `"title"` eller `"Name"`: i en database kan den hedde hvad som helst.

**Hemmeligheder i `settings` skal stå ét sted.** `HEMMELIGE_SETTINGS` bruges
både af `GET /api/v1/settings` og af eksporten. Ligger listen to steder,
glemmer man den ene, næste gang der kommer en hemmelighed til.

### Notion-sidens indhold vises i doda (v19)

En note med et Notion-link kan folde sidens indhold ud i detaljeruden.

- **Hentes på forlangende, ikke ved hver åbning.** En side kan være lang, og
  Notion er kilden. Svaret ligger i hukommelsen et kvarter — ikke i databasen:
  en kopi kunne blive forkert, uden at nogen opdagede det.
- **Blokke → markdown → dodas egen renderer.** Der bygges aldrig HTML af
  fremmed indhold. Renderen escaper først og laver kun de tags, den selv
  kender, så der er ingen vej fra en fremmed side til et tag, doda ikke har
  skrevet. Bevist i browseren: seks angreb fra et simuleret Notion-svar gav
  nul `script`, nul `img`, nul `iframe`, nul `on*` — og `javascript:` blev
  aldrig et link.
- **Billeder bliver til links — på BLOKKEN, ikke på filen.** doda's CSP er
  `img-src 'self' data:`, så et `<img>` mod Notions S3 ville være tomt. Men den
  vigtigere grund er, at Notions filadresser er **signerede**: de udløber efter
  en time, og de er ~1500 tegn. Et link til en af dem er dødt i morgen, og det
  sprænger `linkify`s 500-tegns grænse, så halen løber ud som rå tekst midt i
  ruden. Adressen er derfor **sidens id med blokken som anker** —
  `https://www.notion.so/<side-id>#<blok-id>`, 87 tegn, som holder evigt.
  Blok-id'et **alene** duer ikke: Notion prøver da at åbne blokken som en
  side, og en billedblok er ikke en side — man får en tom »Untitled«.
- **Loft på 300 blokke og ét niveau indlejring.** En fremmed side kan være hvor
  stor som helst, og doda skal ikke kunne væltes af en, nogen har delt.
- Det, doda ikke kan vise (tabeller, kolonner, synkroniserede blokke), siger
  den ærligt frem for at lade som ingenting. En ukendt bloktype mister ikke sin
  tekst — Notion tilføjer nye, og de skal ikke blive til tomhed.

### Dyb-link: `?item=<id>` (v23)

doda er en SPA uden ruter — der fandtes ingen adresse på ét element. Det gør
der nu, fordi kalenderfeedet skal kunne pege tilbage: kalenderen er der, hvor
man *ser* deadlinen, og det skal også være der, man kan springe hen og gøre
noget ved den.

- Adressen **ryddes** med `history.replaceState`, så snart ruden er åbnet. En
  genindlæsning skal ikke åbne den igen, og et element-id hører ikke hjemme i
  browserhistorikken.
- Er man ikke logget ind, bliver parameteren stående og bruges **efter** login
  — både ved kodeord og passkey. Ellers ville linket fra kalenderen tabes
  præcis på den enhed, hvor man sjældnest er logget ind.
- Et id fra en gammel kalenderpost peger på noget slettet. Det siges roligt
  (»That item is gone«) frem for at vise en fejlside.
- I feedet står linket **både** som `URL:` og i `DESCRIPTION`: `URL:` er den
  rigtige egenskab, men flere klienter viser den ikke særlig tydeligt.

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

**Fra fuldførelse flytter også den DAG, reglen hænger på (v52).** `every! month`
har ingen dag i teksten, så månedsdagen udledes af *ankeret* — datoen, reglen
blev skrevet. Blev den lavet den 22., stod der `monthday: 22` i den for altid,
og selv om serveren regnede fra i dag, gav `naesteForekomst` den 22. i næste
måned: markér udført den 23., få den 22. tilbage.

`rykGentagelse()` gentolker derfor reglen med **fuldførelsesdatoen** som anker.
Teksten er uændret; kun de felter, der *er* udledt af ankeret, flytter sig — og
siger frasen selv en dag (`every! month on the 22nd`), bliver den stående. Den
gentolkede regel gemmes, ellers ville overskriften blive ved med at sige »on
the 22nd«, mens forfaldet lå den 23.

**En fast plan gentolkes ikke.** Den hænger på sin egen dato, og den må ikke
rykke sig, fordi nogen blev færdig på et andet tidspunkt. Der er test på begge.

Dette **afviger bevidst** fra handover §5.6, der gjorde »efter fuldførelse« til
standard. Andreas har valgt Todoist-kompatibilitet, fordi han kender syntaksen —
og synligheden løses i stedet af preview-chippen, der altid skriver tilstanden ud.

### En web app på hjemmeskærmen skal opdatere sig selv (v39)

Andreas' doda på telefonen stod på **v33**, mens serveren kørte v38. Fejl, der
var rettet for længst, blev ved med at vise sig — og han troede rimeligt nok,
at rettelserne ikke virkede.

Årsagen: `navigator.serviceWorker.register()` blev kun kaldt ved
sideindlæsning, og **en PWA på hjemmeskærmen bliver stort set aldrig
genindlæst.** Den lukkes ikke, den skjules. Så opdagede den aldrig, at der lå
en ny `sw.js`, og serverede sin egen cache videre.

- `reg.update()` kaldes nu, hver gang appen kommer frem igen — samme øjeblik
  som den henter data (§v26). Er der ingen ny version, koster det ingenting.
- Når en ny service worker tager over, **genindlæses siden**: `skipWaiting()`
  skifter arbejderen ud, ikke koden foran brugeren.
- Men kun hvis der var en controller i forvejen. Ved allerførste registrering
  fyrer `controllerchange` også (`clients.claim()`), og dér ville en
  genindlæsning være støj ved hver ny installation.

Versionslinjen i sidebaren har hele tiden kunnet vise »v33 · v38 available —
reload« og rydde cachen ved klik. Den virkede — den skulle bare **opdages**.
**En knap, brugeren selv skal få øje på, er ikke en opdateringsstrategi;** den
er en udvej for de gange, automatikken ikke slår til.

Og på telefonen kunne den slet ikke opdages: sidebaren stod med `height:
100vh`, og **på iPhone er `100vh` højere end det synlige felt**, så hele foden
— brugerknap, versionslinje og tema — lå under skærmkanten. Rettet med `100dvh`
(med `100vh` som fallback i en egen erklæring), `overflow-y: auto` så en lav
skærm kan rulle til foden, og `env(safe-area-inset-bottom)`, som bundnavigationen
i forvejen havde. **Udvejen skal virke netop dér, hvor automatikken svigtede** —
og det var på telefonen.

### Focus er en skærm, ikke kun en timer (v38)

Hjælpeteksten i detaljeruden har hele tiden lovet: *»Everything else out of the
way. This task on a screen of its own, with a timer that keeps running.«*
Knappen gjorde `luk(); startFokus(it)` — den lukkede ruden og satte en linje i
bunden, så man landede **i listen**. Altså præcis dét, fokus skulle fjerne.
Teksten var skrevet; funktionen var aldrig bygget færdig.

Det er samme fejl som §v9: **legenden er en kravspecifikation.** Her stod
kravet endda ordret, og ingen havde læst det op mod koden.

- Skærmen er `view: 'focus'` med `group: 0` — den står ikke i navigationen.
  Uden en opgave i fokus er der ingenting at gå ind til.
- **Timerlinjen forsvinder, mens man er på skærmen.** To ure på samme tid er en
  dublet, ikke en bekræftelse.
- **Linjens titel er vejen tilbage.** Uden den kunne man ikke finde skærmen
  igen, når man først havde navigeret væk.
- »Keep it running« forlader skærmen **uden** at stoppe fokus; »Stop« stopper
  og fører tilbage til listen, for en fokusskærm uden opgave er en tom skærm.
- Uret ruller nu minutterne med `% 60`. Det gjorde det ikke før, så efter en
  time og ét minut stod der `1:61:01`.

### Kilden og den færdige note er to udgaver — kun én ad gangen (v37)

Beskrivelsen i detaljeruden har både et redigeringsfelt og en renderet
visning. **Der må kun være én af dem fremme.** Indtil v37 blev kun previewet
styret — det skjultes, mens feltet havde fokus — mens selve tekstfeltet aldrig
blev skjult. Uden fokus stod noten derfor **to gange**: rå i feltet og renderet
nedenunder.

Det var usynligt, så længe noterne var korte. Først da MsGraphBud begyndte at
sende mails ind med en 300 tegn lang Outlook-adresse i beskrivelsen, fyldte
kilden mere end selve opgaven, og fejlen blev åbenlys.

- **I hvile:** den færdige udgave. Feltet er skjult.
- **Under redigering:** kilden. Previewet er skjult.
- **Et klik på previewet** bringer feltet tilbage med markøren i enden —
  **undtagen på et link**, som skal kunne følges (`e.target.closest('a')`).
- Feltet skal være synligt, *før* det kan få fokus, og `scrollHeight` er 0 så
  længe det er skjult — derfor måles højden først bagefter.

Den generelle regel: **viser man både en kilde og dens gengivelse, er
synligheden ét valg med to sider.** Styrer man kun den ene, står begge fremme i
den tilstand, ingen tænkte på.

### En fil på kommandobaren venter på titlen (v36)

Trækker man en fil ind på kommandobaren, **oprettes der ikke noget**. Filen
lægger sig som en chip ved siden af dato- og kontekst-chippene og venter på, at
man skriver en titel og trykker Enter. Er feltet tomt, foreslås filnavnet uden
endelse — men det overskriver aldrig noget, brugeren har skrevet, og **Esc
fortryder det hele uden at efterlade en opgave, ingen bad om**.

Filerne sendes **efter** at elementet findes (en vedhæftning skal have noget at
hænge på). Fejler en upload, er opgaven stadig oprettet: teksten er det
vigtige, filen er tilbehøret.

### »Queued« var en intern tilstand, der var sluppet ud (v36)

`queued` er dodas hvileplads for **noter** — og den, opgaver vækkes til, når et
droppet projekt genåbnes. Den har **ingen skærm**, men stod alligevel i
status-menuen og på `q`-tasten. En opgave sat dertil forsvandt fra Inbox, Next
Actions, Waiting For, Someday **og** logbogen og kunne kun findes ved at søge.

- Den er ude af menuen og af `q` — vil man parkere noget, hedder det Someday.
- Står et element allerede på Queued, **vises den stadig i menuen**, så man kan
  komme væk fra den.
- **Inbox viser nu `queued` opgaver** (`kind=task`, så noterne ikke rives med).
  Det lukker samtidig hullet med, at et genåbnet projekts opgaver landede i
  ingenmandsland.

Den generelle form: **en intern tilstand, der kan vælges i brugerfladen, er en
fælde** — den har ingen skærm, fordi den aldrig var ment som et valg.

### Noter kan slås fra — vejene ind, ikke dataene (v35)

Holder man sin reference i Notion, er dodas noter ét sted for meget.
`notes_off` i settings (fravær = til, så en ny installation ikke mangler noget)
fjerner **vejene ind**: Notes i navigationen, `*` i paletten og dens legende,
*Make it a note* i detaljeruden, hintet på projektsiden og guidens Notes-afsnit.

**Det, der findes, forsvinder aldrig.** Noterne bliver liggende, står stadig på
deres projekt, kan søges frem, og *Make it a task* bliver på en note, så en
enkelt kan flyttes over. En indstilling, der skjuler data, man ikke kan komme
til igen, er en datatabsmaskine med en pæn knap — derfor siger kortet også, hvor
mange noter der er, og hvad der sker med dem.

Flaget kommer med i `/api/v1/state` (ikke `public-config`), så det følger med
hver synk og virker på tværs af enheder uden en genindlæsning. **Hver flade,
der lover funktionen, skal kende flaget** — legenden er en kravspecifikation
(v9), og det gælder også guiden.

### En Notion-side kan oprettes fra doda (v35)

Link-vælgeren har to tilstande: *Link to a page* og *Create a page inside*. I
den anden betyder et klik på et søgeresultat »lav en ny side **under** denne«.

- **Notion kræver en forælder** — der findes ikke en »rod« at oprette i. Det
  passer med virkeligheden: siden skal ligge et sted, ejeren har peget på, og
  det er også dér, integrationen har adgang.
- Navnet foreslås ud fra opgavens eller projektets titel, men **overskriver
  aldrig noget, brugeren selv har skrevet**.
- Tilstanden ændrer kun, hvad et klik betyder — ingen ny liste, ingen ny
  tilstand at holde styr på. Knappen siger hvad den gør, mens den gør det
  (»Creating "…" inside«), for en side i Notion kan ikke tages tilbage herfra.

### Kommentarer til Notion — men doda ejer dem aldrig (v34)

Folder man en Notion-side ud, står sidens kommentarer nedenunder med et felt
til at skrive en ny. Den lander direkte på siden i Notion; doda gemmer intet.

- **Kommentarer er en SÆRSKILT tilladelse på integrationen i Notion.** Et
  token, der læser sider fint, får 403 på kommentarer, indtil fluebenene er
  sat. Fejlen skal derfor pege på *afkrydsningen*, ikke på tokenet — ellers
  fejlsøger man noget, der er i orden. Beskeden står ét sted (`MANGLER_LOV`),
  så begge veje ind siger det samme.
- **Kommentarer caches aldrig**, modsat sidens indhold. En gammel
  kommentarliste er værre end ingen, fordi den ser ud til at være hele
  samtalen.
- **Skrivning har lavere rate-limit end læsning** (60 mod 120 i timen): en
  kommentar går ud i verden og kan ikke tages tilbage fra doda. Den logges i
  auditsporet.
- **Forbindelsen tjekkes før linket og teksten.** Ellers får en bruger uden
  forbindelse at vide, at hans link er forkert. Rækkefølgen er let at bytte om
  på uden at opdage det, så der er en test på den.
- Svaret fra Notion **er** kommentaren, så den vises uden at hente listen igen.

### Titlen er en overskrift, der folder sig ud (v33)

Titelfeltet i detaljeruden var et `input`: en lang titel kunne kun ses gennem
et vindue, og man skulle rulle sidelæns for at finde ud af, hvad opgaven hed.
Nu er det en `textarea`, der vokser med teksten.

Den er stadig **én linje logisk set**, og det er ikke kosmetik: et linjeskift
ville blive gemt i titlen, og parseren læser alt efter det første linjeskift
som **beskrivelse** (`app/shared/parse.js`). Derfor spærres Enter — den
forlader feltet i stedet, så genvejssyntaksen kører — og indsat tekst med
linjeskift samles til én linje. ⌘+Enter gemmer som andre steder.

**To ting, skiftet afslørede på telefonbredde:**

- **En `textarea` har en indbygget mindstebredde** (~20 tegn, fra `cols`), og
  et grid-element må som standard ikke klemmes under sit indhold
  (`min-width: auto`). Kortet blev derfor 378 px på en 375 px skærm, og
  lukkeknappen lå uden for kanten. `min-width: 0` på `.modal-card` løser det.
- **`.modal-foot` kunne ikke bryde.** Delete, Make it a note, Cancel og Save er
  for meget til én linje på en telefon, og Save lå uden for kortet.

Projektsiden har samtidig fået samme **»Show the Notion page«** som en opgave —
den kalder `notionRude()`, så de to steder ikke kan drive fra hinanden.

### At gå til en skærm betyder at se den ren (v32)

`gaaTil()` nulstillede kun undertilstanden, **hvis skærmen skiftede**. Det gjorde
et projekt til en blindgyde: står man inde i ét, er `state.view` allerede
`projects`, så hverken sidebaren eller »← Projects« ændrede noget — `openProject`
blev stående, og siden tegnede sig selv igen. Der skete tilsyneladende ingenting.
Samme fejl ramte kontekstfilteret i Next Actions og projektfilteret i logbogen.

Reglen nu: **`gaaTil()` rydder altid `openProject`, `filterContext`,
`filterArea` og `logProject`**, og `opt` sætter det, der er ment
(`gaaTil('next', {context})`, `gaaTil('projects', {area})`). Et filter er noget,
man vælger — ikke noget, man arver.

Den generelle form, værd at kende igen: **en nulstilling, der er betinget af
»kun hvis noget skiftede«, svigter præcis dér, hvor brugeren står i en
undertilstand af den skærm, han klikker på.** Og det samme klikmål skal kunne
rydde den tilstand, det selv kan sætte.

### ⌘+Enter gemmer — bundet på knappen, ikke på »den primære« (v31)

En rude, man har tastet sig igennem, skal kunne afsluttes uden at gå efter
musen. ⌘+Enter (Ctrl+Enter) gemmer opgaven, gentagelsen og projektet.

Det afgørende er **hvor genvejen bindes**. Den nemme løsning — én global regel,
der trykker på `.modal .btn.primary` — ville også ramme spørgsmålet *»denne
gang eller alle fremtidige?«*, hvor den primære knap ændrer **hele serien**. Et
tastetryk må ikke kunne svare på et spørgsmål ved et uheld. Derfor kalder hver
rude selv `bindGemGenvej(host, dens egen knap)`, og en rude, der ikke gemmer
noget, kalder den ikke.

`preventDefault` er ikke pynt: uden den lægger beskrivelsesfeltet et linjeskift
ind i samme ombæring. Enter alene laver stadig linjeskift dér — kun med ⌘ gemmer den.

### Forslag mens man skriver et navn (v30)

Paletten viser nu de projekter og kontekster, der matcher et **halvskrevet**
`/`, `@` eller `#` midt i en linje. Uden det var den eneste vej til det rigtige
navn at huske det — og bekræftelsen (»Create @dod?«) fangede kun tastefejl
*efter* de var begået.

- **Forslagene følger parserens regler**, ikke sine egne: markøren skal stå ved
  linjestart eller efter et mellemrum, og navnet er ét ord. Ellers ville
  paletten foreslå noget, teksten bagefter blev tolket anderledes — og
  `navn@eksempel.dk` ville åbne en projektliste.
- **Det, der begynder med det skrevne, står øverst.** Med ren
  »indeholder«-sortering foreslog `/hus` projektet *Sommerhus* før *Hus og
  have*, og Tab satte det forkerte navn ind.
- **Forslagene står UNDER oprettelsen.** Ét Enter skal stadig fange — det er
  appens ældste regel (handover §5.1). **Tab** tager det øverste forslag;
  ruller man ned til et forslag, tager Enter dét, fordi Enter altid handler på
  den valgte række.
- Navne med mellemrum sættes i anførselstegn (`/"Hus og have"`), for det er
  den form, parseren læser.

Samme runde: **søgningen bruger den tolkede titel**, ikke den rå linje. Skrev
man `test /dod`, blev hele strengen sendt til søgningen, og de resultater, der
stod der et øjeblik før, forsvandt. Markørerne hører til tolkningen — brugeren
har stadig kun skrevet »test«.

### Den, der har handlet på tasten, ejer den (v29)

Fangst-handleren (»begynd bare at skrive«) trækker sig, når fokus står i en
liste med tastaturafklaring. Det værn hang på `document.activeElement` — og
v27's optimistiske opdatering rykkede tæppet væk under det: rækken fjernes nu
**inde i** tastetryk-håndteringen, og er det den **sidste** række i listen, er
der ingen næste at give fokus til. Fokus faldt til `body`, værnet så ingen
liste, og `s` både flyttede opgaven til Someday og åbnede paletten med et »s«.

To lag, fordi ét ikke er nok:

- **Rækken stopper udbredelsen** (`stopPropagation`), når den selv har
  handlet på tasten. `preventDefault()` alene gør det ikke.
- **Værnet ser på hændelsens `target`**, ikke kun på hvad der har fokus
  bagefter. Et element ved stadig, hvor det kom fra, også efter det er taget
  ud af dokumentet — det dækker alt, hvad der bygges oven på senere.

Lærestregen er større end fejlen: **en optimistisk opdatering, der fjerner det
fokuserede element, bryder ethvert værn, der spørger om fokus.** Og fejlen
findes kun ved den SIDSTE række — med to rækker opførte alt sig pænt.

### Skærmen udfylder — den bestemmer ikke (v28)

»Alt ind i Inbox« er stadig princippet: fang først, afklar bagefter. Men der er
forskel på **at fange** og **at stå et sted**. Trykker man en tast på en
vilkårlig skærm, er man i fangst-tilstand og har ikke besluttet noget. Går man
derimod *ind i* Waiting For eller Someday og skriver, er beslutningen taget ved
at gå derhen — at sende den til Inbox betyder, at man skal tage den igen.

| Skærm | Udfylder | Status |
|---|---|---|
| Waiting For · Someday | statussen | `waiting` · `someday` |
| En projektside | projektet | bliver `inbox` |
| Next Actions filtreret på en kontekst | konteksten | bliver `inbox` |

De to sidste bliver med vilje i Inbox: noget, der falder én ind midt i
arbejdet, er ikke afklaret, bare fordi man stod på en liste.

Fire regler holder det ærligt:

- **Teksten vinder altid.** Skriver man `@NogetAndet`, gælder det — skærmen må
  aldrig overskrive noget, brugeren udtrykkeligt har skrevet.
- **Kun `waiting` og `someday`** kan en skærm implicere. Aldrig `next`.
- **En note rives aldrig med.** Reference får ingen status af en skærm.
- **Ukendte id'er ignoreres i stilhed.** En fangst må aldrig kunne fejle på
  noget, brugeren ikke selv skrev.

Udfyldningen sendes som `from` til `/api/v1/capture`, og **serveren har det
sidste ord** (`skaermensUdfyldning()`). En klient uden skærm — iOS-genvej,
Siri, Claude — sender ingenting og får Inbox som før; det er den regel, der er
usynlig i browseren, og derfor den vigtigste i `tests/capturefrom.test.mjs`.
Og chippen under feltet siger hvor opgaven lander, **før** man trykker Enter:
udfylder appen noget, skal man kunne se det, mens man stadig kan ombestemme sig.

### Ventetiden hører bag brugeren, ikke foran ham (v27)

Et tryk på `n` ventede på **tre kald i træk** — gem, hent tal, hent liste —
før rækken rørte sig. Lokalt er det 24 ms og usynligt; over en tunnel er hver
rundtur ~180 ms, og så sidder man og trykker på en tast, der tilsyneladende
ikke virker. **Serveren svarer på under et millisekund; det var rækkefølgen,
der var forkert.**

- Rækken forlader listen **først**, tegnet af `state` alene, og serveren får
  besked bagefter. Tal og liste opfriskes derefter stille (`synk(false)`).
- **Fangst venter på ét kald i stedet for tre**: svaret fra `/capture`
  indeholder allerede elementet, så det sættes direkte ind i listen.
- Måles der i **kald**, ikke i millisekunder: et blokerende kald mere er
  altid mærkbart for den, der sidder langt væk fra serveren.

En optimistisk opdatering må aldrig kunne æde data. Derfor returnerer
`straksVaek()` en **fortryd-funktion**, som køres *før* den almindelige
fejlhåndtering — så `offlineKoe()` finder rækken, hvor den plejer, og kan
markere den »waiting to send«. Og den bruges kun på skærme, listen kan tegnes
af `state` alene (Inbox og Next Actions); alle andre går den gamle vej.

### Appen henter selv, når den kommer frem igen (v26)

En app på hjemmeskærmen bliver **aldrig** genindlæst. Den ligger i baggrunden,
og indtil v26 var den eneste vej til friske data at skifte skærm — hvert
sideskift henter jo sin egen liste. Det er ikke noget, brugeren skal kende:
en app, der viser gamle tal, er en app, man holder op med at stole på.

To ting, og de skal begge være der:

- **Automatisk** på `visibilitychange`, `pageshow` (iOS' bfcache) og `online`.
  Ved `online` tømmes udbakken **først** — det, man selv har lavet, skal ind,
  før der hentes ned. En 3-sekunders spærre, så et delings-ark, der blinker
  forbi, ikke udløser en hentning.
- **En synlig knap**, der samtidig siger *hvor gammelt* det viste er
  (»just now«, »8 min ago«). Uden det svar kan man ikke skelne »der er ikke
  sket noget« fra »appen har ikke spurgt«.

**En baggrunds-hentning må kun gøre siden nyere, aldrig tommere.** Derfor
findes flaget `stilleGentegning`: ingen »Loading…«-skelet, og en fejl undervejs
efterlader det, der står, i fred. Uden det ville et tabt signal midt i en synk
erstatte brugerens liste med en fejlside — samme fejlklasse som v11's regel om
aldrig at gentegne fra serveren efter en offline-handling.

### Guiden bor i brugermenuen, ikke i navigationen (v25)

En samlet gennemgang af appen — bygget som tingdos `/settings/guide/` — ligger
som en side med `group: 0`, altså uden for sidebaren. Den nås fra menuen på
brugerknappen, ved siden af Settings og genvejsarket: det er dér, man i forvejen
leder efter »om appen«-ting, og en ellevte linje i navigationen ville koste
plads hver eneste dag for noget, man læser to gange.

**Formen er tingdos, indholdet er dodas.** Fire **dele** (»How doda works«,
kommandobaren, tastaturet, uden for browseren), inde i dem **grupper** med et
versalt mærke (CAPTURE, ACT, ORGANISE …), og inde i dem **emner** med en kort
indledning, rækker med et mærke i venstre side, og af og til en »In short«.
Siden er ren data i `GUIDE_DELE` — teksten står ét sted, opsætningen et andet.

Tre ting holder guiden fra at komme til at lyve:

- **Fangst-syntaksen kommer fra `syntaksTabel()`** og genvejene fra `GENVEJE` —
  samme kilder som Settings og genvejsarket bruger. Ændres syntaksen ét sted,
  følger alle tre med.
- **doda er ikke tingdo, og guiden må ikke arve forlæggets funktioner.**
  Fokus *tager ikke tid* (der er ingen registrering), der er ingen
  »Scheduled«-liste, og gentagelser findes kun her.
- Mærket i venstre side afgøres af **teksten**, ikke af dens længde: er den
  skrevet med versaler, er den en etiket, ellers er den noget, man kan taste
  af. En længderegel gjorde `!every monday` til en etiket, og
  `text-transform: uppercase` skrev den som `!EVERY MONDAY` — altså en syntaks,
  der ikke findes.

Hvert emne er en `<h2>`, så sideoversigten i højre kant (§9b i erfaringsfilen)
bliver guidens indholdsfortegnelse uden en linje ny mekanik.

### Hvor syntaksen virker — og hvor den med vilje er skåret ned (v24)

Genvejssyntaksen virker tre steder: i fangst, i **titlen man retter** i
detaljeruden, og — fra v24 — i gentagelses-rudens titelfelt. De to første tager
det hele. Gentagelses-ruden tager **kun `#kontekst` og `@projekt`**.

Grunden er, at ruden har sit eget regelfelt lige under titlen. To veje til den
samme regel er præcis den forvirring, ruden er skruet sammen for at undgå — og
en `!`-tekst, der blev spist af parseren uden at kunne lande i et felt, ville
være tavst datatab. `anvendSyntaks(u, raa, kunNavne)` slår derfor dato-grenen
fra; alt med `!` bliver stående, som brugeren skrev det.

Navne, der ikke findes endnu, oprettes **først ved Save** og vises indtil da
som en chip eller et punkt i vælgeren mærket »— new«. Et Cancel må ikke kunne
efterlade et projekt, brugeren aldrig bad om.

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

Handover §10 gælder uændret: ingen flere brugere, ingen
statistik/streaks/gamification, ingen tovejs-sync, ingen notifikationer ud over
deadlines og gennemgangspåmindelsen.

**»Ingen prioritetsniveauer« blev til én stjerne (v54).** Fravalget stod, fordi
niveauer koster tre beslutninger pr. opgave, og fordi »lav« i praksis bliver et
sted at gemme det, man alligevel ikke laver. Andreas bad om prioritet
23-08-2026, og det, han ville, var at **løfte** en opgave i Next Actions — ikke
at mærke den.

Derfor ét flag: `starred`, 0 eller 1. Det har én betydning og én virkning, og
det er stadig ikke niveauer. Sorteringen er `starred DESC, seq, created_at`, så
rækkefølgen **inden for** hver gruppe er uændret — det, man selv har trukket på
plads, bliver stående.

**Enkeltbruger er en beslutning, ikke en forglemmelse.** Den er grunden til, at ingen
datatabel har en `user_id`, at `settings` er global, og at token-godkendelsen henter
brugeren med `LIMIT 1`. Andreas spurgte 2026-08-17, hvad flere brugere ville koste;
undersøgelsen ligger i `PLAN.md` under »Mulige udvidelser«. **Der er ikke truffet
nogen beslutning** — men rører du de tabeller, så læs den først, så antagelsen ikke
bliver brudt halvt.

---

## Sagu-broen (2026-08-21)

Sagu er søsterappen, hvor noterne bor — den skal afløse Notion. **`notion.js`
bliver stående**, indtil migreringen er kørt færdig: to kilder til det samme
felt er i orden, så længe feltet er *generisk*. Det er `link_url`/`link_title`
med vilje; de blev aldrig døbt `notion_url`, og det er dét, der gør, at Sagu
kan glide ind uden en ny kolonne.

### Adressen afgør, hvem der skal spørges

Ikke en tilstand, nogen skal huske. En Sagu-note hedder `…/#note-<32 hex>` —
den adresse, Sagu selv åbner på. `linkRude()` vælger rude ud fra adressen, og
`/api/v1/link/refresh` vælger kilde på samme måde.

**Ruten hed `notion/refresh`, indtil den også svarede for Sagu.** Så skulle den
skifte navn: et navn, der lover noget andet end det, koden gør, er den dyreste
slags fejl. Det gælder også funktionen bag (`friskLinkTitel`).

### Titlen opfriskes hvert minut, ikke hvert døgn (v50)

Vinduet i `/api/v1/link/refresh` var **86.400 sekunder**. Døber man en note om
i Sagu, viste doda derfor det gamle navn indtil i morgen — mens den almindelige
gang er »skift app, ret noget, skift tilbage« og tager to minutter.

Sagu ramte nøjagtig det samme på opgavestatus (deres §33) og gik til 60
sekunder. Her gælder samme tal, så de to tvillinger ikke opfører sig
forskelligt om det samme.

Det er billigt, fordi kaldet sker ved optegning af **én** opgave eller **ét**
projekt — ikke pr. række i en liste. Og »kig efter, når fanen kommer frem«
kræver ingen ny kode: appen genindlæser i forvejen ved `visibilitychange`, og
projektsiden tegnes om, så titlen er frisk med det samme.

**Tallet er pinnet af en test.** Sættes det op igen, skal det være et valg.

**FORMEN afgøres først — ikke om en forbindelse er sat.** En Sagu-adresse
slutter på 32 hex, og Notions id-genkendelse leder efter præcis det. Uden en
første sortering ville doda spørge *Notion* om en Sagu-note, så snart Sagu ikke
var forbundet. **En test fandt det; øjet ville aldrig have set det.**

### Hvad broen må

Nøglen fra Sagu er en **`link`-nøgle**: den kan søge og oprette — og ikke
slette. Det scope findes, fordi denne bro skulle bruge det; uden det måtte doda
have en `full`-nøgle til hele notearkivet for at skrive ét link. Der er en test
mod en rigtig Sagu på, at nøglen får **403 på en sletning**.

Kommentarerne kan kun **læses**. Skal man svare, hører det hjemme i Sagu, hvor
samtalen står — og en kommentar fra wikien er fremmed indhold, så den går
gennem den samme renderer som Notion-sider: escape først, match bagefter.

### `*` fik en række mere — og blev siden til Sagu alene (v44)

Planen sagde »`*` i fangstfeltet opretter en Sagu-note«. Først blev det en
**række mere**: `*` betyder allerede *ny note i doda*, og at lade markøren
skifte betydning, fordi en indstilling er sat, ville ændre det, ét Enter gør,
**uden at nogen bad om det**. Førstepladsen var urørt, så appens ældste regel
holdt.

**Andreas bad om det den 21-08-2026,** og så faldt den begrundelse væk. Er der
koblet en note-app på, hører noterne dertil — to rækker er to steder at lede
efter den samme note bagefter, og et valg, der skal træffes forfra hver gang,
selv om svaret altid er det samme.

Så: er Sagu forbundet, er `*` en note **i Sagu**. Legenden siger det nu også
(»`*` note in Sagu«) — den er en kravspecifikation (§v9).

- **Det er vejen ind, der lukkes — ikke dataene** (§v35). De noter, der ligger
  i doda, bliver liggende, står stadig på deres projekt og kan søges frem.
- **Nødudgangen skal findes, netop når den bruges.** Før pegede fejlstien på
  »vælg den almindelige note ovenover« — den række findes ikke længere. Uden
  en vej ud ville en note være *umulig* at gemme, mens Sagu er nede, og
  teksten ville stå i feltet uden noget sted at gå hen. Fejler Sagu, tilbyder
  beskeden derfor **»Keep in doda«**. Det er en nødudgang, ikke et valg, man
  skal træffe hver gang.

Rækken siger fortsat selv, hvad den gør (»NEW NOTE IN SAGU · linked both
ways«) — før den gør det.

**Rækkefølgen var valgt — og blev vendt i v45.** Oprindeligt kom noten først:
fejlede Sagu, var der ikke oprettet noget, og den modsatte vej ville efterlade
en opgave, der lover et link, den ikke har.

Men opgavens id findes ikke på det tidspunkt. Linket tilbage kunne derfor kun
pege på doda **som sådan** (`location.origin`), så noten sagde »From doda:
[titel](https://doda.dk)« og førte til forsiden. **Halvdelen af »linked both
ways« var aldrig rigtig der** — og det opdagede ingen, fordi et link, der
virker, ser rigtigt ud, indtil man klikker.

Nu: opgaven først, så noten med `?item=<id>` (§v23), så linket den anden vej.

Fejler Sagu, står der en opgave uden link tilbage, **og den beholdes med
vilje.** Siden v44 er `*` den eneste vej til en note, så »intet oprettet«
ville betyde, at teksten var tabt. En opgave uden link lover ingenting; den er
bare en opgave. **Hvilken vej man vil fejle, afhænger af, hvad alternativet
er — og det ændrede sig, da doda-noten forsvandt fra paletten.**

**Paletten kan ikke spørge om noget** — ét tastetryk har ikke plads til et
spørgsmål. Derfor er der et valg i Settings for, hvilken notesbog hurtige noter
lander i; dialogen spørger stadig hver gang. Uden det landede de uden for
enhver bog, og planens accept siger *i den rigtige notesbog*.

### Payloaden — doda tog samme udvej som Sagu

Med broen nåede install-scriptet **122.701 / 126.000 tegn (97 %)**, og tre
flader var ikke bygget endnu. doda henter derfor nu app-koden fra GitHub i
stedet for at bære den: **1.753 tegn**, konstant. YAML'en gik fra 266.890 til
5.932 b.

Repoet var **privat**, og det kostede to ting mere end i Sagu: et
`GITHUB_TOKEN` i en `secret: true`-variabel, og at GitHubs 404 dækkede over
*to* ting — »findes ikke« og »dit token har ikke dette repo«. Fejlbeskeden
måtte nævne begge, ellers fejlsøgte man et token, der var helt i orden.

**Begge dele bortfaldt 2026-08-21**, da Andreas gjorde repoet offentligt.
Install-scriptet gik fra 1.753 til **1.586 tegn**, og token-feltet er fjernet
fra runen — ikke bare fordi det er overflødigt, men fordi **en indstilling,
der ikke længere gør noget, ligner en spærring uden at være en.** Den, der en
dag ikke kan installere runen, ville lede efter fejlen i et tomt token-felt i
stedet for i det, der faktisk er galt. En 404 betyder nu ét: taggen er ikke
pushet.

Prisen for at gå offentligt, sagt højt: **historikken kom med.** De 55
commits, der lå der i forvejen, indeholder Andreas' rigtige adresse og
værtsnavn — det var hans beslutning, truffet med tallene på bordet. De
*nuværende* filer blev renset først (`navn@eksempel.dk`, `doda.eksempel.dk`),
og fra nu af auditeres hver ændring, før den pushes.

**Konsekvens, der ikke må glemmes:** en udgivelse er nu tre trin — commit →
`git tag v<N>` → `git push --tags`. Runens version N henter `refs/tags/vN`.
Og de genererede filer (`app/public/app.js`, ikonerne) **skal** være committet:
det, GitHub har, er det, der installeres. `tjek_git()` i build'et fælder ellers.

### Målt

| | |
|---|---|
| Tests | **193 grønne** (+15 i `tests/sagu.test.mjs`) |
| Hver vagt set fejle | tilbagerulning · `wrong_scope` · linket på sin egen linje · stemplet på titel-opslaget |
| Mod en RIGTIG Sagu | note oprettet i den rigtige notesbog med link tilbage · fundet igen ved søgning · `link`-nøglen får 403 på en sletning |
| Install-script | 122.701 → **1.753 tegn** |
