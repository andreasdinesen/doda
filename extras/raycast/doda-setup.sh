#!/bin/bash
# Gemmer dodas adresse og noegle i macOS' noeglering. Koeres én gang.
#
# Ikke en Raycast-kommando: den skal koeres i en terminal, hvor man kan se,
# hvad man skriver, og hvor noeglen ikke havner i Raycasts historik.
set -euo pipefail

echo "doda for Raycast"
echo
read -r -p "Adresse (fx https://doda.eksempel.dk): " url

# Noeglen vises MENS den tastes.
#
# Den er lang og let at forvanske, og skjult indtastning gav ingen maade at se
# paa, om en indsaettelse kom hel med - fejlen dukkede foerst op som en 401
# (Andreas, 25-08-2026).
#
# Bagefter ryddes linjen og erstattes af en maskeret udgave: man har set det,
# man skulle, og noeglen bliver ikke staaende i terminalens historik, hvor den
# kan rulles frem af den naeste, der kigger paa skaermen.
read -r -p "API-nøgle (Settings → Access keys i doda): " key
# Kun mod en RIGTIG terminal: koeres scriptet gennem en pipe, ville
# styretegnene staa som tekst i stedet for at rydde noget.
[ -t 1 ] && printf '\033[1A\033[2K'   # én linje op, og ryd den
if [ ${#key} -gt 14 ]; then
  printf 'API-nøgle: %s…%s\n' "${key:0:9}" "${key: -4}"
else
  printf 'API-nøgle: (for kort til at være en doda-nøgle?)\n'
fi

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
