# doda som MCP-server

doda taler **Model Context Protocol** på `/mcp`, så Claude kan læse og skrive
direkte i dine opgaver: fange noget, se hvad du kan lave nu, markere udført,
søge, og kigge på projekter og gentagelser.

Protokollen er JSON-RPC 2.0 over HTTP. Den er **håndskrevet uden pakker** —
samme princip som resten af doda: ingen afhængigheder, ingen forsyningskæde at
holde patchet.

---

## 1 · Lav en nøgle

**Settings → Access keys** i doda. Vælg scope efter, hvad Claude skal kunne:

| Scope | Claude kan | Værktøjer den ser |
|---|---|---|
| `capture` | kun tilføje | `capture` |
| `read` | kun læse | `list_next_actions`, `list_inbox`, `search`, `list_projects`, `get_project`, `list_repeating`, `list_attachments`, `list_contexts` |
| `full` | alt | alle elleve |

`tools/list` viser **kun** det, nøglen faktisk må. Så foreslår Claude aldrig et
værktøj, der alligevel ville blive afvist — og scopet håndhæves igen ved selve
kaldet, ikke kun i listen.

Start med `read`, hvis du bare vil kunne spørge til dine opgaver. Brug `full`,
når Claude også skal kunne rydde op for dig.

---

## 2 · Claude Code

```bash
claude mcp add --transport http doda https://DIN-ADRESSE/mcp --header "Authorization: Bearer doda_DIN-NØGLE"
```

Tjek at den svarer:

```bash
claude mcp list
```

Derefter kan du bare skrive »hvad kan jeg lave nu?« eller »fang: ring til
tandlægen i morgen kl. 9«.

## 3 · Claude Desktop

Åbn **Settings → Developer → Edit Config** og tilføj:

```json
{
  "mcpServers": {
    "doda": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://DIN-ADRESSE/mcp",
               "--header", "Authorization: Bearer doda_DIN-NØGLE"]
    }
  }
}
```

Genstart Claude Desktop bagefter.

> `mcp-remote` er en bro, fordi Desktop-konfigurationen kører kommandoer frem
> for at kalde HTTP direkte. Den kører på din egen maskine — doda selv har
> stadig ingen afhængigheder.

## 4 · claude.ai i browseren

Webklienten kan ikke sende en fast nøgle i en header. Den kender ikke din
server på forhånd, så den skal kunne **registrere sig selv** og sende dig
gennem et login. Det er dét, doda nu kan — se `docs/OAUTH.md` for hele flowet.

**Sådan gør du:**

1. I Claude: **Settings → Connectors → Add custom connector**.
2. Adressen er `https://DIN-ADRESSE/mcp`. Ingen nøgle, intet andet.
3. Claude finder resten selv og sender dig til doda, hvor du logger ind og
   trykker **Allow**.
4. Forbindelsen står bagefter under **Settings → Connected apps** i doda og
   kan tilbagekaldes derfra.

> Kræver **https**. Adressen skal kunne nås udefra (Cloudflare-tunnelen), og
> claude.ai's redirect-adresse er `https://claude.ai/api/mcp/auth_callback`.
> Den registrerer klienten selv — du skal ikke skrive den nogen steder.

---

## 4b · Raycast

MCP er en **Raycast Pro**-funktion, og doda kræver ingen udvidelse eller kode:
Raycast taler remote MCP over HTTP, hvilket er præcis dét, doda gør. Det virker
også i Raycast på iOS, hvor remote HTTP er den eneste mulighed.

Der er to veje, og forskellen er, hvem der holder nøglen.

**Med en nøgle** (enklest, og den eneste, der virker uden https):

1. I Raycast: kør **Install MCP Server** (eller *Manage MCP Servers → Install
   New Server*).
2. Transport: **HTTP**. Adresse: `https://DIN-ADRESSE/mcp`.
3. Under HTTP headers: `Authorization` = `Bearer doda_DIN-NØGLE`.

**Med OAuth** (nøglen bliver aldrig skrevet ned):

1. Samme formular, men lad headeren stå tom og vælg **Dynamic OAuth**.
2. Raycast registrerer sig selv, sender dig til doda, hvor du logger ind og
   trykker **Allow**. Token gemmes krypteret hos Raycast.
3. Forbindelsen står bagefter under **Settings → Connected apps** i doda og kan
   tilbagekaldes derfra — hvilket er hele fordelen ved den vej.

