// Build one campus package from one map release and one data release.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileBundle } from 'wasm-search/compile';
import { initialize as initializeDocuments, read as readDocument, type Block, type Inline } from 'docstream';
import type { SearchDocument } from 'wasm-search';
import { campusConfig } from '../../campus.config.ts';
import { packageFacts } from './package-facts.ts';
import { SPACE_FILES } from './space-contract.ts';
import type { Exam, Room, TeachingClass, TeachingMeeting } from '../../src/campus/world/facts.ts';
import { style } from '../../design/map/campus-style.mjs';
import { displayName } from '../../src/campus/map/model/displayName.ts';
import { textKey } from '../../src/campus/world/texts.ts';
import { knowledgeCatalog } from '../../src/campus/knowledge/catalog.ts';
import type { CurriculumCourse } from '../../src/campus/world/knowledge.ts';
import { validRelease, type CampusRelease } from '../../src/campus/world/release.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

const read = async <T>(path: string): Promise<T> => {
    return JSON.parse(await readFile(path, 'utf8')) as T;
};

const write = async (path: string, value: unknown) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(value));
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function equalTrees(left: string, right: string): Promise<boolean> {
    if (!existsSync(right)) return false;
    const a = await readdir(left, { withFileTypes: true }), b = await readdir(right, { withFileTypes: true });
    if (a.length !== b.length || a.some(item => !b.some(other => item.name === other.name && item.isDirectory() === other.isDirectory()))) return false;
    for (const item of a) {
        if (item.isDirectory()) { if (!await equalTrees(join(left, item.name), join(right, item.name))) return false; }
        else if (!(await readFile(join(left, item.name))).equals(await readFile(join(right, item.name)))) return false;
    }
    return true;
}

const safeRelative = (name: string) => {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
        throw new Error(`unsafe map path: ${name}`);
    }
    return name;
};

interface DataIndex {
    version?: string;
    built_at: string;
    content: string[];
    teaching: string[];
    exams: string[];
    labs: string[];
    rooms?: string[];
    map?: { resolved_map_version?: string; map_version?: string };
}

interface MapManifest {
    map_version: string;
    crs?: string;
    artifacts: Record<string, { bytes: number; sha256: string }>;
    layers: Record<string, { bytes: number; sha256: string }>;
}

interface MapPlace {
    id: string;
    kind: string;
    name?: string;
    aliases?: string[];
    parent?: string;
    geometry?: { type: string; coordinates: unknown };
    level?: number;
    title?: string;
    category?: string;
    group?: string;
    tier?: number;
    levels?: number;
    houses?: string[];
    routing: { type: 'target'; id: string };
}

interface Source {
    id: string;
    name: string;
    url: string;
    kind: string;
}

interface Doc {
    id: string;
    url: string;
    title: string;
    text: string;
    published: string | null;
    updated: string | null;
    section: string | null;
    kind: 'page' | 'file' | 'link';
    tags: string[];
    files: { name: string; url: string; ext: string | null }[];
}

function dataToken(): string | undefined {
    if (process.env.DATA_TOKEN?.trim()) {
        return process.env.DATA_TOKEN.trim();
    }
    const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : undefined;
}

async function extractArchive(archive: string, destination: string) {
    await mkdir(destination, { recursive: true });
    const result = spawnSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`could not extract ${archive}`);
    }
}

async function verifyMap(rootDir: string): Promise<{ dir: string; layers: string; version: string; manifest: MapManifest }> {
    const base = existsSync(join(rootDir, 'manifest.json')) ? rootDir : join(rootDir, 'release');
    const manifest = await read<MapManifest>(join(base, 'manifest.json'));
    if (!manifest.map_version?.match(/^map-v\d+\.\d+\.\d+$/)) {
        throw new Error('map manifest has no immutable map_version');
    }
    if (manifest.crs !== 'EPSG:4326') {
        throw new Error('map manifest must use EPSG:4326');
    }
    const campuses = await readdir(join(base, 'space'));
    const artifactPath = (name: string) => {
        const relative = safeRelative(name);
        const direct = join(base, relative);
        if (existsSync(direct)) {
            return direct;
        }
        for (const campus of campuses) {
            const candidate = join(base, 'space', campus, relative);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        throw new Error(`map release is missing artifacts/${name}`);
    };
    const verifyEntries = async (
        section: string,
        entries: Record<string, { bytes: number; sha256: string }>,
        rootPath: string,
    ) => {
        if (!entries || !Object.keys(entries).length) {
            throw new Error(`map manifest has no ${section}`);
        }
        for (const [name, expected] of Object.entries(entries)) {
            const path = section === 'artifacts'
                ? artifactPath(name)
                : join(rootPath, safeRelative(name));
            if (!existsSync(path)) {
                throw new Error(`map release is missing ${section}/${name}`);
            }
            const bytes = await readFile(path);
            if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
                throw new Error(`map manifest checksum mismatch: ${section}/${name}`);
            }
        }
    };
    const layerCandidates = [
        join(base, 'map', 'layers'),
        join(base, '..', 'map', 'layers'),
        join(base, '..', '..', 'map', 'layers'),
        join(rootDir, 'map', 'layers'),
    ];
    const layersRoot = layerCandidates.find(path => existsSync(path)) ?? layerCandidates[0]!;
    await verifyEntries('artifacts', manifest.artifacts, base);
    await verifyEntries('layers', manifest.layers, layersRoot);
    const entities = await read<MapPlace[]>(join(base, 'space', '仙林', 'entities.json'));
    const ids = new Set(entities.map(row => row.id));
    if (!ids.size || ids.size !== entities.length) {
        throw new Error('map space ids are empty or duplicated');
    }
    for (const row of entities) {
        let current = row;
        const seen = new Set([row.id]);
        while (current.parent) {
            if (!ids.has(current.parent) || seen.has(current.parent)) {
                throw new Error(`broken map parent chain: ${row.id}`);
            }
            seen.add(current.parent);
            current = entities.find(item => item.id === current.parent)!;
        }
    }
    return { dir: base, layers: layersRoot, version: manifest.map_version, manifest };
}

