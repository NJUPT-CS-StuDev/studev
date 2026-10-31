import type { Place } from './space';

/** Shared place-title policy. IDs remain stable links; names are user-facing text. */
export function displayName(place: Place, byId?: ReadonlyMap<string, Place>): string {
    const direct = place.names.find(value => value.trim());
    if (direct) return direct.trim();
    if (place.kind === 'building') {
        let parent = place.parent ? byId?.get(place.parent) : undefined;
        while (parent) {
            const context = parent.names.find(value => value.trim());
            if (context) return `${place.category ?? '建筑'} · ${context.trim()}`;
            parent = parent.parent ? byId?.get(parent.parent) : undefined;
        }
        return '未命名建筑';
    }
    return place.category ? `${place.category} · 未命名地点` : place.id;
}
