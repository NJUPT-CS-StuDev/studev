// The globe that turns the map. It is drawn from the camera itself: its lines are a real
// sphere under the same bearing and pitch, so it looks like what dragging it does.
type Point = [number, number, number];

const rad = Math.PI / 180;
/** Map frame (x east, y north, z up) to the viewer: x right, y up, z toward the eye. */
const view = (bearing: number, pitch: number) => {
    const [sb, cb, sp, cp] = [Math.sin(bearing * rad), Math.cos(bearing * rad), Math.sin(pitch * rad), Math.cos(pitch * rad)];
    return ([x, y, z]: Point): Point => {
        const [rx, ry] = [x * cb - y * sb, x * sb + y * cb];
        return [rx, ry * cp + z * sp, -ry * sp + z * cp];
    };
};
const onSphere = (lon: number, lat: number): Point => [Math.cos(lat * rad) * Math.sin(lon * rad), Math.cos(lat * rad) * Math.cos(lon * rad), Math.sin(lat * rad)];

const MERIDIANS = [0, 45, 90, 135];
const PARALLELS = [-45, 0, 45];
const ring = (at: (step: number) => Point, project: (point: Point) => Point) => {
    let path = '';
    let pen = false;
    for (let step = 0; step <= 72; step++) {
        const [x, y, z] = project(at(step * 5));
        if (z < 0) { pen = false; continue; }
        path += `${pen ? 'L' : 'M'}${(x * 15).toFixed(2)} ${(-y * 15).toFixed(2)}`;
        pen = true;
    }
    return path;
};

/** SVG paths in a viewBox centred on zero with radius 15, and where north sits. */
export function globe(bearing: number, pitch: number) {
    const project = view(bearing, pitch);
    return {
        lines: [...MERIDIANS.map(lon => ring(angle => onSphere(lon, angle), project)), ...PARALLELS.map(lat => ring(angle => onSphere(angle, lat), project))].join(''),
        // Where north points on the screen, on the rim, so tilting never hides it.
        north: { x: -Math.sin(bearing * rad) * 12.5, y: -Math.cos(bearing * rad) * 12.5 },
    };
}
