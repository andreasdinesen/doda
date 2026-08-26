#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Next Actions
# @raycast.mode fullOutput
# @raycast.packageName doda
# @raycast.icon ✅
# @raycast.argument1 { "type": "text", "placeholder": "context (optional)", "optional": true }
# @raycast.description Det, du kan gøre nu. Skriv en kontekst for kun at se den.
# @raycast.author Andreas Dinesen

set -euo pipefail
cd "$(dirname "$0")"
source ./_doda.sh

sti="/api/v1/next?format=text&limit=50"
# Kontekstnavne kan have mellemrum og æøå - de skal kodes, ikke saettes ind raat.
if [ -n "${1:-}" ]; then
  sti="$sti&context=$(printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g')"
fi
doda_kald GET "$sti"
