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
MAX_INSTALL = 120_000
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
    print(f'  index.html stemplet med ?v={version}')


# ------------------------------------------------------------------ 2. payload

def indsaml_filer():
    filer = [('app/server.js', os.path.join(APP, 'server.js'))]
    for navn in sorted(os.listdir(SHARED)):
        if navn.endswith('.js'):
            filer.append((f'app/shared/{navn}', os.path.join(SHARED, navn)))
    for navn in sorted(os.listdir(PUBLIC)):
        sti = os.path.join(PUBLIC, navn)
        if os.path.isfile(sti) and not navn.startswith('.'):
            filer.append((f'app/public/{navn}', sti))
    return filer


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


def byg_tar(filer):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for arkivnavn, sti in filer:
            info = tarfile.TarInfo(arkivnavn)
            data = open(sti, 'rb').read()
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

def install_script(version, payload):
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


def byg_yaml(version, payload):
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
        'version': version,
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
        ],

        'install': {'image': '{{NODE_IMAGE}}', 'script': install_script(version, payload)},
        'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater doda',
                   'script': opdater_script(version, payload)},

        'startup': {
            'command': ('if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
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
        'wipe': {'paths': ['doda.db', 'doda.db-wal', 'doda.db-shm'], 'backup_first': True},
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

    raw = byg_tar(filer)
    komprimeret = brotli(raw)
    payload = b85(komprimeret)
    verificer(payload, raw)

    install = install_script(version, payload)
    if len(install) > MAX_INSTALL:
        fejl(f'install-scriptet er {len(install):,} tegn - loftet er {MAX_INSTALL:,} '
             '(Linux MAX_ARG_STRLEN er 131072). Frontenden er vokset for meget.')

    tekst = byg_yaml(version, payload)
    if len(tekst.encode('utf8')) > MAX_YAML:
        fejl(f'YAML er {len(tekst.encode("utf8")):,} b - panelets loft er {MAX_YAML:,}')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf8') as fh:
        fh.write(tekst)

    print(f'  install-script: {len(install):,} / {MAX_INSTALL:,} tegn '
          f'({len(install) * 100 // MAX_INSTALL} %)')
    print(f'\nOK  runes/doda.yaml  (v{version}, {len(tekst.encode("utf8")):,} b)')


if __name__ == '__main__':
    main()
