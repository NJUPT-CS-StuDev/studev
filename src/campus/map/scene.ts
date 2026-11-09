// One campus scene whose light, colour and room states follow the viewed moment. A flat
// map is this scene seen from straight above; there is no second mode.
import * as maplibregl from 'maplibre-gl';
import type { Appearance } from '@/world/appearance';
import type { GeoJSONSource, Map as MapLibre, StyleSpecification } from 'maplibre-gl';
import type { Geometry, Position } from 'geojson';
import { Protocol } from 'pmtiles';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import tokens from '../../../design/tokens.json';
import type { RoomTier } from '@/world/rooms';
import { modelLayer, type ModelIndex, type ModelLook } from './models';
import { sunAt } from './model/sun';

interface ModelFloor { level: number; plate: Geometry; cores: { kind: string; geometry: Geometry }[]; rooms: { id: string; geometry: Geometry }[] }
const LABEL_LAYERS = ['way-label', 'water-label', 'green-label', 'surface-label', 'sport-label', 'context-label', 'nearby-label'];

export interface CampusModel {
    buildings: { id: string; levels: number; height: number; geometry: Geometry }[];
    context: { height: number; geometry: Geometry }[];
    floors: Record<string, ModelFloor>;
}
export interface SceneLabel { id: string; text: string; count?: number; at: Position; height: number; minZoom: number; priority: number; className: string }
export interface RoomPaint { id: string; tier: RoomTier | 'picked'; label: string; named: boolean }
export interface SceneHandlers { onBuilding: (id: string) => void; onRoom: (id: string) => void; onPlace: (id: string) => void; onEmpty: () => void; onView: () => void }

const NONE = { type: 'FeatureCollection' as const, features: [] };
const FLAT = 0.14;
const SHADOW = { w: 118.912, e: 118.938, s: 32.102, n: 32.128, W: 1664, H: 2048 };
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map(i => {
    const left = parseInt(a.slice(i, i + 2), 16);
    return Math.round(left + (parseInt(b.slice(i, i + 2), 16) - left) * t).toString(16).padStart(2, '0');
}).join('');
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const shadowX = (lon: number) => (lon - SHADOW.w) / (SHADOW.e - SHADOW.w) * SHADOW.W;
const shadowY = (lat: number) => (merc(SHADOW.n) - merc(lat)) / (merc(SHADOW.n) - merc(SHADOW.s)) * SHADOW.H;
const polygons = (geometry: Geometry): Position[][][] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
const ring = (geometry: Geometry) => polygons(geometry)[0]?.[0] ?? [];
const bounds = (geometry: Geometry) => {
    let box = [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number];
    for (const polygon of polygons(geometry)) for (const part of polygon) for (const [x, y] of part) box = [Math.min(box[0], x!), Math.min(box[1], y!), Math.max(box[2], x!), Math.max(box[3], y!)];
    return box;
};
const shrink = (geometry: Geometry, by: number): Geometry => {
    const inset = (part: Position[]) => {
        const n = part.length - 1 || 1;
        let x = 0, y = 0;
        for (let i = 0; i < n; i++) { x += part[i]![0]!; y += part[i]![1]!; }
        x /= n; y /= n;
        return part.map(p => [x + (p[0]! - x) * by, y + (p[1]! - y) * by]);
    };
    return geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: geometry.coordinates.map(inset) }
        : geometry.type === 'MultiPolygon' ? { type: 'MultiPolygon', coordinates: geometry.coordinates.map(polygon => polygon.map(inset)) } : geometry;
};
const principalBearing = (geometry: Geometry) => {
    const points = ring(geometry);
    const cosine = Math.cos(32.11 * Math.PI / 180);
    let best = 0, angle = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const dx = (points[i + 1]![0]! - points[i]![0]!) * cosine;
        const dy = points[i + 1]![1]! - points[i]![1]!;
        if (dx * dx + dy * dy > best) { best = dx * dx + dy * dy; angle = Math.atan2(dx, dy) * 180 / Math.PI; }
    }
    let bearing = angle - 90;
    while (bearing > 90) bearing -= 180;
    while (bearing < -90) bearing += 180;
    return bearing;
};

