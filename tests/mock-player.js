#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: GPL-2.0-or-later

// A fake Spotify MPRIS player for testing Frostwave without a real player.
// It owns org.mpris.MediaPlayer2.spotify on the session bus, so only run it
// inside a private bus (see tests/run-headless.sh).
//
// Usage: gjs -m tests/mock-player.js [ART_DIR]

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ROOT_XML = `<node><interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/>
  <method name="Quit"/>
  <property name="CanQuit" type="b" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
  <property name="HasTrackList" type="b" access="read"/>
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
</interface></node>`;

const PLAYER_XML = `<node><interface name="org.mpris.MediaPlayer2.Player">
  <method name="Next"/>
  <method name="Previous"/>
  <method name="Pause"/>
  <method name="PlayPause"/>
  <method name="Stop"/>
  <method name="Play"/>
  <method name="Seek"><arg direction="in" name="Offset" type="x"/></method>
  <method name="SetPosition">
    <arg direction="in" name="TrackId" type="o"/>
    <arg direction="in" name="Position" type="x"/>
  </method>
  <method name="OpenUri"><arg direction="in" name="Uri" type="s"/></method>
  <signal name="Seeked"><arg name="Position" type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="LoopStatus" type="s" access="readwrite"/>
  <property name="Rate" type="d" access="readwrite"/>
  <property name="Shuffle" type="b" access="readwrite"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Volume" type="d" access="readwrite"/>
  <property name="Position" type="x" access="read"/>
  <property name="MinimumRate" type="d" access="read"/>
  <property name="MaximumRate" type="d" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
</interface></node>`;

const artDir = ARGV[0] ?? GLib.get_tmp_dir();

/** Writes a diagonal two-color gradient PNG and returns its file URI. */
function makeCover(name, from, to) {
    const size = 640;
    const pixels = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const t = (x + y) / (2 * size);
            const ring = Math.hypot(x - size * 0.62, y - size * 0.38) < size * 0.22 ? 0.35 : 0;
            for (let c = 0; c < 3; c++) {
                const value = from[c] + (to[c] - from[c]) * t;
                pixels[(y * size + x) * 3 + c] = Math.min(255, value + ring * (255 - value));
            }
        }
    }
    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(pixels),
        GdkPixbuf.Colorspace.RGB, false, 8, size, size, size * 3);
    const path = GLib.build_filenamev([artDir, `${name}.png`]);
    pixbuf.savev(path, 'png', [], []);
    return GLib.filename_to_uri(path, null);
}

const TRACKS = [
    {
        id: '/com/spotify/track/0001', title: 'Northern Lights', artist: ['Aurora Fields'],
        album: 'Polar Nights', length: 215e6, art: makeCover('cover-1', [24, 70, 160], [140, 40, 170]),
    },
    {
        id: '/com/spotify/track/0002', title: 'A Very Long Song Title That Should Be Ellipsized Nicely',
        artist: ['Glass Animals', 'Frost Ensemble'], album: 'Remote Art', length: 187e6,
        // Downloaded over HTTPS (Lorem Picsum redirects to its CDN)
        art: 'https://picsum.photos/id/1043/640/640',
    },
    {
        id: '/com/spotify/track/0003', title: 'Untitled (no artwork)', artist: ['Unknown Artist'],
        album: '', length: 98e6, art: '',
    },
    {
        id: '/com/spotify/track/0004', title: 'Ember', artist: ['Coastline'],
        album: 'Warm Front', length: 243e6, art: makeCover('cover-4', [230, 120, 30], [170, 30, 40]),
    },
];

class MockPlayer {
    constructor(loop) {
        this._loop = loop;
        this._index = 0;
        this._status = 'Playing';
        this._shuffle = false;
        this._loopStatus = 'None';
        this._volume = 0.7;
        this._position = 30e6;
        this._positionTime = GLib.get_monotonic_time();

        this._root = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, {
            Raise: () => print('mock: Raise'),
            Quit: () => this._loop.quit(),
            CanQuit: true,
            CanRaise: true,
            HasTrackList: false,
            Identity: 'Spotify',
            DesktopEntry: 'spotify',
        });

