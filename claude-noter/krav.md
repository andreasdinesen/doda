# doda — kravene (Andreas' oprindelige funktionsbeskrivelse)

> Kondenseret udgave af kravbeskrivelsen, som hele kravet blev bygget efter (v1–v4).
> **Afsnitsnumrene er de oprindelige**, så kodekommentarer som »handover §5.10« og
> »handover princip 1« peger herind. Afgørelserne på beskrivelsens åbne spørgsmål
> (§11) står i `DESIGN.md §6`. Alt efter v4 er kommet som Andreas' ønsker, ét ad gangen —
> begrundelserne står i `DESIGN.md` og README's versionshistorik.

## §1–2 · Formål og rammer

Personlig GTD-app på Andreas' egen server, efter tingdo.app, men med **gentagende
opgaver** og **et API** (iOS-genveje, Siri, Home Assistant). Én bruger. Kører i en
container uden eksterne tjenester som forudsætning; iPhone (browser + hjemmeskærm) og
desktop. Data skal kunne tages ud i et åbent format, læses uden net og
sikkerhedskopieres og gendannes af Andreas selv.

## §3 · Bærende principper — vejer tungere end funktionslisten

1. **Ro frem for pres.** Ingen røde badges, ingen »du er bagud«-tællere, ingen
   guilt-mekanik. Appen må aldrig råbe.
2. **Fangst skal være øjeblikkelig** — ét trin fra tanke til gemt.
3. **Næste handling er hovedsagen**, ikke en kalender eller et dashboard.
4. **Deadlines er sjældne.** Kun reel ekstern konsekvens får en dato; appen skal
   modarbejde datoer på alt.
5. **Ingen prioritetsfelter.** (Undtagelse siden v54: ét `starred`-flag — `DESIGN.md §7`.)
6. **Færre valg.** Tilføj ikke et felt, medmindre det er beskrevet.
7. **Tastaturet først på desktop, tommelfingeren først på mobil.**

Er noget i konflikt med principperne, vinder principperne.

## §4 · Begreber

- **Element** = opgave eller note. Noter dukker aldrig op i handlingslister.
- **Projekt** (kan have underprojekter, »færdigt ser sådan ud«), **område** (løbende
  ansvar uden slutpunkt), **kontekst** (hvor/hvordan; flere pr. opgave; det primære filter).
- Statusser: Inbox · Næste · Kø · Venter på (med *hvem*) · Engang måske · Udført
  (med tidspunkt) · Droppet (med tidspunkt, **slettes ikke**). En opgave uden projekt er lovlig.

## §5 · Funktioner (kernekravene)

- **§5.1 Fangst:** ét felt, altid tilgængeligt, én tast på desktop. Tekst + Enter →
  Inbox. Genvejssyntaks i teksten (nye kontekster/projekter skal bekræftes). Samme felt
  søger, men **oprettelse må aldrig blive svær, fordi søgning er i vejen**. Virker offline.
- **§5.2 Inbox:** ældste først; afklaring kun med tastatur, ét element ad gangen. Antal
  uden alarmfarve; tom inbox er rolig og bekræftende.
- **§5.3 Næste:** hovedskærmen, grupperet efter kontekst, ét-tast-filter; skjult-indtil
  vises ikke; fuldfør fra listen. **Fokus:** én opgave, timer der tæller videre på tværs af
  skærme, ingen tvungen tidsregistrering.
- **§5.4 Projekter:** grupperet efter område; opgaver OG noter adskilt; et projekt uden
  næste handling markeres tydeligt **uden skældud**; manuel rækkefølge.
- **§5.5 Noter:** markdown, fuldtekst, konvertering note ⇄ opgave uden tab.
- **§5.6 Gentagelser** (den vigtigste tilføjelse — må aldrig skabe ophobning): skabelon;
  to tydelige tilstande (efter fuldførelse / fast plan); **kun én åben forekomst**;
  **usynlig indtil aktuel**; pause uden tab af reglen; spring over registreres som
  information; »kun denne gang« vs. »alle fremtidige«; korrekt hen over sommertid i dansk
  tidszone. Skærm med næste forfald og antal spring.
