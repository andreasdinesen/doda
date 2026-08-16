# Handover: lokal opgave- og noteapp

**Til:** Claude Code
**Fra:** Andreas
**Type:** Funktionsbeskrivelse. Alle tekniske valg — sprog, framework, database, API-udformning, filstruktur, deployment — er dine. Dette dokument beskriver *hvad* appen skal kunne og hvorfor, ikke hvordan.

---

## 1. Formål

En personlig opgave- og noteapp bygget på GTD-metoden (Getting Things Done), som kører på min egen server derhjemme. Den er inspireret af tingdo.app, men skal have to ting den ikke har: **gentagende opgaver** og **et API**, så jeg kan oprette og læse opgaver fra iOS Shortcuts, Siri og andre systemer.

Én bruger (mig). Ingen deling, ingen teams, ingen brugeroprettelse.

---

## 2. Rammer

- Skal kunne køre på min egen hjemmeserver i en container, uden eksterne tjenester som forudsætning.
- Skal kunne bruges fra iPhone (browser og hjemmeskærm) og fra desktop-browser.
- Data skal kunne tages ud igen i et åbent format. Ingen indelåsning.
- Skal kunne læses uden netværk, når først den har været åbnet. Skrivning må gerne kræve forbindelse i første omgang.
- Alle mine data skal kunne sikkerhedskopieres og gendannes af mig selv.

---

## 3. Bærende principper

Disse principper vejer tungere end funktionslisten. Når noget er i tvivl, så afgør efter dem:

1. **Ro frem for pres.** Ingen røde badges, ingen "du er bagud"-tællere, ingen guilt-mekanik. Appen må aldrig råbe ad mig.
2. **Fangst skal være øjeblikkelig.** Fra jeg får en tanke til den er gemt må der gå ét trin. Alt andet må gerne tage tid.
3. **Næste handling er hovedsagen.** Den vigtigste skærm er "hvad kan jeg gøre lige nu", ikke en kalender eller et dashboard.
4. **Deadlines er sjældne.** Kun ting med en reel, ekstern konsekvens får en dato. Appen skal aktivt modarbejde at jeg sætter datoer på alt.
5. **Ingen prioritetsfelter.** Ingen P1/P2/P3, ingen stjerner, ingen "vigtig"-flag. Rækkefølge og kontekst er nok.
6. **Færre valg.** Hver gang der kan tilføjes et felt, så lad være, medmindre det er beskrevet her.
7. **Tastaturet først på desktop, tommelfingeren først på mobil.**

---

## 4. Begreber

**Element** — grundenheden. Et element er enten en **opgave** eller en **note**. De lever side om side i samme projekt, men noter dukker aldrig op i handlingslister. En note er ren reference: mødereferat, kontonummer, link, tanke.

**Projekt** — noget der kræver mere end én handling for at være færdigt. Har et navn og gerne en beskrivelse af hvordan "færdigt" ser ud. Kan have underprojekter.

**Område** (area of focus) — en løbende ansvarlighed uden slutpunkt: Arbejde, Hjem, Økonomi, Sundhed. Projekter hører til et område. Områder bliver aldrig "færdige".

**Kontekst** — hvor eller hvordan en opgave kan udføres: #computer, #telefon, #ærinder, #hjem, #ude. En opgave kan have flere. Kontekster er det primære filter på næste-handlings-listen.

**Statusser for en opgave:**

| Status | Betydning |
|---|---|
| Inbox | Fanget, endnu ikke afklaret |
| Næste | Kan udføres nu, dukker op i handlingslister |
| Kø | Besluttet, men ikke det næste skridt i projektet endnu |
| Venter på | Uddelegeret, jeg venter på en anden. Skal kunne notere hvem |
| Engang måske | Parkeret uden forpligtelse |
| Udført | Færdig, med tidspunkt |
| Droppet | Fravalgt, med tidspunkt. Skal ikke slettes |

En opgave uden projekt er lovlig — ikke alt hører til et projekt.

---

## 5. Funktioner

### 5.1 Fangst (capture)

- Ét inputfelt der altid er tilgængeligt, uanset hvilken skærm jeg er på. En enkelt tast åbner det på desktop.
- Skriver jeg bare tekst og trykker retur, ryger det i Inbox som en opgave. Ikke flere trin.
- Genvejssyntaks i selve teksten, så jeg kan springe formularer over:
  - `+ tekst` — opret opgave (også standardadfærd uden præfiks)
  - `* tekst` — opret note
  - `#kontekst` — tilføj kontekst, opret den hvis den ikke findes (skal bekræftes)
  - `@projekt` — læg i projekt
  - `!dato` — sæt deadline. Skal forstå dansk naturligt sprog: `!i morgen`, `!fredag`, `!3/9`, `!om 2 uger`
  - `~dato` — skjul indtil denne dato