export async function locateMap() {
    const local = process.env.MAP_DIR?.trim() || process.env.MAP_INPUT?.trim();
    if (local) {
        const path = local.replace(/^file:\/\//, '');
        if (path.toLowerCase().endsWith('.tar.gz')) {
            const unpacked = join(root, '.data', 'map-input');
            await rm(unpacked, { recursive: true, force: true });
            await extractArchive(path, unpacked);
            return verifyMap(unpacked);
        }
        return verifyMap(path);
    }
    const repository = process.env.MAP_REPOSITORY?.trim() || 'hicancan/njupt-map';
    const requested = process.env.MAP_VERSION?.trim();
    if (requested && !/^[A-Za-z0-9._-]+$/.test(requested)) throw new Error('invalid MAP_VERSION');
    const response = await fetch(`https://api.github.com/repos/${repository}${requested ? `/releases/tags/${requested}` : '/releases/latest'}`, {
        // Anonymous calls share one limit across a hosted runner's address.
        headers: { Accept: 'application/vnd.github+json', ...(process.env.DATA_TOKEN?.trim() ? { Authorization: `Bearer ${process.env.DATA_TOKEN.trim()}` } : {}) },
    });
    if (!response.ok) {
        throw new Error(`reading map release: HTTP ${response.status}`);
    }
    const latest = await response.json() as { tag_name: string; assets: { browser_download_url: string; name: string }[] };
    const asset = latest.assets.find(item => item.name === `njupt-map-${latest.tag_name.replace(/^map-/, '')}.tar.gz`);
    if (!asset) {
        throw new Error(`latest map release ${latest.tag_name} has no njupt-map archive`);
    }
    const versionDir = join(root, '.data', latest.tag_name);
    const archive = join(root, '.data', `${latest.tag_name}.tar.gz`);
    await mkdir(join(root, '.data'), { recursive: true });
    if (!existsSync(join(versionDir, 'manifest.json'))) {
        const download = await fetch(asset.browser_download_url);
        if (!download.ok) {
            throw new Error(`downloading ${latest.tag_name}: HTTP ${download.status}`);
        }
        await writeFile(archive, Buffer.from(await download.arrayBuffer()));
        await rm(versionDir, { recursive: true, force: true });
        await extractArchive(archive, versionDir);
        await rm(archive, { force: true });
    }
    return verifyMap(versionDir);
}

/** The knowledge: KNOWLEDGE_DIR (a built njupt-knowledge, for development) or the latest knowledge release. */
export async function locateKnowledge(): Promise<{ dir: string; version: string }> {
    const local = process.env.KNOWLEDGE_DIR?.trim();
    if (local) return { dir: local, version: 'local' };
    const repository = process.env.KNOWLEDGE_REPOSITORY?.trim() || 'hicancan/njupt-knowledge';
    const requested = process.env.KNOWLEDGE_VERSION?.trim();
    if (requested && !/^[A-Za-z0-9._-]+$/.test(requested)) throw new Error('invalid KNOWLEDGE_VERSION');
    const response = await fetch(`https://api.github.com/repos/${repository}${requested ? `/releases/tags/knowledge-${requested}` : '/releases/latest'}`, {
        headers: { Accept: 'application/vnd.github+json', ...(process.env.DATA_TOKEN?.trim() ? { Authorization: `Bearer ${process.env.DATA_TOKEN.trim()}` } : {}) },
    });
    if (!response.ok) throw new Error(`reading knowledge release: HTTP ${response.status}`);
    const latest = await response.json() as { tag_name: string; assets: { browser_download_url: string; name: string }[] };
    const asset = latest.assets.find(item => item.name === `njupt-knowledge-${latest.tag_name}.tar.gz`);
    if (!asset) throw new Error(`latest knowledge release ${latest.tag_name} has no archive`);
    const version = latest.tag_name.replace(/^knowledge-/, '');
    const dir = join(root, '.data', latest.tag_name);
    if (!existsSync(join(dir, 'knowledge.json'))) {
        await mkdir(join(root, '.data'), { recursive: true });
        const download = await fetch(asset.browser_download_url);
        if (!download.ok) throw new Error(`downloading ${latest.tag_name}: HTTP ${download.status}`);
        const archive = join(root, '.data', `${latest.tag_name}.tar.gz`);
        await writeFile(archive, Buffer.from(await download.arrayBuffer()));
        await rm(dir, { recursive: true, force: true });
        await extractArchive(archive, dir);
        await rm(archive, { force: true });
    }
    return { dir, version };
}

interface KnowledgeIndex {
    courses: { id: string; name: string; codes: string[]; former: string[]; chapters: { title: string; topics: string[] }[]; path: string }[];
    topics: { id: string; title: string; requires: string[]; path: string; taught_by: string[]; references: { material: string; heading: string; anchor: string }[]; leads_to: string[] }[];
    materials: { path: string; title: string; kind: string; course: string; term: string | null; source: string; sections: number }[];
    media: string[];
}

/** Topics and questions as documents, so a search finds a piece of knowledge and opens it where it is. */
async function knowledgeDocuments(dir: string, index: KnowledgeIndex): Promise<{ docs: SearchDocument[]; readable: Map<string, Readable> }> {
    await initializeDocuments(new Uint8Array(await readFile(new URL(import.meta.resolve('docstream/docstream_wasm_bg.wasm')))));
    const inlines = (items: Inline[], markdown: boolean): string => items.map(item => {
        if (item.type === 'image') return '';
        if (item.type === 'math') return markdown ? `$${item.tex}$` : item.tex;
        if ('text' in item) return item.type === 'code' && markdown ? `\`${item.text}\`` : item.text;
        return 'children' in item ? inlines(item.children, markdown) : '\n';
    }).join('');
    const text = (blocks: Block[], markdown = true): string => blocks.map(block => {
        if ('inlines' in block) return (block.type === 'heading' && markdown ? '#'.repeat(block.level) + ' ' : '') + inlines(block.inlines, markdown);
        if (block.type === 'math') return markdown ? `$$\n${block.tex}\n$$` : block.tex;
        if (block.type === 'code') return markdown ? `\`\`\`${block.language}\n${block.text}\n\`\`\`` : block.text;
        if (block.type === 'table') return [block.head, ...block.rows].map(row => row.map(cell => inlines(cell, markdown)).join(' | ')).join('\n');
        if ('blocks' in block) return text(block.blocks, markdown);
        if (block.type === 'list') return block.items.map(item => text(item.blocks, markdown)).join('\n');
        return 'text' in block ? block.text : '';
    }).filter(Boolean).join('\n\n');
    const names = new Map(index.courses.map(course => [course.id, course.name]));
    const titles = new Map(index.topics.map(topic => [topic.id, topic.title]));
    const materialTitles = new Map(index.materials.map(material => [material.path, material.title]));
    const docs: SearchDocument[] = [];
    const readable = new Map<string, Readable>();
    for (const topic of index.topics) {
        const body = await readFile(join(dir, topic.path), 'utf8');
        const blocks = readDocument(body);
        const url = `/knowledge/?topic=${encodeURIComponent(topic.id)}`;
        const course = topic.taught_by.map(code => names.get(code) ?? code).join(' ');
        // The note's own # title is the result's title already; the snippet starts after it.
        docs.push(entity('topics', topic.id, url, topic.title, course, [text(blocks[0]?.type === 'heading' ? blocks.slice(1) : blocks, false).slice(0, 1200)]));
        const said = (ids: string[]) => ids.map(id => titles.get(id) ?? id).join('、') || '无';
        const references = topic.references.slice(0, 12).map(ref => `- ${ref.heading} · ${materialTitles.get(ref.material) ?? ref.material}（id ${textKey(`sections/${ref.material}#${ref.anchor}`)}；原文 /knowledge/?material=${encodeURIComponent(ref.material)}#${encodeURIComponent(ref.anchor)}）`);
        readable.set(`topics/${topic.id}`, { title: topic.title, path: topic.path, url, source: `知识点 · ${course}`,
            text: [text(blocks), `先要懂：${said(topic.requires)}`, `接着学：${said(topic.leads_to)}`, ...(references.length ? ['关联的资料片段（用 read 阅读）：', ...references] : [])].join('\n\n') });
    }
    for (const material of index.materials) {
        const body = await readFile(join(dir, material.path), 'utf8');
        const blocks = readDocument(body);
        readable.set(`sections/${material.path}`, { title: material.title, path: material.path, url: `/knowledge/?material=${encodeURIComponent(material.path)}`, source: `${material.kind} · ${names.get(material.course) ?? material.course}`, text: text(blocks) });
        blocks.forEach((block, at) => {
            if (block.type !== 'heading') return;
            const heading = inlines(block.inlines, false), id = `${material.path}#${block.anchor}`;
            const end = blocks.findIndex((next, i) => i > at && next.type === 'heading' && next.level <= block.level);
            const content = blocks.slice(at + 1, end < 0 ? undefined : end);
            const url = `/knowledge/?material=${encodeURIComponent(material.path)}#${encodeURIComponent(block.anchor)}`;
            if (block.level === 3) docs.push(entity('sections', id, url, `${heading} · ${material.title}`, material.kind, [text(content, false).slice(0, 600)]));
            readable.set(`sections/${id}`, { title: `${heading} · ${material.title}`, path: id, url, source: `${material.kind} · ${names.get(material.course) ?? material.course}`, text: text(content) });
        });
    }
    return { docs, readable };
}

async function locateData(): Promise<{ dir: string; version: string; index: DataIndex }> {
    const local = process.env.DATA_DIR?.trim();
    if (local) {
        const index = await read<DataIndex>(join(local, 'index.json'));
        const version = process.env.DATA_VERSION?.trim() || index.version?.trim() || `local-${index.built_at.replace(/\D/g, '').slice(0, 12)}-facts`;
        return { dir: local, version, index };
    }
    const token = dataToken();
    const repository = process.env.DATA_REPOSITORY?.trim();
    if (!repository || !token) {
        throw new Error('set DATA_REPOSITORY and DATA_TOKEN (or log in with gh) to read the data release');
    }
    const api = (path: string, accept = 'application/vnd.github+json') => fetch(`https://api.github.com/repos/${repository}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: accept },
    });
    const requested = process.env.DATA_VERSION?.trim();
    if (requested && !/^[A-Za-z0-9._-]+$/.test(requested)) throw new Error('invalid DATA_VERSION');
    const latestResponse = await api(requested ? `/releases/tags/data-${requested}` : '/releases/latest');
    if (!latestResponse.ok) {
        throw new Error(`reading latest data release: HTTP ${latestResponse.status}`);
    }
    const latest = await latestResponse.json() as { tag_name: string; assets: { id: number; name: string }[] };
    const asset = latest.assets.find(item => item.name.endsWith('.tar.gz') && !item.name.startsWith('evidence'));
    if (!asset) {
        throw new Error('latest data release has no facts archive');
    }
    // The published name says when the data was built, not where it came from.
    const version = latest.tag_name.replace(/^data-/, '');
    const dir = join(root, '.data', version);
    if (!existsSync(join(dir, 'index.json'))) {
        await mkdir(dir, { recursive: true });
        const download = await api(`/releases/assets/${asset.id}`, 'application/octet-stream');
        if (!download.ok) {
            throw new Error(`downloading ${version}: HTTP ${download.status}`);
        }
        const archive = join(root, '.data', `${version}.tar.gz`);
        await writeFile(archive, Buffer.from(await download.arrayBuffer()));
        await extractArchive(archive, dir);
        await rm(archive, { force: true });
    }
    return { dir, version, index: await read<DataIndex>(join(dir, 'index.json')) };
}

function centre(geometry: MapPlace['geometry']): [number, number] | undefined {
    if (!geometry) {
        return undefined;
    }
    const points: number[][] = [];
    const visit = (value: unknown): void => {
        if (!Array.isArray(value)) {
            return;
        }
        if (typeof value[0] === 'number') {
            points.push(value as number[]);
            return;
        }
        for (const child of value) {
            visit(child);
        }
    };
    visit(geometry.coordinates);
    if (!points.length) {
        return undefined;
    }
    return [
        points.reduce((sum, point) => sum + (point[0] ?? 0), 0) / points.length,
        points.reduce((sum, point) => sum + (point[1] ?? 0), 0) / points.length,
    ];
}

/** One map entity as the clients read it. What a place is (category, group, tier) is the map's; a room is a 教室. */
function normalizePlace(raw: MapPlace, ids: Set<string>, roomFacts: Map<string, any>, mapLevels: Map<string, number>) {
    if (!raw.routing || raw.routing.type !== 'target' || raw.routing.id !== raw.id) {
        throw new Error(`map entity has no canonical routing target: ${raw.id}`);
    }
    const prefix = raw.id.includes('/') ? raw.id.slice(0, raw.id.lastIndexOf('/')) : '';
    const fact = roomFacts.get(raw.id);
    const parent = raw.parent ?? (ids.has(prefix) ? prefix : undefined);
    const category = raw.category ?? (raw.kind === 'room' ? '教室' : undefined);
    const names = [...new Set([raw.name, ...(raw.aliases ?? []), ...(fact?.names ?? [])].filter(Boolean))];
    const roomName = raw.kind === 'room' ? raw.name ?? raw.id.slice(raw.id.lastIndexOf('-') + 1) : undefined;
    const floor = raw.kind === 'room' && parent ? parent.slice(parent.lastIndexOf('/') + 1) : null;
    return {
        id: raw.id,
        kind: raw.kind,
        ...(parent ? { parent } : {}),
        names: roomName ? [...new Set([roomName, ...names])] : names,
        centre: centre(raw.geometry),
        ...(((raw.levels ?? raw.level ?? mapLevels.get(raw.id)) != null) ? { levels: raw.levels ?? raw.level ?? mapLevels.get(raw.id) } : {}),
        ...(raw.houses?.length ? { houses: raw.houses } : {}),
        ...(raw.title ? { title: raw.title } : {}),
        ...(floor ? { floor } : {}),
        ...(fact?.seats != null ? { seats: fact.seats } : {}),
        ...(fact?.kinds?.length ? { room_kinds: fact.kinds } : {}),
        sources: ['map'],
        routing: raw.routing,
        ...(category ? { category } : {}),
        ...(raw.group ? { group: raw.group } : {}),
        ...(raw.tier ? { tier: raw.tier } : {}),
    };
}

async function* searchDocuments(dir: string): AsyncGenerator<SearchDocument> {
    const sources = await read<Source[]>(join(dir, 'content', 'sources.json'));
    for (const source of sources) {
        const lines = (await readFile(join(dir, 'content', `${source.id}.jsonl`), 'utf8')).split('\n');
        for (const line of lines) {
            if (!line) {
                continue;
            }
            const doc = JSON.parse(line) as Doc;
            const search = campusConfig.search;
            const text = [doc.title, doc.section ?? '', ...doc.tags].join(' ').toLowerCase();
            const categoryId = search.categories.find(rule => rule.words.some(word => text.includes(word)))?.id ?? search.defaultCategory;
            const section = doc.section && doc.section !== 'Direct detail links' ? doc.section : null;
            yield { ...doc, section, source: source.id, source_name: source.name, category: doc.kind === 'file' ? search.fileCategory : doc.kind === 'link' ? search.linkCategory : categoryId };
        }
    }
}

/** Each article's own text, for the AI to read once search has found it: texts/<first two hex digits of its id>.json. */
/** Where a document's text is kept: an article by its own id, anything else (a topic, a question) by the first 16
 * hex digits of the SHA-256 of its search id; every client's read tool computes the same. */
export { textKey };
interface Readable { title: string; path?: string; url: string; source: string; text: string }
async function writeTexts(docs: SearchDocument[], readable: Map<string, Readable>, to: string) {
    const shards = new Map<string, Record<string, unknown>>();
    const keep = (id: string, value: unknown) => {
        const key = textKey(id), shard = shards.get(key.slice(0, 2)) ?? {};
        shard[key] = value;
        shards.set(key.slice(0, 2), shard);
    };
    for (const doc of docs) {
        if (!/^[0-9a-f]{16}$/.test(doc.id)) continue;
        keep(doc.id, { title: doc.title, url: doc.url, source: doc.source_name ?? doc.source, published: doc.published ?? null, text: doc.text ?? '', files: (doc.files ?? []).map(file => ({ name: file.name, url: file.url })) });
    }
    for (const [id, doc] of readable) keep(id, { ...doc, published: null, text: doc.text, files: [] });
    await mkdir(to, { recursive: true });
    for (const [key, shard] of shards) await write(join(to, `${key}.json`), shard);
}

async function verifyReferences(data: { dir: string; index: DataIndex }, mapIds: Set<string>) {
    const scan = (value: unknown): string[] => {
        if (typeof value === 'string') {
            return mapIds.has(value) ? [value] : [];
        }
        if (Array.isArray(value)) {
            return value.flatMap(scan);
        }
        if (value && typeof value === 'object') {
            return Object.values(value).flatMap(scan);
        }
        return [];
    };
    const references = scan(data.index);
    for (const folder of ['teaching', 'exams', 'labs', 'rooms', 'places', 'entities']) {
        const path = join(data.dir, folder);
        if (!existsSync(path)) {
            continue;
        }
        for (const file of await readdir(path, { recursive: true })) {
            if (String(file).endsWith('.json')) {
                references.push(...scan(JSON.parse(await readFile(join(path, String(file)), 'utf8'))));
            }
        }
    }
    for (const id of references) {
        if (!mapIds.has(id)) {
            throw new Error(`data references unknown map space id: ${id}`);
        }
    }
}

const round = (value: unknown): unknown => Array.isArray(value)
    ? value.map(round)
    : typeof value === 'number' ? Math.round(value * 1e7) / 1e7 : value;

/** What the clients draw in 3D: every footprint with a height, and each floor's plate, cores and rooms. */
async function buildModel(campus: string, from: string, layers: string, entities: MapPlace[]) {
    const features = async (name: string) => (await read<{ features: { properties: Record<string, any>; geometry: MapPlace['geometry'] }[] }>(join(layers, `${name}.geojson`))).features;
    const shape = (geometry: MapPlace['geometry']) => ({ type: geometry!.type, coordinates: round(geometry!.coordinates) });
    // Campus buildings are authored with their height and storeys; one without is a broken map release.
    const measured = (row: Record<string, any>, field: 'height_m' | 'levels') => { const value = Number(row[field]); if (!(value > 0)) throw new Error(`building ${row.id} has no ${field}`); return value; };
    // Surrounding buildings mostly come without heights (634 of 674 in map-v0.8.5). Their height is not known,
    // so they lie flat as footprints and cast no shadow; the style draws them the same way.
    const surrounding = (row: Record<string, any>) => Number(row.height_m) || Number(row.levels) * 3.4 || 0;
    const levels = new Map(entities.filter(place => place.kind === 'floor' && place.parent && place.level != null).map(place => [place.id, place.level!]));
    const indoor = await read<Record<string, { plate: MapPlace['geometry']; cores: { kind: string; geometry: MapPlace['geometry'] }[] }>>(join(from, 'indoor.json'));
    const floors: Record<string, unknown> = {};
    for (const [id, floor] of Object.entries(indoor)) {
        floors[id] = {
            level: levels.get(id) ?? Number(id.slice(id.lastIndexOf('/') + 1)),
            plate: shape(floor.plate),
            cores: floor.cores.map(core => ({ kind: core.kind, geometry: shape(core.geometry) })),
            rooms: entities.filter(place => place.kind === 'room' && place.parent === id && place.geometry).map(place => ({ id: place.id, geometry: shape(place.geometry) })),
        };
    }
    return {
        campus,
        buildings: (await features('buildings')).map(({ properties, geometry }) => ({ id: properties.id, levels: measured(properties, 'levels'), height: measured(properties, 'height_m'), geometry: shape(geometry) })),
        context: (await features('context_buildings')).map(({ properties, geometry }) => ({ height: surrounding(properties), geometry: shape(geometry) })),
        floors,
    };
}

async function buildCampus(
    campus: string,
    mapRoot: string,
    layers: string,
    out: string,
    roomFacts: Map<string, any>,
) {
    const from = join(mapRoot, campus);
    const to = join(out, 'space', campus);
    const entities = await read<MapPlace[]>(join(from, 'entities.json'));
    const mapLevels = new Map<string, number>();
    for (const place of entities) if (place.kind === 'floor' && place.parent && place.level != null) mapLevels.set(place.parent, Math.max(mapLevels.get(place.parent) ?? 0, place.level));
    const ids = new Set(entities.map(place => place.id));
    const normalized = entities.map(place => normalizePlace(place, ids, roomFacts, mapLevels));
    await mkdir(to, { recursive: true });
    await write(join(to, 'entities.json'), normalized);
    for (const file of SPACE_FILES) {
        if (file === 'entities.json') continue;
        if (file === 'model.json') {
            await write(join(to, file), await buildModel(campus, from, layers, entities));
            continue;
        }
        if (file === 'style.json') {
            await write(join(to, file), style());
        } else if (file === 'models.bin.gzip') {
            // A fifth of the size, and no host has to be trusted to compress it.
            await writeFile(join(to, file), gzipSync(await readFile(join(from, 'models.bin')), { level: 9 }));
        } else {
            await copyFile(join(from, file), join(to, file));
        }
    }
    return normalized;
}

type Normalized = ReturnType<typeof normalizePlace>;
const labels: Record<string, string> = campusConfig.search.entities;
const entity = (source: string, id: string, url: string, title: string, section: string | null, text: string[], within: string[] = []): SearchDocument & { within: string[] } => ({
    id: `${source}/${id}`, source, source_name: labels[source] ?? source, url, title, text: [...new Set(text.filter(Boolean))].join(' '),
    published: null, updated: null, section, kind: 'page', category: source, tags: [], files: [], within: [...new Set(within)],
});
const WEEKDAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const plainCourse = (name: string) => name.replace(/[（(].*?[)）]/g, '').trim() || name.trim();
const roomText = (room: string | null) => (room ?? '').replace(/^[^/:]*[/:]/, '');
/** Rooms teaching can use: not a playground, not a name the office keeps for itself. */
const isTaught = (room: Room) => Boolean(room.listed) && !room.kinds.some(kind => /运动场|非教室|不要教室/.test(kind));
const slotText = (rows: TeachingMeeting[]) => [...new Set(rows.map(row => `${WEEKDAY[row.weekday]} ${row.periods[0]}–${row.periods[1]} 节${row.room ? ` ${roomText(row.room)}` : ''}`))];
const group = <T>(rows: T[], key: (row: T) => string[]) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) for (const name of key(row)) groups.set(name, [...(groups.get(name) ?? []), row]);
    return groups;
};

/** Courses, people, classes, exams and places as documents, so one index answers everything. */
function entityDocuments(meetings: TeachingMeeting[], classes: TeachingClass[], exams: Exam[], places: Normalized[], rooms: Room[], nicknames: Map<string, string[]>): SearchDocument[] {
    const docs: SearchDocument[] = [];
    /** What students call a course (the course plans' aliases in the data release), so 计网 finds 计算机网络. */
    const called = (name: string) => nicknames.get(name) ?? [];
    const byId = new Map(places.map(place => [place.id, place]));
    /** An entity and everything that contains it. */
    const chain = (id: string | null | undefined): string[] => {
        const out: string[] = [];
        for (let at = id ? byId.get(id) : undefined; at; at = at.parent ? byId.get(at.parent) : undefined) out.push(at.id);
        return out;
    };
    for (const [name, rows] of group(meetings, row => [plainCourse(row.course.name)])) {
        const teachers = rows.flatMap(row => row.teachers.map(teacher => teacher.name));
        const count = new Set(rows.map(row => row.teaching_class.id)).size;
        docs.push(entity('courses', name, `/?who=course:${encodeURI(name)}&scale=week`, name, `${count} 个教学班`, [...new Set(rows.flatMap(row => called(row.course.name))), ...rows.map(row => row.course.code ?? ''), ...teachers, ...rows.map(row => row.course.category ?? '')]));
    }
    for (const [name, rows] of group(meetings, row => row.teachers.map(teacher => teacher.name))) {
        docs.push(entity('teachers', name, `/?who=teacher:${encodeURI(name)}&scale=week`, name, null, rows.map(row => plainCourse(row.course.name))));
    }
    for (const item of classes) {
        docs.push(entity('classes', item.id, `/?who=class:${encodeURI(item.name)}&scale=week`, item.name, item.major, [item.major ?? '', item.college ?? '', item.campus ?? '', item.students ? `${item.students} 人` : '']));
    }
    for (const [id, rows] of group(meetings, row => [row.teaching_class.id])) {
        const first = rows[0]!;
        const teachers = [...new Set(rows.flatMap(row => row.teachers.map(teacher => teacher.name)))];
        docs.push(entity('teaching-classes', id, `/?preview=${encodeURIComponent(id)}&scale=week`, [plainCourse(first.course.name), ...teachers].join(' '), first.campus,
            [...called(first.course.name), ...slotText(rows), first.course.code ?? '', ...rows.flatMap(row => row.classes)], rows.flatMap(row => chain(row.room))));
    }
    for (const exam of exams) {
        docs.push(entity('exams', exam.id, `/?who=course:${encodeURI(plainCourse(exam.course.name))}&t=${exam.date}&scale=day`, `${plainCourse(exam.course.name)} 考试`, exam.classes.length > 3 ? `${exam.classes.slice(0, 3).join(' ')} 等 ${exam.classes.length} 个班` : exam.classes.join(' '),
            [...called(exam.course.name), `${exam.date} ${exam.start}–${exam.end}`, roomText(exam.room ?? exam.location), ...exam.classes, exam.teacher ?? '', exam.course.code ?? ''], chain(exam.room)));
    }
    for (const place of places) {
        if (place.kind === 'floor' || place.kind === 'campus') continue;
        const room = place.kind === 'room';
        const title = room ? place.id.slice(place.id.indexOf('/') + 1) : displayName(place, byId);
        const roomTitle = (place as { title?: string }).title;
        docs.push(entity(room ? 'rooms' : 'places', place.id, `/map/?place=${encodeURI(place.id)}`, title, place.category ?? null,
            [...place.names, roomTitle ?? '', place.parent ?? '', place.group ?? '', place.floor ? `${place.floor} 层` : '', place.seats ? `${place.seats} 座` : '', ...(place.room_kinds ?? []), ...(place.houses ?? [])], chain(place.id)));
    }
    // What the map has not drawn yet is found the same way and opens as its timetable.
    for (const room of rooms) {
        if (room.id.includes('/') || !isTaught(room)) continue;
        docs.push(entity('rooms', room.id, `/?who=room:${encodeURI(room.id)}&scale=day`, `${room.building === '其他' ? '' : `${room.building} `}${room.number}`, room.campus,
            [...room.names, room.campus, room.building, room.floor ? `${room.floor} 层` : '', room.seats ? `${room.seats} 座` : '', ...room.kinds]));
    }
    return docs;
}

async function main() {
    console.log('campus: locating the pinned upstream inputs');
    let previous: CampusRelease | undefined;
    try { const value: unknown = await read(join(root, 'src/data/campus-release.json')); if (validRelease(value)) previous = value; } catch { /* first build */ }
    const map = await locateMap();
    const data = await locateData();
    if (data.index.map?.resolved_map_version && data.index.map.resolved_map_version !== map.version) {
        throw new Error(`data release pins ${data.index.map.resolved_map_version}, selected map is ${map.version}`);
    }
    const mapSpaceRoot = join(map.dir, 'space');
    const campuses = (await readdir(mapSpaceRoot)).sort();
    if (!campuses.length) {
        throw new Error('map release contains no campus space');
    }
    const mapPlacesByCampus = new Map<string, MapPlace[]>();
    const mapIds = new Set<string>();
    for (const campus of campuses) {
        const places = await read<MapPlace[]>(join(mapSpaceRoot, campus, 'entities.json'));
        mapPlacesByCampus.set(campus, places);
        for (const place of places) {
            mapIds.add(place.id);
        }
    }
    await verifyReferences(data, mapIds);
    const hours = await read<Record<string, any>>(join(data.dir, 'hours.json'));
    for (const id of Object.keys(hours)) {
        if (!mapIds.has(id)) {
            throw new Error(`opening-hours id is outside map release: ${id}`);
        }
    }
    // The product release versions the packaging code; upstream releases version its inputs.
    const knowledge = await locateKnowledge();
    const knowledgeIndex = await read<KnowledgeIndex>(join(knowledge.dir, 'knowledge.json'));
    const version = `r${new Date().toISOString().replace(/\D/g, '').slice(0, 17)}`;
    const outRoot = join(root, 'public', 'data');
    const out = join(outRoot, version);
    await mkdir(outRoot, { recursive: true });
    await rm(out, { recursive: true, force: true });
    const terms = await packageFacts(data.dir, out, data.index, [...mapPlacesByCampus.values()].flat());
    console.log(`campus: facts ${data.version} packaged as ${version}`);
    for (const file of ['hours.json', 'calendar.json', 'morning-run.json']) {
        await copyFile(join(data.dir, file), join(out, file));
    }
    await copyFile(join(data.dir, 'materials', 'courses.json'), join(out, 'materials.json'));
    if (existsSync(join(data.dir, 'curriculum', 'courses.json'))) {
        await mkdir(join(out, 'curriculum'), { recursive: true });
        await copyFile(join(data.dir, 'curriculum', 'courses.json'), join(out, 'curriculum', 'courses.json'));
    }
    await write(join(out, 'knowledge-catalog.json'), knowledgeCatalog(knowledgeIndex, await read<CurriculumCourse[]>(join(data.dir, 'curriculum', 'courses.json'))));
    const dataEntities = join(data.dir, 'entities');
    for (const file of ['index.json', 'agent.json', 'information.json', 'time.json']) {
        if (existsSync(join(dataEntities, file))) {
            await mkdir(join(out, 'entities'), { recursive: true });
            await copyFile(join(dataEntities, file), join(out, 'entities', file));
        }
    }
    const roomFacts = new Map((await read<any[]>(join(data.dir, 'places', 'rooms.json'))).map(row => [row.id, row]));
    const places: Normalized[] = [];
    for (const campus of campuses) {
        // Space is versioned by njupt-map alone. Teaching room attributes are
        // campus facts and are joined by readers, never baked into map assets.
        places.push(...await buildCampus(campus, mapSpaceRoot, map.layers, out, new Map()));
    }
    await cp(join(root, 'public/map'), join(out, 'space/assets'), { recursive: true });
    const previousMapPath = previous?.map_base;
    const mapPath = previous?.map_version === map.version && previousMapPath && await equalTrees(join(out, 'space'), join(root, 'public', previousMapPath))
        ? previousMapPath : `/space/${map.version}__${version}`;
    const teachingDir = join(out, 'teaching', terms.teaching);
    const examRows = terms.exams ? await read<Exam[]>(join(data.dir, 'exams', terms.exams, 'exams.json')) : [];
    const searchablePlaces = places.map(place => {
        const fact = roomFacts.get(place.id);
        return { ...place, ...(fact ? { names: [...new Set([...place.names, ...fact.names])], seats: fact.seats, room_kinds: fact.kinds } : {}) };
    });
    const docs: SearchDocument[] = entityDocuments(await read<TeachingMeeting[]>(join(teachingDir, 'meetings.json')), await read<TeachingClass[]>(join(teachingDir, 'classes.json')), examRows, searchablePlaces, (await read<{ rooms: Room[] }>(join(out, 'rooms', 'index.json'))).rooms,
        new Map((await read<{ items: { subtype: string; names: string[]; aliases: string[] }[] }>(join(data.dir, 'entities', 'information.json'))).items
            .filter(item => item.subtype === 'information:course-plan' && item.aliases.length).map(item => [item.names[0]!, item.aliases])));
    for await (const doc of searchDocuments(data.dir)) {
        docs.push(doc);
    }
    // The knowledge names its courses by the codes taught now; one that is not stops the build.
    const taught = new Set((await read<{ items: { id: string }[] }>(join(data.dir, 'entities', 'information.json'))).items.map(item => item.id));
    for (const course of knowledgeIndex.courses) {
        const gone = course.codes.filter(code => !taught.has(`information/course-plan/${code}`));
        if (gone.length) throw new Error(`knowledge course ${course.name} names codes not taught this term: ${gone.join(', ')}`);
    }
    // The knowledge release is text; its pictures are named by full address on the knowledge's own static hosts.
    if (!knowledgeIndex.media?.length) throw new Error('the knowledge release names no media hosts');
    await cp(knowledge.dir, join(out, 'knowledge'), { recursive: true });
    // A knowledge release is immutable. Ordinary timetable/room checks reuse its
    // parsed search documents and readable sections without parsing the corpus again.
    const knowledgeCache = join(root, '.data', 'knowledge-search', knowledge.version);
    const knowledgeCacheFile = join(knowledgeCache, 'documents.json');
    let knowledgeTexts: Awaited<ReturnType<typeof knowledgeDocuments>>;
    if (knowledge.version !== 'local' && existsSync(knowledgeCacheFile)) {
        console.log(`campus: reusing parsed knowledge ${knowledge.version}`);
        const kept = await read<{ docs: SearchDocument[]; readable: [string, Readable][] }>(knowledgeCacheFile);
        knowledgeTexts = { docs: kept.docs, readable: new Map(kept.readable) };
    } else {
        console.log(`campus: parsing knowledge ${knowledge.version}`);
        knowledgeTexts = await knowledgeDocuments(knowledge.dir, knowledgeIndex);
        await write(knowledgeCacheFile, { docs: knowledgeTexts.docs, readable: [...knowledgeTexts.readable] });
    }
    docs.push(...knowledgeTexts.docs);
    // Free-room observations and check timestamps do not change searchable content.
    // Compare the actual compiler inputs, not release numbers or file hashes.
    const searchCache = join(root, '.data', 'search');
    const searchInputs = JSON.stringify({ profile: campusConfig.search.profile, docs });
    const inputsFile = join(searchCache, 'inputs.json');
    const searchVersionFile = join(searchCache, 'version.txt');
    let searchVersion = version;
    if (existsSync(inputsFile) && await readFile(inputsFile, 'utf8') === searchInputs) {
        console.log('campus: reusing unchanged search artifacts');
        await cp(join(searchCache, 'bundle'), join(out, 'search'), { recursive: true });
        searchVersion = (await readFile(searchVersionFile, 'utf8')).trim();
    } else {
        console.log(`campus: compiling ${docs.length} search documents`);
        await compileBundle(docs, campusConfig.search.profile, join(out, 'search'));
        await rm(searchCache, { recursive: true, force: true });
        await mkdir(searchCache, { recursive: true });
        await cp(join(out, 'search'), join(searchCache, 'bundle'), { recursive: true });
        await writeFile(inputsFile, searchInputs);
        await writeFile(searchVersionFile, version);
    }
    await writeTexts(docs, knowledgeTexts.readable, join(out, 'texts'));
    // Native bundles keep their familiar relative paths. The public publisher
    // serves each independently versioned component once at its stable address.
    for (const [folder, target] of [
        ['space', mapPath.slice(1)], ['knowledge', `knowledge/${knowledge.version}`],
        ['search', `search/${searchVersion}`], ['texts', `texts/${searchVersion}`],
    ]) {
        await cp(join(out, folder!), join(root, 'public', target!), { recursive: true });
    }
    await write(join(root, 'src', 'data', 'campus-release.json'), {
        map_version: map.version,
        data_version: data.version,
        knowledge_version: knowledge.version,
        knowledge_base: `/knowledge/${knowledge.version}`,
        map_base: mapPath,
        search_base: `/search/${searchVersion}`,
        texts_base: `/texts/${searchVersion}`,
        version,
        base: `/data/${version}`,
        built_at: data.index.built_at,
        ...terms,
    });
    console.log(`digested ${map.version} + ${data.version} (${version})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
