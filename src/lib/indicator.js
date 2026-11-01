// SPDX-License-Identifier: GPL-2.0-or-later

// Top bar button that shows the current song and opens the player in a menu.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {PlayerView} from './playerView.js';

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    /**
     * @param {import('resource:///org/gnome/shell/extensions/extension.js').Extension} extension
     * @param {import('./nowPlaying.js').NowPlaying} nowPlaying
     * @param {Gio.Settings} settings
     */
    constructor(extension, nowPlaying, settings) {
        super(0.5, _('Frostwave'));

        this._nowPlaying = nowPlaying;
        this._settings = settings;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this.add_child(box);

        box.add_child(new St.Icon({
            gicon: Gio.FileIcon.new(
                extension.dir.resolve_relative_path('icons/frostwave-symbolic.svg')),
            style_class: 'system-status-icon',
        }));

        this._label = new St.Label({
            style_class: 'frostwave-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._label);

        // Added directly instead of as a menu item: inactive items get dimmed
        const view = new PlayerView(nowPlaying, settings);
        view.add_style_class_name('frostwave-menu-view');
        this.menu.box.add_child(view);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Preferences'), () => extension.openPreferences());

        nowPlaying.connectObject('changed', () => this._sync(), this);
        settings.connectObject(
            'changed::panel-show-title', () => this._sync(),
            'changed::hide-when-inactive', () => this._sync(),
            this);
        this._sync();
    }

    _sync() {
        const player = this._nowPlaying.player;

        this.visible = player !== null ||
            !this._settings.get_boolean('hide-when-inactive');

        const text = player
            ? [player.title, player.artists.join(', ')].filter(Boolean).join(' · ')
            : '';
        this._label.text = text;
        this._label.visible = text !== '' &&
            this._settings.get_boolean('panel-show-title');
    }
});
