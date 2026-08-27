# doda i Raycast — uden MCP

Fem små bash-scripts. Ingen udvidelse at installere, intet npm, ingen build —
og de virker uden Raycast Pro.

| Kommando | Hvad |
|---|---|
| **Capture to doda** | Fang en opgave. Samme syntaks som i appen: `#kontekst`, `@projekt`, `!dato`, `~udskyd`, `: område`, `!every monday`. |
| **Next Actions** | Det, du kan gøre nu. Skriv en kontekst for kun at se den. |
| **doda Inbox** | Det, du har fanget og endnu ikke afklaret. |
| **Search doda** | Find en opgave eller note. |

## Sådan

1. Lav en nøgle i doda: **Settings → Access keys**. `capture` rækker til at
   fange; `read` for at kunne se listerne; `full` for begge.
2. Kør opsætningen i en terminal — **én gang:**

   ```bash
   ./doda-setup.sh
   ```

   Den spørger om adresse og nøgle, prøver forbindelsen, og gemmer dem i macOS'
   **nøglering**. Nøglen er **synlig, mens du taster** — den er lang, og du skal
   kunne se, at den kom hel med. Bagefter rydder scriptet linjen og viser kun
   `doda_ATbK…bAZg`, så den ikke bliver stående i terminalens historik.
3. Åbn Raycast Settings med **⌘,** og find **Script Commands** i listen til
   venstre (langt nede, under de indbyggede udvidelser).
4. Øverst står **Script Folders** med et **+** ude til højre. Tryk på det, og
   vælg denne mappe:

   ```
   ~/ClaudeMacBook/doda/extras/raycast
   ```

   I filvælgeren kan du trykke **⇧⌘G** og indsætte stien direkte.

Så skifter »No folders configured« til mappen, og de fire kommandoer står
nedenunder. Derfra kan du give dem alias eller genvejstast i samme vindue.

> **Ikke** *Create Script Command* og **ikke** *Create Extension*. Den første
> skriver en tom skabelon, du selv skal fylde ud; den anden laver en
> TypeScript-udvidelse med npm og en build. Vi skal bare have Raycast til at
> **finde** scripts, der allerede ligger der — og det er `+` ved *Script
> Folders*, intet andet.

Metadataene står i toppen af hver fil (titel, mode, ikon, argumenter), så
Raycast læser dem selv. Retter du dem, opdager Raycast det uden genstart.

## Hvorfor nøgleringen og ikke en fil

Kommandoerne ligger i en mappe, man deler, synkroniserer og sikkerhedskopierer.
En nøgle med `full`-scope hører ikke til dér i klar tekst. `doda-setup.sh`
lægger den i nøgleringen; scriptene henter den ved kørsel med
`security find-generic-password`.

Skal du fjerne den igen:

```bash
security delete-generic-password -s doda-raycast-key
```

## Noter

- **`_doda.sh` er ikke en kommando.** Den har med vilje intet `@raycast`-hoved,
  så Raycast ikke viser den — den er den fælles del.
- **Fejl vises, som doda formulerer dem.** Skriver du en kontekst, der ikke
  findes, svarer den med hvilke der er. Det er `--fail-with-body`; uden den
  ville en udløbet nøgle give en tom boks.
- **Æøå og tegn som `"` og `&` overlever.** Teksten sendes procent-kodet, byte
  for byte.
- **Har du Raycast Pro**, kan du i stedet tilføje doda som MCP-server og få alle
  elleve værktøjer, inklusive fuldførelse og projekter. Se
  [docs/MCP.md](../../docs/MCP.md) §4b. De to udelukker ikke hinanden.
