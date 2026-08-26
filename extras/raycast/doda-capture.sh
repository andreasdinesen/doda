#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Capture to doda
# @raycast.mode compact
# @raycast.packageName doda
# @raycast.icon 🗒️
# @raycast.argument1 { "type": "text", "placeholder": "buy coffee #errands !tomorrow" }
# @raycast.description Fang en opgave i doda. Samme syntaks som i appen — #kontekst, @projekt, !dato, ~udskyd, : område.
# @raycast.author Andreas Dinesen

set -euo pipefail
cd "$(dirname "$0")"
source ./_doda.sh

# JSON-strengen bygges af `curl --data-urlencode`-familien? Nej: teksten kan
# indeholde anfoerselstegn og backslash, og en haandbygget JSON ville braekke
# paa dem. `--data-raw` med en pyntet streng er heller ikke sikkert nok, saa
# teksten sendes som ?text= i stedet - doda tager imod den vej ogsaa, netop
# fordi en klient med ét tekstfelt bare skal virke.
doda_kald POST "/api/v1/capture?format=text&text=$(
  printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'
)"