- Samme inputfelt skal også kunne søge. Skriver jeg tekst uden præfiks og der findes matches, vises de som forslag *ved siden af* muligheden for at oprette. Oprettelse må aldrig blive svær, fordi søgning er i vejen.
- Fangst skal virke offline. Er der ikke forbindelse, gemmes lokalt og sendes når der er.

### 5.2 Inbox og afklaring

- Inbox er en liste af ufordøjede elementer, ældste først.
- For hvert element skal jeg hurtigt kunne: sætte status, tilknytte projekt, sætte kontekster, gøre det til et projekt i stedet, konvertere mellem opgave og note, eller slette.
- Afklaring skal kunne gennemføres udelukkende med tastaturet på desktop, ét element ad gangen.
- Inbox viser et antal, men uden alarmerende farve. Tom inbox skal føles som en belønning — vis noget roligt og bekræftende, ikke tomhed.

### 5.3 Næste handlinger

- Hovedskærmen. Viser alle opgaver med status "Næste", grupperet efter kontekst.
- Skal kunne filtreres til én kontekst med ét klik/tastetryk.
- Opgaver med "skjul indtil"-dato i fremtiden vises ikke.
- Opgaver kan markeres udført direkte fra listen, uden at åbne dem.
- Skal vise hvilket projekt en opgave hører til, uden at fylde.
- **Fokustilstand:** vælg én opgave, skjul alt andet, start en valgfri timer der bliver ved med at tælle selvom jeg skifter skærm. Ingen tvungen tidsregistrering.

### 5.4 Projekter

- Liste over aktive projekter, grupperet efter område.
- Projektvisning viser projektets opgaver *og* noter sammen, adskilt visuelt.
- Et projekt skal markere tydeligt hvis det ikke har nogen næste handling — det er den klassiske GTD-fejl og skal være synlig, men uden skældud.
- Projekter kan sættes på "Engang måske" samlet, uden at deres opgaver forsvinder.
- Rækkefølgen af opgaver i et projekt skal kunne ændres manuelt.

### 5.5 Noter

- Noter skrives i Markdown og vises formateret.
- En note hører typisk til et projekt eller et område, men kan stå alene.
- Noter er søgbare på fuldtekst.
- En note skal kunne konverteres til en opgave og omvendt, uden at miste indhold.
- Billeder er ikke påkrævet i første udgave. Hvis de kommer, skal de gemmes lokalt på serveren.

### 5.6 Gentagende opgaver

Dette er den vigtigste tilføjelse i forhold til forbilledet, og den skal designes forsigtigt — hele pointen med appen er at den ikke skaber ophobning og dårlig samvittighed.

**Kernekrav:**

- En opgave kan gøres gentagende med en regel. Reglen skal kunne udtrykke almindelige mønstre: hver dag, hver uge på bestemte ugedage, hver N. uge, månedligt på en bestemt dato, månedligt på fx "sidste hverdag", årligt.
- Gentagelsen skal kunne fortsætte fra en skabelon: titel, projekt, kontekster og eventuel note går igen hver gang.
- **To tilstande, og valget skal være tydeligt for brugeren:**
  - **Efter fuldførelse** (standard) — næste forekomst opstår først når jeg har markeret den forrige udført, talt fra fuldførelsesdatoen. Egnet til "vand planterne", "skift filter". Kan aldrig hobe sig op.
  - **Fast plan** — næste forekomst opstår på sin dato, uanset om den forrige blev lavet. Egnet til regninger og faste aftaler.
- **Kun én åben forekomst ad gangen.** Der må aldrig ligge tolv fremtidige kopier af den samme opgave i systemet.
- **En gentagen opgave er usynlig indtil den er aktuel.** "Støvsug hver søndag" må ikke stå i min næste-handlings-liste mandag til lørdag.
- Gentagelser skal kunne sættes på pause og genoptages, uden at reglen mistes.
- Springer jeg en forekomst over, skal det registreres — ikke som en fejl, men som information til den ugentlige gennemgang.
- Ændrer jeg titel eller projekt på en forekomst, skal jeg kunne vælge om ændringen gælder kun denne gang eller alle fremtidige.
- Datoer skal opføres sig korrekt hen over sommertidsskift og i dansk tidszone. "Hver mandag kl. 8" må ikke drive.

