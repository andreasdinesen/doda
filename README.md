# doda

Personlig opgave- og noteapp efter GTD-metoden, bygget som **rune til
[Yggdrasil Panel](https://yggdrasilpanel.com)**. Én YAML-fil installerer hele appen:
Node-server, webapp og SQLite-database i samme container.

UI'et følger [tingdo.app](https://tingdo.app) — ét søgefelt der både finder og opretter,
og som åbner, så snart du begynder at skrive. Gentagende opgaver bruger Todoist-syntaks.

**Ingen npm-pakker. Ingen CDN. Ingen eksterne tjenester.**

> **Sprog:** appens interface er **engelsk**, fordi æ, ø og å er besværlige at taste i
> et fangstfelt. Datotolkningen forstår begge sprog — `!tomorrow` og `!i morgen` gør
> det samme.

---

## Sådan bruges den

**Begynd bare at skrive.** Uanset hvilken skærm du er på, åbner kommandobaren, så
snart du trykker en tast. Tryk `/` for at åbne den tom. Enter opretter; oprettelse
står altid øverst, så søgning aldrig kommer i vejen for en fangst.

Mens du skriver, viser små chips under feltet, hvordan teksten er blevet forstået.

| Skriv | Betydning |
|---|---|
| `ring til lægen` | opgave i Inbox |
| `svar fra banken >waiting` | opgave direkte i Waiting For |
| `* kontonummer 1234` | note |
| `#telefon` | kontekst (nye skal bekræftes med et ekstra Enter) |
| `@Sundhed` · `/Sundhed` · `/"Sommerhus i Rørvig"` | projekt — begge tegn virker, som legenden lover |
| `!tomorrow` `!friday` `!3/9` `!in 2 weeks` `!sep 3 at 9` | deadline — og opgaven går **direkte i Next Actions**, skjult indtil dagen |
| `~in 2 months` | skjul indtil den dato (slår automatikken ovenfor) |
| `>waiting` · `>next` · `>someday` · `>inbox` | start i det stadie. `>w`, `>n`, `>s`, `>i` er det samme |
| `: Privat` | område — mellemrum på begge sider |
| `køb dæk // se https://dæk.dk og husk rabatkoden` | alt efter ` // ` bliver beskrivelsen |

Links i både titel og beskrivelse bliver klikbare — også `[tekst](url)`.

### Gentagende opgaver

Syntaksen er Todoists. Et `!` lige efter `every` er hele forskellen:

| Skriv | Betyder |
|---|---|
| `!every monday` | **Fast plan** — forfalder hver mandag, uanset om du lavede den forrige |
| `!every! monday` | **Fra fuldførelse** — næste opstår først, når du har markeret denne udført |

Flere former: `!every 3 days` · `!every! 2 weeks` · `!every mon, thu` ·
`!every weekday at 16` · `!every month on the 3rd` · `!last workday of the month` ·
`!every year on 24/12`. Danske ord virker også: `!hver mandag`, `!hver! 3. dag`.

Chippen under fangstfeltet skriver altid tilstanden ud (»every 3 days · from
completion«), så valget aldrig er skjult i et udråbstegn.

**Tre regler, appen aldrig bryder:**

1. Der ligger **aldrig mere end én åben forekomst**. Der kommer ikke tolv kopier
   af den samme opgave.
2. En forekomst er **usynlig, indtil den er aktuel**. »Støvsug hver søndag« står
   ikke i din liste mandag til lørdag.
3. En »fra fuldførelse«-opgave **kan ikke hobe sig op**. Den venter på dig, og
   springer aldrig frem af sig selv.

Bliver en fast plan overskredet, rulles den frem — og hvert oversprunget gang
**tælles**. Ikke som en fejl, men som information: skærmen *Recurring* viser
næste forfald ved siden af antal spring, og det er dér, du opdager, at en vane
ikke virker.

Gentagelser kan sættes på **pause** (reglen bevares) og **springes over** enkeltvis.
Ændrer du titel eller projekt på en forekomst, spørger appen, om det gælder kun
denne gang eller alle fremtidige.

### Login med passkey

**Settings → Passkeys**. Så kan du logge ind med Touch ID, Face ID eller en
sikkerhedsnøgle — uden brugernavn, for nøglen ved selv, hvem den hører til.

> **Dit kodeord holder altid op med at virke.** Panelet tilgås over almindelig
> http på `IP:port`, hvor passkeys slet ikke findes. Kunne en passkey erstatte
> kodeordet, ville du kunne låse dig selv ude af din egen server. Derfor lader
> doda det aldrig ske, og knappen vises kun, hvor den faktisk kan bruges.

Fjerner du en nøgle, holder den op med at virke med det samme.

### Ugentlig gennemgang

**Review** fører dig gennem seks trin: tøm inbox, gennemgå aktive projekter,
Venter på, Engang måske, gentagelser der springes over, og ugens logbog.

Du kan stoppe midtvejs — trinnet ligger på serveren, så du kan fortsætte fra
samme sted senere, også fra en anden enhed.

Vælger du en ugedag, viser doda et **roligt bånd** øverst den dag: »It is
Sunday — the day you set aside for your weekly review«, med *Start* og *Not
now*. Det er med vilje kun et bånd i appen og ikke en push-besked. De rigtige
deadlines har allerede en vej ud — **kalenderfeedet**, hvor telefonens egen
kalender giver besked. At bygge en push-kanal til én ugentlig påmindelse ville
være at tilføje en hel infrastruktur for at råbe.

**Logbook** viser hvad du har lavet, dag for dag, med filter på projekt. Ingen
tal, ingen grafer, ingen produktivitetsscore — formålet er tilfredsstillelse og
overblik, ikke måling.

### Fokus

Åbn en opgave og tryk **Focus**. Alt andet træder i baggrunden, og en timer
begynder at tælle. Den kører videre, mens du skifter skærm — og overlever, at
du lukker og genåbner appen, fordi det er starttidspunktet der huskes.

Ingen tidsregistrering, ingen rapport. Timeren er der kun, hvis du vil se den.

### Billeder og filer

Åbn en opgave eller note og træk filer ind — eller tryk **Add images or files**.
På telefonen kan du vælge kamera eller fotobibliotek.

Store fotos **skaleres ned i browseren**, før de sendes, så de ikke fylder
unødigt. PNG bevares som PNG, så gennemsigtighed ikke bliver til sort.
Grænsen er 25 MB pr. fil.

Billeder vises som miniature og åbner i fuld størrelse ved klik. Alt andet
vises som en fil, du kan hente. Filerne ligger i serverens datamappe og er
derfor med i panelets backup.

> **Sikkerhed:** kun almindelige billedformater vises inline i browseren. Alt
> andet — også SVG, som kan indeholde kode — leveres som en ren download.
> Filnavne saniteres, og på disken hedder filerne kun deres id, så et filnavn
> aldrig kan pege et forkert sted hen.

### På telefonen og uden net

Åbn doda i Safari på din iPhone og vælg **Del → Føj til hjemmeskærm**. Så kører
den i fuld skærm med sit eget ikon, uden browserens adresselinje.

**Uden forbindelse** kan du stadig læse dine lister — de vises, som de så ud
sidst, og et diskret mærke fortæller det. Og du kan stadig **fange**: teksten
lægges i en kø og sendes automatisk, så snart der er net igen, i den rækkefølge
du skrev den. Køen overlever, at du lukker appen.

> Kræver https. Over almindelig http (fx panelets `IP:port`) virker appen
> uændret, men uden offline-læsning og hjemmeskærm — det er en browserregel,
> ikke et valg.

### Projekter, områder og noter

Et **projekt** er alt, der kræver mere end ét skridt. Skriv `@Navn` når du fanger,
så oprettes det. Projekter kan have underprojekter og hører til et **område** —
en løbende ansvarlighed uden slutpunkt: Arbejde, Hjem, Økonomi.

Projektvisningen har et felt til **»hvad ser færdigt ud«** i markdown, og viser
opgaver og noter sammen, men visuelt adskilt. Har et projekt åbent arbejde uden
en næste handling, står det diskret — det er den klassiske GTD-fejl, og den skal
kunne ses uden at skælde ud. Rækkefølgen af opgaver kan ændres med ↑↓, som også
virker på telefon.

**Noter** er ren reference og dukker aldrig op i handlingslister. De skrives i
markdown (overskrifter, lister, **fed**, `kode`, citater, links) og kan
konverteres til en opgave og tilbage igen uden at miste noget.

Droppes et projekt, droppes dets **åbne** opgaver med — men allerede udførte
opgaver røres ikke, så logbogen bliver ved med at være sand. Genåbner du
projektet, vækkes præcis de opgaver, der fulgte med.

### Tastatur

I Inbox og Næste handlinger kan alt klares uden mus:

| Tast | Handling |
|---|---|
| `↑` `↓` | **gå ind i listen** — uden at åbne noget |
| `↑` `↓` (eller `k` `j`) | flyt mellem elementer |
| `Esc` | forlad listen igen, så bogstaverne fanger som normalt |
| `Enter` | åbn elementet |
| `mellemrum` | markér udført |
| `n` `w` `s` `q` | Next · Waiting for · Someday · Queued |
| `x` | slet |
| `c` `p` | sæt kontekst · sæt projekt |
| `?` | vis hele oversigten over genveje |

På mobil ligger de fem vigtigste skærme i et bånd i bunden — Next, Inbox,
Projects, Recurring og Review — plus en Capture-knap, så fangst kan nås fra
alle skærme med ét tryk.

---

## API, iPhone og Siri

doda har et API under `/api/v1/`, så du kan fange fra iOS Shortcuts og Siri, og
spørge »hvad kan jeg lave nu« uden at åbne appen.

**Webgrænsefladen bruger nøjagtig samme API** — der er ingen intern bagvej. Alt
hvad appen kan, kan du også udefra.

Adgangsnøgler laves under **Settings → Access keys**. Vælg det snævreste scope,
der løser opgaven: en `capture`-nøgle kan tilføje, men kan ikke læse en eneste
opgave, så en mistet telefon ikke åbner hele systemet.

Fangst-genvejen kræver kun ét felt — API'et tager imod en ren tekststreng:

```bash
curl -X POST https://DIN-ADRESSE/api/v1/capture -H "Authorization: Bearer doda_DIN-NØGLE" -d "ring til tandlægen #telefon !tomorrow"
```

Trin-for-trin-opsætning af begge genveje, den fulde endepunktsliste og
fejlkoderne står i **[docs/SHORTCUTS.md](docs/SHORTCUTS.md)**.

### Claude kan forbinde til den

doda er også en **MCP-server** på `/mcp`, så Claude kan fange, læse næste
handlinger, markere udført, søge og kigge på projekter og gentagelser:

```bash
claude mcp add --transport http doda https://DIN-ADRESSE/mcp --header "Authorization: Bearer doda_DIN-NØGLE"
```

Den bruger de samme adgangsnøgler og de samme scopes — en `read`-nøgle giver
Claude læseadgang og intet andet, og `tools/list` viser kun det, nøglen faktisk
må. Se **[docs/MCP.md](docs/MCP.md)**.

### Raycast

**Med Raycast Pro** taler doda MCP direkte: tilføj `https://DIN-ADRESSE/mcp` som
HTTP-server, enten med en nøgle i en header eller med OAuth. Se
[docs/MCP.md §4b](docs/MCP.md).

**Uden Pro** ligger der fire script-kommandoer i
**[extras/raycast/](extras/raycast/)** — fang, Next Actions, Inbox og søgning.
Bash og `curl`, intet npm. Opsætning og de præcise trin i Raycast står i
[extras/raycast/README.md](extras/raycast/README.md).

**claude.ai i browseren** kan ikke sende en nøgle i en header, så den kobler sig
på med **OAuth 2.1**: tilføj `https://DIN-ADRESSE/mcp` som custom connector, og
Claude finder selv resten og sender dig til doda for at trykke *Allow*.
Forbindelsen står bagefter under **Settings → Connected apps** og kan
tilbagekaldes derfra. Hele flowet og hvad der gør det sikkert:
**[docs/OAUTH.md](docs/OAUTH.md)**.

---

## Installation

1. **Runes → Browse GitHub** → pegn på `andreasdinesen/doda` → *Reload*.
2. Opret en server af runen. Vælg eventuelt et andet appnavn.
3. Start serveren, åbn adressen, og opret din konto.

Den **første** konto er den eneste: så snart den findes, lukkes oprettelse permanent.
doda er en app til én bruger.

### Variabler

| Variabel | Standard | Hvad den gør |
|---|---|---|
| `APP_NAME` | `doda` | Navnet i browserfanen |
| `NODE_IMAGE` | `node:24-alpine` | Hvilket Node-image appen kører på — se nedenfor |

---

## Sådan holder du den opdateret

Panelets opdatering er **todelt**, og det forvirrer hver gang:

1. **Runes → Browse GitHub → Reload** henter kun rune-*definitionen*. Listen viser
   nu det nye versionsnummer — men appen kører stadig den gamle kode.
2. **Serveren → Settings → Opdater doda** skriver app-filerne igen.
   Databasen i `/data` er urørt, og skemaet migreres automatisk ved næste start.

Uden trin 2 sker der ingenting. Det er ikke en fejl.

### Hvis der findes en sårbarhed i Node

doda har **nul afhængigheder** — der er ingen npm-pakker at patche. Det eneste
underliggende program er Node selv, og det er derfor et **felt i panelet**:

- Åbn serverens indstillinger og ret `NODE_IMAGE`.
- `node:24-alpine` (standard) følger seneste patch af Node 24 — en geninstallation
  eller »Opdater doda« henter automatisk den nyeste.
- Skal du pinne til en bestemt rettelse: `node:24.9.1-alpine`.
- Skal du på en ny hovedversion: `node:26-alpine`.
- Kør derefter **Opdater doda**. Ingen kodeændring, ingen ny udgivelse.

Feltet er valideret til `node:`-images, så en tastefejl ikke kan pege appen på
et vilkårligt billede.

---

## Kalender, eksport og import

### Kalenderabonnement

**Settings → Calendar subscription** giver dig en hemmelig adresse, Apple Kalender
kan følge (File → New Calendar Subscription).

Feedet indeholder **kun ting med en reel deadline** — aldrig hele din opgaveliste,
og aldrig dine noter. Adressen er hemmeligheden: *Replace* laver en ny og gør den
gamle værdiløs med det samme, *Turn off* slukker feedet helt.

### Dine data

**Settings → Your data**. Alt ligger i én åben JSON-fil.

| Knap | Hvad |
|---|---|
| **Export data** | Alt undtagen filindhold. Lille og læsbar |
| **Export with files** | Selvstændig kopi med vedhæftningerne indlejret |
| **Import…** | Læser en eksportfil tilbage |

Importen matcher på id, så den samme fil kan køres to gange uden at lave dubletter,
og den sendes i portioner — intet bliver afvist for at være for stort.

Begge dele virker **også via API'et**, så et script eller en genvej kan tage en kopi
uden at åbne browseren:

```bash
curl -s https://DIN-ADRESSE/api/v1/export -H "Authorization: Bearer doda_DIN-NØGLE" -o doda-backup.json
```

> Har du mange vedhæftninger, afviser `Export with files` sig selv over 150 MB og
> henviser til panelets backup. Én kæmpe JSON-fil er en dårlig sikkerhedskopi.

---

## Backup og gendannelse

`backup.include: []` betyder **hele datamappen**, altså også `doda.db`.

**Tag backup:** Serveren → Backups → *Create backup*. Læg en tidsplan på under
panelets Schedules, hvis den skal køre automatisk.

**Gendan:**

1. Stop serveren.
2. Serveren → Backups → vælg arkivet → *Restore*.
3. Start serveren igen. Skemaversionen tjekkes ved opstart, så en ældre database
   migreres frem automatisk.

**Nulstil helt:** Serveren → *Wipe*. Sletter `doda.db` (+ WAL-filerne) og tager
automatisk en backup først.

**Prøvet af, ikke bare påstået:** der findes en test, der fylder en server med data,
eksporterer alt, **sletter databasen og filmappen**, starter forfra, importerer igen
og sammenligner hele systemet felt for felt — inklusive at hente en vedhæftet fil og
sammenligne dens indhold byte for byte. Den kører med `node --test tests/`.

---

## Sikkerhed

- **Nul tredjeparts-afhængigheder.** Ingen forsyningskæde at holde patchet.
- Kodeord hashes med scrypt; sessioner er 32 tilfældige bytes i en `HttpOnly`,
  `SameSite=Lax`-cookie (`Secure` når forbindelsen er https).
- Login er rate-limitet og **tælles i databasen**, så en genstart af panelet ikke
  nulstiller en igangværende angrebstælling.
- Streng `Content-Security-Policy` uden `unsafe-inline` på scripts — hashen af det
  eneste inline-script beregnes ved opstart, så den aldrig kan komme ud af trit.
  Dertil `nosniff`, `no-referrer`, `frame-ancestors 'none'` og en restriktiv
  `Permissions-Policy`.
- POST og DELETE kræver `Content-Type: application/json` — en CSRF-barriere oven
  på `SameSite`.
- Mislykkede login og rate-limit-spærringer rapporteres til panelets
  **sikkerhedshistorik** pr. IP via runens `events:`-blok, og serverfejl udløser en
  watcher-notifikation.
- **Adgangsnøgler** gemmes kun som `sha256` og vises én eneste gang. De har
  scopes (`capture` / `read` / `full`), et `sidst brugt`-stempel og kan
  tilbagekaldes øjeblikkeligt — der er ingen cache, så næste kald slår op i
  databasen og finder ingenting. Hver nøgle har sin egen timegrænse på antal kald.
- **En adgangsnøgle kan aldrig lave nye nøgler eller skifte kodeordet**, uanset
  scope. Det kræver en rigtig browser-session. Ellers ville én lækket nøgle være
  nok til at give sig selv varig adgang — eller til at låse dig ude.

---

## Udvikling

```bash
DODA_DEV=1 BIND_PORT=8910 DATA_DIR=/tmp/dodadata node app/server.js
```

```bash
python3 build_rune.py && node --test tests/parse.test.mjs
```

`DODA_DEV=1` slår asset-cachen fra og stempler `?v=` med filernes mtime. Uden den
serveres `app.js` som `immutable`, og browseren kører glad den gamle kode videre,
fordi `APP_VERSION` med vilje står stille mellem udgivelser.

`app/shared/parse.js` køres **både** af serveren og af browseren — det er samme
parser, der tolker webfangst, iOS-genveje og senere MCP. Rettes den, gælder det
alle veje ind i appen.

`runes/doda.yaml` og `app/public/app.js` er **genererede artefakter** — redigér dem
aldrig i hånden. Ret kilderne i `app/` og kør build-scriptet.

Se `PLAN.md` for faseoversigt og status, `DESIGN.md` for de trufne beslutninger og
`CLAUDE.md` for kontekst til videre udvikling.

---

## Versionshistorik

| Version | Ændringer |
|---|---|
| 77 | **»Vis en her« — en prøve uden om push-tjenesten.** »Send a test« sagde *kom igennem* fire gange, og der kom stadig intet frem på telefonen, mens den samme server nåede Mac'en. Så er spørgsmålet ikke, om doda **sender**, men om iOS **viser**. Den nye knap viser en notifikation direkte fra enheden: kommer den frem, men pushen ikke, er det leveringen — kommer den heller ikke, holder telefonen den tilbage, og der er intet i doda at rette. Den siger også rent ud, hvis iOS aldrig har givet lov; det er en tilstand, man ellers ikke kan se. |
| 76 | **To prøveknapper til notifikationer — og datochippen viser nu klokkeslættet.** »Der kom ingen notifikation« kunne være fem ting, og der var intet at se på: fejler en push, sker der bare ingenting. **Send a test** under Notifications sender én med det samme og svarer **pr. enhed** med push-tjenestens egen fejlkode — *kom igennem*, *afvist (403): VapidPkHashMismatch*, eller *abonnementet er væk og er ryddet*. **Og en visningsfejl:** chippen i redigeringsruden viste kun dagen, mens listen viste »today 20:20« — de to skærme sagde altså noget forskelligt om samme opgave, og man kunne med rimelighed tro, at tidspunktet var gået tabt. |
| 75 | **Indstillingerne er delt i faner — og en gentagelse kan slettes helt.** Siden var vokset til **seksten afsnit** i én stribe, så man rullede forbi ti ting for at nå den ellevte. Nu: **General · Account · Connections · Keys · Data**. Alt tegnes, ét vises — de tredive bindinger er urørte. **Og gentagelser:** »Stop recurring« lader som før den åbne opgave blive som en almindelig, mens den nye **Delete** tager begge dele. To knapper, fordi de gør forskellige ting — man stopper en vane, man sletter ikke det, man allerede har taget på sig. |
| 74 | **Next Actions sorterer efter, hvad klokken løber fra.** Stjernemarkerede øverst — også uden frist, for stjernen er dit eget råb om, at den skal først. Derefter det, der falder først på dagen, kronologisk. Til sidst resten, i den rækkefølge du selv har trukket dem på plads. **Der skulle ingen »nærmer sig«-grænse til:** siden v71 skjuler en dateret opgave sig til sin egen dag, så alt med en dato i denne liste er forfaldent i dag eller tidligere — kronologisk rækkefølge *er* derfor »det mest presserende først«, og listen skifter af sig selv, mens dagen går. |
| 73 | **Siden flimrede, når man scrollede — rettet.** Den klistrende bjælke fra v57 vinder plads, når den folder sig sammen, så **dokumentet bliver kortere**. På en kort side var der 0 px tilbage at scrolle i, mens bjælken gav 60 px slip: browseren tvang scroll-positionen tilbage, klassen røg af, bjælken voksede — og forfra. Nu er der et **dødt bånd** (folder ved 120 px, folder først ud igen ved 8), og bjælken folder sig **kun, når der er plads at vinde** (mindst 200 px at scrolle i). Er der mindre, er der heller ingen plads at hente, og så bliver bjælken stående. |
| 72 | **Tal kun dér, hvor de betyder noget.** **All Tasks** er flyttet ned under Review — den bruges ikke i dagligdagen, og øverst i menuen trak den blikket fra de lister, man faktisk arbejder i. Og menuen har nu **kun tal ved Next Actions, Inbox, Waiting For og Someday**: dér betyder et tal »her er noget at tage stilling til«. Projekter, kontekster, noter, gentagelser og All Tasks er strukturer — deres tal ændrer sig sjældent og kræver ingenting, og i en menu, hvor alt har et tal, holder man op med at se dem, der betyder noget. **Antallet står i stedet på siden**, og siger dér mere end badget gjorde: `3 active · 1 someday · 2 finished` på Projects, `4 active · 1 paused` på Recurring. |
| 71 | **En dato er en beslutning — og `>stadie` ved fangst.** Skriver du `!fredag`, går opgaven nu **direkte i Next Actions** og skjuler sig til dagen; har du sat en dato, har du allerede besluttet at gøre den, og så skal den ikke afklares i Inbox én gang til. Dit eget valg vinder: `>waiting !fredag` bliver i Waiting For, og et `~udskyd` står ved magt. **`>waiting`, `>next`, `>someday`, `>inbox`** (eller `>w`, `>n`, `>s`, `>i`) lægger opgaven direkte i det stadie — før kunne kun *skærmen* bestemme det. Skriver du `>`, viser paletten de fire med hvert sit ikon. **Nyt punkt: All Tasks** — alt åbent i ét billede, med frister i kalenderorden og resten nyest øverst; **intet er filtreret fra**, heller ikke det udskudte. Og på mobil har kun **Next** og **Inbox** tal i bundlinjen; sidebaren viser dem alle. |
| 70 | **doda i Raycast — med eller uden Pro.** Har du **Raycast Pro**, virker doda som MCP-server uden at der skal bygges noget: tilføj `https://DIN-ADRESSE/mcp` med en nøgle i en header eller med OAuth, og du har alle elleve værktøjer. **Uden Pro** ligger der nu fire script-kommandoer i [extras/raycast](extras/raycast) — fang, Next Actions, Inbox og søgning. Bash og `curl`, intet npm, og nøglen gemmes i macOS' **nøglering**, ikke i en fil. Serveren fik til gengæld en **tekst-vej**: `?format=text` på `/search`, `/items` og `/capture` (den fandtes i forvejen på `/next`), så en klient uden JSON-parser kan vise svaret direkte. |
| 69 | **Tal ved hvert punkt — og en vej til at starte Logbook forfra.** Next Actions, Waiting For, Someday, Recurring, Projects, Contexts og Notes har nu tal som Inbox. *Logbook og Review får bevidst ingen: det ene vokser for evigt, det andet er ikke en liste.* **Undervejs fundet:** optællingen var **næsten** rigtig og derfor svær at se — Inbox viser også `queued`, men tælleren talte kun `inbox`, og Waiting/Someday viser udskudte, som tælleren skjulte. Hvert tal spejler nu præcis det kald, listen selv laver. **Og Settings → Logbook:** »Start Logbook over« skjuler det hidtidige fra listen og tælleren uden at slette noget (kan fortrydes), »Delete finished tasks« sletter for altid, og »done«-tallet i toplinjen kan slås fra. |
| 68 | **En Sagu-note kan foldes sammen.** En note kan være lang — en liste af nøgler, et mødereferat — og så skubber den projektets opgaver ned under skærmkanten. Overskriften **In Sagu** er nu en foldeknap; **udfoldet som standard**, for noten er dét, man kom for. Foldet står overskriften tilbage med sin kommentartæller, så man kan se, at der *er* en note, uden at læse den. Kommentarerne og skrivefeltet følger med ind — de hører til noten. Valget huskes, og folden henter ikke noten fra Sagu igen. |
| 67 | **Gentagelser kan nu få en beskrivelse — og afkrydsningsfelterne følger dodas tema.** Skabelonen bag en gentagelse har altid haft en beskrivelse, og hver ny forekomst har altid fået den med; den blev bare aldrig sendt **ud** igen, så ruden kunne hverken vise eller rette den. Nu er der et **Details**-felt, og det, du skriver, følger med til hver kommende opgave. **Og temaet:** browserens egne dele — afkrydsningsfelter, rullebjælker, `select` — tegnes efter `color-scheme` og fulgte **systemets** valg. Stod Mac'en i mørkt og doda i lyst, blev afkrydsningerne i en Sagu-note kulsorte på en lys side. De følger nu dodas eget tema. |
| 66 | **Sagu-noter vises nu renderet — med afkrydsninger og billeder.** En note skrevet i en note-app bruger afkrydsningslister, overskrifter midt i teksten og billeder, og alt det stod som **rå markdown-kode**. Nu er felterne rigtige felter (deaktiverede — noten hører til i Sagu, og et felt, der ikke gemmer noget, er værre end et, man ikke kan trykke på), og **billederne hentes gennem dodas egen server**, som har nøglen. En overskrift virker nu også, når teksten står lige under; før skulle den stå alene, og en liste kunne slet ikke rendere, hvis der var et billede midt i den. Rendereren er flyttet til `app/shared/`, hvor den kan testes — den tegner **fremmed** tekst, så escapen er ikke en detalje. |
| 65 | **Afsluttede opgaver har fået deres eget afsnit i et projekt — og kan foldes sammen.** Rækkefølgen i et projekt er den, du selv har trukket på plads, ikke status: en opgave lavet først og fuldført i sidste uge lå derfor **øverst** i listen over det, der stadig skal gøres. Nu står de under **Done**, og Tasks-tælleren viser kun det åbne arbejde. Afsnittet er **udfoldet som standard** — det, der er lavet, er projektets historie, og den skal kunne ses uden at lede i Logbook. Folder du det sammen, huskes valget for alle projekter; det er en vane, ikke en egenskab ved det enkelte projekt. |
| 64 | **Teksten kunne ikke læses i venstre side på iPhone — og note-kortet fører nu begge veje.** Felterne (kommentar, titel, beskrivelse, Settings) arvede 15 px skrift, og **under 16 px zoomer iOS ind**, så snart et felt får fokus: siden stod forskudt med venstre kant uden for skærmen. Det lignede et layoutbrud og var det ikke — teksten var der, den lå bare uden for det, telefonen havde zoomet ind på. Søgefeltet fik sine 16 px af netop den grund; de andre var glemt. **Og:** et Sagu-kort har nu **to udgange** — titlen fører til noten i Sagu, linjen under til den opgave eller det projekt, noten hører til. Før var hele kortet ét link til Sagu, så der var ingen vej tilbage til det, noten handler om. |
| 63 | **Spalten har nu én bredde — kanterne flugter.** `#pageHost` havde slet ingen bredde, og fordi skallen centrerer sine børn blev den shrink-to-fit: en side med kort indhold blev smal, en med lange titler bred, så spalten **skiftede bredde ved hvert menupunkt**. Oveni var der tre tal i spil, som ingen holdt i trit — status-linjen 940, feltet 820, siden 760 — så hverken venstre eller højre kant fløj. Nu er der **ét tal** (`--spalte`), og bjælken, feltet, siden og gennemgangs-notitsen peger alle på det. Målt: bredden rører sig ikke, når kort indhold byttes ud med tyve lange titler. Indholdet er 60 px bredere end før, så linjerne bliver en anelse længere. |
| 62 | **Note-oversigten viser kun det levende.** En afsluttet opgaves note er en kendsgerning om noget overstået, og med 21 fuldførte opgaver druknede de få, der stadig er i gang. Nu vises kun noter på opgaver og projekter, der ikke er **done** eller **dropped** — `someday` bliver stående, for parkeret er ikke det samme som afsluttet. Noterne bliver liggende i Sagu, og en afsluttet opgave kan stadig åbnes fra Logbook med sit link; det er kun oversigten, der holdes ren. Den tomme tekst sagde »no notes yet« — det ville være løgn for den, der lige har afsluttet det hele, så den siger nu, at listen viser det, der stadig er åbent. |
| 61 | **Notes-skærmen virkede ikke i v60 — rettet.** Ændringen i v60 slugte en linje, som tre andre linjer stadig brugte, så skærmen kastede en fejl og blev **aldrig tegnet**: man trykkede på Notes, og der skete ingenting. Byggeriet var grønt, testene var grønne, og fejlen nåede telefonen — så der er nu en **vagt**, der fanger navne, der bruges i en skabelon uden at findes nogen steder. **To fejl fundet undervejs, med samme rod:** på en telefon er det `body`, der scroller, ikke vinduet — derfor troede **træk-for-at-genindlæse**, at ethvert træk kom fra toppen (et træk midt i en lang liste genindlæste appen), og **»op til toppen« ved sideskift** gjorde slet ingenting, så du landede midt i den nye side. Begge spørger nu efter den rigtige scroll-container. **Og:** eksterne links åbnes nu, når doda kører som app fra hjemmeskærmen — iOS gør ingenting ved `target="_blank"` der. |
| 60 | **Notes-skærmen viser de noter, der ligger i Sagu.** Er Sagu koblet på, laves nye noter dér — så stod skærmen og sagde »No notes yet«, mens noterne fandtes, bare et andet sted. Nu står de under **In Sagu** med et link til din Sagu-server, og de gamle doda-noter under **In doda**. Hvert kort viser **notens eget navn** — tit et andet end opgavens — og hvad den hænger på. Det er dem, der er **linket fra doda**, ikke alt i Sagu; ellers var skærmen en dårligere kopi af Sagus egen forside, som er ét klik væk. Titlerne kommer fra dodas egen database, så listen tegnes **uden at spørge Sagu** — den virker offline og når Sagu er nede, og fejler kaldet, står siden som før. |
| 59 | **`!om 3 timer` og `!in 3 hours`.** Formen fandtes for dage, uger, måneder og år — men ikke for timer og minutter, så `!om 3 timer` blev tavst til ingenting. Den er den eneste, der også sætter et **klokkeslæt**: en opgave om tre timer uden tidspunkt er ingenting. Og den eneste, der regnes i **absolut** tid — alle andre former regner på kalenderdage, netop så `!om 3 dage` er tre døgn hen over et sommertidsskifte, mens `!om 2 timer` er to *faktiske* timer. Datoen ruller med over midnat, månedsskifte og årsskifte; ellers ville `!om 3 timer` kl. 23 forfalde kl. 02 — fjorten timer før du skrev det. Skriver du selv et klokkeslæt (`!om 2 timer kl 15`), vinder dit. |
| 58 | **»Make it a note« lægger noten i Sagu — og topmenuen folder sig sammen.** Er Sagu koblet på, hører noterne dertil; den regel gjaldt hidtil kun `*` i fangstfeltet, så knappen lavede stille en **lokal** doda-note ved siden af Sagu — netop den opsplitning, reglen skulle undgå. Nu hedder den *Make it a note in Sagu*, noten oprettes dér med **hele beskrivelsen**, og opgaven forsvinder herfra: den er ikke længere en opgave. Noten oprettes **først**, og opgaven slettes kun, hvis det lykkedes — omvendt ville en Sagu, der er nede, koste både opgaven og teksten. Har opgaven vedhæftninger, står der hvor mange der ryger med, før du siger ja; en note er tekst. **Undervejs fundet:** brødteksten kunne slet ikke sendes med — noten ville være tom, netop som opgaven blev slettet. **Og topmenuen:** når du scroller, folder tælleren og tastaturlegenden sig væk, så kun feltet bliver stående — fra 21 % til 9 % af en telefonskærm. På mobil rykker feltet til side, så hamburgeren får sin egen plads i stedet for at lande oven på søgeikonet. Sideoversigtens ankre er hævet fra 24 til 96 px; ellers landede den overskrift, du klikkede på, bag feltet. |
| 57 | **Kommandobaren bliver stående, når du scroller.** Feltet er husets eneste vej til at fange, finde og navigere, og det skulle ikke skulle scrolles frem igen. Hele baren klistrer i toppen — havde kun feltet gjort det, ville det alligevel forsvinde, så snart baren selv scrollede ud af syne. Indholdet **toner ud** under den i stedet for at blive klippet brat over. **Undervejs fundet:** under 900 px er det `body`, der scroller, ikke vinduet — `height: 100%` og `overflow-x: hidden` gør tilsammen body til en scroll-boks, så `window.scrollTo()` intet gør dér. Det står nu i koden, så den næste rettelse ikke render på det samme. |
| 56 | **Totrinsbekræftelse (2FA) — med QR-kode.** En sekscifret kode fra din authenticator oven på kodeordet. Passkeys er stærkere, hvor de virker, men de kræver https, og panelet nås over almindelig http; **det hul lukker det her.** Scan QR-koden ved opsætningen — eller fold »Can't scan?« ud og tast nøglen. Det slås først til, når du har tastet en kode, der passer, så du ikke kan låse dig ude ved at lukke fanen. Du får **ti nødudgangskoder**, vist én gang. Den samme kode kan ikke bruges to gange, og den kan kun slås fra mod dit kodeord. Både TOTP og QR-koden er skrevet uden pakker: TOTP er prøvet mod RFC 6238's testvektorer, QR-koden mod **macOS' egen afkoder** i ti størrelser. |
| 55 | **Skriv `: Område` direkte i fangstfeltet.** `køb ind : Privat #butik @Huset` sætter det hele på én gang, og paletten foreslår dine områder undervejs. Kolon kræver **mellemrum på begge sider** — strammere end `#` og `@`, der klæber til deres værdi, netop fordi kolon er et almindeligt tegn: `Møde: husk kaffe`, `forhold 3:1` og `!i dag 12:30` er urørte. Er området nyt, bliver du spurgt først, ligesom med et nyt projekt. **Undervejs fundet:** fangsten gemte hverken område eller stjerne, fordi INSERT-sætningen ikke nævnte kolonnerne — stjernen fra v54 kunne altså kun sættes bagefter, ikke fra kommandobaren. |
| 54 | **En stjerne løfter opgaven — og en opgave kan få sit eget område.** Stjernen er ét flag, ikke niveauer: en stjernet opgave ligger **øverst** i Next Actions og i projektet, med et diskret mærke i listen. Inden for hver gruppe er rækkefølgen uændret, så det, du selv har trukket på plads, bliver stående. **Og områder:** `items`-tabellen har haft en `area_id`-kolonne siden begyndelsen, men der var ingen vej til at sætte den — hverken i brugerfladen eller i API'et. Nu er der en chip ved siden af projektet. |
| 53 | **Gennemgangen kan minde dig udefra — og filnavnet står ikke længere i vejen.** Båndet i appen kræver, at du åbner doda, og gennemgangen er netop den ting, man glemmer at åbne noget for. Nu kan du slå en **notifikation** til på den dag og det klokkeslæt, du vælger; den er **slukket**, indtil du selv tænder den, og den lander direkte på gennemgangen i stedet for på forsiden. **Dertil:** trækker du en fil ind på kommandobaren, foreslås filnavnet stadig som titel — men nu **markeret**, så dit første tastetryk erstatter det. Før stod det som almindelig tekst, og skrev du din egen titel, fik du »min titel C3FF4A37-F58E-4B70…« og skulle slette et navn, du aldrig havde skrevet. |
| 52 | **»Fra fuldførelse« flytter nu også den dag, gentagelsen hænger på.** Markerede du en `every! month` udført den 23., kom den næste stadig den 22. — en månedsregel uden en dag i teksten udleder sin dag af *dengang, reglen blev skrevet*, og den stod fast for altid. Nu gentolkes reglen ud fra den dag, du blev færdig, og både forfaldet og overskriften følger med. Siger reglen selv en dag (`every! month on the 22nd`), bliver den stående — og en **fast** plan flyttes aldrig, uanset hvornår du blev færdig. |
| 51 | **Kommentarer siger, hvor de blev skrevet fra.** Sagu begyndte at mærke kommentarer med afsenderen (»from tovo«), og Sagu viste det rigtigt — men doda viste ingenting. Modulets **hvidliste** åd feltet: den er den rigtige vagt at have mod at slæbe ukendte felter med fra en fremmed tjeneste, men den æder også de felter, kilden tilføjer *bagefter*, og fejlen er tavs — begge ender så komplette ud. Den sad i **begge apps**, fordi tovos `sagu.js` er porteret fra dodas; fejlen blev arvet sammen med koden. En kommentar skrevet i Sagu står uden mærke. |
| 50 | **To ting fundet ved at sammenligne med Sagu.** Brugernavnet blev vist med stort i appen siden v41, men **samtykkesiden**, som *serveren* tegner, sagde stadig »andreas« — reglen lå kun i frontenden. Den bor nu i `shared/`, så begge flader deler den. Og titlen på en linket note blev kun opfrisket **én gang i døgnet**: døbte du noten om i Sagu, viste doda det gamle navn indtil i morgen. Vinduet er nu 60 sekunder, samme tal som Sagu bruger, og når fanen kommer frem, er titlen frisk med det samme. |
| 49 | **Et tal med punktum er altid en dato.** v48 lod konteksten afgøre det — stod der andet i feltet, blev `3.10` til kl. 03:10 — men så betød den samme skrivemåde to ting afhængigt af naboordene. Nu gælder én regel: `!3.10` er **den 3. oktober**, uanset hvad der ellers står. Skal punktummet være et klokkeslæt, skriver du `kl` foran: `!i dag kl 21.36`. Kolon er stadig entydigt og klarer sig uden: `!i dag 21:36`. |
| 48 | **Vejen til genvejs-hjælpen står, hvor nøglen laves.** Under *Access keys* er der nu et link til den trinvise vejledning, som samtidig er rettet på det, der faktisk driller: hvilken **anmodningstekst** man vælger i Genveje (`JSON` med nøglen `text` er nemmest; `Arkiv` er Apples danske navn for »File«), og hvad `invalid_key` betyder — næsten altid at der kun står `Bearer` uden selve nøglen. | Under *Access keys* er der nu et link til den trinvise vejledning. Den er samtidig rettet på det, der faktisk driller: hvilken **anmodningstekst** man skal vælge i Genveje (`JSON` med nøglen `text` er nemmest; `Arkiv` er Apples danske navn for »File« og virker også), og hvad `invalid_key` betyder — næsten altid at der kun står `Bearer` i Authorization-værdien uden selve nøglen. |
| 47 | **»Der er kommet en ny version« står nu i toppen — og projektet viser sine Sagu-noter.** Versionslinjen i sidebarens fod har kunnet sige det hele tiden, men på en telefon står foden **bag hamburgeren**, så man ser den aldrig. Nu er der et bånd med en Update-knap, der rydder cachen. **To fejl i den mekanik, der allerede fandtes:** sammenligningen var `!==`, så en *ældre* server også blev meldt som en opdatering — kun nyere tæller. Og serveren læste sin version ved opstart, så panelets »Opdatér app« (der skriver filerne uden at genstarte) aldrig ville få beskeden frem; den læses nu frisk, men kun når filens mtime er ændret. **Dertil:** en Sagu-note hænger på den opgave, den blev oprettet sammen med, så noterne var kun at finde ved at åbne opgaverne én for én. Projektsiden samler dem nu under **Notes in Sagu**, med notens eget navn først — det er tit et andet end opgavens. **Projektets egen note er med og står øverst** (»on this project«): den stod kun som en chip, der sagde »Doda« med et link-ikon, uden at røbe, at den var en note. **Og noten kan nu læses og kommenteres fra projektsiden.** Projektsiden kaldte Notion-ruden direkte, mens opgaver gik gennem den rude, der vælger ud fra *adressen* — så en Sagu-note på et projekt kunne hverken ses eller kommenteres, modsat den samme note på en opgave. Kommentaren i koden lovede »ét sted, så de to ikke kan drive fra hinanden«; nu passer det. |
| 46 | **Træk ned for at hente nyt — på telefonen.** Appen henter selv, når den kommer frem igen, men står den åben, mens noget ændrer sig et andet sted, var der ingen måde at bede om det på: synk-mærket øverst er for lille og for langt oppe på en telefon. Mærket følger fingeren og siger, hvad der sker — *Pull to refresh* → *Release to refresh* → *Refreshing…*. Det reagerer kun, når siden allerede er i top, og aldrig mens en rude eller menuen er åben. **Desuden to ting, `*`-ændringen i v44 havde efterladt:** en note oprettet med `* tekst @Projekt` mistede både projekt, kontekst og dato — kun den rene titel nåede frem til opgaven. Og projektsiden lovede stadig »No notes. Capture one with `* text @Navn`«, selv om `*` nu lægger noten i Sagu; det afsnit er væk, når der ikke er gamle doda-noter at vise. |
| 45 | **Noten i Sagu peger nu på den rigtige opgave.** Linjen »From doda« førte til dodas forside i stedet for til opgaven, fordi noten blev oprettet *før* opgaven — så dens id fandtes ikke endnu. Halvdelen af »linked both ways« var altså aldrig rigtig der. Rækkefølgen er vendt: opgaven først, så noten med adressen til netop den. Svigter Sagu, **beholdes opgaven** — teksten er reddet, og beskeden siger, at den ligger i din inbox. |
| 44 | **Er Sagu forbundet, laver `*` noten i Sagu — ikke i doda.** Før stod der to rækker, og man skulle vælge forfra hver gang, selv om svaret altid var det samme. Er der koblet en note-app på, hører noterne dertil. De noter, der allerede ligger i doda, bliver liggende og kan stadig søges frem — det er kun vejen ind, der lukkes. Svigter Sagu, tilbyder fejlbeskeden **»Keep in doda«**, så en note aldrig kan blive umulig at gemme. |
| 43 | **Noten fra Sagu kan læses — og kommenteres — inde i opgaven.** Ruden viste kun kommentarerne, så man kunne se, at nogen havde sagt noget om en note, man ikke kunne læse. Nu står teksten øverst, som Notion-siden har gjort siden v19; den hentes i samme kald og med `read`, så din `link`-nøgle er nok. **Og du kan svare herfra:** Sagu v8 sænkede kravet for en kommentar fra `write` til `capture`, fordi en kommentar ikke ændrer noten. Knappen hedder »Comment«, ikke »Save« — den sender noget ud, der ikke kan tages tilbage — og feltet ryddes først, når Sagu har kvitteret. Sagus egen kvittering vises ordret, så du får at vide, hvis kommentaren venter på godkendelse i stedet for at se ud til at være forsvundet. | Ruden viste kun kommentarerne, så man kunne se, at nogen havde sagt noget om en note, man ikke kunne læse — og måtte skifte app for at finde ud af, hvad sagen var. Nu står teksten øverst, som Notion-siden har gjort siden v19. Den hentes i samme kald som kommentarerne, og med `read`, så din `link`-nøgle er nok. Er noten lang, ruller den i sin egen rude i stedet for at skubbe knapperne ud af syne. |
| 42 | **»Create a page inside« virkede ikke for Sagu.** Klikkede du på den, blev listen stående, som den var — så notesbøgerne, du skulle vælge imellem, kom aldrig frem, og noten kunne ikke oprettes. Skiftet mellem *link* og *opret* tegnede aldrig listen forfra; for Notion gjorde det ikke noget, fordi begge tilstande søger, men i Sagu er de to lister helt forskellige. Nu står notesbøgerne der med det samme, og ledeteksten siger, hvad du vælger: »Pick the notebook *"Husk at bestille nye linser"* should go in.« Søgefeltet er væk i den tilstand — det søgte ikke efter noget. |
| 41 | **Notesbøgerne fra Sagu kan hentes forfra — og dit brugernavn vises med stort.** Listen blev kun hentet, når du *forbandt*. Oprettede du en notesbog i Sagu bagefter, kunne doda aldrig se den, og den eneste udvej var at koble fra og forbinde igen — hvilket kræver, at du finder nøglen frem på ny. **En cache uden en måde at genopfriske den på er en blindgyde.** Nu står der en **Refresh** ved siden af *Disconnect*, og den siger, hvad der skete: »2 new notebooks — 5 in total«, ikke bare »opdateret«. Er Sagu nede, står din gamle liste urørt — en tom liste ville se ud, som om notesbøgerne var slettet. **Dit brugernavn vises med stort begyndelsesbogstav.** Fire steder viste det navnet, præcis som det står i databasen — »andreas« i sidebaren, i brugermenuen, i »Signed in as« og i »Hi andreas.« på gennemgangen. Nu pyntes det, når det **tegnes**, mens navnet selv er urørt: det er det, du logger ind med, og nøglen i databasen. Kun første bogstav, ikke hvert ord — `capitalize` ville lave »anna-lise« om til noget, ejeren ikke selv har skrevet. En test vogter, at det pyntede navn kun bruges til at tegne og aldrig kan slippe ind i et API-kald. |
| 40 | **Repoet er offentligt, og install-scriptet behøver ikke længere et token.** Feltet er fjernet fra runen — ikke bare fordi det er overflødigt, men fordi en indstilling, der ikke længere gør noget, ligner en spærring uden at være en: den, der en dag ikke kan installere, ville lede efter fejlen i et tomt token-felt. En 404 fra GitHub betyder nu ét: taggen er ikke pushet. Scriptet gik fra 1.753 til 1.586 tegn. Dertil er alle rigtige adresser og værtsnavne i filerne skiftet ud med eksempler. |
| 39 | **Web app'en på telefonen opdaterer sig selv igen.** |
| 38 | **Focus åbner den skærm, hjælpeteksten har lovet hele tiden.** |
| 37 | **Noten stod to gange i detaljeruden.** |
| 36 | **Træk en fil på kommandobaren, og den bliver til en opgave.** Filen opretter ikke noget bag om dig: den lægger sig som en chip og venter på titlen, præcis som en dato gør — er feltet tomt, foreslås filnavnet, og Esc fortryder det hele uden at efterlade noget. **Dertil tre ting:** *Queued* er taget ud af status-menuen og af `q`-tasten (den er dodas interne hvileplads for noter og havde ingen skærm — en opgave sat dertil forsvandt fra alle lister), og til gengæld viser Inbox nu de opgaver, der alligevel står der. En Notion-side kan nu oprettes i en **database**, ikke kun under en side. Og *Show the Notion page* er flyttet ned under chippene, er foldet ud som standard, og husker, hvis du folder den sammen. |
| 35 | **Noter kan slås fra, og en Notion-side kan oprettes fra doda.** Holder du din reference i Notion, er dodas noter ét sted for meget: **Settings → Notes** fjerner Notes-skærmen, `*`-genvejen, *Make it a note* og guidens afsnit om dem. Det er kun **vejene ind**, der lukkes — eksisterende noter bliver liggende, står stadig på deres projekt, kan søges frem og kan laves om til opgaver. Dertil kan link-vælgeren nu **oprette en ny Notion-side**: vælg *Create a page inside*, klik på den side den skal ligge under, og doda laver den og linker den med det samme. Navnet foreslås ud fra opgavens eller projektets titel. |
| 34 | **Skriv en Notion-kommentar uden at forlade doda.** Folder du en Notion-side ud — på en opgave eller et projekt — står sidens kommentarer nu nedenunder, med et felt til at skrive en ny. Den lander direkte på siden i Notion, og ⌘+Enter sender. **Bemærk:** kommentarer er en *særskilt* tilladelse på integrationen i Notion. Et token, der læser sider fint, får afvist kommentarer, indtil du sætter fluebenene under Settings → Connections i Notion — og det er præcis dét, fejlbeskeden siger, i stedet for at lade dig lede efter fejlen i tokenet. Kommentarer caches aldrig: en gammel liste er værre end ingen, fordi den ser ud til at være hele samtalen. |
| 33 | **Hele titlen kan læses, og Notion-siden kan foldes ud på et projekt.** Titelfeltet i en åben opgave voksede før ikke med teksten — en lang titel skulle læses ved at rulle sidelæns. Nu folder feltet sig ud over flere linjer. Det er stadig én linje logisk set: Enter lægger ikke et linjeskift ind, og indsat tekst med linjeskift samles til én linje. Dertil har projektsiden fået samme **»Show the Notion page«** som en opgave, hvis projektet har et Notion-link. **To rettelser på telefonen i samme omgang:** detaljeruden var bredere end skærmen, så lukkeknappen lå uden for kanten, og fodrækken kunne ikke bryde, så Save lå uden for kortet. |
| 32 | **Rettelse: et projekt var en blindgyde.** Stod du inde i et projekt, gjorde hverken *Projects* i menuen eller *← Projects* noget som helst — skærmen var jo allerede »projects«, og nulstillingen lå bag et »kun hvis skærmen skifter«. Det åbne projekt blev stående, siden tegnede sig selv igen, og eneste vej ud var en anden skærm og tilbage. Samme fejl gjorde, at et kontekstfilter i Next Actions og et projektfilter i logbogen ikke kunne ryddes ved at klikke på skærmen i menuen. Reglen er nu, at **at gå til en skærm betyder at se den ren** — et filter er noget, man vælger, ikke noget, man arver. |
| 31 | **⌘+Enter gemmer.** En opgave, en gentagelse eller et projekt kan nu gemmes uden at gå efter musen — også midt i beskrivelsen, hvor Enter stadig laver linjeskift som før. Ctrl+Enter gør det samme på en pc. Genvejen er bundet på hver rudes egen Save-knap, ikke på »den primære knap i det åbne vindue«: spørgsmålet *denne gang eller alle fremtidige?* har også en primær knap, og den skal et tastetryk ikke kunne svare på ved et uheld. |
| 30 | **Forslag mens du skriver et navn.** Skriver du `/som`, `@som` eller `#h` midt i en linje, viser kommandobaren de projekter eller kontekster, der matcher — det, der *begynder* med det skrevne, står øverst. **Tab** sætter navnet ind, og navne med mellemrum kommer automatisk i anførselstegn. Forslagene står under oprettelsen, så **Enter fanger stadig**, uændret. `navn@eksempel.dk` udløser ingen liste — forslagene følger nøjagtig samme regler som parseren. **Dertil:** søgningen bruger nu den tolkede titel, så resultaterne ikke forsvinder, i det øjeblik du tilføjer `/projekt` eller `!i morgen` til linjen. |
| 29 | **Rettelse: den sidste opgave i en liste startede også en ny fangst.** Flyttede du den sidste række ud af en liste med `n`, `w`, `s`, `q`, `x` eller mellemrum, gjorde tasten begge dele — rækken flyttede sig, og kommandobaren åbnede med bogstavet i sig. Årsagen var v27: rækken flytter sig nu med det samme, og er der ingen næste række at give fokus til, faldt fokus til siden, hvor »begynd bare at skrive« overtog bogstavet. Nu stopper rækken tasten, når den selv har handlet på den, og værnet ser på hvor tastetrykket kom fra frem for hvad der har fokus bagefter. |
| 28 | **Skærmen, du står på, udfylder en ny opgave.** Fanger du noget, mens du står i *Waiting For* eller *Someday*, lander det dér i stedet for i Inbox — du tog jo beslutningen ved at gå derhen. På en projektside får opgaven projektet, og i en kontekst-filtreret liste får den konteksten; begge dele bliver stadig liggende i Inbox, for de er ikke afklaret endnu. En chip under feltet siger hvor den lander, **før** du trykker Enter, og skriver du selv `@projekt` eller `#kontekst`, vinder din tekst. En note rives aldrig med, og en klient uden skærm — iOS-genvej, Siri, Claude — får Inbox præcis som før. |
| 27 | **Tastaturet svarer med det samme.** Et tryk på `n`, `w`, `s`, `x` eller mellemrum ventede før på tre kald i træk — gem, hent tal, hent liste — før rækken overhovedet rørte sig. Serveren er ikke langsom (den svarer på under et millisekund); ventetiden lå bare foran dig i stedet for bag dig. Nu flytter rækken sig først, og serveren får besked bagefter, mens tal og liste opfriskes stille i baggrunden. Går det galt, kommer rækken tilbage med serverens egen besked; uden net bliver den stående med »waiting to send« som før. En ny opgave venter nu på **ét** kald i stedet for tre, fordi svaret allerede indeholder den. |
| 26 | **Appen henter selv, når du kommer tilbage til den.** På hjemmeskærmen blev doda aldrig genindlæst — havde du fanget noget fra Siri eller rettet noget på en anden enhed, stod der stadig det gamle, indtil du skiftede skærm. Nu hentes der friskt, når appen kommer frem igen, og når forbindelsen vender tilbage (køen sendes først, så dit eget kommer ind før noget hentes ned). Øverst til højre er der samtidig en **synk-knap, der siger hvor gammelt det, du ser på, er** — »just now«, »8 min ago«. En hentning kan kun gøre siden nyere: fejler den undervejs, bliver listen stående i stedet for at blive erstattet af en fejlside. |
| 25 | **En guide til hele appen.** Menuen på brugerknappen har fået *Guide*: en samlet gennemgang bygget som tingdos egen — fire dele (sådan virker doda, kommandobaren, tastaturet, uden for browseren), grupperet efter hvor i processen man er, med 25 emner og et lille mærke ud for hver linje. Syntaksen og genvejene hentes fra de samme steder som Settings og genvejsarket bruger, så guiden ikke kan komme til at love noget, appen ikke gør. Sideoversigten i højre kant er dens indholdsfortegnelse. |
| 24 | **Genvejssyntaks i gentagelsernes titelfelt, og ens fejlbeskeder hele vejen.** Skriver du `#kontekst` eller `@projekt` i titlen på en gentagelse, flytter de nu ned i rudens egne felter, som de gør alle andre steder i appen — findes navnet ikke, står det som »— new«, indtil du gemmer. Gentagelsesreglen røres aldrig: den har sit eget felt lige under, og en `!`-tekst i titlen bliver stående, som du skrev den. Dertil svarer alle fejl fra API'et nu med både en kode til klienten og en sætning til mennesket; otte steder gjorde det ikke, så en iOS-genvej kunne finde på at vise »not found«. |
| 23 | **Kalenderen peger tilbage til opgaven.** Hver aftale i feedet har nu et link til elementet i doda — både som `URL:` og i beskrivelsen, fordi ikke alle kalender-apps viser `URL:` tydeligt. Det krævede en adresse, doda ikke havde før: `?item=<id>` åbner ét bestemt element, også hvis du først skal logge ind. |
| 22 | **Rettelse: billed-links åbnede en tom Notion-side.** v21 pegede på blokkens id alene — men Notion prøver da at åbne blokken *som en side*, og en billedblok er ikke en side. Nu bruges sidens id med blokken som anker, præcis som Notions egen »Copy link to block«. |
| 21 | **Rettelse: billeder fra Notion fyldte hele ruden.** En signeret S3-adresse er ~1500 tegn, og dodas link-genkendelse stopper ved 500 — så halen løb ud som rå tekst. Værre: de adresser udløber efter en time, så linket var dødt dagen efter. Nu peger billeder, filer og pdf'er på **blokken i Notion**: 66 tegn i stedet for 1500, og det holder. |
| 20 | **doda siger nu, hvad den kan se i Notion.** Settings → Notion viser »can see 12 pages« eller »can see no pages yet«, og søgefeltet lister de tilgængelige sider, før du skriver noget. Det gør »hvorfor finder den ikke min side?« til noget, man kan aflæse i stedet for at gætte om. |
| 19 | **Se Notion-siden inde i doda.** Har en note eller opgave et Notion-link, kan indholdet foldes ud i detaljeruden — overskrifter, lister, afkrydsninger, citater og kode. Hentes først når du beder om det, og lever kun i hukommelsen: Notion er kilden, doda laver ingen kopi. Billeder vises som links, fordi doda kun viser indhold fra sin egen server. |
| 18 | **Notion-titler holder sig selv friske.** Omdøber du siden i Notion, retter chippen sig, næste gang du åbner opgaven eller projektet — højst ét opslag i døgnet pr. link, så en åbning ikke er et kald til en fremmed tjeneste. Søgningen finder nu også **databaser**, ikke kun sider. |
| 17 | **Link på projekter.** Databasen og API'et kunne det fra v14, men der var ingen knap. Nu kan et projekt pege på sin Notion-side ligesom en opgave: chippen står på projektsiden under beskrivelsen, og redigeres i »Edit project« — med samme Notion-søgning, hvis du har forbundet den. |
| 16 | **Notion-integration.** Forbind Notion under Settings, og du kan **søge efter en side inde fra doda**, når du linker en til en opgave — chippen får sidens rigtige titel i stedet for en række hex. Tokenet bliver på serveren og sendes aldrig til browseren, og det prøves mod Notion før det gemmes. **Rettelse i samme omgang:** `GET /api/v1/settings` returnerede *alle* indstillinger til enhver `read`-nøgle, også kalenderfeedets token. Hemmelighederne filtreres nu fra ét sted, som eksporten også bruger. |
| 15 | **Gennemgangen efter tingdo.** Startsiden viser nu en kort forklaring, en hilsen og ugens tal — og lader dig vælge **hvordan**: *Speed* (inbox og projekter, ikke andet), *Simple* (alle lister, én ad gangen) eller *Focused* (vælg ugens projekter først, gå så hele vejen). Måden og de valgte projekter ligger på serveren, så en afbrudt gennemgang genoptages nøjagtigt som den var. |
| 14 | **Link til en side — fx i Notion.** Hver opgave, note og hvert projekt kan pege på den side, sagen egentlig lever på. Linket bliver til en chip du kan klikke, og et lille ikon i listen. Feltet er bevidst generelt: Notion, et Google-dokument eller en GitHub-sag er lige gyldigt. Kun `http(s)` accepteres — både i dialogen og på serveren. **Og:** legenden i »New Task« nævner nu `!date` og `~hide until`, ikke kun projekt og kontekst. |
| 13 | **Notifikationer på telefonen (Web Push).** For dig, der ikke vil bruge et kalenderabonnement. Slås til pr. enhed under **Settings → Notifications**. Selve pushen er **tom** — telefonen spørger bagefter doda, hvad den skal vise, så Apples og Googles push-tjenester aldrig får at vide, hvad dine opgaver hedder. Ingen npm-pakker: VAPID er ~110 linjer med `node:crypto`. På iPhone kræver det, at doda ligger på hjemmeskærmen. |
| 12 | **Påmindelser på opgaver med klokkeslæt.** Kalenderfeedet indeholder nu en alarm, så din egen kalender giver besked — som standard et kvarter før, og du kan vælge fra »ingen« til »1 time før« under Settings. Kun opgaver **med et tidspunkt** får en påmindelse; en heldagsopgave ville ringe ved midnat. Det virker med appen lukket og uden at bede om tilladelse til noget. |
| 11 | **Offline virker nu hele vejen.** Før kunne du kun *fange* uden net; at tikke af gav browserens egen fejltekst (»Load failed«). Nu køer fuldførelse, statusskift og sletning på samme måde som fangst, og rækken siger hvad der venter. Alt sendes i rækkefølge, når nettet er tilbage. Køen fra en tidligere udgave sendes uændret. |
| 10 | **Ny skærm: Notes.** Alle dine noter ét sted, grupperet efter projekt. Uden den kunne en note uden projekt kun findes ved at søge. Den hedder *Notes* og ikke GTD's *Reference*, fordi appen allerede kalder dem noter overalt. Noter får ikke længere en afkrydsningsring i listerne — de er reference, ikke arbejde. |
| 9 | **Genvejssyntaksen virker nu også, når du retter en titel.** `/projekt`, `@projekt`, `#kontekst` og `!dato` i en opgaves titel bliver til chips, præcis som når du fanger — hjælpeteksten i ruden lovede det allerede for `#`. Kun det, doda faktisk kan tolke, fjernes fra titlen: `Husk !vigtigt` bliver stående, som du skrev det. Et projekt, der ikke findes, oprettes først når du trykker Save — aldrig ved Cancel. Dertil: **gentagende opgaver kan nu få kontekster** (serveren tog imod dem, men de kunne ikke sættes fra UI'et). |
| 8 | **Rettelse:** `x` (slet) svarede »not found«, selvom sletningen lykkedes — og fordi frontenden så en fejl, sprang den genindlæsningen over, så rækken blev stående på skærmen. Årsagen: opdateringsfunktionen læser rækken frisk bagefter, og en slettet række er netop filtreret fra. Fejlen havde ligget der hele tiden, men kunne først nås, da v7 gjorde genvejstasterne brugbare. Sideoversigten kan nu også nås med tabulator. |
| 7 | **Skallen.** Sidebaren kan foldes væk til en hamburger (nålen i toppen), og den lægger sig som et overlay i stedet for at skubbe siden. Ny **sideoversigt i højre side** — én streg pr. afsnit, som folder sig ud på hover og markerer, hvor du er. **Versionsnummeret** står nederst i sidebaren og siger til, hvis browseren kører en ældre udgave end serveren. **Tema skiftes med ét klik** ved siden af det, og **log ud** ligger nu i en menu på brugerknappen. `↑`/`↓` går ind i listen uden at åbne noget, så `n`/`w`/`s`/`x` kan bruges uden mus — `esc` slipper den igen. Og `/`, `#` og `:` i paletten kan nu **oprette**, ikke kun søge. |
| 6 | **Rettelse:** *Allow* på samtykkesiden gjorde ingenting. CSP'ens `form-action 'self'` håndhæves også på den **omdirigering**, indsendelsen fører til — og den peger på `claude.ai`. Browseren blokerede hele POST'en, og fejlen pegede på doda's egen adresse. Siden tillader nu præcis den oprindelse, klienten er registreret med. |
| 5 | **Connector til claude.ai.** Webklienten kan ikke sende en nøgle i en header, så doda taler nu **OAuth 2.1**: dynamisk klientregistrering, PKCE, engangs-koder, roterende refresh og en samtykkeside uden JavaScript. Tilføj `https://DIN-ADRESSE/mcp` som custom connector — Claude finder selv resten. Forbindelser står under **Settings → Connected apps** og kan tilbagekaldes øjeblikkeligt. Se [docs/OAUTH.md](docs/OAUTH.md). |
| 4 | **Rettelse:** `/projekt` virkede kun som første tegn i paletten, ikke midt i en sætning — selv om legenden lover `/ projects`. Nu betyder `@` og `/` præcis det samme, og hverken URL'er, datoer eller `ja/nej` bliver ramt. |
| 3 | **Rettelse: v2 kunne ikke nås i panelet.** Serveren bandt sig til den host-port, panelet havde allokeret, i stedet for container-porten 3000. Der er nu en regressionstest, der starter serveren med panelets præcise miljø. |
| 2 | Genvejsoversigt med `?`, `c`/`p` til kontekst og projekt fra en liste, og bundnavigation på mobil — de tre punkter fra beskrivelsen, der manglede i v1. |
| 1 | Første udgave. Fangst med genvejssyntaks, inbox med tastaturafklaring, næste handlinger efter kontekst, projekter og områder, markdown-noter, gentagelser med Todoist-syntaks, vedhæftninger, ugentlig gennemgang, logbog, fokustimer, kalenderfeed, eksport/import, Todoist-import, API til iOS Shortcuts, MCP-server til Claude, passkeys, PWA med offline-fangst. |
