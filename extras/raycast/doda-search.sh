#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Search doda
# @raycast.mode fullOutput
# @raycast.packageName doda
# @raycast.icon 🔎
# @raycast.argument1 { "type": "text", "placeholder": "search…" }
# @raycast.description Find en opgave eller note i doda.
# @raycast.author Andreas Dinesen

set -euo pipefail
cd "$(dirname "$0")"
source ./_doda.sh

doda_kald GET "/api/v1/search?format=text&q=$(
  printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'
)"
