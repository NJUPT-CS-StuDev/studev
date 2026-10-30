// /map/: studev's campus map on the web. Our own map (njupt-data's campus space over a
// Protomaps basemap), search over campus places and rooms (wasm-search), and walking
// and cycling routes with turn-by-turn steps (wayfind). Live navigation is the app's.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { SearchClient, type SearchResult } from 'wasm-search';
import { initialize as initializeRouting, Router, type Mode, type Position, type Route } from 'wayfind';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './map.css';
import tokens from '../../../design/tokens.json';
import MapActivities from '../../activities/MapActivities';
import { activityTokens } from '../../activities/theme';
import { ArrowUpRight, BookOpen, Building2, ChevronLeft, Hospital, MapPin, Package, Printer, ShoppingBag, Trophy, Utensils } from 'lucide-react';
import { campusTime, momentAt, openingLabel, openingStatus, recommendations } from './model/homePolicy';
import { CAMPUS_CENTRE, kindLabel, loadSpace, loadStyle, placePosition, spaceBase, type Place, type Space } from './model/space';

type Origin = { kind: 'me' } | { kind: 'place'; id: string };
const ROUTE_SOURCE = 'routes';
const categories = [
    ['食堂', Utensils], ['图书馆', BookOpen], ['教学楼', Building2], ['超市', ShoppingBag],
    ['快递', Package], ['打印', Printer], ['体育', Trophy], ['校医院', Hospital],
] as const;

