// When a building or place is named over the map. The map's tier says how prominent a thing is: tier 1 is named from
// afar, 2 closer, 3 close up. A building being taught in is named first of all, with its free rooms. A place inside a
// building is named only once one is close enough to see into it, and a place off the campus a little after one on it.
// Parking is never named: its lots and entrances would bury everything else. The same rules are android/.../map/Labels.kt.
import type { Place } from './space';

export interface LabelRule { minZoom: number; priority: number }

const BUILDING = [15.1, 16.0, 16.8];
const PLACE = [15.6, 16.4, 17.0];
const INSIDE = 17.4;
const OFF_CAMPUS = 0.4;
const UNNAMED = new Set(['停车场']);

/** How a building or place is named, or null when it is not; `teaching` marks a building whose free rooms are shown. */
export function labelRule(place: Place, byId: ReadonlyMap<string, Place>, teaching = false): LabelRule | null {
    const tier = place.tier ?? 3;
    if (place.kind === 'building') return teaching ? { minZoom: 14.5, priority: 0 } : { minZoom: BUILDING[tier - 1]!, priority: tier };
    if (place.kind !== 'place' || UNNAMED.has(place.category ?? '')) return null;
    const parent = place.parent ? byId.get(place.parent) : undefined;
    const off = !parent;
    let minZoom = PLACE[tier - 1]! + (off ? OFF_CAMPUS : 0);
    if (parent?.kind === 'building') minZoom = Math.max(minZoom, INSIDE);
    return { minZoom: Math.round(minZoom * 10) / 10, priority: tier + 1 + (off ? 1 : 0) };
}
