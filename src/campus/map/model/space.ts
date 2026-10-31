import { PRODUCT_CONFIG } from '@/app/config/product';
// The campus space as the data package serves it (njupt-data out/space/<campus>/,
// packaged by scripts/data/digest.ts), and the map style bound to it.
import type { StyleSpecification } from 'maplibre-gl';
import type { GraphData, Position, Endpoint } from 'wayfind';
import { DATA_RELEASE } from '@/app/config/constants';
import { fetchJson } from '@/shared/lib/fetch';

const CAMPUS = PRODUCT_CONFIG.CAMPUS.id;
export const CAMPUS_CENTRE = PRODUCT_CONFIG.CAMPUS.centre as Position;

interface Entrance { at: Position; source: string }
export interface Place {
    id: string;
    kind: string;                // "building", "room", or what a standalone place is (高德 type)
    parent: string;
    names: string[];
    centre?: Position;
    levels?: number | null;
    houses?: string[];
    entrances?: Entrance[];
    floor?: string | null;
    seats?: number | null;
    room_kinds?: string[];
    sources: string[];
    use: string;
    routing: Endpoint;
    hours?: { week: Record<string, [string, string][]>; note?: string };
    category?: string;
    featured?: boolean;
}

export interface Space {
    places: Place[];
    byId: Map<string, Place>;
    network: GraphData;
}

export const spaceBase = (campus = CAMPUS) =>
    new URL(`${DATA_RELEASE.base}/space/${encodeURIComponent(campus)}`, location.origin).href;

export async function loadSpace(campus = CAMPUS): Promise<Space> {
    const base = spaceBase(campus);
    const [places, network] = await Promise.all([
        fetchJson<Place[]>(`${base}/places.json`),
        fetchJson<GraphData>(`${base}/network.json`),
    ]);
    return { places, byId: new Map(places.map(p => [p.id, p])), network };
}

/** The packaged style, with its two tokens bound to this site. */
export async function loadStyle(theme: 'light' | 'dark', campus = CAMPUS): Promise<StyleSpecification> {
    const base = spaceBase(campus);
    const text = await (await fetch(`${base}/style-${theme}.json`)).text();
    return JSON.parse(text.replaceAll('{data}', base).replaceAll('{assets}', new URL('/map', location.origin).href));
}

/** Where to draw a place: its centre, or its building's for a room. */
export function placePosition(space: Space, place: Place): Position | undefined {
    return place.centre ?? (place.parent ? space.byId.get(place.parent)?.centre : undefined);
}

const KIND_LABELS: Record<string, string> = { building: '楼栋', room: '教室' };
export const kindLabel = (place: Place) => KIND_LABELS[place.kind] ?? place.kind;
