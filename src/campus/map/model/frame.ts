import type { Geometry, Position } from 'geojson';

/** The polygons of a footprint, as rings of positions; a footprint is a polygon or several. */
export const polygons = (geometry: Geometry): Position[][][] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];

/** How far past its outermost footprints the campus's frame reaches, in degrees: room for the longest shadows. */
const MARGIN = .002;

export interface CampusFrame { west: number; south: number; east: number; north: number; longitude: number; latitude: number }

/**
 * Where the campus is, read from its own footprints rather than written down: the box around every building and the
 * buildings around it, a little wider, and its middle, which the sun is reckoned for and distances are scaled at.
 */
export function campusFrame(model: { buildings: { geometry: Geometry }[]; context: { geometry: Geometry }[] }): CampusFrame {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const { geometry } of [...model.buildings, ...model.context])
        for (const polygon of polygons(geometry)) for (const [x, y] of polygon[0] ?? []) { west = Math.min(west, x!); east = Math.max(east, x!); south = Math.min(south, y!); north = Math.max(north, y!); }
    if (!Number.isFinite(west)) throw new Error('the campus model has no footprints');
    west -= MARGIN; south -= MARGIN; east += MARGIN; north += MARGIN;
    return { west, south, east, north, longitude: (west + east) / 2, latitude: (south + north) / 2 };
}
