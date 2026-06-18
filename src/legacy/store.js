// store.js (legacy, GNOME 3.36–44) — clipboard history data model + persistence.
// Logic is identical to the modern variant; only the module syntax differs.

const { GObject, GLib, Gio } = imports.gi;

const SCHEMA_VERSION = 1;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB, same ceiling Windows uses

var ClipboardStore = GObject.registerClass({
    Signals: { 'changed': {} },
}, class ClipboardStore extends GObject.Object {
    _init(params = {}) {
        super._init();

        this._maxItems = params.maxItems || 25;
        this._captureImages = params.captureImages !== false;

        this._dataDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'clipboard-history']);
        this._imageDir = GLib.build_filenamev([this._dataDir, 'images']);
        this._file = GLib.build_filenamev([this._dataDir, 'history.json']);
        GLib.mkdir_with_parents(this._imageDir, 0o700);

        this._entries = [];
        this._nextId = 1;
        this._saveSourceId = 0;

        this._load();
    }

    get entries() {
        return this._entries;
    }

    setMaxItems(n) {
        this._maxItems = n;
        if (this._enforceLimit())
            this.emit('changed');
    }

    setCaptureImages(v) {
        this._captureImages = v;
    }

    _now() {
        return GLib.get_real_time() / 1000;
    }

    addText(text) {
        if (text === null || text === undefined)
            return;
        if (text.length === 0)
            return;

        const idx = this._entries.findIndex(e => e.type === 'text' && e.text === text);
        if (idx === 0)
            return;
        if (idx > 0) {
            const removed = this._entries.splice(idx, 1)[0];
            removed.ts = this._now();
            this._entries.unshift(removed);
            this._scheduleSave();
            this.emit('changed');
            return;
        }

        this._entries.unshift({
            id: this._nextId++,
            type: 'text',
            text,
            pinned: false,
            ts: this._now(),
        });
        this._enforceLimit();
        this._scheduleSave();
        this.emit('changed');
    }

    addImage(bytes, mime) {
        if (!this._captureImages)
            return;
        const size = bytes.get_size();
        if (size === 0 || size > MAX_IMAGE_BYTES)
            return;

        const hash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);

        const idx = this._entries.findIndex(e => e.type === 'image' && e.hash === hash);
        if (idx === 0)
            return;
        if (idx > 0) {
            const removed = this._entries.splice(idx, 1)[0];
            removed.ts = this._now();
            this._entries.unshift(removed);
            this._scheduleSave();
            this.emit('changed');
            return;
        }

        const ext = this._extForMime(mime);
        const imagePath = GLib.build_filenamev([this._imageDir, hash + '.' + ext]);
        try {
            const f = Gio.File.new_for_path(imagePath);
            if (!f.query_exists(null)) {
                f.replace_contents(bytes.get_data(), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            }
        } catch (e) {
            logError(e, 'clipboard-history: failed to save image');
            return;
        }

        this._entries.unshift({
            id: this._nextId++,
            type: 'image',
            imagePath,
            mime,
            hash,
            size,
            pinned: false,
            ts: this._now(),
        });
        this._enforceLimit();
        this._scheduleSave();
        this.emit('changed');
    }

    _extForMime(mime) {
        switch (mime) {
        case 'image/png': return 'png';
        case 'image/jpeg': return 'jpg';
        case 'image/bmp': return 'bmp';
        case 'image/gif': return 'gif';
        case 'image/tiff': return 'tiff';
        case 'image/webp': return 'webp';
        default: return 'bin';
        }
    }

    getById(id) {
        return this._entries.find(e => e.id === id) || null;
    }

    togglePin(id) {
        const e = this.getById(id);
        if (!e)
            return;
        e.pinned = !e.pinned;
        this._sort();
        this._scheduleSave();
        this.emit('changed');
    }

    remove(id) {
        const idx = this._entries.findIndex(e => e.id === id);
        if (idx < 0)
            return;
        this._deleteEntry(this._entries[idx]);
        this._entries.splice(idx, 1);
        this._scheduleSave();
        this.emit('changed');
    }

    clear(keepPinned = true) {
        const kept = [];
        for (const e of this._entries) {
            if (keepPinned && e.pinned)
                kept.push(e);
            else
                this._deleteEntry(e);
        }
        this._entries = kept;
        this._scheduleSave();
        this.emit('changed');
    }

    _deleteEntry(e) {
        if (e.type === 'image' && e.imagePath) {
            const stillUsed = this._entries.some(o => o !== e && o.imagePath === e.imagePath);
            if (!stillUsed) {
                try {
                    Gio.File.new_for_path(e.imagePath).delete(null);
                } catch (_e) {
                    // already gone — ignore
                }
            }
        }
    }

    _sort() {
        this._entries.sort((a, b) => {
            if (a.pinned !== b.pinned)
                return a.pinned ? -1 : 1;
            return b.ts - a.ts;
        });
    }

    _enforceLimit() {
        const unpinned = this._entries.filter(e => !e.pinned);
        if (unpinned.length <= this._maxItems)
            return false;
        const overflow = unpinned.slice(this._maxItems);
        for (const e of overflow) {
            const idx = this._entries.indexOf(e);
            this._deleteEntry(e);
            this._entries.splice(idx, 1);
        }
        return true;
    }

    _scheduleSave() {
        if (this._saveSourceId)
            return;
        this._saveSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._saveSourceId = 0;
            this._save();
            return GLib.SOURCE_REMOVE;
        });
    }

    _save() {
        const data = {
            version: SCHEMA_VERSION,
            nextId: this._nextId,
            entries: this._entries.map(e => {
                const o = { id: e.id, type: e.type, pinned: e.pinned, ts: e.ts };
                if (e.type === 'text') {
                    o.text = e.text;
                } else {
                    o.imagePath = e.imagePath;
                    o.mime = e.mime;
                    o.hash = e.hash;
                    o.size = e.size;
                }
                return o;
            }),
        };
        try {
            const bytes = new TextEncoder().encode(JSON.stringify(data));
            GLib.file_set_contents(this._file, bytes);
        } catch (e) {
            logError(e, 'clipboard-history: failed to save history');
        }
    }

    _load() {
        if (!GLib.file_test(this._file, GLib.FileTest.EXISTS))
            return;
        try {
            const [ok, contents] = GLib.file_get_contents(this._file);
            if (!ok)
                return;
            const data = JSON.parse(new TextDecoder().decode(contents));
            const entries = [];
            for (const e of (data.entries || [])) {
                if (e.type === 'image') {
                    if (!e.imagePath || !GLib.file_test(e.imagePath, GLib.FileTest.EXISTS))
                        continue;
                }
                entries.push(e);
            }
            this._entries = entries;
            this._nextId = Math.max(data.nextId || 1, ...entries.map(e => e.id + 1), 1);
            this._sort();
            this._enforceLimit();
        } catch (e) {
            logError(e, 'clipboard-history: failed to load history');
        }
    }

    flush() {
        if (this._saveSourceId) {
            GLib.source_remove(this._saveSourceId);
            this._saveSourceId = 0;
        }
        this._save();
    }

    destroy() {
        this.flush();
        this._entries = [];
    }
});
