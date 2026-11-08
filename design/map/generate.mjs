// Generate the authored campus style and the small font/sprite asset set shared by web and Android.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { style } from './campus-style.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const targets = [join(root, 'public', 'map'), join(root, 'android', 'app', 'src', 'main', 'assets', 'map')];
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
const FONTS = [
    ['Noto Sans Regular', 'Noto-Sans-Regular'],
    ['Noto Sans Medium', 'Noto-Sans-Medium'],
    ['Noto Sans Italic', 'Noto-Sans-Italic'],
];
const RANGES = ['0-255', '256-511', '8192-8447', '12288-12543', '65280-65535'];

/** Fetches an asset once into the web copy, then mirrors it into Android's. */
async function ensureAsset(url, relative) {
    const [web, android] = targets.map(target => join(target, relative));
    if (!existsSync(web)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        await mkdir(join(web, '..'), { recursive: true });
        await writeFile(web, Buffer.from(await response.arrayBuffer()));
    }
    if (!existsSync(android)) {
        await mkdir(join(android, '..'), { recursive: true });
        await copyFile(web, android);
    }
}

for (const target of targets) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'style.json'), JSON.stringify(style()));
}

for (const [remoteFont, localFont] of FONTS) {
    for (const range of RANGES) {
        await ensureAsset(
            `${ASSETS}/fonts/${encodeURIComponent(remoteFont)}/${range}.pbf`,
            join('fonts', localFont, `${range}.pbf`),
        );
    }
}

for (const theme of ['light', 'dark']) {
    for (const ext of ['.json', '.png', '@2x.json', '@2x.png']) {
        await ensureAsset(
            `${ASSETS}/sprites/v4/${theme}${ext}`,
            join('sprites', `${theme}${ext}`),
        );
    }
}

console.log('campus styles and assets written to', targets.join(' and '));