let protocolAdded = false;

export class CampusScene {
    readonly map: MapLibre;
    private readonly host: HTMLElement;
    private readonly labelHost: HTMLElement;
    private readonly model: CampusModel;
    private readonly handlers: SceneHandlers;
    private readonly byId: Map<string, CampusModel['buildings'][number]>;
    private shadowCanvas = document.createElement('canvas');
    private shadowDraft = document.createElement('canvas');
    private ready = false;
    private queued: (() => void)[] = [];
    private routeColours: Record<'day' | 'night', { line: string; casing: string; alternative: string }> | null = null;
    private night = 0;
    private building: string | null = null;
    private floor: number | null = null;
    private level = 0;
    private flatten = 1;
    private animation = 0;
    private labels: (SceneLabel & { el: HTMLElement; w: number; h: number })[] = [];
    private roomLabels: { el: HTMLElement; at: Position; box: [number, number, number, number]; picked: boolean; min: number }[] = [];
    private roomTop = 0;
    private tick = false;
    private lastShadow = 0;
    private shadowTimer = 0;
    private me: HTMLElement;
    private meAt: Position | null = null;
    private roomPaint = new Map<string, string>();
    private modelled: string[] = [];
    private modelLook: ModelLook = { hidden: null, flatten: 1, night: 0, faded: 0, fadeTo: [0, 0, 0] };

    constructor(host: HTMLElement, labelHost: HTMLElement, style: StyleSpecification, model: CampusModel, center: Position, pitch: number, handlers: SceneHandlers) {
        if (!protocolAdded) { maplibregl.setWorkerUrl(workerUrl); maplibregl.addProtocol('pmtiles', new Protocol().tile); protocolAdded = true; }
        this.host = host;
        this.labelHost = labelHost;
        this.model = model;
        this.handlers = handlers;
        this.byId = new Map(model.buildings.map(building => [building.id, building]));
        this.shadowCanvas.width = this.shadowDraft.width = SHADOW.W;
        this.shadowCanvas.height = this.shadowDraft.height = SHADOW.H;
        this.me = document.createElement('div');
        this.me.className = 'you';
        labelHost.appendChild(this.me);
        this.map = new maplibregl.Map({
            container: host, style, center: center as [number, number], zoom: innerWidth >= 1000 ? 16.05 : 15.75, pitch, bearing: -24, maxPitch: 72, minZoom: 13.5, maxZoom: 21,
            attributionControl: false, canvasContextAttributes: { antialias: true },
            localIdeographFontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif",
        });
        this.map.on('load', () => this.onLoad());
        this.map.on('click', event => this.onClick(event.point));
        this.map.on('render', () => {
            if (this.tick) return;
            this.tick = true;
            requestAnimationFrame(() => { this.tick = false; this.placeLabels(); handlers.onView(); });
        });
        labelHost.addEventListener('click', event => {
            const target = (event.target as HTMLElement).closest<HTMLElement>('.lb');
            if (target?.dataset.id) (target.dataset.kind === 'building' ? handlers.onBuilding : handlers.onPlace)(target.dataset.id);
        });
    }