Brug **`read`-scopet**, hvis Raycast kun skal kunne slå op; `full`, hvis den
også skal kunne fange og fuldføre. En launcher, man kalder frem hele dagen, er
et godt sted at holde tilladelserne små.

> **Prøvet ende til ende 25-08-2026** mod en rigtig doda med Raycasts eget
> håndtryk: `initialize` (protokol 2025-06-18), `tools/list` (11 værktøjer),
> `capture` og `list_next_actions`, plus hele opdagelsesvejen — 401 med
> `WWW-Authenticate`, `/.well-known/oauth-protected-resource/mcp`, og
> registrering med PKCE `S256`. `GET /mcp` svarer `405` med `Allow: POST`, som
> en server uden SSE-strøm skal.

---

## 5 · Værktøjerne

| Værktøj | Scope | Hvad |
|---|---|---|
| `capture` | capture | Fang en opgave eller note. **Hele genvejssyntaksen virker** |
| `list_next_actions` | read | Hvad du kan gøre nu. Valgfrit `context` |
| `list_inbox` | read | Ufordøjet, ældste først |
| `search` | read | Fuldtekst, også i beskrivelser |
| `complete_task` | write | Markér udført. Gentagelsen føres videre automatisk |
| `update_task` | write | Titel, beskrivelse, status, datoer |
| `list_projects` | read | Med område, antal åbne og **NO NEXT ACTION**-markering |
| `get_project` | read | Alt i ét projekt: opgaver, noter, underprojekter |
| `list_repeating` | read | Regel, næste forfald og antal spring |
| `list_attachments` | read | Filer på ét element — **kun metadata**, aldrig indhold |
| `list_contexts` | read | Kontekster med antal næste handlinger |

`capture` tager hele linjen, ikke felter hver for sig:

```
call the dentist #phone @Health !tomorrow at 9 // remember the referral
water the plants !every! 3 days
```

Det er med vilje: Claude skal skrive én linje, ligesom du selv gør i appen —
og det er **den samme parser**, der tolker den. Der findes ikke en særlig
MCP-vej ind i dine data.

Serveren sender en kort brugsanvisning med i `initialize`, så Claude ved, at
inbox er det ufordøjede, at næste-listen er det aktuelle, og at den aldrig må
finde på id'er selv.

---

## 6 · Sikkerhed

- **Samme adgangsnøgler som resten af API'et**, med samme scopes og samme
  øjeblikkelige tilbagekaldelse. Tilbagekald en nøgle, og Claude mister
  adgangen ved næste kald. Det gælder også OAuth: et token derfra ender i
  præcis samme tabel og valideres ad præcis samme vej — bare med et udløb.
- **En connector kan aldrig administrere sig selv.** Kodeordsskift, oprettelse
  af nøgler og tilbagekaldelse af forbindelser kræver en rigtig browsersession.
  Én kompromitteret forbindelse kan altså ikke give sig selv varig adgang.
- **Origin-tjek mod DNS-rebinding**: kommer der en `Origin`-header, skal den
  matche værten. En hjemmeside kan altså ikke få din browser til at snakke med
  din doda. Klienter uden browser (Claude Code, Desktop) sender ingen Origin,
  og så er der intet at tjekke.
- **Kun POST.** `GET` og `DELETE` giver 405 — der er ingen serverstyret
  SSE-strøm at hijacke.
- Ugyldige nøgler logges til Yggdrasil-panelets sikkerhedshistorik pr. IP,
  præcis som mislykkede login.
- En fejl i et værktøj kommer tilbage som `isError` med en læsbar besked —
  ikke som en protokolfejl. Så kan Claude rette op i stedet for at gå i stå.

**Nøglen står i din klient-konfiguration i klartekst.** Det er samme situation
som enhver anden API-nøgle på din egen maskine, men det er værd at vide: brug
en nøgle pr. maskine, så du kan spærre én uden at røre de andre.

---

## 7 · Prøv den uden Claude

```bash
curl -s https://DIN-ADRESSE/mcp -H "Authorization: Bearer doda_DIN-NØGLE" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Svarer den med en liste af værktøjer, er alt som det skal være. Får du `401`,
er nøglen forkert eller tilbagekaldt; `403` betyder, at din `Origin` ikke
matcher værten.