**Skærm:** en oversigt over alle mine gentagelser, hvornår de næste gang forfalder, og hvor mange gange de er sprunget over. Denne oversigt er stedet hvor jeg opdager at en vane ikke virker.

### 5.7 Ugentlig gennemgang

- En guidet gennemgang jeg kan starte når som helst, med tydelig fremdrift gennem trinnene:
  1. Tøm inbox
  2. Gennemgå aktive projekter — har hvert projekt en næste handling?
  3. Gennemgå "Venter på" — er der noget jeg skal rykke for?
  4. Gennemgå "Engang måske" — er noget blevet aktuelt?
  5. Gennemgå gentagelser der springes over gang på gang
  6. Se ugens logbog
- Gennemgangen skal kunne afbrydes og genoptages senere fra samme sted.
- Appen skal kunne minde mig om gennemgangen på en aftalt ugedag, diskret.
- Hvert projekt husker hvornår det sidst blev gennemgået.

### 5.8 Logbog

- Kronologisk liste over hvad jeg har udført, med dato.
- Kan filtreres på projekt og område.
- Formålet er tilfredsstillelse og overblik ved den ugentlige gennemgang — ikke statistik og grafer. Hold det simpelt.

### 5.9 Søgning

- Fuldtekst på tværs af opgaver, noter, projekter.
- Skal også kunne finde udførte og droppede elementer, men de vises adskilt fra de aktive.

### 5.10 API for eksterne klienter

Formålet er at jeg kan bygge iOS Shortcuts, tale til Siri, og lade Home Assistant oprette opgaver. **Webgrænsefladen skal bruge samme API som eksterne klienter** — ingen særskilt intern bagvej.

**Hvad jeg skal kunne udefra:**

- **Oprette en opgave i inbox** med minimalt input. Kun en titel skal være påkrævet. Sender jeg mere med — note, kontekster, projekt, deadline — skal det respekteres.
- Samme genvejssyntaks som inputfeltet (`#kontekst`, `@projekt`, `!dato`) skal virke i den fremsendte tekst. Så kan en genvej på telefonen nøjes med ét tekstfelt.
- **Hente næste handlinger**, valgfrit filtreret på kontekst, i et format der er let at vise i en genvej.
- **Markere en opgave udført.**
- **Hente og oprette noter.**
- **Hente ændringer siden et tidspunkt**, så en klient kan holde sig opdateret uden at hente alt.

**Adgang:**

- Adgangsnøgler oprettes og tilbagekaldes fra appens indstillinger. Én nøgle pr. enhed eller formål, så jeg kan spærre en enkelt uden at røre de andre.
- En nøgle skal kunne begrænses til kun at oprette, uden læseadgang. En mistet telefon skal ikke kunne læse hele mit system.
- Jeg skal kunne se hvornår hver nøgle sidst blev brugt.
- Nøglen vises kun én gang ved oprettelse.

**Robusthed:** API'et skal være tilgivende over for sjusket input. En genvej der kun sender en tekststreng skal virke. Fejl skal svare med noget, en genvej kan vise mig.

**Dokumentation:** Aflever en kort brugsanvisning til hvordan jeg opsætter genvejene på iPhone — mindst "fang en opgave" og "hvad kan jeg lave nu" — med de konkrete værdier jeg skal indtaste.

### 5.11 Kalenderfeed

- En abonnerbar kalenderfeed med mine faktiske deadlines, som Apple Kalender kan følge. Adgang via en hemmelig, tilbagekaldelig adresse.
- Kun ting med reelle deadlines. Ikke hele opgavelisten.

### 5.12 Notifikationer

- Så få som overhovedet muligt. Standard er ingen.
- Kun to ting må notificere: ægte deadlines, og påmindelsen om ugentlig gennemgang.
- Skal kunne slås helt fra.

### 5.13 Data ind og ud

- Fuld eksport af alt i et åbent, læsbart format.
- Import af samme format tilbage.
- Import fra en tingdo-eksport, hvis formatet er tilgængeligt. Lav det som et separat, valgfrit trin — ikke en forudsætning for at appen virker.
- Automatisk sikkerhedskopiering på et fast tidspunkt, og en dokumenteret måde at gendanne på. Beskriv gendannelsen i README og verificér at den virker.

### 5.14 Indstillinger

