#!/usr/bin/env bash
# Install Clipboard History for the current user, picking the variant that
# matches your GNOME Shell version (modern ESM for 45+, legacy for 3.36–44).
set -euo pipefail

UUID="clipboard-history@jayeshbarman.github.io"
REPO="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

if ! command -v gnome-shell >/dev/null 2>&1; then
    echo "error: gnome-shell not found — this is a GNOME Shell extension." >&2
    exit 1
fi

ver="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)*' | head -1)"
major="${ver%%.*}"
if [ -z "${major:-}" ]; then
    echo "warning: could not detect GNOME version; assuming modern (45+)." >&2
    major=45
fi
if [ "$major" -ge 45 ] 2>/dev/null; then
    variant="modern"
else
    variant="legacy"
fi
echo "• Detected GNOME Shell ${ver:-unknown} → installing the '$variant' variant"

echo "• Installing to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/schemas"
cp "$REPO/metadata.json" "$DEST/"
cp "$REPO/stylesheet.css" "$DEST/"
cp "$REPO"/schemas/*.gschema.xml "$DEST/schemas/"
cp "$REPO/src/$variant/"*.js "$DEST/"

echo "• Compiling settings schema"
glib-compile-schemas "$DEST/schemas"

echo "• Freeing Super+V (message tray stays on its other shortcut)"
tray="$(gsettings get org.gnome.shell.keybindings toggle-message-tray 2>/dev/null || echo '')"
if echo "$tray" | grep -q "Super>v"; then
    cleaned="$(echo "$tray" | sed -E "s/'<Super>v', ?//; s/, ?'<Super>v'//; s/'<Super>v'//")"
    gsettings set org.gnome.shell.keybindings toggle-message-tray "$cleaned"
fi

echo "• Enabling extension"
if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "  enabled"
else
    cur="$(gsettings get org.gnome.shell enabled-extensions)"
    if ! echo "$cur" | grep -q "$UUID"; then
        if [ "$cur" = "@as []" ] || [ "$cur" = "[]" ]; then
            gsettings set org.gnome.shell enabled-extensions "['$UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${cur%]}, '$UUID']"
        fi
    fi
    echo "  registered to auto-enable on next login"
fi

echo
echo "✓ Installed. On Wayland the shell can't hot-reload, so LOG OUT and LOG BACK IN"
echo "  once (X11 users can press Alt+F2, type 'r', Enter). Then press Super+V."
