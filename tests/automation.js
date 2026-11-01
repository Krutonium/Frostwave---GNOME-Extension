// SPDX-License-Identifier: GPL-2.0-or-later

// GNOME Shell automation script used by tests/run-headless.sh. It runs inside
// the shell, drives the widget with a virtual pointer and takes screenshots.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};

const UUID = GLib.getenv('FROSTWAVE_UUID');
const OUTPUT = GLib.getenv('FROSTWAVE_OUTPUT');

let pointer = null;
let failures = 0;

function log(message) {
    print(`TEST: ${message}`);
}

function check(condition, message) {
    if (condition) {
        log(`PASS ${message}`);
    } else {
        failures++;
        log(`FAIL ${message}`);
    }
}

function extension() {
    return Main.extensionManager.lookup(UUID)?.stateObj;
}

function widget() {
    return extension()._desktopWidget;
}

function view() {
    return widget()._view;
}

function player() {
    return extension()._nowPlaying.player;
}

function settings() {
    return extension()._settings;
}

async function screenshot(name) {
    await Scripting.sleep(400);
    await Scripting.waitLeisure();
    const file = Gio.File.new_for_path(`${OUTPUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
    log(`screenshot ${name}.png`);
}

function now() {
    return GLib.get_monotonic_time();
}

async function moveTo(x, y) {
    pointer.notify_absolute_motion(now(), x, y);
    await Scripting.sleep(30);
}

async function clickAt(x, y, button = Clutter.BUTTON_PRIMARY) {
    await moveTo(x, y);
    pointer.notify_button(now(), button, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(60);
    pointer.notify_button(now(), button, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(500);
}

function pointIn(actor, fx = 0.5, fy = 0.5) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x + width * fx, y + height * fy];
}

async function click(actor, fx, fy, button) {
    const [x, y] = pointIn(actor, fx, fy);
    await clickAt(x, y, button);
}

async function drag(fromX, fromY, toX, toY) {
    await moveTo(fromX, fromY);
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(50);
    const steps = 20;
    for (let i = 1; i <= steps; i++)
        await moveTo(fromX + (toX - fromX) * i / steps, fromY + (toY - fromY) * i / steps);
    pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(500);
}

function frostwaveActors() {
    const found = [];
    const visit = actor => {
        if (actor.has_style_class_name?.('frostwave-desktop') ||
            actor.has_style_class_name?.('frostwave-view'))
            found.push(actor);
        actor.get_children().forEach(visit);
    };
    visit(Main.layoutManager.uiGroup);
    return found;
}

function windowStackIndex(actor) {
    return global.window_group.get_children().indexOf(actor);
}

async function waitFor(condition, timeout = 10000) {
    const start = GLib.get_monotonic_time();
    while (!condition()) {
        if (GLib.get_monotonic_time() - start > timeout * 1000)
            return false;
        await Scripting.sleep(100);
    }
    return true;
}

async function step(name, func) {
    try {
        await func();
    } catch (e) {
        failures++;
        log(`FAIL ${name}: ${e.message}\n${e.stack}`);
    }
}

export async function run() {
    pointer = Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

    Main.overview.hide();
    await Scripting.sleep(3500);

    const desktopWindows = global.get_window_actors()
        .filter(a => a.meta_window.get_window_type() === Meta.WindowType.DESKTOP);
    log(`desktop icon windows: ${desktopWindows.length}`);

    await step('initial state', async () => {
        check(extension() !== undefined, 'extension is loaded');
        check(player()?.identity === 'Spotify', 'mock Spotify player is active');
        check(view()._titleLabel.text === 'Northern Lights', `title shown (${view()._titleLabel.text})`);
        check(view()._coverImage.visible, 'cover art is shown');
        const [x, y] = widget().get_transformed_position();
        log(`widget at ${x},${y} size ${widget().get_size()}`);
        await screenshot('01-glass-dark');
    });

    await step('play/pause', async () => {
        await click(view()._playButton);
        check(player().status === 'Paused', `paused after click (${player().status})`);
        await screenshot('02-paused');
        await click(view()._playButton);
        check(player().status === 'Playing', 'playing again');
    });

    await step('next track', async () => {
        await click(view()._nextButton);
        await Scripting.sleep(2500);
        check(view()._titleLabel.text.startsWith('A Very Long'), `next track (${view()._titleLabel.text})`);
        check(view()._coverImage.visible, 'downloaded cover art is shown');
        await screenshot('03-next-track');
    });

    await step('shuffle and repeat', async () => {
        await click(view()._shuffleButton);
        check(player().shuffle === true, 'shuffle on');
        check(view()._shuffleButton.checked, 'shuffle button checked');
        await click(view()._repeatButton);
        check(player().loopStatus === 'Playlist', `repeat playlist (${player().loopStatus})`);
        await click(view()._repeatButton);
        check(player().loopStatus === 'Track', `repeat track (${player().loopStatus})`);
        await screenshot('04-shuffle-repeat');
    });

    await step('seek', async () => {
        await click(view()._seekSlider, 0.75, 0.5);
        await Scripting.sleep(500);
        const ratio = player().position / player().length;
        check(Math.abs(ratio - 0.75) < 0.05, `seeked to ${ratio.toFixed(2)}`);
    });

    await step('volume', async () => {
        await click(view()._volumeSlider, 0.25, 0.5);
        await Scripting.sleep(400);
        check(Math.abs(player().volume - 0.25) < 0.08, `volume ${player().volume?.toFixed(2)}`);
        await click(view()._muteButton);
        await Scripting.sleep(300);
        check(player().volume === 0, 'muted');
        await click(view()._muteButton);
        await Scripting.sleep(300);
        check(player().volume > 0.2, `unmuted (${player().volume?.toFixed(2)})`);
    });

    await step('drag', async () => {
        const [startX, startY] = pointIn(view()._titleLabel, 0.5, 0.5);
        const [beforeX, beforeY] = widget().get_position();
        await drag(startX, startY, startX - 600, startY + 250);
        const [afterX, afterY] = widget().get_position();
        check(Math.abs(afterX - beforeX + 600) < 2 && Math.abs(afterY - beforeY - 250) < 2,
            `moved from ${beforeX},${beforeY} to ${afterX},${afterY}`);
        check(settings().get_int('widget-x') === afterX + 24, `position saved (${settings().get_int('widget-x')})`);
        await screenshot('05-dragged');
    });

    await step('appearance variants', async () => {
        settings().set_string('background-style', 'artwork');
        settings().set_string('tint', 'adaptive');
        await screenshot('07-artwork');
        settings().set_string('background-style', 'glass');
        await screenshot('08-glass-adaptive');
        settings().set_string('tint', 'light');
        settings().set_int('background-opacity', 55);
        await screenshot('09-glass-light');
        settings().set_string('tint', 'dark');
        settings().set_int('background-opacity', 10);
        settings().set_int('blur-radius', 0);
        await screenshot('10-clear-glass');
        settings().reset('background-opacity');
        settings().reset('blur-radius');
        settings().set_int('widget-scale', 130);
        await screenshot('11-scale-130');
        settings().reset('widget-scale');
    });

    await step('stacking below windows', async () => {
        await Scripting.createTestWindow({width: 700, height: 420});
        await Scripting.waitTestWindows();
        await Scripting.sleep(800);
        const windows = global.get_window_actors();
        const widgetIndex = windowStackIndex(widget());
        const windowIndex = windowStackIndex(windows[windows.length - 1]);
        check(widgetIndex >= 0 && widgetIndex < windowIndex,
            `widget (${widgetIndex}) below test window (${windowIndex})`);
        const testWindow = windows[windows.length - 1].meta_window;
        testWindow.move_frame(true, widget().x + 150, widget().y + 60);
        await screenshot('06-window-over-widget');
        testWindow.minimize();
        await Scripting.sleep(500);
    });

    await step('above windows', async () => {
        const [testWindow] = global.get_window_actors().map(a => a.meta_window)
            .filter(w => w.minimized);
        testWindow?.unminimize();
        await Scripting.sleep(400);
        settings().set_string('widget-layer', 'above');
        await Scripting.sleep(400);
        check(widget().get_parent() === Main.layoutManager.uiGroup, 'widget moved to the chrome layer');
        await screenshot('12-above-windows');
        settings().set_string('widget-layer', 'desktop');
        await Scripting.sleep(400);
        check(widget().get_parent() === global.window_group, 'widget back on the desktop');
        testWindow?.move_frame(true, 1010, 560);
        await Scripting.sleep(400);
    });

    await step('panel menu', async () => {
        const indicator = extension()._indicator;
        check(indicator?._label.text.includes('A Very Long'), `panel label (${indicator?._label.text})`);
        indicator.menu.open();
        await screenshot('13-panel-menu');
        indicator.menu.close();
        await Scripting.sleep(400);
    });

    await step('context menu', async () => {
        await click(view()._titleLabel, 0.5, 0.5, Clutter.BUTTON_SECONDARY);
        check(widget()._menu.isOpen, 'context menu opened');
        await screenshot('14-context-menu');
        widget()._menu.close();
        await Scripting.sleep(400);
    });

    await step('copy link', async () => {
        await click(view()._copyButton);
        const text = await new Promise(resolve => {
            St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
                (_clipboard, clipboardText) => resolve(clipboardText));
        });
        check(text === 'https://open.spotify.com/track/0002', `clipboard (${text})`);
        check(view()._copyButton.icon_name === 'object-select-symbolic', 'copy feedback shown');
    });

    await step('hide from context menu', async () => {
        await click(view()._titleLabel, 0.5, 0.5, Clutter.BUTTON_SECONDARY);
        const hideItem = widget()._menu._getMenuItems()
            .find(item => item.label?.text === 'Hide Widget');
        await click(hideItem);
        await Scripting.sleep(500);
        check(!settings().get_boolean('show-desktop-widget'), 'show-desktop-widget turned off');
        check(extension()._desktopWidget === null, 'widget destroyed');
        settings().set_boolean('show-desktop-widget', true);
        await Scripting.sleep(800);
        check(view()?._titleLabel.text.startsWith('A Very Long'), 'widget shown again');
    });

    await step('disable and enable', async () => {
        await Main.extensionManager.disableExtension(UUID);
        // Extensions loaded after this one are re-enabled asynchronously;
        // let that finish before enabling again
        await Scripting.sleep(4000);
        check(frostwaveActors().length === 0, `no actors left after disable (${frostwaveActors().length})`);
        check(!Main.panel.statusArea[UUID], 'indicator removed');
        await Main.extensionManager.enableExtension(UUID);
        // Other extensions are re-enabled first, which can take a moment
        check(await waitFor(() => widget()?._view), 'enabled again');
        await Scripting.sleep(1000);
        check(view()._titleLabel.text.startsWith('A Very Long'), 'state restored after enable');
    });

    await step('player quits', async () => {
        // The mock exits without replying, so don't wait for an answer
        Gio.DBus.session.call('org.mpris.MediaPlayer2.spotify', '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2', 'Quit', null, null, Gio.DBusCallFlags.NONE, -1, null,
            () => {});
        await Scripting.sleep(1500);
        check(player() === null, 'no active player after quit');
        check(view()._titleLabel.text === 'Nothing playing', `idle title (${view()._titleLabel.text})`);
        await screenshot('15-not-running');
        settings().set_boolean('hide-when-inactive', true);
        await Scripting.sleep(600);
        check(!widget()._box.visible, 'widget hidden without a player');
        check(!extension()._indicator.visible, 'indicator hidden without a player');
        settings().set_boolean('hide-when-inactive', false);
        await Scripting.sleep(600);
    });

    await step('preferences', async () => {
        extension().openPreferences();
        await Scripting.sleep(4000);
        const prefsWindow = global.get_window_actors().map(a => a.meta_window)
            .find(w => w.get_title()?.includes('Frostwave'));
        check(prefsWindow !== undefined, 'preferences window opened');
        prefsWindow?.move_frame(true, 40, 40);
        await screenshot('16-preferences');
    });

    log(`finished with ${failures} failure(s)`);
}
