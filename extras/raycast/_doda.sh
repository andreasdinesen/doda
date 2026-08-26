#!/bin/bash
# Faelles for dodas Raycast-kommandoer. Ikke en kommando i sig selv - den har
# med vilje ingen @raycast-hoved, saa Raycast ikke viser den.
#
# Adressen og noeglen ligger i macOS' NOeGLERING, ikke i en fil her.
# Kommandoerne ligger i en mappe, man deler, synkroniserer og sikkerhedskopierer;
# en noegle med `full`-scope maa ikke ligge dér i klar tekst.
#
#   ./doda-setup.sh   saetter dem op
#
set -euo pipefail

doda_hent() {
  security find-generic-password -s "doda-raycast-$1" -w 2>/dev/null || true
}

DODA_URL="$(doda_hent url)"
DODA_KEY="$(doda_hent key)"

if [ -z "$DODA_URL" ] || [ -z "$DODA_KEY" ]; then
  echo "doda er ikke sat op endnu."
  echo "Kør doda-setup.sh i denne mappe én gang — så husker nøgleringen resten."
  exit 1
fi

# `--fail-with-body` giver bade fejlkoden OG serverens forklaring. Uden den
# ville en udloebet noegle vise en tom boks i stedet for »key is not valid«.
doda_kald() {
  local metode="$1" sti="$2"
  shift 2
  curl -sS --fail-with-body --max-time 20 \
    -X "$metode" "$DODA_URL$sti" \
    -H "Authorization: Bearer $DODA_KEY" \
    "$@"
}
