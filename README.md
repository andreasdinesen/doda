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
| `* kontonummer 1234` | note |
| `#telefon` | kontekst (nye skal bekræftes med et ekstra Enter) |
| `@Sundhed` · `@"Sommerhus i Rørvig"` | projekt |
| `!tomorrow` `!friday` `!3/9` `!in 2 weeks` `!sep 3 at 9` | deadline |
| `~in 2 months` | skjul indtil den dato |
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
| `↑` `↓` (eller `k` `j`) | flyt mellem elementer |
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
| 2 | Genvejsoversigt med `?`, `c`/`p` til kontekst og projekt fra en liste, og bundnavigation på mobil — de tre punkter fra beskrivelsen, der manglede i v1. |
| 1 | Første udgave. Fangst med genvejssyntaks, inbox med tastaturafklaring, næste handlinger efter kontekst, projekter og områder, markdown-noter, gentagelser med Todoist-syntaks, vedhæftninger, ugentlig gennemgang, logbog, fokustimer, kalenderfeed, eksport/import, Todoist-import, API til iOS Shortcuts, MCP-server til Claude, passkeys, PWA med offline-fangst. |
