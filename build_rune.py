#!/usr/bin/env python3
"""Bygger runes/doda.yaml ud fra kilderne i app/.

    python3 build_rune.py

Trin:
  1. Saml app/parts/p*.js -> app/public/app.js og koer `node --check`.
  2. Stempl ?v=<APP_VERSION> ind i index.html (Cloudflare edge-cacher .js/.css
     i timevis og ignorerer no-cache - se RUNE-ERFARINGER §5).
  3. Pak app-filerne som tar, komprimer med brotli, kod med base85.
  4. Verificer rundturen med PRAECIS den dekoder, der udgives.
  5. Skriv og valider runens YAML.

runes/doda.yaml og app/public/app.js er GENEREREDE artefakter.
"""

import base64
import io
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import textwrap

import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'app')
PARTS = os.path.join(APP, 'parts')
PUBLIC = os.path.join(APP, 'public')
SHARED = os.path.join(APP, 'shared')
OUT = os.path.join(ROOT, 'runes', 'doda.yaml')

# Install-scriptet koeres som ET sh -c-argument -> Linux' MAX_ARG_STRLEN (131072 b)
# er loftet. Margin, saa en voksende frontend ikke rammer vaeggen uvarslet.
#
# Haevet fra 120.000 til 126.000 i v7. Margenen skal kun daekke panelets
# {{VARIABEL}}-udskiftninger, og de er faa og korte ({{NODE_IMAGE}} bliver til
# node:24-alpine) - ikke noget, der kan aede 5.000 tegn. 120.000 var et rundt
# tal, ikke en maaling.
#
# Det er IKKE en loesning paa pladsen, kun en udsaettelse: der er plads til en
# funktion eller to. Naar den her fejler igen, skal noget UD af payloaden -
# se PLAN.md for de maalte muligheder.
MAX_INSTALL = 126_000

# ------------------------------------------------ hvor app-koden kommer fra
#
# Indtil 2026-08-21 BAR install-scriptet hele appen som brotli+base85. Med F8
# (Sagu-broen) naaede den 122.701 af 126.000 tegn - 97 % - og der var stadig
# tre flader tilbage at bygge. Udvejen er den, Sagu maalte og tog samme dag:
# et install-script, der HENTER app-koden i stedet for at baere den, er
# konstant stort, uanset hvor stor appen bliver.
#
# **doda-repoet er OFFENTLIGT** (Andreas, 2026-08-21), praecis som Sagus. Det
# fjernede den ene ting, der var dyrere her end der: et `GITHUB_TOKEN` i en
# `secret: true`-variabel, som panelet skulle templatere ind i scriptet.
#
# Den er vaek nu, og det er ikke bare mindre at fumle med. **En indstilling,
# der ikke laengere goer noget, ligner en spaerring uden at vaere en** - og
# den, der en dag ikke kan installere runen, ville lede efter fejlen i et
# tomt token-felt i stedet for i det, der faktisk er galt.
#
# GitHub svarer stadig **404, ikke 403**, naar en adresse ikke findes -
# typisk fordi taggen ikke er pushet. Fejlbeskeden siger det.
#
# Payloaden bygges STADIG: rundturs-tjekket beviser, at kilderne kan pakkes og
# pakkes ud igen, og tallet staar i loggen. `HENT_FRA_GITHUB = False` giver
# den indlejrede rune tilbage - den eneste vej, der virker uden net.
HENT_FRA_GITHUB = True
GITHUB_EJER = 'andreasdinesen'
GITHUB_REPO = 'doda'

# ------------------------------------------------ runens version vs. appens
#
# Indtil v81 var de ét tal. Runen bar ikke koden - den hentede den fra en tag
# - men taggen stod i install-scriptet, saa en ny app-udgave KRAEVEDE en ny
# rune. Andreas skulle derfor gennem panelets to trin (Reload rune, saa
# Update) ved hver eneste udgivelse, for at flytte ét tal i en YAML.
#
# Fra v82 henter `app/kilde.js` koden ved hver opstart, og **en genstart ER
# opdateringen**. Runen er blevet en startsnor: den skal kun udgives, naar
# selve runen aendrer sig (variabler, startup, porte, watchers).
#
# Derfor to tal:
#   APP_VERSION (i app/parts/p1_core.js) - koden. Bumpes ved hver udgivelse.
#   RUNE_VERSION (her)                   - runen. Bumpes KUN naar YAML'en
#                                          herunder aendrer sig.
#
# RUNE_VERSION er ogsaa den tag, install-scriptet henter foerste gang. Den
# behoever ikke vaere den nyeste: foerste opstart henter alligevel det, der
# staar i KODE_VERSION. Den skal bare vaere en udgave, der KAN starte.
RUNE_VERSION = 84


