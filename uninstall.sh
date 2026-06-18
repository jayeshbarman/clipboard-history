#!/usr/bin/env bash
# Remove Clipboard History for the current user.
set -euo pipefail

UUID="clipboard-history@jayeshbarman.github.io"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "• Disabling extension"
gnome-extensions disable "$UUID" 2>/dev/null || true

cur="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '@as []')"
new="$(echo "$cur" | sed -E "s/'$UUID'(, )?//; s/, ]/]/")"
gsettings set org.gnome.shell enabled-extensions "$new" 2>/dev/null || true

echo "• Removing files at $DEST"
rm -rf "$DEST"

echo
echo "✓ Removed. Saved history is still at ~/.local/share/clipboard-history/"
echo "  (delete that folder to wipe it). To give Super+V back to the message tray:"
echo "    gsettings set org.gnome.shell.keybindings toggle-message-tray \"['<Super>v', '<Super>m']\""
echo "  Log out/in to fully unload it from the running shell."
