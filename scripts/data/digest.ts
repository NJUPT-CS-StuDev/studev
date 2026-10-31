// Build one immutable campus package from exactly one public map release and
// one private data release. The map owns all space facts; njupt-data owns every
// non-spatial fact and may only refer to ids present in the selected map.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileBundle } from 'wasm-search/compile';
import type { SearchDocument } from 'wasm-search';
import { campusConfig } from '../../campus.config.ts';
import { packageFacts } from './package-facts.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)); };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const safeRelative = (name: string) => { if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`unsafe map path: ${name}`); return name; };

interface DataIndex { built_at: string; content: string[]; teaching: string[]; exams: string[]; rooms?: string[]; map?: { resolved_map_version?: string; map_version?: string } }
interface MapManifest { map_version: string; crs?: string; artifacts: Record<string, { bytes: number; sha256: string }>; layers: Record<string, { bytes: number; sha256: string }> }
interface Source { id: string; name: string; url: string; kind: string }
interface Doc { id: string; url: string; title: string; text: string; published: string | null; updated: string | null; section: string | null; kind: 'page' | 'file' | 'link'; tags: string[]; files: { name: string; url: string; ext: string | null }[] }
interface MapPlace { id: string; kind: string; name?: string; aliases?: string[]; parent?: string; geometry?: { type: string; coordinates: unknown } }

function dataToken(): string | undefined { if (process.env.DATA_TOKEN?.trim()) return process.env.DATA_TOKEN.trim(); const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }); return gh.status === 0 ? gh.stdout.trim() : undefined; }
async function extractArchive(archive: string, destination: string) { await mkdir(destination, { recursive: true }); const result = spawnSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'inherit' }); if (result.status !== 0) throw new Error(`could not extract ${archive}`); }

async function verifyMap(rootDir: string): Promise<{ dir: string; version: string; manifest: MapManifest }> {
    const base = existsSync(join(rootDir, 'manifest.json')) ? rootDir : join(rootDir, 'release');
    const manifest = await read<MapManifest>(join(base, 'manifest.json'));
    if (!manifest.map_version?.match(/^map-v\d+\.\d+\.\d+$/)) throw new Error('map manifest has no immutable map_version');
    if (manifest.crs !== 'EPSG:4326') throw new Error('map manifest must use EPSG:4326');
    const artifactRoot = base; const layersRoot = existsSync(join(base, 'map', 'layers')) ? join(base, 'map', 'layers') : join(base, '..', 'map', 'layers');
    const campuses = await readdir(join(base, 'space'));
    const artifactPath = (name: string) => {
        const direct = join(artifactRoot, name);
        if (existsSync(direct)) return direct;
        for (const campus of campuses) {
            const candidate = join(artifactRoot, 'space', campus, name);
            if (existsSync(candidate)) return candidate;
        }
        throw new Error(`map release is missing artifacts/${name}`);
    };
    const verifyEntries = async (section: string, entries: Record<string, { bytes: number; sha256: string }>, rootPath: string) => {
        if (!entries || !Object.keys(entries).length) throw new Error(`map manifest has no ${section}`);
        for (const [name, expected] of Object.entries(entries)) {
            const path = section === 'artifacts' ? artifactPath(safeRelative(name)) : join(rootPath, safeRelative(name));
            if (!existsSync(path)) throw new Error(`map release is missing ${section}/${name}`);
            const bytes = await readFile(path);
            if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`map manifest checksum mismatch: ${section}/${name}`);
        }
    };
    await verifyEntries('artifacts', manifest.artifacts, artifactRoot);
    await verifyEntries('layers', manifest.layers, layersRoot);
    const space = await read<{ items: MapPlace[] }>(join(artifactRoot, 'space', '仙林', 'entities', 'space.json')); const ids = new Set(space.items.map(row => row.id));
    if (!ids.size || ids.size !== space.items.length) throw new Error('map space ids are empty or duplicated');
    for (const row of space.items) { let current = row; const seen = new Set([row.id]); while (current.parent) { if (!ids.has(current.parent) || seen.has(current.parent)) throw new Error(`broken map parent chain: ${row.id}`); seen.add(current.parent); current = space.items.find(item => item.id === current.parent)!; } }
    return { dir: base, version: manifest.map_version, manifest };
}

