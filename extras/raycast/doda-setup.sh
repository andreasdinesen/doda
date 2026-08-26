#!/bin/bash
# Gemmer dodas adresse og noegle i macOS' noeglering. Koeres én gang.
#
# Ikke en Raycast-kommando: den skal koeres i en terminal, hvor man kan se,
# hvad man skriver, og hvor noeglen ikke havner i Raycasts historik.
set -euo pipefail

echo "doda for Raycast"
echo
read -r -p "Adresse (fx https://doda.eksempel.dk): " url
# -s: noeglen skal ikke staa paa skaermen.
read -r -s -p "API-nøgle (Settings → Access keys i doda): " key
echo

url="${url%/}"   # en skraastreg til sidst giver //api/v1/... og en 404

echo -n "Prøver forbindelsen … "
svar="$(curl -sS --fail-with-body --max-time 20 "$url/api/v1/next?format=text&limit=1" \
  -H "Authorization: Bearer $key" 2>&1)" || { echo "nej"; echo "$svar"; exit 1; }
echo "ja"

# Slet foerst: add-generic-password fejler paa en, der findes i forvejen.
for felt in url key; do
  security delete-generic-password -s "doda-raycast-$felt" >/dev/null 2>&1 || true
done
security add-generic-password -s doda-raycast-url -a "$USER" -w "$url"
security add-generic-password -s doda-raycast-key -a "$USER" -w "$key" -T ""

echo
echo "Gemt i nøgleringen. Læg denne mappe ind under Raycast → Extensions →"
echo "Scripts, og kommandoerne dukker op."
