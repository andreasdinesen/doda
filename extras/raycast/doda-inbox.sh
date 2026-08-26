#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title doda Inbox
# @raycast.mode fullOutput
# @raycast.packageName doda
# @raycast.icon 📥
# @raycast.description Det, du har fanget og endnu ikke afklaret.
# @raycast.author Andreas Dinesen

set -euo pipefail
cd "$(dirname "$0")"
source ./_doda.sh

# Samme kald som appens egen Inbox: `queued` med, `kind=task` fra.
doda_kald GET "/api/v1/items?format=text&status=inbox,queued&kind=task&limit=50"
