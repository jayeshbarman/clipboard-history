// extension.js (legacy, GNOME 3.36–44) — controller.
//
// Pre-45 GNOME loads this as a plain script and calls init() -> enable()/disable().

const { St, Clutter, Meta, Shell, GLib, Gio } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { ClipboardStore } = Me.imports.store;
const { ClipboardDialog } = Me.imports.dialog;
const { ClipboardIndicator } = Me.imports.indicator;

const KEYBINDING = 'toggle-clipboard';
const SCHEMA_ID = 'org.gnome.shell.extensions.clipboard-history';
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/tiff', 'image/webp'];
const IGNORE_HINTS = ['x-kde-passwordManagerHint', 'application/x-nautilus-clipboard'];

// Self-contained settings loader (works on every legacy shell version).
function getSettings() {
    const GioSSS = Gio.SettingsSchemaSource;
    const schemaDir = Me.dir.get_child('schemas');
    let source;
    if (schemaDir.query_exists(null))
        source = GioSSS.new_from_directory(schemaDir.get_path(), GioSSS.get_default(), false);
    else
        source = GioSSS.get_default();
    const schemaObj = source.lookup(SCHEMA_ID, true);
    if (!schemaObj)
        throw new Error('clipboard-history: schema ' + SCHEMA_ID + ' not found (did the schema compile?)');
    return new Gio.Settings({ settings_schema: schemaObj });
}

class ClipboardHistoryExtension {
    enable() {
        this._settings = getSettings();

        this._store = new ClipboardStore({
            maxItems: this._settings.get_int('history-size'),
            captureImages: this._settings.get_boolean('capture-images'),
        });

        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._pauseTracking = false;
        this._pasteTimeoutId = 0;
        this._unpauseTimeoutId = 0;

        this._selectionOwnerChangedId = this._selection.connect('owner-changed', (_sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onClipboardChanged();
        });

        this._dialog = new ClipboardDialog(this._store, {
            onActivate: entry => this._applyEntry(entry, true),
            onTogglePin: id => this._store.togglePin(id),
            onRemove: id => this._store.remove(id),
            onClear: () => this._store.clear(true),
            onTogglePrivate: () => this._settings.set_boolean('private-mode',
                !this._settings.get_boolean('private-mode')),
            isPrivate: () => this._settings.get_boolean('private-mode'),
        });

        this._settingsIds = [
            this._settings.connect('changed::history-size',
                () => this._store.setMaxItems(this._settings.get_int('history-size'))),
            this._settings.connect('changed::capture-images',
                () => this._store.setCaptureImages(this._settings.get_boolean('capture-images'))),
            this._settings.connect('changed::show-indicator',
                () => this._buildIndicator()),
        ];

        this._buildIndicator();
        this._addKeybinding();

        this._onClipboardChanged();
    }

    disable() {
        this._removeKeybinding();

        if (this._selectionOwnerChangedId) {
            this._selection.disconnect(this._selectionOwnerChangedId);
            this._selectionOwnerChangedId = 0;
        }

        (this._settingsIds || []).forEach(id => this._settings.disconnect(id));
        this._settingsIds = null;

        if (this._pasteTimeoutId) {
            GLib.source_remove(this._pasteTimeoutId);
            this._pasteTimeoutId = 0;
        }
        if (this._unpauseTimeoutId) {
            GLib.source_remove(this._unpauseTimeoutId);
            this._unpauseTimeoutId = 0;
        }

        this._destroyIndicator();

        if (this._dialog) {
            this._dialog.destroy();
            this._dialog = null;
        }
        if (this._store) {
            this._store.destroy();
            this._store = null;
        }

        this._virtualKeyboard = null;
        this._clipboard = null;
        this._selection = null;
        this._settings = null;
    }

    _onClipboardChanged() {
        if (this._pauseTracking)
            return;
        if (this._settings.get_boolean('private-mode'))
            return;

        // Honour "don't record" hints when get_mimetypes is available.
        try {
            const mimetypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) || [];
            if (mimetypes.some(m => IGNORE_HINTS.includes(m)))
                return;
        } catch (_e) {
            // get_mimetypes may be unavailable on very old shells — ignore.
        }

        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_cb, text) => {
            if (text && text.length) {
                this._store.addText(text);
            } else if (this._settings.get_boolean('capture-images')) {
                this._tryGrabImage(0);
            }
        });
    }

    _tryGrabImage(i) {
        if (i >= IMAGE_MIMES.length)
            return;
        const mime = IMAGE_MIMES[i];
        this._clipboard.get_content(St.ClipboardType.CLIPBOARD, mime, (_cb, bytes) => {
            if (bytes && bytes.get_size && bytes.get_size() > 0)
                this._store.addImage(bytes, mime);
            else
                this._tryGrabImage(i + 1);
        });
    }

    _applyEntry(entry, paste) {
        this._pauseTracking = true;

        if (entry.type === 'text') {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, entry.text);
        } else {
            try {
                const [ok, data] = GLib.file_get_contents(entry.imagePath);
                if (ok)
                    this._clipboard.set_content(St.ClipboardType.CLIPBOARD, entry.mime, new GLib.Bytes(data));
            } catch (e) {
                logError(e, 'clipboard-history: failed to set image');
            }
        }

        if (this._unpauseTimeoutId)
            GLib.source_remove(this._unpauseTimeoutId);
        this._unpauseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._pauseTracking = false;
            this._unpauseTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });

        if (paste && this._settings.get_boolean('paste-on-select'))
            this._schedulePaste();
    }

    _schedulePaste() {
        if (this._pasteTimeoutId)
            GLib.source_remove(this._pasteTimeoutId);
        this._pasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._pasteTimeoutId = 0;
            this._sendPaste();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendPaste() {
        try {
            if (!this._virtualKeyboard) {
                const seat = Clutter.get_default_backend().get_default_seat();
                this._virtualKeyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            }
            const vk = this._virtualKeyboard;
            const t = Clutter.get_current_event_time();
            vk.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            vk.notify_keyval(t, Clutter.KEY_v, Clutter.KeyState.PRESSED);
            vk.notify_keyval(t, Clutter.KEY_v, Clutter.KeyState.RELEASED);
            vk.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        } catch (e) {
            logError(e, 'clipboard-history: auto-paste failed (item is still on the clipboard)');
        }
    }

    _toggle() {
        if (!this._dialog)
            return;
        if (this._dialog._isOpen)
            this._dialog.close(global.get_current_time());
        else
            this._dialog.open(global.get_current_time());
    }

    _addKeybinding() {
        Main.wm.addKeybinding(
            KEYBINDING,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._toggle());
    }

    _removeKeybinding() {
        Main.wm.removeKeybinding(KEYBINDING);
    }

    _openPrefs() {
        try {
            if (ExtensionUtils.openPrefs) {
                ExtensionUtils.openPrefs();
                return;
            }
        } catch (_e) { /* fall through */ }
        try {
            GLib.spawn_command_line_async('gnome-extensions prefs ' + Me.metadata.uuid);
        } catch (e) {
            logError(e, 'clipboard-history: failed to open prefs');
        }
    }

    _buildIndicator() {
        this._destroyIndicator();
        if (!this._settings.get_boolean('show-indicator'))
            return;
        this._indicator = new ClipboardIndicator(this._store, {
            onActivate: entry => this._applyEntry(entry, true),
            onOpenFull: () => this._toggle(),
            onClear: () => this._store.clear(true),
            onSettings: () => this._openPrefs(),
        });
        Main.panel.addToStatusArea('clipboard-history', this._indicator);
    }

    _destroyIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

function init() {
    return new ClipboardHistoryExtension();
}