def tarball_url(version):
    """Runens version N hoerer sammen med taggen vN - ikke med en gren.

    Peger scriptet paa en gren, installerer en gammel rune det, grenen
    tilfaeldigvis indeholder i dag. Prisen er ét trin mere ved udgivelse:
    `git tag vN && git push --tags`.
    """
    return (f'https://codeload.github.com/{GITHUB_EJER}/{GITHUB_REPO}'
            f'/tar.gz/refs/tags/v{version}')
MAX_YAML = 512 * 1024

HEREDOC = 'YGG_PAYLOAD_EOF'
FORBUDT_MOENSTER = re.compile(r'\{\{[A-Z_]{2,}\}\}')

# base85 uden { } og \ - saa kan payloaden aldrig ligne panelets
# {{VARIABEL}}-skabeloner (RUNE-ERFARINGER §2).
ALFABET = [c for c in range(33, 127) if c not in (123, 125, 92)][:85]


def fejl(besked):
    print(f'FEJL: {besked}', file=sys.stderr)
    sys.exit(1)


def node(*args, stdin=None):
    res = subprocess.run(['node', *args], input=stdin, capture_output=True)
    if res.returncode != 0:
        fejl(f'node fejlede: {res.stderr.decode("utf8", "replace")[:2000]}')
    return res.stdout


# ----------------------------------------------------------------- 1. frontend

def saml_frontend():
    navne = sorted(f for f in os.listdir(PARTS) if f.endswith('.js'))
    if not navne:
        fejl('ingen dele i app/parts/')
    stykker = []

    # De delte moduler foerst. De er UMD-pakkede, sa serveren kan require dem
    # og browseren far dem pa window - ÉN parser, to koersteder.
    for navn in sorted(f for f in os.listdir(SHARED) if f.endswith('.js')):
        with open(os.path.join(SHARED, navn), encoding='utf8') as fh:
            stykker.append(f'/* ---- shared/{navn} ---- */\n{fh.read()}')

    for navn in navne:
        with open(os.path.join(PARTS, navn), encoding='utf8') as fh:
            stykker.append(f'/* ---- {navn} ---- */\n{fh.read()}')
    samlet = '\n'.join(stykker)

    sti = os.path.join(PUBLIC, 'app.js')
    with open(sti, 'w', encoding='utf8') as fh:
        fh.write(samlet)

    # Ingen bundler fanger syntaksfejl for os.
    res = subprocess.run(['node', '--check', sti], capture_output=True)
    if res.returncode != 0:
        fejl('app.js har en syntaksfejl:\n' + res.stderr.decode('utf8', 'replace'))

    m = re.search(r'^const APP_VERSION = (\d+);', samlet, re.M)
    if not m:
        fejl('APP_VERSION mangler i app/parts/ (forventet: const APP_VERSION = N;)')
    print(f'  frontend: {len(navne)} dele, {len(samlet):,} tegn')
    return int(m.group(1))


def stempl_version(version):
    """Cache-bust. Resultatet SKAL skrives tilbage til disk - payloaden laeser
    filerne fra disk igen, og ellers pakkes den gamle HTML."""
    sti = os.path.join(PUBLIC, 'index.html')
    with open(sti, encoding='utf8') as fh:
        html = fh.read()
    ny = re.sub(r'(style\.css|app\.js)(\?v=\d+)?', rf'\1?v={version}', html)
    if ny != html:
        with open(sti, 'w', encoding='utf8') as fh:
            fh.write(ny)

    # Service workerens cache-navn OG dens precache-URL'er skal foelge samme
    # version. Ellers hober hver udgivelse sig op i browserens cache, og
    # SW'en kan servere en gammel app.js i det uendelige (RUNE-ERFARINGER §5).
    sw = os.path.join(PUBLIC, 'sw.js')
    with open(sw, encoding='utf8') as fh:
        kode = fh.read()
    ny_sw = re.sub(r'^const VERSION = \d+;', f'const VERSION = {version};', kode, flags=re.M)
    if ny_sw != kode:
        with open(sw, 'w', encoding='utf8') as fh:
            fh.write(ny_sw)
    if f'const VERSION = {version};' not in ny_sw:
        fejl('kunne ikke stemple versionen i sw.js')
    print(f'  index.html og sw.js stemplet med v={version}')


