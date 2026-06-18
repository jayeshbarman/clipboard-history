// indicator.js — top-bar button giving quick access to recent clips and actions.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const RECENT_IN_MENU = 6;
const MENU_PREVIEW_CHARS = 48;

export const ClipboardIndicator = GObject.registerClass(
class ClipboardIndicator extends PanelMenu.Button {
    _init(store, callbacks) {
        super._init(0.0, 'Clipboard History');
        this._store = store;
        this._cb = callbacks; // {onActivate, onOpenFull, onClear, onSettings}

        this.add_child(new St.Icon({
            icon_name: 'edit-paste-symbolic',
            style_class: 'system-status-icon',
        }));

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuild();
        });
        this._rebuild();
    }

    _preview(entry) {
        if (entry.type === 'image')
            return '🖼  Image';
        let s = entry.text.replace(/\s+/g, ' ').trim();
        if (s.length > MENU_PREVIEW_CHARS)
            s = s.slice(0, MENU_PREVIEW_CHARS) + '…';
        return s || '(whitespace)';
    }

    _rebuild() {
        this.menu.removeAll();

        const entries = this._store.entries;
        if (entries.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('Clipboard history is empty');
            empty.setSensitive(false);
            this.menu.addMenuItem(empty);
        } else {
            for (const entry of entries.slice(0, RECENT_IN_MENU)) {
                const item = new PopupMenu.PopupMenuItem(this._preview(entry));
                if (entry.pinned) {
                    const pin = new St.Icon({icon_name: 'view-pin-symbolic', icon_size: 12});
                    item.add_child(pin);
                }
                item.connect('activate', () => this._cb.onActivate?.(entry));
                this.menu.addMenuItem(item);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const openItem = new PopupMenu.PopupMenuItem('Open clipboard history');
        openItem.add_child(new St.Label({
            text: 'Super+V',
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
            style_class: 'clip-menu-accel',
        }));
        openItem.connect('activate', () => this._cb.onOpenFull?.());
        this.menu.addMenuItem(openItem);

        const clearItem = new PopupMenu.PopupMenuItem('Clear history');
        clearItem.connect('activate', () => this._cb.onClear?.());
        this.menu.addMenuItem(clearItem);

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => this._cb.onSettings?.());
        this.menu.addMenuItem(settingsItem);
    }
});
