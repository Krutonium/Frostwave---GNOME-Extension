// SPDX-License-Identifier: GPL-2.0-or-later

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DesktopWidget} from './lib/desktopWidget.js';
import {Indicator} from './lib/indicator.js';
import {NowPlaying} from './lib/nowPlaying.js';

export default class FrostwaveExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._nowPlaying = new NowPlaying(this._settings);

        this._settingsIds = [
            this._settings.connect('changed::show-desktop-widget',
                () => this._syncDesktopWidget()),
            this._settings.connect('changed::show-panel-button',
                () => this._syncIndicator()),
            this._settings.connect('changed::panel-position', () => {
                this._destroyIndicator();
                this._syncIndicator();
            }),
        ];

        this._syncDesktopWidget();
        this._syncIndicator();
    }

    disable() {
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = null;

        this._desktopWidget?.destroy();
        this._desktopWidget = null;
        this._destroyIndicator();

        this._nowPlaying.destroy();
        this._nowPlaying = null;
        this._settings = null;
    }

    _syncDesktopWidget() {
        const show = this._settings.get_boolean('show-desktop-widget');

        if (show && !this._desktopWidget) {
            this._desktopWidget =
                new DesktopWidget(this, this._nowPlaying, this._settings);
        } else if (!show && this._desktopWidget) {
            this._desktopWidget.destroy();
            this._desktopWidget = null;
        }
    }

    _syncIndicator() {
        const show = this._settings.get_boolean('show-panel-button');

        if (show && !this._indicator) {
            this._indicator = new Indicator(this, this._nowPlaying, this._settings);
            Main.panel.addToStatusArea(this.uuid, this._indicator, 0,
                this._settings.get_string('panel-position'));
        } else if (!show) {
            this._destroyIndicator();
        }
    }

    _destroyIndicator() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
