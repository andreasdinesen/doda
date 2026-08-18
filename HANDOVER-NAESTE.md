# Handover — doda

**Til:** Claude Code i en ny session
**Skrevet:** 2026-08-18, efter v26

> **Læs i denne rækkefølge, før du rører noget:**
> 1. `~/ClaudeMacBook/RUNE-ERFARINGER.md` — fælles lærepenge for alle runer.
>    **Afsnit 9** er genbrugelige byggeklodser (MCP+OAuth, sideoversigt,
>    foldbar sidebar). Læs filen **før og efter** arbejdet, og skriv nye
>    generelle lærdomme ind nederst under »Log«.
> 2. `CLAUDE.md` — konventioner og faste regler.
> 3. `DESIGN.md` — alle trufne beslutninger. Ændres noget, rettes det **her først**.
> 4. Denne fil.

---

## Tilstand

**v26 er udgivet. Arbejdsmappen er ren.** Alt er pushet.

| | |
|---|---|
| Tests | **167 grønne** (`node --test tests/*.mjs`) |
| Install-script | **113.614 / 126.000 tegn (90 %)** — se `PLAN.md` om guidens pris |
| Kode | `server.js` 3.594 linjer + syv moduler |

Kør altid `python3 build_rune.py` efter en ændring i `app/` — den samler
frontenden, stempler versionen, bygger payloaden og verificerer rundturen.

---

## Hvad appen er nu

GTD-app som yggdrasil-rune. Ud over kernen (fangst, inbox, næste handlinger,
projekter, områder, kontekster, gentagelser, gennemgang, logbog, fokustimer,
vedhæftninger, eksport/import, Todoist-import, passkeys, PWA) har den:

| Modul | Hvad |
|---|---|
| `app/mcp.js` | MCP-server på `/mcp` — Claude kan læse og skrive |
| `app/oauth.js` | OAuth 2.1, så **claude.ai** kan forbinde som connector |
| `app/push.js` | Web Push (VAPID, uden nyttelast) |
| `app/notion.js` | Notion: søg, titler, og sidens indhold vist i doda |
| `app/webauthn.js` | Passkeys |
| `app/shared/parse.js` | Genvejssyntaksen — **én parser, tre køresteder** |
| `app/parts/p9_guide.js` | Guiden: ren data i `GUIDE_DELE`, nået fra brugermenuen |

Notifikationer går **primært gennem kalenderfeedet** (`VALARM`), ikke push.
Push er alternativet for den, der ikke abonnerer med sin kalender.

---

## Det vigtigste at forstå, før du ændrer noget

**Fire ting har kostet mest i denne kodebase. De står udførligt i
`RUNE-ERFARINGER.md`, men her er de i kort form:**

1. **Lover interfacet noget, skal koden holde det.** `/projekt` stod i
   paletten i fire versioner uden at virke; `#` i detaljeruden i endnu flere;
   `! date` manglede helt i legenden. Hver gang var bagenden klar, og forsiden
   løj. **Læs en legende eller en hjælpetekst som en kravspecifikation.**
2. **Mål efter animationen, ikke under den.** En `getBoundingClientRect()`
   umiddelbart efter en klasseændring lyver, hvis der er en CSS-transition.
   Verificér på `getComputedStyle().transform` eller en klasse.
3. **Test *vejen* til en funktion, ikke bare funktionen.** Slette-fejlen lå i
   otte udgivelser, fordi testene kaldte `slet()` direkte, mens genvejen ikke
   kunne nås uden mus.
4. **Se din test fejle på den gamle kode, før du tror på den.** Flere gange har
   en test bestået, uden at bevise noget.

**Og en arbejdsvane:** samler du flere `str.replace()` i ét Python-script, og en
sen `assert` fejler, kasseres *hele* filen — også de erstatninger, der lykkedes.
Det skete tre gange. Brug Edit-værktøjet, eller skriv filen efter hvert trin.

---

## Hvad der venter på Andreas, ikke på dig

1. **Prøve connectoren mod den rigtige claude.ai.** Flowet er testet ende til
   ende lokalt, men aldrig mod Anthropics klient. Går det galt, er det næsten
   altid opdagelsen:
   `curl -si https://doda.hjorten.eu/mcp -H 'Content-Type: application/json' -d '{}' | grep -i www-authenticate`
2. **Bekræfte Web Push på telefonen.** Selve leveringen kan ikke testes her (der
   er ingen push-tjeneste, og browser-panelet kan ikke registrere en service
   worker). På iPhone virker det **kun**, når doda ligger på hjemmeskærmen.
3. **Bekræfte kalenderpåmindelserne.** På iPhone skal abonnementet have
   »Fjern påmindelser« slået **fra**, ellers stripper iOS `VALARM` uden at sige det.
4. **Dele sine Notion-sider med integrationen.** Et gyldigt token er ikke nok.
   Settings → Notion siger nu, hvor mange sider doda kan se — står der »no pages
   yet«, er delingen ikke gået igennem.
5. Offline-læsning og hjemmeskærm på telefonen. Todoist-import på en rigtig
   eksport. En tingdo-eksport, hvis den import stadig ønskes (formatet er ukendt).

