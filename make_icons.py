#!/usr/bin/env python3
"""Genererer app/public/icon-*.png.

    python3 make_icons.py

Koeres kun, nar ikonet aendres - resultatet committes. Tegner dodas maerke:
den samme ring med flueben som i sidebaren, i okker paa varm creme.

PNG (ikke JPEG): JPEG-fallback goer transparens til sort, og PNG kan ikke
kvalitets-komprimeres - skal den mindre, skal den nedskaleres
(RUNE-ERFARINGER, Kokkeri).
"""

import os
from PIL import Image, ImageDraw

UD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'public')

BAGGRUND = (239, 233, 226, 255)   # --bg, lys
OKKER = (176, 125, 20, 255)       # --accent

# Tegn 4x for oevre og skaler ned - PIL har ingen antialiasing paa streger.
SKALA = 4


def tegn(px, gennemsigtig=False):
    s = px * SKALA
    bg = (0, 0, 0, 0) if gennemsigtig else BAGGRUND
    img = Image.new('RGBA', (s, s), bg)
    d = ImageDraw.Draw(img)

    # 22 % margen: nok til at et maskable-ikon kan beskaeres cirkulaert,
    # uden at maerket rammer kanten.
    m = s * 0.22          # margen
    tyk = max(int(s * 0.062), 1)
    d.ellipse([m, m, s - m, s - m], outline=OKKER, width=tyk)

    # Fluebenet, samme proportioner som SVG-ikonet i appen.
    p = [(s * 0.355, s * 0.508), (s * 0.455, s * 0.608), (s * 0.647, s * 0.400)]
    d.line(p, fill=OKKER, width=tyk, joint='curve')
    # Runde endepunkter - line() giver skarpe hjoerner.
    for (x, y) in (p[0], p[-1]):
        r = tyk / 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=OKKER)

    return img.resize((px, px), Image.LANCZOS)


def gem(img, sti):
    """Paletteret PNG, ikke truecolor.

    Ikonerne ligger i runens install-script, som har et hardt loft
    (MAX_ARG_STRLEN). PNG komprimeres ikke af brotli, sa 70 KB truecolor blev
    til 87 K tegn base85 og sprangte budgettet. Et fladt tofarvet maerke
    behoever hoejst 32 farver til kanterne - det er en faktor 20.
    """
    img.convert('RGB').quantize(colors=32, method=Image.MEDIANCUT).save(sti, optimize=True)
    print(f'  {os.path.basename(sti)}  {os.path.getsize(sti):,} b')


def main():
    # KUN to ikoner. De ligger i runens install-script, som har et hardt loft,
    # og PNG komprimeres ikke af brotli - fire ikoner kostede 19 % af budgettet.
    # 192 daekker ogsaa apple-touch-icon, og 512 er baade "any" og "maskable",
    # fordi maerket har 22 % margen hele vejen rundt.
    for px in (192, 512):
        gem(tegn(px), os.path.join(UD, f'icon-{px}.png'))


if __name__ == '__main__':
    main()
