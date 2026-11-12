import { SearchClient } from 'wasm-search';
import { initialize, Router, type Mode } from 'wayfind';
import { APP_CONFIG } from './config';
import { loadPeriods, loadRoomDay, loadRoomIndex } from './data';
import { buildingWord, isClassroom, makeRoomReader } from './rooms';
import { loadSpace, type Space } from '@/map/model/space';
import { toolDate } from './tools';

/** Adapters call the same released search/routing kernels and room interpreter as the visual entries. */
export class CampusTools {
    private search = new SearchClient({ baseUrl: APP_CONFIG.DATA_URLS.SEARCH });
    private space?: Promise<Space>;
    private router?: Promise<Router>;
    private places() { return this.space ??= loadSpace(); }
    async query(query: string) {
        await this.search.initialize();
        const answer = await this.search.search({ query, offset: 0, limit: 6, sort: 'relevance', filters: {} }).response;
        return answer.results.map(item => ({ id: item.id, title: item.title, url: item.url, source: item.sourceName, snippet: item.snippet, attachments: item.attachments }));
    }
    async rooms(args: Record<string, unknown>) {
        const date = toolDate(args.date);
        const [index, periods, day] = await Promise.all([loadRoomIndex(), loadPeriods(), loadRoomDay(date)]);
        if (!day) return { date, known: false, rooms: [] };
        const read = makeRoomReader(periods);
        return { date, known: true, rooms: index.rooms.filter(isClassroom).filter(room => !args.building || room.building.includes(buildingWord(String(args.building)))).map(room => ({ room: room.id, ...read(day, room.id, args.minute as number) })).filter(room => !room.busy && room.minutes >= (args.minutes as number)).sort((a, b) => b.minutes - a.minutes || a.room.localeCompare(b.room)).slice(0, 12).map(room => ({ room: room.room, until: room.until, minutes: room.minutes })) };
    }
    async route(args: Record<string, unknown>) {
        const space = await this.places(), from = space.byId.get(String(args.from)), to = space.byId.get(String(args.to));
        if (!from || !to) throw new Error('地图里没有这两个完整地点，请先搜索确认。');
        const router = await (this.router ??= initialize().then(() => new Router(space.network)));
        const result = router.route({ origin: from.routing, destination: to.routing, mode: (args.mode ?? 'walk') as Mode, avoid_steps: false, max_snap_distance_m: 100, alternatives: 1 });
        return { routes: result.routes.map(route => ({ distance_m: route.distance_m, duration_s: route.duration_s, steps: route.maneuvers.map(step => step.instruction) })), url: `/map/?from=${encodeURIComponent(from.id)}&nav=${encodeURIComponent(to.id)}` };
    }
    dispose() { this.search.dispose(); void this.router?.then(router => router.free()); }
}
