export const CAMPUS_POINTER_PATH = '/campus-pointer.json';

/** One public snapshot. Readers keep it for their whole visit; a new snapshot
 * becomes current on the next visit or when the reader accepts the update. */
export interface CampusPointer {
    version: string; base: string; built_at: string;
    teaching: string; exams: string | null; labs: string | null; rooms: string;
    map_version: string; data_version: string; knowledge_version: string;
    map_base: string; knowledge_base: string; search_base: string; texts_base: string;
    search_stable_base?: string;
    /** The encodings of the release's binary resources; a client that reads others cannot use it (formats.ts). */
    formats: ReleaseFormats;
}

export interface ReleaseFormats { search: string; models: string }

export interface CampusRelease extends CampusPointer {
    core?: string[]; all?: string[]; bytes?: number;
}

/** The live locator for online browsing. The installer reads the full release to discover its files. */
export function campusPointer(release: CampusRelease): CampusPointer {
    const {
        version, base, built_at, teaching, exams, labs, rooms, map_version, data_version, knowledge_version,
        map_base, knowledge_base, search_base, texts_base, search_stable_base, formats,
    } = release;
    return {
        version, base, built_at, teaching, exams, labs, rooms, map_version, data_version, knowledge_version,
        map_base, knowledge_base, search_base, texts_base, search_stable_base, formats,
    };
}

export function validRelease(value: unknown): value is CampusRelease {
    if (!value || typeof value !== 'object') return false;
    const r = value as CampusRelease;
    const name = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v);
    const path = (v: unknown, prefix: string) => {
        if (typeof v !== 'string') return false;
        return new RegExp(`^/${prefix}/[A-Za-z0-9._-]+$`).test(v);
    };
    return name(r.version) && r.base === `/data/${r.version}` && typeof r.built_at === 'string'
        && name(r.teaching) && name(r.rooms) && (r.exams === null || name(r.exams)) && (r.labs === null || name(r.labs))
        && path(r.map_base, 'space') && path(r.knowledge_base, 'knowledge') && path(r.search_base, 'search') && path(r.texts_base, 'texts')
        && (r.search_stable_base === undefined || (r.search_stable_base !== r.search_base && path(r.search_stable_base, 'search')))
        && !!r.formats && typeof r.formats.search === 'string' && typeof r.formats.models === 'string';
}

export function releaseAt<T extends CampusPointer>(release: T, origin: string, local = false): T {
    const at = (path: string) => new URL(local ? new URL(path, origin).pathname : path, origin).href.replace(/\/$/, '');
    return { ...release, base: at(release.base), map_base: at(release.map_base), knowledge_base: at(release.knowledge_base), search_base: at(release.search_base),
        ...(release.search_stable_base ? { search_stable_base: at(release.search_stable_base) } : {}), texts_base: at(release.texts_base) };
}

/** Resource lists contain file paths, including literal #, % and Unicode. */
export function resourceAt(path: string, entry: string): string {
    return new URL(path.split('/').map(encodeURIComponent).join('/'), entry).href;
}
