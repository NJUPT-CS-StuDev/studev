// The campus scene: flat ground, roads and extruded buildings. Everything that changes
// with the moment (building tint, light, night palette) is painted by the clients over this.
import tokens from '../tokens.json' with { type: 'json' };

const ROADS = ['secondary', 'tertiary', 'residential', 'service', 'living_street', 'unclassified'];
const PATHS = ['path', 'footway', 'pedestrian', 'curated_path', 'track', 'crossing', 'steps'];
const fill = (id, layer, color) => ({ id, type: 'fill', source: 'basemap', 'source-layer': layer, paint: { 'fill-color': color } });

// Forms stand where no model does, and are what a tap lands on everywhere. Android cannot query a fully
// transparent layer, so over a model they are drawn at a hundredth of full strength, which no eye sees.
const form = (id, opacity) => ({
    id, type: 'fill-extrusion', source: 'basemap', 'source-layer': 'building_forms', minzoom: 12,
    paint: { 'fill-extrusion-color': ['to-color', ['get', 'color']], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-vertical-gradient': true, 'fill-extrusion-opacity': opacity },
});
const label = (id, layer, minzoom, c, layout = {}, filter) => ({
    id, type: 'symbol', source: 'basemap', 'source-layer': layer, minzoom,
    filter: filter ? ['all', ['has', 'label'], filter] : ['has', 'label'],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto-Sans-Regular'], 'text-size': 11, 'text-max-width': 8, 'text-padding': 4, 'text-optional': true, ...layout },
    paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.3 },
});

const routeColours = theme => ({ line: tokens.color[theme].route, casing: tokens.color[theme].routeCasing, alternative: tokens.color[theme].routeAlternative });

export function style() {
    const c = tokens.scene.day;
    return {
        version: 8,
        name: 'studev campus',
        glyphs: '{assets}/fonts/{fontstack}/{range}.pbf',
        sources: {
            basemap: { type: 'vector', url: 'pmtiles://{data}/basemap.pmtiles', attribution: '© njupt-map · © OpenStreetMap contributors' },
        },
        layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': c.ground } },
            fill('campus', 'campus', c.campus),
            fill('surfaces', 'surfaces', c.surface),
            fill('greens', 'greens', c.green),
            fill('sports', 'sports', c.sport),
            fill('waters', 'waters', c.water),
            {
                id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'ways',
                filter: ['in', ['get', 'kind'], ['literal', ROADS]],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': c.road, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 14, ['match', ['get', 'kind'], 'secondary', 2.2, 'tertiary', 1.6, 1], 18, ['match', ['get', 'kind'], 'secondary', 18, 'tertiary', 13, 8]] },
            },
            {
                id: 'paths', type: 'line', source: 'basemap', 'source-layer': 'ways', minzoom: 14.6,
                filter: ['in', ['get', 'kind'], ['literal', PATHS]],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': c.path, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 15, 0.7, 18, 3.6] },
            },
            {
                id: 'context', type: 'fill-extrusion', source: 'basemap', 'source-layer': 'context_buildings',
                paint: { 'fill-extrusion-color': c.context, 'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height_m']], ['*', ['to-number', ['get', 'levels'], 3], 3.4]], 'fill-extrusion-opacity': 0.82 },
            },
            form('forms', .01),
            form('plain', 1),
            label('way-label', 'ways', 14, c, { 'symbol-placement': 'line', 'symbol-spacing': 280, 'text-max-angle': 30, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 12.5] }, ['in', ['get', 'kind'], ['literal', ROADS]]),
            label('water-label', 'waters', 13.5, c),
            label('green-label', 'greens', 14, c),
            label('surface-label', 'surfaces', 15, c),
            label('sport-label', 'sports', 15.5, c),
            label('context-label', 'context_buildings', 15.5, c),
            label('nearby-label', 'nearby', 16.8, c, { 'text-size': 10 }),
        ],
        // Clients repaint these layers for the moment's light, route colours included.
        metadata: { route: { day: routeColours('light'), night: routeColours('dark') } },
    };
}
