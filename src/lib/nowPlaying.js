// SPDX-License-Identifier: GPL-2.0-or-later

// Shared state for all views: the active player, its artwork and position.

import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {ArtworkLoader} from './artwork.js';
import {PlayerManager, isCancelled} from './mpris.js';

const POSITION_UPDATE_MS = 1000;

// Snap, Flatpak and distribution packages of the Spotify client
const SPOTIFY_APP_IDS = [
    'spotify_spotify.desktop',
    'com.spotify.Client.desktop',
    'spotify.desktop',
];

function createImageContent(pixbuf) {
    const coglContext = global.stage.context.get_backend().get_cogl_context();
    const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
    content.set_bytes(coglContext, pixbuf.read_pixel_bytes(),
        Cogl.PixelFormat.RGBA_8888, pixbuf.width, pixbuf.height, pixbuf.rowstride);
    return content;
}

export const NowPlaying = GObject.registerClass({
    Signals: {
        'changed': {},
        'artwork-changed': {},
        'position-changed': {},
    },
}, class NowPlaying extends GObject.Object {
    constructor(settings) {
        super();

        this._settings = settings;
        this._artworkLoader = new ArtworkLoader();
        this._artworkUrl = '';
        this._artworkCancellable = null;
        this._positionHolds = 0;
        this._positionTimeoutId = 0;

        /** @type {Clutter.Content|null} */
        this.artworkContent = null;
        /** @type {number[]|null} [r, g, b] accent color of the artwork */
        this.artworkColor = null;

        this._manager = new PlayerManager();
        this._manager.includeOtherPlayers = settings.get_boolean('other-players');
        this._manager.connectObject(
            'changed', () => this._onPlayerChanged(),
            'position-changed', () => this.emit('position-changed'),
            this);
        settings.connectObject('changed::other-players', () => {
            this._manager.includeOtherPlayers = settings.get_boolean('other-players');
        }, this);
        this._manager.start();
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._manager.disconnectObject(this);
        this._manager.destroy();
        this._artworkCancellable?.cancel();
        this._artworkLoader.destroy();
        if (this._positionTimeoutId) {
            GLib.source_remove(this._positionTimeoutId);
            this._positionTimeoutId = 0;
        }
        this.artworkContent = null;
    }

    /** @type {import('./mpris.js').MprisPlayer|null} */
    get player() {
        return this._manager.activePlayer;
    }

    /** @type {Shell.App|null} the installed Spotify app, if any */
    get spotifyApp() {
        const appSystem = Shell.AppSystem.get_default();
        for (const id of SPOTIFY_APP_IDS) {
            const app = appSystem.lookup_app(id);
            if (app)
                return app;
        }
        return null;
    }

    /**
     * Brings the player's window to the front, or starts Spotify.
     */
    showPlayer() {
        const player = this.player;
        if (player?.canRaise) {
            player.raise();
            return;
        }

        const appSystem = Shell.AppSystem.get_default();
        const entry = player?.desktopEntry;
        const app = entry
            ? appSystem.lookup_app(`${entry}.desktop`) ??
              appSystem.lookup_app(`${entry}_${entry}.desktop`)
            : null;
        (app ?? this.spotifyApp)?.activate();
    }

    /**
     * Views call this while they are visible, so the position is only polled
     * when someone is looking at it.
     */
    holdPositionUpdates() {
        this._positionHolds++;
        this._syncPositionUpdates();
    }

    releasePositionUpdates() {
        this._positionHolds = Math.max(this._positionHolds - 1, 0);
        this._syncPositionUpdates();
    }

    _syncPositionUpdates() {
        const needed = this._positionHolds > 0 && !!this.player?.playing;

        if (needed && !this._positionTimeoutId) {
            this._positionTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                POSITION_UPDATE_MS, () => {
                    this.player?.refreshPosition();
                    this.emit('position-changed');
                    return GLib.SOURCE_CONTINUE;
                });
        } else if (!needed && this._positionTimeoutId) {
            GLib.source_remove(this._positionTimeoutId);
            this._positionTimeoutId = 0;
        }
    }

    _onPlayerChanged() {
        this._updateArtwork();
        this._syncPositionUpdates();
        this.emit('changed');
    }

    async _updateArtwork() {
        const url = this.player?.artUrl ?? '';
        if (url === this._artworkUrl)
            return;

        this._artworkUrl = url;
        this._artworkCancellable?.cancel();
        this._artworkCancellable = null;

        if (!url) {
            this._setArtwork(null);
            return;
        }

        // Keep showing the previous cover until the new one is ready
        const cancellable = new Gio.Cancellable();
        this._artworkCancellable = cancellable;
        try {
            const artwork = await this._artworkLoader.load(url, cancellable);
            if (!cancellable.is_cancelled())
                this._setArtwork(artwork);
        } catch (e) {
            if (isCancelled(e) || cancellable.is_cancelled())
                return;
            console.debug(`Frostwave: could not load artwork: ${e.message}`);
            this._setArtwork(null);
        }
    }

    _setArtwork(artwork) {
        this.artworkContent = artwork ? createImageContent(artwork.pixbuf) : null;
        this.artworkColor = artwork?.color ?? null;
        this.emit('artwork-changed');
    }
});
