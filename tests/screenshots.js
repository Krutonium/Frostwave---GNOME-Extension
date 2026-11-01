// SPDX-License-Identifier: GPL-2.0-or-later

// Automation script that renders screenshots of each background style:
//   AUTOMATION_SCRIPT=tests/screenshots.js tests/run-headless.sh build/style-screenshots

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

const UUID = GLib.getenv('FROSTWAVE_UUID');
const OUTPUT = GLib.getenv('FROSTWAVE_OUTPUT');
const MARGIN = 8;

function extension() {
    return Main.extensionManager.lookup(UUID).stateObj;
}

async function capture(name, area = null) {
    await Scripting.sleep(600);
    await Scripting.waitLeisure();

    const file = Gio.File.new_for_path(`${OUTPUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    const shooter = new Shell.Screenshot();
    if (area)
        await shooter.screenshot_area(...area, stream);
    else
        await shooter.screenshot(false, stream);
    stream.close(null);
}

function widgetArea() {
    const widget = extension()._desktopWidget;
    const [x, y] = widget.get_transformed_position();
    const [width, height] = widget.get_transformed_size();
    return [x + MARGIN, y + MARGIN, width - 2 * MARGIN, height - 2 * MARGIN].map(Math.round);
}

async function nextTrack() {
    extension()._nowPlaying.player.next();
    await Scripting.sleep(2500);
}

export async function run() {
    Main.overview.hide();
    await Scripting.sleep(3500);

    const settings = extension()._settings;
    settings.set_int('widget-x', 1100);
    settings.set_int('widget-y', 120);

    await capture('desktop');
    await capture('glass-dark', widgetArea());

    await nextTrack();
    settings.set_string('tint', 'adaptive');
    await capture('glass-adaptive', widgetArea());

    await nextTrack();
    await nextTrack();
    settings.set_string('tint', 'light');
    settings.set_int('background-opacity', 55);
    await capture('glass-light', widgetArea());

    settings.set_string('background-style', 'artwork');
    settings.set_string('tint', 'dark');
    settings.set_int('background-opacity', 70);
    await capture('artwork', widgetArea());

    settings.reset('background-style');
    settings.reset('background-opacity');
    const indicator = extension()._indicator;
    indicator.menu.open();
    await Scripting.sleep(400);
    const [x, y] = indicator.menu.actor.get_transformed_position();
    const [width, height] = indicator.menu.actor.get_transformed_size();
    await capture('panel-menu', [x, 0, width, y + height].map(Math.round));
    indicator.menu.close();
}