# ------------------------------------------------------------------ 2. payload

def indsaml_filer():
    # Alle moduler i app/-roden, ikke kun server.js - ellers glemmer man et
    # nyt modul i payloaden og opdager det foerst i containeren.
    filer = [(f'app/{n}', os.path.join(APP, n))
             for n in sorted(os.listdir(APP)) if n.endswith('.js')]
    for navn in sorted(os.listdir(SHARED)):
        if navn.endswith('.js'):
            filer.append((f'app/shared/{navn}', os.path.join(SHARED, navn)))
    for navn in sorted(os.listdir(PUBLIC)):
        sti = os.path.join(PUBLIC, navn)
        if os.path.isfile(sti) and not navn.startswith('.'):
            filer.append((f'app/public/{navn}', sti))
    return filer


def tjek_git(filer):
    """I hente-tilstand er det, GITHUB har, det der bliver installeret.

    Den nye fejlmulighed er ikke en manglende fil i en liste, men en fil, der
    ikke er committet: `app/public/app.js` og ikonerne er GENERERET, og ligger
    de ikke i repoet, stopper containeren paa "Cannot find module". Spoerg
    derfor git, ikke .gitignore.
    """
    if not os.path.isdir(os.path.join(ROOT, '.git')):
        print('  git: intet repo her - hentningen virker foerst naar app/ er pushet OG tagget')
        return
    res = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z'], capture_output=True)
    if res.returncode != 0:
        fejl('git ls-files fejlede: ' + res.stderr.decode('utf8', 'replace')[:400])
    sporet = set(res.stdout.decode('utf8').split('\0'))
    mangler = [navn for navn, _ in filer if navn not in sporet]
    if mangler:
        fejl('disse filer er ikke i git og ville mangle efter en hentning: ' + ', '.join(mangler))
    beskidt = subprocess.run(['git', '-C', ROOT, 'status', '--porcelain', '--', 'app'],
                             capture_output=True).stdout.decode('utf8').strip()
    if beskidt:
        print(f'  git: {len(beskidt.splitlines())} aendrede filer i app/ - '
              'husk commit + `git tag v<N>` + `git push --tags`')
    else:
        print('  git: app/ er committet')


def tjek_kilder(filer):
    for arkivnavn, sti in filer:
        if not sti.endswith(('.js', '.html', '.css', '.webmanifest')):
            continue
        with open(sti, encoding='utf8') as fh:
            indhold = fh.read()
        if HEREDOC in indhold:
            fejl(f'{arkivnavn} indeholder heredoc-markoeren {HEREDOC}')
        fund = FORBUDT_MOENSTER.search(indhold)
        if fund:
            fejl(f'{arkivnavn} indeholder {fund.group(0)} - yggdrasil templater '
                 'den vaek i install-scriptet. Omskriv.')


