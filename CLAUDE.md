# doda — kontekst til Claude Code

**doda** er Andreas' personlige GTD-opgave- og noteapp, bygget som **yggdrasil-rune**.
Én bruger. UI efter **tingdo.app**, gentagelser efter **Todoist**. Alt på dansk.

## Læs først — hver gang

1. `~/ClaudeMacBook/RUNE-ERFARINGER.md` — fælles lærepenge for alle runes.
   **Læs den FØR og EFTER et stykke arbejde.** Nye generelle lærdomme skrives ind
   nederst under »Log« og repoet committes+pushes.
2. `PLAN.md` — faseoversigt og hvor vi er. **Opdatér den efter hver fase.**
3. `DESIGN.md` — alle trufne beslutninger. Ændres noget, rettes det her først.
4. `docs/HANDOVER.md` — Andreas' oprindelige funktionsbeskrivelse (kravkilden).

## Filoversigt

| Fil | Rolle |
|---|---|
| `app/server.js` | Hele backenden. Ren Node ≥22 (`node:http`, `node:sqlite`, `node:crypto`). |
| `app/parts/p*.js` | Frontend-kilde, samles til `app/public/app.js` af build-scriptet. |
| `app/public/index.html` | HTML-skal + CSS. |
| `app/public/app.js` | **Genereret — redigér aldrig.** |
| `runes/doda.yaml` | **Genereret — redigér aldrig.** Ret kilderne, kør build. |
| `build_rune.py` | `python3 build_rune.py` — samler parts, `node --check`, CSP-hash, brotli+base85-payload, YAML-validering, rundtur. |

## Faste regler

- **Nul npm-pakker.** Det er både arkitektur og sikkerhedsvalg (ingen forsyningskæde).
- **Bump ALDRIG `APP_VERSION` undervejs** — kun når Andreas har godkendt commit'en.
  Flere ændringer samles i ÉN udgivelse.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- Repoet er **privat**. Panelets fine-grained GitHub-token skal have doda tilføjet,
  ellers giver »Browse GitHub« *not found*.
- Kildefiler må ikke indeholde `{{STORE_BOGSTAVER}}` eller `YGG_PAYLOAD_EOF`
  (build'et fejler højt på begge).
- Echo-linjer i install-scriptet: **ASCII** (æøå → ae/oe/aa).
- Panelets opdaterings-flow er todelt: **Runes → Browse GitHub → Reload** henter kun
  rune-definitionen; **Serveren → Settings → Update/Reinstall** installerer appen.

## Lokal kørsel

```sh
BIND_PORT=8910 DATA_DIR=/tmp/dodadata node app/server.js
python3 build_rune.py
```

Dev-server til preview-værktøjet står i den **globale** `~/.claude/launch.json`
(ikke en `.claude/`-mappe i projektet — preview læser kun den globale).

## Nyere panelfunktioner, doda bruger

Erfaringsfilen er skrevet før disse fandtes:

- **`update:`** — egen »Opdatér app«-knap med eget script/image. Bruges til at skrive
  app-filerne igen uden at røre `/data`.
- **`docker.image` er templated** → `"{{NODE_IMAGE}}"` gør Node-versionen til et felt
  i panelet, så en CVE kan lukkes uden kodeændring.
- **`variables: secret: true`** — AES-256-GCM krypteret at rest, maskeret i API-svar.
- **`events:`** — vedvarende sikkerhedssignaler pr. subjekt (fx fejllogin pr. IP).
- `services:`, `config_files:`, `import:` findes også, men doda bruger dem ikke.
