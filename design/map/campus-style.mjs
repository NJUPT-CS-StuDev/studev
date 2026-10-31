import tokens from '../../design/tokens.json' with { type: 'json' };

const themeColors = (theme) => {
    const c = tokens.color[theme];
    return {
        ...c,
        green: theme === 'light' ? '#cfe6c4' : '#1d3425',
        water: theme === 'light' ? '#a9d8e6' : '#173b4b',
        sport: theme === 'light' ? '#e4c79f' : '#4a3825',
        surface: theme === 'light' ? '#ece8df' : '#252b31',
        building: theme === 'light' ? '#d8dde5' : '#2a323d',
        buildingTop: theme === 'light' ? '#e6e9ef' : '#323b47',
        context: theme === 'light' ? '#d7d5d0' : '#252a30',
        path: theme === 'light' ? '#ffffff' : '#3a434f',
        pathCasing: theme === 'light' ? '#c7cdd5' : '#161b21',
        outline: theme === 'light' ? '#aeb7c2' : '#46505e',
        label: theme === 'light' ? '#3c4043' : '#e8edf3',
        halo: theme === 'light' ? '#ffffff' : '#14181d',
    };
};

const polygon = (id, sourceLayer, color, minzoom = 12) => ({
    id, type: 'fill', source: 'basemap', 'source-layer': sourceLayer, minzoom,
    paint: { 'fill-color': color, 'fill-opacity': 0.95 },
});

export function style(theme) {
    const c = themeColors(theme);
    return {
        version: 8,
        name: `studev campus ${theme}`,
        glyphs: '{assets}/fonts/{fontstack}/{range}.pbf',
        light: { anchor: 'viewport', color: '#ffffff', intensity: theme === 'light' ? 0.2 : 0.35, position: [1.4, 210, 35] },
        sources: {
            basemap: {
                type: 'vector',
                url: 'pmtiles://{data}/basemap.pmtiles',
                attribution: '© njupt-map · © OpenStreetMap contributors',
            },
        },
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': c.paper } },
            polygon('context-buildings', 'context_buildings', c.context, 12),
            polygon('campus', 'campus', c.surface, 12),
            polygon('surfaces', 'surfaces', c.surface, 12),
            polygon('greens', 'greens', c.green, 12),
            polygon('waters', 'waters', c.water, 12),
            polygon('sports', 'sports', c.sport, 14),
            { id: 'building-fill', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: 14,
                paint: { 'fill-color': c.building, 'fill-outline-color': c.outline } },
            { id: 'building-extrusion', type: 'fill-extrusion', source: 'basemap', 'source-layer': 'buildings', minzoom: 16.5,
                paint: { 'fill-extrusion-color': c.buildingTop, 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 16.5, 0, 17.2, ['coalesce', ['get', 'height_m'], ['*', ['coalesce', ['get', 'levels'], 4], 3.4]]], 'fill-extrusion-opacity': 0.92 } },
            { id: 'building-outline', type: 'line', source: 'basemap', 'source-layer': 'buildings', minzoom: 15,
                paint: { 'line-color': c.outline, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 18, 1.2] } },
            { id: 'context-label', type: 'symbol', source: 'basemap', 'source-layer': 'context_buildings', minzoom: 15,
                layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 10, 'text-max-width': 8, 'text-optional': true },
                paint: { 'text-color': c.muted, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
            { id: 'path-casing', type: 'line', source: 'basemap', 'source-layer': 'ways', minzoom: 14,
                filter: ['in', ['get', 'kind'], ['literal', ['footway', 'path', 'pedestrian', 'track', 'secondary', 'tertiary', 'residential', 'service']]],
                layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.pathCasing, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 1.5, 18, 7, 20, 14] } },
            { id: 'path', type: 'line', source: 'basemap', 'source-layer': 'ways', minzoom: 14,
                filter: ['in', ['get', 'kind'], ['literal', ['footway', 'path', 'pedestrian', 'track', 'secondary', 'tertiary', 'residential', 'service']]],
                layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.path, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 0.7, 18, 4.5, 20, 10] } },
            { id: 'steps', type: 'line', source: 'basemap', 'source-layer': 'ways', minzoom: 15,
                filter: ['==', ['get', 'steps'], true], layout: { 'line-cap': 'round' }, paint: { 'line-color': c.warning, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 4], 'line-dasharray': [0.6, 0.4] } },
            { id: 'place-fill', type: 'fill', source: 'basemap', 'source-layer': 'places', minzoom: 14, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c.brandContainer, 'fill-opacity': 0.65, 'fill-outline-color': c.brand } },
            { id: 'place-point', type: 'circle', source: 'basemap', 'source-layer': 'places', minzoom: 15, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': c.brand, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 19, 5.5], 'circle-stroke-color': c.halo, 'circle-stroke-width': 1.2 } },
            { id: 'building-label', type: 'symbol', source: 'basemap', 'source-layer': 'buildings', minzoom: 15,
                layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 14], 'text-max-width': 7, 'text-padding': 3, 'text-allow-overlap': false },
                paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } },
            { id: 'place-label', type: 'symbol', source: 'basemap', 'source-layer': 'places', minzoom: 16,
                layout: { 'text-field': ['coalesce', ['get', 'label'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9, 19, 13], 'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 8, 'text-padding': 3, 'text-optional': true },
                paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.3 } },
            { id: 'water-label', type: 'symbol', source: 'basemap', 'source-layer': 'waters', minzoom: 15, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-optional': true }, paint: { 'text-color': c.service, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
            { id: 'sports-label', type: 'symbol', source: 'basemap', 'source-layer': 'sports', minzoom: 16, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-optional': true }, paint: { 'text-color': c.success, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
        ],
    };
}

