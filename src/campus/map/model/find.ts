// Finding a place by what someone calls it, for the AI and anything else that is told a name rather than shown a map:
// 教三 is 教3, 三食堂门口 is 三食堂, 教3-301 is that room. The best match first; a place on the campus and a more
// prominent one before others as good. The same rules are android/.../map/Find.kt.
import type { Place } from './space';
import { distance } from './homePolicy';

const DIGITS = '一二三四五六七八九';
/** What a name is said as, to compare: no spaces or brackets, small letters, 教三楼 as 教3. */
export function plainName(text: string): string {
    const said = text.toLowerCase().replace(/[ \t\n\r\u3000()（）·\-—_]/g, '').replace(/[一二三四五六七八九](?=楼|号|栋|幢|$)/g, c => String(DIGITS.indexOf(c) + 1));
    return said.replace(/^(教[1-9])楼$/, '$1');
}

/** How well one place answers to a name, 0 when it does not. */
function score(place: Place, said: string): number {
    if (!said || !['building', 'place', 'room'].includes(place.kind)) return 0;
    const tail = plainName(place.id.slice(place.id.indexOf('/') + 1));
    const names = [...place.names, ...(place.kind === 'room' ? [] : [tail])].map(plainName).filter(Boolean);
    let best = tail === said ? 95 : 0;
    for (const name of names) {
        if (name === said) best = Math.max(best, 100);
        else if (place.kind === 'room') continue;
        else if (name.startsWith(said)) best = Math.max(best, 80 - Math.min(20, name.length - said.length));
        else if (said.startsWith(name) && name.length >= 2) best = Math.max(best, 70 - Math.min(20, said.length - name.length));
        else if (name.includes(said) && said.length >= 2) best = Math.max(best, 60 - Math.min(20, name.length - said.length));
    }
    if (!best) return 0;
    return best + (place.id.startsWith('周边/') ? 0 : 5) + (4 - (place.tier ?? 3));
}

/** The places that answer to a name, best first. */
export function findPlaces(places: readonly Place[], query: string, limit = 8): Place[] {
    const said = plainName(query);
    return places.map(place => ({ place, score: score(place, said) })).filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0)).slice(0, limit).map(item => item.place);
}

/** The one place meant by a name or an id, or why it cannot be told. */
export function placeMeant(places: readonly Place[], byId: ReadonlyMap<string, Place>, said: string): Place {
    const exact = byId.get(said.trim());
    if (exact) return exact;
    const plain = plainName(said);
    const ranked = places.map(place => ({ place, score: score(place, plain) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : 1));
    if (!ranked.length) throw new Error(`地图里找不到“${said}”。`);
    const top = ranked[0]!;
    const rivals = ranked.filter(item => item.score === top.score && item.place.names[0] !== top.place.names[0]);
    if (top.score < 70 && rivals.length) throw new Error(`“${said}”可能是：${[top, ...rivals].slice(0, 4).map(item => item.place.names[0]).join('、')}，说具体一点。`);
    return top.place;
}

/** Where a place is, its own point or else the point of what it lies in. */
const pointOf = (place: Place, byId: ReadonlyMap<string, Place>) => place.centre ?? (place.parent ? byId.get(place.parent)?.centre : undefined);

/** The places of a kind (a category, or a group of them) around one place, nearest first, with how far each is. */
export function placesAround(places: readonly Place[], byId: ReadonlyMap<string, Place>, near: Place, what: string, limit = 8): { place: Place; metres: number }[] {
    const from = pointOf(near, byId);
    if (!from) throw new Error(`地图上没有“${near.names[0] ?? near.id}”的位置。`);
    return places.filter(place => place.id !== near.id && (place.kind === 'place' || place.kind === 'building') && (place.category === what || place.group === what) && place.centre)
        .map(place => ({ place, metres: Math.round(distance(from, place.centre!)) }))
        .sort((a, b) => a.metres - b.metres || (a.place.id < b.place.id ? -1 : 1)).slice(0, limit);
}
