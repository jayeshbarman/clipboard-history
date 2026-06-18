// dialog.js — the Super+V popup: a searchable, keyboard-navigable list of
// clipboard history entries, modelled on the Windows 10/11 clipboard flyout.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const PREVIEW_CHARS = 140;

export const ClipboardDialog = GObject.registerClass(
class ClipboardDialog extends ModalDialog.ModalDialog {
    _init(store, callbacks) {
        super._init({styleClass: 'clip-dialog', destroyOnClose: false});

        this._store = store;
        this._cb = callbacks;           // {onActivate, onTogglePin, onRemove, onClear, onTogglePrivate, isPrivate}
        this._rows = [];                // [{entry, actor}] for the currently shown (filtered) list
        this._selected = -1;

        this._buildUI();

        this._storeChangedId = this._store.connect('changed', () => {
            if (this._isOpen)
                this._refresh();
        });
        this._isOpen = false;
    }

    _buildUI() {
        // ModalDialog gives us this.contentLayout (a vertical St.BoxLayout).
        const content = this.contentLayout;
        content.style_class = 'clip-content';

        // Header: title + private-mode toggle.
        const header = new St.BoxLayout({style_class: 'clip-header'});
        const title = new St.Label({text: 'Clipboard', style_class: 'clip-title', y_align: Clutter.ActorAlign.CENTER});
        header.add_child(title);
        const spacer = new St.Widget({x_expand: true});
        header.add_child(spacer);

        this._privateBtn = new St.Button({
            style_class: 'clip-header-btn',
            child: new St.Icon({icon_name: 'eye-not-looking-symbolic', icon_size: 16}),
            can_focus: false,
        });
        this._privateBtn.connect('clicked', () => {
            this._cb.onTogglePrivate?.();
            this._syncPrivate();
        });
        header.add_child(this._privateBtn);
        content.add_child(header);

        // Search box.
        this._search = new St.Entry({
            style_class: 'clip-search',
            hint_text: 'Type to search…',
            can_focus: true,
            x_expand: true,
        });
        this._search.set_primary_icon(new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 14}));
        content.add_child(this._search);

        const clutterText = this._search.clutter_text;
        clutterText.connect('text-changed', () => this._refresh());
        clutterText.connect('key-press-event', (_a, event) => this._onKeyPress(event));

        // Scrollable list.
        this._scroll = new St.ScrollView({
            style_class: 'clip-scroll',
            x_expand: true,
            y_expand: true,
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._list = new St.BoxLayout({style_class: 'clip-list', x_expand: true});
        // `orientation` replaced the older `vertical` prop around GNOME 48 — set
        // whichever this shell supports rather than risk a construct-time throw.
        if ('orientation' in this._list)
            this._list.orientation = Clutter.Orientation.VERTICAL;
        else
            this._list.vertical = true;
        // ScrollView became single-child (set_child) in GNOME 46; 45 still used add_actor.
        if (this._scroll.set_child)
            this._scroll.set_child(this._list);
        else
            this._scroll.add_actor(this._list);
        content.add_child(this._scroll);

        // Empty-state placeholder.
        this._empty = new St.Label({
            text: 'Clipboard history is empty.\nCopy something and it will show up here.',
            style_class: 'clip-empty',
        });
        this._empty.clutter_text.line_wrap = true;
        content.add_child(this._empty);

        // Bottom buttons.
        this.addButton({
            label: 'Clear all',
            action: () => this._cb.onClear?.(),
            key: null,
        });
        this.addButton({
            label: 'Close',
            action: () => this.close(global.get_current_time()),
            key: Clutter.KEY_Escape,
            default: false,
        });
    }

    _syncPrivate() {
        const on = this._cb.isPrivate?.() ?? false;
        this._privateBtn.child.icon_name = on ? 'eye-not-looking-symbolic' : 'eye-open-negative-filled-symbolic';
        if (on)
            this._privateBtn.add_style_class_name('active');
        else
            this._privateBtn.remove_style_class_name('active');
    }

    // ----- list rendering -----------------------------------------------------

    _previewText(text) {
        // Collapse whitespace runs to keep one tidy line, then truncate.
        let s = text.replace(/\s+/g, ' ').trim();
        if (s.length > PREVIEW_CHARS)
            s = s.slice(0, PREVIEW_CHARS) + '…';
        return s || '(whitespace)';
    }

    _humanSize(n) {
        if (n < 1024)
            return `${n} B`;
        if (n < 1024 * 1024)
            return `${Math.round(n / 1024)} KB`;
        return `${(n / 1024 / 1024).toFixed(1)} MB`;
    }

    _makeRow(entry, index) {
        const row = new St.BoxLayout({
            style_class: 'clip-item',
            reactive: true,
            track_hover: true,
            can_focus: false,
            x_expand: true,
        });

        // Content (icon/thumbnail + text).
        const body = new St.BoxLayout({style_class: 'clip-item-body', x_expand: true});

        if (entry.type === 'image') {
            const thumb = new St.Icon({
                gicon: Gio.FileIcon.new(Gio.File.new_for_path(entry.imagePath)),
                icon_size: 48,
                style_class: 'clip-thumb',
            });
            body.add_child(thumb);
            const label = new St.Label({
                text: `Image · ${this._humanSize(entry.size ?? 0)}`,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clip-item-text',
            });
            body.add_child(label);
        } else {
            const icon = new St.Icon({
                icon_name: 'edit-paste-symbolic',
                icon_size: 16,
                style_class: 'clip-item-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            body.add_child(icon);
            const label = new St.Label({
                text: this._previewText(entry.text),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clip-item-text',
            });
            label.clutter_text.single_line_mode = true;
            label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
            body.add_child(label);
        }
        row.add_child(body);

        // Pin button.
        const pinBtn = new St.Button({
            style_class: 'clip-item-action' + (entry.pinned ? ' pinned' : ''),
            child: new St.Icon({
                icon_name: entry.pinned ? 'view-pin-symbolic' : 'view-pin-symbolic',
                icon_size: 14,
            }),
            can_focus: false,
        });
        pinBtn.connect('clicked', () => {
            this._cb.onTogglePin?.(entry.id);
            return Clutter.EVENT_STOP;
        });
        row.add_child(pinBtn);

        // Delete button.
        const delBtn = new St.Button({
            style_class: 'clip-item-action',
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 14}),
            can_focus: false,
        });
        delBtn.connect('clicked', () => {
            this._cb.onRemove?.(entry.id);
            return Clutter.EVENT_STOP;
        });
        row.add_child(delBtn);

        // Activate (paste) when the row body is clicked.
        row.connect('button-release-event', () => {
            this._activate(entry);
            return Clutter.EVENT_STOP;
        });
        row.connect('enter-event', () => {
            this._setSelected(index);
            return Clutter.EVENT_PROPAGATE;
        });

        return row;
    }

    _refresh() {
        const query = this._search.get_text().toLowerCase().trim();
        this._list.remove_all_children();
        this._rows = [];

        let entries = this._store.entries;
        if (query) {
            entries = entries.filter(e =>
                e.type === 'text'
                    ? e.text.toLowerCase().includes(query)
                    : 'image'.includes(query));
        }

        this._empty.visible = entries.length === 0;
        this._scroll.visible = entries.length > 0;

        entries.forEach((entry, i) => {
            const row = this._makeRow(entry, i);
            this._list.add_child(row);
            this._rows.push({entry, actor: row});
        });

        let initial = entries.length > 0 ? 0 : -1;
        if (this._pendingSelect !== undefined && entries.length > 0) {
            initial = Math.max(0, Math.min(entries.length - 1, this._pendingSelect));
            this._pendingSelect = undefined;
        }
        this._selected = -1;
        this._setSelected(initial);
    }

    _setSelected(index) {
        if (this._selected >= 0 && this._selected < this._rows.length)
            this._rows[this._selected].actor.remove_style_class_name('selected');
        this._selected = index;
        if (index >= 0 && index < this._rows.length) {
            const actor = this._rows[index].actor;
            actor.add_style_class_name('selected');
            this._ensureVisible(actor);
        }
    }

    _moveSelection(delta) {
        if (this._rows.length === 0)
            return;
        let i = this._selected + delta;
        i = Math.max(0, Math.min(this._rows.length - 1, i));
        this._setSelected(i);
    }

    _ensureVisible(actor) {
        const adj = this._scroll.vadjustment;
        if (!adj)
            return;
        if (this._scrollIdleId)
            GLib.source_remove(this._scrollIdleId);
        // Defer until the actor has a valid allocation.
        this._scrollIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._scrollIdleId = 0;
            const box = actor.get_allocation_box();
            const y1 = box.y1, y2 = box.y2;
            if (y1 < adj.value)
                adj.value = y1;
            else if (y2 > adj.value + adj.page_size)
                adj.value = y2 - adj.page_size;
            return GLib.SOURCE_REMOVE;
        });
    }

    _activate(entry) {
        this.close(global.get_current_time());
        this._cb.onActivate?.(entry);
    }

    _onKeyPress(event) {
        const sym = event.get_key_symbol();
        switch (sym) {
        case Clutter.KEY_Up:
            this._moveSelection(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveSelection(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._moveSelection(-5);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._moveSelection(5);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            if (this._selected >= 0 && this._selected < this._rows.length)
                this._activate(this._rows[this._selected].entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Escape:
            this.close(global.get_current_time());
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Delete:
            if (this._selected >= 0 && this._selected < this._rows.length) {
                const sel = this._selected;
                this._cb.onRemove?.(this._rows[sel].entry.id);
                // Keep selection near where it was after the list rebuilds.
                this._pendingSelect = sel;
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    open(timestamp) {
        this._isOpen = true;
        this._search.set_text('');
        super.open(timestamp ?? global.get_current_time());
        this._refresh();
        this._syncPrivate();
        // Focus the search box so typing filters immediately.
        global.stage.set_key_focus(this._search.clutter_text);
        return true;
    }

    close(timestamp) {
        this._isOpen = false;
        super.close(timestamp ?? global.get_current_time());
    }

    destroy() {
        if (this._scrollIdleId) {
            GLib.source_remove(this._scrollIdleId);
            this._scrollIdleId = 0;
        }
        if (this._storeChangedId) {
            this._store.disconnect(this._storeChangedId);
            this._storeChangedId = 0;
        }
        super.destroy();
    }
});
