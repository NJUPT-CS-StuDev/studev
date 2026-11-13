// The map: pick a moment, unfold campus > building > floor > room. Free rooms, places and
// walking routes all live here; the address always says what is shown.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { initialize as initializeRouting, Router, type Mode, type Route } from 'wayfind';
import type { Position } from 'geojson';
import type { Room, RoomDay, TeachingPeriod, TeachingTerm } from '@/world/facts';
import { loadCalendar, loadPeriods, loadRoomDay, loadRoomIndex, loadTerm } from '@/world/data';
import { courseName, roomLabel, unplaced } from '@/world/names';
import { isClassroom, makeRoomReader, type RoomState } from '@/world/rooms';
import { addDays, dateLabel, durationText, hm, minutesOf, momentNow, momentText, parseMoment, WEEKDAYS, weekdayOf } from '@/world/time';
import { useUrl, useWide } from '@/world/useUrl';
import { Back, Chevron, Cross, Magnifier, Sheet } from '@/world/ui';
import { campusTime, openingLabel, openingStatus, recommendations } from './model/homePolicy';
import { displayName } from './model/displayName';
import { labelRule } from './model/labels';
import { loadSpace, loadStyle, spaceBase, type Place, type Space } from './model/space';
import { formLink } from '@/world/product';
import { visibleRouteText } from './model/routeText';
import type { ModelIndex } from './models';
import { CampusScene, type CampusModel, type RoomPaint, type SceneLabel } from './scene';
import { fetchJson } from '@/world/fetch';
import { holidayMap } from '@/world/events';
import { readAppearance } from '@/world/appearance';
import { orientationBall } from './ball';
import '../campus.css';

/** A photo of a place, sent with where it is: its name, its id on the map and, where the map has one, its centre. */
const photoLink = (place: Place, name: string, within?: Place | null) => {
    const centre = place.centre ?? within?.centre;
    return formLink('place', { place: `${name} · ${place.id}`, ...(centre ? { position: `${centre[1].toFixed(6)},${centre[0].toFixed(6)}` } : {}) });
};
import './map.css';

const RULER_START = 7 * 60, RULER_END = 22 * 60;
const percent = (minutes: number) => `${((Math.max(RULER_START, Math.min(RULER_END, minutes)) - RULER_START) / (RULER_END - RULER_START) * 100).toFixed(2)}%`;
const metres = (m: number) => m < 1000 ? `${Math.round(m / 10) * 10} 米` : `${(m / 1000).toFixed(1)} 公里`;
const distance = (a: Position, b: Position) => {
    const t = Math.PI / 180;
    return Math.hypot((b[0]! - a[0]!) * t * Math.cos(a[1]! * t), (b[1]! - a[1]!) * t) * 6371000;
};

interface World { space: Space; model: CampusModel; router: Router; rooms: Room[]; roomById: Map<string, Room>; periods: TeachingPeriod[]; term: TeachingTerm; holidays: Map<string, string>; read: ReturnType<typeof makeRoomReader> }

function useWorld() {
    const [world, setWorld] = useState<World | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        Promise.all([loadSpace(), fetchJson<CampusModel>(`${spaceBase()}/model.json`), loadRoomIndex(), loadPeriods(), loadTerm(), loadCalendar(), initializeRouting()]).then(([space, model, index, periods, term, calendar]) => {
            const placedRooms = index.rooms.filter(room => !unplaced(room.id));
            setWorld({ space, model, router: new Router(space.network), rooms: placedRooms, roomById: new Map(placedRooms.map(room => [room.id, room])), periods, term, holidays: holidayMap(calendar), read: makeRoomReader(periods) });
        }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
    }, []);
    return { world, error };
}

const buildingOfPlace = (space: Space, place: Place | undefined): Place | null => {
    let current = place;
    while (current && current.kind !== 'building') current = current.parent ? space.byId.get(current.parent) : undefined;
    return current ?? null;
};

