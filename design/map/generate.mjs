// Generate the authored campus style and the small font/sprite asset set shared by web and Android.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
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

async function ensureAsset(url, relative, legacyRelative) {
    const first = join(targets[0], relative);
    const second = join(targets[1], relative);
    if (!existsSync(first)) {
        const legacy = [
            join(targets[0], legacyRelative ?? relative),
            join(targets[1], relative),
            join(targets[1], legacyRelative ?? relative),
        ].find(candidate => existsSync(candidate));
        await mkdir(join(first, '..'), { recursive: true });
        if (legacy) {
            await copyFile(legacy, first);
        } else {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            await writeFile(first, Buffer.from(await response.arrayBuffer()));
        }
    }
    if (!existsSync(second)) {
        await mkdir(join(second, '..'), { recursive: true });
        await copyFile(first, second);
    }
}

for (const target of targets) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'style-light.json'), JSON.stringify(style('light')));
    await writeFile(join(target, 'style-dark.json'), JSON.stringify(style('dark')));
}

for (const [remoteFont, localFont] of FONTS) {
    for (const range of RANGES) {
        await ensureAsset(
            `${ASSETS}/fonts/${encodeURIComponent(remoteFont)}/${range}.pbf`,
            join('fonts', localFont, `${range}.pbf`),
            join('fonts', remoteFont, `${range}.pbf`),
        );
    }
    for (const target of targets) {
        await rm(join(target, 'fonts', remoteFont), { recursive: true, force: true });
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