async function locateMap(): Promise<{ dir: string; version: string; manifest: MapManifest }> {
    const local = process.env.MAP_DIR?.trim() || process.env.MAP_INPUT?.trim();
    if (local) { const path = local.replace(/^file:\/\//, ''); if (path.toLowerCase().endsWith('.tar.gz')) { const unpacked = join(root, '.data', 'map-input'); await rm(unpacked, { recursive: true, force: true }); await extractArchive(path, unpacked); return verifyMap(unpacked); } return verifyMap(path); }
    const repository = process.env.MAP_REPOSITORY?.trim() || 'hicancan/njupt-map'; const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } }); if (!response.ok) throw new Error(`reading latest map release: HTTP ${response.status}`); const latest = await response.json() as { tag_name: string; assets: { browser_download_url: string; name: string }[] }; const asset = latest.assets.find(item => item.name === `njupt-map-${latest.tag_name.replace(/^map-/, '')}.tar.gz`); if (!asset) throw new Error(`latest map release ${latest.tag_name} has no njupt-map archive`);
    const versionDir = join(root, '.data', latest.tag_name); const archive = join(root, '.data', `${latest.tag_name}.tar.gz`); await mkdir(join(root, '.data'), { recursive: true }); if (!existsSync(join(versionDir, 'manifest.json'))) { const download = await fetch(asset.browser_download_url); if (!download.ok) throw new Error(`downloading ${latest.tag_name}: HTTP ${download.status}`); await writeFile(archive, Buffer.from(await download.arrayBuffer())); await rm(versionDir, { recursive: true, force: true }); await extractArchive(archive, versionDir); await rm(archive, { force: true }); } return verifyMap(versionDir);
}

