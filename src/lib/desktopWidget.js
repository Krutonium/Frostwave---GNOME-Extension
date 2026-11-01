// SPDX-License-Identifier: GPL-2.0-or-later

// The frosted glass widget that lives on the desktop.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {RoundedCornersEffect} from './effects.js';
import {PlayerView} from './playerView.js';

// Space around the card for its drop shadow
const SHADOW_SIZE = 24;
const SHADOW_OFFSET_Y = 4;
// Distance from the top right corner of the work area by default
const DEFAULT_MARGIN = 32;
const BASE_FONT_SIZE = 14;
// Album art needs some blur to keep the text readable
const MIN_ARTWORK_BLUR = 24;
const DRAG_THRESHOLD = 4;
const FADE_TIME = 250;

const TINT_COLORS = {
    dark: [0.08, 0.08, 0.1],
    light: [0.97, 0.97, 0.98],
};

function roundedRectangle(cr, x, y, width, height, radius) {
    radius = Math.max(0, Math.min(radius, width / 2, height / 2));
    cr.newSubPath();
    cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

/**
 * A dark shade of the color with the same hue, so light text stays readable.
 *
 * @param {number[]} rgb - [r, g, b], 0-255
 * @returns {number[]} [r, g, b], 0-1
 */
function darkShade([r, g, b]) {
    [r, g, b] = [r / 255, g / 255, b / 255];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;

    let hue = 0;
    if (delta > 0) {
        if (max === r)
            hue = ((g - b) / delta) % 6;
        else if (max === g)
            hue = (b - r) / delta + 2;
        else
            hue = (r - g) / delta + 4;
    }
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    // Back to RGB with a fixed, low lightness
    const l = 0.22;
    const s = Math.min(saturation, 0.6);
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const x = chroma * (1 - Math.abs((hue % 2 + 2) % 2 - 1));
    const m = l - chroma / 2;
    const sector = Math.floor(((hue % 6) + 6) % 6);
    const [r1, g1, b1] = [
        [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
        [0, x, chroma], [x, 0, chroma], [chroma, 0, x],
    ][sector];
    return [r1 + m, g1 + m, b1 + m];
}

/**
 * Moves a rectangle into the work area of the monitor it is mostly on.
 *
 * @returns {number[]} the new [x, y]
 */
function clampToWorkArea(x, y, width, height) {
    const {monitors, primaryIndex} = Main.layoutManager;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    let index = monitors.findIndex(m =>
        centerX >= m.x && centerX < m.x + m.width &&
        centerY >= m.y && centerY < m.y + m.height);
    if (index < 0)
        index = primaryIndex;

    const area = Main.layoutManager.getWorkAreaForMonitor(index);
    return [
        Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
        Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    ];
}

/**
 * Holds the clone of what is behind the widget and the album art. It is
 * larger than the widget, so the blur doesn't fade out towards the edges.
 */
const BlurBox = GObject.registerClass(
class BlurBox extends St.Widget {
    constructor() {
        super({clip_to_allocation: true});

        this._origin = [0, 0];

        this._clone = new Clutter.Clone();
        this.add_child(this._clone);

        this._artwork = new St.Widget();
        this.add_child(this._artwork);
    }

    get clone() {
        return this._clone;
    }

    get artwork() {
        return this._artwork;
    }

    /**
     * @param {number} x - stage position of this box
     * @param {number} y - stage position of this box
     */
    setOrigin(x, y) {
        this._origin = [x, y];
        this.queue_relayout();
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        // Keep the clone aligned with the original on the stage. Its size
        // must match the source, or Clutter scales it.
        const [x, y] = this._origin;
        const [sourceWidth, sourceHeight] = this._clone.source?.get_size() ?? [0, 0];
        this._clone.allocate(Clutter.ActorBox.new(-x, -y, sourceWidth - x, sourceHeight - y));

        // Cover the whole box with the (square) album art
        const width = box.get_width();
        const height = box.get_height();
        const side = Math.max(width, height);
        const artX = (width - side) / 2;
        const artY = (height - side) / 2;
        this._artwork.allocate(Clutter.ActorBox.new(artX, artY, artX + side, artY + side));
    }
});

/**
 * The blurred background of the card, clipped to its rounded shape.
 */
const Backdrop = GObject.registerClass(
class Backdrop extends St.Widget {
    constructor() {
        super({clip_to_allocation: true, x_expand: true, y_expand: true});

        this._margin = 0;
        this._stageX = 0;
        this._stageY = 0;

        this._corners = new RoundedCornersEffect();
        this.add_effect(this._corners);

        this._blurBox = new BlurBox();
        this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, brightness: 1});
        this._blurBox.add_effect(this._blur);
        this.add_child(this._blurBox);
    }

    /**
     * @param {Clutter.Actor} source - actor to show blurred behind the widget
     */
    setSource(source) {
        this._blurBox.clone.source = source;
        this._blurBox.queue_relayout();
    }

    /**
     * @param {number} x - stage position of the backdrop
     * @param {number} y - stage position of the backdrop
     */
    setStageOrigin(x, y) {
        this._stageX = x;
        this._stageY = y;
        this._blurBox.setOrigin(x - this._margin, y - this._margin);
    }

    /**
     * @param {object} params
     * @param {number} params.radius - corner radius
     * @param {number} params.blur - blur radius in logical pixels
     * @param {boolean} params.showClone - whether to show what's behind
     * @param {Clutter.Content|null} params.artwork - album art to show
     * @param {number} params.artworkOpacity - 0-1
     */
    update({radius, blur, showClone, artwork, artworkOpacity}) {
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        this._corners.radius = radius;
        this._blur.radius = blur * scaleFactor;
        this._blur.enabled = blur > 0;
        this._margin = Math.ceil(blur * 1.5);

        this._blurBox.clone.visible = showClone;
        this._blurBox.artwork.content = artwork;
        this._blurBox.artwork.visible = artwork !== null;
        this._blurBox.artwork.opacity = Math.round(255 * artworkOpacity);
        this.visible = showClone || artwork !== null;

        this.setStageOrigin(this._stageX, this._stageY);
        this.queue_relayout();
    }

    // The card is sized by its content; the cloned desktop must not count
    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const m = this._margin;
        this._blurBox.allocate(Clutter.ActorBox.new(
            -m, -m, box.get_width() + m, box.get_height() + m));
    }
});