    private onLoad() {
        const map = this.map;
        map.addSource('shadow', { type: 'canvas', canvas: this.shadowCanvas, coordinates: [[SHADOW.w, SHADOW.n], [SHADOW.e, SHADOW.n], [SHADOW.e, SHADOW.s], [SHADOW.w, SHADOW.s]], animate: false });
        map.addLayer({ id: 'shadow', type: 'raster', source: 'shadow', paint: { 'raster-opacity': .16, 'raster-fade-duration': 0 } }, 'context');
        for (const id of ['route', 'sel', 'selshell', 'selcore', 'selrooms']) map.addSource(id, { type: 'geojson', data: NONE });
        this.routeColours = (map.getStyle().metadata as { route: NonNullable<CampusScene['routeColours']> }).route;
        const routeTheme = this.routeColours.day;
        const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
        map.addLayer({ id: 'route-alternative', type: 'line', source: 'route', filter: ['!', ['get', 'chosen']], layout: round, paint: { 'line-color': routeTheme.alternative, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 7] } }, 'context');
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route', filter: ['get', 'chosen'], layout: round, paint: { 'line-color': routeTheme.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 5, 18, 11] } }, 'context');
        map.addLayer({ id: 'route', type: 'line', source: 'route', filter: ['get', 'chosen'], layout: round, paint: { 'line-color': routeTheme.line, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.6, 18, 6.5] } }, 'context');
        const hidden = { visibility: 'none' } as const;
        map.addLayer({ id: 'sel-lower', type: 'fill-extrusion', source: 'sel', layout: hidden, paint: { 'fill-extrusion-height': 1 } });
        map.addLayer({ id: 'sel-slab', type: 'fill-extrusion', source: 'sel', layout: hidden, paint: { 'fill-extrusion-height': 1 } });
        map.addLayer({ id: 'sel-rooms', type: 'fill-extrusion', source: 'selrooms', layout: hidden, paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': 1 } });
        map.addLayer({ id: 'sel-core', type: 'fill-extrusion', source: 'selcore', layout: hidden, paint: { 'fill-extrusion-color': '#E3E5E8', 'fill-extrusion-height': 1 } });
        map.addLayer({ id: 'sel-upper', type: 'fill-extrusion', source: 'selshell', layout: hidden, paint: { 'fill-extrusion-height': 1 } });
        this.ready = true;
        this.queued.splice(0).forEach(run => run());
    }

    whenReady(run: () => void) { if (this.ready) run(); else this.queued.push(run); }
    destroy() { clearTimeout(this.shadowTimer); cancelAnimationFrame(this.animation); this.map.remove(); this.labelHost.replaceChildren(); }

    /** The light of a moment. A chosen appearance holds it at day or night; "auto" follows the sun. */
    setMoment(date: string, min: number, appearance: Appearance) {
        if (!this.ready) return;
        const altitude = sunAt(date, min).alt;
        const night = appearance === 'dark' ? 1 : appearance === 'light' ? 0 : altitude >= 8 ? 0 : altitude <= -5 ? 1 : (8 - altitude) / 13;
        if (night.toFixed(2) !== this.night.toFixed(2) || !this.painted) {
            this.night = night;
            this.painted = true;
            this.paintGround();
            this.paintBuildings();
            this.paintSelectionColours();
        }
        this.queueShadows(date, appearance === 'light' && altitude < 8 ? 720 : min);
    }
    private painted = false;
    private palette() {
        const { day, night } = tokens.scene;
        return Object.fromEntries(Object.keys(day).filter(key => key !== 'room').map(key => [key, mix(day[key as keyof typeof day] as string, night[key as keyof typeof night] as string, this.night)])) as Record<keyof typeof day, string>;
    }
    private paintGround() {
        const palette = this.palette();
        const set = (layer: string, property: string, value: string) => this.map.setPaintProperty(layer, property as never, value as never);
        set('bg', 'background-color', palette.ground);
        set('campus', 'fill-color', palette.campus);
        set('surfaces', 'fill-color', palette.surface);
        set('greens', 'fill-color', palette.green);
        set('sports', 'fill-color', palette.sport);
        set('waters', 'fill-color', palette.water);
        set('roads', 'line-color', palette.road);
        set('paths', 'line-color', palette.path);
        set('context', 'fill-extrusion-color', palette.context);
        for (const layer of LABEL_LAYERS) {
            set(layer, 'text-color', palette.label);
            set(layer, 'text-halo-color', palette.halo);
        }
        const route = this.routeColours![this.night > .55 ? 'night' : 'day'];
        set('route-alternative', 'line-color', route.alternative);
        set('route-casing', 'line-color', route.casing);
        set('route', 'line-color', route.line);
        this.labelHost.classList.toggle('scene-night', this.night > .55);
    }
    /** How free each teaching building is, as a share of its classrooms. */
    private paintBuildings() {
        const palette = this.palette();
        const faded = mix(palette.model, palette.campus, .72);
        const open = this.building && this.hasFloors(this.building);
        // The forms carry their own colours, dimmed as the night comes on.
        const dim = 1 - this.night * .78;
        const own = ['to-rgba', ['to-color', ['get', 'color']]];
        const lit = this.night < .01 ? ['to-color', ['get', 'color']] : ['rgba', ['*', ['at', 0, own], dim], ['*', ['at', 1, own], dim], ['*', ['at', 2, own], dim], 1];
        this.map.setPaintProperty('plain', 'fill-extrusion-color', (open ? faded : lit) as never);
        this.modelLook = { ...this.modelLook, hidden: open ? this.building : null, night: this.night, faded: open ? 1 : 0, fadeTo: rgb(faded) };
        this.map.triggerRepaint();
    }
    private paintSelectionColours() {
        const palette = this.palette();
        this.map.setPaintProperty('sel-lower', 'fill-extrusion-color', palette.model);
        this.map.setPaintProperty('sel-upper', 'fill-extrusion-color', palette.model);
        this.map.setPaintProperty('sel-slab', 'fill-extrusion-color', palette.slab);
    }
    private queueShadows(date: string, min: number) {
        clearTimeout(this.shadowTimer);
        const wait = 160 - (performance.now() - this.lastShadow);
        const draw = () => { this.lastShadow = performance.now(); this.drawShadows(date, min); };
        if (wait <= 0) draw(); else this.shadowTimer = window.setTimeout(draw, wait);
    }
    private drawShadows(date: string, min: number) {
        const sun = sunAt(date, min);
        const draft = this.shadowDraft.getContext('2d')!;
        const out = this.shadowCanvas.getContext('2d')!;
        draft.clearRect(0, 0, SHADOW.W, SHADOW.H);
        out.clearRect(0, 0, SHADOW.W, SHADOW.H);
        if (sun.alt > 1.5) {
            const length = 1 / Math.tan(Math.max(sun.alt, 7) * Math.PI / 180);
            const azimuth = sun.az * Math.PI / 180;
            const dLon = -Math.sin(azimuth) * length / (111320 * Math.cos(32.11 * Math.PI / 180));
            const dLat = -Math.cos(azimuth) * length / 110574;
            draft.fillStyle = '#000';
            for (const { geometry, height } of [...this.model.context, ...this.model.buildings]) {
                const dx = dLon * height, dy = dLat * height;
                for (const polygon of polygons(geometry)) {
                    const edge = polygon[0]!;
                    draft.beginPath();
                    edge.forEach((p, i) => { const x = shadowX(p[0]! + dx), y = shadowY(p[1]! + dy); if (i) draft.lineTo(x, y); else draft.moveTo(x, y); });
                    draft.closePath();
                    draft.fill();
                    for (let i = 0; i < edge.length - 1; i++) {
                        const a = edge[i]!, b = edge[i + 1]!;
                        draft.beginPath();
                        draft.moveTo(shadowX(a[0]!), shadowY(a[1]!));
                        draft.lineTo(shadowX(b[0]!), shadowY(b[1]!));
                        draft.lineTo(shadowX(b[0]! + dx), shadowY(b[1]! + dy));
                        draft.lineTo(shadowX(a[0]! + dx), shadowY(a[1]! + dy));
                        draft.closePath();
                        draft.fill();
                    }
                }
            }
            out.filter = 'blur(1.6px)';
            out.drawImage(this.shadowDraft, 0, 0);
            out.filter = 'none';
        }
        const source = this.map.getSource('shadow') as maplibregl.CanvasSource | undefined;
        if (source) { source.play(); this.map.triggerRepaint(); requestAnimationFrame(() => requestAnimationFrame(() => source.pause())); }
        const strength = sun.alt <= 1.5 ? 0 : Math.min(.2, .05 + sun.alt / 60);
        const opacity = this.building && this.hasFloors(this.building) ? 0 : this.night > .55 ? strength * .9 : strength;
        this.map.setPaintProperty('shadow', 'raster-opacity', ['interpolate', ['linear'], ['zoom'], 16, opacity, 18.5, opacity * .55]);
        this.map.setLight({ anchor: 'map', position: [1.25, sun.az, Math.max(16, Math.min(34, 90 - Math.max(sun.alt, 10)))], color: sun.alt < 14 && sun.alt > 0 ? '#FFE3C4' : '#FFFFFF', intensity: this.night > .55 || sun.alt <= 0 ? .26 : .2 });
    }

    /* ---- floors ---- */
    private floorIds(building: string) { return Object.keys(this.model.floors).filter(id => id.startsWith(`${building}/`)); }
    hasFloors(building: string) { return this.floorIds(building).length > 0; }
    floorsOf(building: string) { return this.floorIds(building).map(id => this.model.floors[id]!.level).sort((a, b) => a - b); }
    roomsOf(building: string, level: number) { return this.model.floors[`${building}/${level}`]?.rooms ?? []; }
    centreOf(id: string) {
        const geometry = this.byId.get(id)?.geometry;
        if (!geometry) return null;
        const box = bounds(geometry);
        return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] as Position;
    }
    private animate(ms: number, frame: (t: number) => void) {
        cancelAnimationFrame(this.animation);
        const started = performance.now();
        const step = (time: number) => {
            const t = Math.max(0, Math.min(1, (time - started) / ms));
            frame(1 - Math.pow(1 - t, 3));
            if (t < 1) this.animation = requestAnimationFrame(step);
        };
        this.animation = requestAnimationFrame(step);
    }
    /** Puts the baked model in, under the labels; forms stay as the tap target and the plain stand-ins go. */
    showModels(index: ModelIndex, bytes: ArrayBuffer) {
        const add = () => {
            this.modelled = Object.keys(index.buildings);
            this.setFormsFilter(this.building);
            const layers = this.map.getStyle().layers.map(layer => layer.id);
            this.map.addLayer(modelLayer(index, bytes, () => this.modelLook), layers[layers.indexOf('plain') + 1]);
        };
        if (this.ready) add(); else this.queued.push(add);
    }
    private setFormsFilter(open: string | null) {
        const other = ['!=', ['get', 'building'], open ?? ''];
        this.map.setFilter('forms', open ? other as never : null);
        this.map.setFilter('plain', ['all', other, ['!', ['in', ['get', 'building'], ['literal', this.modelled]]]] as never);
    }
    private setFlatten(value: number) {
        this.flatten = value;
        this.modelLook = { ...this.modelLook, flatten: value };
        for (const layer of ['forms', 'plain']) {
            this.map.setPaintProperty(layer, 'fill-extrusion-height', ['*', ['get', 'top'], value] as never);
            this.map.setPaintProperty(layer, 'fill-extrusion-base', ['*', ['get', 'base'], value] as never);
        }
        this.map.setPaintProperty('context', 'fill-extrusion-height', ['*', ['coalesce', ['to-number', ['get', 'height_m']], ['*', ['to-number', ['get', 'levels'], 0], 3.4]], value] as never);
    }
    private paintLevel(lift: number, lid: number) {
        const building = this.byId.get(this.building!)!;
        const floorHeight = building.height / building.levels;
        const base = this.level;
        const wall = Math.max(1.3, floorHeight * .42);
        const set = (layer: string, property: string, value: number) => this.map.setPaintProperty(layer, property as never, value as never);
        set('sel-lower', 'fill-extrusion-height', Math.max(.01, base));
        set('sel-slab', 'fill-extrusion-base', base);
        set('sel-slab', 'fill-extrusion-height', base + .18);
        set('sel-rooms', 'fill-extrusion-base', base + .18);
        set('sel-rooms', 'fill-extrusion-height', base + .18 + wall);
        set('sel-core', 'fill-extrusion-base', base + .18);
        set('sel-core', 'fill-extrusion-height', base + .18 + wall * .5);
        this.roomTop = base + .18 + wall;
        if (lid > 0) {
            set('sel-upper', 'fill-extrusion-base', base + floorHeight + lift);
            set('sel-upper', 'fill-extrusion-height', Math.max(base + floorHeight + lift + .01, building.height + lift));
            set('sel-upper', 'fill-extrusion-opacity', lid);
        }
        this.map.setLayoutProperty('sel-upper', 'visibility', lid > .01 ? 'visible' : 'none');
    }
    private showSelection(on: boolean) {
        for (const layer of ['sel-lower', 'sel-slab', 'sel-rooms', 'sel-core']) this.map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
        if (!on) this.map.setLayoutProperty('sel-upper', 'visibility', 'none');
    }
    /** Opens a building at a floor: the part above lifts away and the campus sinks. */
    enter(building: string, level: number, rooms: RoomPaint[], padding: maplibregl.PaddingOptions, pitch: number, focus: Geometry[], instant: boolean) {
        const shape = this.byId.get(building);
        if (!shape) return;
        const same = this.building === building;
        const previousFloor = this.floor;
        this.building = building;
        this.floor = level;
        const floorHeight = shape.height / shape.levels;
        const target = (level - 1) * floorHeight;
        this.setFormsFilter(building);
        this.paintBuildings();
        const data = this.model.floors[`${building}/${level}`];
        (this.map.getSource('selshell') as GeoJSONSource).setData({ type: 'Feature', geometry: shape.geometry, properties: {} });
        (this.map.getSource('sel') as GeoJSONSource).setData({ type: 'Feature', geometry: data?.plate ?? shape.geometry, properties: {} });
        (this.map.getSource('selcore') as GeoJSONSource).setData({ type: 'FeatureCollection', features: (data?.cores ?? []).map(core => ({ type: 'Feature', geometry: core.geometry, properties: {} })) });
        this.paintRooms(rooms);
        this.showSelection(true);
        if (instant) { this.level = target; this.paintLevel(0, 0); this.setFlatten(FLAT); }
        else if (same) { const from = this.level; this.animate(380, t => { this.level = from + (target - from) * t; this.paintLevel(0, 0); }); }
        else { this.level = target; this.paintLevel(0, 1); const start = this.flatten; this.animate(780, t => { this.paintLevel(t * 22, 1 - t); this.setFlatten(start + (FLAT - start) * t); }); }
        if (!same || previousFloor !== level || focus.length) this.fly(shape.geometry, padding, pitch, focus, instant);
    }
    /** Colours and labels of the open floor. */
    paintRooms(rooms: RoomPaint[]) {
        if (!this.building || this.floor === null) return;
        const palette = tokens.scene.room[this.night > .55 ? 'night' : 'day'];
        const data = this.model.floors[`${this.building}/${this.floor}`];
        const paint = new Map(rooms.map(room => [room.id, room]));
        const features = (data?.rooms ?? []).map(room => ({ type: 'Feature' as const, geometry: shrink(room.geometry, .97), properties: { id: room.id, c: palette[paint.get(room.id)?.tier ?? 'other'] } }));
        (this.map.getSource('selrooms') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
        this.roomLabels.forEach(label => label.el.remove());
        this.roomLabels = (data?.rooms ?? []).flatMap(room => {
            const item = paint.get(room.id);
            if (!item) return [];
            const el = document.createElement('div');
            el.className = `lb room ${item.tier === 'picked' ? 'picked' : item.named ? 'named' : item.tier}`;
            el.textContent = item.label;
            this.labelHost.appendChild(el);
            const box = bounds(room.geometry);
            return [{ el, at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], box, picked: item.tier === 'picked', min: item.named ? 48 : 20 }];
        });
        for (const core of data?.cores ?? []) {
            const el = document.createElement('div');
            el.className = 'lb core';
            el.textContent = ({ stairs: '楼梯', wc: '卫生间', lift: '电梯' } as Record<string, string>)[core.kind] ?? '';
            this.labelHost.appendChild(el);
            const box = bounds(core.geometry);
            this.roomLabels.push({ el, at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], box, picked: false, min: 22 });
        }
        this.placeLabels();
    }
    private fly(geometry: Geometry, padding: maplibregl.PaddingOptions, pitch: number, focus: Geometry[], instant: boolean) {
        const boxes = (focus.length ? focus : [geometry]).map(bounds);
        const area: [[number, number], [number, number]] = [[Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1]))], [Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))]];
        const bearing = principalBearing(geometry);
        const shown = pitch > 0 ? Math.min(pitch, 44) : 0;
        const camera = this.map.cameraForBounds(area, { padding, bearing, pitch: shown, maxZoom: 19.1 });
        const options = { center: camera?.center ?? this.map.getCenter(), zoom: Math.max(camera?.zoom ?? 18, innerWidth >= 1000 ? 18.3 : 18.1), bearing, pitch: shown };
        if (instant) this.map.jumpTo(options); else this.map.flyTo({ ...options, duration: 1050, essential: true, curve: 1.3 });
    }
    exit() {
        if (!this.building) return;
        this.building = null;
        this.floor = null;
        this.showSelection(false);
        this.setFormsFilter(null);
        this.paintBuildings();
        this.roomLabels.forEach(label => label.el.remove());
        this.roomLabels = [];
        const start = this.flatten;
        this.animate(520, t => this.setFlatten(start + (1 - start) * t));
    }
    focusPoint(at: Position, padding: maplibregl.PaddingOptions, instant: boolean) {
        const options = { center: at as [number, number], zoom: Math.max(this.map.getZoom(), 17.4), padding };
        if (instant) this.map.jumpTo(options); else this.map.flyTo({ ...options, duration: 900, essential: true });
    }
    showRoutes(routes: Position[][], chosen: number, padding: maplibregl.PaddingOptions, pitch: number) {
        (this.map.getSource('route') as GeoJSONSource).setData({ type: 'FeatureCollection', features: routes.map((coordinates, index) => ({ type: 'Feature' as const, properties: { chosen: index === chosen, index }, geometry: { type: 'LineString' as const, coordinates } })).sort((a, b) => Number(a.properties.chosen) - Number(b.properties.chosen)) });
        const line = routes[chosen];
        if (!line?.length) return;
        const box: [[number, number], [number, number]] = [[Math.min(...line.map(p => p[0]!)), Math.min(...line.map(p => p[1]!))], [Math.max(...line.map(p => p[0]!)), Math.max(...line.map(p => p[1]!))]];
        const camera = this.map.cameraForBounds(box, { padding, pitch: pitch > 0 ? 45 : 0, bearing: this.map.getBearing() });
        if (camera) this.map.flyTo({ center: camera.center, zoom: Math.min(camera.zoom ?? 17, 18), pitch: pitch > 0 ? 45 : 0, duration: 1000, essential: true });
    }
    /** Turn the camera directly under a pointer; bearing is unbounded, pitch stays within what the scene can show. */
    steer(turn: number, lean: number) {
        this.map.jumpTo({ bearing: this.map.getBearing() + turn, pitch: Math.max(0, Math.min(this.building ? 44 : 72, this.map.getPitch() + lean)) });
    }
    /** Back to north, seen from straight above; from there, back to the raised view. Returns the pitch it heads for. */
    square() {
        const upright = this.map.getPitch() < 4 && Math.abs(this.map.getBearing()) < 1;
        const pitch = upright ? (this.building ? 44 : 52) : 0;
        this.map.easeTo({ bearing: 0, pitch, duration: 800, essential: true });
        return pitch;
    }
    setMe(at: Position | null) { this.meAt = at; this.placeLabels(); }

    /* ---- labels drawn over the model, projected at their real height ---- */
    setLabels(labels: SceneLabel[]) {
        this.labels.forEach(label => label.el.remove());
        this.labels = labels.map(label => {
            const el = document.createElement('div');
            el.className = `lb ${label.className}`;
            el.dataset.id = label.id;
            el.dataset.kind = label.className.includes('place') ? 'place' : 'building';
            el.innerHTML = '';
            el.append(label.text);
            if (label.count !== undefined) { const count = document.createElement('span'); count.className = 'n'; el.append(count); }
            this.labelHost.appendChild(el);
            return { ...label, el, w: 0, h: 0 };
        });
        this.placeLabels();
    }
    setCounts(counts: Map<string, number>) {
        for (const label of this.labels) {
            const span = label.el.querySelector<HTMLElement>('.n');
            if (!span) continue;
            const count = counts.get(label.id) ?? 0;
            span.textContent = String(count);
            label.el.classList.toggle('none', !count);
        }
    }
    private placeLabels() {
        if (!this.ready) return;
        const map = this.map;
        const zoom = map.getZoom();
        const pitch = map.getPitch() * Math.PI / 180;
        const { clientWidth: width, clientHeight: height } = this.host;
        const perMetre = 512 * Math.pow(2, zoom) / (40075016.686 * Math.cos(32.11 * Math.PI / 180));
        const distance = .5 * height / Math.tan(map.getVerticalFieldOfView() * Math.PI / 360);
        const centre = map.project(map.getCenter());
        const project = (at: Position, metres: number) => {
            const point = map.project(at as [number, number]);
            const rise = metres * perMetre;
            const scale = distance / Math.max(1, distance - rise * Math.cos(pitch));
            return { x: centre.x + (point.x - centre.x) * scale, y: centre.y + (point.y - centre.y) * scale - rise * Math.sin(pitch) * scale };
        };
        const taken: number[][] = [];
        const open = this.building && this.hasFloors(this.building);
        for (const label of [...this.labels].sort((a, b) => a.priority - b.priority)) {
            if (zoom < label.minZoom || (open && (label.id === this.building || label.className.includes('place')))) { label.el.style.display = 'none'; continue; }
            const point = project(label.at, open ? label.height * this.flatten : label.height);
            if (point.x < -40 || point.x > width + 40 || point.y < 0 || point.y > height) { label.el.style.display = 'none'; continue; }
            if (!label.w) { label.el.style.display = 'block'; label.w = label.el.offsetWidth; label.h = label.el.offsetHeight; }
            const box = [point.x - label.w / 2 - 4, point.y - label.h / 2 - 6, point.x + label.w / 2 + 4, point.y + label.h / 2 + 2];
            if (taken.some(other => box[0]! < other[2]! && other[0]! < box[2]! && box[1]! < other[3]! && other[1]! < box[3]!)) { label.el.style.display = 'none'; continue; }
            taken.push(box);
            label.el.style.display = 'block';
            label.el.style.transform = `translate(${(point.x - label.w / 2).toFixed(1)}px,${(point.y - 2 - label.h / 2).toFixed(1)}px)`;
        }
        for (const label of this.roomLabels) {
            const a = map.project([label.box[0], label.box[1]]);
            const b = map.project([label.box[2], label.box[3]]);
            if (!label.picked && (Math.hypot(a.x - b.x, a.y - b.y) * .62 < label.min || zoom < 17.4)) { label.el.style.display = 'none'; continue; }
            const point = project(label.at, this.roomTop);
            label.el.style.display = 'block';
            label.el.style.transform = `translate(${point.x.toFixed(1)}px,${point.y.toFixed(1)}px) translate(-50%,-50%)`;
        }
        if (this.meAt) {
            const point = map.project(this.meAt as [number, number]);
            this.me.style.display = 'block';
            this.me.style.transform = `translate(${point.x.toFixed(1)}px,${point.y.toFixed(1)}px)`;
        }
    }
    private onClick(point: maplibregl.Point) {
        const box: [[number, number], [number, number]] = [[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]];
        const open = this.building && this.hasFloors(this.building);
        if (open) {
            const room = this.map.queryRenderedFeatures(box, { layers: ['sel-rooms'] })[0];
            if (room) { this.handlers.onRoom(String(room.properties.id)); return; }
        }
        const building = this.map.queryRenderedFeatures(box, { layers: ['forms'] }).find(feature => feature.properties.building);
        if (building) { this.handlers.onBuilding(String(building.properties.building)); return; }
        if (open && this.map.queryRenderedFeatures(box, { layers: ['sel-lower', 'sel-slab'] }).length) return;
        this.handlers.onEmpty();
    }
}
