// The campus drawn over the basemap: njupt-data's buildings, paths and places.
//
// Buildings are the subject, so they get the clearest shapes: a soft fill, a crisp
// outline, and from zoom 16.5 a gentle extrusion by storeys. A selected building
// (feature-state `selected`) takes the brand blue. Footpaths are drawn here because
// the basemap's roads stop at the campus gate; stairs are dashed. Places outside
// buildings are dots coloured by what they are, named from zoom 17.
const palette = {
    light: {
        building: '#d8dde5', buildingTop: '#e6e9ef', outline: '#b9c1cc', selected: '#d2e3fc', selectedLine: '#1a73e8',
        path: '#ffffff', pathCasing: '#d5d9df', steps: '#9aa3ae',
        label: '#3c4043', labelHalo: '#ffffff', minorLabel: '#5f6368',
        food: '#e8710a', shop: '#9334e6', service: '#1a73e8', sport: '#188038', transit: '#5f6368', other: '#80868b',
    },
    dark: {
        building: '#2a323d', buildingTop: '#323b47', outline: '#46505e', selected: '#243850', selectedLine: '#8ab4f8',
        path: '#3a434f', pathCasing: '#1b2027', steps: '#6f7985',
        label: '#e8edf3', labelHalo: '#14181d', minorLabel: '#aeb8c5',
        food: '#fcad70', shop: '#d7aefb', service: '#8ab4f8', sport: '#81c995', transit: '#aeb8c5', other: '#9aa0a6',
    },
};

const FOOT = ['footway', 'path', 'pedestrian', 'steps', 'track', 'corridor'];
const isBuilding = ['==', ['get', 'kind'], 'building'];
const named = ['!=', ['get', 'id'], null];
const height = ['*', ['coalesce', ['get', 'levels'], 4], 3.4];
const category = (c) => ['match', ['get', 'group'],
    'food', c.food, 'shop', c.shop, 'service', c.service, 'sport', c.sport, 'transit', c.transit, c.other];

export function campusLayers(theme) {
    const c = palette[theme];
    return [
        {
            id: 'campus-building', type: 'fill', source: 'places', maxzoom: 16.5,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'kind'], ['literal', ['building', 'structure']]]],
            paint: {
                'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], c.selected, c.building],
                'fill-outline-color': c.outline,
            },
        },
        {
            id: 'campus-building-3d', type: 'fill-extrusion', source: 'places', minzoom: 16.5,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'kind'], ['literal', ['building', 'structure']]]],
            paint: {
                'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'selected'], false], c.selected, c.buildingTop],
                'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 16.5, 0, 17.2, height],
                'fill-extrusion-opacity': 0.92,
                'fill-extrusion-vertical-gradient': true,
            },
        },
        {
            id: 'campus-building-outline', type: 'line', source: 'places', minzoom: 15,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], isBuilding, named],
            paint: {
                'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], c.selectedLine, c.outline],
                'line-width': ['interpolate', ['linear'], ['zoom'],
                    15, ['case', ['boolean', ['feature-state', 'selected'], false], 2, 0.5],
                    18, ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 1.2]],
            },
        },
        {
            id: 'campus-path-casing', type: 'line', source: 'ways', minzoom: 15,
            filter: ['all', ['in', ['get', 'class'], ['literal', FOOT]], ['!=', ['get', 'class'], 'steps']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': c.pathCasing, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 15, 1.6, 18, 6, 20, 14] },
        },
        {
            id: 'campus-path', type: 'line', source: 'ways', minzoom: 15,
            filter: ['all', ['in', ['get', 'class'], ['literal', FOOT]], ['!=', ['get', 'class'], 'steps']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': c.path, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 15, 0.8, 18, 4, 20, 11] },
        },
        {
            id: 'campus-steps', type: 'line', source: 'ways', minzoom: 16,
            filter: ['==', ['get', 'class'], 'steps'],
            paint: { 'line-color': c.steps, 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.5, 19, 4], 'line-dasharray': [0.6, 0.4] },
        },
        {
            id: 'campus-place', type: 'circle', source: 'places', minzoom: 16,
            filter: ['all', ['==', ['geometry-type'], 'Point'], ['any', ['!', ['get', 'minor']], ['>=', ['zoom'], 18]]],
            paint: {
                'circle-color': category(c), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 2.5, 19, 5.5],
                'circle-stroke-color': c.labelHalo, 'circle-stroke-width': 1.2,
            },
        },
    ];
}

export function campusLabels(theme) {
    const c = palette[theme];
    return [
        {
            id: 'campus-place-label', type: 'symbol', source: 'places', minzoom: 17,
            filter: ['all', ['==', ['geometry-type'], 'Point'], ['any', ['!', ['get', 'minor']], ['>=', ['zoom'], 18.5]]],
            layout: {
                'text-field': ['get', 'id'], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
                'text-anchor': 'left', 'text-offset': [0.7, 0], 'text-max-width': 8, 'text-optional': true,
            },
            paint: { 'text-color': category(c), 'text-halo-color': c.labelHalo, 'text-halo-width': 1.4 },
        },
        {
            id: 'campus-building-label', type: 'symbol', source: 'places', minzoom: 15,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], isBuilding, named],
            layout: {
                'text-field': ['coalesce', ['get', 'label'], ['get', 'id']], 'text-font': ['Noto Sans Medium'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 14],
                'text-max-width': 7, 'text-padding': 3, 'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'rank'], 0]],
            },
            paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6 },
        },
    ];
}
