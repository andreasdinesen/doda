'use strict';
/* doda - skaermen "Guide": en samlet gennemgang af appen, bygget som tingdos
   egen /settings/guide/. Formen derfra, indholdet fra doda.

   Tingdos opbygning, som denne foelger: store DELE (»How it works«,
   kommandobaren, tastaturet), inde i dem GRUPPER med et lille versalt maerke
   (CAPTURE, ACT, ORGANISE ...), og inde i dem EMNER med en kort indledning,
   et par raekker med et maerke i venstre side, og af og til en »In short«.

   Fem regler for indholdet:

   1. Guiden ma ALDRIG love mere end koden kan. En hjaelpetekst er en
      kravspecifikation - det er derfor "/projekt" stod i paletten i fire
      versioner uden at virke (RUNE-ERFARINGER, doda v9). Alt herunder er
      skrevet ud fra app/shared/parse.js og skaermenes egen adfaerd.
   2. doda er ikke tingdo. Fokus TAGER ikke tid (der er ingen registrering),
      der er ingen "Scheduled"-liste, og gentagelser findes kun her. Skriv
      dodas virkelighed, ikke forlaeggets.
   3. Ingen tekst gentages, hvis den findes ét sted i forvejen: syntaksen
      kommer fra syntaksTabel(), genvejene fra GENVEJE - og en tast, der staar
      i tastatur-afsnittet, gentages ikke oppe i emnerne.
   4. ÉN paastand pr. raekke, én saetning pr. indledning. Teksten er det eneste
      i denne fil, der koster plads i install-scriptet: maalt med leave-one-out
      fylder guidens tekst 6.274 tegn og dens CSS 364. Hver begrundelse, der
      kan undvaeres, er derfor plads til en funktion senere.
   5. Hvert EMNE er en <h2>, saa sideoversigten i hoejre kant bygger sig selv
      (byggToc laeser netop h2 i #pageHost) - den er guidens indholdsfortegnelse
      og skulle ikke bygges. */

/*
 * Maerket i venstre side er enten en TAST eller MARKOER (monospace, ordret)
 * eller en TILSTAND (versal etiket, som chipsene i detaljeruden).
 *
 * Afgoerelsen skal traeffes paa teksten selv, ikke paa dens laengde: etiketten
 * er skrevet med versaler i kilden, og alt andet er noget, brugeren skal kunne
 * taste af. Med en laengderegel blev "!every monday" til en etiket - og
 * `text-transform: uppercase` gjorde den til "!EVERY MONDAY", altsaa en
 * syntaks, der ikke findes. Et maerke uden bogstaver ("+", "//", "~") er
 * altid en markoer.
 */
function guideMaerke(t) {
  const erEtiket = /[a-zA-Z]/.test(t) && t === t.toUpperCase();
  return erEtiket
    ? `<span class="guide-tag">${esc(t)}</span>`
    : `<code class="guide-key">${esc(t)}</code>`;
}

/*
 * Indledningen og knap-raekken har faste afstande: klasser, ikke 25 inline-styles.
 *
 * Et emne uden raekker faar intet kort - men skal stadig kunne have sin knap,
 * ellers forsvinder »Open Logbook«, i samme oejeblik raekken over den skaeres
 * vaek. En betingelse, der bortkaster to ting paa én gang, er en faelde.
 */
function guideEmne(e) {
  const krop = (e.raekker || []).map(([m, tekst]) => `<div class="guide-row">
        <div class="guide-badge">${guideMaerke(m)}</div>
        <div class="guide-text">${tekst}</div></div>`).join('')
    + (e.kort ? `<p class="guide-short"><strong>In short:</strong> ${e.kort}</p>` : '');
  const knapper = e.go ? guideGo(e.go) : '';
  return `<h2>${esc(e.titel)}</h2>
    <p class="lead guide-lead">${e.lead}</p>
    ${krop ? `<div class="card guide-card">${krop}${knapper}</div>` : knapper}`;
}

function guideGo(liste) {
  return `<div class="guide-go">${liste.map(([v, t]) =>
    `<button class="btn ghost" data-guide-go="${esc(v)}">${esc(t)}</button>`).join(' ')}</div>`;
}

/* ------------------------------------------------------------ indholdet */

