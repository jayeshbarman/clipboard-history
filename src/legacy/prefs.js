// prefs.js (legacy, GNOME 3.36–44) — settings, built with plain GTK so it works
// on both GTK3 (3.36/3.38) and GTK4 (40–44) shells.

const { Gtk, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const SCHEMA_ID = 'org.gnome.shell.extensions.clipboard-history';

function getSettings() {
    const GioSSS = Gio.SettingsSchemaSource;
    const schemaDir = Me.dir.get_child('schemas');
    let source;
    if (schemaDir.query_exists(null))
        source = GioSSS.new_from_directory(schemaDir.get_path(), GioSSS.get_default(), false);
    else
        source = GioSSS.get_default();
    const schemaObj = source.lookup(SCHEMA_ID, true);
    return new Gio.Settings({ settings_schema: schemaObj });
}

function init() {}

function buildPrefsWidget() {
    const settings = getSettings();
    const gtk4 = Gtk.get_major_version() >= 4;

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        margin_top: 18, margin_bottom: 18, margin_start: 18, margin_end: 18,
    });
    const add = child => (gtk4 ? box.append(child) : box.pack_start(child, false, false, 0));

    const section = text => {
        const l = new Gtk.Label({ xalign: 0 });
        l.set_markup('<b>' + text + '</b>');
        add(l);
    };

    const switchRow = (key, labelText) => {
        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
        const label = new Gtk.Label({ label: labelText, xalign: 0, hexpand: true });
        const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        if (gtk4) {
            row.append(label);
            row.append(sw);
        } else {
            row.pack_start(label, true, true, 0);
            row.pack_end(sw, false, false, 0);
        }
        add(row);
    };

    section('Behaviour');
    switchRow('paste-on-select', 'Paste immediately (sends Ctrl+V)');
    switchRow('paste-as-plain-text', 'Always paste as plain text');
    switchRow('capture-images', 'Remember images');
    switchRow('private-mode', 'Pause history (private mode)');
    switchRow('notify-on-copy', 'Notify on copy');

    section('History');
    const histRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
    const histLabel = new Gtk.Label({ label: 'Items to keep', xalign: 0, hexpand: true });
    const adj = new Gtk.Adjustment({ lower: 5, upper: 500, step_increment: 5, page_increment: 25 });
    const spin = new Gtk.SpinButton({ adjustment: adj, valign: Gtk.Align.CENTER });
    spin.set_value(settings.get_int('history-size'));
    spin.connect('value-changed', () => settings.set_int('history-size', spin.get_value_as_int()));
    if (gtk4) {
        histRow.append(histLabel);
        histRow.append(spin);
    } else {
        histRow.pack_start(histLabel, true, true, 0);
        histRow.pack_end(spin, false, false, 0);
    }
    add(histRow);

    section('Appearance');
    switchRow('show-indicator', 'Show panel icon');

    section('Shortcut');
    const scRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12 });
    const scLabel = new Gtk.Label({ label: 'Open history', xalign: 0, hexpand: true });
    const entry = new Gtk.Entry({ valign: Gtk.Align.CENTER });
    entry.set_text((settings.get_strv('toggle-clipboard')[0]) || '');
    const setBtn = new Gtk.Button({ label: 'Set', valign: Gtk.Align.CENTER });
    setBtn.connect('clicked', () => {
        const text = entry.get_text().trim();
        settings.set_strv('toggle-clipboard', text ? [text] : []);
    });
    if (gtk4) {
        scRow.append(scLabel);
        scRow.append(entry);
        scRow.append(setBtn);
    } else {
        scRow.pack_start(scLabel, true, true, 0);
        scRow.pack_end(setBtn, false, false, 0);
        scRow.pack_end(entry, false, false, 0);
    }
    add(scRow);

    const hint = new Gtk.Label({ xalign: 0, wrap: true });
    hint.set_markup('<small>Use GTK accelerator syntax, e.g. <tt>&lt;Super&gt;v</tt>, ' +
        '<tt>&lt;Control&gt;&lt;Alt&gt;c</tt>. Leave blank to disable.</small>');
    add(hint);

    if (!gtk4 && box.show_all)
        box.show_all();

    return box;
}
