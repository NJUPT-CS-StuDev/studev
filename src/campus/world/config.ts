import {
    version, base, built_at, teaching, exams, labs, rooms, map_version, data_version, knowledge_version,
    map_base, knowledge_base, search_base, texts_base, search_format,
} from '../../data/campus-release.json';
import product from '../../../product.json';
import { PRODUCT_CONFIG } from './product';
import { SEARCH_BUNDLE_FORMAT } from 'wasm-search';
import { releaseAt, validRelease, type CampusRelease } from './release';

/** A release this build can read: valid, and in the search format its engine reads. */
const readable = (value: unknown): value is CampusRelease => validRelease(value) && value.search_format === SEARCH_BUNDLE_FORMAT;

export const CAMPUS_RELEASE_CACHE = 'studev-campus-release';
// The offline resource inventories belong to the service worker. Keeping them
// out of this module removes hundreds of kilobytes from each campus entry.
const local: CampusRelease = {
    version, base, built_at, teaching, exams, labs, rooms, map_version, data_version, knowledge_version,
    map_base, knowledge_base, search_base, texts_base, search_format,
};
const browser = typeof window !== 'undefined';
const entry = `${product.campusOrigin}/campus-release.json`;
const dataOrigin = import.meta.env.DEV ? (browser ? location.origin : product.origin) : product.campusOrigin;
let available: string | undefined;
function kept(): CampusRelease | undefined {
    try {
        const value = JSON.parse(localStorage.getItem(CAMPUS_RELEASE_CACHE) ?? 'null');
        return value?.entry === entry && readable(value.release) ? value.release : undefined;
    } catch { return undefined; }
}
let discovering: Promise<CampusRelease | undefined> | undefined;
export function latestCampusRelease(): Promise<CampusRelease | undefined> {
    return discovering ??= discoverCampus().finally(() => { discovering = undefined; });
}
async function discoverCampus(): Promise<CampusRelease | undefined> {
    try {
        // The pointer requires HTTP revalidation. The default cache mode also reuses its document preload.
        const response = await fetch(entry, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (!readable(value)) return;
        try { localStorage.setItem(CAMPUS_RELEASE_CACHE, JSON.stringify({ entry, release: value })); } catch { /* Private browsing still reads the public snapshot. */ }
        return releaseAt(value, product.campusOrigin);
    } catch { return undefined; }
}
const cached = browser && !import.meta.env.DEV ? kept() : undefined;
const initial = browser ? releaseAt(cached ?? local, dataOrigin, import.meta.env.DEV) : local;
const opensSearch = browser && !import.meta.env.DEV && location.pathname === '/search/' && navigator.onLine;
/** The visit reads one snapshot. On a direct cold search, resolve the live pointer before opening its index:
 * the deployment's bundled snapshot may have been retired by a separate data release. */
export const DATA_RELEASE: CampusRelease = (opensSearch ? await latestCampusRelease() : undefined) ?? initial;
if (browser && !import.meta.env.DEV) {
    const check = async () => {
        if (!navigator.onLine) return;
        const next = await latestCampusRelease();
        const key = next && JSON.stringify([next.version, next.base, next.map_base, next.knowledge_base, next.search_base]);
        const current = JSON.stringify([DATA_RELEASE.version, DATA_RELEASE.base, DATA_RELEASE.map_base, DATA_RELEASE.knowledge_base, DATA_RELEASE.search_base]);
        if (next && key !== current && key !== available) {
            available = key;
            window.dispatchEvent(new CustomEvent('studev:campus-update', { detail: next.version }));
        }
    };
    setInterval(() => void check(), 10 * 60_000);
    window.addEventListener('focus', () => void check());
    if (!opensSearch) {
        if ('requestIdleCallback' in window) requestIdleCallback(() => void check(), { timeout: 2000 });
        else setTimeout(() => void check(), 1000);
    }
}

export const APP_CONFIG = {
    ...PRODUCT_CONFIG,
    PAGE_TITLE: '校园查询',
    get DATA_URLS() { const release = DATA_RELEASE; return {
        SEARCH: release.search_base,
        TEXTS: release.texts_base,
        TIMETABLE: `${release.base}/teaching/${release.teaching}`,
        COURSE_PLANS: `${release.base}/entities/information.json`,
        TEACHING_CLASSES: `${release.base}/entities/agent.json`,
        EXAMS: `${release.base}/exams/${release.exams}`,
        CLASSROOMS: `${release.base}/rooms`,
    }; },
};
