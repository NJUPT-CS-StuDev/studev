// Package layout (facts keep njupt-data's paths and object shapes):
//   teaching/<term>/{term,periods,classes,meetings}.json   unchanged files
//   teaching/<term>/classes/<id>.json                   {class, meetings}
//   exams/<term>/changes.json                          unchanged (history summary)
//   exams/<term>/index.json                            {classes, sources}
//   exams/<term>/classes/<class>.json                   {exams, changes}
//   rooms/index.json                                   {term, weeks, periods, rooms, buildings, campuses}
//   rooms/<term>/<date>.json                           unchanged files (free + occupied)
//   search/                                           wasm-search content bundle
//   space/<campus>/                                    unchanged space data and search/styles
//   src/data/campus-release.json                       selected terms and version
//
// Input: DATA_DIR, or the release named by DATA_REPOSITORY / DATA_TOKEN.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileBundle } from 'wasm-search/compile';
import type { SearchDocument } from 'wasm-search';
import { campusConfig } from '../campus.config.ts';
import { packageFacts } from './package-facts.ts';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const write = async (path: string, value: unknown) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(value));
};

// ---- facts of the data release -------------------------------------------------
interface Index { built_at: string; content: string[]; teaching: string[]; exams: string[]; rooms?: string[]; space?: string[] }
interface Source { id: string; name: string; url: string; kind: string }
interface Doc { id: string; url: string; title: string; text: string; published: string | null; updated: string | null; section: string | null; kind: 'page' | 'file' | 'link'; tags: string[]; files: { name: string; url: string; ext: string | null }[] }

// The data repository is private: its latest release is read through the API with a
// token that may read it (DATA_TOKEN in CI, the gh login locally).
function dataToken(): string | undefined {
    if (process.env.DATA_TOKEN?.trim()) return process.env.DATA_TOKEN.trim();
    const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    return gh.status === 0 ? gh.stdout.trim() : undefined;
}

