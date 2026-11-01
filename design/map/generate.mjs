// Generate the authored campus style and the small font asset set shared by web and Android.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { style } from './campus-style.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const targets = [join(root, 'public', 'map'), join(root, 'android', 'app', 'src', 'main', 'assets', 'map')];
for (const target of targets) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'style-light.json'), JSON.stringify(style('light')));
    await writeFile(join(target, 'style-dark.json'), JSON.stringify(style('dark')));
}
console.log('campus styles written to', targets.join(' and '));