export default function MapApp() {
    const { params, set } = useUrl();
    const wide = useWide();
    const { world, error } = useWorld();
    const canvas = useRef<HTMLDivElement>(null);
    const labels = useRef<HTMLDivElement>(null);
    const ball = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const dragged = useRef(false);
    const [scene, setScene] = useState<CampusScene | null>(null);
    const [now] = useState(momentNow);
    const moment = useMemo(() => parseMoment(params.get('t'), now), [now, params]);
    const isNow = !params.get('t');
    const placeId = params.get('place');
    const navId = params.get('nav');
    const floorParam = Number(params.get('f')) || null;
    const pitch = params.get('tilt') === '0' ? 0 : 52;
    const [day, setDay] = useState<RoomDay | null>(null);
    const [me, setMe] = useState<Position | null>(null);
    const [origin, setOrigin] = useState('');
    const [mode, setMode] = useState<Mode>('walk');
    const [routes, setRoutes] = useState<Route[]>([]);
    const [chosen, setChosen] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [snap, setSnap] = useState(0);
    const [peek, setPeek] = useState<number | null>(null);
    const [campusOpen, setCampusOpen] = useState(false);
    const [appearance, setLook] = useState(readAppearance);
    const [closed, setClosed] = useState(false);
    const [needle, setNeedle] = useState(0);
    // Once per browser, when the map first shows: the ball turns the map a little and back, and says what it does.
    const [hinting, setHinting] = useState(false);
    useEffect(() => {
        if (!scene) return;
        try { if (localStorage.getItem('studev_ball_hinted')) return; localStorage.setItem('studev_ball_hinted', '1'); } catch { return; }
        const start = scene.map.getBearing();
        const timers = [
            window.setTimeout(() => { setHinting(true); scene.map.easeTo({ bearing: start + 14, duration: 650, essential: true }); }, 900),
            window.setTimeout(() => scene.map.easeTo({ bearing: start, duration: 650, essential: true }), 1600),
            window.setTimeout(() => setHinting(false), 5200),
        ];
        return () => timers.forEach(window.clearTimeout);
    }, [scene]);

    useEffect(() => {
        const observer = new MutationObserver(() => setLook(readAppearance()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
        return () => observer.disconnect();
    }, []);
    useEffect(() => { let live = true; void loadRoomDay(moment.date).then(value => { if (live) setDay(value); }); return () => { live = false; }; }, [moment.date]);

    useEffect(() => { scene?.map.resize(); }, [closed, scene]);

    /* Scene lifecycle. */
    const handlers = useRef({ onBuilding: (_: string) => {}, onRoom: (_: string) => {}, onPlace: (_: string) => {}, onEmpty: () => {}, onView: () => {} });
    useEffect(() => {
        if (!world || !canvas.current || !labels.current) return;
        let instance: CampusScene | null = null;
        let cancelled = false;
        void loadStyle().then(style => {
            if (cancelled || !canvas.current || !labels.current) return;
            const teach = world.space.byId.get('仙林/教3')?.centre ?? [118.928, 32.113];
            instance = new CampusScene(canvas.current, labels.current, style, world.model, [teach[0]! + .0006, teach[1]! - .0002], pitch, {
                onBuilding: id => handlers.current.onBuilding(id), onRoom: id => handlers.current.onRoom(id),
                onPlace: id => handlers.current.onPlace(id), onEmpty: () => handlers.current.onEmpty(), onView: () => handlers.current.onView(),
            });
            instance.whenReady(() => { if (!cancelled) setScene(instance); });
            void Promise.all([fetchJson<ModelIndex>(`${spaceBase()}/models.json`), fetch(`${spaceBase()}/models.bin.gzip`).then(response => { if (!response.ok || !response.body) throw new Error(String(response.status)); return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); })])
                .then(([index, bytes]) => { if (!cancelled) instance?.showModels(index, bytes); })
                .catch(() => undefined); // The plain forms keep standing where the models did not arrive.
        });
        return () => { cancelled = true; instance?.destroy(); setScene(null); };
    }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

    /* What is selected. */
    const selected = placeId ? world?.space.byId.get(placeId) : undefined;
    const openBuilding = world && selected ? buildingOfPlace(world.space, selected) : null;
    const pickedRoom = selected?.kind === 'room' ? selected : null;
    const bId = openBuilding?.id ?? null;
    const roomsInBuilding = useMemo(() => world && bId ? world.rooms.filter(room => `${room.campus}/${room.building}` === bId && isClassroom(room)) : [], [bId, world]);
    const teaching = roomsInBuilding.length > 0 || Boolean(scene && bId && scene.hasFloors(bId));
    const stateOf = useCallback((id: string): RoomState | null => world ? world.read(day, id, moment.min) : null, [day, moment.min, world]);
    const floors = useMemo(() => scene && bId ? scene.floorsOf(bId) : [], [bId, scene]);
    const bestFloor = useMemo(() => {
        if (!floors.length) return null;
        let best = floors[0]!, most = -1;
        for (const level of floors) {
            const free = roomsInBuilding.filter(room => Number(room.floor) === level && !stateOf(room.id)?.busy).length;
            if (free > most) { most = free; best = level; }
        }
        return best;
    }, [floors, roomsInBuilding, stateOf]);
    const floor = pickedRoom?.floor ? Number(pickedRoom.floor) : floorParam && floors.includes(floorParam) ? floorParam : bestFloor;

    /* Free counts and tints, redrawn only when occupancy can change. */
    const freeBy = useMemo(() => {
        const counts = new Map<string, { free: number; total: number }>();
        if (!world) return counts;
        for (const room of world.rooms) {
            if (!isClassroom(room)) continue;
            const key = `${room.campus}/${room.building}`;
            const row = counts.get(key) ?? { free: 0, total: 0 };
            row.total++;
            if (day && !world.read(day, room.id, moment.min).busy) row.free++;
            counts.set(key, row);
        }
        return counts;
    }, [day, moment.min, world]);
    useEffect(() => {
        if (!scene) return;
        scene.setCounts(new Map([...freeBy].map(([id, row]) => [id, row.free])));
    }, [freeBy, scene]);
    useEffect(() => { scene?.setMoment(moment.date, moment.min, appearance); }, [appearance, moment.date, moment.min, scene]);

    /* Labels. */
    useEffect(() => {
        if (!scene || !world) return;
        const out: SceneLabel[] = [];
        for (const building of world.model.buildings) {
            const place = world.space.byId.get(building.id);
            const name = place?.names[0];
            const at = scene.centreOf(building.id);
            if (!name || !at) continue;
            const teaching = freeBy.has(building.id), rule = labelRule(place!, world.space.byId, teaching)!;
            out.push({ id: building.id, text: name, ...(teaching ? { count: 0 } : {}), at, height: building.height, ...rule, className: teaching ? 'teach' : rule.priority > 1 ? 'minor' : '' });
        }
        for (const place of world.space.places) {
            const rule = place.centre && place.names[0] ? labelRule(place, world.space.byId) : null;
            if (rule) out.push({ id: place.id, text: place.names[0]!, at: place.centre!, height: 0, ...rule, className: 'minor place' });
        }
        scene.setLabels(out);
        scene.setCounts(new Map([...freeBy].map(([id, row]) => [id, row.free])));
    }, [scene, world]); // eslint-disable-line react-hooks/exhaustive-deps

    /* Open the selected building, or fly to the selected place. */
    const padding = useMemo(() => wide ? { top: 60, bottom: 60, left: 50, right: 70 } : { top: 70, bottom: 272, left: 28, right: 64 }, [wide]);
    const entered = useRef<string | null>(null);
    const paints = useCallback((): RoomPaint[] => {
        if (!world || !scene || !bId || floor === null) return [];
        return scene.roomsOf(bId, floor).map(({ id }) => {
            const room = world.roomById.get(id);
            const place = world.space.byId.get(id);
            const classroom = room && isClassroom(room);
            const title = (place as Place & { title?: string } | undefined)?.title;
            return { id, tier: id === pickedRoom?.id ? 'picked' : classroom && day ? world.read(day, id, moment.min).tier : 'other', label: title ?? place?.names[0] ?? id.slice(id.lastIndexOf('-') + 1), named: Boolean(title) };
        });
    }, [bId, day, floor, moment.min, pickedRoom?.id, scene, world]);
    useEffect(() => {
        if (!scene || !world || navId) return;
        const first = entered.current === null;
        if (bId && floor !== null && scene.hasFloors(bId)) {
            const key = `${bId}/${floor}/${pickedRoom?.id ?? ''}`;
            if (entered.current !== key) {
                const rooms = scene.roomsOf(bId, floor);
                const focus = pickedRoom ? rooms.filter(room => room.id === pickedRoom.id) : rooms;
                scene.enter(bId, floor, paints(), padding, pitch, focus.map(room => room.geometry), first);
                entered.current = key;
            } else scene.paintRooms(paints());
        } else {
            if (entered.current) scene.exit();
            entered.current = '';
            const at = selected?.centre ?? (bId ? scene.centreOf(bId) : null);
            if (at) scene.focusPoint(at, padding, first);
        }
    }, [bId, floor, navId, padding, paints, pickedRoom, pitch, scene, selected, world]);

    /* Routes. */
    const destination = navId ? world?.space.byId.get(navId) : undefined;
    useEffect(() => {
        if (!destination || !world) { setRoutes([]); return; }
        const from = origin ? world.space.byId.get(origin)?.routing : me ? { type: 'position' as const, position: me as [number, number] } : null;
        if (!from) { setRoutes([]); return; }
        try {
            const answer = world.router.route({ origin: from, destination: destination.routing, mode, avoid_steps: false, max_snap_distance_m: 100, alternatives: 3 });
            setRoutes(answer.routes);
            setChosen(0);
            setNotice(answer.routes.length ? null : '没有找到路线。');
        } catch {
            setRoutes([]);
            setNotice(origin ? '没有找到路线。' : '你现在不在校园路网附近，请选一个出发地。');
        }
    }, [destination, me, mode, origin, world]);
    useEffect(() => {
        if (!scene) return;
        if (navId && entered.current) { scene.exit(); entered.current = ''; }
        scene.showRoutes(routes.map(route => route.geometry), chosen, wide ? { top: 80, bottom: 80, left: 80, right: 80 } : { top: 70, bottom: 330, left: 50, right: 50 }, pitch);
    }, [chosen, navId, pitch, routes, scene, wide]);

    const locate = useCallback(() => {
        navigator.geolocation?.getCurrentPosition(
            position => { const at: Position = [position.coords.longitude, position.coords.latitude]; setMe(at); scene?.setMe(at); },
            () => setNotice('没有拿到你的位置：请允许定位，或选一个出发地。'),
            { enableHighAccuracy: true, timeout: 10000 },
        );
    }, [scene]);
    useEffect(() => { if (navId && !me && !origin) locate(); }, [locate, me, navId, origin]);

    /* Handlers read current state through a ref so the scene never needs rebuilding. */
    handlers.current = {
        onBuilding: id => { set({ place: id, f: null, nav: null }, { push: true }); setSnap(0); },
        onRoom: id => { set({ place: id, f: null, nav: null }, { push: true }); setSnap(1); },
        onPlace: id => { set({ place: id, f: null, nav: null }, { push: true }); setSnap(0); },
        onEmpty: () => { if (placeId || navId) set({ place: null, f: null, nav: null }, { push: true }); setSnap(0); },
        onView: () => { if (scene) setNeedle(scene.map.getBearing() * 1e3 + scene.map.getPitch()); },
    };
    const setMoment = (date: string, min: number) => { set(date === now.date && min === now.min ? { t: null } : { t: momentText({ date, min }) }); };

    /* Lists. */
    const freeRooms = useMemo(() => {
        if (!world || !day) return [];
        return world.rooms.filter(isClassroom).map(room => ({ room, state: world.read(day, room.id, moment.min) })).filter(item => !item.state.busy);
    }, [day, moment.min, world]);
    const walkTo = useCallback((room: Room) => {
        if (!me || !world) return null;
        const at = world.space.byId.get(`${room.campus}/${room.building}`)?.centre;
        return at ? Math.max(1, Math.ceil(distance(me, at) / 80)) : null;
    }, [me, world]);
    const roomRows = (items: { room: Room; state: RoomState }[]) => items.map(({ room, state }) => {
        const walk = walkTo(room);
        return <button key={room.id} className="rrow" onClick={() => handlers.current.onRoom(room.id)}>
            <span className={`sw ${state.tier}`} />
            <span className="m"><span className="a">{roomLabel(room.id)}</span><span className="b">{room.seats ? `${room.seats} 座` : '座位未知'}{walk ? ` · 约步行 ${walk} 分钟` : ''}</span></span>
            <span className="r">{state.minutes ? `到 ${hm(state.until)}` : '今天没课了'}</span>
        </button>;
    });

    useEffect(() => { if (placeId || navId) setClosed(false); }, [placeId, navId]);

    /* Sheet on phones. */
    const base = navId ? 300 : pickedRoom ? 430 : placeId ? (teaching ? 230 : 260) : 190;
    const viewport = typeof innerHeight === 'number' ? innerHeight : 800;
    const sheetPeek = peek ?? (snap === 2 ? viewport - 130 : snap === 1 ? Math.max(base, Math.round(viewport * .56)) : base);
    const drag = useRef<{ y: number; start: number } | null>(null);
    const gripDown = (event: ReactPointerEvent) => { drag.current = { y: event.clientY, start: sheetPeek }; event.currentTarget.setPointerCapture(event.pointerId); };
    const gripMove = (event: ReactPointerEvent) => { if (drag.current) setPeek(Math.max(150, drag.current.start + drag.current.y - event.clientY)); };
    const gripUp = (event: ReactPointerEvent) => {
        if (!drag.current) return;
        const moved = drag.current.y - event.clientY;
        setPeek(null);
        setSnap(Math.abs(moved) < 6 ? (snap ? 0 : 1) : moved > 0 ? Math.min(2, snap + 1) : Math.max(0, snap - 1));
        drag.current = null;
    };

    /* Panels. */
    const close = () => set({ place: null, f: null, nav: null }, { push: true });
    let body = null;
    if (world && destination) {
        const route = routes[chosen];
        const name = destination.kind === 'room' ? roomLabel(destination.id) : displayName(destination, world.space.byId);
        body = <>
            <div className="card-h top"><h2>{route ? `${mode === 'walk' ? '步行' : '骑行'} ${Math.max(1, Math.ceil(route.duration_s / 60))} 分钟 · ${metres(route.distance_m)}` : name}</h2></div>
            <div className="meta">到 {name}</div>
            <label className="from">从
                <select value={origin} onChange={event => setOrigin(event.target.value)}>
                    <option value="">我的位置</option>
                    {world.space.places.filter(place => (place.kind === 'building' || place.kind === 'place') && place.id !== destination.id && place.names[0]).map(place => <option key={place.id} value={place.id}>{place.names[0]}</option>)}
                </select>
            </label>
            <div className="tabs slim">{(['walk', 'bike'] as const).map(item => <button key={item} className={mode === item ? 'on' : ''} onClick={() => setMode(item)}>{item === 'walk' ? '步行' : '骑行'}</button>)}</div>
            {routes.length > 1 && routes.map((item, index) => <button key={index} className={`occ ${index === chosen ? 'cur' : ''}`} onClick={() => setChosen(index)}><span className="tm">{Math.max(1, Math.ceil(item.duration_s / 60))} 分钟</span><span className="nm">{metres(item.distance_m)}<small>经 {visibleRouteText(item.via)}</small></span></button>)}
            {route && <ol className="steps">{route.maneuvers.map((step, index) => <li key={index}>{visibleRouteText(step.instruction)}</li>)}</ol>}
            {!route && !notice && <p className="msum">正在找你的位置…</p>}
        </>;
    } else if (world && pickedRoom && bId) {
        const room = world.roomById.get(pickedRoom.id);
        const state = room && isClassroom(room) ? stateOf(pickedRoom.id) : null;
        const title = (pickedRoom as Place & { title?: string }).title;
        const roomName = title ? `${title} ${pickedRoom.names[0]}` : roomLabel(pickedRoom.id);
        body = <>
            <div className="card-h top"><h2>{roomName}</h2></div>
            <div className="meta">{openBuilding?.names[0]} {floor} 层{room?.seats ? ` · ${room.seats} 座` : ''}{room?.kinds[0] ? ` · ${room.kinds[0].replace(/^(仙林|三牌楼|锁金)/, '')}` : ''}</div>
            {state && (!day ? <div className="state busy">这一天没有排课数据</div> : state.busy ? <div className="state busy"><b>{state.current ? '上课中' : '有人用'}</b>，到 {hm(state.until)}</div> : <div className="state"><b>空闲</b>{state.minutes ? `，到 ${hm(state.until)}，还能待 ${durationText(state.minutes)}` : '，今天没课了'}</div>)}
            {state && day && <PeriodStrip periods={world.periods} state={state} min={moment.min} />}
            <div className="btns">
                {state && <a className="btn" href={`/?who=room:${encodeURI(pickedRoom.id)}&scale=week&t=${moment.date}`}>这间的课表</a>}
                <button className="btn go" onClick={() => set({ nav: pickedRoom.id, place: null }, { push: true })}>去这里</button>
            </div>
            <a className="kv" href={photoLink(pickedRoom, roomName, openBuilding)}><span className="v">给这里拍张照<small>门牌、入口拍清楚，大家更好找</small></span><Chevron /></a>
            {state?.occupants.map(occupant => <a key={occupant.id} className={`occ ${occupant === state.current ? 'cur' : ''}`} href={`/?who=course:${encodeURI(courseName(occupant.course))}&scale=week`}><span className="tm">{hm(occupant.start)}–{hm(occupant.end)}</span><span className="nm">{courseName(occupant.course)}{occupant.kind === 'exam' ? ' · 考试' : ''}<small>{occupant.teachers.join(' ')}{occupant.classes.length ? ` · ${occupant.classes.slice(0, 2).join(' ')}${occupant.classes.length > 2 ? ' 等' : ''}` : ''}</small></span></a>)}
            {state && day && !state.occupants.length && <div className="empty small">今天没有排课</div>}
        </>;
    } else if (world && openBuilding && teaching) {
        const inFloor = roomsInBuilding.filter(room => floor === null || Number(room.floor) === floor);
        const free = inFloor.map(room => ({ room, state: stateOf(room.id)! })).filter(item => day && !item.state.busy).sort((a, b) => b.state.minutes - a.state.minutes);
        const named = scene && floor !== null ? scene.roomsOf(openBuilding.id, floor).map(({ id }) => world.space.byId.get(id)).filter((place): place is Place => Boolean(place)) : [];
        body = <>
            <div className="card-h top"><h2>{openBuilding.names[0]}{floor !== null ? ` ${floor} 层` : ''}</h2></div>
            <a className="kv" href={`/search/?within=${encodeURIComponent(openBuilding.id)}`}><span className="v">这栋楼的一切</span><Chevron /></a>
            <div className="msum">{inFloor.length ? <><b>{free.length}</b> / {inFloor.length} 间空闲{floor !== null ? ` · 全楼 ${freeBy.get(openBuilding.id)?.free ?? 0} 间` : ''}</> : '楼层布局'}</div>
            {inFloor.length > 0 ? roomRows(free) : named.map(place => <button key={place.id} className="rrow" onClick={() => handlers.current.onRoom(place.id)}><span className="m"><span className="a">{(place as Place & { title?: string }).title ?? place.names[0]}</span><span className="b">{place.names[0]}</span></span></button>)}
            {inFloor.length > 0 && !free.length && <div className="empty">这一层此刻没有空教室</div>}
        </>;
    } else if (world && selected) {
        const status = selected.hours ? openingStatus(selected.hours, campusTime()) : null;
        body = <>
            <div className="card-h top"><h2>{displayName(selected, world.space.byId)}</h2></div>
            <div className="meta">{selected.category ?? ''}</div>
            {status && status.state !== 'unknown' && <div className="state"><b className={status.state === 'closed' ? 'off' : ''}>{openingLabel[status.state]}</b> · 今日 {status.today}</div>}
            <div className="btns"><button className="btn go" onClick={() => set({ nav: selected.id, place: null }, { push: true })}>去这里</button></div>
            <a className="kv" href={`/search/?within=${encodeURIComponent(selected.id)}`}><span className="v">这里的一切</span><Chevron /></a>
            <a className="kv" href={photoLink(selected, displayName(selected, world.space.byId))}><span className="v">给这里拍张照<small>楼门、入口、店面，大家更好找</small></span><Chevron /></a>
            {selected.hours && <div className="hours">{Array.from({ length: 7 }, (_, index) => <div key={index}><span>{WEEKDAYS[index + 1]}</span><span>{selected.hours!.week[String(index + 1)]?.map(range => range.join('–')).join('、') || '不开放'}</span></div>)}</div>}
        </>;
    } else if (world) {
        // The moment on the ruler decides what is worth going to; rooms are one kind of place among them.
        const at = { day: weekdayOf(moment.date), hour: Math.floor(moment.min / 60), minute: moment.min % 60 };
        body = <>
            <div className="msum">此刻可以去</div>
            {recommendations(world.space.places, at, me as [number, number] | null).map(({ place, distance, status }) => (
                <button key={place.id} className="rrow" onClick={() => set({ place: place.id }, { push: true })}>
                    <span className="m"><span className="a">{displayName(place, world.space.byId)}</span><span className="b">{[place.category, status.state === 'unknown' ? null : openingLabel[status.state], me ? metres(distance) : null].filter(Boolean).join(' · ')}</span></span>
                </button>
            ))}
            {day && <a className="kv" href={`/search/?scope=room${isNow ? '' : `&t=${momentText(moment)}`}`}><span className="v">{freeRooms.length} 间空教室</span><Chevron /></a>}
        </>;
    }
    const holiday = world?.holidays.get(moment.date);
    const shiftDay = (by: number) => setMoment(addDays(moment.date, by), moment.min);

    const ballDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        ball.current = { x: event.clientX, y: event.clientY, moved: false };
    };
    const ballMove = (event: ReactPointerEvent) => {
        const from = ball.current;
        if (!from || !scene) return;
        const [dx, dy] = [event.clientX - from.x, event.clientY - from.y];
        if (!from.moved && Math.hypot(dx, dy) < 4) return;
        scene.steer(dx * .9, -dy * .5);
        ball.current = { x: event.clientX, y: event.clientY, moved: true };
    };
    const ballUp = () => {
        if (ball.current?.moved && scene) { dragged.current = true; set({ tilt: scene.map.getPitch() > 4 ? null : 0 }); }
        ball.current = null;
    };
    const ballClick = () => {
        if (dragged.current) { dragged.current = false; return; }
        if (scene) set({ tilt: scene.square() ? null : 0 });
    };

    return (
        <div className={`sd mapview ${closed ? 'sheet-closed' : ''}`} style={{ '--peek': `${sheetPeek}px` } as React.CSSProperties}>
            <div className="canvas" ref={canvas} aria-label="校园模型" />
            <div className="labels" ref={labels} />
            <div className="mapui">
                <a className="searchpill" href="/search/?scope=place"><Magnifier /><span>搜地点或教室</span></a>
                <button className="campus" onClick={() => setCampusOpen(true)}>仙林</button>
                <div className="camctl">
                    <button className={`ball ${hinting ? 'hinting' : ''}`} aria-label="拖动旋转，点按回正" title="拖动旋转，点按回正" onPointerDown={ballDown} onPointerMove={ballMove} onPointerUp={ballUp} onPointerCancel={ballUp} onClick={ballClick}>
                        {(() => {
                            const ball = orientationBall(scene?.map.getBearing() ?? -24, scene?.map.getPitch() ?? 52);
                            return <svg viewBox="-22 -22 44 44" data-needle={needle} aria-hidden="true">
                                <defs>
                                    <radialGradient id="ball-shade" cx="35%" cy="30%" r="75%"><stop className="ball-light" offset="0" /><stop className="ball-dark" offset="1" /></radialGradient>
                                    <radialGradient id="ball-gloss" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
                                </defs>
                                <g className="ball-turn"><path d="M-19.5 -6A20 20 0 0 0 -19.5 6" /><path d="M-21.6 3.4L-19.5 6L-17 4.2" /><path d="M19.5 6A20 20 0 0 0 19.5 -6" /><path d="M21.6 -3.4L19.5 -6L17 -4.2" /></g>
                                <circle className="ball-body" r="15" fill="url(#ball-shade)" />
                                <ellipse className="ball-gloss" cx="-5" cy="-6.5" rx="7" ry="5" fill="url(#ball-gloss)" transform="rotate(-30 -5 -6.5)" />
                                <path className="ball-ring" d={ball.ring} />
                                <path className="ball-north" d={ball.north} />
                            </svg>;
                        })()}
                    </button>
                    {hinting && <div className="ball-tip" role="status">拖动小球旋转视角 · 点按回正<br />{matchMedia('(pointer: coarse)').matches ? '双指也能旋转，上下滑动调俯仰' : '也可以按住右键拖动地图'}</div>}
                    {floors.length > 0 && <div className="floors">{[...floors].reverse().map(level => {
                        const free = roomsInBuilding.some(room => Number(room.floor) === level && day && !stateOf(room.id)?.busy);
                        return <button key={level} className={level === floor ? 'on' : ''} onClick={() => set({ place: bId, f: level })}>{level}{free && <i />}</button>;
                    })}</div>}
                    <button className="tilt" aria-label="我的位置" onClick={locate}><svg viewBox="0 0 24 24" className="target"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" /></svg></button>
                </div>
            </div>
            {closed && <button className="sheetopen" onClick={() => { setClosed(false); setSnap(0); }}><b>{hm(moment.min)}</b></button>}
            <section className={`msheet ${peek !== null ? 'drag' : ''}`} hidden={closed}>
                <div className="grip" onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp} />
                <div className="rulerbox">
                    <div className="rhead">
                        <span className="rtime">{hm(moment.min)}</span>
                        <div className="rdate"><button aria-label="前一天" onClick={() => shiftDay(-1)}><Back /></button><span>{moment.date === now.date ? '今天' : WEEKDAYS[weekdayOf(moment.date)]} {dateLabel(moment.date)}{holiday ? ` · ${holiday}` : ''}</span><button aria-label="后一天" onClick={() => shiftDay(1)}><Chevron /></button></div>
                        <button className={`rnow ${isNow ? '' : 'back'}`} onClick={() => set({ t: null })}>{isNow ? '现在' : '回到现在'}</button>
                        <button className="rclose" aria-label="关闭" onClick={() => { set({ place: null, f: null, nav: null }, { push: true }); setSnap(0); setClosed(true); }}><Cross /></button>
                    </div>
                    {world && <Ruler periods={world.periods} date={moment.date} min={moment.min} now={now} onChange={min => setMoment(moment.date, min)} />}
                </div>
                <div className="mbody" style={{ paddingBottom: wide ? undefined : `${Math.max(0, viewport - 130 - sheetPeek) + 20}px` }}>
                    {error ? <div className="empty">地图暂时打不开，请刷新重试。</div> : !world ? <div className="msum">正在打开校园…</div> : body}
                    {notice && <p className="notice" role="status">{notice}<button aria-label="知道了" onClick={() => setNotice(null)}><Cross /></button></p>}
                </div>
            </section>
            <div className="credit">© OpenStreetMap 贡献者 · njupt-map</div>
            {campusOpen && <Sheet title="校区" onClose={() => setCampusOpen(false)}>
                <div className="kv"><span className="v"><b>仙林</b><small>{world?.model.buildings.length ?? ''} 栋楼</small></span><span className="rnow">当前</span></div>
                <div className="kv"><span className="v"><b>三牌楼</b><small>地图资料收集中</small></span></div>
                <div className="kv"><span className="v"><b>锁金</b><small>地图资料收集中</small></span></div>
            </Sheet>}
        </div>
    );
}

