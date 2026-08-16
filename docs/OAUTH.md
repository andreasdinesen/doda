# Connector til claude.ai — OAuth 2.1

Claude Code og Desktop kan sende en fast nøgle i en header. **Webklienten kan
ikke.** Den kender ikke din server på forhånd, så den skal kunne registrere sig
selv og sende dig gennem et login. Det er hele grunden til, at doda taler OAuth.

Motoren står i `app/oauth.js` (186 linjer, ingen pakker). Modulet får serverens
funktioner ind gennem et `srv`-objekt og kender hverken databasen eller http'en
— samme mønster som `mcp.js` og `webauthn.js`.

---

## 1 · Sådan bruger du den

1. I Claude: **Settings → Connectors → Add custom connector**.
2. Adressen er `https://DIN-ADRESSE/mcp`.
3. Claude sender dig til doda. Log ind, hvis du ikke allerede er det, og tryk
   **Allow**.
4. Forbindelsen står under **Settings → Connected apps** og kan tilbagekaldes
   derfra. Det virker øjeblikkeligt — der er ingen cache af tokens.

Kræver **https**, fordi claude.ai kun accepterer https-redirects.

---

## 2 · Flowet, trin for trin

| # | Hvem | Hvad |
|---|---|---|
| 1 | Claude | `POST /mcp` uden token → **401** med `WWW-Authenticate: Bearer realm="doda", resource_metadata="…"` |
| 2 | Claude | henter `/.well-known/oauth-protected-resource/mcp` → finder autorisationsserveren |
| 3 | Claude | henter `/.well-known/oauth-authorization-server` → finder endepunkterne |
| 4 | Claude | `POST /oauth/register` → får et `client_id` (RFC 7591) |
| 5 | dig | sendes til `/oauth/authorize?…` med en PKCE-udfordring |
| 6 | doda | viser samtykkesiden. Er du ikke logget ind, sendes du til `/?next=…` og tilbage bagefter |
| 7 | dig | trykker **Allow** → redirect til Claude med en kode |
| 8 | Claude | `POST /oauth/token` med kode + `code_verifier` → access- og refresh-token |
| 9 | Claude | `POST /mcp` med `Authorization: Bearer <access token>` |

Uden trin 1's header kan Claude ikke opdage autorisationsserveren og opgiver
forbindelsen. Det er den enkeltdel, det er lettest at glemme.

---

## 3 · Endepunkter

| Sti | Login | Hvad |
|---|---|---|
| `GET /.well-known/oauth-protected-resource[/mcp]` | nej | hvem beskytter `/mcp` |
| `GET /.well-known/oauth-authorization-server[/mcp]` | nej | hvor endepunkterne er |
| `POST /oauth/register` | nej | dynamisk klientregistrering |
| `GET /oauth/authorize` | **session** | samtykkesiden |
| `POST /oauth/authorize` | **session** | godkend eller afvis |
| `POST /oauth/token` | nej | `authorization_code` og `refresh_token` |
| `POST /oauth/revoke` | nej | klienten melder sig selv fra |

Begge `.well-known`-stier serveres både nøgne og med `/mcp` bagpå: RFC 9728
hænger ressourcens sti på, men flere klienter prøver den nøgne form først.
To linjer kode sparer en tavs opdagelsesfejl.

De offentlige endepunkter sender `Access-Control-Allow-Origin: *` og går derfor
**uden om** `securityHeaders()` — den ville lukke dem igen med
`Cross-Origin-Resource-Policy: same-origin`.

---

## 4 · Hvad der gør det sikkert

- **PKCE med S256 er obligatorisk.** `plain` afvises, og en forespørgsel uden
  `code_challenge` når aldrig frem til samtykkesiden.
- **Koden er engangsbrug og lever ét minut.** Den er bundet til både klient og
  redirect-adresse, så en stjålet kode ikke kan indløses et andet sted.
- **`redirect_uri` matches nøjagtigt** — ingen præfikser, ingen wildcards. Kun
  https udefra; `localhost` er undtaget, så et lokalt værktøj kan prøve med.
- **Roterende refresh.** Den gamle dør i samme øjeblik, den nye fødes.
- **Access-tokens udløber efter 8 timer** og ligger i den almindelige
  `tokens`-tabel med et `client_id` og et `expires_at`. Der er ingen anden vej
  ind i API'et end `findToken`, og udløbstjekket sidder dér.
- **Samtykke-formularen bærer et bevis**, der er bundet til sessionen
  (`hmac(sessionscookie, "oauth-consent")`). `SameSite=Lax` dækker det allerede
  i praksis, men det er appens eneste cookie-godkendte rute, der ikke læser en
  JSON-krop — og så skal den have sin egen spærre.
- **Samtykkesiden har ingen JavaScript.** En almindelig `<form method="post">`,
  fordi CSP'en ikke tillader inline scripts uden hash. Tema-scriptet er den ene
  undtagelse: det er ordret det samme som i `index.html` og har derfor allerede
  sin hash i headeren.
- **En connector kan ikke administrere sig selv.** Kodeordsskift, adgangsnøgler
  og tilbagekaldelse af forbindelser kræver en rigtig session.
- `?next=` accepterer **kun** stier, der begynder med `/oauth/authorize?` —
  ellers ville login-siden være en åben viderestilling.

---

## 5 · Prøv den uden Claude

```bash
curl -si -X POST https://DIN-ADRESSE/mcp -H 'Content-Type: application/json' -d '{}' | grep -i www-authenticate
```

Peger headeren på `/.well-known/oauth-protected-resource/mcp`, er opdagelsen på
plads. Resten dækkes af `tests/oauth.test.mjs`, som går hele vejen igennem mod
en rigtig server — inklusive at en kode udstedt til klient A ikke kan indløses
af klient B, at refresh roterer, og at access-tokenet rent faktisk udløber.
