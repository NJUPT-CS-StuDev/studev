// Generate studev's map styles and their offline assets for both clients.
//
//   node design/map/generate.mjs
//
// Writes, for the web (public/map/) and the app (android/app/src/main/assets/map/):
//   style-light.json, style-dark.json   one MapLibre style per theme
//   fonts/<stack>/<range>.pbf           the glyph ranges labels need; CJK is drawn by the
//                                       system font (localIdeographFontFamily), so only
//                                       Latin, digits and punctuation ship here
//   sprites/light|dark(@2x).json|png    Protomaps point-of-interest icons
//
// A style names its sources with tokens each client resolves at load time:
//   {basemap}  the PMTiles archive of the area around campus (njupt-data out/space/<campus>/basemap.pmtiles)
//   {places}   out/space/<campus>/places.geojson,  {ways} out/space/<campus>/ways.geojson
//   {assets}   where fonts/ and sprites/ are served from
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { layers } from '@protomaps/basemaps';
import { campusLayers, campusLabels } from './campus.mjs';
import { dark, light } from './flavors.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const targets = [join(root, 'public', 'map'), join(root, 'android', 'app', 'src', 'main', 'assets', 'map')];
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// Basic Latin and Latin-1, General Punctuation, CJK Symbols and Punctuation, Halfwidth and Fullwidth Forms
const RANGES = ['0-255', '256-511', '8192-8447', '12288-12543', '65280-65535'];

// Inside a campus the more particular landuse wins: woods, lawns and pitches are drawn
// over the campus tint, not under it as in the Protomaps default order.
function base(flavor) {
    const all = layers('basemap', flavor);
    const school = all.findIndex(layer => layer.id === 'landuse_school');
    const [campus] = all.splice(school, 1);
    all.splice(all.findIndex(layer => layer.id === 'landuse_park'), 0, campus);
    return all;
}

function style(name, flavor) {
    return {
        version: 8,
        name: `studev ${name}`,
        glyphs: '{assets}/fonts/{fontstack}/{range}.pbf',
        sprite: `{assets}/sprites/${name}`,
        // soft light from above the viewer, so extruded walls stay light like paper models
        light: { anchor: 'viewport', color: '#ffffff', intensity: name === 'light' ? 0.18 : 0.3, position: [1.4, 210, 35] },
        sources: {
            basemap: { type: 'vector', url: 'pmtiles://{basemap}', attribution: '© OpenStreetMap contributors · Protomaps' },
            places: { type: 'geojson', data: '{places}', promoteId: 'id' },
            ways: { type: 'geojson', data: '{ways}' },
        },
        layers: [
            ...base(flavor),
            ...campusLayers(name),
            ...layers('basemap', flavor, { lang: 'zh-Hans', labelsOnly: true }),
            ...campusLabels(name),
        ],
    };
}

async function fetchTo(url, path) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

const styles = { 'style-light.json': style('light', light), 'style-dark.json': style('dark', dark) };
const downloads = [
    ...FONTS.flatMap(font => RANGES.map(range => [`${ASSETS}/fonts/${encodeURIComponent(font)}/${range}.pbf`, join('fonts', font, `${range}.pbf`)])),
    ...['light', 'dark'].flatMap(theme => ['.json', '.png', '@2x.json', '@2x.png']
        .map(ext => [`${ASSETS}/sprites/v4/${theme}${ext}`, join('sprites', `${theme}${ext}`)])),
];
for (const target of targets) {
    await mkdir(target, { recursive: true });
    for (const [file, value] of Object.entries(styles)) await writeFile(join(target, file), JSON.stringify(value));
}
for (const [url, relative] of downloads) {
    await fetchTo(url, join(targets[0], relative));
    await fetchTo(url, join(targets[1], relative));
}
console.log(`map styles and ${downloads.length} assets written to`, targets.join(' and '));