function Ruler({ periods, date, min, now, onChange }: { periods: TeachingPeriod[]; date: string; min: number; now: { date: string; min: number }; onChange: (min: number) => void }) {
    const element = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    const from = (event: ReactPointerEvent) => {
        const box = element.current!.getBoundingClientRect();
        onChange(Math.round((RULER_START + Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (RULER_END - RULER_START)) / 5) * 5);
    };
    return (
        <div className="ruler" ref={element} role="slider" aria-label="查看的时刻" aria-valuemin={RULER_START} aria-valuemax={RULER_END} aria-valuenow={min} aria-valuetext={hm(min)} tabIndex={0}
            onKeyDown={event => { if (event.key === 'ArrowLeft') onChange(Math.max(RULER_START, min - 5)); if (event.key === 'ArrowRight') onChange(Math.min(RULER_END, min + 5)); }}
            onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); from(event); event.preventDefault(); }}
            onPointerMove={event => { if (dragging.current) from(event); }}
            onPointerUp={() => { dragging.current = false; }}>
            <div className="base">{periods.map(period => <div key={period.period} className="per" style={{ left: percent(minutesOf(period.start)), width: `${(minutesOf(period.end) - minutesOf(period.start)) / (RULER_END - RULER_START) * 100}%` }} />)}</div>
            {[8, 10, 12, 14, 16, 18, 20].map(hour => <span key={hour} className="tick" style={{ left: percent(hour * 60) }}>{hour}</span>)}
            {date === now.date && <div className="nowt" style={{ left: percent(now.min) }} />}
            <div className="cur" style={{ left: percent(min) }} />
        </div>
    );
}

