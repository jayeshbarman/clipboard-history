// indicator.js (legacy, GNOME 3.36–44) — top-bar quick-access button.

const { GObject, St, Clutter } = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const RECENT_IN_MENU = 6;
const MENU_PREVIEW_CHARS = 48;

var ClipboardIndicator = GObject.registerClass(
class ClipboardIndicator extends PanelMenu.Button {
    _init(store, callbacks) {
        super._init(0.0, 'Clipboard History');
        this._store = store;
        this._cb = callbacks;

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
            entries.slice(0, RECENT_IN_MENU).forEach(entry => {
                const item = new PopupMenu.PopupMenuItem(this._preview(entry));
                if (entry.pinned)
                    item.add_child(new St.Icon({ icon_name: 'view-pin-symbolic', icon_size: 12 }));
                item.connect('activate', () => { if (this._cb.onActivate) this._cb.onActivate(entry); });
                this.menu.addMenuItem(item);
            });
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const openItem = new PopupMenu.PopupMenuItem('Open clipboard history');
        openItem.add_child(new St.Label({
            text: 'Super+V',
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
            style_class: 'clip-menu-accel',
        }));
        openItem.connect('activate', () => { if (this._cb.onOpenFull) this._cb.onOpenFull(); });
        this.menu.addMenuItem(openItem);

        const clearItem = new PopupMenu.PopupMenuItem('Clear history');
        clearItem.connect('activate', () => { if (this._cb.onClear) this._cb.onClear(); });
        this.menu.addMenuItem(clearItem);

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => { if (this._cb.onSettings) this._cb.onSettings(); });
        this.menu.addMenuItem(settingsItem);
    }
});