const GUIDE_DELE = [
  {
    del: 'How doda works',
    lead: 'The method is Getting Things Done: one place you trust, so your head can stop keeping track.',
    grupper: [
      {
        gruppe: 'Capture',
        emner: [
          {
            titel: 'The inbox',
            lead: 'Capture first, decide later. A title is all it needs.',
            raekker: [
              ['any key', 'On any screen, start typing and the command bar opens with what you typed.'],
              ['+', 'A task, said explicitly. Plain text does the same.'],
              ['*', 'A note. It lands in Notes and never joins an action list.'],
              ['//', 'Everything after <code> // </code>, or after a line break, becomes the description.'],
              ['WHERE', 'The screen fills in what your text left out: on Waiting For or Someday it lands there, on a project page it joins that project, on a context-filtered list it carries that context. A chip says so before you press Enter, and anything you write yourself wins.'],
            ],
            kort: 'an empty inbox is the goal — not today, but over time.',
            go: [['inbox', 'Open Inbox']],
          },
          {
            titel: 'Emptying the inbox',
            lead: 'Open an item and ask one thing: is this actionable?',
            raekker: [
              ['YES', 'Give it a context and move it to Next Actions.'],
              ['NO', 'Then it is a Someday idea, a note, or nothing at all.'],
              ['REVIEW', 'The weekly review walks the inbox one item at a time.'],
            ],
          },
        ],
      },
      {
        gruppe: 'Act',
        emner: [
          {
            titel: 'Next Actions',
            lead: 'What you can do right now, grouped by context.',
            raekker: [
              ['#', 'The chips above the list narrow it to one context.'],
              ['~', '<code>~in 2 weeks</code> hides a task until then. Not late — just not yet.'],
              ['!', '<code>!friday</code> is a real deadline, and the only thing that reaches your calendar.'],
            ],
            go: [['next', 'Open Next Actions']],
          },
          {
            titel: 'What you can set on a task',
            lead: 'The fields are chips you press, and none of them are required.',
            raekker: [
              ['PROJECT', 'The outcome it belongs to.'],
              ['STATUS', 'Next Actions, Waiting For, Someday — or back to the inbox.'],
              ['DATE', 'A deadline, and separately a day to hide it until.'],
              ['#', 'Contexts. Typing <code>#name</code> in the title works here too.'],
              ['FOCUS', 'One task, everything else out of the way.'],
            ],
          },
        ],
      },
      {
        gruppe: 'Organise',
        emner: [
          {
            titel: 'Projects',
            lead: 'Any outcome that takes more than one step. Write <code>@Name</code> while capturing and it exists.',
            raekker: [
              ['DONE', 'A field for what done looks like — writing it is often where the next step appears.'],
              ['NEXT', 'A project with open work but no next action says so quietly.'],
              ['↑ ↓', 'Order tasks by hand. The buttons work with a thumb as well as a mouse.'],
              ['DROP', 'Dropping a project takes its open tasks with it; finished ones are never touched.'],
            ],
            go: [['projects', 'Open Projects']],
          },
          {
            titel: 'Areas',
            lead: 'A part of life you keep going. There is nothing to complete.',
            raekker: [
              [':', 'One level above projects: the half marathon ends, the health it serves does not.'],
              ['GROUP', 'Projects are grouped by area, so many projects still read as a few responsibilities.'],
            ],
            kort: 'a project is something you finish, an area is something you maintain.',
          },
          {
            titel: 'Contexts',
            lead: 'The situation you are in: <code>#calls</code>, <code>#computer</code>, <code>#errands</code>.',
            raekker: [
              ['#', 'Filter by situation, not by topic — topic is what projects are for.'],
              ['NEW', 'An unknown context is confirmed with one extra Enter, so a typo never becomes a list.'],
            ],
            kort: 'the project says why, the context says when.',
            go: [['contexts', 'Open Contexts']],
          },
        ],
      },
      {
        gruppe: 'Park and keep',
        emner: [
          {
            titel: 'Waiting For',
            lead: 'What you handed to someone else. You are waiting, not working.',
            raekker: [
              ['NAME', 'Put the person in the title, so the list reads as who owes you what.'],
              ['!', 'A follow-up date keeps the handoff in view.'],
            ],
          },
          {
            titel: 'Someday',
            lead: 'Parked without a commitment. Nothing here nags.',
            raekker: [
              ['s', 'Park it the moment you know it is not next.'],
              ['REVIEW', 'The weekly review is where this list is read again.'],
            ],
          },
          {
            titel: 'Notes',
            lead: 'Things you keep, not things you owe. Markdown, and never in an action list.',
            raekker: [
              ['*', 'Type <code>*</code> in the command bar to file one.'],
              ['SWAP', 'A note can become a task and go back again, losing nothing.'],
            ],
            go: [['notes', 'Open Notes']],
          },
          {
            titel: 'Recurring',
            lead: 'Todoist’s syntax, where a <code>!</code> right after <em>every</em> is the whole difference.',
            raekker: [
              ['!every monday', '<strong>Fixed schedule.</strong> It comes around on its date either way.'],
              ['!every! monday', '<strong>From completion.</strong> The next one appears when you finish this one.'],
              ['MORE', '<code>!every 3 days · !every mon, thu · !every weekday at 16 · !every month on the 3rd · !last workday of the month</code>'],
              ['SKIPS', 'An overdue schedule rolls forward and the skips are counted — that number is how you notice a habit is not working.'],
            ],
            kort: 'never more than one open occurrence, and it stays invisible until it is current.',
            go: [['repeat', 'Open Recurring']],
          },
        ],
      },
      {
        gruppe: 'Focus and review',
        emner: [
          {
            titel: 'Focus',
            lead: 'One task, everything else stepped back.',
            raekker: [
              ['TIMER', 'It starts itself and survives closing the app: what is kept is when you began.'],
              ['none', 'Nothing is recorded and nothing is reported.'],
              ['esc', 'Leave again. The task is unchanged.'],
            ],
          },
          {
            titel: 'The weekly review',
            lead: 'Six steps: inbox, projects, Waiting For, Someday, the skipped recurrences, the week.',
            raekker: [
              ['SPEED', 'Inbox and projects, nothing else.'],
              ['SIMPLE', 'Every list, one at a time.'],
              ['FOCUSED', 'Pick this week’s projects first, then go all the way through.'],
              ['PAUSE', 'Stop halfway and the step waits on the server — another device continues it.'],
            ],
            kort: 'pick a weekday and doda shows a quiet band that day. A band, not a push: the real deadlines already leave through your calendar.',
            go: [['review', 'Open Review']],
          },
          {
            titel: 'Logbook',
            lead: 'What you finished, day by day. No numbers, no graphs, no score — the point is overview, not measurement.',
            go: [['log', 'Open Logbook']],
          },
        ],
      },
    ],
  },
  {
    del: 'The command bar',
    lead: 'One field that finds, creates and navigates. Creating is always the top result, so searching never gets in the way of a thought.',
    grupper: [
      {
        gruppe: 'Using it',
        emner: [
          {
            titel: 'Open and close',
            lead: 'It opens by itself the moment you type, wherever you are.',
            raekker: [
              ['any key', 'Opens with the character you typed already in it.'],
              ['/', 'Opens it empty.'],
              ['esc', 'Closes it.'],
              ['⌫', 'On an empty field, leaves the mode you were in.'],
            ],
          },
          {
            titel: 'Modes',
            lead: 'The first character picks a mode, and the pill inside the field shows which.',
            raekker: [
              ['+', 'New task.'],
              ['*', 'New note.'],
              ['/', 'Projects — find, jump to, or create.'],
              ['#', 'Contexts — the same.'],
              [':', 'Areas — the same.'],
            ],
          },
          {
            titel: 'While you capture',
            lead: 'Markers can stand anywhere in the line, and the chips show how each was understood.',
            syntaks: true,
            kort: 'a marker has to touch its word (<code>#home</code>, not <code># home</code>) — that is what keeps <code>you@example.com</code> from becoming a project.',
          },
          {
            titel: 'Dates',
            lead: 'Both languages work, and a date doda cannot read never blocks the capture — the item is created anyway.',
            raekker: [
              ['!tomorrow', 'Also <code>!today</code>, <code>!friday</code>, <code>!next week</code>.'],
              ['!in 2 weeks', 'Days, weeks or months from today. <code>!om 2 uger</code> does the same.'],
              ['!in 3 hours', 'Hours and minutes set a <strong>time</strong> too, and roll over midnight. '
                + '<code>!om 3 timer</code>, <code>!om 30 minutter</code>.'],
              ['!3/9', '<code>!3/9-2027</code>, <code>!3 sep</code> and <code>!sep 3 at 9</code> all land.'],
              ['~', 'The same words, but for hiding a task until that day.'],
            ],
          },
          {
            titel: 'In a title you edit',
            lead: 'The markers keep working afterwards: they move into the fields when you leave the field.',
            raekker: [
              ['KEEP', 'Only what was understood is removed. “Remember !important” stays as you wrote it.'],
              ['NEW', 'A name that does not exist yet shows as “— new” and is created when you save.'],
              ['RULE', 'In a recurring task the rule is the one thing a title never touches.'],
            ],
          },
        ],
      },
    ],
  },
  {
    del: 'Keyboard',
    lead: 'The keys outside the command bar. Clarifying the inbox never needs the mouse.',
    grupper: [{
      gruppe: '',
      emner: [{
        titel: 'All the keys',
        lead: 'Press <code>?</code> anywhere to see this same list without leaving what you are doing.',
        genveje: true,
      }],
    }],
  },
  {
    del: 'Beyond the browser',
    lead: 'doda is one file on your own server, and everything it can do is reachable from outside it.',
    grupper: [
      {
        gruppe: 'Everyday',
        emner: [
          {
            titel: 'On your phone, and without a signal',
            lead: 'In Safari, <strong>Share → Add to Home Screen</strong>: full screen, own icon, no address bar.',
            raekker: [
              ['READ', 'Offline you can still read your lists as they were, and a mark says so.'],
              ['QUEUE', 'Capturing, ticking off, moving and deleting are queued and sent in order when there is a signal.'],
              ['https', 'Home screen and offline need https — a browser rule, not a choice.'],
            ],
          },
          {
            titel: 'Reminders',
            lead: 'They come through your calendar: Settings → Calendar subscription gives you an address it can follow.',
            raekker: [
              ['IPHONE', 'The subscription must have <em>Remove Alarms</em> switched <strong>off</strong>, or iOS strips the alarm silently.'],
              ['ONLY', 'The feed carries deadlines — never your whole list, and never your notes.'],
              ['PUSH', 'Web Push is there instead, under Notifications. On iPhone only once doda is on the home screen.'],
            ],
          },
          {
            titel: 'Files, links and Notion',
            lead: 'Drag files onto an open item, or press <strong>Add images or files</strong>.',
            raekker: [
              ['25 MB', 'The limit per file. Files live in the data folder, so the panel’s backup has them.'],
              ['SAFE', 'Only ordinary image formats are shown inline; everything else is a plain download.'],
              ['LINK', 'Connect Notion and you can search for a page from here, and unfold it. doda keeps no copy.'],
            ],
          },
        ],
      },
      {
        gruppe: 'For other clients',
        emner: [
          {
            titel: 'Keys, Siri and Claude',
            lead: 'The web interface uses the same <code>/api/v1/</code> API as everything else — there is no back door.',
            raekker: [
              ['SCOPE', 'Pick the narrowest key that solves the job: a capture key cannot read a single task.'],
              ['SIRI', 'The capture endpoint takes a plain line of text, so a Shortcut needs one field.'],
              ['MCP', 'Claude connects on <code>/mcp</code> with the same keys and scopes, and can be revoked under Connected apps.'],
            ],
          },
          {
            titel: 'Your data',
            lead: 'Settings → Your data. Everything is one open JSON file, and import matches on id, so the same file can run twice.',
            raekker: [
              ['SECRET', 'The calendar address is left out of an export — it is a file you might pass on.'],
              ['BACKUP', 'For a copy of everything, including the database, use the panel’s backup.'],
            ],
            go: [['settings', 'Open Settings']],
          },
        ],
      },
    ],
  },
];

