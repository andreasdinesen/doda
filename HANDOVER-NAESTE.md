# Handover — hvad der mangler i doda

**Til:** Claude Code i en ny session
**Skrevet:** 2026-08-16, efter v4 blev pushet og connectoren blev bygget færdig.

> **Start med at læse, i denne rækkefølge:**
> 1. `~/ClaudeMacBook/RUNE-ERFARINGER.md` — fælles lærepenge for alle runer.
>    Læs den **før og efter** arbejdet, og skriv nye generelle lærdomme ind nederst.
> 2. `CLAUDE.md` i dette repo — konventioner og faste regler.
> 3. `DESIGN.md` — alle trufne beslutninger. Ændres noget, rettes det **her først**.
> 4. Denne fil.

---

## Tilstand lige nu

**v4 er udgivet** (`/projekt` inline + `icon.svg`). Den kører hos Andreas, når
han har kørt *Reload* og *Update/Reinstall* i panelet.

**Connectoren til claude.ai er bygget, testet og UCOMMITTET.** Arbejdsmappen
indeholder hele F12 — se `PLAN.md` og `docs/OAUTH.md`:

| Ændring | Status |
|---|---|
| `app/oauth.js` + migration `m8` + syv ruter | færdig |
| `/mcp` svarer 401 med `resource_metadata` | færdig |
| Samtykkeside uden JavaScript | færdig, verificeret i browseren i lys og mørk |
| Settings → **Connected apps** | færdig |
| `tests/oauth.test.mjs` | 18 tests |
| `docs/OAUTH.md`, README, DESIGN, PLAN | opdateret |

`node --test tests/*.mjs` → **135 grønne**. `python3 build_rune.py` → 93 % af loftet.

---

## Det eneste, der mangler

**Udgivelsen.** `APP_VERSION` står stadig på 4, som reglen siger. Når Andreas
siger ja:

1. `APP_VERSION = 5` i `app/parts/p1_core.js`
2. README-versionshistorik: én linje for v5
3. `python3 build_rune.py` → `node --test tests/*.mjs`
4. commit → push → (Andreas:) Reload + Update/Reinstall

---

## Pladsen i runen — vær opmærksom

Install-scriptet må højst fylde **120.000 tegn**. Efter OAuth fylder det
**112.196 (93 %)**. Der er altså kun ~8 K tilbage, og build'et **fejler højt**,
hvis loftet overskrides — det er en assert, ikke en advarsel.

Næste større funktion kræver, at der ryddes plads. Mulighederne, dyreste først:

- `app/public/icon-192.png` (2,2 KB binært ≈ 2,8 K tegn) er det sidste binære i
  payloaden. **PNG komprimeres ikke af brotli**, så den koster fuld pris. Den er
  der kun, fordi iOS' `apple-touch-icon` ikke tager SVG — fjern den ikke, uden at
  Andreas har accepteret at PWA-ikonet på iPhone bliver et fallback.
- CSS'en (33 KB) er det største enkeltstående tekstaktiv.
- Serveren kan tegne ikonet ved opstart i stedet for at bære det i payloaden.

---

## Faste regler, der IKKE må brydes

- **Commit og push kræver Andreas' udtrykkelige ja.** Et push er en udgivelse.
- **`APP_VERSION` bumpes kun ved udgivelse**, ét sted: `app/parts/p1_core.js`.
  Build stempler den i `index.html`, `sw.js` og runens `version:`.
- **Nul npm-pakker.** Det er både arkitektur og sikkerhedsvalg.
- `runes/doda.yaml` og `app/public/app.js` er **genererede** — redigér aldrig.
- Kør `python3 build_rune.py` efter hver ændring i `app/`.
- Interfacet er **engelsk**; kode, kommentarer og dokumenter er **dansk**.
- Lokal kørsel: `DODA_DEV=1 BIND_PORT=8910 DATA_DIR=/tmp/dodadata node app/server.js`
  (`DODA_DEV=1` slår asset-cachen fra — uden den ser man ikke sine egne ændringer).

---

## Fælder, der allerede er betalt for

Gentag dem ikke — og læs `RUNE-ERFARINGER.md`, hvor de står udførligt:

- **`PORT_<navn>` er HOST-porten.** Bind serveren til `BIND_PORT || 3000` og
  intet andet. v2 var utilgængelig af den grund, og **intet fejlede højlydt**.
- **Service workers kan ikke registreres i Claude Codes browser-panel.** Det
  fejler også mod en helt nøgen server. Test med en nøgen server først.
- **CSP'en kræver `worker-src 'self'`** — ellers blokerer man sin egen SW.
- **CORS og `Cross-Origin-Resource-Policy: same-origin` slås.** De offentlige
  OAuth-ruter går derfor uden om `securityHeaders()`.
- **Service workeren må kun cache app-skallen under `'./'`.** Uden `pathname ===
  '/'`-vagten endte samtykkesiden som det, man fik at se offline.
- **PNG komprimeres ikke af brotli.** Alt binært koster fuld pris i payloaden.
- **`programmatisk .focus()` udløser ikke fokus-hændelsen** i browser-panelet.
- **Skriv aldrig rå kontroltegn i et regex** — filen bliver binær, og `grep`
  holder op med at finde noget i den.

---

## Hvad der stadig venter på Andreas, ikke på dig

1. Bekræfte offline-læsning og hjemmeskærm **på sin telefon** — service
   worker-registreringen kunne ikke verificeres her.
2. Prøve **Todoist-importen** på en rigtig eksport.
3. Sende en **tingdo-eksport**, hvis den import stadig ønskes — formatet er ukendt.
4. **Prøve connectoren mod den rigtige claude.ai** — flowet er testet ende til
   ende mod en rigtig server lokalt, men ikke mod Anthropics klient. Går noget
   galt, er det næsten altid opdagelsen: `curl -si https://doda.hjorten.eu/mcp
   -d '{}' -H 'Content-Type: application/json' | grep -i www-authenticate`.
