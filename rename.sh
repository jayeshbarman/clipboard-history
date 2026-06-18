#!/usr/bin/env bash
# Rebrand the project to your own identity in one shot.
#
#   ./rename.sh <uuid-domain> [github-owner]
#
# Examples:
#   ./rename.sh alice.github.io alice
#       -> UUID  clipboard-history@alice.github.io
#       -> URL   https://github.com/alice/clipboard-history
#
# The slug ("clipboard-history") and the GSettings schema id are left unchanged.
set -euo pipefail

if [ $# -lt 1 ]; then
    grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
    exit 1
fi

DOMAIN="$1"
OWNER="${2:-OWNER}"
REPO="$(cd "$(dirname "$0")" && pwd)"

OLD_UUID="$(grep -oE '"uuid"[[:space:]]*:[[:space:]]*"[^"]+"' "$REPO/metadata.json" | sed -E 's/.*"([^"]+)"$/\1/')"
NEW_UUID="clipboard-history@${DOMAIN}"

if [ "$OLD_UUID" = "$NEW_UUID" ]; then
    echo "UUID is already $NEW_UUID — nothing to do."
    exit 0
fi

echo "Renaming:"
echo "  UUID : $OLD_UUID  ->  $NEW_UUID"
echo "  URL  : https://github.com/${OWNER}/clipboard-history"

# Replace the UUID everywhere it appears.
grep -rIl --exclude-dir=.git --exclude-dir=dist -- "$OLD_UUID" "$REPO" | while read -r f; do
    sed -i "s|$OLD_UUID|$NEW_UUID|g" "$f"
done

# Point the project URL at the new owner.
sed -i -E "s|https://github.com/[^/\"]+/clipboard-history|https://github.com/${OWNER}/clipboard-history|g" \
    "$REPO/metadata.json" "$REPO/README.md" 2>/dev/null || true

echo "Done. Review changes with 'git diff', then reinstall with ./install.sh"
