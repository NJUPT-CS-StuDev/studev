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
import { CAMPUS_CENTRE, kindLabel, loadSpace, loadStyle, placePosition, spaceBase, type Place, type Space } from './model/space';

type Origin = { kind: 'me' } | { kind: 'place'; id: string };
const ROUTE_SOURCE = 'routes';

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
    const [mapReady, setMapReady] = useState(false);
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
    const activityRouting = useRef(false);
    const search = useMemo(() => new SearchClient({ baseUrl: `${spaceBase()}/search` }), []);

    // Data, routing kernel and the map.
    useEffect(() => {
        let cancelled = false;
        if (!protocolAdded) {
            maplibregl.setWorkerUrl(workerUrl);
            maplibregl.addProtocol('pmtiles', new Protocol().tile);
            protocolAdded = true;
        }
        const colors = tokens.color[theme()];
        Promise.all([loadSpace(), loadStyle(theme()), initializeRouting()]).then(([loaded, style]) => {
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
                instance.addSource(ROUTE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
                setMapReady(true);
            });
            instance.on('click', event => {
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
            search.dispose();
        };
    }, [search]);

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
        if (!instance || !space || !mapReady) return;
        instance.removeFeatureState({ source: 'places' });
        marker.current?.remove();
        setRoutes([]);
        const planActivity = activityRouting.current;
        setPlanning(planActivity);
        activityRouting.current = false;
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
            instance.easeTo({ center: at, zoom: Math.max(instance.getZoom(), 17), duration: 650 });
        }
    }, [selected, space, mapReady]);

    useEffect(() => {
        if (!me || !map.current) return;
        if (!meMarker.current) {
            const dot = document.createElement('div');
            dot.className = 'campus-map-me';
            meMarker.current = new maplibregl.Marker({ element: dot }).setLngLat(me).addTo(map.current);
        } else meMarker.current.setLngLat(me);
    }, [me]);

    const locate = useCallback(() => {
        navigator.geolocation?.getCurrentPosition(
            position => setMe([position.coords.longitude, position.coords.latitude]),
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
            type: 'Feature' as const, properties: { chosen: i === chosen }, geometry: { type: 'LineString' as const, coordinates: route.geometry },
        })).sort((a, b) => Number(a.properties.chosen) - Number(b.properties.chosen)) });
        const route = routes[chosen];
        if (route) {
            const bounds = route.geometry.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(route.geometry[0], route.geometry[0]));
            instance.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: window.innerWidth > 720 ? 440 : 40, right: 60 }, duration: 650, maxZoom: 18 });
        }
    }, [routes, chosen, mapReady]);

    const route = routes[chosen];
    const pick = (result: SearchResult) => {
        const place = space?.byId.get(result.id);
        if (place) { setSelected(place); setQuery(''); setResults([]); }
    };

    return (
        <div className="campus-map" style={activityTokens}>
            <div ref={container} className="campus-map-canvas" />
            <aside className="campus-map-panel" aria-label="校园地图">
                <div className="campus-map-search">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索地点、楼栋或教室" aria-label="搜索地点、楼栋或教室"
                        onKeyDown={e => { if (e.key === 'Enter' && results[0]) pick(results[0]); }} />
                    {query && <button type="button" className="campus-map-clear" onClick={() => setQuery('')} aria-label="清空">×</button>}
                </div>
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
                <MapActivities map={map.current} space={space} routeOpen={planning} placeSelected={selected !== null} onPick={() => setSelected(null)} onRoute={place => { activityRouting.current = true; setSelected(place); }} />
                {selected && space && (
                    <section className="campus-map-card">
                        <header>
                            <div>
                                <h2>{selected.id}</h2>
                                <p>{selected.kind === 'activity-point' ? '活动集合点' : kindLabel(selected)}{selected.kind === 'room' ? ` · ${selected.parent} ${selected.floor ? `${selected.floor} 楼` : ''}${selected.seats ? ` · ${selected.seats} 座` : ''}` : ''}
                                    {selected.levels ? ` · ${selected.levels} 层` : ''}</p>
                            </div>
                            <button type="button" className="campus-map-close" onClick={() => setSelected(null)} aria-label="关闭">×</button>
                        </header>
                        {selected.kind !== 'activity-point' && <><p className="campus-map-houses">用途 · {selected.use}</p>
                        {selected.hours ? <details className="campus-map-hours">
                            <summary>开放时间 · 今日 {selected.hours.week[String((new Date().getDay() + 6) % 7 + 1)]?.map(r => r.join('–')).join('、') || '不开放'}</summary>
                            <dl>{Array.from({ length: 7 }, (_, i) => <div key={i}><dt>周{'一二三四五六日'[i]}</dt><dd>{selected.hours!.week[String(i + 1)]?.map(r => r.join('–')).join('、') || '不开放'}</dd></div>)}</dl>
                            {selected.hours.note && <p>{selected.hours.note}</p>}
                        </details> : <p className="campus-map-houses">开放时间待确认</p>}</>}
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
                                        {space.places.filter(p => p.kind === 'building' && p.id !== selected.id).map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
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
                                            <button key={i} type="button" className={i === chosen ? 'on' : ''} onClick={() => setChosen(i)}>
                                                <strong>{minutes(r.duration_s)} 分钟</strong><span>{metres(r.distance_m)}</span><small>经{r.via}</small>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {route && (
                                    <ol className="campus-map-steps-list">
                                        {route.maneuvers.map((m, i) => <li key={i}>{m.instruction}</li>)}
                                    </ol>
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
