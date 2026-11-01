// SPDX-License-Identifier: GPL-2.0-or-later

import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

const DECLARATIONS = `
uniform vec2 size;
uniform float radius;
`;

// Signed distance from the pixel to a rounded rectangle covering the actor,
// turned into an anti-aliased coverage value.
const CODE = `
vec2 point = cogl_tex_coord_in[0].xy * size;
vec2 halfSize = size * 0.5;
vec2 q = abs(point - halfSize) - (halfSize - vec2(radius));
float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
cogl_color_out *= clamp(0.5 - dist, 0.0, 1.0);
`;

/**
 * Clips an actor (including its children and effects) to rounded corners.
 * St can only round the corners of CSS backgrounds, not of arbitrary content
 * such as images or blurred clones.
 */
export const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Shell.GLSLEffect {
    constructor(params) {
        super(params);

        this._radius = 0;
        this._sizeLocation = this.get_uniform_location('size');
        this._radiusLocation = this.get_uniform_location('radius');
    }

    get radius() {
        return this._radius;
    }

    set radius(radius) {
        if (this._radius === radius)
            return;

        this._radius = radius;
        this.queue_repaint();
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    vfunc_paint_target(node, paintContext) {
        const {width, height} = this.actor;
        const radius = Math.min(this._radius, width / 2, height / 2);

        this.set_uniform_float(this._sizeLocation, 2, [width, height]);
        this.set_uniform_float(this._radiusLocation, 1, [radius]);

        super.vfunc_paint_target(node, paintContext);
    }
});