- Områder, kontekster og projekter administreres her.
- Ugedag for gennemgangspåmindelse.
- Adgangsnøgler.
- Eksport/import.
- Lyst/mørkt tema.

---

## 6. Skærme og navigation

Mindst disse visninger, tilgængelige fra ét sted:

- **Næste** (startskærm) — handlinger efter kontekst
- **Inbox**
- **Projekter** — grupperet efter område
- **Venter på**
- **Engang måske**
- **Gentagelser**
- **Logbog**
- **Gennemgang**
- **Søgning**
- **Indstillinger**

På mobil: de fire-fem vigtigste i bunden, resten i en menu. Fangst skal kunne nås fra alle skærme med ét tryk.

---

## 7. Tastaturbetjening (desktop)

Hele afklaringen af inbox og markering af opgaver skal kunne foregå uden mus. Vælg selv tasterne, men mindst disse handlinger skal have en genvej: åbn fangst, søg, næste/forrige element, markér udført, sæt kontekst, sæt projekt, skift status, åbn element, luk/tilbage. Vis en oversigt over genvejene med `?`.

---

## 8. Acceptkriterier

Appen er færdig nok til daglig brug når:

1. Jeg kan fange en tanke på under tre sekunder fra appen er åben, og under ti sekunder fra en låst iPhone via Siri.
2. Næste-handlings-listen viser kun ting jeg reelt kan gøre nu — intet der er skjult til senere, intet der hører til et inaktivt projekt.
3. En gentagende opgave med "efter fuldførelse" opstår aldrig igen før jeg har lavet den forrige, og fylder aldrig i listen før sin dato.
4. Jeg kan tilbagekalde en adgangsnøgle, og den holder op med at virke med det samme.
5. Jeg kan åbne appen uden netværk og se mine lister.
6. Jeg kan eksportere alt, slette databasen, importere igen og have det samme system tilbage.
7. Ingen skærm i appen viser en rød tæller eller fortæller mig at jeg er bagud.

---

## 9. Rækkefølge

Byg i denne rækkefølge — jeg vil have noget brugbart tidligt, ikke noget komplet sent:

1. **Fundament + fangst + inbox + næste handlinger.** Ren webgrænseflade, kræver netværk. Kan bruges.
2. **API + iOS Shortcuts.** Så snart dette står, bruger jeg det dagligt. Prioritér det højt, også selvom UI'et stadig er råt.
3. **Projekter, områder, kontekster, noter.**
4. **Gentagende opgaver.**
5. **Offline-læsning og installation på hjemmeskærm.**
6. **Ugentlig gennemgang, logbog, Venter på, Engang måske.**
7. **Kalenderfeed, eksport/import, backup, tingdo-import.**

Lever hver fase som noget der virker og kan tages i brug. Spørg hellere end at gætte på tværs af faser.

---

## 10. Uden for scope

Byg ikke dette, heller ikke hvis det virker oplagt:

- Flere brugere, deling, kommentarer, tildeling
- Prioritetsniveauer, stjerner, farvekoder som statusbærer
- Underopgaver i flere niveauer (projekter og underprojekter er nok)
- Kanban-tavler, Gantt, kalendervisning som redigeringsflade
- Statistik, produktivitetsscore, streaks, gamification
- Tovejs-synkronisering med tredjepartstjenester
- AI-funktioner i første omgang
- Notifikationer ud over de to nævnte

---

## 11. Åbne spørgsmål

Træf et fornuftigt valg og skriv hvad du valgte, eller spørg mig hvis det får konsekvenser:

- Hvor meget dansk naturligt sprog skal datofortolkningen kunne? Foreslå et minimum og udvid senere.
- Skal en note kunne høre til flere projekter, eller kun ét? Jeg hælder til ét, for enkelhedens skyld.
- Hvordan skal en gentagen opgave opføre sig, hvis jeg markerer den udført to gange samme dag ved et uheld?
- Hvad skal ske med et projekts opgaver, når projektet droppes?

---

## 12. Til udvikleren

Alle tekniske beslutninger er dine: sprog, database, framework, API-form, mappestruktur, testtilgang, containeropsætning. Vælg det kedeligste der virker, og som én person kan vedligeholde om to år. Skriv en README der forklarer hvordan jeg kører den, opdaterer den, tager backup og gendanner.

Hvis noget i dette dokument er i konflikt med principperne i afsnit 3, så vinder principperne — og sig til, så retter jeg beskrivelsen.