function PeriodStrip({ periods, state, min }: { periods: TeachingPeriod[]; state: RoomState; min: number }) {
    const busy = (period: TeachingPeriod) => state.occupants.some(occupant => occupant.periods[0] <= period.period && period.period <= occupant.periods[1]);
    const breaks = new Set([5, 9]);
    let position: number | null = null;
    const widths = periods.flatMap(period => [{ start: minutesOf(period.start), end: minutesOf(period.end), width: 1 }, ...(breaks.has(period.period) ? [{ start: minutesOf(period.end), end: minutesOf(periods.find(next => next.period === period.period + 1)?.start ?? period.end), width: .35 }] : [])]);
    const total = widths.reduce((sum, item) => sum + item.width, 0);
    let passed = 0;
    for (const item of widths) {
        if (min < item.start) { position = passed / total; break; }
        if (min <= item.end) { position = (passed + (min - item.start) / Math.max(1, item.end - item.start) * item.width) / total; break; }
        passed += item.width;
    }
    return <>
        <div className="strip">{periods.map(period => <span key={period.period} className="seg"><i className={busy(period) ? 'b' : ''} />{breaks.has(period.period) && <i className="gap" />}</span>)}{position !== null && <u style={{ left: `${(position * 100).toFixed(1)}%` }} />}</div>
        <div className="stripn">{periods.map(period => <span key={period.period} className="seg"><span>{period.period}</span>{breaks.has(period.period) && <span className="gap" />}</span>)}</div>
    </>;
}