- **§5.7 Gennemgang:** seks trin (inbox, projekter, venter på, engang måske, gentagelser,
  der springes over, ugens logbog); kan afbrydes og genoptages; diskret påmindelse på
  valgt ugedag; projekter husker sidste gennemgang.
- **§5.8 Logbog:** kronologisk, filter på projekt/område — **ingen statistik eller grafer**.
- **§5.9 Søgning:** fuldtekst; udførte/droppede vises adskilt.
- **§5.10 API:** **webgrænsefladen bruger samme API som eksterne klienter** — ingen
  bagvej. Opret med kun en titel (samme genvejssyntaks i teksten), hent næste (valgfrit pr.
  kontekst), fuldfør, noter, ændringer siden et tidspunkt. Nøgler pr. enhed, kan begrænses
  til **kun oprettelse** (en mistet telefon må ikke kunne læse systemet), sidst brugt,
  vises én gang. **Tilgivende over for sjusket input** — en genvej, der kun sender en
  tekststreng, skal virke, og fejl skal kunne vises af en genvej.
- **§5.11 Kalenderfeed:** kun reelle deadlines, hemmelig og tilbagekaldelig adresse.
- **§5.12 Notifikationer:** så få som muligt, standard ingen. Kun ægte deadlines og
  gennemgangspåmindelsen. Kan slås helt fra.
- **§5.13 Data:** fuld eksport/import i åbent format; dokumenteret og verificeret gendannelse.
- **§5.14 Indstillinger:** gennemgangsdag, nøgler, eksport/import, tema.

## §6–7 · Skærme og tastatur

Næste (start), Inbox, Projekter, Venter på, Engang måske, Gentagelser, Logbog,
Gennemgang, Søgning, Indstillinger. **Mobil:** de fire-fem vigtigste i bunden, resten i
en menu; fangst nås fra alle skærme med ét tryk. **Desktop:** afklaring og afkrydsning
uden mus — mindst fangst, søg, næste/forrige, udført, kontekst, projekt, status, åbn,
tilbage — og en genvejsoversigt på `?`.

## §8 · Acceptkriterier

1. Fangst < 3 sek. i appen, < 10 sek. fra en låst iPhone via Siri.
2. Næste viser kun det, der reelt kan gøres nu.
3. »Efter fuldførelse« opstår aldrig før den forrige er lavet og fylder aldrig før sin dato.
4. En tilbagekaldt nøgle holder op med at virke med det samme.
5. Appen kan åbnes uden net og vise listerne.
6. Eksportér alt → slet databasen → importér → samme system (`tests/roundtrip.test.mjs`).
7. Ingen skærm viser en rød tæller eller siger, at man er bagud.

## §10 · Uden for scope

Flere brugere/deling/tildeling · prioritetsniveauer, stjerner, farvekoder som status ·
underopgaver i flere niveauer · kanban, Gantt, kalender som redigeringsflade · statistik,
scores, streaks, gamification · tovejs-synk med tredjepart · notifikationer ud over de to.
(Afvigelser er besluttet i `DESIGN.md §7`: ét stjerneflag; enkeltbruger står fast.)

## Bevidste afvigelser fra beskrivelsen

- **§5.14:** områder, kontekster og projekter har egne skærme (Contexts, Projects →
  Manage areas) frem for at ligge i Indstillinger — man arbejder i dem.
- **§5.6:** »efter fuldførelse« er IKKE standard — Todoist-syntaksen afgør tilstanden
  (`DESIGN.md §3`); preview-chippen skriver altid tilstanden ud.
- **§5.12:** gennemgangspåmindelsen er et bånd i appen; push for den findes siden v53, men
  er slukket, indtil man selv tænder den (`DESIGN.md §2`).
- **§5.13:** tingdo-import er ikke bygget (formatet er ukendt); der er Todoist-import i stedet.
