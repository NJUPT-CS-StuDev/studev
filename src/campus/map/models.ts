// The buildings as the GPU draws them: one baked buffer from njupt-map, no model loader.
// Each vertex is 12 bytes: position int16 (scale metres per unit), normal int8, colour uint8.
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibre } from 'maplibre-gl';
import { MercatorCoordinate } from 'maplibre-gl';

export interface ModelIndex { origin: [number, number]; scale: number; buildings: Record<string, [number, number]> }
export interface ModelLook { hidden: string | null; flatten: number; night: number; faded: number; fadeTo: [number, number, number] }

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform float u_flatten;
in vec3 a_pos;
in vec3 a_normal;
in vec3 a_colour;
out vec3 v_normal;
out vec3 v_colour;
void main() {
    v_normal = a_normal;
    v_colour = a_colour;
    gl_Position = u_matrix * vec4(a_pos.xy, a_pos.z * u_flatten, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision mediump float;
uniform float u_night;
uniform float u_faded;
uniform vec3 u_fade_to;
in vec3 v_normal;
in vec3 v_colour;
out vec4 colour;
void main() {
    vec3 n = normalize(v_normal);
    // A soft sky and one low sun from the south-east: faces read apart without any texture.
    float sky = .62 + .38 * max(n.z, 0.);
    float sun = max(dot(n, normalize(vec3(.45, -.6, .66))), 0.);
    vec3 lit = v_colour * (sky + .3 * sun);
    lit *= 1. - .78 * u_night;
    colour = vec4(mix(lit, u_fade_to, u_faded), 1.);
}`;

const multiply = (a: ArrayLike<number>, b: number[]) => {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
        out[c * 4 + r] = sum;
    }
    return out;
};

/** The layer draws nothing until its buffer arrives; the plain footprints stand in until then. */
export function modelLayer(index: ModelIndex, bytes: ArrayBuffer, look: () => ModelLook): CustomLayerInterface {
    let program: WebGLProgram, vao: WebGLVertexArrayObject, uniforms: Record<string, WebGLUniformLocation | null>;
    const place = MercatorCoordinate.fromLngLat(index.origin, 0);
    const unit = place.meterInMercatorCoordinateUnits() * index.scale;
    const model = [unit, 0, 0, 0, 0, -unit, 0, 0, 0, 0, unit, 0, place.x, place.y, 0, 1];
    const count = bytes.byteLength / 12;
    return {
        id: 'models', type: 'custom', renderingMode: '3d',
        onAdd(_map: MapLibre, gl) {
            const context = gl as WebGL2RenderingContext;
            const compile = (type: number, source: string) => {
                const shader = context.createShader(type)!;
                context.shaderSource(shader, source);
                context.compileShader(shader);
                if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error(context.getShaderInfoLog(shader) ?? 'shader');
                return shader;
            };
            program = context.createProgram()!;
            context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX));
            context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT));
            context.linkProgram(program);
            uniforms = Object.fromEntries(['u_matrix', 'u_flatten', 'u_night', 'u_faded', 'u_fade_to'].map(name => [name, context.getUniformLocation(program, name)]));
            vao = context.createVertexArray()!;
            context.bindVertexArray(vao);
            context.bindBuffer(context.ARRAY_BUFFER, context.createBuffer());
            context.bufferData(context.ARRAY_BUFFER, bytes, context.STATIC_DRAW);
            const attribute = (name: string, size: number, type: number, normalized: boolean, offset: number) => {
                const at = context.getAttribLocation(program, name);
                context.enableVertexAttribArray(at);
                context.vertexAttribPointer(at, size, type, normalized, 12, offset);
            };
            attribute('a_pos', 3, context.SHORT, false, 0);
            attribute('a_normal', 3, context.BYTE, true, 6);
            attribute('a_colour', 3, context.UNSIGNED_BYTE, true, 9);
            context.bindVertexArray(null);
        },
        render(gl, args: CustomRenderMethodInput) {
            const context = gl as WebGL2RenderingContext;
            const state = look();
            context.useProgram(program);
            context.bindVertexArray(vao);
            context.enable(context.DEPTH_TEST);
            context.depthMask(true);
            context.depthFunc(context.LEQUAL);
            context.disable(context.CULL_FACE);
            context.disable(context.STENCIL_TEST);
            context.disable(context.BLEND);
            context.uniformMatrix4fv(uniforms.u_matrix!, false, multiply(args.defaultProjectionData.mainMatrix, model));
            context.uniform1f(uniforms.u_flatten!, state.flatten);
            context.uniform1f(uniforms.u_night!, state.night);
            context.uniform1f(uniforms.u_faded!, state.faded);
            context.uniform3fv(uniforms.u_fade_to!, state.fadeTo);
            const skip = state.hidden ? index.buildings[state.hidden] : undefined;
            if (skip) {
                context.drawArrays(context.TRIANGLES, 0, skip[0]);
                context.drawArrays(context.TRIANGLES, skip[0] + skip[1], count - skip[0] - skip[1]);
            } else context.drawArrays(context.TRIANGLES, 0, count);
            context.bindVertexArray(null);
        },
    };
}
