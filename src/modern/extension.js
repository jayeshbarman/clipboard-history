// extension.js — controller. Monitors the clipboard, owns the history store,
// registers the Super+V shortcut, draws the panel icon, and pastes selections.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClipboardStore} from './store.js';
import {ClipboardDialog} from './dialog.js';
import {ClipboardIndicator} from './indicator.js';

const KEYBINDING = 'toggle-clipboard';
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/tiff', 'image/webp'];
// Mimetypes apps use to ask clipboard managers not to record a value.
const IGNORE_HINTS = ['x-kde-passwordManagerHint', 'application/x-nautilus-clipboard'];

export default class ClipboardHistoryExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._store = new ClipboardStore({
            maxItems: this._settings.get_int('history-size'),
            captureImages: this._settings.get_boolean('capture-images'),
        });

        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._pauseTracking = false;
        this._pasteTimeoutId = 0;
        this._unpauseTimeoutId = 0;

        this._selectionOwnerChangedId = this._selection.connect('owner-changed',
            (_sel, type) => {
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

        this._buildIndicator();
        this._addKeybinding();

        // React to settings changes live.
        this._settingsIds = [
            this._settings.connect('changed::history-size',
                () => this._store.setMaxItems(this._settings.get_int('history-size'))),
            this._settings.connect('changed::capture-images',
                () => this._store.setCaptureImages(this._settings.get_boolean('capture-images'))),
            this._settings.connect('changed::show-indicator',
                () => this._buildIndicator()),
        ];

        // Seed history with whatever is currently on the clipboard.
        this._onClipboardChanged();
    }

    disable() {
        this._removeKeybinding();

        if (this._selectionOwnerChangedId) {
            this._selection.disconnect(this._selectionOwnerChangedId);
            this._selectionOwnerChangedId = 0;
        }

        for (const id of (this._settingsIds ?? []))
            this._settings.disconnect(id);
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

        this._dialog?.destroy();
        this._dialog = null;

        this._store?.destroy();
        this._store = null;

        this._virtualKeyboard = null;
        this._clipboard = null;
        this._selection = null;
        this._settings = null;
    }

    // ----- clipboard monitoring ----------------------------------------------

    _onClipboardChanged() {
        if (this._pauseTracking)
            return;
        if (this._settings.get_boolean('private-mode'))
            return;

        let mimetypes = [];
        try {
            mimetypes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
        } catch (_e) {
            mimetypes = [];
        }

        if (mimetypes.some(m => IGNORE_HINTS.includes(m)))
            return;

        const hasText = mimetypes.some(m =>
            m.startsWith('text/') || m === 'UTF8_STRING' || m === 'STRING' || m === 'TEXT');
        const imageMime = IMAGE_MIMES.find(m => mimetypes.includes(m));

        if (hasText) {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_cb, text) => {
                if (text)
                    this._store.addText(text);
                else if (imageMime)
                    this._grabImage(imageMime);
            });
        } else if (imageMime) {
            this._grabImage(imageMime);
        }
    }

    _grabImage(mime) {
        this._clipboard.get_content(St.ClipboardType.CLIPBOARD, mime, (_cb, bytes) => {
            if (bytes && bytes.get_size() > 0)
                this._store.addImage(bytes, mime);
        });
    }

    // ----- applying a chosen entry -------------------------------------------

    _applyEntry(entry, paste) {
        // Avoid recording our own write as a brand-new clip.
        this._pauseTracking = true;

        if (entry.type === 'text') {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, entry.text);
        } else {
            try {
                const [ok, data] = GLib.file_get_contents(entry.imagePath);
                if (ok) {
                    this._clipboard.set_content(St.ClipboardType.CLIPBOARD, entry.mime,
                        new GLib.Bytes(data));
                }
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
        // Give the closing dialog time to hand keyboard focus back to the app.
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

    // ----- UI / shortcut ------------------------------------------------------

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

    _buildIndicator() {
        this._destroyIndicator();
        if (!this._settings.get_boolean('show-indicator'))
            return;
        this._indicator = new ClipboardIndicator(this._store, {
            onActivate: entry => this._applyEntry(entry, true),
            onOpenFull: () => this._toggle(),
            onClear: () => this._store.clear(true),
            onSettings: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _destroyIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
