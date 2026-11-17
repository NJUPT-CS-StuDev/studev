// Resolve immutable inputs before restoring their independent build caches.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import product from '../../product.json' with { type: 'json' };
import { validRelease } from '../../src/campus/world/release.ts';

const token = process.env.DATA_TOKEN || spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout?.trim();
async function latest(repo: string) {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) throw new Error(`reading ${repo} release failed (${response.status})`);
    return (await response.json() as { tag_name: string }).tag_name;
}
const [map, knowledge, data] = await Promise.all([
    latest(process.env.MAP_REPOSITORY || 'hicancan/njupt-map'), latest(process.env.KNOWLEDGE_REPOSITORY || 'hicancan/njupt-knowledge'),
    latest(process.env.DATA_REPOSITORY || (() => { throw new Error('DATA_REPOSITORY is required'); })()),
]);
const values: Record<string, string> = { map, knowledge: knowledge.replace(/^knowledge-/, ''), data: data.replace(/^data-/, ''), previous_map: 'none', previous_search: 'none' };
const response = await fetch(`${product.campusOrigin}/campus-release.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15_000) });
if (response.ok) {
    const previous: unknown = await response.json();
    if (!validRelease(previous)) throw new Error('the current campus pointer is unreadable');
    values.previous_map = previous.map_base.split('/').at(-1)!;
    values.previous_search = previous.search_base.split('/').at(-1)!;
    await mkdir('src/data', { recursive: true }); await writeFile('src/data/campus-release.json', JSON.stringify(previous));
} else if (response.status !== 404) throw new Error(`reading current campus pointer failed (${response.status})`);
for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`unexpected ${name} release name`);
    console.log(`${name}=${value}`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
