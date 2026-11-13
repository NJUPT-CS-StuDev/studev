import { PRODUCT_CONFIG } from '@/world/product';
// The campus space comes from njupt-map; opening hours are the only place facts
// contributed by the campus facts release and are joined by canonical map id.
import type { StyleSpecification } from 'maplibre-gl';
import type { GraphData, Position, Endpoint } from 'wayfind';
import { DATA_RELEASE } from '@/world/config';
import { fetchJson } from '@/world/fetch';

const CAMPUS = PRODUCT_CONFIG.CAMPUS.id;
export const CAMPUS_CENTRE = PRODUCT_CONFIG.CAMPUS.centre as Position;

interface Entrance { at: Position; source: string }
export interface Place {
    id: string;
    kind: string;                // campus, building, floor, room or place
    parent?: string;             // the entity it lies in; none for a place off the campus
    names: string[];
    centre?: Position;
    levels?: number;
    houses?: string[];
    entrances?: Entrance[];
    floor?: string;
    seats?: number;
    room_kinds?: string[];
    sources: string[];
    category?: string;           // from njupt-map's one vocabulary; a room is a 教室
    group?: string;              // the group the category is in: 教学科研, 生活, 餐饮, 购物, 服务, 文体, 交通, 办公
    tier?: number;               // how prominent the map shows it: 1 from afar, 2 closer, 3 close up
    routing: Endpoint;
    hours?: { week: Record<string, [string, string][]>; note?: string };
}

interface OpeningRecord { hours: NonNullable<Place['hours']>; sources?: string[] }

export interface Space {
    places: Place[];
    byId: Map<string, Place>;
    network: GraphData;
}

export const spaceBase = (campus = CAMPUS) =>
    new URL(`${DATA_RELEASE.base}/space/${encodeURIComponent(campus)}`, location.origin).href;

export async function loadSpace(campus = CAMPUS): Promise<Space> {
    const base = spaceBase(campus);
    const [places, network, opening] = await Promise.all([
        fetchJson<Place[]>(`${base}/entities.json`),
        fetchJson<GraphData>(`${base}/network.json`),
        fetchJson<Record<string, OpeningRecord>>(`${DATA_RELEASE.base}/hours.json`),
    ]);
    const joined = places.map(place => {
        if (!place.routing || place.routing.type !== 'target' || place.routing.id !== place.id) {
            throw new Error(`地图实体缺少规范导航目标：${place.id}`);
        }
        const record = opening[place.id];
        return { ...place, ...(record ? { hours: record.hours, sources: [...new Set([...place.sources, ...(record.sources ?? [])])] } : {}) };
    });
    return { places: joined, byId: new Map(joined.map(p => [p.id, p])), network };
}

/** The packaged style, with its two tokens bound to this site. */
export async function loadStyle(campus = CAMPUS): Promise<StyleSpecification> {
    const base = spaceBase(campus);
    const text = await (await fetch(`${base}/style.json`)).text();
    return JSON.parse(text.replaceAll('{data}', base).replaceAll('{assets}', new URL('/map', location.origin).href));
}


