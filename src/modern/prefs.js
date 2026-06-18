// prefs.js — settings window (libadwaita).

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClipboardHistoryPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 640);

        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Behaviour --------------------------------------------------------
        const behaviour = new Adw.PreferencesGroup({title: 'Behaviour'});
        page.add(behaviour);

        behaviour.add(this._switch(settings, 'paste-on-select',
            'Paste immediately', 'Type the item straight into the focused app (sends Ctrl+V).'));
        behaviour.add(this._switch(settings, 'paste-as-plain-text',
            'Always paste as plain text', 'Strip rich formatting when copying back.'));
        behaviour.add(this._switch(settings, 'capture-images',
            'Remember images', 'Keep copied images (up to 4 MB each) in history.'));
        behaviour.add(this._switch(settings, 'private-mode',
            'Pause history (private mode)', 'Stop recording new clipboard contents.'));
        behaviour.add(this._switch(settings, 'notify-on-copy',
            'Notify on copy', 'Show a brief notification whenever something is captured.'));

        // --- History ----------------------------------------------------------
        const history = new Adw.PreferencesGroup({title: 'History'});
        page.add(history);

        const spin = new Adw.SpinRow({
            title: 'Items to keep',
            subtitle: 'Maximum unpinned entries. Pinned items are always kept. (Windows keeps 25.)',
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 500, step_increment: 5, page_increment: 25,
                value: settings.get_int('history-size'),
            }),
        });
        history.add(spin);
        spin.connect('notify::value', () => {
            const v = Math.round(spin.get_value());
            if (v !== settings.get_int('history-size'))
                settings.set_int('history-size', v);
        });
        settings.connect('changed::history-size', () => {
            if (Math.round(spin.get_value()) !== settings.get_int('history-size'))
                spin.set_value(settings.get_int('history-size'));
        });

        // --- Appearance -------------------------------------------------------
        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        page.add(appearance);
        appearance.add(this._switch(settings, 'show-indicator',
            'Show panel icon', 'Show a clipboard icon in the top bar.'));

        // --- Shortcut ---------------------------------------------------------
        const shortcut = new Adw.PreferencesGroup({
            title: 'Shortcut',
            description: 'Key that opens the clipboard history (Windows uses Win+V).',
        });
        page.add(shortcut);

        const accelRow = new Adw.ActionRow({title: 'Open clipboard history'});
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: (settings.get_strv('toggle-clipboard')[0]) ?? '',
            valign: Gtk.Align.CENTER,
        });
        const changeBtn = new Gtk.Button({label: 'Change', valign: Gtk.Align.CENTER});
        const resetBtn = new Gtk.Button({
            icon_name: 'edit-undo-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Reset to Super+V',
        });
        accelRow.add_suffix(shortcutLabel);
        accelRow.add_suffix(changeBtn);
        accelRow.add_suffix(resetBtn);
        shortcut.add(accelRow);

        const refreshLabel = () => {
            shortcutLabel.set_accelerator(settings.get_strv('toggle-clipboard')[0] ?? '');
        };
        settings.connect('changed::toggle-clipboard', refreshLabel);

        resetBtn.connect('clicked', () => settings.set_strv('toggle-clipboard', ['<Super>v']));
        changeBtn.connect('clicked', () => this._captureShortcut(window, settings));
    }

    _switch(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _captureShortcut(parent, settings) {
        const dialog = new Adw.Window({
            modal: true,
            transient_for: parent,
            default_width: 400,
            default_height: 200,
            title: 'Set shortcut',
        });
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
            valign: Gtk.Align.CENTER,
        });
        box.append(new Gtk.Label({
            label: 'Press the new shortcut…\n(Esc to cancel, Backspace to clear)',
            justify: Gtk.Justification.CENTER,
        }));
        dialog.set_content(box);

        const controller = new Gtk.EventControllerKey();
        dialog.add_controller(controller);
        controller.connect('key-pressed', (_c, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (keyval === Gdk.KEY_Escape && mask === 0) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                settings.set_strv('toggle-clipboard', []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            // Require a modifier so we don't capture a bare letter.
            if (mask === 0)
                return Gdk.EVENT_STOP;

            const accel = Gtk.accelerator_name_with_keycode(null, keyval, _keycode, mask);
            if (accel) {
                settings.set_strv('toggle-clipboard', [accel]);
                dialog.close();
            }
            return Gdk.EVENT_STOP;
        });

        dialog.present();
    }
}
