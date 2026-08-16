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

### Tastatur

I Inbox og Næste handlinger kan alt klares uden mus:

| Tast | Handling |
|---|---|
| `↑` `↓` (eller `k` `j`) | flyt mellem elementer |
| `Enter` | åbn elementet |
| `mellemrum` | markér udført |
| `n` `w` `s` `q` | Next · Waiting for · Someday · Queued |
| `x` | slet |
| `/` | tilbage til kommandobaren |

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

Ud over panelets backup kan alt eksporteres i et åbent format inde i appen
(kommer i F8) — ingen indelåsning.

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
- Adgangsnøgler til API'et gemmes kun som `sha256` og kan tilbagekaldes
  øjeblikkeligt (kommer i F2).

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
| 1 | *(under udvikling)* Fundament: rune, login, app-skal, design. |