function sideGuide() {
  return `<section class="page">
    <div class="page-head">
      <h1>Guide</h1>
      <p class="lead">${esc(BESKRIVELSER.guide)}</p>
    </div>
    ${GUIDE_DELE.map((d) => `
      <div class="guide-part">
        <div class="guide-part-name">${esc(d.del)}</div>
        <p class="lead" style="margin:0">${esc(d.lead)}</p>
      </div>
      ${d.grupper.map((g) => `
        ${g.gruppe ? `<div class="guide-group">${esc(g.gruppe)}</div>` : ''}
        ${g.emner.filter((e) => e.titel !== 'Notes' || state.notesEnabled).map((e) => {
    if (e.syntaks) {
      return `<h2>${esc(e.titel)}</h2><p class="lead guide-lead">${e.lead}</p>
        <div class="card">${syntaksTabel()}
          <p class="guide-short"><strong>In short:</strong> ${e.kort}</p></div>`;
    }
    if (e.genveje) {
      return `<h2>${esc(e.titel)}</h2><p class="lead guide-lead">${e.lead}</p>
        <div class="card">${GENVEJE.map(([gruppe, liste]) => `
          <div class="meta" style="margin:14px 0 8px">${esc(gruppe)}</div>
          <table class="shortcuts">${liste.map(([tast, hvad]) =>
    `<tr><td><kbd>${esc(tast)}</kbd></td><td>${esc(hvad)}</td></tr>`).join('')}</table>`).join('')}</div>`;
    }
    return guideEmne(e);
  }).join('')}`).join('')}`).join('')}
  </section>`;
}

function bindGuide() {
  document.querySelectorAll('[data-guide-go]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.guideGo));
  });
}