async function locateData(): Promise<{ dir: string; version: string }> {
    const local = process.env.DATA_DIR;
    if (local) {
        const index = await read<Index>(join(local, 'index.json'));
        return { dir: local, version: `local-${index.built_at.replace(/\D/g, '').slice(0, 12)}-facts` };
    }
    const token = dataToken();
    const repository = process.env.DATA_REPOSITORY?.trim();
    if (!repository || !token) throw new Error('set DATA_REPOSITORY and DATA_TOKEN (or log in with gh) to read the data release');
    const api = (path: string, accept = 'application/vnd.github+json') =>
        fetch(`https://api.github.com/repos/${repository}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
    const latestResponse = await api('/releases/latest');
    if (!latestResponse.ok) throw new Error(`reading the latest data release: HTTP ${latestResponse.status}`);
    const latest = await latestResponse.json() as { tag_name: string; assets: { id: number; name: string }[] };
    // The release carries the facts archive and an evidence archive; the facts are wanted.
    const asset = latest.assets.find(a => a.name.endsWith('.tar.gz') && !a.name.startsWith('evidence'));
    if (!asset) throw new Error('the latest data release has no facts archive');
    const version = `${latest.tag_name}-facts`;
    const dir = join(root, '.data', version);
    if (!existsSync(join(dir, 'index.json'))) {
        await mkdir(dir, { recursive: true });
        const archive = join(root, '.data', `${version}.tar.gz`);
        const download = await api(`/releases/assets/${asset.id}`, 'application/octet-stream');
        if (!download.ok) throw new Error(`downloading ${version}: HTTP ${download.status}`);
        await writeFile(archive, Buffer.from(await download.arrayBuffer()));
        const result = spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
        if (result.status !== 0) throw new Error('could not extract the data archive');
        await rm(archive);
    }
    return { dir, version };
}

// ---- search -----------------------------------------------------------------
function category(doc: Doc): string {
    const search = campusConfig.search;
    if (doc.kind === 'file') return search.fileCategory;
    if (doc.kind === 'link') return search.linkCategory;
    const text = [doc.title, doc.section ?? '', ...doc.tags].join(' ').toLowerCase();
    return search.categories.find(rule => rule.words.some(word => text.includes(word)))?.id ?? search.defaultCategory;
}

async function* searchDocuments(dir: string): AsyncGenerator<SearchDocument> {
    for (const source of await read<Source[]>(join(dir, 'content', 'sources.json'))) {
        for (const line of (await readFile(join(dir, 'content', `${source.id}.jsonl`), 'utf8')).split('\n')) {
            if (!line) continue;
            const doc = JSON.parse(line) as Doc;
            yield { ...doc, source: source.id, source_name: source.name, category: category(doc) };
        }
    }
}

// ---- main -------------------------------------------------------------------
async function main() {
    // A build without access to the data release (EdgeOne's builder rebuilds after the CI
    // build) keeps the data this checkout already digested.
    const releaseFile = join(root, 'src', 'data', 'campus-release.json');
    if (!process.env.DATA_DIR && !(process.env.DATA_REPOSITORY && dataToken()) && existsSync(releaseFile)) {
        const { version: digested } = await read<{ version: string }>(releaseFile);
        if (existsSync(join(root, 'public', 'data', digested, 'rooms', 'index.json'))) {
            console.log(`no access to the data release; keeping the digested ${digested}`);
            return;
        }
    }
    const { dir, version } = await locateData();
    const index = await read<Index>(join(dir, 'index.json'));
    if (!index.space?.length) throw new Error(`${version} has no campus space; publish a complete data release before deploying`);
    for (const campus of index.space) {
        for (const file of ['places.json', 'places.geojson', 'ways.geojson', 'network.json', 'basemap.pmtiles']) {
            if (!existsSync(join(dir, 'space', campus, file))) throw new Error(`${version} is missing space/${campus}/${file}`);
        }
    }
    const outRoot = join(root, 'public', 'data');
    const out = join(outRoot, version);
    if (existsSync(outRoot)) {
        for (const entry of await readdir(outRoot)) await rm(join(outRoot, entry), { recursive: true, force: true });
    }
    console.log(`digesting ${version} from ${dir}`);

    const docs: SearchDocument[] = [];
    for await (const doc of searchDocuments(dir)) docs.push(doc);
    console.log('search', await compileBundle(docs, campusConfig.search.profile, join(out, 'search')));

    const terms = await packageFacts(dir, out, index);

    // Campus space: the data as released, and the map styles bound to it. A style keeps two
    // tokens each client fills with its own base URLs: {data} (this campus's directory in
    // the data package) and {assets} (fonts and sprites, public/map/).
    for (const campus of index.space ?? []) {
        const from = join(dir, 'space', campus);
        const to = join(out, 'space', campus);
        await mkdir(to, { recursive: true });
        for (const file of ['places.json', 'places.geojson', 'ways.geojson', 'network.json', 'basemap.pmtiles']) {
            if (existsSync(join(from, file))) await copyFile(join(from, file), join(to, file));
        }
        // Places and rooms as their own small search bundle, so finding a place works offline
        // in the app and gives the same answer on the web.
        const places = await read<{ id: string; kind: string; names: string[]; houses?: string[]; parent?: string; floor?: string | null }[]>(join(from, 'places.json'));
        const placeDocs: SearchDocument[] = places.map(p => ({
            id: p.id, source: p.kind === 'room' ? 'rooms' : 'places', source_name: p.kind === 'room' ? '教室' : '地点',
            url: `/map/?place=${encodeURIComponent(p.id)}`, title: p.id,
            text: [...p.names, ...(p.houses ?? []), p.kind === 'room' ? `${p.parent ?? ''} ${p.floor ?? ''}楼` : ''].join(' '),
            published: null, updated: null, section: p.parent ?? null, kind: 'page', category: p.kind, tags: [], files: [],
        }));
        console.log('space search', await compileBundle(placeDocs, { aliases: [] }, join(to, 'search')));

        const shapes = await read<{ features: { properties: { kind: string }; geometry: unknown }[] }>(join(from, 'places.geojson'));
        const area = shapes.features.find(f => f.properties.kind === 'campus')?.geometry;
        for (const theme of ['light', 'dark']) {
            const template = await readFile(join(root, 'public', 'map', `style-${theme}.json`), 'utf8');
            const style = JSON.parse(template
                .replaceAll('{basemap}', '{data}/basemap.pmtiles')
                .replaceAll('{places}', '{data}/places.geojson')
                .replaceAll('{ways}', '{data}/ways.geojson')) as { layers: { id: string; source?: string; filter?: unknown }[] };
            // The campus speaks for itself: the basemap's own points of interest stop at its boundary.
            if (area) {
                for (const layer of style.layers) {
                    if (layer.source === 'basemap' && layer.id === 'pois') {
                        layer.filter = ['all', layer.filter ?? true, ['!', ['within', area]]];
                    }
                }
            }
            await write(join(to, `style-${theme}.json`), style);
        }
        console.log('space', campus);
    }

    await write(join(root, 'src', 'data', 'campus-release.json'), { version, base: `/data/${version}`, built_at: index.built_at, ...terms });
}

await main();