const theme = (): 'light' | 'dark' => {
    const set = document.documentElement.dataset.theme;
    if (set === 'dark' || set === 'light') return set;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
const minutes = (s: number) => Math.max(1, Math.round(s / 60));
const metres = (m: number) => m < 1000 ? `${Math.round(m / 10) * 10} 米` : `${(m / 1000).toFixed(1)} 公里`;

let protocolAdded = false;

export default function MapApp() {
    const container = useRef<HTMLDivElement>(null);
    const map = useRef<MapLibre | null>(null);
    const marker = useRef<maplibregl.Marker | null>(null);
    const meMarker = useRef<maplibregl.Marker | null>(null);
    const [space, setSpace] = useState<Space | null>(null);
    const [activitySelected, setActivitySelected] = useState(false);
    const [router, setRouter] = useState<Router | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [selected, setSelected] = useState<Place | null>(null);
    const [me, setMe] = useState<Position | null>(null);
    const [origin, setOrigin] = useState<Origin>({ kind: 'me' });
    const [mode, setMode] = useState<Mode>('walk');
    const [avoidSteps, setAvoidSteps] = useState(false);
    const [routes, setRoutes] = useState<Route[]>([]);
    const [chosen, setChosen] = useState(0);
    const [planning, setPlanning] = useState(false);
    const [category, setCategory] = useState<string | null>(null);
    const [clock, setClock] = useState(() => campusTime());
    const [activeTheme, setActiveTheme] = useState(theme);
    const [loaded, setLoaded] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const panel = useRef<HTMLElement>(null);
    const planAfterSelection = useRef(false);
    const previousSelection = useRef<string | null>(null);
    const search = useMemo(() => new SearchClient({ baseUrl: `${spaceBase()}/search` }), []);

    useEffect(() => {
        const timer = setInterval(() => setClock(campusTime()), 15_000);
        const observer = new MutationObserver(() => setActiveTheme(theme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => { clearInterval(timer); observer.disconnect(); search.dispose(); };
    }, [search]);

    // Data, routing kernel and the map.
    useEffect(() => {
        let cancelled = false;
        if (!protocolAdded) {
            maplibregl.setWorkerUrl(workerUrl);
            maplibregl.addProtocol('pmtiles', new Protocol().tile);
            protocolAdded = true;
        }
        const colors = tokens.color[activeTheme];
        setLoaded(false);
        Promise.all([loadSpace(), loadStyle(activeTheme), initializeRouting()]).then(([loaded, style]) => {
            if (cancelled || !container.current) return;
            setSpace(loaded);
            setRouter(new Router(loaded.network));
            const instance = new maplibregl.Map({
                container: container.current, style, center: CAMPUS_CENTRE, zoom: 15.6, maxPitch: 70,
                localIdeographFontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif",
                attributionControl: { compact: true },
            });
            instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
            instance.on('load', () => {
                setLoaded(true);
                instance.addSource(ROUTE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                instance.addSource('selected-entrances', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                instance.addLayer({ id: 'selected-entrances', type: 'circle', source: 'selected-entrances', paint: { 'circle-radius': 4, 'circle-color': colors.brand, 'circle-stroke-color': colors.paper, 'circle-stroke-width': 2 } });
                const before = instance.getLayer('campus-place-label') ? 'campus-place-label' : undefined;
                instance.addLayer({ id: 'route-alternative', type: 'line', source: ROUTE_SOURCE, filter: ['!', ['get', 'chosen']],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: { 'line-color': colors.routeAlternative, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 19, 12] } }, before);
                instance.addLayer({ id: 'route-casing', type: 'line', source: ROUTE_SOURCE, filter: ['get', 'chosen'],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: { 'line-color': colors.routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 19, 16] } }, before);
                instance.addLayer({ id: 'route', type: 'line', source: ROUTE_SOURCE, filter: ['get', 'chosen'],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: { 'line-color': colors.route, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 4, 19, 12] } }, before);

            });
            instance.on('click', event => {
                const alternative = instance.getLayer('route-alternative') ? instance.queryRenderedFeatures(event.point, { layers: ['route-alternative'] })[0] : undefined;
                if (alternative) { setChosen(Number(alternative.properties?.index ?? 0)); return; }
                const hit = instance.queryRenderedFeatures(event.point, { layers: ['campus-building', 'campus-building-3d', 'campus-place'].filter(id => instance.getLayer(id)) })
                    .find(feature => feature.properties?.id);
                const place = hit ? loaded.byId.get(String(hit.properties.id)) : undefined;
                if (place) setSelected(place);
            });
            map.current = instance;
            const wanted = new URLSearchParams(location.search).get('place');
            if (wanted && loaded.byId.has(wanted)) setSelected(loaded.byId.get(wanted) ?? null);
        }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
        return () => {
            cancelled = true;
            map.current?.remove();
            map.current = null;
            marker.current = null;
            meMarker.current = null;
        };
    }, [activeTheme]);

    // Search as one types.
    useEffect(() => {
        const text = query.trim();
        if (!text) { setResults([]); return; }
        const { requestId, response } = search.search({ query: text, limit: 8, sort: 'relevance', filters: {} }, update => setResults(update.results));
        response.then(answer => setResults(answer.results)).catch(() => undefined);
        return () => search.cancel(requestId);
    }, [query, search]);

    // The selected place: highlighted, centred, in the address.
    useEffect(() => {
        const instance = map.current;
        if (!instance || !space || !loaded) return;
        instance.removeFeatureState({ source: 'places' });
        marker.current?.remove();
        const planActivity = planAfterSelection.current;
        if (previousSelection.current !== (selected?.id ?? null)) {
            setRoutes([]);
            setPlanning(planAfterSelection.current);
            setExpanded(false);
            planAfterSelection.current = false;
            previousSelection.current = selected?.id ?? null;
        }
        (instance.getSource('selected-entrances') as GeoJSONSource).setData({ type: 'FeatureCollection', features: (selected?.entrances ?? []).map(entrance => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: entrance.at } })) });
        const url = new URL(location.href);
        if (selected && !planActivity) url.searchParams.delete('activity');
        if (!selected) {
            url.searchParams.delete('place');
            history.replaceState(null, '', url);
            return;
        }
        if (selected.kind !== 'activity-point') url.searchParams.set('place', selected.id);
        history.replaceState(null, '', url);
        const building = selected.kind === 'room' ? selected.parent : selected.id;
        if (space.byId.get(building)?.kind === 'building') instance.setFeatureState({ source: 'places', id: building }, { selected: true });
        const at = placePosition(space, selected);
        if (at) {
            marker.current = new maplibregl.Marker({ color: tokens.color[theme()].brand }).setLngLat(at).addTo(instance);
            const phone = window.innerWidth <= 680;
            instance.easeTo({ center: at, zoom: Math.max(instance.getZoom(), 17), padding: { top: 0, left: phone ? 0 : 408, right: 0, bottom: phone ? instance.getContainer().clientHeight * .42 : 0 }, duration: tokens.motion.camera });
        }
    }, [selected, space, loaded]);

    useEffect(() => {
        if (!me || !map.current || !loaded) return;
        if (!meMarker.current) {
            const dot = document.createElement('div');
            dot.className = 'campus-map-me';
            meMarker.current = new maplibregl.Marker({ element: dot }).setLngLat(me).addTo(map.current);
        } else meMarker.current.setLngLat(me);
    }, [me, loaded]);

    const locate = useCallback(() => {
        navigator.geolocation?.getCurrentPosition(
            position => {
                const at: Position = [position.coords.longitude, position.coords.latitude];
                setMe(at);
                map.current?.easeTo({ center: at, zoom: 17, duration: tokens.motion.camera });
            },
            () => setError('无法获取你的位置：请允许浏览器使用定位，或从地图上选择出发地。'),
            { enableHighAccuracy: true, timeout: 10000 },
        );
    }, []);

    // Plan routes whenever the request changes.
    useEffect(() => {
        if (!planning || !router || !space || !selected) return;
        const target = selected.routing;
        const from = origin.kind === 'me'
            ? (me ? { type: 'position' as const, position: me } : null)
            : space.byId.get(origin.id)?.routing;
        if (!from) { if (origin.kind === 'me') locate(); return; }
        try {
            const answer = router.route({ origin: from, destination: target, mode, avoid_steps: avoidSteps, max_snap_distance_m: 100, alternatives: 3 });
            setRoutes(answer.routes);
            setChosen(0);
            setError(answer.routes.length ? null : '没有找到路线。');
        } catch (reason) {
            setRoutes([]);
            setError(origin.kind === 'me' ? '你当前不在校园路网附近，请从地图上选择出发地。' : String(reason));
        }
    }, [planning, router, space, selected, origin, me, mode, avoidSteps, locate]);

    // Draw routes, the chosen one on top.
    useEffect(() => {
        const instance = map.current;
        const source = instance?.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
        if (!instance || !source) return;
        source.setData({ type: 'FeatureCollection', features: routes.map((route, i) => ({
            type: 'Feature' as const, properties: { chosen: i === chosen, index: i }, geometry: { type: 'LineString' as const, coordinates: route.geometry },
        })).sort((a, b) => Number(a.properties.chosen) - Number(b.properties.chosen)) });
        const route = routes[chosen];
        if (route) {
            const bounds = route.geometry.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(route.geometry[0], route.geometry[0]));
            const phone = window.innerWidth <= 680;
            const cardHeight = panel.current?.querySelector('.campus-map-card')?.getBoundingClientRect().height ?? 260;
            // fitBounds adds its padding to the current camera padding. Clear
            // the place-sheet inset first, otherwise a phone has no space left.
            instance.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
            instance.fitBounds(bounds, { padding: { top: phone ? 120 : 60, bottom: phone ? Math.min(cardHeight + 24, instance.getContainer().clientHeight * .52) : 60, left: phone ? 28 : 440, right: phone ? 28 : 60 }, duration: tokens.motion.camera, maxZoom: 18 });
        }
    }, [routes, chosen, loaded]);

    const route = routes[chosen];
    const moment = momentAt(clock.hour);
    const ranked = useMemo(() => recommendations(space?.places ?? [], clock, me, category), [space, clock, me, category]);
    const status = openingStatus(selected?.hours, clock);
    const pick = (result: SearchResult) => {
        const place = space?.byId.get(result.id);
        if (place) { setSelected(place); setQuery(''); setResults([]); }
    };

    return (
        <div className="campus-map" style={activityTokens}>
            <div ref={container} className="campus-map-canvas" />
            <aside ref={panel} className={`campus-map-panel${query ? ' is-searching' : ''}${expanded ? ' is-expanded' : ''}`} aria-label="校园地图">
                <div className="campus-map-search">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索地点、楼栋或教室" aria-label="搜索地点、楼栋或教室"
                        onKeyDown={e => { if (e.key === 'Enter' && results[0]) pick(results[0]); }} />
                    {query && <button type="button" className="campus-map-clear" onClick={() => setQuery('')} aria-label="清空">×</button>}
                </div>
                {!query && <nav className="campus-map-modules" aria-label="校园服务"><a href="/search/timetable/">课表</a><a href="/search/exam/">考试</a><a href="/search/classrooms/">空教室</a><a href="/search/">校园搜索</a></nav>}
                {results.length > 0 && (
                    <ul className="campus-map-results">
                        {results.map(result => (
                            <li key={result.id}><button type="button" onClick={() => pick(result)}>
                                <span className="campus-map-result-title">{result.title}</span>
                                <span className="campus-map-result-meta">{result.sourceName}{result.section ? ` · ${result.section}` : ''}</span>
                            </button></li>
                        ))}
                    </ul>
                )}
                {error && <p className="campus-map-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="关闭">×</button></p>}
                <MapActivities map={loaded ? map.current : null} space={space} routeOpen={planning} placeSelected={selected !== null} onPick={() => setSelected(null)} onSelectionChange={setActivitySelected} onRoute={place => { planAfterSelection.current = true; setSelected(place); }} />
                {!space && !error && <p className="campus-map-error" role="status">正在加载校园地图…</p>}
                {!selected && !activitySelected && space && !query && <section className="campus-map-card campus-map-home">
                    <button className="campus-map-sheet-handle" type="button" aria-label={expanded ? '收起推荐' : '展开推荐'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span /></button>
                    <nav className="campus-map-categories" aria-label="地点分类">{categories.filter(([name]) => space.places.some(p => p.category === name)).map(([name, Icon]) => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(category === name ? null : name)}><span><Icon size={21} strokeWidth={1.8} /></span>{name}</button>)}</nav>
                    <header className="campus-map-home-heading">
                        {category && <button type="button" className="campus-map-back" aria-label="返回热门推荐" onClick={() => setCategory(null)}><ChevronLeft size={20} /></button>}
                        <div><p>{category ? '校园生活' : moment.title}</p><h2>{category ? `附近${category}` : '热门推荐'}</h2><p>{category ? `${ranked.length} 个地点` : moment.subtitle}</p></div>
                    </header>
                    <ul className="campus-map-recommendations">{ranked.map(item => {
                        const Icon = categories.find(([name]) => name === item.place.category)?.[1] ?? MapPin;
                        return <li key={item.place.id}><button type="button" onClick={() => setSelected(item.place)}><span className="campus-map-place-icon"><Icon size={22} strokeWidth={1.8} /></span><span className="campus-map-place-copy"><strong>{item.place.id}</strong><span>{item.status.state !== 'unknown' && <em data-state={item.status.state}>{openingLabel[item.status.state]}</em>}{metres(item.distance)}</span><small>{item.place.use}</small></span></button><button className="campus-map-go" type="button" aria-label={`前往${item.place.id}`} onClick={() => { planAfterSelection.current = true; setSelected(item.place); }}><ArrowUpRight size={21} /></button></li>;
                    })}</ul>
                    {!ranked.length && <p className="campus-map-houses">暂无符合当前时段的地点，试试上方分类</p>}
                    <p className="campus-map-distance-note">{me ? '距离为直线距离 · 路线以实际规划为准' : '距校区中心的直线距离 · 定位后可查看附近'}</p>
                </section>}
                {selected && space && (
                    <section className="campus-map-card">
                        <button className="campus-map-sheet-handle" type="button" aria-label={expanded ? '收起详情' : '展开详情'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span /></button>
                        <header>
                            <div>
                                <h2>{selected.id}</h2>
                                <p>{selected.kind === 'activity-point' ? '活动集合点' : kindLabel(selected)}{selected.kind === 'room' ? ` · ${selected.parent} ${selected.floor ? `${selected.floor} 楼` : ''}${selected.seats ? ` · ${selected.seats} 座` : ''}` : ''}
                                    {selected.levels ? ` · ${selected.levels} 层` : ''}</p>
                            </div>
                            <button type="button" className="campus-map-close" onClick={() => setSelected(null)} aria-label="关闭">×</button>
                        </header>
                        {selected.kind !== 'activity-point' && <p className="campus-map-houses">用途 · {selected.use}</p>}
                        {selected.hours && <details className="campus-map-hours">
                            <summary><span data-state={status.state}>{openingLabel[status.state]}</span><span>今日 {status.today}</span><small>一周时间</small></summary>
                            {status.state === 'closing' && <p>{status.closesAt} 关闭，请留意时间</p>}
                            <dl>{Array.from({ length: 7 }, (_, i) => <div key={i}><dt>周{'一二三四五六日'[i]}</dt><dd>{selected.hours!.week[String(i + 1)]?.map(r => r.join('–')).join('、') || '不开放'}</dd></div>)}</dl>
                            {selected.hours.note && <p>{selected.hours.note}</p>}
                        </details>}
                        {!!selected.entrances?.length && <p className="campus-map-houses">{selected.entrances.length} 个入口 · 路线自动选择适合的入口</p>}
                        {selected.houses && selected.houses.length > 0 && <p className="campus-map-houses">{selected.houses.slice(0, 6).join('、')}</p>}
                        {!planning ? (
                            <button type="button" className="campus-map-primary" onClick={() => setPlanning(true)}>
                                路线
                            </button>
                        ) : (
                            <div className="campus-map-plan">
                                <label className="campus-map-from">从
                                    <select value={origin.kind === 'me' ? '' : origin.id} onChange={e => setOrigin(e.target.value ? { kind: 'place', id: e.target.value } : { kind: 'me' })}>
                                        <option value="">我的位置</option>
                                        {space.places.filter(p => p.kind !== 'room' && p.id !== selected.id).map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                                    </select>
                                </label>
                                <div className="campus-map-modes" role="radiogroup" aria-label="出行方式">
                                    {(['walk', 'bike'] as const).map(m => (
                                        <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'walk' ? '步行' : '骑行'}</button>
                                    ))}
                                    {mode === 'walk' && <label className="campus-map-steps"><input type="checkbox" checked={avoidSteps} onChange={e => setAvoidSteps(e.target.checked)} />避开楼梯</label>}
                                </div>
                                {routes.length > 0 && (
                                    <div className="campus-map-routes">
                                        {routes.map((r, i) => (
                                            <button key={i} type="button" aria-pressed={i === chosen} className={i === chosen ? 'on' : ''} onClick={() => setChosen(i)}>
                                                <strong>{minutes(r.duration_s)} 分钟</strong><span>{metres(r.distance_m)}</span><small>经 {r.via}</small>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {route && (
                                    <details className="campus-map-directions"><summary>路线详情 · {route.maneuvers.length} 步</summary><ol className="campus-map-steps-list">
                                        {route.maneuvers.map((m, i) => <li key={i}><span>{m.instruction}</span>{m.distance_to_next_m > 0 && <small>{metres(m.distance_to_next_m)}</small>}</li>)}
                                    </ol><p className="campus-map-houses">到达 {selected.id}{selected.floor ? ` · ${selected.floor} 楼` : ''}</p></details>
                                )}
                            </div>
                        )}
                        <a className="activity-map-create" href={selected.kind === 'activity-point' && selected.centre ? `/activities/?new=1&lon=${selected.centre[0]}&lat=${selected.centre[1]}` : `/activities/?place=${encodeURIComponent(selected.id)}`}>在这里发起活动</a>
                    </section>
                )}
            </aside>
            <button type="button" className="campus-map-locate" onClick={() => { locate(); if (me) map.current?.easeTo({ center: me, zoom: 17 }); }} aria-label="我的位置">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7.5" /></svg>
            </button>
        </div>
    );
}
