// The ball that turns the map. It is a solid sphere seen under the map's own bearing and pitch: its
// equator turns and flattens with the map, and a red mark on its rim points north, so it
// reads as "the way the campus faces" and moves exactly as dragging it moves the map. No meridians: those
// would make it a globe, the sign for "world" or "language".
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
const at = (x: number, y: number) => `${(x * RADIUS).toFixed(2)} ${(-y * RADIUS).toFixed(2)}`;

/** The ball's radius in its viewBox, which runs from -22 to 22 to leave room for the turning arrows. */
export const RADIUS = 15;

/** SVG paths for the ball under this bearing and pitch: the near half of its equator, and the north mark. */
export function orientationBall(bearing: number, pitch: number) {
    const project = view(bearing, pitch);
    let ring = '';
    let pen = false;
    for (let lon = 0; lon <= 360; lon += 4) {
        const [x, y, z] = project(onSphere(lon, 0));
        if (z < 0) { pen = false; continue; }
        ring += `${pen ? 'L' : 'M'}${at(x, y)}`;
        pen = true;
    }
    // North on the screen, at the rim, so no tilt ever hides it behind the ball.
    const [dx, dy] = [-Math.sin(bearing * rad), Math.cos(bearing * rad)];
    const tip = (r: number, side: number) => at((dx * r - dy * side) / RADIUS, (dy * r + dx * side) / RADIUS);
    return { ring, north: `M${tip(RADIUS + 5, 0)}L${tip(RADIUS - 1.5, 3.4)}L${tip(RADIUS - 1.5, -3.4)}Z` };
}
