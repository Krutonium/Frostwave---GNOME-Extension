// SPDX-License-Identifier: GPL-2.0-or-later

// Downloads and decodes album art, and derives an accent color from it.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Covers are shown at up to ~140 logical pixels, so this is enough for 2x scaling
const TEXTURE_SIZE = 320;
const CACHE_SIZE = 12;
const COLOR_SAMPLE_SIZE = 16;

/**
 * @typedef {object} Artwork
 * @property {GdkPixbuf.Pixbuf} pixbuf - square RGBA image, at most TEXTURE_SIZE wide
 * @property {number[]} color - representative [r, g, b] color, 0-255
 */

export class ArtworkLoader {
    constructor() {
        this._session = new Soup.Session({timeout: 20});
        /** @type {Map<string, Artwork>} */
        this._cache = new Map();
    }

    destroy() {
        this._session.abort();
        this._session = null;
        this._cache.clear();
    }

    /**
     * @param {string} url - http(s) or file URL of the image
     * @param {Gio.Cancellable} cancellable
     * @returns {Promise<Artwork>}
     */
    async load(url, cancellable) {
        const cached = this._cache.get(url);
        if (cached) {
            // Move to the end, so the least recently used entry is evicted first
            this._cache.delete(url);
            this._cache.set(url, cached);
            return cached;
        }

        const bytes = await this._fetch(url, cancellable);
        const pixbuf = await decodeImage(bytes, cancellable);
        const artwork = {
            pixbuf: squareTexture(pixbuf),
            color: accentColor(pixbuf),
        };

        this._cache.set(url, artwork);
        if (this._cache.size > CACHE_SIZE)
            this._cache.delete(this._cache.keys().next().value);

        return artwork;
    }

    _fetch(url, cancellable) {
        const scheme = GLib.Uri.peek_scheme(url);

        if (scheme === 'http' || scheme === 'https')
            return this._download(url, cancellable);
        if (scheme === 'file')
            return readFile(Gio.File.new_for_uri(url), cancellable);
        if (url.startsWith('/'))
            return readFile(Gio.File.new_for_path(url), cancellable);

        return Promise.reject(new Error(`Unsupported artwork URL ${url}`));
    }

    _download(url, cancellable) {
        const message = Soup.Message.new('GET', url);
        if (!message)
            return Promise.reject(new Error(`Invalid artwork URL ${url}`));

        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT,
                cancellable, (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const status = message.get_status();
                        if (status !== Soup.Status.OK)
                            throw new Error(`HTTP ${status} for ${url}`);
                        resolve(bytes);
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }
}

function readFile(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (source, result) => {
            try {
                const [, contents] = source.load_contents_finish(result);
                resolve(new GLib.Bytes(contents));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function decodeImage(bytes, cancellable) {
    const stream = Gio.MemoryInputStream.new_from_bytes(bytes);

    return new Promise((resolve, reject) => {
        GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancellable, (_source, result) => {
            try {
                resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Crops the image to a centered square, scales it down to TEXTURE_SIZE and
 * makes sure it has an alpha channel, so it can be uploaded as RGBA.
 *
 * @param {GdkPixbuf.Pixbuf} pixbuf
 * @returns {GdkPixbuf.Pixbuf}
 */
function squareTexture(pixbuf) {
    const {width, height} = pixbuf;
    const side = Math.min(width, height);
    const target = Math.min(side, TEXTURE_SIZE);

    const square = pixbuf
        .new_subpixbuf((width - side) >> 1, (height - side) >> 1, side, side)
        .scale_simple(target, target, GdkPixbuf.InterpType.HYPER);

    return square.get_has_alpha() ? square : square.add_alpha(false, 0, 0, 0);
}

/**
 * Average color of the image, weighted towards saturated pixels so that
 * vivid covers don't end up with a muddy grey.
 *
 * @param {GdkPixbuf.Pixbuf} pixbuf
 * @returns {number[]} [r, g, b], 0-255
 */
function accentColor(pixbuf) {
    const sample = pixbuf.scale_simple(COLOR_SAMPLE_SIZE, COLOR_SAMPLE_SIZE,
        GdkPixbuf.InterpType.BILINEAR);
    const pixels = sample.get_pixels();
    const channels = sample.get_n_channels();
    const rowstride = sample.get_rowstride();

    let red = 0, green = 0, blue = 0, total = 0;
    for (let y = 0; y < COLOR_SAMPLE_SIZE; y++) {
        for (let x = 0; x < COLOR_SAMPLE_SIZE; x++) {
            const i = y * rowstride + x * channels;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max === 0 ? 0 : (max - min) / max;
            const weight = 0.05 + saturation * saturation * (max / 255);

            red += r * weight;
            green += g * weight;
            blue += b * weight;
            total += weight;
        }
    }

    return [red, green, blue].map(c => Math.round(c / total));
}