export const DesktopWidget = GObject.registerClass(
class DesktopWidget extends St.Widget {
    /**
     * @param {import('resource:///org/gnome/shell/extensions/extension.js').Extension} extension
     * @param {import('./nowPlaying.js').NowPlaying} nowPlaying
     * @param {Gio.Settings} settings
     */
    constructor(extension, nowPlaying, settings) {
        super({
            style_class: 'frostwave-desktop',
            layout_manager: new Clutter.BinLayout(),
        });

        this._extension = extension;
        this._nowPlaying = nowPlaying;
        this._settings = settings;
        this._layer = null;
        this._shown = false;
        this._radius = 0;
        this._tintColor = TINT_COLORS.dark;
        this._tintAlpha = 0;
        this._lightTheme = false;
        this._dragStart = null;
        this._grab = null;
        this._clampLaterId = 0;
        this._restackLaterId = 0;
        this._hideIdleId = 0;
        this._displayIds = [];
        this._overviewIds = [];
        this._watchedWindows = new Set();

        // Shadow and card, faded in and out together
        this._box = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            opacity: 0,
            visible: false,
        });
        this.add_child(this._box);

        this._shadow = new St.DrawingArea({x_expand: true, y_expand: true});
        this._shadow.connect('repaint', () => this._drawShadow());
        this._box.add_child(this._shadow);

        // St overrides actor margins with the CSS ones, so set them as style
        this._card = new St.Widget({
            style_class: 'frostwave-card',
            style: `margin: ${SHADOW_SIZE}px;`,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        this._card.connect('notify::size', () => {
            this._shadow.queue_repaint();
            this._tint.queue_repaint();
            this._queueClamp();
        });
        this._box.add_child(this._card);

        this._backdrop = new Backdrop();
        this._card.add_child(this._backdrop);

        this._tint = new St.DrawingArea({x_expand: true, y_expand: true});
        this._tint.connect('repaint', () => this._drawTint());
        this._card.add_child(this._tint);

        this._view = new PlayerView(nowPlaying, settings);
        this._card.add_child(this._view);

        this._setupGestures();
        this._setupMenu();

        nowPlaying.connectObject(
            'changed', () => this._syncVisibility(),
            'artwork-changed', () => this._updateAppearance(),
            this);
        settings.connectObject(
            'changed::widget-layer', () => this._attach(),
            'changed::widget-x', () => this._restorePosition(),
            'changed::widget-y', () => this._restorePosition(),
            'changed::lock-position', () => this._syncLock(),
            'changed::widget-scale', () => this._updateAppearance(),
            'changed::background-style', () => this._updateAppearance(),
            'changed::tint', () => this._updateAppearance(),
            'changed::background-opacity', () => this._updateAppearance(),
            'changed::blur-radius', () => this._updateAppearance(),
            'changed::corner-radius', () => this._updateAppearance(),
            'changed::hide-when-inactive', () => this._syncVisibility(),
            this);
        Main.layoutManager.connectObject('monitors-changed',
            () => this._restorePosition(), this);
        global.display.connectObject('workareas-changed',
            () => this._restorePosition(), this);

        this.connect('destroy', () => this._onDestroy());

        this._updateAppearance();
        this._syncLock();
        this._attach();
    }

    _setupGestures() {
        this._panGesture = new Clutter.PanGesture({
            required_button: Clutter.BUTTON_PRIMARY,
        });
        this._panGesture.set_begin_threshold(DRAG_THRESHOLD);
        this._panGesture.connect('recognize', () => this._onDragBegin());
        this._panGesture.connect('pan-update', () => this._onDragUpdate());
        this._panGesture.connect('end', () => this._onDragEnd());
        this._panGesture.connect('cancel', () => this._onDragEnd());
        this._card.add_action(this._panGesture);

        const menuGesture = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        menuGesture.connect('recognize', () => {
            const {x, y} = menuGesture.get_coords_abs();
            this._openMenu(x, y);
        });
        this._card.add_action(menuGesture);
    }

    _setupMenu() {
        this._menu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0, St.Side.TOP);

        this._lockItem = new PopupMenu.PopupSwitchMenuItem(_('Lock Position'), false);
        this._lockItem.connect('toggled', (_item, state) => {
            this._settings.set_boolean('lock-position', state);
        });
        this._menu.addMenuItem(this._lockItem);
        this._menu.addAction(_('Reset Position'), () => {
            this._settings.reset('widget-x');
            this._settings.reset('widget-y');
        });
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction(_('Hide Widget'), () => {
            // Hiding destroys the widget and this menu, so wait until the
            // menu is done handling the click
            this._hideIdleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._hideIdleId = 0;
                this._settings.set_boolean('show-desktop-widget', false);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._menu.addAction(_('Preferences'), () => this._extension.openPreferences());

        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        this._menuManager = new PopupMenu.PopupMenuManager(this._card);
        this._menuManager.addMenu(this._menu);
    }

    _openMenu(x, y) {
        this._lockItem.setToggleState(this._settings.get_boolean('lock-position'));
        Main.layoutManager.setDummyCursorGeometry(x, y, 0, 0);
        this._menu.open(BoxPointer.PopupAnimation.FULL);
    }

    /**
     * Puts the widget either on the desktop (between the wallpaper and the
     * windows) or above all windows, depending on the settings.
     */
    _attach() {
        const layer = this._settings.get_string('widget-layer');
        if (layer === this._layer)
            return;

        this._detach();
        this._layer = layer;

        if (layer === 'above') {
            Main.layoutManager.addChrome(this, {trackFullscreen: true});
            // Below the top bar and its menus
            Main.layoutManager.uiGroup.set_child_below_sibling(this, Main.layoutManager.panelBox);
            this._overviewIds = [
                Main.overview.connect('showing', () => this._syncVisibility()),
                Main.overview.connect('hidden', () => this._syncVisibility()),
            ];
            this._backdrop.setSource(global.window_group);
        } else {
            global.window_group.add_child(this);
            this._displayIds = [
                global.display.connect('restacked', () => this._restack()),
                global.display.connect('window-created',
                    (_display, window) => this._watchWindow(window)),
            ];
            global.display.list_all_windows().forEach(window => this._watchWindow(window));
            this._restack();
            this._backdrop.setSource(Main.layoutManager._backgroundGroup);
        }

        this._restorePosition();
        this._syncVisibility();
    }

    _detach() {
        this._disconnectLayerSignals();

        if (this._layer === 'above')
            Main.layoutManager.removeChrome(this);
        else if (this._layer === 'desktop')
            global.window_group.remove_child(this);

        this._layer = null;
    }

    _disconnectLayerSignals() {
        this._displayIds.forEach(id => global.display.disconnect(id));
        this._displayIds = [];
        this._overviewIds.forEach(id => Main.overview.disconnect(id));
        this._overviewIds = [];

        this._watchedWindows.forEach(window => window.disconnectObject(this));
        this._watchedWindows.clear();

        if (this._restackLaterId) {
            global.compositor.get_laters().remove(this._restackLaterId);
            this._restackLaterId = 0;
        }
    }

    /**
     * Desktop icon windows only move to the desktop layer after they appear,
     * which doesn't always change the stacking order (and emit 'restacked').
     *
     * @param {Meta.Window} window
     */
    _watchWindow(window) {
        if (this._watchedWindows.has(window))
            return;

        this._watchedWindows.add(window);
        window.connectObject(
            'notify::window-type', () => this._queueRestack(),
            'unmanaged', () => {
                window.disconnectObject(this);
                this._watchedWindows.delete(window);
            },
            this);
        this._queueRestack();
    }

    _queueRestack() {
        if (this._restackLaterId)
            return;

        this._restackLaterId = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._restackLaterId = 0;
                this._restack();
                return GLib.SOURCE_REMOVE;
            });
    }

    /**
     * Stays above the wallpaper and windows in the desktop and "always below"
     * layers (such as the desktop icons), but below all regular windows.
     */
    _restack() {
        const windowGroup = global.window_group;
        if (this.get_parent() !== windowGroup)
            return;

        // The children are in stacking order. global.get_window_actors() isn't
        // used because the desktop icons extension hides its window from it.
        let sibling = Main.layoutManager._backgroundGroup;
        for (const actor of windowGroup.get_children()) {
            if (actor instanceof Meta.WindowActor &&
                actor.meta_window.get_layer() <= Meta.StackLayer.BOTTOM)
                sibling = actor;
        }

        if (this.get_previous_sibling() !== sibling)
            windowGroup.set_child_above_sibling(this, sibling);
    }

    _syncVisibility() {
        const inactive = this._settings.get_boolean('hide-when-inactive') &&
            !this._nowPlaying.player;
        const hiddenByOverview = this._layer === 'above' && Main.overview.visible;
        const shown = !inactive && !hiddenByOverview;

        if (shown === this._shown)
            return;
        this._shown = shown;

        this._box.remove_all_transitions();
        this._card.reactive = shown;
        if (shown) {
            this._box.show();
            this._box.ease({
                opacity: 255,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._box.ease({
                opacity: 0,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: isFinished => {
                    if (isFinished)
                        this._box.hide();
                },
            });
        }
    }

    _syncLock() {
        this._panGesture.enabled = !this._settings.get_boolean('lock-position');
    }

    _updateAppearance() {
        const scale = this._settings.get_int('widget-scale') / 100;
        const tint = this._settings.get_string('tint');
        const opacity = this._settings.get_int('background-opacity') / 100;
        const blur = this._settings.get_int('blur-radius');
        const artwork = this._settings.get_string('background-style') === 'artwork'
            ? this._nowPlaying.artworkContent : null;

        this.style = `font-size: ${Math.round(BASE_FONT_SIZE * scale)}px;`;
        this._radius = this._settings.get_int('corner-radius') * scale;

        this._lightTheme = tint === 'light';
        if (this._lightTheme)
            this.add_style_class_name('frostwave-light');
        else
            this.remove_style_class_name('frostwave-light');

        this._backdrop.update({
            radius: this._radius,
            blur: artwork ? Math.max(blur, MIN_ARTWORK_BLUR) : blur,
            showClone: blur > 0,
            artwork,
            artworkOpacity: opacity,
        });

        const artworkColor = this._nowPlaying.artworkColor;
        this._tintColor = tint === 'adaptive' && artworkColor
            ? darkShade(artworkColor)
            : TINT_COLORS[tint] ?? TINT_COLORS.dark;
        // Over album art the tint only needs to keep the text readable
        if (artwork)
            this._tintAlpha = this._lightTheme ? 0.45 : 0.3;
        else
            this._tintAlpha = opacity;

        this._tint.queue_repaint();
        this._shadow.queue_repaint();
        this._queueClamp();
    }

    _drawShadow() {
        const cr = this._shadow.get_context();
        const [width, height] = this._shadow.get_surface_size();
        const cardWidth = width - 2 * SHADOW_SIZE;
        const cardHeight = height - 2 * SHADOW_SIZE;

        if (cardWidth > 0 && cardHeight > 0) {
            // Stacked, slightly larger rounded rectangles approximate a blur
            const steps = 10;
            const maxSpread = SHADOW_SIZE - SHADOW_OFFSET_Y;
            for (let i = steps; i > 0; i--) {
                const spread = maxSpread * i / steps;
                roundedRectangle(cr,
                    SHADOW_SIZE - spread, SHADOW_SIZE + SHADOW_OFFSET_Y - spread,
                    cardWidth + 2 * spread, cardHeight + 2 * spread,
                    this._radius + spread);
                cr.setSourceRGBA(0, 0, 0, 0.025);
                cr.fill();
            }

            // Keep the area under the card clear, it may be translucent
            cr.setOperator(Cairo.Operator.CLEAR);
            roundedRectangle(cr, SHADOW_SIZE, SHADOW_SIZE, cardWidth, cardHeight, this._radius);
            cr.fill();
        }

        cr.$dispose();
    }

    _drawTint() {
        const cr = this._tint.get_context();
        const [width, height] = this._tint.get_surface_size();
        const [red, green, blue] = this._tintColor;

        roundedRectangle(cr, 0, 0, width, height, this._radius);
        cr.setSourceRGBA(red, green, blue, this._tintAlpha);
        cr.fillPreserve();

        // A soft highlight towards the top, like light catching the glass
        const sheen = new Cairo.LinearGradient(0, 0, 0, height);
        sheen.addColorStopRGBA(0, 1, 1, 1, this._lightTheme ? 0.25 : 0.08);
        sheen.addColorStopRGBA(0.6, 1, 1, 1, 0);
        cr.setSource(sheen);
        cr.fill();

        roundedRectangle(cr, 0.5, 0.5, width - 1, height - 1, this._radius - 0.5);
        cr.setSourceRGBA(1, 1, 1, this._lightTheme ? 0.5 : 0.15);
        cr.setLineWidth(1);
        cr.stroke();

        cr.$dispose();
    }

    _moveTo(x, y) {
        this.set_position(x, y);
        this._backdrop.setStageOrigin(x + SHADOW_SIZE, y + SHADOW_SIZE);
    }

    _cardSize() {
        // Includes the margins reserved for the shadow
        const [, , width, height] = this._card.get_preferred_size();
        return [width - 2 * SHADOW_SIZE, height - 2 * SHADOW_SIZE];
    }

    _restorePosition() {
        if (!this._layer || this._dragStart || Main.layoutManager.primaryIndex < 0)
            return;

        const [width, height] = this._cardSize();
        let x = this._settings.get_int('widget-x');
        let y = this._settings.get_int('widget-y');

        if (x < 0 || y < 0) {
            const area = Main.layoutManager.getWorkAreaForMonitor(
                Main.layoutManager.primaryIndex);
            x = area.x + area.width - width - DEFAULT_MARGIN;
            y = area.y + DEFAULT_MARGIN;
        }

        [x, y] = clampToWorkArea(x, y, width, height);
        this._moveTo(x - SHADOW_SIZE, y - SHADOW_SIZE);
    }

    _queueClamp() {
        if (this._clampLaterId)
            return;

        // Size changes are noticed during allocation, so move afterwards
        this._clampLaterId = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._clampLaterId = 0;
                this._restorePosition();
                return GLib.SOURCE_REMOVE;
            });
    }

    _onDragBegin() {
        const pointer = this._panGesture.get_begin_centroid_abs();
        this._dragStart = {x: this.x, y: this.y, pointerX: pointer.x, pointerY: pointer.y};
        this._grab = global.stage.grab(this._card);
    }

    _onDragUpdate() {
        if (!this._dragStart)
            return;

        const pointer = this._panGesture.get_centroid_abs();
        this._moveTo(
            Math.round(this._dragStart.x + pointer.x - this._dragStart.pointerX),
            Math.round(this._dragStart.y + pointer.y - this._dragStart.pointerY));
    }

    _onDragEnd() {
        if (!this._dragStart)
            return;

        this._grab?.dismiss();
        this._grab = null;
        this._dragStart = null;

        const [width, height] = this._cardSize();
        const [x, y] = clampToWorkArea(
            this.x + SHADOW_SIZE, this.y + SHADOW_SIZE, width, height);
        this._settings.set_int('widget-x', x);
        this._settings.set_int('widget-y', y);
        this._restorePosition();
    }

    _onDestroy() {
        this._grab?.dismiss();
        this._grab = null;

        if (this._clampLaterId) {
            global.compositor.get_laters().remove(this._clampLaterId);
            this._clampLaterId = 0;
        }

        if (this._hideIdleId) {
            GLib.source_remove(this._hideIdleId);
            this._hideIdleId = 0;
        }

        this._disconnectLayerSignals();
        this._menu.destroy();
    }
});