        const self = this;
        this._player = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, {
            Next: () => this._skip(1),
            Previous: () => this._skip(-1),
            Pause: () => this._setStatus('Paused'),
            Play: () => this._setStatus('Playing'),
            Stop: () => this._setStatus('Stopped'),
            PlayPause: () => this._setStatus(this._status === 'Playing' ? 'Paused' : 'Playing'),
            Seek: offset => this._seek(this.position + offset),
            SetPosition: (trackId, position) => {
                if (trackId === TRACKS[this._index].id)
                    this._seek(position);
            },
            OpenUri: () => {},
            get PlaybackStatus() {
                return self._status;
            },
            get LoopStatus() {
                return self._loopStatus;
            },
            set LoopStatus(value) {
                self._loopStatus = value;
                self._changed('LoopStatus', new GLib.Variant('s', value));
            },
            Rate: 1.0,
            get Shuffle() {
                return self._shuffle;
            },
            set Shuffle(value) {
                self._shuffle = value;
                self._changed('Shuffle', new GLib.Variant('b', value));
            },
            get Metadata() {
                return self._metadata();
            },
            get Volume() {
                return self._volume;
            },
            set Volume(value) {
                self._volume = value;
                self._changed('Volume', new GLib.Variant('d', value));
            },
            get Position() {
                return Math.round(self.position);
            },
            MinimumRate: 1.0,
            MaximumRate: 1.0,
            CanGoNext: true,
            CanGoPrevious: true,
            CanPlay: true,
            CanPause: true,
            CanSeek: true,
            CanControl: true,
        });
    }

    export(connection) {
        this._root.export(connection, '/org/mpris/MediaPlayer2');
        this._player.export(connection, '/org/mpris/MediaPlayer2');
    }

    get position() {
        let position = this._position;
        if (this._status === 'Playing')
            position += GLib.get_monotonic_time() - this._positionTime;
        return Math.min(position, TRACKS[this._index].length);
    }

    _metadata() {
        const track = TRACKS[this._index];
        const metadata = {
            'mpris:trackid': new GLib.Variant('o', track.id),
            'mpris:length': new GLib.Variant('t', track.length),
            'xesam:title': new GLib.Variant('s', track.title),
            'xesam:artist': new GLib.Variant('as', track.artist),
            'xesam:album': new GLib.Variant('s', track.album),
            'xesam:url': new GLib.Variant('s', `https://open.spotify.com/track/${track.id.split('/').pop()}`),
        };
        if (track.art)
            metadata['mpris:artUrl'] = new GLib.Variant('s', track.art);
        return metadata;
    }

    _changed(name, value) {
        print(`mock: ${name} = ${value.print(false)}`);
        this._player.emit_property_changed(name, value);
    }

    _setStatus(status) {
        this._position = this.position;
        this._positionTime = GLib.get_monotonic_time();
        this._status = status;
        this._changed('PlaybackStatus', new GLib.Variant('s', status));
    }

    _skip(delta) {
        this._index = (this._index + delta + TRACKS.length) % TRACKS.length;
        this._position = 0;
        this._positionTime = GLib.get_monotonic_time();
        this._changed('Metadata', new GLib.Variant('a{sv}', this._metadata()));
    }

    _seek(position) {
        this._position = Math.max(0, Math.min(position, TRACKS[this._index].length));
        this._positionTime = GLib.get_monotonic_time();
        print(`mock: seek to ${Math.round(this._position / 1e6)}s`);
        this._player.emit_signal('Seeked', new GLib.Variant('(x)', [Math.round(this._position)]));
    }
}

const loop = new GLib.MainLoop(null, false);
const player = new MockPlayer(loop);

Gio.bus_own_name(Gio.BusType.SESSION, 'org.mpris.MediaPlayer2.spotify',
    Gio.BusNameOwnerFlags.NONE,
    connection => player.export(connection),
    () => print('mock: owning org.mpris.MediaPlayer2.spotify'),
    () => {
        printerr('mock: could not own the bus name');
        loop.quit();
    });

loop.run();
