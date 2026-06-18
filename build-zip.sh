#!/usr/bin/env bash
# Build distributable zips — one for the modern (GNOME 45+) variant and one for
# the legacy (3.36–44) variant — each with a metadata.json listing only the
# shell versions it actually supports. Output goes to ./dist/.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
UUID="$(grep -oE '"uuid"[[:space:]]*:[[:space:]]*"[^"]+"' "$REPO/metadata.json" | sed -E 's/.*"([^"]+)"$/\1/')"
OUT="$REPO/dist"
mkdir -p "$OUT"

build() {
    variant="$1"
    tmp="$(mktemp -d)"
    cp "$REPO/src/$variant/"*.js "$tmp/"
    cp "$REPO/stylesheet.css" "$tmp/"
    mkdir -p "$tmp/schemas"
    cp "$REPO"/schemas/*.gschema.xml "$tmp/schemas/"

    # metadata.json filtered to this variant's shell versions
    node -e '
        const fs = require("fs");
        const [variant, path] = [process.argv[1], process.argv[2]];
        const m = JSON.parse(fs.readFileSync(path, "utf8"));
        const all = m["shell-version"];
        m["shell-version"] = variant === "modern"
            ? all.filter(v => parseFloat(v) >= 45)
            : all.filter(v => parseFloat(v) < 45);
        process.stdout.write(JSON.stringify(m, null, 2) + "\n");
    ' "$variant" "$REPO/metadata.json" > "$tmp/metadata.json"

    # EGO compiles schemas on install; shipping gschemas.compiled is flagged
    # as an unnecessary build artifact, so we ship only the .gschema.xml source.

    local zip="$OUT/${UUID}.${variant}.zip"
    rm -f "$zip"
    ( cd "$tmp" && python3 -m zipfile -c "$zip" metadata.json stylesheet.css schemas ./*.js )
    rm -rf "$tmp"
    echo "  built $zip"
}

echo "Building distributable zips for $UUID"
build modern
build legacy
echo
echo "Install a built zip directly with:"
echo "  gnome-extensions install --force dist/${UUID}.modern.zip   # GNOME 45+"
echo "  gnome-extensions install --force dist/${UUID}.legacy.zip   # GNOME 3.36–44"
