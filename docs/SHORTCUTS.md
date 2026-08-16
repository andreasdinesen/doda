# doda på iPhone — genveje og Siri

Sådan får du de to genveje, der betyder noget: **fang en tanke** og
**hvad kan jeg lave nu**. Alt herunder er konkrete værdier, du kan skrive af.

---

## 1 · Lav en adgangsnøgle

I doda: **Settings → Access keys**.

| Til | Vælg scope | Hvorfor |
|---|---|---|
| Fangst-genvejen | `Capture only` | En mistet telefon kan så tilføje, men **ikke læse** noget som helst |
| Læse-genvejen | `Read only` | Kan ikke ændre eller slette |

Nøglen vises **én gang**. Kun en hash af den ligger i databasen, så den kan ikke
findes frem igen — heller ikke af mig. Kopiér den med det samme.

Skal du bruge både fangst og læsning i samme genvej, så lav to nøgler frem for
én `Full access` — så kan du spærre den ene uden at røre den anden.

**Din adresse** er den, du åbner doda på, fx `https://doda.hjorten.eu`.
Bruger du kun `IP:port` over http, virker det også, men så går nøglen ukrypteret
over dit netværk.

---

## 2 · Genvej: »Fang i doda«

Opret en ny genvej i Genveje-appen med **to** handlinger:

**Handling 1 — Tekst**
Lad feltet stå tomt. (Når genvejen køres fra Del-arket eller med tekst-input,
udfyldes den automatisk. Kører du den fra hjemmeskærmen, skal du i stedet bruge
handlingen *Bed om input* → Tekst.)

**Handling 2 — Hent indhold fra URL**

| Felt | Værdi |
|---|---|
| URL | `https://DIN-ADRESSE/api/v1/capture` |
| Metode | `POST` |
| Headers | `Authorization` = `Bearer doda_DIN-NØGLE` |
| Anmodningstekst | `Fil` → vælg `Tekst` fra handling 1 |

Det er hele opsætningen. Der skal **ikke** sættes Content-Type, og du behøver
ikke bygge JSON — API'et tager imod en ren tekststreng, netop for at en genvej
kan nøjes med ét felt.

### Siri

Giv genvejen navnet **»Fang i doda«**. Så virker:

> »Hey Siri, fang i doda« → Siri spørger hvad, du dikterer, og den ligger i din inbox.

Vil du have det hurtigere, så tilføj genvejen til hjemmeskærmen eller læg den i
Kontrolcenter.

### Genvejssyntaks virker også fra Siri

Du kan diktere hele syntaksen:

> »ring til tandlægen hashtag telefon udråbstegn tomorrow«

Men det er tungt at sige. I praksis er det nemmere bare at fange rå tekst og
afklare den bagefter i appen — det er hele pointen med en inbox.

---

## 3 · Genvej: »Hvad kan jeg lave nu«

**Handling 1 — Hent indhold fra URL**

| Felt | Værdi |
|---|---|
| URL | `https://DIN-ADRESSE/api/v1/next?format=text` |
| Metode | `GET` |
| Headers | `Authorization` = `Bearer doda_DIN-LÆSENØGLE` |

**Handling 2 — Vis resultat** (eller *Sig tekst*, hvis den skal læses højt).

`format=text` giver en færdig liste, du kan vise direkte:

```
• ring til lægen om prøvesvar  ·  #telefon  ·  2026-08-17 09:00
• køb kaffe og filtre  ·  #ærinder
• skriv oplæg til ledelsen  ·  #computer  ·  2026-08-21
```

Er der ingenting, står der `Nothing to do right now.`

### Kun én kontekst

Læg `&context=telefon` på adressen. Du kan bruge kontekstens **navn**, ikke kun
dens id. Findes konteksten ikke, svarer API'et med en liste over dem, der findes
— så kan genvejen vise dig, hvad du skrev forkert.

En god variant: lav genvejen med *Vælg fra menu* over dine faste kontekster.

---

## 4 · Referencen

Alle stier ligger under `/api/v1/`. Godkendelse er
`Authorization: Bearer doda_…` — eller headeren `X-API-Key`, hvis din klient
hellere vil det.

**Webgrænsefladen bruger nøjagtig samme API.** Der er ingen intern bagvej, så
alt hvad appen kan, kan du også udefra.

| Metode | Sti | Scope | Hvad |
|---|---|---|---|
| POST | `/api/v1/capture` | capture | Fang. `{"text":"…"}`, formulardata, ren tekst eller `?text=` |
| POST | `/api/v1/notes` | capture | Opret en note |
| GET | `/api/v1/next` | read | Næste handlinger. `?context=` `?format=text` `?limit=` |
| GET | `/api/v1/items` | read | `?status=inbox,next` `?project=` `?context=` `?hideDeferred=1` |
| GET | `/api/v1/items/:id` | read | Ét element |
| POST | `/api/v1/items/:id` | write | Ret felter |
| POST | `/api/v1/items/:id/complete` | write | Markér udført |
| POST | `/api/v1/items/:id/uncomplete` | write | Fortryd |
| DELETE | `/api/v1/items/:id` | write | Slet (blødt) |
| GET | `/api/v1/search?q=` | read | Fuldtekst, også i beskrivelser |
| GET | `/api/v1/changes?since=` | read | Kun det ændrede siden et tidspunkt |
| GET | `/api/v1/contexts` · `/projects` | read | Listerne |
| GET | `/api/v1/notes` | read | Noterne |

### Scopes

| Scope | Kan |
|---|---|
| `capture` | **Kun** oprette. Kan ikke læse noget. |
| `read` | Kun læse. |
| `full` | Alt af ovenstående. |

Adgangsnøgler kan **aldrig** lave nye nøgler eller skifte dit kodeord, uanset
scope. Det kræver en rigtig browser-session — ellers ville én lækket nøgle være
nok til at give sig selv varig adgang.

### Fejl

Svaret er altid samme form, så en genvej kan vise `message` direkte:

```json
{ "error": "wrong_scope",
  "message": "This key is \"capture\" and cannot read. Create a key with a wider scope." }
```

| Kode | Betyder |
|---|---|
| `invalid_key` | Nøglen findes ikke eller er tilbagekaldt |
| `wrong_scope` | Nøglen må ikke det her |
| `session_required` | Kræver browser-login, ikke en nøgle |
| `rate_limited` | Over 600 kald i timen med samme nøgle |
| `no_text` | Der var ingen tekst at fange |
| `unknown_context` | Beskeden lister de kontekster, der findes |

### Hold øje

**Settings → Access keys** viser hvornår hver nøgle sidst blev brugt.
*Revoke* virker med det samme — der er ingen cache af nøgler, så det næste kald
slår op i databasen og finder ingenting.

Mislykkede nøgleforsøg havner desuden i Yggdrasil-panelets sikkerhedshistorik
pr. IP.

---

## 5 · Hvis det ikke virker

| Symptom | Årsag |
|---|---|
| `invalid_key` | Mangler `Bearer ` foran nøglen, eller et mellemrum er kommet med i kopieringen |
| `wrong_scope` på læsning | Genvejen bruger fangst-nøglen. Lav en `read`-nøgle |
| `session_required` | Du rammer et endepunkt, en nøgle aldrig får lov til |
| Intet svar | Adressen er forkert — prøv `https://DIN-ADRESSE/api/v1/next` i Safari først (den skal give `not_signed_in`) |
| Virker hjemme, ikke ude | Du bruger den lokale IP. Brug dit domæne via Cloudflare-tunnelen |
