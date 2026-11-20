import bundled from '../../data/campus-release.json';
import product from '../../../product.json';
import { PRODUCT_CONFIG } from './product';
import { SEARCH_BUNDLE_FORMAT } from 'wasm-search';
import { releaseAt, validRelease, type CampusRelease } from './release';

/** A release this build can read: valid, and in the search format its engine reads. */
const readable = (value: unknown): value is CampusRelease => validRelease(value) && value.search_format === SEARCH_BUNDLE_FORMAT;

const CACHE = 'studev-campus-release';
const RUNTIME = 'studev-app-runtime';
const local = bundled as unknown as CampusRelease;
const browser = typeof window !== 'undefined';
function runtimeEntry() {
    try {
        const value = JSON.parse(localStorage.getItem(RUNTIME) ?? 'null')?.campus_entry;
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* The configured origin is the first-start address. */ }
    return `${product.campusOrigin}/campus-release.json`;
}
const dataOrigin = import.meta.env.DEV ? (browser ? location.origin : product.origin) : new URL(runtimeEntry()).origin;
let available: string | undefined;
function kept(): { release: CampusRelease; entry: string } | undefined {
    try {
        const value = JSON.parse(localStorage.getItem(CACHE) ?? 'null');
        const entry = new URL(value.entry);
        return readable(value.release) && entry.protocol === 'https:' && !entry.username && !entry.password
            ? { release: value.release, entry: entry.href } : undefined;
    } catch { return undefined; }
}
export async function latestCampusRelease(): Promise<CampusRelease | undefined> {
    try {
        let entry = runtimeEntry();
        try {
            const runtime = await fetch(`${product.origin}/app-release.json`, { cache: 'no-cache', signal: AbortSignal.timeout(2500) });
            if (runtime.ok) {
                const value = await runtime.json(); const url = new URL(value.campus_entry);
                if (url.protocol === 'https:' && !url.username && !url.password) {
                    entry = url.href;
                    try { localStorage.setItem(RUNTIME, JSON.stringify(value)); } catch { /* The live discovery still uses it. */ }
                }
            }
        } catch { /* An offline application configuration does not block its saved data entry. */ }
        const response = await fetch(entry, { cache: 'no-cache', signal: AbortSignal.timeout(4000) });
        if (!response.ok) return;
        const value: unknown = await response.json();
        // Data newer than this build (or older) is left alone; the next deployment of the site reads it.
        if (!readable(value)) return;
        try { localStorage.setItem(CACHE, JSON.stringify({ entry, release: value })); } catch { /* Private browsing still reads the public snapshot. */ }
        return releaseAt(value, new URL(entry).origin);
    } catch { return undefined; }
}
const cached = browser && !import.meta.env.DEV ? kept() : undefined;
/** Fixed before the first fact read. Headers, account and the application shell
 * render immediately; only cold data readers await discovery. */
export let DATA_RELEASE: CampusRelease = browser ? releaseAt(cached?.release ?? local, cached ? new URL(cached.entry).origin : dataOrigin, import.meta.env.DEV) : local;
export const releaseReady: Promise<void> = browser && !import.meta.env.DEV && !cached
    ? latestCampusRelease().then(next => { if (next) DATA_RELEASE = next; })
    : Promise.resolve();
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
    void releaseReady.then(check);
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