---

## Kendte huller

- **Ingen deling og ingen flere brugere.** Bevidst — se `DESIGN.md §7`.

De to andre blev lukket i **v24**:

- Fejlsvarene i `/api/v1` har samme form hele vejen nu. Det var ikke kun
  `GET /api/v1/items/<id>`: fem ruter svarede `{error: 'not found'}` uden
  `message`, og tre 400-svar gjorde det samme. `tests/apierror.test.mjs`
  holder både ruterne og **formen** fast.
- Gentagelses-rudens titelfelt tolker `#kontekst` og `@projekt` og flytter dem
  ned i rudens egne felter. Reglen røres aldrig — den har sit eget felt, og
  det var to veje til reglen, den oprindelige beslutning ville undgå
  (`DESIGN.md §3`).

---

## Pladsen i runen

Install-scriptet må højst fylde **126.000 tegn** (hævet fra 120.000 i v7).
Det fylder **112.652 (89 %)**, og build'et **fejler højt** ved loftet.
Guiden (v25) er den dyreste enkeltside, appen har: dens tekst kostede 6.274 tegn
og blev trimmet til ~4.700. Dens CSS koster kun 364. Skal der spares mere dér,
er næste greb at skære hele emner væk — et indholdsvalg, ikke et teknisk.

Kommentar-strip i den udgivne kopi (v10) gav 24 %; kilderne beholder alt.
Bliver det trangt igen, står de målte muligheder i `PLAN.md` — kort:
`app/public/icon-192.png` frigør 2.815 tegn (men er iOS' hjemmeskærms-ikon),
og `style.css` er det største, der ikke er kode.

**Mål altid med leave-one-out** frem for at gætte: rå filstørrelse siger næsten
intet. `parse.js` er 25 KB rå og koster 180 tegn, fordi den også ligger i
`app.js`, og brotli genkender dubletten.

---

## Faste regler, der IKKE må brydes

- **Commit og push kræver Andreas' udtrykkelige ja.** Et push er en udgivelse.
- **`APP_VERSION` bumpes kun ved udgivelse**, ét sted: `app/parts/p1_core.js`.
  Build stempler den i `index.html`, `sw.js` og runens `version:`.
  `tests/version.test.mjs` fejler, hvis de kommer ud af trit.
- **Nul npm-pakker.** Både arkitektur og sikkerhedsvalg.
- `runes/doda.yaml` og `app/public/app.js` er **genererede** — redigér aldrig.
- Interfacet er **engelsk**; kode, kommentarer og dokumenter er **dansk**.
- Lokal kørsel: `DODA_DEV=1 BIND_PORT=8910 DATA_DIR=/tmp/dodadata node app/server.js`
  (`DODA_DEV=1` slår asset-cachen fra — uden den ser man ikke sine egne ændringer).
- Dev-server til preview-værktøjet står i den **globale** `~/.claude/launch.json`.

---

## Fælder, der allerede er betalt for

- **`PORT_<navn>` er HOST-porten.** Bind til `BIND_PORT || 3000` og intet andet.
  v2 var utilgængelig af den grund, og **intet fejlede højlydt**.
- **CORS og `Cross-Origin-Resource-Policy: same-origin` slås.** De offentlige
  OAuth-ruter går derfor uden om `securityHeaders()`.
- **`form-action 'self'` gælder også omdirigeringen efter en POST.** Det dræbte
  OAuth-samtykkeknappen tavst i v5.
- **Et endepunkt, der returnerer »alt i en tabel«, er en tidsindstillet lækage.**
  `GET /api/v1/settings` gav hemmeligheder væk til enhver `read`-nøgle, indtil
  v16. Nye hemmeligheder skal i `HEMMELIGE_SETTINGS`.
- **Browser-panelet kører selv med `document.visibilityState === 'hidden'`.**
  Alt, der hænger på at appen »kommer frem«, kan derfor ikke udløses naturligt
  dér — overskriv getteren og send begivenheden selv.
- **Service workers kan ikke registreres i Claude Codes browser-panel**, og
  panelet sender syntetiske keydown med **tom `e.key`** — tastaturnavigation kan
  ikke afprøves der. Dispatch en rigtig `KeyboardEvent` i stedet.
- **Notions filadresser er signerede og udløber.** Link til
  `notion.so/<side-id>#<blok-id>` — blok-id'et **alene** åbner en tom side.
- **PNG komprimeres ikke af brotli.** Alt binært koster over 125 % af sin vægt.
- **Skriv aldrig rå kontroltegn i et regex** — filen bliver binær, og `grep`
  holder op med at virke.

---

## Sådan starter du

```
Læs HANDOVER-NAESTE.md i ~/ClaudeMacBook/doda og gå i gang.
```

Er der ikke en konkret opgave, så spørg Andreas hvad der skal ske — og lad være
med at bygge videre på egen hånd. Appen er færdig i den forstand, at hele
kravbeskrivelsen er bygget; alt siden har været hans ønsker, ét ad gangen.