def tjek_syntaks(navn, kode):
    """node --check paa indhold, ikke paa en sti."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf8') as fh:
        fh.write(kode)
        midl = fh.name
    try:
        res = subprocess.run(['node', '--check', midl], capture_output=True)
        if res.returncode != 0:
            fejl(f'{navn} har en syntaksfejl EFTER kommentar-strip:\n'
                 + res.stderr.decode('utf8', 'replace'))
    finally:
        os.unlink(midl)


def strip_kommentarer(kode):
    """
    Fjerner kommentarer fra den UDGIVNE kopi. Kilderne roeres aldrig.

    Maalt paa doda: 21.135 tegn = 17 % af install-scriptet. Erfaringsfilen
    siger, at kommentar-strip gav Kokkeri 0,8 % og ikke er umagen vaerd - men
    doda har vaesentligt taettere kommentarer, saa tallet skal maales, ikke
    antages.

    To regler goer den sikker:

    1. Kun linjer, der er HELT kommentar eller tomme, fjernes. En linje med
       kode paa roeres aldrig, og derfor kan hverken en streng eller en
       regex-literal beskadiges. (Den ene farlige kant - `/* kort */ kode();`
       paa samme linje - findes ikke i kilderne, og build'et tjekker for den.)
    2. Hver fjernet linje efterlades TOM, saa linjetallet holder. En
       stak-sporing fra containeren peger dermed paa samme linje i repoet.
       Det koster 744 tegn af de 21.879 - 3 % af gevinsten for at kunne
       fejlsoege overhovedet.

    node --check koeres bagefter i tjek_bundt(); syntaks er ikke nok, saa
    testpakken er ogsaa koert mod en strippet server (142 groenne).
    """
    ud, i_blok = [], False
    for linje in kode.split('\n'):
        s = linje.strip()
        fjern = False
        if i_blok:
            if '*/' in s:
                i_blok = False
            fjern = True
        elif s.startswith('/*'):
            if '*/' not in s:
                i_blok = True
            elif s.split('*/', 1)[1].strip():
                # Kode efter en kort blok-kommentar. Findes ikke i dag; sker
                # det, beholdes linjen frem for at aede koden.
                ud.append(linje)
                continue
            fjern = True
        elif s.startswith('//') or not s:
            fjern = True
        ud.append('' if fjern else linje)
    return '\n'.join(ud)


def byg_tar(filer):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for arkivnavn, sti in filer:
            info = tarfile.TarInfo(arkivnavn)
            data = open(sti, 'rb').read()
            if arkivnavn.endswith('.js'):
                tekst = data.decode('utf8')
                renset = strip_kommentarer(tekst)
                if renset.count('\n') != tekst.count('\n'):
                    fejl(f'{arkivnavn}: strip aendrede linjetallet - stak-sporinger '
                         'ville ikke laengere passe med kilden')
                # Tjek DEN FIL, DER UDGIVES - ikke kilden den kom fra. Ellers
                # kunne en fejl i strippen foerst vise sig inde i containeren,
                # hvor ingen ser den (RUNE-ERFARINGER, F5).
                tjek_syntaks(arkivnavn, renset)
                data = renset.encode('utf8')
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def brotli(raw):
    """Python har ikke brotli i stdlib - Node har. Og install-imaget ER node."""
    return node('-e', 'process.stdout.write(require("zlib").brotliCompressSync('
                      'require("fs").readFileSync(0),{params:{[require("zlib")'
                      '.constants.BROTLI_PARAM_QUALITY]:11}}))', stdin=raw)


def b85(raw):
    ud = []
    for i in range(0, len(raw) - len(raw) % 4, 4):
        v = int.from_bytes(raw[i:i + 4], 'big')
        blok = []
        for _ in range(5):
            blok.append(ALFABET[v % 85])
            v //= 85
        ud.extend(reversed(blok))
    rest = len(raw) % 4
    if rest:
        # Nulpadning her, mens dekoderen padder cifrene med 84 (max). De to
        # runder hver sin vej, saa de betydende bytes overlever. Padder man
        # begge steder opad, loeber overskuddet op i den sidste rigtige byte.
        v = int.from_bytes(raw[-rest:] + b'\x00' * (4 - rest), 'big')
        blok = []
        for _ in range(5):
            blok.append(ALFABET[v % 85])
            v //= 85
        ud.extend(list(reversed(blok))[:rest + 1])
    return ''.join(chr(c) for c in ud)


# Dekoderen staar i en 'single quoted' sh-streng -> den ma IKKE indeholde '.
# Derfor bygges alfabetet af tegnkoder, ikke som streng-literal.
DEKODER = (
    'const A=[];for(let c=33;c<127;c++)if(c!==123&&c!==125&&c!==92)A.push(c);'
    'const M=new Int16Array(128).fill(-1);for(let i=0;i<85;i++)M[A[i]]=i;'
    'const s=require("fs").readFileSync(0,"utf8").replace(/\\s+/g,"");'
    'const h=s.length/5|0,r=s.length%5,o=Buffer.alloc(h*4+(r?r-1:0));let q=0;'
    'for(let i=0;i<h;i++){let v=0;for(let j=0;j<5;j++)v=v*85+M[s.charCodeAt(q++)];'
    'o.writeUInt32BE(v>>>0,i*4);}'
    'if(r){let v=0;for(let j=0;j<5;j++)v=v*85+(j<r?M[s.charCodeAt(q+j)]:84);'
    'const b=Buffer.alloc(4);b.writeUInt32BE(v>>>0);b.copy(o,h*4,0,r-1);}'
    'process.stdout.write(require("zlib").brotliDecompressSync(o));'
)


def verificer(kodet, forventet):
    """Koer PRAECIS den dekoder, der udgives - saa beviser testen, at dekoderen
    virker, ikke bare at Python kan regne baglaens."""
    if "'" in DEKODER:
        fejl("dekoderen indeholder ' og kan ikke sta i en sh-streng")
    faktisk = node('-e', DEKODER, stdin=kodet.encode('ascii'))
    if faktisk != forventet:
        fejl(f'rundturen fejlede: {len(faktisk)} b ud, {len(forventet)} b ind')
    print(f'  rundtur ok: {len(forventet):,} b tar -> {len(kodet):,} tegn base85')


# -------------------------------------------------------------------- 3. yaml

# Hentningen staar - som dekoderen - i en 'single quoted' sh-streng og maa
# derfor IKKE indeholde '. Node bruges frem for wget af to grunde: Node ER
# install-imaget og er garanteret til stede, mens busybox' wget og dens TLS er
# ubevist - og Nodes zlib pakker gzip'en ud, saa `tar` kun skal kunne det, den
# allerede goer i den indlejrede variant (`tar x`). Hver ekstra tar-funktion
# er en antagelse mere om busybox.
def henter(version):
    url = tarball_url(version)
    return (
        'const https=require("https"),zlib=require("zlib");'
        f'const U="{url}";'
        'function d(m){console.error("[fejl] "+m);console.error("Adresse: "+U);'
        'console.error("Repoet er offentligt, saa en 404 betyder, at adressen ikke findes '
        '- tjek at taggen er pushet.");'
        'process.exit(1);}'
        'function hent(u,n){const h={"user-agent":"doda-installer"};'
        'https.get(u,{headers:h},(r)=>{'
        'if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){'
        'if(n<=0)return d("for mange omdirigeringer");r.resume();'
        'return hent(new URL(r.headers.location,u).toString(),n-1);}'
        'if(r.statusCode!==200)return d("GitHub svarede "+r.statusCode);'
        'const g=zlib.createGunzip();'
        'g.on("error",(e)=>d("arkivet kunne ikke pakkes ud: "+e.message));'
        'r.pipe(g).pipe(process.stdout);'
        '}).on("error",(e)=>d("kunne ikke naa GitHub: "+e.message));}'
        'hent(U,3);'
    )


def hent_krop(version):
    """De linjer, install og update har tilfaelles, naar koden hentes.

    Det her er den ENESTE vej, der bruges ved opgraderingen fra en doda uden
    `app/kilde.js` - altsaa praecis den ene gang, hele mekanikken handler om.
    Den skal derfor holde de samme tre regler som kilde.js, og gjorde det ikke
    (fundet af Sagu v48, 05-09-2026, efter ti timers nedetid hos dem):

    1. **Ikke /tmp.** En fast sti deles af to samtidige koersler - og `mv` fra
       /tmp er en KOPI over to filsystemer, som kan afbrydes paa midten. Der
       pakkes derfor ud ved siden af `app/`, hvor et `rename` er atomisk.
    2. **Den gamle app FLYTTES, den slettes ikke.** `rm -rf app` foer `mv`
       aabnede et vindue helt uden app/ - og dermed uden `kilde.js` til at
       redde sig selv. Startup-redningen leder efter `.doda-gammel`, og den
       fandtes ikke ad denne vej, saa netop her hjalp den ikke.
    3. Der byttes foerst, naar arkivet ER en app.

    At flytte hele den gamle mappe vaek loeser samtidig det, `rm -rf app` var
    der for: filer, der er slettet i en ny udgave, bliver ikke liggende.

    Der er ikke et token i spil: repoet er offentligt (2026-08-21).
    """
    return (
        'echo "Henter app-koden fra GitHub ..."\n'
        'rm -rf .doda-ny .doda-gammel\n'
        'mkdir -p .doda-ny\n'
        f"node -e '{henter(version)}' > .doda-ny/app.tar\n"
        'tar x -C .doda-ny -f .doda-ny/app.tar\n'
        'rm -f .doda-ny/app.tar\n'
        '\n'
        '# Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>, og arkivet\n'
        '# begynder med en pax_global_header-post. Ingen af delene gaettes:\n'
        '# find den app-mappe, der FINDES.\n'
        'NY=$(find .doda-ny -maxdepth 2 -type d -name app | head -n 1)\n'
        'if [ -z "$NY" ] || [ ! -f "$NY/server.js" ]; then\n'
        '  echo "[fejl] arkivet fra GitHub indeholder ingen app/server.js"\n'
        '  exit 1\n'
        'fi\n'
        'if [ -d app ]; then mv app .doda-gammel; fi\n'
        'mv "$NY" app\n'
        'rm -rf .doda-ny .doda-gammel\n'
    )


def install_script(version, payload):
    if HENT_FRA_GITHUB:
        return (
            'set -eu\n'
            f'echo "Installerer doda (startsnor v{version}) ..."\n'
            'echo "Node: $(node --version)"\n'
            '\n'
            + hent_krop(version)
            + '\n'
            'echo "Filer udpakket:"\n'
            'ls -1 app app/public\n'
            'echo "Klar. Start serveren i panelet - den henter selv nyeste"\n'
            'echo "udgave (eller den, KODE_VERSION laaser til), foer den starter."\n'
        )
    linjer = textwrap.wrap(payload, 100)
    return (
        'set -eu\n'
        f'echo "Installerer doda v{version} ..."\n'
        'echo "Node: $(node --version)"\n'
        '\n'
        '# App-filerne ligger som brotli-komprimeret tar i base85 - se build_rune.py\n'
        f"node -e '{DEKODER}' <<'{HEREDOC}' | tar x\n"
        + '\n'.join(linjer) + '\n'
        f'{HEREDOC}\n'
        '\n'
        'echo "Filer udpakket:"\n'
        'ls -1 app app/public\n'
        'echo "Klar. Start serveren i panelet."\n'
    )


def opdater_script(version, payload):
    """update:-blokken (ny panelfunktion): skriver app-filerne igen og lader
    /data staa. Bruges til at lukke en CVE uden at geninstallere."""
    if HENT_FRA_GITHUB:
        # Knappen maa ALDRIG hente startsnorens tag, naar appen allerede er
        # laengere fremme: v82 oven i v95 er en nedgradering, som ingen bad
        # om. Findes app/kilde.js, er den facit - den kender KODE_VERSION og
        # henter praecis den udgave, serveren ville hente ved en genstart.
        # Startsnoren er kun redningen, hvis app/ er vaek eller foer v82.
        return (
            'set -eu\n'
            'echo "Opdaterer doda ..."\n'
            'echo "Node: $(node --version)"\n'
            '\n'
            # Laasen. Andreas trykkede paa Sagus »Opdater«-knap to gange med
            # otte sekunders mellemrum, og de to koersler byttede app/ ud
            # under hinanden (Sagu v48, 05-09-2026).
            #
            # `mkdir` og ikke `[ -d ] && mkdir`: mkdir er atomisk paa alle
            # filsystemer, det tochecks-moenster har et hul imellem sig.
            #
            # Om HELE scriptet, ikke om else-grenen. Fra v82 er kilde.js-vejen
            # den ALMINDELIGE, og to samtidige kilde.js kan lige saa godt
            # bytte app/ ud under hinanden. En laas, der kun daekker den gren,
            # der snart aldrig bruges, er ingen laas.
            'if ! mkdir .doda-laas 2>/dev/null; then\n'
            '  echo "[fejl] en anden opdatering er allerede i gang."\n'
            '  echo "Vent til den er faerdig, eller genstart doda og proev igen."\n'
            '  exit 1\n'
            'fi\n'
            # trap'en frigiver den. En fejlet hentning er den ALMINDELIGE fejl
            # - nettet blinker, taggen mangler - og en laas, der overlever
            # den, goer knappen doed for altid. .doda-gammel roeres IKKE:
            # doer vi mellem de to omdoebninger, er den redningen.
            "trap 'rm -rf .doda-laas .doda-ny' EXIT INT TERM\n"
            '\n'
            'if [ -f app/kilde.js ]; then\n'
            # Panelet templater {{...}} ind i scriptet, og variablerne findes
            # ogsaa som env i containeren. Vi PROEVER skabelonen og falder
            # tilbage til env, hvis den staar utemplateret - saa kan en
            # laasning ikke tabes paa en antagelse om, hvad panelet goer.
            '  K="{{KODE_VERSION}}"\n'
            '  case "$K" in\n'
            "    '') : ;;\n"
            '    seneste|latest|[0-9]*) : ;;\n'
            '    *) K="${KODE_VERSION:-}" ;;\n'
            '  esac\n'
            '  echo "Oensket udgave: ${K:-nyeste}"\n'
            '  KODE_VERSION="$K" node app/kilde.js\n'
            'else\n'
            + textwrap.indent(hent_krop(version), '  ')
            + 'fi\n'
            '\n'
            # Sagu v48 foreslog en indrammet »GENSTART NU«-besked, fordi
            # deres maaling sagde, at knappen ikke genstarter. Andreas'
            # install-log for doda 03-09-2026 (Yggdrasil v0.3.8) siger noget
            # andet: efter »=== Update complete ===« staar »Restarting the
            # app ...«. Beskeden er derfor skrevet, saa den er sand i begge
            # tilfaelde frem for at raabe om noget, panelet allerede goer.
            'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
            'echo "Panelet genstarter doda bagefter. Sker det ikke, saa genstart"\n'
            'echo "selv - serveren koerer den gamle kode, indtil den er genstartet."\n'
        )
    linjer = textwrap.wrap(payload, 100)
    return (
        'set -eu\n'
        f'echo "Opdaterer doda til v{version} ..."\n'
        'echo "Node: $(node --version)"\n'
        'rm -rf app\n'
        f"node -e '{DEKODER}' <<'{HEREDOC}' | tar x\n"
        + '\n'.join(linjer) + '\n'
        f'{HEREDOC}\n'
        '\n'
        'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
        'echo "Skemaet opdateres automatisk, naar serveren starter."\n'
    )


def byg_yaml(version, rune_version, payload):
    rune = {'gameskill': {
        'id': 'doda',
        'name': 'doda',
        'category': 'Apps',
        'description': (
            'Personlig opgave- og noteapp efter GTD-metoden. Lynhurtig fangst fra et enkelt '
            'soegefelt, inbox med tastaturafklaring, naeste-handlings-liste efter kontekst, '
            'projekter og omraader, markdown-noter, gentagende opgaver med Todoist-syntaks, '
            'ugentlig gennemgang, kalenderfeed og et API til iOS Shortcuts og Siri. '
            'Egen SQLite-database, ingen eksterne afhaengigheder.'
        ),
        'author': 'andreas',
        'version': rune_version,
        'icon': 'app',

        # Node-versionen er et FELT i panelet, ikke en konstant i koden: findes
        # der en CVE i Node, kan den lukkes uden en kodeaendring. Flydende tag
        # som standard, saa en geninstallation henter seneste patch.
        'docker': {'image': '{{NODE_IMAGE}}'},

        'variables': [
            {'key': 'APP_NAME', 'name': 'Appens navn', 'type': 'string', 'default': 'doda'},
            {'key': 'NODE_IMAGE', 'name': 'Node-image', 'type': 'string',
             'default': 'node:24-alpine',
             'pattern': r'^node:[0-9][A-Za-z0-9._-]*$',
             'hint': 'Skal vaere et node:-image, fx node:24-alpine eller node:24.9.0-alpine'},

            # Laasen. »seneste« er standarden, fordi det er den, der goer
            # runen overfloedig i hverdagen - men et tal her er hele vejen
            # tilbage: saet 81, genstart, og serveren koerer v81 igen.
            # Moensteret afviser »v81« og »81.2« i panelet frem for at lade
            # kilde.js tolke noget, brugeren ikke skrev.
            # TOM = nyeste. Standarden for »goer det normale« skal vaere
            # ingenting: et felt, der SKAL udfyldes for at opfoere sig
            # almindeligt, laeser man som en indstilling, der er taget - og
            # saa spekulerer man paa, hvad »seneste« mon daekker over.
            # Ordene godtages stadig; gamle servere har dem staaende.
            {'key': 'KODE_VERSION', 'name': 'Kodeversion', 'type': 'string',
             'default': '',
             'pattern': r'^([0-9]+|seneste|latest)?$',
             'hint': 'Tom = hent nyeste udgivelse fra GitHub ved hver genstart. '
                     'Et tal (fx 81) laaser til praecis den udgave.'},
        ],
        # Der staar ikke et GITHUB_TOKEN her. Repoet er offentligt, saa
        # hentningen kraever ingen godkendelse - og et felt, der ikke goer
        # noget, er et sted at lede efter en fejl, der ikke er der.

        # Begge scripts henter STARTSNOREN, ikke den nyeste app-udgave:
        # runen kender kun sin egen version. Resten klarer kilde.js.
        'install': {'image': '{{NODE_IMAGE}}', 'script': install_script(rune_version, payload)},
        'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater doda',
                   'script': opdater_script(rune_version, payload)},

        'startup': {
            # Opstarten er opdateringen (F26). Tre trin, i den raekkefoelge:
            #
            #  1. Redningen. kilde.js bytter app/ ud med to omdoebninger, og
            #     doer containeren imellem dem, ligger den gamle app under
            #     .doda-gammel. Uden det her trin ville et daarligt sekund
            #     efterlade en container helt uden app/ - og saa er der heller
            #     ingen kilde.js til at hente en ny. Det er den eneste rigtige
            #     brik: alt andet herinde kan fejle uden konsekvens.
            #  2. Hentningen. Fejler den, siger den det og gaar videre - den
            #     kode, der ligger, er stadig en koerende doda.
            #  3. Serveren, som foer.
            'command': ('if [ ! -f app/server.js ] && [ -f .doda-gammel/server.js ]; then\n'
                        '  rm -rf app\n'
                        '  mv .doda-gammel app\n'
                        '  echo "[kode] app/ sat tilbage efter en afbrudt udskiftning"\n'
                        'fi\n'
                        # trap'en naar ikke at koere ved et haardt drab, og en
                        # efterladt laas goer opdaterings-knappen doed for
                        # altid. Prisen er, at en opdatering, der koerer i sin
                        # egen container praecis mens appen starter, mister
                        # sin laas - mindre end en knap, der aldrig virker
                        # igen. Panelet stopper i oevrigt appen foer en
                        # opdatering, saa de to skulle ikke kunne overlappe.
                        'if [ -d .doda-laas ]; then\n'
                        '  rm -rf .doda-laas .doda-ny\n'
                        '  echo "[kode] en strandet opdateringslaas er ryddet"\n'
                        'fi\n'
                        'node app/kilde.js || echo "[kode] advarsel: opdateringen kunne ikke koeres"\n'
                        'if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
                        '  exec node app/server.js\n'
                        'else\n'
                        '  exec node --experimental-sqlite app/server.js\n'
                        'fi\n'),
            'done_regex': 'doda lytter',
            'stop_timeout': 30,
        },

        'ports': [{'name': 'web', 'default': 3000, 'protocol': 'tcp'}],

        'watchers': [
            {'name': 'Serverfejl i doda', 'pattern': r'\[fejl\]',
             'threshold': 5, 'window_secs': 300},
        ],

        # Ruller op pr. IP i panelets sikkerhedshistorik.
        'events': [
            {'key': 'doda_login_fejl', 'label': 'Mislykket login i doda',
             'match': r'\[sikkerhed\] login-fejl ip=(\S+)'},
            {'key': 'doda_login_spaerret', 'label': 'Login spaerret af rate-limit',
             'match': r'\[sikkerhed\] login-spaerret ip=(\S+)'},
        ],

        'backup': {'include': []},
        # files/ skal med i wipe - ellers efterlader en nulstilling alle
        # vedhaeftninger som foraeldreloese filer, der aldrig ryddes op.
        # backup.include: [] daekker hele datamappen, saa filerne er med der.
        'wipe': {'paths': ['doda.db', 'doda.db-wal', 'doda.db-shm', 'files'],
                 'backup_first': True},
    }}

    tekst = yaml.safe_dump(rune, allow_unicode=True, sort_keys=False, width=120)
    # Valider at det vi skrev, kan laeses igen.
    genlaest = yaml.safe_load(tekst)
    if genlaest['gameskill']['install']['script'] != rune['gameskill']['install']['script']:
        fejl('install-scriptet overlevede ikke en YAML-rundtur')
    return tekst


# -------------------------------------------------------------------- main

def main():
    print('Bygger doda-runen ...')
    version = saml_frontend()
    stempl_version(version)

    filer = indsaml_filer()
    tjek_kilder(filer)
    if HENT_FRA_GITHUB:
        tjek_git(filer)

    raw = byg_tar(filer)
    komprimeret = brotli(raw)
    payload = b85(komprimeret)
    verificer(payload, raw)

    install = install_script(RUNE_VERSION, payload)
    if len(install) > MAX_INSTALL:
        fejl(f'install-scriptet er {len(install):,} tegn - loftet er {MAX_INSTALL:,} '
             '(Linux MAX_ARG_STRLEN er 131072). Frontenden er vokset for meget.')

    tekst = byg_yaml(version, RUNE_VERSION, payload)
    if len(tekst.encode('utf8')) > MAX_YAML:
        fejl(f'YAML er {len(tekst.encode("utf8")):,} b - panelets loft er {MAX_YAML:,}')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as fh:
        fh.write(tekst)

    print(f'  install-script: {len(install):,} / {MAX_INSTALL:,} tegn '
          f'({len(install) * 100 // MAX_INSTALL} %)')
    print(f'\nOK  runes/doda.yaml  (rune v{RUNE_VERSION}, {len(tekst.encode("utf8")):,} b)')
    print(f'    App-koden er v{version} - serveren henter den selv ved opstart.')
    if RUNE_VERSION != version:
        print('    Runen er UAENDRET og behoever ikke udgives: '
              'commit + `git tag v%d` + `git push --tags` er nok.' % version)


if __name__ == '__main__':
    main()
