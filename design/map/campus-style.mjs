// The campus scene: flat ground, roads and extruded buildings. Everything that changes
// with the moment (building tint, light, night palette) is set by the clients over this.
import tokens from '../tokens.json' with { type: 'json' };

const ROADS = ['secondary', 'tertiary', 'residential', 'service', 'living_street', 'unclassified'];
const PATHS = ['path', 'footway', 'pedestrian', 'curated_path', 'track', 'crossing', 'steps'];
export const buildingHeight = ['coalesce', ['to-number', ['get', 'height_m']], ['*', ['to-number', ['get', 'levels'], 4], 3.4]];
const fill = (id, layer, color) => ({ id, type: 'fill', source: 'basemap', 'source-layer': layer, paint: { 'fill-color': color } });

export function style(theme) {
    const c = tokens.scene[theme === 'dark' ? 'night' : 'day'];
    const route = tokens.color[theme];
    return {
        version: 8,
        name: `studev campus ${theme}`,
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
            {
                id: 'bld', type: 'fill-extrusion', source: 'basemap', 'source-layer': 'buildings',
                paint: { 'fill-extrusion-color': c.model, 'fill-extrusion-height': buildingHeight, 'fill-extrusion-opacity': 1 },
            },
        ],
        // Route colours travel with the style so both clients draw the same line.
        metadata: { route: { line: route.route, casing: route.routeCasing, alternative: route.routeAlternative } },
    };
}
