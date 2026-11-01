export interface DisplayPlace {
    id: string;
    kind: string;
    parent?: string;
    names?: readonly string[];
    category?: string;
}

/** Shared place-title policy. IDs remain stable links; names are user-facing text. */
export function displayName(place: DisplayPlace, byId?: ReadonlyMap<string, DisplayPlace>): string {
    const direct = (place.names ?? []).find(value => value.trim());
    if (direct) return direct.trim();
    if (place.kind === 'building') {
        let parent = place.parent ? byId?.get(place.parent) : undefined;
        while (parent) {
            const context = (parent.names ?? []).find(value => value.trim());
            if (context) return `${place.category ?? '建筑'} · ${context.trim()}`;
            parent = parent.parent ? byId?.get(parent.parent) : undefined;
        }
        return '未命名建筑';
    }
    return `${place.category ?? place.kind} · 未命名地点`;
}

export function roomDisplayName(room: string | null | undefined, byId?: ReadonlyMap<string, DisplayPlace>): string | undefined {
    if (!room) return undefined;
    const place = byId?.get(room);
    if (place) {
        const title = displayName(place, byId);
        if (place.kind === 'room' && place.parent) {
            const parent = byId?.get(place.parent);
            if (parent) return `${displayName(parent, byId)} · ${title}`;
        }
        return title;
    }
    return room.split('/').at(-1) || room;
}

export const displayRoomId = (room: string | null | undefined): string => room?.split('/').at(-1) ?? '';
