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
| `app/kilde.js` | Henter app-koden fra GitHub ved opstart. Kører fra runens `startup`, før serveren. |
| `build_rune.py` | `python3 build_rune.py` — samler parts, `node --check`, CSP-hash, brotli+base85-payload, YAML-validering, rundtur. |

## Faste regler

- **Nul npm-pakker.** Det er både arkitektur og sikkerhedsvalg (ingen forsyningskæde).
- **Bump ALDRIG `APP_VERSION` undervejs** — kun når Andreas har godkendt commit'en.
  Flere ændringer samles i ÉN udgivelse.
- **Commit og push kræver et udtrykkeligt ja.** Et push er en udgivelse.
- Repoet er **offentligt** (Andreas, 2026-08-21), som Sagus. **Hver eneste ændring skal
  auditeres, før den pushes:** ingen rigtige mailadresser, ingen rigtige værtsnavne, ingen
  tokens. `navn@eksempel.dk` og `doda.eksempel.dk` er de former, der bruges i tests og docs.
- **Serveren henter selv sin kode** (v82). `app/kilde.js` kører fra runens
  `startup`, før serveren starter: den spørger GitHub efter nyeste `vN` — eller
  henter præcis den, `KODE_VERSION` peger på — og bytter `app/` ud. Følger:
  - **En udgivelse er tre trin:** commit → `git tag v<N>` → `git push --tags`.
    Uden taggen sker der ingenting; Andreas genstarter og får den gamle kode.
  - **`runes/doda.yaml` skal IKKE genudgives ved hver app-udgave.** `RUNE_VERSION`
    i `build_rune.py` er runens eget tal og bumpes kun, når YAML'en ændrer sig
    (variabler, startup, porte, watchers). Bumper man den unødigt, er man tilbage
    ved to trin i panelet for hver udgivelse — hele pointen tabt.
  - **Runens `update:`-else-gren skal holde SAMME regler som `kilde.js`** (ikke
    `/tmp`, flyt den gamle app væk frem for at slette den, byt aldrig halvt). Den
    bruges kun ved opgraderingen fra en doda uden `kilde.js` — altså den ene gang,
    der ikke kan fortrydes. Den blev glemt én gang (v84, fundet af Sagu).
  - **Alt i `kilde.js` ender med exit 0.** En fejl dér må aldrig kunne forhindre
    serveren i at starte: kan GitHub ikke nås, kører den kode, der ligger.
- **Install-scriptet BÆRER ikke app-koden — det henter den** fra
  `refs/tags/v<RUNE_VERSION>` (DESIGN.md, »Sagu-broen«). To følger:
  - **De genererede filer skal være committet** (`app/public/app.js`, ikonerne).
    `tjek_git()` i build'et fælder ellers.
  - Installationen kræver **intet token** — repoet er offentligt. Feltet er fjernet fra
    runen med vilje: en indstilling, der ikke længere gør noget, ligner en spærring uden
    at være en, og så leder man efter fejlen det forkerte sted. En 404 fra GitHub betyder
    nu ét: adressen findes ikke, altså er taggen ikke pushet.
- **`link_url` er generisk og skal blive ved med at være det.** Både Notion og Sagu
  bruger feltet, og **adressen** afgør hvem der spørges — ikke en tilstand. En
  Sagu-note er `…/#note-<32 hex>`, og formen afgøres FØR forbindelsen, ellers spørger
  doda Notion om et Sagu-id.
- Kildefiler må ikke indeholde `{{STORE_BOGSTAVER}}` eller `YGG_PAYLOAD_EOF`
  (build'et fejler højt på begge).
- Echo-linjer i install-scriptet: **ASCII** (æøå → ae/oe/aa).
- Panelets todelte opdaterings-flow (**Runes → Reload**, så **Settings → Update**)
  gælder stadig for runen — men **ikke for app-koden**. Den følger med en genstart.
  Fortæl Andreas »genstart doda«, ikke »hent runen ind igen«.

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
