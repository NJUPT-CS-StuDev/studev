import { SearchClient } from 'wasm-search';
import { initialize, Router, type Mode } from 'wayfind';
import { APP_CONFIG } from './config';
import { loadPeriods, loadRoomDay, loadRoomIndex } from './data';
import { buildingWord, isClassroom, makeRoomReader } from './rooms';
import { loadSpace, type Space } from '@/map/model/space';
import { findPlaces, placeMeant, placesAround } from '@/map/model/find';
import { campusTime, openingStatus } from '@/map/model/homePolicy';
import { fetchJson } from './fetch';
import { toolDate } from './tools';
import { campusConfig } from '../../../campus.config';

/** Where a search looks, by the name a person gives it: the same channels as the search page. */
const CHANNELS = campusConfig.search.channels as readonly { label: string; sources?: readonly string[]; excluded?: readonly string[] }[];
/** How much of an article the model reads at once. */
const READ = 8000;

/** Adapters call the same released search/routing kernels and room interpreter as the visual entries. */
export class CampusTools {
    private search = new SearchClient({ baseUrl: APP_CONFIG.DATA_URLS.SEARCH });
    private space?: Promise<Space>;
    private router?: Promise<Router>;
    private places() { return this.space ??= loadSpace(); }
    async query(query: string, within = '全部') {
        const channel = CHANNELS.find(item => item.label === within);
        if (!channel) throw new Error('没有这个搜索范围。');
        await this.search.initialize();
        const filters = { ...(channel.sources ? { sourceIds: [...channel.sources] } : {}), ...(channel.excluded ? { excludedSourceIds: [...channel.excluded] } : {}) };
        const answer = await this.search.search({ query, offset: 0, limit: 6, sort: 'relevance', filters }).response;
        return answer.results.map(item => ({ id: item.id, title: item.title, source: item.sourceName, ...(item.publishedAt ? { date: item.publishedAt.slice(0, 10) } : {}), snippet: item.snippet, url: item.url }));
    }
    /** One article's own text, as far as it is kept; what is not an article is not read here. */
    async read(id: string) {
        if (!/^[0-9a-f]{16}$/.test(id)) throw new Error('这条不是文章，课程、教室、地点请用对应的方式查。');
        const shard = await fetchJson<Record<string, { title: string; url: string; source: string; published: string | null; text: string; files: { name: string; url: string }[] }>>(`${APP_CONFIG.DATA_URLS.TEXTS}/${id.slice(0, 2)}.json`);
        const doc = shard[id];
        if (!doc) throw new Error('找不到这篇资料。');
        return { title: doc.title, source: doc.source, ...(doc.published ? { date: doc.published.slice(0, 10) } : {}), url: doc.url, text: doc.text.slice(0, READ) || '这篇的正文没有收录，内容在附件里：把原文链接和附件给对方，不用再找。', ...(doc.text.length > READ ? { cut: true } : {}), files: doc.files.slice(0, 10) };
    }
    /** The places a name may mean, each said with what it is, where, and whether it is open now. */
    /** What a place is called when said alone: a room with its building (教3-302), anything else by its name. */
    private nameOf(place: Space['places'][number]) { return place.kind === 'room' ? place.id.slice(place.id.indexOf('/') + 1) : place.names[0] ?? place.id; }
    /** A place as the model is told it: what it is, where, and whether it is open now. */
    private said(space: Space, place: Space['places'][number], now = campusTime()) {
        const parent = place.parent ? space.byId.get(place.parent) : undefined;
        const status = openingStatus(place.hours, now);
        return { id: place.id, name: this.nameOf(place), ...(place.category ? { category: place.category } : {}),
            where: !parent ? '校外' : parent.kind === 'campus' ? '校内' : `${parent.names[0] ?? parent.id}里`,
            ...(status.state === 'unknown' ? {} : status.today === '00:00–24:00' ? { today: '全天', now: '24 小时开放' } : { today: status.today, now: status.state === 'closed' ? '已关闭' : status.state === 'closing' ? `快关门了，${status.closesAt} 关` : `开着，${status.closesAt} 关` }) };
    }
    /** The places a name may mean. */
    async findPlace(query: string) {
        const space = await this.places();
        return findPlaces(space.places, query).map(place => this.said(space, place));
    }
    /** The places of a kind around one, nearest first. */
    async nearby(near: string, what: string) {
        const space = await this.places(), at = placeMeant(space.places, space.byId, near);
        return { near: this.nameOf(at), places: placesAround(space.places, space.byId, at, what).map(({ place, metres }) => ({ ...this.said(space, place), metres })) };
    }
    async rooms(args: Record<string, unknown>) {
        const date = toolDate(args.date);
        const [index, periods, day] = await Promise.all([loadRoomIndex(), loadPeriods(), loadRoomDay(date)]);
        if (!day) return { date, known: false, rooms: [] };
        const read = makeRoomReader(periods);
        return { date, known: true, rooms: index.rooms.filter(isClassroom).filter(room => !args.building || room.building.includes(buildingWord(String(args.building)))).map(room => ({ room: room.id, ...read(day, room.id, args.minute as number) })).filter(room => !room.busy && room.minutes >= (args.minutes as number)).sort((a, b) => b.minutes - a.minutes || a.room.localeCompare(b.room)).slice(0, 12).map(room => ({ room: room.room, until: room.until, minutes: room.minutes })) };
    }
    async route(args: Record<string, unknown>) {
        const space = await this.places(), from = placeMeant(space.places, space.byId, String(args.from)), to = placeMeant(space.places, space.byId, String(args.to));
        const router = await (this.router ??= initialize().then(() => new Router(space.network)));
        const result = router.route({ origin: from.routing, destination: to.routing, mode: (args.mode ?? 'walk') as Mode, avoid_steps: false, max_snap_distance_m: 100, alternatives: 1 });
        const route = result.routes[0];
        if (!route) throw new Error(`地图里没有从${this.nameOf(from)}到${this.nameOf(to)}的路。`);
        return { from: this.nameOf(from), to: this.nameOf(to), distance_m: Math.round(route.distance_m), duration_s: Math.round(route.duration_s), steps: route.maneuvers.map(step => step.instruction), url: `/map/?from=${encodeURIComponent(from.id)}&nav=${encodeURIComponent(to.id)}` };
    }
    dispose() { this.search.dispose(); void this.router?.then(router => router.free()); }
}