async function locateData(): Promise<{ dir: string; version: string; index: DataIndex }> {
    const local = process.env.DATA_DIR?.trim(); if (local) { const index = await read<DataIndex>(join(local, 'index.json')); return { dir: local, version: process.env.DATA_VERSION?.trim() || `local-${index.built_at.replace(/\D/g, '').slice(0, 12)}-facts`, index }; }
    const token = dataToken(); const repository = process.env.DATA_REPOSITORY?.trim(); if (!repository || !token) throw new Error('set DATA_REPOSITORY and DATA_TOKEN (or log in with gh) to read the data release'); const api = (path: string, accept = 'application/vnd.github+json') => fetch(`https://api.github.com/repos/${repository}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } }); const latestResponse = await api('/releases/latest'); if (!latestResponse.ok) throw new Error(`reading latest data release: HTTP ${latestResponse.status}`); const latest = await latestResponse.json() as { tag_name: string; assets: { id: number; name: string }[] }; const asset = latest.assets.find(item => item.name === 'njupt-data.tar.gz' || (item.name.endsWith('.tar.gz') && !item.name.startsWith('evidence'))); if (!asset) throw new Error('latest data release has no facts archive'); const version = latest.tag_name; const dir = join(root, '.data', version); if (!existsSync(join(dir, 'index.json'))) { await mkdir(dir, { recursive: true }); const download = await api(`/releases/assets/${asset.id}`, 'application/octet-stream'); if (!download.ok) throw new Error(`downloading ${version}: HTTP ${download.status}`); const archive = join(root, '.data', `${version}.tar.gz`); await writeFile(archive, Buffer.from(await download.arrayBuffer())); await extractArchive(archive, dir); await rm(archive, { force: true }); } return { dir, version, index: await read<DataIndex>(join(dir, 'index.json')) };
}

function category(place: MapPlace): string | undefined { const text = `${place.name ?? ''} ${(place.aliases ?? []).join(' ')}`; for (const [name, value] of [['图书馆', '图书馆'], ['食堂', '食堂'], ['超市', '超市'], ['校医院', '校医院'], ['门诊', '校医院'], ['快递', '快递'], ['打印', '打印'], ['体育', '体育'], ['公交', '公交站']] as const) if (text.includes(name)) return value; return place.kind === 'room' ? '教室' : place.kind === 'building' ? '教学楼' : undefined; }
function centre(geometry: MapPlace['geometry']): [number, number] | undefined { if (!geometry) return undefined; const points: number[][] = []; const visit = (value: unknown): void => { if (!Array.isArray(value)) return; if (typeof value[0] === 'number') points.push(value as number[]); else for (const child of value) visit(child); }; visit(geometry.coordinates); if (!points.length) return undefined; return [points.reduce((sum, point) => sum + (point[0] ?? 0), 0) / points.length, points.reduce((sum, point) => sum + (point[1] ?? 0), 0) / points.length]; }
function normalizePlace(raw: MapPlace, roomFacts: Map<string, any>) { const prefix = raw.id.includes('/') ? raw.id.slice(0, raw.id.lastIndexOf('/')) : ''; const fact = roomFacts.get(raw.id); const parent = raw.parent || prefix; const names = [...new Set([raw.name ?? raw.id, ...(raw.aliases ?? []), ...(fact?.names ?? [])].filter((value): value is string => Boolean(value)))]; const roomName = raw.kind === 'room' ? raw.name ?? raw.id.slice(raw.id.lastIndexOf('-') + 1) : undefined; const floor = raw.kind === 'room' && parent ? parent.slice(parent.lastIndexOf('/') + 1) : null; return { id: raw.id, kind: raw.kind, parent, names: roomName ? [...new Set([roomName, ...names])] : names, centre: centre(raw.geometry), floor: floor || null, seats: fact?.seats ?? null, room_kinds: fact?.kinds ?? [], sources: ['map'], use: category(raw) ?? raw.kind, routing: { type: 'target', id: raw.id }, category: category(raw), featured: raw.kind === 'building' && Boolean(category(raw)) }; }

async function* searchDocuments(dir: string): AsyncGenerator<SearchDocument> { for (const source of await read<Source[]>(join(dir, 'content', 'sources.json'))) for (const line of (await readFile(join(dir, 'content', `${source.id}.jsonl`), 'utf8')).split('\n')) { if (!line) continue; const doc = JSON.parse(line) as Doc; const search = campusConfig.search; const text = [doc.title, doc.section ?? '', ...doc.tags].join(' ').toLowerCase(); yield { ...doc, source: source.id, source_name: source.name, category: doc.kind === 'file' ? search.fileCategory : doc.kind === 'link' ? search.linkCategory : search.categories.find(rule => rule.words.some(word => text.includes(word)))?.id ?? search.defaultCategory }; } }

async function main() {
    const map = await locateMap(); const data = await locateData(); if (data.index.map?.resolved_map_version && data.index.map.resolved_map_version !== map.version) throw new Error(`data release pins ${data.index.map.resolved_map_version}, selected map is ${map.version}`);
    const mapSpaceRoot = join(map.dir, 'space'); const campuses = await readdir(mapSpaceRoot); if (!campuses.length) throw new Error('map release contains no campus space'); const mapIds = new Set<string>(); const mapPlacesByCampus = new Map<string, MapPlace[]>(); for (const campus of campuses) { const places = await read<MapPlace[]>(join(mapSpaceRoot, campus, 'places.json')); mapPlacesByCampus.set(campus, places); for (const place of places) mapIds.add(place.id); }
    const hours = await read<Record<string, any>>(join(data.dir, 'hours.json')); for (const id of Object.keys(hours)) if (!mapIds.has(id)) throw new Error(`opening-hours id is outside map release: ${id}`); const scan = (value: unknown): string[] => { if (typeof value === 'string') return mapIds.has(value) ? [value] : []; if (Array.isArray(value)) return value.flatMap(scan); if (value && typeof value === 'object') return Object.values(value).flatMap(scan); return []; }; const references = scan(data.index); for (const folder of ['teaching', 'exams', 'rooms', 'places', 'entities']) if (existsSync(join(data.dir, folder))) for (const file of await readdir(join(data.dir, folder), { recursive: true })) if (String(file).endsWith('.json')) references.push(...scan(JSON.parse(await readFile(join(data.dir, folder, String(file)), 'utf8')))); for (const id of references) if (!mapIds.has(id)) throw new Error(`data references unknown map space id: ${id}`);
    const dataVersion = data.version; const version = `${map.version}__${dataVersion}`; const outRoot = join(root, 'public', 'data'); const out = join(outRoot, version); await mkdir(outRoot, { recursive: true }); for (const entry of await readdir(outRoot)) await rm(join(outRoot, entry), { recursive: true, force: true }); const docs: SearchDocument[] = []; for await (const doc of searchDocuments(data.dir)) docs.push(doc); await compileBundle(docs, campusConfig.search.profile, join(out, 'search')); const terms = await packageFacts(data.dir, out, data.index, mapPlacesByCampus.get('仙林') ?? []); await copyFile(join(data.dir, 'hours.json'), join(out, 'hours.json'));
    for (const campus of campuses) { const from = join(mapSpaceRoot, campus); const to = join(out, 'space', campus); await mkdir(to, { recursive: true }); const places = mapPlacesByCampus.get(campus)!; const roomFacts = new Map((await read<any[]>(join(data.dir, 'places', 'rooms.json'))).map(row => [row.id, row])); const normalized = places.map(place => normalizePlace(place, roomFacts)); await write(join(to, 'places.json'), normalized); for (const file of ['network.json', 'basemap.pmtiles', 'basemap.geojson', 'basemap-preview.png', 'checks.json']) if (existsSync(join(from, file))) await copyFile(join(from, file), join(to, file)); await copyFile(join(map.dir, 'map', 'layers', 'ways.geojson'), join(to, 'ways.geojson')); await write(join(to, 'places.geojson'), { type: 'FeatureCollection', features: places.filter(place => place.geometry).map(place => ({ type: 'Feature', id: place.id, properties: { id: place.id, kind: place.kind, name: place.name ?? '', aliases: place.aliases ?? [] }, geometry: place.geometry })) }); await mkdir(join(to, 'entities'), { recursive: true }); await copyFile(join(from, 'entities', 'space.json'), join(to, 'entities', 'space.json')); const dataEntities = join(data.dir, 'entities'); for (const file of ['index.json', 'agent.json', 'information.json', 'time.json']) if (existsSync(join(dataEntities, file))) await copyFile(join(dataEntities, file), join(to, 'entities', file)); for (const theme of ['light', 'dark']) { const template = await readFile(join(root, 'public', 'map', `style-${theme}.json`), 'utf8'); await write(join(to, `style-${theme}.json`), JSON.parse(template.replaceAll('{basemap}', '{data}/basemap.pmtiles').replaceAll('{places}', '{data}/places.geojson').replaceAll('{ways}', '{data}/ways.geojson'))); } const placeDocs: SearchDocument[] = normalized.map(place => ({ id: place.id, source: place.kind === 'room' ? 'rooms' : 'places', source_name: place.kind === 'room' ? '教室' : '地点', url: `/map/?place=${encodeURIComponent(place.id)}`, title: place.id, text: place.names.join(' '), published: null, updated: null, section: place.parent || null, kind: 'page', category: place.category ?? place.kind, tags: [], files: [] })); await compileBundle(placeDocs, { aliases: [] }, join(to, 'search')); }
    await write(join(root, 'src', 'data', 'campus-release.json'), { map_version: map.version, data_version: dataVersion, version, base: `/data/${version}`, built_at: data.index.built_at, ...terms }); console.log(`digested ${map.version} + ${dataVersion} (${version})`);
}
await main();
